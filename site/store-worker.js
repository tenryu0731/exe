// ゲームファイルを OPFS（ブラウザ内ファイル領域）へ少しずつ書き込む Worker。
// ファイル全体をメモリに載せないので、数百MBのZIPでも追加できる。
//
// メッセージ:
//   { op: "copy",    file, id }                 … ZIP をそのまま保存
//   { op: "rewrite", file, id, entries, cd }     … ファイル名を UTF-8 に変換して保存
//   { op: "pack", id, entries: [{ name, file }] } … 複数ファイル（フォルダ・単体 EXE/MSI）を無圧縮 ZIP にまとめて保存
//   { op: "extract", file, id, root, entries, base } … HTML5 ゲーム（RPGツクールMV/MZ）を
//        Cache Storage に展開する。root 配下のファイルだけを base + "play/<id>/<相対パス>" に保存
// 応答: { type: "progress", done, total } / { type: "done", size } / { type: "error", message }
"use strict";

const CHUNK = 8 * 1024 * 1024;

async function openTarget(id) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("games", { create: true });
  const handle = await dir.getFileHandle(id + ".zip", { create: true });
  const access = await handle.createSyncAccessHandle();
  access.truncate(0);
  return access;
}

async function readBytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function progress(done, total) {
  postMessage({ type: "progress", done, total });
}

// file[start, end) を out の pos へ書き写す
async function copyRange(file, start, end, out, pos, report) {
  for (let p = start; p < end; p += CHUNK) {
    const bytes = await readBytes(file, p, Math.min(end, p + CHUNK));
    out.write(bytes, { at: pos });
    pos += bytes.length;
    report(p + bytes.length);
  }
  return pos;
}

async function copy({ file, id }) {
  const out = await openTarget(id);
  try {
    const end = await copyRange(file, 0, file.size, out, 0, (d) => progress(d, file.size));
    out.flush();
    return end;
  } finally {
    out.close();
  }
}

// entries: [{ cdPos, localOffset, utf8Name(Uint8Array) }]  cd: { offset, size, eocdPos }
async function rewrite({ file, id, entries, cd }) {
  const out = await openTarget(id);
  try {
    const sorted = entries.slice().sort((a, b) => a.localOffset - b.localOffset);
    const newOffset = new Map();
    let pos = 0;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const next = i + 1 < sorted.length ? sorted[i + 1].localOffset : cd.offset;
      const head = await readBytes(file, e.localOffset, e.localOffset + 30);
      const hv = new DataView(head.buffer);
      if (hv.getUint32(0, true) !== 0x04034b50) throw new Error("ZIP のローカルヘッダが不正です");
      const oldNameLen = hv.getUint16(26, true);
      hv.setUint16(6, hv.getUint16(6, true) | 0x0800, true); // UTF-8 フラグ
      hv.setUint16(26, e.utf8Name.length, true);
      newOffset.set(e.localOffset, pos);
      out.write(head, { at: pos });
      pos += 30;
      out.write(e.utf8Name, { at: pos });
      pos += e.utf8Name.length;
      const bodyStart = e.localOffset + 30 + oldNameLen;
      pos = await copyRange(file, bodyStart, next, out, pos, (d) => progress(d, file.size));
    }

    // セントラルディレクトリを書き直す
    const cdStart = pos;
    const cdBytes = await readBytes(file, cd.offset, cd.offset + cd.size);
    const cv = new DataView(cdBytes.buffer);
    const byCdPos = new Map(entries.map((e) => [e.cdPos, e]));
    let p = 0;
    while (p < cdBytes.length) {
      if (cv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP のセントラルディレクトリが不正です");
      const nameLen = cv.getUint16(p + 28, true);
      const extraLen = cv.getUint16(p + 30, true);
      const commentLen = cv.getUint16(p + 32, true);
      const e = byCdPos.get(p);
      const fixed = cdBytes.slice(p, p + 46);
      const fv = new DataView(fixed.buffer);
      fv.setUint16(8, fv.getUint16(8, true) | 0x0800, true);
      fv.setUint16(28, e.utf8Name.length, true);
      fv.setUint32(42, newOffset.get(e.localOffset), true);
      out.write(fixed, { at: pos });
      pos += 46;
      out.write(e.utf8Name, { at: pos });
      pos += e.utf8Name.length;
      const rest = cdBytes.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen + commentLen);
      out.write(rest, { at: pos });
      pos += rest.length;
      p += 46 + nameLen + extraLen + commentLen;
    }
    const cdSize = pos - cdStart;

    const eocd = await readBytes(file, cd.eocdPos, file.size);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    out.write(eocd, { at: pos });
    pos += eocd.length;
    out.truncate(pos);
    out.flush();
    return pos;
  } finally {
    out.close();
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(crc, bytes) {
  crc = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

// 複数ファイル（フォルダや単体 EXE / MSI）を無圧縮 ZIP にまとめて保存する。名前は UTF-8
async function pack({ id, entries }) {
  const out = await openTarget(id);
  try {
    const enc = new TextEncoder();
    const total = entries.reduce((a, e) => a + e.file.size, 0) || 1;
    const central = [];
    let pos = 0;
    let done = 0;
    for (const e of entries) {
      if (e.file.size >= 0xffffffff) throw new Error("file too large: " + e.name);
      const name = enc.encode(e.name);
      const start = pos;
      pos += 30 + name.length;
      let crc = 0;
      for (let p = 0; p < e.file.size; p += CHUNK) {
        const bytes = await readBytes(e.file, p, Math.min(e.file.size, p + CHUNK));
        crc = crc32(crc, bytes);
        out.write(bytes, { at: pos });
        pos += bytes.length;
        done += bytes.length;
        progress(done, total);
      }
      const local = new Uint8Array(30);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, e.file.size, true);
      lv.setUint32(22, e.file.size, true);
      lv.setUint16(26, name.length, true);
      out.write(local, { at: start });
      out.write(name, { at: start + 30 });
      central.push({ name, crc, size: e.file.size, offset: start });
    }
    const cdStart = pos;
    for (const c of central) {
      const cd = new Uint8Array(46);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint32(16, c.crc, true);
      cv.setUint32(20, c.size, true);
      cv.setUint32(24, c.size, true);
      cv.setUint16(28, c.name.length, true);
      cv.setUint32(42, c.offset, true);
      out.write(cd, { at: pos });
      pos += 46;
      out.write(c.name, { at: pos });
      pos += c.name.length;
    }
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, pos - cdStart, true);
    ev.setUint32(16, cdStart, true);
    out.write(eocd, { at: pos });
    pos += 22;
    out.truncate(pos);
    out.flush();
    return pos;
  } finally {
    out.close();
  }
}

