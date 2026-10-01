// EXE Launcher のランチャー画面。文言は i18n.js の I18N.t()。
"use strict";
const { t } = window.I18N;
const GAME_CACHE = "exe-games-v1";
const HTML5_CACHE = "exe-html5-v1";
const APP_DIR = "/home/username/.wine/dosdevices/c:/files";
const META_KEY = "exe-launcher-games-v1";
const $ = (id) => document.getElementById(id);
const mb = (n) => (n / 1048576).toFixed(0);
const pctOf = (done, total) => Math.floor((done / (total || 1)) * 100);

// ---------- メタデータ（ライブラリ） ----------
function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || "[]"); } catch (e) { return []; }
}
function saveMeta(list) {
  try { localStorage.setItem(META_KEY, JSON.stringify(list)); } catch (e) {}
}
function updateMeta(id, patch) {
  const l = loadMeta();
  const g = l.find((x) => x.id === id);
  if (g) Object.assign(g, patch);
  saveMeta(l);
}

// ---------- Service Worker と Wine 本体 ----------
async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error(t("err.sw"));
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller && !sessionStorage.getItem("sw-reloaded")) {
    // 初回登録直後はページが SW 管理下にないので一度だけ再読み込み
    sessionStorage.setItem("sw-reloaded", "1");
    location.reload();
    return new Promise(() => {});
  }
  return reg;
}

let fsSizeMb = "?";
async function loadFsSize() {
  try {
    const m = await (await fetch("fs/parts.json", { cache: "no-cache" })).json();
    fsSizeMb = mb(m.size);
  } catch (e) {}
}

async function fsCached() {
  for (const name of await caches.keys()) {
    if (name.startsWith("exe-fs-")) {
      const c = await caches.open(name);
      if (await c.match(new URL("fs/boxedwine.zip", location.href).href)) return true;
      if (await c.match(new URL("fs/complete", location.href).href)) return true;
    }
  }
  return false;
}

let engineReady = false;
async function refreshEngineStatus() {
  engineReady = await fsCached();
  renderEngine();
}
function renderEngine(state) {
  const el = $("engine-status");
  $("prefetch").textContent = t("engine.prefetch", { mb: fsSizeMb });
  if (state) return;
  el.textContent = engineReady ? t("engine.ready") : t("engine.missing", { mb: fsSizeMb });
  el.className = engineReady ? "status ok" : "status";
  $("engine").classList.toggle("ready", engineReady);
  $("prefetch").hidden = engineReady;
}

$("prefetch").addEventListener("click", () => {
  const sw = navigator.serviceWorker.controller;
  if (!sw) return;
  $("engine-status").textContent = t("engine.downloading", { pct: 0, done: 0, total: fsSizeMb });
  $("engine-progress").hidden = false;
  $("prefetch").disabled = true;
  sw.postMessage("prefetch-fs");
});
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    const d = e.data;
    if (!d) return;
    if (d.type === "fs-progress") {
      const bar = $("engine-progress");
      bar.max = d.total || 1;
      bar.value = d.done;
      $("engine-status").textContent = t("engine.downloading", { pct: pctOf(d.done, d.total), done: mb(d.done), total: mb(d.total) });
      return;
    }
    $("engine-progress").hidden = true;
    $("prefetch").disabled = false;
    if (d.type === "fs-ready") refreshEngineStatus();
    if (d.type === "fs-error") {
      $("engine-status").textContent = t("engine.failed", { msg: d.message });
      $("engine-status").className = "status err";
    }
  });
}

const RUNNABLE = /\.(exe|bat|msi|com)$/i;

