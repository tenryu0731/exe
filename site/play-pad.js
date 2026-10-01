// ブラウザで直接遊ぶ HTML5 ゲーム（RPGツクールMV/MZ）用の仮想キーパッドと戻るボタン。
// Service Worker が index.html に差し込む。MV/MZ は document の keydown/keyup の keyCode を見るので、
// keyCode 付きの KeyboardEvent を document に送る。
(function () {
  "use strict";

  // 言語はランチャーが cookie "exe-lang" に保存したもの
  const EN = /(?:^|;\s*)exe-lang=en/.test(document.cookie) ||
    (!/(?:^|;\s*)exe-lang=/.test(document.cookie) && !(navigator.language || "").toLowerCase().startsWith("ja"));
  const L = EN
    ? { ok: "OK", cancel: "Back", dash: "Dash", menu: "Menu", back: "Back to launcher",
        confirm: "Return to the launcher? (Unsaved progress will be lost.)", show: "Show keys", hide: "Hide keys" }
    : { ok: "決定", cancel: "戻る", dash: "ダッシュ", menu: "メニュー", back: "ランチャーに戻る",
        confirm: "ランチャーに戻りますか？（セーブしていない進行は失われます）", show: "キー表示", hide: "キー非表示" };

  // [表示, key, code, keyCode]
  const KEYS = {
    up: ["▲", "ArrowUp", "ArrowUp", 38],
    down: ["▼", "ArrowDown", "ArrowDown", 40],
    left: ["◀", "ArrowLeft", "ArrowLeft", 37],
    right: ["▶", "ArrowRight", "ArrowRight", 39],
    ok: [L.ok, "z", "KeyZ", 90],
    cancel: [L.cancel, "x", "KeyX", 88],
    dash: [L.dash, "Shift", "ShiftLeft", 16],
    menu: [L.menu, "Escape", "Escape", 27],
    pageup: ["Q", "q", "KeyQ", 81],
    pagedown: ["W", "w", "KeyW", 87],
  };

  function send(type, def) {
    const ev = new KeyboardEvent(type, { key: def[1], code: def[2], bubbles: true, cancelable: true });
    for (const prop of ["keyCode", "which"]) {
      try { Object.defineProperty(ev, prop, { get: () => def[3] }); } catch (e) {}
    }
    document.dispatchEvent(ev);
  }

  const css = `
  #xp-pad, #xp-pad * { box-sizing: border-box; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  #xp-pad { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646; pointer-events: none;
    display: flex; justify-content: space-between; align-items: flex-end;
    padding: 0 max(10px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left)); }
  #xp-pad.xp-hidden .xp-cluster { display: none; }
  #xp-pad .xp-cluster { pointer-events: auto; }
  #xp-pad button { touch-action: none; font: 600 14px/1 -apple-system, "Hiragino Sans", sans-serif; color: #fff;
    background: rgba(0, 0, 0, .5); border: 2px solid rgba(255, 255, 255, .7); border-radius: 12px;
    -webkit-tap-highlight-color: transparent; padding: 0; }
  #xp-pad button.xp-down { background: rgba(60, 120, 230, .85); }
  #xp-dpad { display: grid; grid-template-columns: repeat(3, 54px); grid-template-rows: repeat(3, 54px); gap: 4px; }
  #xp-dpad button { font-size: 18px; }
  #xp-dpad [data-k=up] { grid-column: 2; grid-row: 1; }
  #xp-dpad [data-k=left] { grid-column: 1; grid-row: 2; }
  #xp-dpad [data-k=right] { grid-column: 3; grid-row: 2; }
  #xp-dpad [data-k=down] { grid-column: 2; grid-row: 3; }
  #xp-btns { display: grid; grid-template-columns: repeat(2, 70px); grid-auto-rows: 46px; gap: 6px; }
  #xp-btns [data-k=dash] { grid-column: 1 / span 2; grid-row: 1; }
  #xp-btns [data-k=pageup] { grid-column: 1; grid-row: 2; }
  #xp-btns [data-k=pagedown] { grid-column: 2; grid-row: 2; }
  #xp-btns [data-k=cancel] { grid-column: 1; grid-row: 3; border-radius: 23px; }
  #xp-btns [data-k=ok] { grid-column: 2; grid-row: 3; border-radius: 23px; font-size: 16px; }
  #xp-btns [data-k=menu] { grid-column: 1 / span 2; grid-row: 4; }
  #xp-top { position: fixed; top: max(4px, env(safe-area-inset-top)); right: max(6px, env(safe-area-inset-right));
    z-index: 2147483647; display: flex; gap: 6px; }
  #xp-top a, #xp-top button { display: block; min-width: 36px; height: 32px; padding: 0 8px; border-radius: 16px;
    background: rgba(0, 0, 0, .55); color: #fff; border: 1px solid rgba(255, 255, 255, .6);
    font: 600 13px/30px -apple-system, "Hiragino Sans", sans-serif; text-align: center; text-decoration: none; }
  `;

  // パッドへのタッチがゲーム側の TouchInput（document で待ち受け）に届かないようにする
  const STOP = ["touchstart", "touchmove", "touchend", "touchcancel", "mousedown", "mouseup", "click",
    "pointerdown", "pointerup", "pointermove", "pointercancel", "wheel"];
  function isolate(el) {
    for (const t of STOP) el.addEventListener(t, (e) => e.stopPropagation(), { passive: false });
  }

  function makeButton(k) {
    const def = KEYS[k];
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.k = k;
    b.textContent = def[0];
    const down = (e) => {
      e.preventDefault();
      if (b.classList.contains("xp-down")) return;
      b.classList.add("xp-down");
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
      send("keydown", def);
    };
    const up = (e) => {
      e.preventDefault();
      if (!b.classList.contains("xp-down")) return;
      b.classList.remove("xp-down");
      send("keyup", def);
    };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("lostpointercapture", up);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }

  function build() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const pad = document.createElement("div");
    pad.id = "xp-pad";
    const dpad = document.createElement("div");
    dpad.id = "xp-dpad";
    dpad.className = "xp-cluster";
    for (const k of ["up", "left", "right", "down"]) dpad.appendChild(makeButton(k));
    const btns = document.createElement("div");
    btns.id = "xp-btns";
    btns.className = "xp-cluster";
    for (const k of ["dash", "pageup", "pagedown", "cancel", "ok", "menu"]) btns.appendChild(makeButton(k));
    pad.append(dpad, btns);

    const top = document.createElement("div");
    top.id = "xp-top";
    const toggle = document.createElement("button");
    toggle.type = "button";
    const back = document.createElement("a");
    back.href = "../../";
    back.textContent = "×";
    back.setAttribute("aria-label", L.back);
    back.addEventListener("click", (e) => {
      if (!confirm(L.confirm)) e.preventDefault();
    });
    top.append(toggle, back);

    let hidden = false;
    try { hidden = sessionStorage.getItem("xp-pad-hidden") === "1"; } catch (e) {}
    const apply = () => {
      pad.classList.toggle("xp-hidden", hidden);
      toggle.textContent = hidden ? L.show : L.hide;
    };
    toggle.addEventListener("click", () => {
      hidden = !hidden;
      try { sessionStorage.setItem("xp-pad-hidden", hidden ? "1" : "0"); } catch (e) {}
      apply();
    });
    apply();

    isolate(pad);
    isolate(top);
    document.body.append(pad, top);

    // iOS のダブルタップ拡大・長押しメニューを抑止
    document.addEventListener("gesturestart", (e) => e.preventDefault());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
