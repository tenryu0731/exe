// ゲームファイルを OPFS（ブラウザ内ファイル領域）へ少しずつ書き込む Worker。
// ファイル全体をメモリに載せないので、数百MBのZIPでも追加できる。
//
// メッセージ:
//   { op: "copy",    file, id }                 … ZIP をそのまま保存
//   { op: "rewrite", file, id, entries, cd }     … ファイル名を UTF-8 に変換して保存
//   { op: "wrapExe", file, id, name }            … 単体 EXE を無圧縮 ZIP に包んで保存
// 応答: { type: "progress", done, total } / { type: "done", size } / { type: "error", message }
"use strict";

const CHUNK = 8 * 1024 * 1024;

async function openTarget(id) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("games", { create: true });
  const handle = await dir.getFileHandle(id + ".zip", { create: true });
  const access = await handle.createSyncAccessHandle();
  access.truncate(0);
  return access;
}

async function readBytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function progress(done, total) {
  postMessage({ type: "progress", done, total });
}

// file[start, end) を out の pos へ書き写す
async function copyRange(file, start, end, out, pos, report) {
  for (let p = start; p < end; p += CHUNK) {
    const bytes = await readBytes(file, p, Math.min(end, p + CHUNK));
    out.write(bytes, { at: pos });
    pos += bytes.length;
    report(p + bytes.length);
  }
  return pos;
}

async function copy({ file, id }) {
  const out = await openTarget(id);
  try {
    const end = await copyRange(file, 0, file.size, out, 0, (d) => progress(d, file.size));
    out.flush();
    return end;
  } finally {
    out.close();
  }
}

// entries: [{ cdPos, localOffset, utf8Name(Uint8Array) }]  cd: { offset, size, eocdPos }
async function rewrite({ file, id, entries, cd }) {
  const out = await openTarget(id);
  try {
    const sorted = entries.slice().sort((a, b) => a.localOffset - b.localOffset);
    const newOffset = new Map();
    let pos = 0;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const next = i + 1 < sorted.length ? sorted[i + 1].localOffset : cd.offset;
      const head = await readBytes(file, e.localOffset, e.localOffset + 30);
      const hv = new DataView(head.buffer);
      if (hv.getUint32(0, true) !== 0x04034b50) throw new Error("ZIP のローカルヘッダが不正です");
      const oldNameLen = hv.getUint16(26, true);
      hv.setUint16(6, hv.getUint16(6, true) | 0x0800, true); // UTF-8 フラグ
      hv.setUint16(26, e.utf8Name.length, true);
      newOffset.set(e.localOffset, pos);
      out.write(head, { at: pos });
      pos += 30;
      out.write(e.utf8Name, { at: pos });
      pos += e.utf8Name.length;
      const bodyStart = e.localOffset + 30 + oldNameLen;
      pos = await copyRange(file, bodyStart, next, out, pos, (d) => progress(d, file.size));
    }

    // セントラルディレクトリを書き直す
    const cdStart = pos;
    const cdBytes = await readBytes(file, cd.offset, cd.offset + cd.size);
    const cv = new DataView(cdBytes.buffer);
    const byCdPos = new Map(entries.map((e) => [e.cdPos, e]));
    let p = 0;
    while (p < cdBytes.length) {
      if (cv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP のセントラルディレクトリが不正です");
      const nameLen = cv.getUint16(p + 28, true);
      const extraLen = cv.getUint16(p + 30, true);
      const commentLen = cv.getUint16(p + 32, true);
      const e = byCdPos.get(p);
      const fixed = cdBytes.slice(p, p + 46);
      const fv = new DataView(fixed.buffer);
      fv.setUint16(8, fv.getUint16(8, true) | 0x0800, true);
      fv.setUint16(28, e.utf8Name.length, true);
      fv.setUint32(42, newOffset.get(e.localOffset), true);
      out.write(fixed, { at: pos });
      pos += 46;
      out.write(e.utf8Name, { at: pos });
      pos += e.utf8Name.length;
      const rest = cdBytes.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen + commentLen);
      out.write(rest, { at: pos });
      pos += rest.length;
      p += 46 + nameLen + extraLen + commentLen;
    }
    const cdSize = pos - cdStart;

    const eocd = await readBytes(file, cd.eocdPos, file.size);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    out.write(eocd, { at: pos });
    pos += eocd.length;
    out.truncate(pos);
    out.flush();
    return pos;
  } finally {
    out.close();
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(crc, bytes) {
  crc = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

async function wrapExe({ file, id, name }) {
  if (file.size >= 0xffffffff) throw new Error("EXE が大きすぎます");
  const out = await openTarget(id);
  try {
    const nameBytes = new TextEncoder().encode(name);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); // 無圧縮
    lv.setUint32(18, file.size, true);
    lv.setUint32(22, file.size, true);
    lv.setUint16(26, nameBytes.length, true);
    let pos = 30 + nameBytes.length;
    let crc = 0;
    for (let p = 0; p < file.size; p += CHUNK) {
      const bytes = await readBytes(file, p, Math.min(file.size, p + CHUNK));
      crc = crc32(crc, bytes);
      out.write(bytes, { at: pos });
      pos += bytes.length;
      progress(p + bytes.length, file.size);
    }
    lv.setUint32(14, crc, true);
    out.write(local, { at: 0 });
    out.write(nameBytes, { at: 30 });

    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.size, true);
    cv.setUint32(24, file.size, true);
    cv.setUint16(28, nameBytes.length, true);
    const cdStart = pos;
    out.write(central, { at: pos });
    pos += 46;
    out.write(nameBytes, { at: pos });
    pos += nameBytes.length;

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, pos - cdStart, true);
    ev.setUint32(16, cdStart, true);
    out.write(eocd, { at: pos });
    pos += 22;
    out.truncate(pos);
    out.flush();
    return pos;
  } finally {
    out.close();
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    const fn = { copy, rewrite, wrapExe }[msg.op];
    if (!fn) throw new Error("unknown op " + msg.op);
    const size = await fn(msg);
    postMessage({ type: "done", size });
  } catch (e) {
    postMessage({ type: "error", message: (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e)) });
  }
};