// 起動候補の並び順：インストーラや設定ツールを後ろに
function exeScore(path) {
  const parts = path.split("/");
  const base = parts.pop().toLowerCase();
  const folder = (parts[parts.length - 1] || "").toLowerCase();
  let s = parts.length * 10;
  if (/^(setup|install|unins|uninst|config|setting|patch|update|dxsetup|dxwebsetup|vcredist|vc_redist|directx|oalinst|physx|dotnet|ndp)/.test(base)) s += 100;
  // 付属ツール・ランタイムの再配布物・クラッシュ報告用
  if (/(crash|report|redist|helper|uninstall|notification|bugreport|_setup)/.test(base)) s += 80;
  if (parts.some((d) => /^(_?commonredist|redist|redistributables?|directx|vcredist|dotnet|support|tools?|__macosx)$/i.test(d))) s += 60;
  if (/\.(bat|msi|com)$/.test(base)) s += 50;
  if (/(game|start|launch|play)/.test(base)) s -= 5;
  // フォルダ名と同じ名前の exe（MyGame/MyGame.exe）は本体であることが多い
  if (folder && base.replace(/\.[^.]+$/, "") === folder) s -= 8;
  return s;
}
function sortTargets(list) {
  return list.sort((a, b) => exeScore(a) - exeScore(b) || a.localeCompare(b));
}

// ---------- 保存（store-worker.js） ----------
function runWorker(msg, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker("store-worker.js");
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === "progress") onProgress(d.done, d.total);
      else if (d.type === "done") { w.terminate(); resolve(d.size); }
      else if (d.type === "error") { w.terminate(); reject(new Error(d.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "worker error")); };
    w.postMessage(msg);
  });
}

async function storageNote() {
  try {
    const est = await navigator.storage.estimate();
    return t("add.free", { mb: mb(est.quota - est.usage) });
  } catch (e) { return ""; }
}

async function removeHtml5(id) {
  try {
    const cache = await caches.open(HTML5_CACHE);
    const prefix = new URL("play/" + encodeURIComponent(id) + "/", location.href).href;
    for (const req of await cache.keys()) if (req.url.startsWith(prefix)) await cache.delete(req);
  } catch (e) {}
}

async function removeGameFile(id) {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("games");
    await dir.removeEntry(id + ".zip");
  } catch (e) {}
  try {
    const cache = await caches.open(GAME_CACHE);
    await cache.delete(new URL("games/" + id + ".zip", location.href).href);
  } catch (e) {}
}

async function gameFile(id) {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("games");
  return (await dir.getFileHandle(id + ".zip")).getFile();
}

// RPGツクールMV/MZ をブラウザで直接遊べる形式（Cache Storage）に展開する
function html5Message(file, id, index, root) {
  return { op: "extract", file, id, root, base: new URL("./", location.href).href,
    entries: index.entries.map((x) => ({ name: x.name, dir: x.dir, localOffset: x.localOffset, method: x.method, compSize: x.compSize })) };
}

function safeId(name) {
  const base = name.replace(/\.(zip|exe|msi)$/i, "").normalize("NFKC").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "app";
  return base + "-" + Date.now().toString(36);
}

