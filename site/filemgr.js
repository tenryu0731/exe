// ファイル管理画面：Wine で動かすソフトのファイルを、パソコンのファイル管理のように見て操作する
//
// 見えるもの：ゲームのフォルダ（追加した ZIP の中身＝元のファイル）と、ソフトが作成・変更したファイル
// （Boxedwine がゲームごとの IndexedDB に保存しているもの。wine-saves.js）を重ねたもの。
// できること：フォルダを開く・戻る、ファイルを保存（端末へ）・置き換え・削除（変更の取り消し）、
// フォルダにファイルを追加・新しいフォルダ・フォルダを ZIP で保存、変更したものだけ表示。
// 元のファイル（ZIP の中身）は書き換えずに、上に重ねた変更として保存する。削除すると元に戻る。
(function () {
  "use strict";

  const L = () => (window.I18N && I18N.lang === "en" ? EN : JA);
  const JA = {
    title: "{title} のファイル", close: "閉じる", up: "上へ", changedOnly: "変更したものだけ表示",
    rootGame: "ゲームのフォルダ", rootUser: "ユーザーのデータ（AppData・ドキュメント）", rootOther: "Windows の設定（レジストリなど・詳しい方向け）", showOther: "Windows の設定も表示（詳しい方向け）",
    stOrig: "元のまま", stChanged: "変更あり", stNew: "新しく作成",
    addHere: "ファイルを追加", addFolderHere: "フォルダを追加", newFolder: "新規フォルダ", zipFolder: "ZIP で保存", top: "トップ",
    save: "端末に保存", replace: "別のファイルで置き換え", revert: "変更を取り消す（元に戻す）", remove: "削除",
    cancel: "キャンセル", empty: "このフォルダは空です", loading: "読み込んでいます…",
    newFolderPrompt: "新しいフォルダの名前", confirmRevert: "「{name}」の変更を取り消して、元のファイルに戻しますか？",
    confirmRemove: "「{name}」を削除しますか？（元に戻せません）", confirmReplace: "「{name}」を、選んだファイルで置き換えますか？",
    confirmAdd: "{n} 個のファイルをこのフォルダに入れます（同じ名前は置き換わります）。よろしいですか？",
    done: "完了しました。次に起動したときから使われます。", failed: "できませんでした: {msg}",
    note: "変更はこの端末のブラウザ内に保存されます。元のファイル（追加したゲームの中身）は変わりません。",
    items: "{n} 項目", path: "場所",
  };
  const EN = {
    title: "Files of {title}", close: "Close", up: "Up", changedOnly: "Show changed only",
    rootGame: "Game folder", rootUser: "User data (AppData, Documents)", rootOther: "Windows settings (registry etc., advanced)", showOther: "Show Windows settings (advanced)",
    stOrig: "original", stChanged: "changed", stNew: "new",
    addHere: "Add files", addFolderHere: "Add folder", newFolder: "New folder", zipFolder: "Save as ZIP", top: "Top",
    save: "Save to device", replace: "Replace with another file", revert: "Undo changes (restore original)", remove: "Delete",
    cancel: "Cancel", empty: "This folder is empty", loading: "Loading…",
    newFolderPrompt: "Name of the new folder", confirmRevert: "Undo the changes to \"{name}\" and restore the original?",
    confirmRemove: "Delete \"{name}\"? (This cannot be undone.)", confirmReplace: "Replace \"{name}\" with the chosen file?",
    confirmAdd: "Put {n} files into this folder (files with the same name are replaced)?",
    done: "Done. It is used from the next start.", failed: "Could not do it: {msg}",
    note: "Changes are stored in this browser on this device. The original files (the game you added) stay as they were.",
    items: "{n} items", path: "Location",
  };
  const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
  const size = (n) => (n < 1024 ? n + " B" : n < 1048576 ? Math.ceil(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");

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

  // パスは書き出し ZIP と同じ形（C/… D/… registry/user.reg）。表示用の「場所」に振り分ける
  function rootOf(name) {
    if (name.startsWith("C/files/")) return { root: "game", rest: name.slice(8) };
    if (name.startsWith("C/users/")) return { root: "user", rest: name.slice(8) };
    return { root: "other", rest: name };
  }
  function nameOf(root, rest) {
    return root === "game" ? "C/files/" + rest : root === "user" ? "C/users/" + rest : rest;
  }

  async function open(g, { gameFile, makeZip, offerFile, onChange }) {
    const W = window.WineSaves;
    const T = L();
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
    el.querySelector(".fm-note").textContent = T.note;
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
    const listEl = el.querySelector(".fm-list");
    const crumbs = el.querySelector(".fm-crumbs");
    const tools = el.querySelector(".fm-tools");
    const status = el.querySelector(".fm-status");
    const say = (msg, err) => { status.textContent = msg; status.className = "fm-status" + (err ? " err" : ""); };
    const closeAll = () => { el.remove(); document.body.style.overflow = ""; if (onChange) onChange(); };
    el.querySelector(".fm-close").addEventListener("click", closeAll);

    let file = null; // ゲームの ZIP（元のファイル）
    let index = null;
    // name -> { name, size, state: "orig" | "changed" | "new", entry（元）, key/drive（変更） }
    let items = new Map();
    let dirs = new Set(); // 変更側で作った空のフォルダ
    let path = []; // [root, ...folders]
    let changedOnly = false;
    // レジストリなど Windows 側の設定は、ふだん触る必要がないので既定では隠す（バックアップには含まれる）
    let showOther = false;

    async function load() {
      listEl.innerHTML = `<div class="fm-loading">${T.loading}</div>`;
      items = new Map();
      if (!file) {
        try { file = await gameFile(g.id); index = await readZipIndex(file); } catch (e) { index = { entries: [] }; }
      }
      for (const e of index.entries) {
        if (e.dir || isJunkPath(e.name)) continue;
        const name = "C/files/" + e.name;
        items.set(name, { name, size: e.size || 0, state: "orig", entry: e });
      }
      for (const f of await W.changedFiles(g.id)) {
        const prev = items.get(f.name);
        items.set(f.name, Object.assign({}, prev || {}, { name: f.name, size: f.size, state: prev ? "changed" : "new", key: f.key, drive: f.drive }));
      }
      dirs = new Set((await W.changedDirs(g.id)).map((d) => d));
      render();
    }

    // 今のフォルダの中身：{ folders: Map(name -> {changed}), files: [...] }
    function children() {
      const folders = new Map();
      const files = [];
      const [root, ...sub] = path;
      const prefix = sub.length ? sub.join("/") + "/" : "";
      const consider = (name, item) => {
        const r = rootOf(name);
        if (r.root !== root || !r.rest.startsWith(prefix)) return;
        const rest = r.rest.slice(prefix.length);
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

    function rootLabel(r) { return r === "game" ? T.rootGame : r === "user" ? T.rootUser : T.rootOther; }

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
        b.textContent = i === 0 ? rootLabel(p) : p;
        b.addEventListener("click", () => { path = path.slice(0, i + 1); render(); });
        crumbs.append(sep, b);
      });
      // ツール
      tools.innerHTML = "";
      if (path.length) {
        tools.append(btn("↑ " + T.up, () => { path.pop(); render(); }));
        if (path[0] !== "other") {
          tools.append(btn("＋ " + T.addHere, () => pickFiles(false)), btn("＋ " + T.addFolderHere, () => pickFiles(true)),
            btn("📁 " + T.newFolder, newFolder), btn("⤓ " + T.zipFolder, zipFolder));
        } else tools.append(btn("⤓ " + T.zipFolder, zipFolder));
      }
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = changedOnly;
      cb.addEventListener("change", () => { changedOnly = cb.checked; render(); });
      lab.append(cb, document.createTextNode(T.changedOnly));
      tools.appendChild(lab);
      if (!path.length) {
        const lab2 = document.createElement("label");
        const cb2 = document.createElement("input");
        cb2.type = "checkbox";
        cb2.checked = showOther;
        cb2.addEventListener("change", () => { showOther = cb2.checked; render(); });
        lab2.append(cb2, document.createTextNode(T.showOther));
        tools.appendChild(lab2);
      }

      listEl.innerHTML = "";
      if (!path.length) {
        // 一番上：場所ごと
        const counts = { game: 0, user: 0, other: 0 };
        const changed = { game: false, user: false, other: false };
        for (const [name, it] of items) {
          if (changedOnly && it.state === "orig") continue;
          const r = rootOf(name).root;
          counts[r]++;
          if (it.state !== "orig") changed[r] = true;
        }
        for (const r of ["game", "user", "other"]) {
          if (r !== "game" && !counts[r]) continue;
          if (r === "other" && !showOther) continue;
          listEl.appendChild(row(r === "game" ? "🎮" : r === "user" ? "👤" : "⚙️", rootLabel(r), fmt(T.items, { n: counts[r] }),
            changed[r] ? "changed" : null, () => { path = [r]; render(); }));
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
        listEl.appendChild(row(iconFor(f.base), f.base, size(f.size), f.state === "orig" ? null : f.state, () => fileSheet(f)));
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

    // ---- ファイル 1 つの操作 ----
    async function bytesOf(it) {
      if (it.state === "orig") return zipEntryBytes(file, it.entry);
      const [one] = await W.readFiles(g.id, [it]);
      return one.bytes;
    }
    function fileSheet(it) {
      const bg = document.createElement("div");
      bg.className = "fm-sheet-bg";
      const sh = document.createElement("div");
      sh.className = "fm-sheet";
      const h = document.createElement("h4");
      h.textContent = it.base;
      const p = document.createElement("p");
      p.textContent = size(it.size) + " · " + (it.state === "orig" ? T.stOrig : it.state === "new" ? T.stNew : T.stChanged) + " · " + T.path + ": " + displayPath();
      const closeSheet = () => bg.remove();
      bg.addEventListener("click", (e) => { if (e.target === bg) closeSheet(); });
      sh.append(h, p, btn("⤓ " + T.save, async () => {
        closeSheet();
        try { await offerFile(new Blob([await bytesOf(it)]), it.base); } catch (e) { say(fmt(T.failed, { msg: e.message }), true); }
      }, "fm-primary"));
      if (path[0] !== "other" || it.name === "registry/user.reg") {
        sh.append(btn("⇄ " + T.replace, () => {
          closeSheet();
          pick(false, false, async (files) => {
            if (!files.length || !confirm(fmt(T.confirmReplace, { name: it.base }))) return;
            await apply(async () => W.writeFiles(g.id, [Object.assign({ bytes: new Uint8Array(await files[0].arrayBuffer()) }, W.importKey(it.name))]));
          });
        }));
      }
      if (it.state === "changed") {
        sh.append(btn("↺ " + T.revert, async () => {
          closeSheet();
          if (confirm(fmt(T.confirmRevert, { name: it.base }))) await apply(() => W.deleteFiles(g.id, [it]));
        }));
      } else if (it.state === "new") {
        sh.append(btn("🗑 " + T.remove, async () => {
          closeSheet();
          if (confirm(fmt(T.confirmRemove, { name: it.base }))) await apply(() => W.deleteFiles(g.id, [it]));
        }, "fm-danger"));
      }
      sh.append(btn(T.cancel, closeSheet));
      bg.appendChild(sh);
      el.appendChild(bg);
    }
    function displayPath() {
      const [root, ...sub] = path;
      return [rootLabel(root)].concat(sub).join(" › ");
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
    function folderName(base) {
      const [root, ...sub] = path;
      return nameOf(root, sub.concat(base ? [base] : []).join("/"));
    }
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
            out.push(Object.assign({ bytes: new Uint8Array(await f.arrayBuffer()) }, W.importKey(folderName(rel))));
          }
          await W.writeFiles(g.id, out);
        });
      });
    }
    async function newFolder() {
      const name = (prompt(T.newFolderPrompt) || "").trim().replace(/[\\/:*?"<>|]/g, "_");
      if (!name) return;
      await apply(() => W.makeDir(g.id, W.importKey(folderName(name) + "/x")));
    }
    async function zipFolder() {
      const [root, ...sub] = path;
      const prefix = nameOf(root, sub.length ? sub.join("/") + "/" : "");
      const out = [];
      try {
        for (const [name, it] of items) {
          if (!name.startsWith(prefix) || (changedOnly && it.state === "orig")) continue;
          out.push({ name: name.slice(prefix.length), bytes: await bytesOf(it) });
        }
        if (!out.length) return say(T.empty, true);
        const base = sub.length ? sub[sub.length - 1] : rootLabel(root);
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
