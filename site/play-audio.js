// ブラウザで直接遊ぶ HTML5 ゲーム（RPGツクールMV/MZ）の音声補正。Service Worker が index.html の先頭に差し込む。
//  1. iPhone のマナーモード中も Web Audio が鳴るよう、音声セッションを「再生」にする
//  2. ブラウザが Ogg Vorbis を decodeAudioData できないとき、同梱の WASM デコーダーで代わりにデコードする
(function () {
  "use strict";

  // ---------- 1. マナーモード対策 ----------
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch (e) {}
  // Audio Session API が無い環境向け：無音の <audio> を流すと iOS の音声カテゴリが「再生」になる
  function silentWav() {
    const rate = 8000, samples = 800;
    const buf = new DataView(new ArrayBuffer(44 + samples));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); buf.setUint32(4, 36 + samples, true); w(8, "WAVE"); w(12, "fmt ");
    buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
    buf.setUint32(24, rate, true); buf.setUint32(28, rate, true); buf.setUint16(32, 1, true); buf.setUint16(34, 8, true);
    w(36, "data"); buf.setUint32(40, samples, true);
    for (let i = 0; i < samples; i++) buf.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf.buffer], { type: "audio/wav" }));
  }
  let unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      const a = new Audio(silentWav());
      a.loop = true;
      a.setAttribute("playsinline", "");
      a.play().catch(() => { unlocked = false; });
      document.addEventListener("visibilitychange", () => { if (!document.hidden) a.play().catch(() => {}); });
    } catch (e) {}
  }
  for (const t of ["touchend", "mouseup", "keydown"]) document.addEventListener(t, unlock, true);

  // ---------- 2. Ogg Vorbis のデコード代行 ----------
  const Ctx = window.BaseAudioContext || window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !Ctx.prototype.decodeAudioData) return;
  const original = Ctx.prototype.decodeAudioData;
  let decoderPromise = null;

  function loadDecoder() {
    if (!decoderPromise) {
      decoderPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "../../vendor/ogg-vorbis-decoder.min.js";
        s.onload = () => {
          const lib = window["ogg-vorbis-decoder"];
          if (!lib) return reject(new Error("decoder not loaded"));
          resolve(lib.OggVorbisDecoder);
        };
        s.onerror = () => reject(new Error("decoder load failed"));
        document.head.appendChild(s);
      });
    }
    return decoderPromise;
  }

  function isOgg(bytes) {
    return bytes.length > 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
  }

  async function decodeOgg(ctx, bytes) {
    const Decoder = await loadDecoder();
    const decoder = new Decoder();
    await decoder.ready;
    try {
      const r = await decoder.decodeFile(bytes);
      if (!r.samplesDecoded) throw new Error("no samples");
      const out = ctx.createBuffer(r.channelData.length, r.samplesDecoded, r.sampleRate);
      r.channelData.forEach((ch, i) => out.copyToChannel(ch.subarray(0, r.samplesDecoded), i));
      return out;
    } finally {
      decoder.free();
    }
  }

  Ctx.prototype.decodeAudioData = function (data, success, failure) {
    const ctx = this;
    const copy = data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : null; // 元の呼び出しで data は切り離される
    const nativeTry = new Promise((resolve, reject) => {
      try {
        const p = original.call(ctx, data, resolve, reject);
        if (p && typeof p.then === "function") p.then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
    const result = nativeTry.catch((err) => {
      if (copy && isOgg(copy)) return decodeOgg(ctx, copy);
      throw err;
    });
    result.then((b) => success && success(b), (e) => failure && failure(e));
    return result;
  };
})();