// ---------- ゲーム・アプリの種類の判別 ----------
// verdict: ok=動く見込みあり / hard=重い・不安定 / no=この方式ではほぼ動かない。name/note は i18n のキー
const KIND_VERSION = 3;
function detectKind(names) {
  const lower = names.map((n) => n.toLowerCase());
  const has = (re) => lower.some((n) => re.test(n));
  // index.html と js/rmmz_core.js（MZ）/ js/rpg_core.js（MV）が並ぶフォルダがゲーム本体
  const html5 = (core, code) => {
    for (let i = 0; i < lower.length; i++) {
      const m = lower[i].match(new RegExp("^(.*?)js\\/" + core + "\\.js$"));
      if (m && lower.includes(m[1] + "index.html")) return { code, verdict: "ok", note: "note.html5", html5Root: names[i].slice(0, m[1].length) };
    }
    return null;
  };
  const hit = html5("rmmz_core", "mz") || html5("rpg_core", "mv");
  if (hit) return hit;
  if (has(/(^|\/)unityplayer\.dll$/) || has(/_data\/(globalgamemanagers|data\.unity3d|resources\.assets)$/)) return { code: "unity", verdict: "no", note: "note.d3d11" };
  if (has(/(^|\/)engine\/binaries\//)) return { code: "unreal", verdict: "no", note: "note.heavy" };
  if (has(/(^|\/)resources\/app\.asar$/) || has(/(^|\/)nw\.dll$/) || has(/(^|\/)package\.nw$/)) return { code: "electron", verdict: "no", note: "note.chromium" };
  if (has(/\.pck$/)) return { code: "godot", verdict: "hard", note: "note.gl3" };
  if (has(/\.rgss3a$/) || has(/rgss3\d*[a-z]?\.dll$/)) return { code: "vxace", verdict: "ok", note: "note.okHeavy" };
  if (has(/\.rgss2a$/) || has(/rgss2\d*[a-z]?\.dll$/)) return { code: "vx", verdict: "ok", note: "note.ok" };
  if (has(/\.rgssad$/) || has(/rgss1\d*[a-z]?\.dll$/)) return { code: "xp", verdict: "ok", note: "note.ok" };
  if (has(/\.wolf$/)) return { code: "wolf", verdict: "ok", note: "note.ok" };
  if (has(/(^|\/)rpg_rt\.exe$/)) return { code: "rm2k", verdict: "ok", note: "note.ok" };
  if (has(/(^|\/)tyrano\//)) return { code: "tyrano", verdict: "no", note: "note.chromium" };
  if (has(/\.xp3$/)) return { code: "kirikiri", verdict: "ok", note: "note.ok" };
  if (!has(/\.(exe|bat)$/) && has(/\.msi$/)) return { code: "msi", verdict: "ok", note: "note.msi" };
  return { code: "unknown", verdict: "ok", note: "" };
}
// RPG ツクール 2000/2003・XP・VX・VX Ace は、素材集（RTP）を別にインストールする前提のゲームがある。
// 入っていないと起動時にエラーになるので、RTP が要りそうなら注意を出す。
// readText(名前の正規表現) は ZIP / フォルダ内のテキストファイルを読む関数
async function needsRtp(kind, names, readText) {
  const lower = names.map((n) => n.toLowerCase());
  try {
    if (kind.code === "rm2k") {
      const ini = await readText(/(^|\/)rpg_rt\.ini$/i);
      return !(ini && /FullPackageFlag\s*=\s*1/i.test(ini));
    }
    if (kind.code === "vxace" || kind.code === "vx" || kind.code === "xp") {
      const ini = await readText(/(^|\/)game\.ini$/i);
      const rtp = ini && /^\s*RTP\d?\s*=\s*\S+/im.test(ini);
      // 素材が同梱されていれば（暗号化アーカイブ内か Graphics/System）RTP 不要
      const bundled = lower.some((n) => /graphics\/system\/window\.png$/.test(n));
      return !!rtp && !bundled;
    }
  } catch (e) {}
  return false;
}

function kindOf(names) {
  return Object.assign({ v: KIND_VERSION }, detectKind(names));
}
function kindText(k) {
  return t("lib.kind", { name: t("kind." + k.code) }) + (k.note ? " — " + t(k.note) : "");
}

// ---------- 追加 ----------
// items: [{ file, path }]。1 つの ZIP / EXE / MSI はそのまま、それ以外は無圧縮 ZIP にまとめる
// ファイル名にかな・漢字があれば日本語のソフトとみなす（UI が英語でも日本語ロケールで動かす。
// そうしないと Shift_JIS の文字列やファイル名を扱う日本語ソフトが文字化け・起動失敗する）
function looksJapanese(names, title) {
  const re = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/;
  return re.test(title || "") || names.some((n) => re.test(n));
}

async function addItems(items, title) {
  const st = $("add-status");
  const buttons = [$("pick"), $("pick-folder"), $("demo")];
  st.className = "status";
  st.textContent = t("add.reading", { name: title });
  buttons.forEach((b) => (b.disabled = true));
  const id = safeId(title);
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) throw new Error(t("err.opfs"));
    const single = items.length === 1 ? items[0].file : null;
    let targets, msg, kind, label, names = [];
    const arc = single && /\.(rar|7z|lzh|lha|cab|tar|gz|tgz|xz)$/i.exec(single.name);
    if (arc) throw new Error(t("err.archive", { ext: arc[1].toUpperCase() }));
    if (single && /\.zip$/i.test(single.name)) {
      const index = await readZipIndex(single);
      names = index.entries.map((x) => x.name);
      targets = index.entries.filter((x) => !x.dir && RUNNABLE.test(x.name) && !isJunkPath(x.name)).map((x) => x.name);
      kind = kindOf(names);
      if (await needsRtp(kind, names, async (re) => {
        const e = index.entries.find((x) => re.test(x.name));
        return e ? new TextDecoder("shift_jis").decode(await zipEntryBytes(single, e)) : null;
      })) kind.note = "note.rtp";
      const bad = unsupportedEntry(index);
      if (bad) throw new Error(t("err.method", { name: bad }));
      if (kind.html5Root !== undefined) {
        msg = html5Message(single, id, index, kind.html5Root);
        label = "add.extracting";
      } else if (!targets.length) {
        throw new Error(t("err.noexe"));
      } else if (index.needsRename && index.zip64) {
        throw new Error(t("err.zip64"));
      } else if (index.needsRename) {
        const enc = new TextEncoder();
        msg = { op: "rewrite", file: single, id, cd: index.cd,
          entries: index.entries.map((x) => ({ cdPos: x.cdPos, localOffset: x.localOffset, utf8Name: enc.encode(x.name) })) };
        label = "add.renaming";
      } else {
        msg = { op: "copy", file: single, id };
        label = "add.saving";
      }
    } else {
      names = items.map((x) => x.path);
      targets = names.filter((n) => RUNNABLE.test(n) && !isJunkPath(n));
      if (!targets.length) throw new Error(t("err.noexe"));
      kind = single ? { v: KIND_VERSION, code: /\.msi$/i.test(single.name) ? "msi" : "exe", verdict: "ok",
        note: /\.msi$/i.test(single.name) ? "note.msi" : "" } : kindOf(names);
      if (!single && await needsRtp(kind, names, async (re) => {
        const it = items.find((x) => re.test(x.path));
        return it ? new TextDecoder("shift_jis").decode(await it.file.arrayBuffer()) : null;
      })) kind.note = "note.rtp";
      msg = { op: "pack", id, entries: items.map((x) => ({ name: x.path, file: x.file })) };
      label = "add.packing";
    }
    sortTargets(targets);
    const size = await runWorker(msg, (done, total) => {
      st.textContent = t(label, { pct: pctOf(done, total), done: mb(done), total: mb(total) });
    });
    const list = loadMeta();
    list.unshift({ id, title, exes: targets, exe: targets[0], kind, mode: msg.op === "extract" ? "html5" : "wine",
      engine: "jit", resolution: "", bpp: "32", sound: true, japanese: I18N.lang === "ja" || looksJapanese(names, title),
      size, added: Date.now() });
    saveMeta(list);
    st.className = "status ok";
    st.textContent = t("add.done", { name: title });
    renderLibrary();
    return id;
  } catch (err) {
    await removeGameFile(id);
    await removeHtml5(id);
    st.className = "status err";
    st.textContent = t("add.failed", { msg: err.message, free: await storageNote() });
    return null;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function itemsFromFileList(files) {
  return [...files].map((f) => ({ file: f, path: (f.webkitRelativePath || f.name).replace(/^\/+/, "") }));
}
function titleFor(items) {
  if (items.length === 1) return items[0].file.name.replace(/\.(zip|exe|msi)$/i, "");
  const top = items[0].path.split("/")[0];
  return items.every((x) => x.path.split("/")[0] === top) && items[0].path.includes("/") ? top : items[0].file.name.replace(/\.[^.]+$/, "");
}

$("pick").addEventListener("click", () => $("picker").click());
$("pick-folder").addEventListener("click", () => $("folder-picker").click());
for (const id of ["picker", "folder-picker"]) {
  $(id).addEventListener("change", (e) => {
    const items = itemsFromFileList(e.target.files);
    e.target.value = "";
    if (items.length) addItems(items, titleFor(items));
  });
}

// ドラッグ＆ドロップ（ファイル・フォルダ）
async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, path: prefix + entry.name });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const child of batch) await walkEntry(child, prefix + entry.name + "/", out);
    }
  }
}
let dragDepth = 0;
document.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const entries = [...(e.dataTransfer.items || [])].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  let items = [];
  if (entries.length) for (const en of entries) await walkEntry(en, "", items);
  else items = itemsFromFileList(e.dataTransfer.files);
  if (items.length) addItems(items, titleFor(items));
});