// ---------- HTML5 ゲームの展開 ----------
const HTML5_CACHE = "exe-html5-v1";
const MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", css: "text/css; charset=utf-8",
  txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", xml: "application/xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  bmp: "image/bmp", ico: "image/x-icon",
  ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", mid: "audio/midi",
  webm: "video/webm", mp4: "video/mp4",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  wasm: "application/wasm",
};

function mimeOf(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return (m && MIME[m[1].toLowerCase()]) || "application/octet-stream";
}

function canonUrl(base, id, rel) {
  return base + "play/" + encodeURIComponent(id) + "/" + rel.split("/").map(encodeURIComponent).join("/");
}

async function inflateRaw(blob) {
  if (typeof DecompressionStream === "undefined") throw new Error("このブラウザは ZIP の展開（DecompressionStream）に未対応です");
  return new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
}

async function extract({ file, id, root, entries, base }) {
  const cache = await caches.open(HTML5_CACHE);
  const targets = entries.filter((e) => !e.dir && e.name.startsWith(root) && e.name.length > root.length);
  const total = targets.reduce((a, e) => a + e.compSize, 0) || 1;
  const index = {};
  let done = 0;
  let written = 0;
  let next = 0;

  async function one(e) {
    const head = await readBytes(file, e.localOffset, e.localOffset + 30);
    const hv = new DataView(head.buffer);
    if (hv.getUint32(0, true) !== 0x04034b50) throw new Error("ZIP のローカルヘッダが不正です: " + e.name);
    const start = e.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
    const raw = file.slice(start, start + e.compSize);
    let body;
    if (e.method === 0) body = raw;
    else if (e.method === 8) body = await inflateRaw(raw);
    else throw new Error("未対応の圧縮形式です（" + e.method + "）: " + e.name);
    const rel = e.name.slice(root.length).normalize("NFC");
    await cache.put(canonUrl(base, id, rel), new Response(body, {
      headers: { "Content-Type": mimeOf(rel), "Content-Length": String(body.size) },
    }));
    index[rel.toLowerCase()] = rel;
    written += body.size;
    done += e.compSize;
    progress(done, total);
  }

  // 4 本並行で展開する
  async function lane() {
    while (next < targets.length) await one(targets[next++]);
  }
  await Promise.all([lane(), lane(), lane(), lane()]);

  await cache.put(base + "play/" + encodeURIComponent(id) + "/.exe-index.json",
    new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json" } }));
  return written;
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    const fn = { copy, rewrite, pack, extract }[msg.op];
    if (!fn) throw new Error("unknown op " + msg.op);
    const size = await fn(msg);
    postMessage({ type: "done", size });
  } catch (e) {
    postMessage({ type: "error", message: (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e)) });
  }
};
