// Wine で動かしたソフトが作成・変更したファイル（セーブデータなど）の書き出しと取り込み。
//
// Boxedwine は、ソフトが書き込んだファイルをゲームごとの IndexedDB（データベース名 /root/app/<id>.zip、
// ストア FILE_DATA、キーはエミュレーター内の絶対パス）に保存し、次の起動で ZIP の中身より優先して使う。
// D: ドライブは /d_drive/app/<id>.zip。値は Emscripten IDBFS の形式 { timestamp, mode, contents }。
// ファイル名の非 ASCII 文字などは Boxedwine の規則（source/io/fs.cpp の localNameToRemote）で符号化されている。
//
// 書き出す ZIP の中身: C/…（C: ドライブ）・D/…（D: ドライブ）・registry/user.reg（ユーザーのレジストリ）。
// 同じ形の ZIP を取り込むと元の場所に戻る。それ以外（ばらのファイルや他の ZIP）は、選んだゲーム内のフォルダに入れる。
(function () {
"use strict";
const IDB_VERSION = 21; // Emscripten IDBFS の DB_VERSION
const STORE = "FILE_DATA";
const WINE = "/home/username/.wine";
const DRIVE_C = WINE + "/drive_c";
const FILE_MODE = 0o100644;
const DIR_MODE = 0o40777;

function dbNames(id) {
  const key = "app/" + encodeURIComponent(id + ".zip");
  return { c: "/root/" + key, d: "/d_drive/" + key };
}

function openDb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, IDB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE).createIndex("timestamp", "timestamp", { unique: false });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("database is in use"));
  });
}

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

// ---- Boxedwine のファイル名符号化 ----
const SPECIAL = { ":": "(_colon_)", "?": "(_question_)", "@": "(_at_)" };
function toNative(path) {
  const enc = new TextEncoder();
  return path.split("/").map((part) => {
    const bytes = enc.encode(part);
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i];
      const last = i === bytes.length - 1;
      if (c >= 0x80) out += "(_x" + c.toString(16).toUpperCase().padStart(2, "0") + "_)";
      else {
        const ch = String.fromCharCode(c);
        if (SPECIAL[ch]) out += SPECIAL[ch];
        else if (last && ch === ".") out += "(_dot_)";
        else if (last && ch === " ") out += "(_space_)";
        else out += ch;
      }
    }
    return out;
  }).join("/");
}