// デモ（7-Zip 9.20、LGPL。demo/NOTICE.md）
$("demo").addEventListener("click", async () => {
  const existing = loadMeta().find((g) => g.demo);
  if (existing) return start(existing);
  const blob = await (await fetch("demo/7-zip.zip")).blob();
  const id = await addItems([{ file: new File([blob], "7-Zip.zip", { type: "application/zip" }), path: "7-Zip.zip" }], "7-Zip (demo)");
  if (!id) return;
  updateMeta(id, { demo: true, exe: "7zFM.exe" });
  start(loadMeta().find((g) => g.id === id));
});

// ---------- ライブラリ表示 ----------
function selectField(labelKey, options, value, onChange) {
  const wrap = document.createElement("div");
  const lab = document.createElement("label");
  lab.className = "field";
  lab.textContent = t(labelKey);
  const sel = document.createElement("select");
  for (const [v, l] of options) {
    const o = document.createElement("option");
    o.value = v; o.textContent = l; o.selected = v === value;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  wrap.append(lab, sel);
  return wrap;
}
function button(key, cls, onClick) {
  const b = document.createElement("button");
  if (cls) b.className = cls;
  b.textContent = t(key);
  b.addEventListener("click", onClick);
  return b;
}

function renderLibrary() {
  const root = $("library");
  const list = loadMeta();
  root.innerHTML = "";
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("lib.empty");
    root.appendChild(p);
    return;
  }
  for (const g of list) root.appendChild(renderCard(g));
}

