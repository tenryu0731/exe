// 画面上のキーボード（エミュレーター画面・DOS 画面で共用）
//
//  - よく使うキー：画面下に常に出す数個のキー。「編集」でゲームごとに追加・削除・ドラッグで並べ替え・大きさの変更ができる（端末内に保存）
//  - 全キー：F1〜F12・英数字・記号・矢印・Ins/Del/Home/End/PgUp/PgDn・テンキーまで、PC のキーボード一式
//  - Shift・Ctrl・Alt・Win：軽くタップすると「次のキー 1 回だけ」押した状態になり、長押しするとその間押しっぱなし
//  - 全画面：上部のバーなどを隠してゲーム画面を最大にする。対応ブラウザでは本当の全画面にもする
//
// 使い方：VKeys.mount({ parent, send(def, down), storageId, lang })。def は KEYS の要素
//   { id, label, key, code, keyCode }。DOS 画面は keyCode から DOSBox のキー番号に変換して使う。
(function () {
  "use strict";

  const K = (id, label, key, code, keyCode) => ({ id, label, key, code, keyCode });
  const KEYS = [];
  const add = (...a) => { const d = K(...a); KEYS.push(d); return d; };

  // ---- キーの定義 ----
  add("Escape", "Esc", "Escape", "Escape", 27);
  for (let i = 1; i <= 12; i++) add("F" + i, "F" + i, "F" + i, "F" + i, 111 + i);
  add("Backquote", "`", "`", "Backquote", 192);
  for (let i = 1; i <= 10; i++) { const n = String(i % 10); add("Digit" + n, n, n, "Digit" + n, 48 + (i % 10)); }
  add("Minus", "-", "-", "Minus", 189);
  add("Equal", "=", "=", "Equal", 187);
  add("Backspace", "BS", "Backspace", "Backspace", 8);
  add("Tab", "Tab", "Tab", "Tab", 9);
  for (const ch of "QWERTYUIOPASDFGHJKLZXCVBNM") add("Key" + ch, ch, ch.toLowerCase(), "Key" + ch, ch.charCodeAt(0));
  add("BracketLeft", "[", "[", "BracketLeft", 219);
  add("BracketRight", "]", "]", "BracketRight", 221);
  add("Backslash", "\\", "\\", "Backslash", 220);
  add("CapsLock", "Caps", "CapsLock", "CapsLock", 20);
  add("Semicolon", ";", ";", "Semicolon", 186);
  add("Quote", "'", "'", "Quote", 222);
  add("Enter", "Enter", "Enter", "Enter", 13);
  add("ShiftLeft", "Shift", "Shift", "ShiftLeft", 16);
  add("Comma", ",", ",", "Comma", 188);
  add("Period", ".", ".", "Period", 190);
  add("Slash", "/", "/", "Slash", 191);
  add("ControlLeft", "Ctrl", "Control", "ControlLeft", 17);
  add("MetaLeft", "Win", "Meta", "MetaLeft", 91);
  add("AltLeft", "Alt", "Alt", "AltLeft", 18);
  add("Space", "Space", " ", "Space", 32);
  add("Insert", "Ins", "Insert", "Insert", 45);
  add("Delete", "Del", "Delete", "Delete", 46);
  add("Home", "Home", "Home", "Home", 36);
  add("End", "End", "End", "End", 35);
  add("PageUp", "PgUp", "PageUp", "PageUp", 33);
  add("PageDown", "PgDn", "PageDown", "PageDown", 34);
  add("ArrowUp", "↑", "ArrowUp", "ArrowUp", 38);
  add("ArrowLeft", "←", "ArrowLeft", "ArrowLeft", 37);
  add("ArrowDown", "↓", "ArrowDown", "ArrowDown", 40);
  add("ArrowRight", "→", "ArrowRight", "ArrowRight", 39);
  add("NumLock", "Num", "NumLock", "NumLock", 144);
  add("NumpadDivide", "/", "/", "NumpadDivide", 111);
  add("NumpadMultiply", "*", "*", "NumpadMultiply", 106);
  add("NumpadSubtract", "-", "-", "NumpadSubtract", 109);
  add("NumpadAdd", "+", "+", "NumpadAdd", 107);
  add("NumpadEnter", "Ent", "Enter", "NumpadEnter", 13);
  add("NumpadDecimal", ".", ".", "NumpadDecimal", 110);
  for (let i = 0; i <= 9; i++) add("Numpad" + i, String(i), String(i), "Numpad" + i, 96 + i);
  const BY_ID = new Map(KEYS.map((d) => [d.id, d]));
  const MODIFIERS = new Set(["ShiftLeft", "ControlLeft", "AltLeft", "MetaLeft"]);

  // 全キーの並び（"" は空き）。各行の幅をそろえるため flex で伸ばす
  const MAIN_ROWS = [
    ["Escape", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"],
    ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "Backspace"],
    ["Tab", "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", "Backslash"],
    ["CapsLock", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Enter"],
    ["ShiftLeft", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", "ArrowUp"],
    ["ControlLeft", "MetaLeft", "AltLeft", "Space", "ArrowLeft", "ArrowDown", "ArrowRight"],
  ];
  const NAV_ROWS = [
    ["Insert", "Home", "PageUp", "", "NumLock", "NumpadDivide", "NumpadMultiply", "NumpadSubtract"],
    ["Delete", "End", "PageDown", "", "Numpad7", "Numpad8", "Numpad9", "NumpadAdd"],
    ["", "ArrowUp", "", "", "Numpad4", "Numpad5", "Numpad6", "NumpadEnter"],
    ["ArrowLeft", "ArrowDown", "ArrowRight", "", "Numpad1", "Numpad2", "Numpad3", "NumpadDecimal"],
    ["", "", "", "", "Numpad0", "", "", ""],
  ];
  const WIDE = { Backspace: 1.6, Tab: 1.4, CapsLock: 1.6, Enter: 1.8, ShiftLeft: 2, Space: 5, ControlLeft: 1.3, AltLeft: 1.3, MetaLeft: 1.2 };
  const DEFAULT_QUICK = ["Escape", "ArrowUp", "Enter", "KeyZ", "KeyX", "KeyC", "ArrowLeft", "ArrowDown", "ArrowRight", "Space",
    "ShiftLeft", "ControlLeft", "Tab", "AltLeft", "Backspace", "F1", "F5", "F12"];

  const T = {
    ja: { all: "全キー", edit: "編集", done: "完了", reset: "初期に戻す", main: "メイン", nav: "矢印・テンキー",
      editTitle: "よく使うキーを編集",
      editHint: "ドラッグで並べ替え、× で外す。下の全キーを押すと追加（もう一度押すと外れる）。",
      size: "大きさ", sizes: ["小", "中", "大"], empty: "キーがありません。下の全キーから追加してください",
      fullscreen: "全画面", exitFullscreen: "全画面を終了", keys: "キー", remove: "外す" },
    en: { all: "All keys", edit: "Edit", done: "Done", reset: "Reset", main: "Main", nav: "Arrows & keypad",
      editTitle: "Edit quick keys",
      editHint: "Drag to reorder, × to remove. Tap a key below to add it (tap again to remove).",
      size: "Size", sizes: ["S", "M", "L"], empty: "No keys yet. Add some from the keyboard below",
      fullscreen: "Fullscreen", exitFullscreen: "Exit fullscreen", keys: "Keys", remove: "Remove" },
  };

  const CSS = `
  .vk { --vk-h: 42px; --vk-w: 58px; --vk-fs: 14px;
    flex: 0 0 auto; background: #1c232b; border-top: 1px solid #46525f; padding: 6px 6px max(6px, env(safe-area-inset-bottom));
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation;
    font: 600 var(--vk-fs)/1 system-ui, -apple-system, "Hiragino Sans", sans-serif; color: #f2f5f8; }
  .vk[data-size="0"] { --vk-h: 34px; --vk-w: 50px; --vk-fs: 12.5px; }
  .vk[data-size="2"] { --vk-h: 54px; --vk-w: 70px; --vk-fs: 16px; }
  .vk.vk-hidden { display: none; }
  .vk button { color: #f2f5f8; background: #2b3540; border: 1px solid #46525f; border-radius: 7px; font: inherit; padding: 0 2px;
    -webkit-tap-highlight-color: transparent; touch-action: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vk button.vk-down, .vk button.vk-latched { background: #3f6fd8; border-color: #6f95e8; }
  .vk-quick { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--vk-w), 1fr)); gap: 5px; }
  .vk-quick button { min-height: var(--vk-h); position: relative; }
  .vk-quick button.vk-tool { background: #222b34; color: #c9d6e3; font-weight: 500; font-size: 13px; grid-column: span 2; }
  .vk-empty { grid-column: 1 / -1; margin: 6px 2px; font: 400 13px/1.4 system-ui, -apple-system, "Hiragino Sans", sans-serif; color: #c9d6e3; }

  /* 編集中 */
  .vk-edit-head { display: none; margin: 0 0 8px; }
  .vk.vk-editing .vk-edit-head { display: block; }
  .vk-edit-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .vk-edit-top strong { font-size: 14px; margin-right: auto; }
  .vk-edit-top button { min-height: 34px; padding: 0 12px; font-weight: 500; font-size: 13px; }
  .vk-edit-top button.vk-primary { background: #f2f5f8; color: #101418; border-color: #f2f5f8; font-weight: 700; }
  .vk-seg { display: inline-flex; border: 1px solid #46525f; border-radius: 7px; overflow: hidden; }
  .vk-seg button { border: 0; border-radius: 0; min-height: 32px; padding: 0 10px; background: #222b34; }
  .vk-seg button[aria-pressed="true"] { background: #f2f5f8; color: #101418; }
  .vk-edit-hint { margin: 6px 0 0; font: 400 12.5px/1.45 system-ui, -apple-system, "Hiragino Sans", sans-serif; color: #c9d6e3; }
  .vk.vk-editing .vk-quick button.vk-key { border-style: dashed; border-color: #8aa0b6; cursor: grab; }
  .vk.vk-editing .vk-quick button.vk-dragging { background: #3f6fd8; border-style: solid; transform: scale(1.06); z-index: 2;
    box-shadow: 0 4px 12px rgba(0,0,0,.5); }
  .vk-x { display: none; position: absolute; top: -1px; right: -1px; width: 20px; height: 20px; border-radius: 0 7px 0 7px;
    background: #c0392b; color: #fff; font: 700 13px/20px system-ui, sans-serif; text-align: center; }
  .vk.vk-editing .vk-quick .vk-x { display: block; }
  .vk.vk-editing .vk-full button.vk-picked { background: #3a4a2a; border-color: #ffcf4a; box-shadow: inset 0 0 0 1px #ffcf4a; }

  .vk-full { margin-top: 6px; }
  .vk-full.vk-hidden { display: none; }
  .vk-tabs { display: flex; gap: 5px; margin-bottom: 5px; }
  .vk-tabs button { min-height: 30px; padding: 0 10px; font-weight: 500; font-size: 13px; }
  .vk-tabs button[aria-pressed="true"] { background: #f2f5f8; color: #101418; }
  .vk-tabs .vk-sp { flex: 1; }
  .vk-row { display: flex; gap: 3px; margin-top: 3px; }
  .vk-row button, .vk-row span { flex: 1 1 0; min-height: 38px; font-size: 12.5px; }
  .vk-row button { padding: 0; text-overflow: clip; letter-spacing: -0.02em; }
  @media (max-width: 480px) { .vk-row button { font-size: 10.5px; font-weight: 500; } }
  body.vk-immersive .vk-float { display: flex; }
  .vk-float { display: none; position: fixed; z-index: 50; top: max(6px, env(safe-area-inset-top)); right: max(6px, env(safe-area-inset-right));
    gap: 6px; opacity: .55; }
  .vk-float:hover, .vk-float:focus-within { opacity: 1; }
  .vk-float button { color: #f2f5f8; background: rgba(28,35,43,.9); border: 1px solid #46525f; border-radius: 8px; padding: 6px 10px;
    font: 500 13px/1.2 system-ui, -apple-system, "Hiragino Sans", sans-serif; }
  `;

  function mount({ parent, send, storageId, lang }) {
    const L = T[lang === "en" ? "en" : "ja"];
    if (!document.getElementById("vk-style")) {
      const st = document.createElement("style");
      st.id = "vk-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const storeKey = "exe-vkeys:" + (storageId || "default");
    const store = {
      get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    };
    const load = () => {
      for (const k of [storeKey, "exe-vkeys:default"]) {
        const v = store.get(k);
        if (Array.isArray(v)) return v.filter((id) => BY_ID.has(id));
      }
      return DEFAULT_QUICK.slice();
    };
    const save = () => { store.set(storeKey, quick); store.set("exe-vkeys:default", quick); }; // 新しいゲームは直近の並びで始める
    let quick = load();
    let editing = false;
    let size = store.get("exe-vkeys-size");
    if (![0, 1, 2].includes(size)) size = 1;

    const root = document.createElement("div");
    root.className = "vk";
    root.dataset.size = String(size);
    const head = document.createElement("div");
    head.className = "vk-edit-head";
    const quickEl = document.createElement("div");
    quickEl.className = "vk-quick";
    const full = document.createElement("div");
    full.className = "vk-full vk-hidden";
    root.append(head, quickEl, full);
    parent.appendChild(root);

    // ---- 押下の状態 ----
    const buttonsById = new Map(); // id -> [button, ...]（よく使うキーと全キーの両方にある）
    const held = new Map(); // id -> 押している指の数
    const latched = new Set(); // 1 回だけ押した状態の修飾キー
    const paint = (id) => {
      for (const b of buttonsById.get(id) || []) {
        b.classList.toggle("vk-down", (held.get(id) || 0) > 0);
        b.classList.toggle("vk-latched", latched.has(id));
        b.classList.toggle("vk-picked", editing && quick.includes(id));
      }
    };
    const paintAll = () => { for (const id of BY_ID.keys()) paint(id); };
    const press = (id, down) => send(BY_ID.get(id), down);
    const releaseLatched = () => {
      for (const id of [...latched]) { latched.delete(id); press(id, false); paint(id); }
    };
    const releaseAll = () => {
      for (const [id, n] of held) if (n > 0) { held.set(id, 0); press(id, false); }
      releaseLatched();
      paintAll();
    };
    function forget(container) {
      for (const [id, list] of buttonsById) buttonsById.set(id, list.filter((b) => !container.contains(b)));
    }

    // ---- キー（演奏用） ----
    function keyButton(id, inQuick) {
      const def = BY_ID.get(id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vk-key";
      b.textContent = def.label;
      b.dataset.id = id;
      if (!inQuick && WIDE[id]) b.style.flexGrow = WIDE[id];
      if (inQuick) {
        const x = document.createElement("span");
        x.className = "vk-x";
        x.textContent = "×";
        x.setAttribute("aria-label", L.remove);
        b.appendChild(x);
      }
      if (!buttonsById.has(id)) buttonsById.set(id, []);
      buttonsById.get(id).push(b);
      let downAt = 0;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (editing) return inQuick ? dragStart(e, b, id) : undefined;
        if (b.setPointerCapture) try { b.setPointerCapture(e.pointerId); } catch (err) {}
        downAt = Date.now();
        b._other = false;
        if (MODIFIERS.has(id) && latched.has(id)) { // ラッチ中にもう一度押したら離す
          latched.delete(id); press(id, false); paint(id); downAt = 0; return;
        }
        held.set(id, (held.get(id) || 0) + 1);
        if (held.get(id) === 1) press(id, true);
        if (!MODIFIERS.has(id)) for (const m of MODIFIERS) if ((held.get(m) || 0) > 0) for (const mb of buttonsById.get(m) || []) mb._other = true;
        paint(id);
      });
      const up = (e) => {
        e.preventDefault();
        if (editing) {
          if (!inQuick && e.type === "pointerup") toggleQuick(id);
          return;
        }
        if (!downAt) return;
        const short = Date.now() - downAt < 300 && !b._other;
        downAt = 0;
        held.set(id, Math.max(0, (held.get(id) || 0) - 1));
        if (held.get(id) === 0) {
          if (MODIFIERS.has(id) && short && e.type === "pointerup") latched.add(id); // 軽いタップ：次のキーまで押したまま
          else press(id, false);
        }
        if (!MODIFIERS.has(id)) releaseLatched();
        paint(id);
      };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      return b;
    }

    // ---- 編集：ドラッグで並べ替え・× で外す ----
    let drag = null;
    function dragStart(e, b, id) {
      if (e.target.classList.contains("vk-x")) { // × は押した時点で外す
        quick = quick.filter((x) => x !== id);
        save(); renderQuick(); paintAll();
        return;
      }
      drag = { b, id, x: e.clientX, y: e.clientY, moved: false };
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function dragMove(e) {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moved = true;
      drag.b.classList.add("vk-dragging");
      // 指の下にある別のキーの位置へ移す（前後は並びの順で決める）
      const keys = [...quickEl.querySelectorAll("button.vk-key")];
      const over = keys.find((k) => {
        if (k === drag.b) return false;
        const r = k.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (!over) return;
      const from = keys.indexOf(drag.b);
      const to = keys.indexOf(over);
      quickEl.insertBefore(drag.b, to > from ? over.nextSibling : over);
    }
    function dragEnd() {
      if (!drag) return;
      drag.b.classList.remove("vk-dragging");
      if (drag.moved) {
        quick = [...quickEl.querySelectorAll("button.vk-key")].map((k) => k.dataset.id);
        save();
      }
      drag = null;
    }
    quickEl.addEventListener("pointermove", dragMove);
    quickEl.addEventListener("pointerup", dragEnd);
    quickEl.addEventListener("pointercancel", dragEnd);

    function tool(label, onClick, cls) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vk-tool" + (cls ? " " + cls : "");
      b.textContent = label;
      b.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
      return b;
    }

    function renderHead() {
      head.innerHTML = "";
      const top = document.createElement("div");
      top.className = "vk-edit-top";
      const title = document.createElement("strong");
      title.textContent = L.editTitle;
      const seg = document.createElement("span");
      seg.className = "vk-seg";
      seg.setAttribute("aria-label", L.size);
      L.sizes.forEach((label, i) => {
        const b = tool(label, () => { size = i; store.set("exe-vkeys-size", i); root.dataset.size = String(i); renderHead(); window.dispatchEvent(new Event("resize")); });
        b.setAttribute("aria-pressed", String(size === i));
        seg.appendChild(b);
      });
      top.append(title, seg,
        tool(L.reset, () => { quick = DEFAULT_QUICK.slice(); save(); renderQuick(); paintAll(); }),
        tool(L.done, () => setEditing(false), "vk-primary"));
      const hint = document.createElement("p");
      hint.className = "vk-edit-hint";
      hint.textContent = L.editHint;
      head.append(top, hint);
    }

    function renderQuick() {
      forget(quickEl);
      quickEl.innerHTML = "";
      for (const id of quick) quickEl.appendChild(keyButton(id, true));
      if (!quick.length) {
        const p = document.createElement("p");
        p.className = "vk-empty";
        p.textContent = L.empty;
        quickEl.appendChild(p);
      }
      if (!editing) {
        quickEl.appendChild(tool("✎ " + L.edit, () => setEditing(true)));
        quickEl.appendChild(tool("⌨ " + L.all, () => {
          full.classList.toggle("vk-hidden");
          window.dispatchEvent(new Event("resize"));
        }));
      }
      for (const id of quick) paint(id);
    }

    let page = "main";
    function renderFull() {
      forget(full);
      full.innerHTML = "";
      const tabs = document.createElement("div");
      tabs.className = "vk-tabs";
      const tab = (name, label) => {
        const b = tool(label, () => { page = name; renderFull(); });
        b.setAttribute("aria-pressed", String(page === name));
        return b;
      };
      const sp = document.createElement("span");
      sp.className = "vk-sp";
      tabs.append(tab("main", L.main), tab("nav", L.nav), sp);
      if (!editing) tabs.append(tool("✎ " + L.edit, () => setEditing(true)));
      full.appendChild(tabs);
      for (const row of page === "main" ? MAIN_ROWS : NAV_ROWS) {
        const r = document.createElement("div");
        r.className = "vk-row";
        for (const id of row) r.appendChild(id ? keyButton(id, false) : document.createElement("span"));
        full.appendChild(r);
      }
      paintAll();
    }
    let fullWasOpen = false;
    function setEditing(on) {
      releaseAll(); // 編集に入る前に押しっぱなしのキーを離す
      editing = on;
      root.classList.toggle("vk-editing", on);
      if (on) { fullWasOpen = !full.classList.contains("vk-hidden"); full.classList.remove("vk-hidden"); }
      else if (!fullWasOpen) full.classList.add("vk-hidden"); // 編集のために開いた全キーは閉じて戻す
      renderHead();
      renderQuick();
      renderFull();
      window.dispatchEvent(new Event("resize"));
    }
    function toggleQuick(id) {
      quick = quick.includes(id) ? quick.filter((x) => x !== id) : quick.concat(id);
      save();
      renderQuick();
      paint(id);
    }

    renderHead();
    renderQuick();
    renderFull();

    return {
      root,
      toggle() { root.classList.toggle("vk-hidden"); window.dispatchEvent(new Event("resize")); },
      hide(v) { root.classList.toggle("vk-hidden", v); window.dispatchEvent(new Event("resize")); },
    };
  }

  // 全画面：body に vk-immersive を付け（各ページの CSS で上部バーなどを隠す）、対応していれば本当の全画面にする。
  // iPhone の Safari は要素の全画面に対応していないので、その場合は画面いっぱいに広げるだけ
  function fullscreen({ lang, onToggleKeys }) {
    const L = T[lang === "en" ? "en" : "ja"];
    const float = document.createElement("div");
    float.className = "vk-float";
    const keysBtn = document.createElement("button");
    keysBtn.type = "button";
    keysBtn.textContent = "⌨ " + L.keys;
    keysBtn.addEventListener("click", () => onToggleKeys && onToggleKeys());
    const exitBtn = document.createElement("button");
    exitBtn.type = "button";
    exitBtn.textContent = "✕ " + L.exitFullscreen;
    float.append(keysBtn, exitBtn);
    document.body.appendChild(float);
    const el = document.documentElement;
    const isNative = () => document.fullscreenElement || document.webkitFullscreenElement;
    function set(on) {
      document.body.classList.toggle("vk-immersive", on);
      if (on && !isNative()) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          try {
            const p = req.call(el, { navigationUI: "hide" });
            if (p && p.catch) p.catch(() => {});
          } catch (e) {}
        }
        try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {}); } catch (e) {}
      } else if (!on && isNative()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        try { const p = exit && exit.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {}
      }
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    }
    exitBtn.addEventListener("click", () => set(false));
    // ブラウザ側の操作（Esc など）で全画面が終わったら、こちらの表示も戻す
    const onChange = () => { if (!isNative() && document.body.classList.contains("vk-immersive")) set(false); };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return { enter: () => set(true), exit: () => set(false), label: L.fullscreen };
  }

  window.VKeys = { mount, fullscreen, KEYS, BY_ID };
})();
