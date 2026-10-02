// boxedwine.html（エミュレーター画面）に注入するスマホ向けUI
// 上部バー（戻る・キー表示切替・文字入力・ログ表示）と仮想キーボードを追加する。
(function () {
  "use strict";

  // 言語はランチャーが cookie "exe-lang" に保存したもの
  const EN = /(?:^|;\s*)exe-lang=en/.test(document.cookie) ||
    (!/(?:^|;\s*)exe-lang=/.test(document.cookie) && !(navigator.language || "").toLowerCase().startsWith("ja"));
  const L = EN ? {
    emu: "Starter program", app: "Your game", wine: "Windows parts (first time only)", failed: "failed", waiting: "waiting", done: "done",
    booting: "Ready. Starting the program… The first time, Windows sets itself up, which can take a few minutes. A black or blue screen for a while is normal. (Tap to hide)",
    intro: "Getting ready. The first time only, about 170 MB is downloaded — after that it starts quickly.",
    back: "← Back", keys: "Keys", type: "Type", log: "Log", full: "Full", colon: ": ",
    leave: "Quit the game and go back to the library? Progress you have not saved in the game will be lost.",
  } : {
    emu: "起動プログラム", app: "ゲーム本体", wine: "Windows の部品（初回のみ）", failed: "失敗", waiting: "待機中", done: "完了",
    booting: "準備ができました。ソフトを起動しています… 初回は Windows の初期設定があるため数分かかることがあります。しばらく黒や青の画面のままでも正常です。（タップで閉じる）",
    intro: "起動の準備をしています。初回だけ約 170MB をダウンロードします（2回目からは速く始まります）。",
    back: "← 戻る", keys: "キー", type: "文字入力", log: "詳細", full: "全画面", colon: "：",
    leave: "ゲームを終了してライブラリに戻りますか？ ゲーム内でセーブしていない進行は失われます。",
  };

  // ---------- 読み込みの進み具合表示 ----------
  // label -> { done, total, finished, waiting }。読み込みは順番に行われるので、予定分を最初から並べておく
  const loads = new Map([L.emu, L.app, L.wine].map((l) => [l, { done: 0, total: 0, waiting: true }]));
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
        ? label + L.colon + L.failed + " (" + p.error + ")"
        : p.waiting
          ? label + L.colon + L.waiting
          : finished
          ? label + L.colon + L.done + " (" + mb(p.done) + " MB)"
          : label + L.colon + (pct === null ? "" : pct + "% ") + "(" + mb(p.done) + (p.total ? " / " + mb(p.total) : "") + " MB)";
      rows.push(
        '<div class="m-row"><span>' + text.replace(/</g, "&lt;") + "</span>" +
        '<progress max="' + (p.total || 1) + '" value="' + (finished ? p.total || 1 : p.total ? p.done : 0) + '"></progress></div>'
      );
    }
    if (active) rows.unshift('<div class="m-row m-note">' + L.intro + "</div>");
    if (!active) {
      rows.push('<div class="m-row m-note">' + L.booting + "</div>");
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
        return track(L.app, new Response(file, { headers: { "Content-Type": "application/zip" } }), file.size);
      } catch (e) {
        // 見つからなければ従来どおり（Service Worker の Cache）から読む
      }
    }
    const res = await originalFetch(input, init);
    if (/\/fs\/boxedwine\.zip$/.test(url.pathname)) return track(L.wine, res);
    if (m) return track(L.app, res);
    if (/\.wasm$/.test(url.pathname)) return track(L.emu, res);
    return res;
  };

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

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error("load " + src));
      document.head.appendChild(el);
    });
  }

  function build() {
    const app = document.getElementById("app") || document.body;

    const bar = document.createElement("div");
    bar.id = "m-bar";
    bar.innerHTML =
      '<a href="../../" id="m-back">' + L.back + "</a>" +
      '<button type="button" id="m-toggle-keys">' + L.keys + "</button>" +
      '<button type="button" id="m-type">' + L.type + "</button>" +
      '<button type="button" id="m-full">' + L.full + "</button>" +
      '<span class="m-spacer"></span>' +
      '<button type="button" id="m-log">' + L.log + "</button>";
    document.body.insertBefore(bar, document.body.firstChild);

    // 画面上のキーボード（vkeys.js）。よく使うキーはゲームごとに選べる
    const appId = new URLSearchParams(location.search).get("app") || "default";
    const keys = { toggle() {}, hide() {} };
    const fs = { enter() {} };
    loadScript("../../vkeys.js").then(() => {
      Object.assign(keys, VKeys.mount({
        parent: app,
        storageId: appId,
        lang: EN ? "en" : "ja",
        send: (def, down) => send(down ? "keydown" : "keyup", def.key, def.code, def.keyCode),
      }));
      Object.assign(fs, VKeys.fullscreen({ lang: EN ? "en" : "ja", onToggleKeys: () => keys.toggle() }));
      window.dispatchEvent(new Event("resize"));
    });

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


    document.getElementById("m-toggle-keys").addEventListener("click", () => keys.toggle());
    document.getElementById("m-full").addEventListener("click", () => fs.enter());
    document.getElementById("m-type").addEventListener("click", () => text.focus());
    // 戻るとエミュレーターごと終わるので、遊び始めたあとは確認する
    const openedAt = Date.now();
    document.getElementById("m-back").addEventListener("click", (e) => {
      if (Date.now() - openedAt > 20000 && !confirm(L.leave)) e.preventDefault();
    });
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
