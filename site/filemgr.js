// ファイル管理画面：ゲームのファイルを、パソコンのファイル管理のように見て操作する
//
// 中身の読み書きは「バックエンド」に任せ、画面は共通。項目名は "<場所>/<場所の中のパス>"。
//  - Wine で動かすゲーム（wineBackend）: 追加した ZIP の中身（元のファイル）に、ソフトが作成・変更したファイル
//    （Boxedwine がゲームごとの IndexedDB に保存しているもの。wine-saves.js）を重ねて見せる。
//    元のファイルは書き換えず、上に重ねた変更として保存する。変更を消すと元に戻る。
//  - ブラウザで直接動くゲーム（html5Backend）: 展開済みのファイル（Cache Storage）と、
//    ゲームが localStorage に保存したセーブ。どちらも直接書き換える（元に戻す手段はない）。
(function () {
  "use strict";

  const L = () => (window.I18N && I18N.lang === "en" ? EN : JA);
  const JA = {
    title: "{title} のファイル", close: "閉じる", up: "上へ", changedOnly: "変更分のみ表示",
    rootGame: "ゲームのフォルダ", rootUser: "ユーザーデータ（AppData・ドキュメント）", rootOther: "Windows 設定（レジストリなど）", showOther: "Windows 設定も表示",
    rootSave: "セーブデータ",
    stOrig: "元のまま", stChanged: "変更あり", stNew: "新しく作成",
    addHere: "ファイルを追加", addFolderHere: "フォルダを追加", newFolder: "新規フォルダ", zipFolder: "ZIP で保存", top: "トップ",
    save: "端末に保存", replace: "別のファイルで置き換え", revert: "変更を取り消す", remove: "削除",
    cancel: "キャンセル", empty: "このフォルダは空です", loading: "読み込み中…",
    newFolderPrompt: "新しいフォルダの名前", confirmRevert: "「{name}」の変更を取り消して、元のファイルに戻しますか？",
    confirmRemove: "「{name}」を削除しますか？（元に戻せません）", confirmReplace: "「{name}」を、選んだファイルで置き換えますか？",
    confirmAdd: "{n} 個のファイルをこのフォルダに追加します（同名のファイルは上書きされます）。",
    done: "完了しました。次回の起動から反映されます。", failed: "失敗しました: {msg}",
    note: "変更はブラウザ内に保存されます。追加したゲームの元ファイルは変更されません。",
    noteHtml5: "変更はそのまま反映され、元に戻せません。セーブはブラウザ内（localStorage）に保存されています。",
    badSave: "セーブデータとして扱えないファイルです: {name}（ツクール MV は file1.rpgsave・global.rpgsave・config.rpgsave）",
    items: "{n} 項目", path: "場所",
  };
  const EN = {
    title: "Files of {title}", close: "Close", up: "Up", changedOnly: "Show changed only",
    rootGame: "Game folder", rootUser: "User data (AppData, Documents)", rootOther: "Windows settings (registry etc.)", showOther: "Show Windows settings",
    rootSave: "Save data",
    stOrig: "original", stChanged: "changed", stNew: "new",
    addHere: "Add files", addFolderHere: "Add folder", newFolder: "New folder", zipFolder: "Save as ZIP", top: "Top",
    save: "Save to device", replace: "Replace with another file", revert: "Undo changes", remove: "Delete",
    cancel: "Cancel", empty: "This folder is empty", loading: "Loading…",
    newFolderPrompt: "Name of the new folder", confirmRevert: "Undo the changes to \"{name}\" and restore the original?",
    confirmRemove: "Delete \"{name}\"? (This cannot be undone.)", confirmReplace: "Replace \"{name}\" with the chosen file?",
    confirmAdd: "Add {n} files to this folder (files with the same name are overwritten)?",
    done: "Done. Takes effect on the next run.", failed: "Failed: {msg}",
    note: "Changes are stored in the browser. The original game files are not modified.",
    noteHtml5: "Changes apply directly and cannot be undone. Saves are stored in the browser (localStorage).",
    badSave: "Not usable as save data: {name} (RPG Maker MV uses file1.rpgsave, global.rpgsave, config.rpgsave)",
    items: "{n} items", path: "Location",
  };
  const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
  const size = (n) => (n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.ceil(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");
  const split = (name) => { const i = name.indexOf("/"); return { root: name.slice(0, i), rest: name.slice(i + 1) }; };

  const CSS = `
  .fm { position: fixed; inset: 0; z-index: 100; background: var(--bg, #f7f7f5); color: var(--text, #1b1c1e); display: flex; flex-direction: column;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left); font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  .fm button { font: inherit; color: inherit; }
  .fm-top { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border, #d6d6d1); background: var(--surface, #fff); }
  .fm-top h3 { flex: 1; margin: 0; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fm-btn { border: 1px solid var(--border, #d6d6d1); background: var(--surface, #fff); border-radius: 6px; padding: 6px 10px; min-height: 36px; cursor: pointer; white-space: nowrap; }
  .fm-tools .fm-btn { font-size: 13.5px; min-height: 34px; padding: 4px 9px; }
  .fm-btn:hover { background: var(--sunken, #efefec); }
  .fm-btn.fm-primary { background: var(--accent, #0b57d0); border-color: var(--accent, #0b57d0); color: var(--accent-text, #fff); }
  .fm-bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--rule, #e3e3de); background: var(--surface, #fff); flex-wrap: wrap; }
  .fm-crumbs { flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font-size: 14px; min-width: 0; }
  .fm-crumbs button { border: 0; background: none; padding: 4px 6px; border-radius: 4px; color: var(--accent, #0b57d0); cursor: pointer; max-width: 14em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fm-crumbs button:last-child { color: var(--text, #1b1c1e); font-weight: 600; }
  .fm-crumbs span { color: var(--faint, #63676d); }
  .fm-tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .fm-tools label { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--muted, #4a4d52); margin-left: 4px; }
  .fm-list { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }
  .fm-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border: 0; border-bottom: 1px solid var(--rule, #e3e3de);
    background: var(--surface, #fff); text-align: left; cursor: pointer; min-height: 52px; }
  .fm-row:hover { background: var(--sunken, #efefec); }
  .fm-icon { width: 28px; flex: 0 0 28px; text-align: center; font-size: 20px; }
  .fm-name { flex: 1; min-width: 0; word-break: break-all; }
  .fm-meta { flex: 0 0 auto; text-align: right; font-size: 12.5px; color: var(--faint, #63676d); }
  .fm-badge { display: inline-block; font-size: 11.5px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; vertical-align: 1px; }
  .fm-b-changed { background: #fff1c2; color: #6b4b00; }
  .fm-b-new { background: #d9f2df; color: #146c2e; }
  .fm-empty, .fm-loading { padding: 24px 14px; color: var(--faint, #63676d); }
  .fm-foot { padding: 8px 12px max(8px, env(safe-area-inset-bottom)); border-top: 1px solid var(--border, #d6d6d1); background: var(--surface, #fff);
    font-size: 12.5px; color: var(--faint, #63676d); }
  .fm-status { min-height: 1.2em; margin: 0 0 4px; font-size: 13.5px; color: var(--ok, #146c2e); }
  .fm-status.err { color: var(--danger, #b3261e); }
  .fm-sheet-bg { position: fixed; inset: 0; z-index: 110; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; justify-content: center; }
  .fm-sheet { width: min(560px, 100%); background: var(--surface, #fff); color: var(--text, #1b1c1e); border-radius: 12px 12px 0 0;
    padding: 14px 14px max(14px, env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; }
  .fm-sheet h4 { margin: 0; font-size: 16px; word-break: break-all; }
  .fm-sheet p { margin: 0 0 4px; font-size: 13px; color: var(--faint, #63676d); word-break: break-all; }
  .fm-sheet .fm-btn { width: 100%; min-height: 46px; text-align: center; }
  .fm-sheet .fm-danger { color: var(--danger, #b3261e); }
  `;

  // ---------- Wine で動かすゲーム ----------
  // wine-saves.js の名前（C/files/… C/users/… registry/user.reg など）と、画面の名前（game/… user/… other/…）の変換
  function wineBackend(g, gameFile, T) {
    const W = window.WineSaves;
    const toFm = (n) => (n.startsWith("C/files/") ? "game/" + n.slice(8) : n.startsWith("C/users/") ? "user/" + n.slice(8) : "other/" + n);
    const toW = (n) => {
      const { root, rest } = split(n);
      return root === "game" ? "C/files/" + rest : root === "user" ? "C/users/" + rest : rest;
    };
    const target = (name) => {
      const k = W.importKey(toW(name));
      if (!k) throw new Error(name);
      return k;
    };
    let file = null;
    let index = null;
    return {
      // optional: 既定では隠す（レジストリなど、ふだん触る必要がない。ZIP での保存には含まれる）
      roots: [
        { id: "game", icon: "🎮", label: T.rootGame, always: true },
        { id: "user", icon: "👤", label: T.rootUser },
        { id: "other", icon: "⚙️", label: T.rootOther, optional: true, readOnly: true },
      ],
      note: T.note,
      tracksChanges: true,
      async load() {
        if (!file) {
          try { file = await gameFile(g.id); index = await readZipIndex(file); } catch (e) { index = { entries: [] }; }
        }
        const items = new Map();
        for (const e of index.entries) {
          if (e.dir || isJunkPath(e.name)) continue;
          const name = "game/" + e.name;
          items.set(name, { name, size: e.size || 0, state: "orig", entry: e });
        }
        for (const f of await W.changedFiles(g.id)) {
          const name = toFm(f.name);
          const prev = items.get(name);
          items.set(name, Object.assign({}, prev || {}, { name, size: f.size, state: prev ? "changed" : "new", w: f }));
        }
        return { items, dirs: new Set((await W.changedDirs(g.id)).map(toFm)) };
      },
      async read(it) {
        if (it.state === "orig") return zipEntryBytes(file, it.entry);
        const [one] = await W.readFiles(g.id, [it.w]);
        return one.bytes;
      },
      write: (list) => W.writeFiles(g.id, list.map((x) => Object.assign({ bytes: x.bytes }, target(x.name)))),
      mkdir: (name) => W.makeDir(g.id, target(name + "/x")),
      canReplace: (it) => split(it.name).root !== "other" || it.name === "other/registry/user.reg",
      canRevert: (it) => it.state === "changed",
      canRemove: (it) => it.state === "new",
      remove: (it) => W.deleteFiles(g.id, [it.w]),
    };
  }

  // ---------- ブラウザで直接動くゲーム（RPGツクールMV/MZ など） ----------
  // ファイルは Cache Storage の play/<id>/<パス>（一覧は .exe-index.json）、セーブは localStorage の "exe:<id>:<キー>"
  const MIME = {
    html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
    css: "text/css; charset=utf-8", txt: "text/plain; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg",
    wav: "audio/wav", webm: "video/webm", mp4: "video/mp4", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    wasm: "application/wasm",
  };
  function html5Backend(g, { cacheName, ns }, T) {
    const base = new URL("play/" + encodeURIComponent(g.id) + "/", location.href).href;
    const url = (rel) => base + rel.split("/").map(encodeURIComponent).join("/");
    const indexUrl = base + ".exe-index.json";
    const madeDirs = new Set(); // キャッシュにはフォルダが無いので、作ったフォルダはこの画面の間だけ覚えておく
    // localStorage のキー ⇔ ファイル名（ツクール MV は PC 版の .rpgsave と同じ名前にする）
    const keyToName = (k) => {
      const m = /^RPG File(\d+)$/.exec(k);
      return m ? "file" + m[1] + ".rpgsave" : k === "RPG Global" ? "global.rpgsave" : k === "RPG Config" ? "config.rpgsave" : k.replace(/\//g, "%2F");
    };
    const nameToKey = (n) => {
      const m = /^file(\d+)\.rpgsave$/i.exec(n);
      if (m) return "RPG File" + Number(m[1]);
      if (/^global\.rpgsave$/i.test(n)) return "RPG Global";
      if (/^config\.rpgsave$/i.test(n)) return "RPG Config";
      const k = n.replace(/%2F/g, "/");
      return localStorage.getItem(ns + k) !== null ? k : null; // それ以外は、既にあるキーの置き換えだけ
    };
    const cache = () => caches.open(cacheName);
    const readIndex = async (c) => { const r = await c.match(indexUrl); return r ? r.json() : {}; };
    const writeIndex = async (c, idx) => {
      await c.put(indexUrl, new Response(JSON.stringify(idx), { headers: { "Content-Type": "application/json" } }));
      // sw.js が覚えている一覧を捨てさせる
      const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (sw) sw.postMessage({ type: "html5-index-changed", id: g.id });
    };
    return {
      roots: [
        { id: "game", icon: "🎮", label: T.rootGame, always: true },
        { id: "save", icon: "💾", label: T.rootSave, always: true, flat: true },
      ],
      note: T.noteHtml5,
      tracksChanges: false,
      async load() {
        const items = new Map();
        for (const rel of Object.values(await readIndex(await cache()))) {
          items.set("game/" + rel, { name: "game/" + rel, size: null, state: "orig", rel });
        }
        for (const k of Object.keys(localStorage)) {
          if (!k.startsWith(ns)) continue;
          const key = k.slice(ns.length);
          const name = "save/" + keyToName(key);
          items.set(name, { name, size: new Blob([localStorage.getItem(k) || ""]).size, state: "orig", key });
        }
        return { items, dirs: new Set(madeDirs) };
      },
      async sizeOf(it) {
        const r = await (await cache()).match(url(it.rel));
        if (!r) return null;
        const len = r.headers.get("Content-Length");
        return len ? Number(len) : (await r.blob()).size;
      },
      async read(it) {
        if (it.key !== undefined) return new TextEncoder().encode(localStorage.getItem(ns + it.key) || "");
        const r = await (await cache()).match(url(it.rel));
        if (!r) throw new Error("not found");
        return new Uint8Array(await r.arrayBuffer());
      },
      async write(list) {
        const saves = list.filter((x) => split(x.name).root === "save");
        for (const x of saves) {
          const base = split(x.name).rest;
          if (base.includes("/") || !nameToKey(base)) throw new Error(fmt(T.badSave, { name: base }));
        }
        for (const x of saves) {
          localStorage.setItem(ns + nameToKey(split(x.name).rest), new TextDecoder().decode(x.bytes).trim());
        }
        const files = list.filter((x) => split(x.name).root === "game");
        if (!files.length) return;
        const c = await cache();
        const idx = await readIndex(c);
        for (const x of files) {
          const rel = split(x.name).rest.normalize("NFC");
          const ext = (/\.([a-z0-9]+)$/i.exec(rel) || [])[1];
          await c.put(url(rel), new Response(new Blob([x.bytes]), {
            headers: { "Content-Type": MIME[(ext || "").toLowerCase()] || "application/octet-stream", "Content-Length": String(x.bytes.length) },
          }));
          idx[rel.toLowerCase()] = rel;
        }
        await writeIndex(c, idx);
      },
      async mkdir(name) { madeDirs.add(name); },
      canReplace: () => true,
      canRevert: () => false,
      canRemove: () => true,
      async remove(it) {
        if (it.key !== undefined) { localStorage.removeItem(ns + it.key); return; }
        const c = await cache();
        await c.delete(url(it.rel));
        const idx = await readIndex(c);
        if (idx[it.rel.toLowerCase()] === it.rel) delete idx[it.rel.toLowerCase()];
        await writeIndex(c, idx);
      },
    };
  }

  // ---------- 画面 ----------
  async function open(g, { gameFile, makeZip, offerFile, onChange, html5 }) {
    const T = L();
    const B = g.mode === "html5" ? html5Backend(g, html5, T) : wineBackend(g, gameFile, T);
    if (!document.getElementById("fm-style")) {
      const st = document.createElement("style");
      st.id = "fm-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement("div");
    el.className = "fm";
    el.setAttribute("role", "dialog");
    el.innerHTML = `<div class="fm-top"><h3></h3><button class="fm-btn fm-close"></button></div>
      <div class="fm-bar"><div class="fm-crumbs"></div><div class="fm-tools"></div></div>
      <div class="fm-list"></div>
      <div class="fm-foot"><p class="fm-status"></p><div class="fm-note"></div></div>`;
    el.querySelector("h3").textContent = fmt(T.title, { title: g.title });
    el.querySelector(".fm-close").textContent = "✕ " + T.close;
    el.querySelector(".fm-note").textContent = B.note;
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
    const listEl = el.querySelector(".fm-list");
    const crumbs = el.querySelector(".fm-crumbs");
    const tools = el.querySelector(".fm-tools");
    const status = el.querySelector(".fm-status");
    const say = (msg, err) => { status.textContent = msg; status.className = "fm-status" + (err ? " err" : ""); };
    const closeAll = () => { el.remove(); document.body.style.overflow = ""; if (onChange) onChange(); };
    el.querySelector(".fm-close").addEventListener("click", closeAll);

    // name -> { name, size, state: "orig" | "changed" | "new", ...バックエンドの情報 }
    let items = new Map();
    let dirs = new Set(); // 空のフォルダ（"<場所>/<パス>"）
    let path = []; // [root, ...folders]
    let changedOnly = false;
    let showOther = false;
    const rootInfo = (id) => B.roots.find((r) => r.id === id) || {};

    async function load() {
      listEl.innerHTML = `<div class="fm-loading">${T.loading}</div>`;
      try {
        ({ items, dirs } = await B.load());
      } catch (e) {
        say(fmt(T.failed, { msg: e.message }), true);
      }
      render();
    }

    // 今のフォルダの中身：{ folders: Map(name -> {changed, count}), files: [...] }
    function children() {
      const folders = new Map();
      const files = [];
      const prefix = path.join("/") + "/";
      const consider = (name, item) => {
        if (!name.startsWith(prefix)) return;
        const rest = name.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash >= 0) {
          const fname = rest.slice(0, slash);
          const f = folders.get(fname) || { changed: false, count: 0 };
          if (item && item.state !== "orig") f.changed = true;
          if (item) f.count++;
          folders.set(fname, f);
        } else if (item && rest) files.push(Object.assign({ base: rest }, item));
      };
      for (const [name, item] of items) {
        if (changedOnly && item.state === "orig") continue;
        consider(name, item);
      }
      // 空のフォルダも出す（Boxedwine はゲームのフォルダ構成を先に作るので、変更だけ表示のときは出さない）
      if (!changedOnly) for (const d of dirs) consider(d + "/", null);
      return { folders, files: files.sort((a, b) => a.base.localeCompare(b.base)) };
    }

    function render() {
      // パンくず
      crumbs.innerHTML = "";
      const home = document.createElement("button");
      home.textContent = "🏠 " + T.top;
      home.addEventListener("click", () => { path = []; render(); });
      crumbs.appendChild(home);
      path.forEach((p, i) => {
        const sep = document.createElement("span");
        sep.textContent = "›";
        const b = document.createElement("button");
        b.textContent = i === 0 ? rootInfo(p).label : p;
        b.addEventListener("click", () => { path = path.slice(0, i + 1); render(); });
        crumbs.append(sep, b);
      });
      // ツール
      tools.innerHTML = "";
      if (path.length) {
        const r = rootInfo(path[0]);
        tools.append(btn("↑ " + T.up, () => { path.pop(); render(); }));
        if (!r.readOnly) tools.append(btn("＋ " + T.addHere, () => pickFiles(false)));
        if (!r.readOnly && !r.flat) tools.append(btn("＋ " + T.addFolderHere, () => pickFiles(true)), btn("📁 " + T.newFolder, newFolder));
        tools.append(btn("⤓ " + T.zipFolder, zipFolder));
      }
      if (B.tracksChanges) tools.appendChild(check(T.changedOnly, changedOnly, (v) => { changedOnly = v; }));
      if (!path.length && B.roots.some((r) => r.optional)) tools.appendChild(check(T.showOther, showOther, (v) => { showOther = v; }));

      listEl.innerHTML = "";
      if (!path.length) {
        // 一番上：場所ごと
        for (const r of B.roots) {
          let n = 0;
          let changed = false;
          for (const [name, it] of items) {
            if (!name.startsWith(r.id + "/") || (changedOnly && it.state === "orig")) continue;
            n++;
            if (it.state !== "orig") changed = true;
          }
          if ((!r.always && !n) || (r.optional && !showOther)) continue;
          listEl.appendChild(row(r.icon, r.label, fmt(T.items, { n }), changed ? "changed" : null, () => { path = [r.id]; render(); }));
        }
        return;
      }
      const { folders, files } = children();
      if (!folders.size && !files.length) {
        listEl.innerHTML = `<div class="fm-empty">${T.empty}</div>`;
        return;
      }
      for (const [name, f] of [...folders].sort((a, b) => a[0].localeCompare(b[0]))) {
        listEl.appendChild(row("📁", name, fmt(T.items, { n: f.count }), f.changed ? "changed" : null, () => { path = path.concat(name); render(); }));
      }
      for (const f of files) {
        const r = row(iconFor(f.base), f.base, size(f.size), f.state === "orig" ? null : f.state, () => fileSheet(f));
        listEl.appendChild(r);
        // 大きさを後から調べるバックエンド（展開済みのファイルは数が多いので、表示したものだけ）
        if (f.size == null && B.sizeOf) {
          B.sizeOf(f).then((n) => {
            const it = items.get(f.name);
            if (it) it.size = n;
            f.size = n;
            r.querySelector(".fm-meta").textContent = size(n);
          }).catch(() => {});
        }
      }
    }

    function iconFor(name) {
      if (/\.(exe|com|bat|msi)$/i.test(name)) return "⚙️";
      if (/\.(png|jpe?g|bmp|gif|webp)$/i.test(name)) return "🖼️";
      if (/\.(ogg|mp3|wav|mid|m4a)$/i.test(name)) return "🎵";
      if (/\.(txt|ini|cfg|log|json|xml)$/i.test(name)) return "📝";
      if (/(save|sav|dat|rvdata2?|rxdata|lsd)/i.test(name)) return "💾";
      return "📄";
    }
    function badge(state) {
      if (!state) return "";
      return `<span class="fm-badge fm-b-${state}">${state === "new" ? T.stNew : T.stChanged}</span>`;
    }
    function row(icon, name, meta, state, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fm-row";
      b.innerHTML = `<span class="fm-icon"></span><span class="fm-name"></span><span class="fm-meta"></span>`;
      b.querySelector(".fm-icon").textContent = icon;
      b.querySelector(".fm-name").textContent = name;
      b.querySelector(".fm-name").insertAdjacentHTML("beforeend", badge(state));
      b.querySelector(".fm-meta").textContent = meta;
      b.addEventListener("click", onClick);
      return b;
    }
    function btn(label, onClick, cls) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fm-btn" + (cls ? " " + cls : "");
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    }
    function check(label, value, set) {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = value;
      cb.addEventListener("change", () => { set(cb.checked); render(); });
      lab.append(cb, document.createTextNode(label));
      return lab;
    }

    // ---- ファイル 1 つの操作 ----
    function fileSheet(it) {
      const bg = document.createElement("div");
      bg.className = "fm-sheet-bg";
      const sh = document.createElement("div");
      sh.className = "fm-sheet";
      const h = document.createElement("h4");
      h.textContent = it.base;
      const p = document.createElement("p");
      const state = B.tracksChanges ? (it.state === "orig" ? T.stOrig : it.state === "new" ? T.stNew : T.stChanged) + " · " : "";
      p.textContent = (it.size == null ? "" : size(it.size) + " · ") + state + T.path + ": " + displayPath();
      const closeSheet = () => bg.remove();
      bg.addEventListener("click", (e) => { if (e.target === bg) closeSheet(); });
      sh.append(h, p, btn("⤓ " + T.save, async () => {
        closeSheet();
        try { await offerFile(new Blob([await B.read(it)]), it.base); } catch (e) { say(fmt(T.failed, { msg: e.message }), true); }
      }, "fm-primary"));
      if (B.canReplace(it)) {
        sh.append(btn("⇄ " + T.replace, () => {
          closeSheet();
          pick(false, false, async (files) => {
            if (!files.length || !confirm(fmt(T.confirmReplace, { name: it.base }))) return;
            await apply(async () => B.write([{ name: it.name, bytes: new Uint8Array(await files[0].arrayBuffer()) }]));
          });
        }));
      }
      if (B.canRevert(it)) {
        sh.append(btn("↺ " + T.revert, async () => {
          closeSheet();
          if (confirm(fmt(T.confirmRevert, { name: it.base }))) await apply(() => B.remove(it));
        }));
      } else if (B.canRemove(it)) {
        sh.append(btn("🗑 " + T.remove, async () => {
          closeSheet();
          if (confirm(fmt(T.confirmRemove, { name: it.base }))) await apply(() => B.remove(it));
        }, "fm-danger"));
      }
      sh.append(btn(T.cancel, closeSheet));
      bg.appendChild(sh);
      el.appendChild(bg);
    }
    function displayPath() {
      const [root, ...sub] = path;
      return [rootInfo(root).label].concat(sub).join(" › ");
    }

    async function apply(fn) {
      try {
        await fn();
        await load();
        say(T.done);
      } catch (e) {
        say(fmt(T.failed, { msg: e.message }), true);
      }
    }

    // ---- フォルダの操作 ----
    const here = (rel) => path.join("/") + "/" + rel;
    function pick(multiple, folder, then) {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = multiple;
      if (folder) input.webkitdirectory = true;
      input.addEventListener("change", () => then([...input.files]));
      input.click();
    }
    function pickFiles(folder) {
      pick(true, folder, async (files) => {
        if (!files.length || !confirm(fmt(T.confirmAdd, { n: files.length }))) return;
        await apply(async () => {
          const out = [];
          for (const f of files) {
            const rel = folder && f.webkitRelativePath ? f.webkitRelativePath : f.name;
            out.push({ name: here(rel), bytes: new Uint8Array(await f.arrayBuffer()) });
          }
          await B.write(out);
        });
      });
    }
    async function newFolder() {
      const name = (prompt(T.newFolderPrompt) || "").trim().replace(/[\\/:*?"<>|]/g, "_");
      if (!name) return;
      await apply(() => B.mkdir(here(name)));
    }
    async function zipFolder() {
      const prefix = path.join("/") + "/";
      const out = [];
      try {
        for (const [name, it] of items) {
          if (!name.startsWith(prefix) || (changedOnly && it.state === "orig")) continue;
          out.push({ name: name.slice(prefix.length), bytes: await B.read(it) });
        }
        if (!out.length) return say(T.empty, true);
        const base = path.length > 1 ? path[path.length - 1] : rootInfo(path[0]).label;
        await offerFile(makeZip(out), g.title + " - " + base + ".zip");
      } catch (e) {
        say(fmt(T.failed, { msg: e.message }), true);
      }
    }

    await load();
    // ゲームのフォルダから始める
    path = ["game"];
    render();
  }

  window.FileManager = { open };
})();