function fromNative(path) {
  const bytes = [];
  const words = { "(_colon_)": ":", "(_question_)": "?", "(_at_)": "@", "(_dot_)": ".", "(_space_)": " " };
  for (let i = 0; i < path.length;) {
    const hex = /^\(_x([0-9A-Fa-f]{2})_\)/.exec(path.slice(i, i + 7));
    if (hex) { bytes.push(parseInt(hex[1], 16)); i += 7; continue; }
    let hit = false;
    for (const w in words) {
      if (path.startsWith(w, i)) { bytes.push(words[w].charCodeAt(0)); i += w.length; hit = true; break; }
    }
    if (hit) continue;
    const c = path.charCodeAt(i++);
    if (c < 0x80) bytes.push(c);
    else for (const b of new TextEncoder().encode(String.fromCharCode(c))) bytes.push(b);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// IndexedDB のキー（エミュレーター内の絶対パス）→ 書き出す ZIP 内の名前。対象外は null
function exportName(rel, drive) {
  if (drive === "d") return "D" + rel;
  if (rel.startsWith(DRIVE_C + "/")) return "C" + rel.slice(DRIVE_C.length);
  if (rel === WINE + "/user.reg") return "registry/user.reg";
  return null; // Wine 自身の設定・一時ファイルなど
}
function importKey(name) {
  if (/^C\//.test(name)) return { drive: "c", rel: DRIVE_C + name.slice(1) };
  if (/^D\//.test(name)) return { drive: "d", rel: name.slice(1) };
  if (name === "registry/user.reg") return { drive: "c", rel: WINE + "/user.reg" };
  return null;
}

// 作成・変更されたファイルの一覧 [{ name, drive, key, size }]
async function changedFiles(id) {
  const names = dbNames(id);
  const known = indexedDB.databases ? new Set((await indexedDB.databases()).map((d) => d.name)) : null;
  const out = [];
  for (const drive of ["c", "d"]) {
    if (known && !known.has(names[drive])) continue;
    const db = await openDb(names[drive]);
    try {
      const st = db.transaction(STORE).objectStore(STORE);
      const keys = await req(st.getAllKeys());
      for (const key of keys) {
        if (!key.startsWith(names[drive] + "/")) continue;
        const v = await req(st.get(key));
        if (!v || !v.contents) continue;
        const name = exportName(fromNative(key.slice(names[drive].length)), drive);
        if (name) out.push({ name, drive, key, size: v.contents.length });
      }
    } finally {
      db.close();
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readFiles(id, list) {
  const names = dbNames(id);
  const out = [];
  for (const drive of ["c", "d"]) {
    const mine = list.filter((f) => f.drive === drive);
    if (!mine.length) continue;
    const db = await openDb(names[drive]);
    try {
      const st = db.transaction(STORE).objectStore(STORE);
      for (const f of mine) out.push({ name: f.name, bytes: (await req(st.get(f.key))).contents });
    } finally {
      db.close();
    }
  }
  return out;
}

// ソフトが作ったフォルダ（中身が空でも表示するため）。書き出し ZIP と同じ形の名前（C/… など）で返す
async function changedDirs(id) {
  const names = dbNames(id);
  const known = indexedDB.databases ? new Set((await indexedDB.databases()).map((d) => d.name)) : null;
  const out = [];
  for (const drive of ["c", "d"]) {
    if (known && !known.has(names[drive])) continue;
    const db = await openDb(names[drive]);
    try {
      const st = db.transaction(STORE).objectStore(STORE);
      for (const key of await req(st.getAllKeys())) {
        if (!key.startsWith(names[drive] + "/")) continue;
        const v = await req(st.get(key));
        if (!v || v.contents) continue;
        const name = exportName(fromNative(key.slice(names[drive].length)), drive);
        if (name && /^C\/(files|users)\/./.test(name)) out.push(name);
      }
    } finally {
      db.close();
    }
  }
  return out;
}

// 変更したファイルを消す（元のファイルがあれば、次の起動からそちらが見える）。list は changedFiles の要素
async function deleteFiles(id, list) {
  const names = dbNames(id);
  for (const drive of ["c", "d"]) {
    const mine = list.filter((f) => f.drive === drive);
    if (!mine.length) continue;
    const db = await openDb(names[drive]);
    try {
      const tx = db.transaction(STORE, "readwrite");
      for (const f of mine) tx.objectStore(STORE).delete(f.key);
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    } finally {
      db.close();
    }
  }
}

// フォルダを作る。target.rel の最後の 1 段（ファイル名）を除いたフォルダまでを作る
function makeDir(id, target) {
  return writeFiles(id, [Object.assign({ dirsOnly: true }, target)]);
}

// files: [{ drive, rel（エミュレーター内の絶対パス）, bytes }]
async function writeFiles(id, files) {
  const names = dbNames(id);
  for (const drive of ["c", "d"]) {
    const mine = files.filter((f) => f.drive === drive);
    if (!mine.length) continue;
    const db = await openDb(names[drive]);
    try {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const existing = new Set(await req(st.getAllKeys()));
      const now = new Date();
      for (const f of mine) {
        // 親フォルダも IndexedDB に無いと、起動時の読み込み（IDBFS）でファイルを作れず失敗する
        const parts = f.rel.split("/").filter(Boolean);
        let path = names[drive];
        for (let i = 0; i < parts.length - 1; i++) {
          path += "/" + toNative(parts[i]);
          if (!existing.has(path)) { st.put({ timestamp: now, mode: DIR_MODE }, path); existing.add(path); }
        }
        if (f.dirsOnly) continue;
        const key = names[drive] + toNative(f.rel);
        st.put({ timestamp: now, mode: FILE_MODE, contents: f.bytes }, key);
        existing.add(key);
      }
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    } finally {
      db.close();
    }
  }
}

window.WineSaves = { changedFiles, changedDirs, readFiles, writeFiles, deleteFiles, makeDir, importKey, toNative, fromNative, DRIVE_C };
})();