function renderCard(g) {
  const card = document.createElement("div");
  card.className = "card";
  const title = document.createElement("div");
  title.className = "game-title";
  title.textContent = g.title;
  const meta = document.createElement("div");
  meta.className = "game-meta";
  meta.textContent = (g.size / 1048576).toFixed(1) + " MB";
  const kindEl = document.createElement("div");
  const convertBox = document.createElement("div");
  const html5 = g.mode === "html5";
  card.append(title, meta, kindEl, convertBox);

  const showKind = (k) => {
    kindEl.className = "kind kind-" + k.verdict;
    kindEl.textContent = kindText(k);
    if (!html5 && k.html5Root !== undefined && !convertBox.firstChild) convertBox.appendChild(convertControls(g, k));
  };
  if (g.kind && g.kind.v === KIND_VERSION) showKind(g.kind);
  else if (html5) {
    kindEl.className = "kind";
    kindEl.textContent = t("lib.kind", { name: "HTML5" });
  } else {
    kindEl.className = "kind";
    kindEl.textContent = t("lib.kindChecking");
    gameFile(g.id).then(readZipIndex).then((idx) => {
      const k = kindOf(idx.entries.map((x) => x.name));
      updateMeta(g.id, { kind: k });
      showKind(k);
    }).catch(() => { kindEl.textContent = t("lib.kindUnknown"); });
  }

  const row = document.createElement("div");
  row.className = "row";
  row.style.marginTop = "12px";
  if (html5) {
    row.appendChild(button("lib.playHtml5", "primary grow", () => { location.href = "play/" + encodeURIComponent(g.id) + "/index.html"; }));
  } else {
    let target = g.exe;
    const play = button(/\.msi$/i.test(target) ? "lib.install" : "lib.play", "primary grow", () => start(Object.assign({}, current(), { exe: target })));
    const current = () => loadMeta().find((x) => x.id === g.id) || g;
    card.appendChild(selectField("lib.target", g.exes.map((x) => [x, x]), g.exe, (v) => {
      target = v;
      updateMeta(g.id, { exe: v });
      play.textContent = t(/\.msi$/i.test(v) ? "lib.install" : "lib.play");
    }));
    const adv = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = t("lib.advanced");
    adv.appendChild(sum);
    adv.appendChild(selectField("lib.cpu", [["auto", t("lib.cpuAuto")], ["32", t("lib.cpu32")], ["64", t("lib.cpu64")]], g.cpu || "auto", (v) => updateMeta(g.id, { cpu: v })));
    adv.appendChild(selectField("lib.engine", [["jit", t("lib.engineJit")], ["compat", t("lib.engineCompat")]], g.engine, (v) => updateMeta(g.id, { engine: v })));
    adv.appendChild(selectField("lib.resolution", [["", t("lib.auto")], ["640x480", "640x480"], ["800x600", "800x600"], ["1024x768", "1024x768"]], g.resolution, (v) => updateMeta(g.id, { resolution: v })));
    adv.appendChild(selectField("lib.bpp", [["32", "32bit"], ["16", "16bit"], ["8", t("lib.bpp8")]], g.bpp, (v) => updateMeta(g.id, { bpp: v })));
    adv.appendChild(selectField("lib.sound", [["1", t("lib.on")], ["0", t("lib.off")]], g.sound ? "1" : "0", (v) => updateMeta(g.id, { sound: v === "1" })));
    adv.appendChild(selectField("lib.locale", [["1", t("lib.localeJa")], ["0", t("lib.localeEn")]], g.japanese ? "1" : "0", (v) => updateMeta(g.id, { japanese: v === "1" })));
    const desk = button("lib.desktop", "", () => launch(current(), { desktop: true }));
    desk.style.marginTop = "10px";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = t("lib.desktopHint");
    adv.append(desk, hint);
    card.appendChild(adv);
    row.appendChild(play);
  }
  row.appendChild(button("lib.delete", "danger", async () => {
    if (!confirm(t("lib.deleteConfirm", { title: g.title }))) return;
    await removeGameFile(g.id);
    await removeHtml5(g.id);
    saveMeta(loadMeta().filter((x) => x.id !== g.id));
    renderLibrary();
  }));
  card.appendChild(row);
  if (html5) card.appendChild(saveControls(g));
  return card;
}

