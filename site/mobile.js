// boxedwine.html（エミュレーター画面）に注入するスマホ向けUI
// 上部バー（戻る・キー表示切替・文字入力・ログ表示）と仮想キーボードを追加する。
(function () {
  "use strict";

  // ---------- 読み込みの進み具合表示 ----------
  // label -> { done, total, finished, waiting }。読み込みは順番に行われるので、予定分を最初から並べておく
  const loads = new Map(["エミュレーター", "ゲーム", "Wine 本体"].map((l) => [l, { done: 0, total: 0, waiting: true }]));
  let progressEl = null;
  let hideTimer = null;

  function renderProgress() {
    if (!document.body) return;
    if (!progressEl) {
      progressEl = document.createElement("div");
      progressEl.id = "m-progress";
      progressEl.addEventListener("click", () => progressEl.classList.add("m-hidden"));
      const bar = document.getElementById("m-bar");
      if (bar) bar.after(progressEl);
      else document.body.insertBefore(progressEl, document.body.firstChild);
    }
    progressEl.classList.remove("m-hidden");
    const rows = [];
    let active = false;
    for (const [label, p] of loads) {
      const mb = (n) => (n / 1048576).toFixed(0);
      const finished = !p.waiting && (p.error || (p.total ? p.done >= p.total : p.finished));
      if (!finished) active = true;
      const pct = p.total ? Math.min(100, Math.floor((p.done / p.total) * 100)) : null;
      const text = p.error
        ? label + "：失敗（" + p.error + "）"
        : p.waiting
          ? label + "：待機中"
          : finished
          ? label + "：完了（" + mb(p.done) + " MB）"
          : label + "：" + (pct === null ? "" : pct + "% ") + "（" + mb(p.done) + (p.total ? " / " + mb(p.total) : "") + " MB）";
      rows.push(
        '<div class="m-row"><span>' + text.replace(/</g, "&lt;") + "</span>" +
        '<progress max="' + (p.total || 1) + '" value="' + (finished ? p.total || 1 : p.total ? p.done : 0) + '"></progress></div>'
      );
    }
    if (!active) {
      rows.push('<div class="m-row m-note">読み込み完了。Wine を起動中です（初回は数分かかることがあります）。タップで閉じる</div>');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => progressEl.classList.add("m-hidden"), 30000);
    }
    progressEl.innerHTML = rows.join("");
  }

  // Response の本文を読みながら進み具合を記録する
  function track(label, response, total) {
    if (!response.ok || !response.body) return response;
    const p = { done: 0, total: total || Number(response.headers.get("Content-Length")) || 0, finished: false };
    loads.set(label, p);
    renderProgress();
    let lastDraw = 0;
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            p.finished = true;
            if (!p.total) p.total = p.done;
            renderProgress();
            controller.close();
            return;
          }
          p.done += value.byteLength;
          const now = Date.now();
          if (now - lastDraw > 200) {
            lastDraw = now;
            renderProgress();
          }
          controller.enqueue(value);
        } catch (e) {
          p.error = e.message;
          renderProgress();
          controller.error(e);
        }
      },
      cancel(reason) {
        reader.cancel(reason);
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

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
        return track("ゲーム", new Response(file, { headers: { "Content-Type": "application/zip" } }), file.size);
      } catch (e) {
        // 見つからなければ従来どおり（Service Worker の Cache）から読む
      }
    }
    const res = await originalFetch(input, init);
    if (/\/fs\/boxedwine\.zip$/.test(url.pathname)) return track("Wine 本体", res);
    if (m) return track("ゲーム", res);
    if (/\.wasm$/.test(url.pathname)) return track("エミュレーター", res);
    return res;
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
