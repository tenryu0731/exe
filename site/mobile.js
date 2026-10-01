// boxedwine.html（エミュレーター画面）に注入するスマホ向けUI
// 上部バー（戻る・キー表示切替・文字入力・ログ表示）と仮想キーボードを追加する。
(function () {
  "use strict";

  // ランチャーが OPFS に保存したゲームZIPを、Boxedwine の fetch("…/games/<id>.zip") に渡す
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const m = url.pathname.match(/\/games\/([^/]+\.zip)$/);
    if (m && navigator.storage && navigator.storage.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle("games");
        const file = await (await dir.getFileHandle(decodeURIComponent(m[1]))).getFile();
        return new Response(file, { headers: { "Content-Type": "application/zip" } });
      } catch (e) {
        // 見つからなければ従来どおり（Service Worker の Cache）から読む
      }
    }
    return originalFetch(input, init);
  };

  // [表示名, KeyboardEvent.key, KeyboardEvent.code, keyCode, ラッチ式(修飾キー)]
  const KEYS = [
    ["Esc", "Escape", "Escape", 27],
    ["↑", "ArrowUp", "ArrowUp", 38],
    ["Enter", "Enter", "Enter", 13],
    ["Z", "z", "KeyZ", 90],
    ["X", "x", "KeyX", 88],
    ["C", "c", "KeyC", 67],
    ["←", "ArrowLeft", "ArrowLeft", 37],
    ["↓", "ArrowDown", "ArrowDown", 40],
    ["→", "ArrowRight", "ArrowRight", 39],
    ["Space", " ", "Space", 32],
    ["Shift", "Shift", "ShiftLeft", 16, true],
    ["Ctrl", "Control", "ControlLeft", 17, true],
    ["Tab", "Tab", "Tab", 9],
    ["Alt", "Alt", "AltLeft", 18, true],
    ["BS", "Backspace", "Backspace", 8],
    ["F1", "F1", "F1", 112],
    ["F5", "F5", "F5", 116],
    ["F12", "F12", "F12", 123],
  ];

  function keyEvent(type, key, code, keyCode) {
    const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true });
    for (const prop of ["keyCode", "which"]) {
      try {
        Object.defineProperty(ev, prop, { get: () => keyCode });
      } catch (e) {}
    }
    return ev;
  }

  function send(type, key, code, keyCode) {
    // canvas から window までバブリングするので、SDL がどこで待ち受けていても届く
    const canvas = document.getElementById("canvas");
    (canvas || window).dispatchEvent(keyEvent(type, key, code, keyCode));
  }

  // 1文字を key/code/keyCode に変換（英数字と一部記号のみ）
  function charToKey(ch) {
    if (/^[a-zA-Z]$/.test(ch)) return [ch, "Key" + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)];
    if (/^[0-9]$/.test(ch)) return [ch, "Digit" + ch, ch.charCodeAt(0)];
    const map = { " ": ["Space", 32], "-": ["Minus", 189], "=": ["Equal", 187], ",": ["Comma", 188], ".": ["Period", 190], "/": ["Slash", 191] };
    if (map[ch]) return [ch, map[ch][0], map[ch][1]];
    return null;
  }

  function build() {
    const app = document.getElementById("app") || document.body;

    const bar = document.createElement("div");
    bar.id = "m-bar";
    bar.innerHTML =
      '<a href="../../">← 戻る</a>' +
      '<button type="button" id="m-toggle-keys">キー</button>' +
      '<button type="button" id="m-type">文字入力</button>' +
      '<span class="m-spacer"></span>' +
      '<button type="button" id="m-log">ログ</button>';
    document.body.insertBefore(bar, document.body.firstChild);

    const keys = document.createElement("div");
    keys.id = "m-keys";
    for (const [label, key, code, keyCode, latch] of KEYS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (latch) {
        b.addEventListener("click", (e) => {
          e.preventDefault();
          const on = !b.classList.contains("m-latched");
          b.classList.toggle("m-latched", on);
          send(on ? "keydown" : "keyup", key, code, keyCode);
        });
      } else {
        const down = (e) => {
          e.preventDefault();
          b.classList.add("m-down");
          send("keydown", key, code, keyCode);
        };
        const up = (e) => {
          e.preventDefault();
          if (!b.classList.contains("m-down")) return;
          b.classList.remove("m-down");
          send("keyup", key, code, keyCode);
        };
        b.addEventListener("pointerdown", down);
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
        b.addEventListener("pointerleave", up);
      }
      keys.appendChild(b);
    }
    app.appendChild(keys);

    const text = document.createElement("input");
    text.id = "m-text";
    text.type = "text";
    text.autocapitalize = "off";
    text.autocomplete = "off";
    text.spellcheck = false;
    document.body.appendChild(text);
    text.addEventListener("input", () => {
      for (const ch of text.value) {
        const k = charToKey(ch);
        if (!k) continue;
        const shift = /^[A-Z]$/.test(ch);
        if (shift) send("keydown", "Shift", "ShiftLeft", 16);
        send("keydown", k[0], k[1], k[2]);
        send("keyup", k[0], k[1], k[2]);
        if (shift) send("keyup", "Shift", "ShiftLeft", 16);
      }
      text.value = "";
    });
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Backspace") {
        e.preventDefault();
        const code = e.key;
        const kc = e.key === "Enter" ? 13 : 8;
        send("keydown", e.key, code, kc);
        send("keyup", e.key, code, kc);
      }
    });

    document.getElementById("m-toggle-keys").addEventListener("click", () => {
      keys.classList.toggle("m-hidden");
      window.dispatchEvent(new Event("resize"));
    });
    document.getElementById("m-type").addEventListener("click", () => text.focus());
    document.getElementById("m-log").addEventListener("click", () => {
      document.body.classList.toggle("m-console");
      const cb = document.getElementById("showConsole");
      if (cb && !cb.checked) cb.click();
    });

    // iOS のピンチズーム・ダブルタップズームを抑止
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