// Wine 用に追加済みの MV/MZ を、ブラウザで直接遊べる形式へ変換する
function convertControls(g, k) {
  const box = document.createElement("div");
  const st = document.createElement("p");
  st.className = "status";
  const btn = button("lib.convert", "primary", async () => {
    btn.disabled = true;
    try {
      const file = await gameFile(g.id);
      const index = await readZipIndex(file);
      const size = await runWorker(html5Message(file, g.id, index, k.html5Root), (done, total) => {
        st.textContent = t("lib.converting", { pct: pctOf(done, total), done: mb(done), total: mb(total) });
      });
      await removeGameFile(g.id); // Wine 用の ZIP はもう不要
      updateMeta(g.id, { mode: "html5", size });
      renderLibrary();
    } catch (err) {
      await removeHtml5(g.id);
      st.className = "status err";
      st.textContent = t("lib.convertFailed", { msg: err.message, free: await storageNote() });
      btn.disabled = false;
    }
  });
  btn.style.width = "100%";
  btn.style.marginTop = "10px";
  box.append(btn, st);
  return box;
}

// ---------- セーブデータ（RPGツクールMV）の取り込み・書き出し ----------
// MV はブラウザで動くとき localStorage の "RPG File<n>" / "RPG Global" / "RPG Config" にセーブする。
// 値は PC 版の .rpgsave ファイルの中身（LZString.compressToBase64 した JSON）と同じ。
// ゲーム側の localStorage は "exe:<id>:" で名前空間を分けている（sw.js の injectIntoIndex）。
const saveNs = (id) => "exe:" + id + ":";

function mvSaveKey(path) {
  const base = path.split("/").pop().toLowerCase();
  const m = /^file(\d+)\.rpgsave$/.exec(base);
  if (m) return "RPG File" + Number(m[1]);
  if (base === "global.rpgsave") return "RPG Global";
  if (base === "config.rpgsave") return "RPG Config";
  return null;
}

