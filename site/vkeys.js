// 画面上のキーボード（エミュレーター画面・DOS 画面で共用）
//
//  - よく使うキー：画面下に常に出す数個のキー。ゲームごとに好きなキーを選んで並べられる（端末内に保存）
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
    ja: { all: "全キー", edit: "並べ替え", done: "完了", reset: "初期に戻す", main: "メイン", nav: "矢印・テンキー",
      editHint: "下の全キーから、よく使うキーとして置くキーを押して選んでください（もう一度押すと外れます）。並びは選んだ順です。",
      fullscreen: "全画面", exitFullscreen: "全画面を終了", keys: "キー" },
    en: { all: "All keys", edit: "Customize", done: "Done", reset: "Reset", main: "Main", nav: "Arrows & keypad",
      editHint: "Tap keys below to add them to your quick keys (tap again to remove). They appear in the order you pick them.",
      fullscreen: "Fullscreen", exitFullscreen: "Exit fullscreen", keys: "Keys" },
  };

  const CSS = `
  .vk { flex: 0 0 auto; background: #1c232b; border-top: 1px solid #46525f; padding: 6px 6px max(6px, env(safe-area-inset-bottom));
    user-select: none; -webkit-user-select: none; touch-action: manipulation; font: 600 14px/1 system-ui, -apple-system, "Hiragino Sans", sans-serif; color: #f2f5f8; }
  .vk.vk-hidden { display: none; }
  .vk button { color: #f2f5f8; background: #2b3540; border: 1px solid #46525f; border-radius: 7px; font: inherit; padding: 0 2px;
    -webkit-tap-highlight-color: transparent; touch-action: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vk button.vk-down, .vk button.vk-latched { background: #3f6fd8; border-color: #6f95e8; }
  .vk button.vk-picked { box-shadow: inset 0 0 0 2px #ffcf4a; }
  .vk-quick { display: grid; grid-template-columns: repeat(auto-fill, minmax(50px, 1fr)); gap: 5px; }
  .vk-quick button { min-height: 42px; }
  .vk-quick button.vk-tool { background: #222b34; color: #c9d6e3; font-weight: 500; grid-column: span 2; }
  .vk-full { margin-top: 6px; }
  .vk-full.vk-hidden { display: none; }
  .vk-tabs { display: flex; gap: 5px; margin-bottom: 5px; }
  .vk-tabs button { min-height: 30px; padding: 0 10px; font-weight: 500; }
  .vk-tabs button[aria-pressed="true"] { background: #f2f5f8; color: #101418; }
  .vk-tabs .vk-sp { flex: 1; }
  .vk-row { display: flex; gap: 3px; margin-top: 3px; }
  .vk-row button, .vk-row span { flex: 1 1 0; min-height: 38px; font-size: 12.5px; }
  .vk-row button { padding: 0; text-overflow: clip; letter-spacing: -0.02em; }
  @media (max-width: 480px) { .vk-row button { font-size: 10.5px; font-weight: 500; } }
  .vk-hint { margin: 2px 0 6px; font: 400 12.5px/1.4 system-ui, -apple-system, "Hiragino Sans", sans-serif; color: #c9d6e3; }
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
    const load = () => {
      for (const k of [storeKey, "exe-vkeys:default"]) {
        try {
          const v = JSON.parse(localStorage.getItem(k) || "null");
          if (Array.isArray(v) && v.length) return v.filter((id) => BY_ID.has(id));
        } catch (e) {}
      }
      return DEFAULT_QUICK.slice();
    };
    const save = (ids) => {
      try {
        localStorage.setItem(storeKey, JSON.stringify(ids));
        localStorage.setItem("exe-vkeys:default", JSON.stringify(ids)); // 新しいゲームは直近の並びで始める
      } catch (e) {}
    };
    let quick = load();
    let editing = false;

    const root = document.createElement("div");
    root.className = "vk";
    const quickEl = document.createElement("div");
    quickEl.className = "vk-quick";
    const full = document.createElement("div");
    full.className = "vk-full vk-hidden";
    root.append(quickEl, full);
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
    const press = (id, down) => send(BY_ID.get(id), down);
    const releaseLatched = () => {
      for (const id of [...latched]) { latched.delete(id); press(id, false); paint(id); }
    };

    function keyButton(id, extraClass) {
      const def = BY_ID.get(id);
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = def.label;
      if (extraClass) b.className = extraClass;
      if (WIDE[id]) b.style.flexGrow = WIDE[id];
      if (!buttonsById.has(id)) buttonsById.set(id, []);
      buttonsById.get(id).push(b);
      let downAt = 0;
      let otherKeyWhileDown = false;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (editing && b.closest(".vk-full")) return;
        b.setPointerCapture && b.setPointerCapture(e.pointerId);
        downAt = Date.now();
        otherKeyWhileDown = false;
        if (MODIFIERS.has(id) && latched.has(id)) { // ラッチ中にもう一度押したら離す
          latched.delete(id); press(id, false); paint(id); downAt = 0; return;
        }
        held.set(id, (held.get(id) || 0) + 1);
        if (held.get(id) === 1) press(id, true);
        if (!MODIFIERS.has(id)) for (const m of MODIFIERS) if ((held.get(m) || 0) > 0) mark(m);
        paint(id);
      });
      const up = (e) => {
        e.preventDefault();
        if (editing && b.closest(".vk-full")) {
          if (e.type === "pointerup") toggleQuick(id);
          return;
        }
        if (!downAt) return;
        const short = Date.now() - downAt < 300 && !otherKeyWhileDown;
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
      b._markOther = () => { otherKeyWhileDown = true; };
      return b;
    }
    function mark(modId) { for (const b of buttonsById.get(modId) || []) b._markOther && b._markOther(); }

    function tool(label, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vk-tool";
      b.textContent = label;
      b.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
      return b;
    }

    function renderQuick() {
      for (const [id, list] of buttonsById) buttonsById.set(id, list.filter((b) => !quickEl.contains(b)));
      quickEl.innerHTML = "";
      for (const id of quick) quickEl.appendChild(keyButton(id));
      quickEl.appendChild(tool("⌨ " + L.all, () => {
        full.classList.toggle("vk-hidden");
        if (full.classList.contains("vk-hidden") && editing) setEditing(false);
        window.dispatchEvent(new Event("resize"));
      }));
      for (const id of quick) paint(id);
    }

    let page = "main";
    const hint = document.createElement("p");
    hint.className = "vk-hint";
    hint.textContent = L.editHint;
    function renderFull() {
      for (const [id, list] of buttonsById) buttonsById.set(id, list.filter((b) => !full.contains(b)));
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
      if (editing) tabs.append(tool(L.reset, () => { quick = DEFAULT_QUICK.slice(); save(quick); renderQuick(); renderFull(); }));
      tabs.append(tool(editing ? L.done : L.edit, () => setEditing(!editing)));
      full.appendChild(tabs);
      if (editing) full.appendChild(hint);
      for (const row of page === "main" ? MAIN_ROWS : NAV_ROWS) {
        const r = document.createElement("div");
        r.className = "vk-row";
        for (const id of row) {
          if (!id) { r.appendChild(document.createElement("span")); continue; }
          r.appendChild(keyButton(id));
        }
        full.appendChild(r);
      }
      for (const id of BY_ID.keys()) paint(id);
    }
    function setEditing(on) {
      editing = on;
      if (on) full.classList.remove("vk-hidden");
      renderFull();
      for (const id of BY_ID.keys()) paint(id);
      window.dispatchEvent(new Event("resize"));
    }
    function toggleQuick(id) {
      quick = quick.includes(id) ? quick.filter((x) => x !== id) : quick.concat(id);
      save(quick);
      renderQuick();
      paint(id);
    }

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
