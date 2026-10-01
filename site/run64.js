// 64bit の exe を wine64（Boxedwine64）で動かす。
// engine/64/ は WindowsAppPlayer（https://github.com/bassdrum4/windowsappplayer、GPL-2.0）が配布する
// Boxedwine64 の wasm64 マルチスレッド版。受け渡し方法も同プロジェクトの app.js（bootAndRun64 / putFile64）に倣う。
"use strict";
(function () {
  const L = (window.I18N && window.I18N.lang === "en") ? {
    back: "← Back", noid: "No app specified.", unsupported: "This browser cannot run the 64-bit engine (it needs WebAssembly Memory64 and SharedArrayBuffer). Try desktop Chrome, Edge or Firefox.",
    reading: "Reading the app…", booting: "Starting wine64… The first start downloads about {mb} MB and can take several minutes.",
    staging: "Copying {n} files into wine64…", running: "Running {name} (64-bit)", failed: "Failed: {msg}",
  } : {
    back: "← 戻る", noid: "起動するアプリが指定されていません。", unsupported: "このブラウザでは 64bit エンジンを動かせません（WebAssembly Memory64 と SharedArrayBuffer が必要です）。PC の Chrome・Edge・Firefox でお試しください。",
    reading: "アプリを読み込み中…", booting: "wine64 を起動中… 初回は約 {mb} MB をダウンロードするため数分かかります。",
    staging: "{n} 個のファイルを wine64 に渡しています…", running: "{name} を実行中（64bit）", failed: "失敗しました: {msg}",
  };
  const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const status = document.getElementById("status");
  const setStatus = (s, err) => { status.textContent = s; status.className = err ? "err" : ""; };
  document.getElementById("back").textContent = L.back;

  // WebAssembly Memory64（memory 型に i64 を使う最小モジュール）が使えるか
  function memory64Supported() {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1]));
    } catch (e) {
      return false;
    }
  }

  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const exe = params.get("exe") || "";

  async function waitFor(fn, timeoutMs, label) {
    const start = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - start > timeoutMs) throw new Error(label + " timeout");
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function main() {
    if (!id) return setStatus(L.noid, true);
    if (!memory64Supported() || typeof SharedArrayBuffer === "undefined" || !window.crossOriginIsolated) {
      return setStatus(L.unsupported, true);
    }
    setStatus(L.reading);
    const file = await loadGameFile(id);
    const index = await readZipIndex(file);
    const staged = [];
    for (const e of index.entries) {
      if (e.dir) continue;
      staged.push({ path: e.name, bytes: await zipEntryBytes(file, e) });
    }

    let rootMb = "215";
    try {
      const m = await (await fetch("engine/64/wine64.zip.manifest.json")).json();
      rootMb = String(Math.round(m.totalBytes / 1048576) + 10);
    } catch (e) {}
    setStatus(fmt(L.booting, { mb: rootMb }));
    const frame = document.getElementById("frame");
    frame.src = "engine/64/?chunked=1";
    await new Promise((r) => frame.addEventListener("load", r, { once: true }));
    const w = frame.contentWindow;
    // Emscripten の FS が使え、wine64 のセッション準備ができるまで待つ（初回は rootfs の取得と wineboot で長い）
    await waitFor(() => {
      const M = w.Module;
      if (!M || !M.FS || typeof M.FS.writeFile !== "function" || typeof M.ccall !== "function") return false;
      try { return M.ccall("bw64_session_ready", "number", [], []) === 1; } catch (e) { return false; }
    }, 15 * 60 * 1000, "wine64 session");

    setStatus(fmt(L.staging, { n: staged.length }));
    const FS = w.Module.FS;
    for (const f of staged) {
      const fsDest = "/root/home/username/userapp/" + f.path;
      let p = "";
      for (const part of fsDest.split("/").filter(Boolean).slice(0, -1)) {
        p += "/" + part;
        try { FS.mkdir(p); } catch (e) {}
      }
      try { FS.unlink(fsDest); } catch (e) {}
      FS.writeFile(fsDest, f.bytes);
      try { w.Module.ccall("bw64_register_file", "number", ["string"], ["/home/username/userapp/" + f.path]); } catch (e) {}
    }
    w.launchApp("Z:\\home\\username\\userapp\\" + exe.replace(/\//g, "\\"));
    setStatus(fmt(L.running, { name: exe.split("/").pop() }));
  }

  main().catch((e) => setStatus(fmt(L.failed, { msg: e.message }), true));
})();