async function collectSaves(files) {
  const found = [];
  let mz = false;
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const idx = await readZipIndex(f);
      for (const e of idx.entries) {
        if (/\.rmmzsave$/i.test(e.name)) mz = true;
        const key = !e.dir && mvSaveKey(e.name);
        if (key) found.push({ key, name: e.name.split("/").pop(), text: new TextDecoder().decode(await zipEntryBytes(f, e)).trim() });
      }
    } else {
      if (/\.rmmzsave$/i.test(f.name)) mz = true;
      const key = mvSaveKey(f.name);
      if (key) found.push({ key, name: f.name, text: (await f.text()).trim() });
    }
  }
  if (!found.length && mz) throw new Error(t("save.mz"));
  return found;
}

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return tbl;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 無圧縮 ZIP を作る（ファイル名は UTF-8）
function makeZip(items) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const it of items) {
    const name = enc.encode(it.name);
    const data = it.bytes;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    parts.push(local.buffer, name, data);
    central.push(cd.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, items.length, true); end.setUint16(10, items.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

function saveControls(g) {
  const box = document.createElement("div");
  box.style.marginTop = "8px";
  const row = document.createElement("div");
  row.className = "row";
  const input = document.createElement("input");
  input.type = "file"; input.multiple = true; input.hidden = true;
  input.accept = ".zip,.rpgsave,application/zip,application/octet-stream";
  const st = document.createElement("p");
  st.className = "status";
  const ns = saveNs(g.id);
  const current = () => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ns + "RPG ")) keys.push(k.slice(ns.length));
    }
    return keys.sort();
  };
  const showCount = () => {
    const n = current().filter((k) => /^RPG File/.test(k)).length;
    st.className = "status";
    st.textContent = n ? t("save.count", { n }) : t("save.none");
  };
  input.addEventListener("change", async () => {
    const files = [...input.files];
    input.value = "";
    if (!files.length) return;
    try {
      const saves = await collectSaves(files);
      if (!saves.length) throw new Error(t("save.notFound"));
      const overwrite = saves.filter((x) => localStorage.getItem(ns + x.key) !== null).map((x) => x.name);
      if (overwrite.length && !confirm(t("save.overwrite", { names: overwrite.join("\n") }))) return;
      for (const x of saves) localStorage.setItem(ns + x.key, x.text);
      showCount();
      st.className = "status ok";
      st.textContent = t("save.imported", { names: saves.map((x) => x.name).join(", ") });
    } catch (err) {
      st.className = "status err";
      st.textContent = t("save.importFailed", { msg: err.message });
    }
  });
  const exp = async () => {
    const keys = current();
    if (!keys.length) { st.className = "status err"; st.textContent = t("save.nothing"); return; }
    const enc = new TextEncoder();
    const items = keys.map((k) => {
      const name = k === "RPG Global" ? "global.rpgsave" : k === "RPG Config" ? "config.rpgsave" : "file" + k.replace("RPG File", "") + ".rpgsave";
      return { name: "save/" + name, bytes: enc.encode(localStorage.getItem(ns + k)) };
    });
    const zip = makeZip(items);
    const fileName = g.title + " save.zip";
    const file = new File([zip], fileName, { type: "application/zip" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zip);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  row.append(button("save.import", "grow", () => input.click()), button("save.export", "grow", exp));
  box.append(row, st, input);
  showCount();
  return box;
}

// ---------- 起動 ----------
// 起動するファイルの CPU 種別（PE ヘッダー）を見て、32bit エンジン / 64bit エンジン / DOS を振り分ける
async function targetInfo(g) {
  try {
    const file = await gameFile(g.id);
    const idx = await readZipIndex(file);
    const e = idx.entries.find((x) => x.name === g.exe);
    if (e && /\.com$/i.test(e.name)) return { arch: "dos" };
    return e && /\.exe$/i.test(e.name) ? await exeInfo(file, e) : { arch: null };
  } catch (err) {
    return { arch: null };
  }
}

async function start(g, opts = {}) {
  if (opts.desktop) return launch(g, opts);
  const want = g.cpu || "auto";
  const info = await targetInfo(g);
  const arch = want === "auto" ? info.arch : want === "64" ? "x64" : "x86";
  if (arch === "os2") return alert(t("err.os2"));
  if (arch === "arm64") return alert(t("err.arm64"));
  if (info.dotnet && !confirm(t("warn.dotnet"))) return;
  if (arch === "x64") {
    location.href = "run64.html?id=" + encodeURIComponent(g.id) + "&exe=" + encodeURIComponent(g.exe);
    return;
  }
  if (arch === "dos" && want === "auto") {
    location.href = "dos.html?id=" + encodeURIComponent(g.id) + "&exe=" + encodeURIComponent(g.exe);
    return;
  }
  launch(g, Object.assign({ console: !!info.console }, opts));
}
function launch(g, opts = {}) {
  const target = g.exe || "";
  const slash = target.lastIndexOf("/");
  const dir = slash >= 0 ? target.slice(0, slash) : "";
  const file = slash >= 0 ? target.slice(slash + 1) : target;
  const params = [
    "app=" + encodeURIComponent(g.id),
    "appBase=" + encodeURIComponent("../../games/"),
    "rootBase=" + encodeURIComponent("../../fs/"),
    "root=boxedwine",
    "w=" + encodeURIComponent(dir ? APP_DIR + "/" + dir : APP_DIR),
    "auto=true",
    "bpp=" + g.bpp,
    "sound=" + (g.sound ? "true" : "false"),
  ];
  if (opts.desktop) params.push("desktop=true");
  else if (/\.msi$/i.test(file)) params.push("p=msiexec", "args=" + encodeURIComponent('/i "' + file + '"'));
  // コンソール（文字だけの）アプリは、そのまま起動すると画面に何も出ないので Wine のコンソール窓で開く
  else if (opts.console) params.push("p=wineconsole", "args=" + encodeURIComponent('"' + file + '"'));
  // バッチファイルも同様に、実行中の表示（echo や pause）が見えるようコンソール窓で開く
  else if (/\.bat$/i.test(file)) params.push("p=wineconsole", "args=" + encodeURIComponent('cmd /c "' + file + '"'));
  else params.push("p=" + encodeURIComponent(file));
  if (g.resolution) params.push("resolution=" + g.resolution);
  // Boxedwine の env 引数は 'KEY:VALUE' をクォートした形式（1 つだけ）。Boxedwine は既定で
  // LC_ALL=en_US.UTF-8 を足すので、LANG ではなく LC_ALL で指定しないと日本語ロケールにならない
  if (g.japanese) params.push("env=%27LC_ALL:ja_JP.UTF-8%27");
  const engine = g.engine === "compat" ? "compat" : "jit";
  location.href = "engine/" + engine + "/boxedwine.html?" + params.join("&");
}

// ---------- バージョン・更新履歴 ----------
let versionInfo = null;
let changes = null;
async function loadVersion() {
  try { versionInfo = await (await fetch("version.json", { cache: "no-store" })).json(); } catch (e) {}
  try { changes = await (await fetch("changes.json", { cache: "no-store" })).json(); } catch (e) {}
  renderVersion();
}
function renderVersion() {
  $("version").textContent = versionInfo ? t("version.label", versionInfo) : t("version.dev");
  if (versionInfo) $("version").title = "#" + versionInfo.build + " (" + versionInfo.sha + ")";
  const root = $("changes");
  root.innerHTML = "";
  for (const entry of changes || []) {
    const h = document.createElement("h3");
    h.textContent = entry.date;
    const ul = document.createElement("ul");
    ul.className = "help";
    for (const item of (I18N.lang === "en" && entry.items_en) || entry.items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    root.append(h, ul);
  }
}

// ---------- 言語切り替え ----------
function renderAll() {
  I18N.apply();
  renderLibrary();
  renderVersion();
  renderEngine();
}
$("lang").addEventListener("click", () => {
  I18N.setLang(I18N.lang === "ja" ? "en" : "ja");
  renderAll();
});

// ---------- 初期化 ----------
(async () => {
  I18N.apply();
  renderLibrary();
  loadVersion();
  await loadFsSize();
  renderEngine();
  try {
    await ensureServiceWorker();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await refreshEngineStatus();
  } catch (err) {
    $("engine-status").textContent = t("engine.initError", { msg: err.message });
    $("engine-status").className = "status err";
  }
})();
