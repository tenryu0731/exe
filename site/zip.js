// ZIP の読み取り（ランチャーと 64bit 起動ページで共用）。ZIP 全体は読み込まず、目次と必要なエントリだけを読む。
// 他のスクリプト（js-dos など）と名前が衝突しないよう、関数スコープに閉じて必要なものだけ公開する。
(function () {
"use strict";
const zt = (key) => (window.I18N ? window.I18N.t(key) : key);
const utf8 = new TextDecoder("utf-8", { fatal: true });
let sjis = null;
try { sjis = new TextDecoder("shift_jis"); } catch (e) {}

async function sliceBytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

async function readZipIndex(file) {
  const tailLen = Math.min(file.size, 65536 + 22);
  const tail = await sliceBytes(file, file.size - tailLen, file.size);
  const tv = new DataView(tail.buffer);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error(zt("err.notzip"));
  const count = tv.getUint16(e + 10, true);
  const size = tv.getUint32(e + 12, true);
  const offset = tv.getUint32(e + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new Error(zt("err.zip64"));
  const cd = await sliceBytes(file, offset, offset + size);
  const cv = new DataView(cd.buffer);
  const entries = [];
  let needsRename = false;
  let p = 0;
  while (p + 46 <= cd.length) {
    if (cv.getUint32(p, true) !== 0x02014b50) throw new Error(zt("err.zipbroken"));
    const flags = cv.getUint16(p + 8, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    const raw = cd.subarray(p + 46, p + 46 + nameLen);
    let name;
    if (flags & 0x0800) name = new TextDecoder().decode(raw);
    else {
      try { name = utf8.decode(raw); }
      catch (err) {
        needsRename = true; // Windows で作った日本語ファイル名（Shift_JIS）
        name = sjis ? sjis.decode(raw) : String.fromCharCode.apply(null, raw);
      }
    }
    if (flags & 0x0001) throw new Error(zt("err.password"));
    entries.push({ cdPos: p, localOffset: cv.getUint32(p + 42, true), method: cv.getUint16(p + 10, true),
      compSize: cv.getUint32(p + 20, true), name, dir: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, needsRename, cd: { offset, size, eocdPos: file.size - tailLen + e } };
}

async function zipEntryBytes(file, e) {
  const head = new DataView(await file.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
  const start = e.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  let blob = file.slice(start, start + e.compSize);
  if (e.method === 8) blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  else if (e.method !== 0) throw new Error("unsupported compression: " + e.name);
  return new Uint8Array(await blob.arrayBuffer());
}


// exe のヘッダーから CPU の種類を調べる: "x86" / "x64" / "arm64" / "dos"（PE ヘッダーなし）/ null（読めない）
async function exeArch(file, entry) {
  const head = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  const start = entry.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = file.slice(start, start + entry.compSize);
  let bytes;
  if (entry.method === 0) bytes = new Uint8Array(await raw.slice(0, 8192).arrayBuffer());
  else if (entry.method === 8) {
    const reader = raw.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks = [];
    let got = 0;
    while (got < 8192) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
    reader.cancel().catch(() => {});
    bytes = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
  } else return null;
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null;
  const v = new DataView(bytes.buffer);
  const pe = v.getUint32(0x3c, true);
  if (pe + 6 > bytes.length || v.getUint32(pe, true) !== 0x00004550) return "dos";
  const machine = v.getUint16(pe + 4, true);
  if (machine === 0x8664) return "x64";
  if (machine === 0xaa64) return "arm64";
  if (machine === 0x14c) return "x86";
  return null;
}

window.sliceBytes = sliceBytes;
window.readZipIndex = readZipIndex;
window.zipEntryBytes = zipEntryBytes;
window.exeArch = exeArch;
})();
