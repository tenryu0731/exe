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

// 64bit 値（2^53 未満）を読む
function u64(v, at) {
  return v.getUint32(at, true) + v.getUint32(at + 4, true) * 4294967296;
}

async function readZipIndex(file) {
  const tailLen = Math.min(file.size, 65536 + 22);
  const tailStart = file.size - tailLen;
  const tail = await sliceBytes(file, tailStart, file.size);
  const tv = new DataView(tail.buffer);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error(zt("err.notzip"));
  let count = tv.getUint16(e + 10, true);
  let size = tv.getUint32(e + 12, true);
  let offset = tv.getUint32(e + 16, true);
  let zip64 = false;
  // ZIP64（4GB 超・65535 ファイル超）：EOCD の直前にある ZIP64 ロケーターから本来の値を読む
  if (e >= 20 && tv.getUint32(e - 20, true) === 0x07064b50) {
    const recPos = u64(tv, e - 20 + 8);
    const rec = await sliceBytes(file, recPos, recPos + 56);
    const rv = new DataView(rec.buffer);
    if (rv.getUint32(0, true) !== 0x06064b50) throw new Error(zt("err.zipbroken"));
    count = u64(rv, 32);
    size = u64(rv, 40);
    offset = u64(rv, 48);
    zip64 = true;
  } else if (count === 0xffff && size === 0xffffffff) throw new Error(zt("err.zipbroken"));
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
    // 一部の Windows 用ツールは区切りに「\」を使う。Wine 側ではフォルダとして扱われないので「/」に直す
    if (name.indexOf("\\") >= 0) {
      name = name.replace(/\\/g, "/");
      needsRename = true;
    }
    if (flags & 0x0001) throw new Error(zt("err.password"));
    let compSize = cv.getUint32(p + 20, true);
    let rawSize = cv.getUint32(p + 24, true);
    let localOffset = cv.getUint32(p + 42, true);
    if (compSize === 0xffffffff || rawSize === 0xffffffff || localOffset === 0xffffffff) {
      // ZIP64 拡張フィールド：0xffffffff になっている項目だけが、この順で入っている
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cv.getUint16(x, true);
        const len = cv.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          if (rawSize === 0xffffffff) { rawSize = u64(cv, q); q += 8; }
          if (compSize === 0xffffffff) { compSize = u64(cv, q); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = u64(cv, q); q += 8; }
          zip64 = true;
          break;
        }
        x += 4 + len;
      }
    }
    entries.push({ cdPos: p, localOffset, method: cv.getUint16(p + 10, true), compSize, size: rawSize, name, dir: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, needsRename, zip64, cd: { offset, size, eocdPos: tailStart + e } };
}

// エミュレーターの ZIP 読み込み（zlib）が扱える圧縮方式は「無圧縮」と「Deflate」だけ。
// それ以外（Deflate64・LZMA・BZip2 など）が使われているファイル名を返す
function unsupportedEntry(index) {
  const bad = index.entries.find((x) => !x.dir && x.method !== 0 && x.method !== 8);
  return bad ? bad.name + " (method " + bad.method + ")" : null;
}

// 起動候補にしないもの：macOS が ZIP に入れる管理用ファイル
function isJunkPath(name) {
  return /(^|\/)__MACOSX\//.test(name) || /(^|\/)\._/.test(name);
}

async function zipEntryBytes(file, e) {
  const head = new DataView(await file.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
  const start = e.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  let blob = file.slice(start, start + e.compSize);
  if (e.method === 8) blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  else if (e.method !== 0) throw new Error("unsupported compression: " + e.name);
  return new Uint8Array(await blob.arrayBuffer());
}


// exe のヘッダーを調べる。戻り値（文字列）:
//   "x86" / "x64" / "arm64" … Windows（PE）の CPU
//   "win16" … Windows 3.x の 16bit 版（NE）。Wine で動く
//   "dos" … DOS（PE などのヘッダーなし、または DOS エクステンダーの LE）
//   "os2" … OS/2（LX）
//   null … 読めない
// exeInfo は加えて { arch, dotnet（.NET 製か）, console（コンソールアプリか）} を返す
async function readEntryHead(file, entry, want) {
  const head = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  const start = entry.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = file.slice(start, start + entry.compSize);
  if (entry.method === 0) return new Uint8Array(await raw.slice(0, want).arrayBuffer());
  if (entry.method !== 8) return null;
  const reader = raw.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let got = 0;
  while (got < want) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
  }
  reader.cancel().catch(() => {});
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  return bytes;
}

async function exeInfo(file, entry) {
  let bytes = await readEntryHead(file, entry, 8192);
  if (!bytes || bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return { arch: null };
  let v = new DataView(bytes.buffer);
  const lfanew = v.getUint32(0x3c, true);
  // DOS スタブが大きく、新しいヘッダーが先頭 8KB より後ろにある exe もある
  if (lfanew + 512 > bytes.length && lfanew < 1048576 && (entry.size || Infinity) > lfanew + 2) {
    bytes = await readEntryHead(file, entry, lfanew + 1024);
    v = new DataView(bytes.buffer);
  }
  if (lfanew + 2 > bytes.length) return { arch: "dos" };
  const sig = String.fromCharCode(bytes[lfanew], bytes[lfanew + 1]);
  if (sig === "NE") return { arch: "win16" };
  if (sig === "LE") return { arch: "dos" };
  if (sig === "LX") return { arch: "os2" };
  if (sig !== "PE" || lfanew + 24 > bytes.length || bytes[lfanew + 2] !== 0 || bytes[lfanew + 3] !== 0) return { arch: "dos" };
  const machine = v.getUint16(lfanew + 4, true);
  const arch = machine === 0x8664 ? "x64" : machine === 0xaa64 ? "arm64" : machine === 0x14c ? "x86" : null;
  const opt = lfanew + 24;
  const info = { arch, dotnet: false, console: false };
  if (opt + 2 > bytes.length) return info;
  const magic = v.getUint16(opt, true); // 0x10b = PE32, 0x20b = PE32+
  if (opt + 70 <= bytes.length) info.console = v.getUint16(opt + 68, true) === 3; // IMAGE_SUBSYSTEM_WINDOWS_CUI
  // データディレクトリ 14 番（CLR ランタイムヘッダー）があれば .NET 製
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  if (dirs + 15 * 8 <= bytes.length) {
    const n = v.getUint32(dirs - 4, true);
    if (n > 14 && v.getUint32(dirs + 14 * 8, true) !== 0) info.dotnet = true;
  }
  return info;
}

async function exeArch(file, entry) {
  return (await exeInfo(file, entry)).arch;
}

// 追加済みのゲーム ZIP を開く。OPFS になければ Cache Storage（OPFS が使えないブラウザでの保存先）から
async function loadGameFile(id) {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("games");
    return await (await dir.getFileHandle(id + ".zip")).getFile();
  } catch (e) {
    const cache = await caches.open("exe-games-v1");
    const res = await cache.match(new URL("games/" + id + ".zip", location.href).href);
    if (!res) throw e;
    return res.blob();
  }
}

window.loadGameFile = loadGameFile;
window.sliceBytes = sliceBytes;
window.readZipIndex = readZipIndex;
window.zipEntryBytes = zipEntryBytes;
window.exeArch = exeArch;
window.exeInfo = exeInfo;
window.unsupportedEntry = unsupportedEntry;
window.isJunkPath = isJunkPath;
})();
