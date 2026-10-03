// ブラウザで直接遊ぶ HTML5 ゲーム（RPGツクールMV/MZ）用の画面上のキーボードと上部のボタン。
// Service Worker が index.html に差し込む（vkeys.js の後）。キーボードは Windows・DOS の画面と同じ vkeys.js で、
// よく使うキーの追加・並べ替え・大きさの変更、全キー、全画面が使える。
// MV/MZ は document の keydown/keyup の keyCode を見るので、keyCode 付きの KeyboardEvent を document に送る。
// キーボードを出している間は、ゲーム画面がその上の領域に収まるよう、ゲームから見える画面の高さを減らす。
(function () {
  "use strict";

  // 言語はランチャーが cookie "exe-lang" に保存したもの
  const EN = /(?:^|;\s*)exe-lang=en/.test(document.cookie) ||
    (!/(?:^|;\s*)exe-lang=/.test(document.cookie) && !(navigator.language || "").toLowerCase().startsWith("ja"));
  const L = EN
    ? { back: "← Back", keys: "Keys", full: "Full", confirm: "Return to the library? Unsaved progress will be lost.",
        hints: { KeyZ: "OK", KeyX: "Cancel", ShiftLeft: "Dash", Escape: "Menu", KeyQ: "Page ←", KeyW: "Page →" } }
    : { back: "← 戻る", keys: "キー", full: "全画面", confirm: "ライブラリに戻りますか？ セーブしていない進行は失われます。",
        hints: { KeyZ: "決定", KeyX: "取消", ShiftLeft: "ダッシュ", Escape: "メニュー", KeyQ: "前ページ", KeyW: "次ページ" } };
  // ツクールで使うキー（初期の並び）
  const DEFAULTS = ["DPad", "KeyZ", "KeyX", "ShiftLeft", "Escape", "KeyQ", "KeyW"];

  function send(def, down) {
    const ev = new KeyboardEvent(down ? "keydown" : "keyup", { key: def.key, code: def.code, bubbles: true, cancelable: true });
    for (const prop of ["keyCode", "which"]) {
      try { Object.defineProperty(ev, prop, { get: () => def.keyCode }); } catch (e) {}
    }
    document.dispatchEvent(ev);
  }

  // ---- ゲームに見せる画面の高さ ----
  // ツクールは window.innerHeight に合わせて拡大率を決め、body を基準に中央へ置く。
  // キーボードの分だけ innerHeight と body の高さを減らせば、ゲーム画面はキーボードの上に収まる
  let kbHeight = 0;
  const proto = Object.getOwnPropertyDescriptor(window, "innerHeight") || Object.getOwnPropertyDescriptor(Window.prototype, "innerHeight");
  const realHeight = () => (proto && proto.get ? proto.get.call(window) : document.documentElement.clientHeight);
  try {
    Object.defineProperty(window, "innerHeight", { configurable: true, get: () => Math.max(1, realHeight() - kbHeight) });
  } catch (e) {}

  const css = `
  html { height: calc(100% - var(--xp-kb, 0px)) !important; }
  body { height: 100% !important; position: relative; }
  #xp-kb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646; max-height: 100vh; overflow-y: auto; }
  #xp-top { position: fixed; top: max(4px, env(safe-area-inset-top)); right: max(6px, env(safe-area-inset-right));
    z-index: 2147483647; display: flex; gap: 6px; }
  #xp-top button { min-width: 36px; height: 32px; padding: 0 10px; border-radius: 16px; background: rgba(0, 0, 0, .6); color: #fff;
    border: 1px solid rgba(255, 255, 255, .6); font: 600 13px/30px -apple-system, "Hiragino Sans", sans-serif; }
  body.vk-immersive #xp-top, body:has(.vk-editing) #xp-top { display: none; }
  `;

  // キーボードへのタッチがゲーム側の TouchInput（document で待ち受け）に届かないようにする
  const STOP = ["touchstart", "touchmove", "touchend", "touchcancel", "mousedown", "mouseup", "click",
    "pointerdown", "pointerup", "pointermove", "pointercancel", "wheel"];
  function isolate(el) {
    for (const t of STOP) el.addEventListener(t, (e) => e.stopPropagation(), { passive: false });
  }

  function build() {
    if (!window.VKeys) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const holder = document.createElement("div");
    holder.id = "xp-kb";
    const id = decodeURIComponent((/\/play\/([^/]+)\//.exec(location.pathname) || [])[1] || "");
    const keypad = VKeys.mount({
      parent: holder, send, lang: EN ? "en" : "ja",
      storageId: "html5:" + id, group: "html5", defaults: DEFAULTS, hints: L.hints,
    });
    const measure = () => {
      const h = keypad.root.classList.contains("vk-hidden") ? 0 : holder.getBoundingClientRect().height;
      if (h === kbHeight) return false;
      kbHeight = h;
      document.documentElement.style.setProperty("--xp-kb", h + "px");
      return true;
    };
    // キーボードの開閉・大きさの変更（vkeys.js が resize を送る）や画面の回転のたびに測り直す。
    // 高さが変わったら、ゲームにもう一度 resize を送って拡大率を計算し直させる
    window.addEventListener("resize", () => { if (measure()) setTimeout(() => window.dispatchEvent(new Event("resize")), 0); }, true);

    let hidden = !matchMedia("(pointer: coarse)").matches;
    try { const v = sessionStorage.getItem("xp-pad-hidden"); if (v !== null) hidden = v === "1"; } catch (e) {}
    keypad.hide(hidden);
    const toggleKeys = () => {
      keypad.toggle();
      try { sessionStorage.setItem("xp-pad-hidden", keypad.root.classList.contains("vk-hidden") ? "1" : "0"); } catch (e) {}
    };

    const top = document.createElement("div");
    top.id = "xp-top";
    const btn = (label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    };
    const full = VKeys.fullscreen({ lang: EN ? "en" : "ja", onToggleKeys: toggleKeys });
    top.append(
      btn(L.back, () => { if (confirm(L.confirm)) location.href = "../../"; }),
      btn(L.keys, toggleKeys),
      btn(L.full, () => full.enter()),
    );

    isolate(holder);
    isolate(top);
    for (const f of document.querySelectorAll(".vk-float")) isolate(f);
    document.body.append(holder, top);
    measure();
    window.dispatchEvent(new Event("resize"));

    // iOS のダブルタップ拡大・長押しメニューを抑止
    document.addEventListener("gesturestart", (e) => e.preventDefault());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
