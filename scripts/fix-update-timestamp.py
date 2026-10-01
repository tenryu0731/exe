#!/usr/bin/env python3
"""Wine ファイルシステムZIPの home/username/.wine/.update-timestamp を書き換える。

Wine は .update-timestamp の値と wine.inf の更新時刻が違うと、起動時に
プレフィックスの更新（"The Wine configuration ... is being updated"）を行う。
Boxedwine は ZIP の時刻を UTC として解釈するよう改変しているので
（patch-shell.py 参照）、wine.inf の ZIP 内時刻を UTC とみなした値を書き込む。

他のエントリは圧縮済みデータをそのままコピーし、目次（セントラルディレクトリ）は
オフセット等だけを書き換える。

usage: fix-update-timestamp.py <in.zip> <out.zip>
"""
import calendar
import struct
import sys
import zipfile
import zlib

STAMP = b"home/username/.wine/.update-timestamp"
WINE_INF = "opt/wine/share/wine/wine.inf"

src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
old = zin.read(STAMP.decode())
value = calendar.timegm(zin.getinfo(WINE_INF).date_time + (0, 0, 0))
digits = old.rstrip(b"\r\n")
new = str(value).encode() + old[len(digits):]
print(f"wine.inf {zin.getinfo(WINE_INF).date_time} -> {value}; .update-timestamp {old!r} -> {new!r}")

data = open(src, "rb").read()
eocd = data.rfind(b"PK\x05\x06")
count, cd_size, cd_offset = struct.unpack_from("<HII", data, eocd + 10)

# セントラルディレクトリを読む
records = []
p = cd_offset
for _ in range(count):
    if data[p:p + 4] != b"PK\x01\x02":
        sys.exit("bad central directory")
    nlen, xlen, clen = struct.unpack_from("<HHH", data, p + 28)
    local = struct.unpack_from("<I", data, p + 42)[0]
    name = data[p + 46:p + 46 + nlen]
    records.append({"cd": bytearray(data[p:p + 46 + nlen + xlen + clen]), "local": local, "name": name})
    p += 46 + nlen + xlen + clen

ends = sorted(r["local"] for r in records) + [cd_offset]
next_offset = {start: ends[i + 1] for i, start in enumerate(ends[:-1])}

with open(dst, "wb") as out:
    for r in sorted(records, key=lambda r: r["local"]):
        start, end = r["local"], next_offset[r["local"]]
        new_offset = out.tell()
        struct.pack_into("<I", r["cd"], 42, new_offset)
        if r["name"] == STAMP:
            nlen, xlen = struct.unpack_from("<HH", data, start + 26)
            header = bytearray(data[start:start + 30 + nlen + xlen])
            crc = zlib.crc32(new)
            flags = struct.unpack_from("<H", header, 6)[0] & ~0x0008  # データ記述子なし
            struct.pack_into("<HH", header, 6, flags, 0)  # 無圧縮
            struct.pack_into("<III", header, 14, crc, len(new), len(new))
            out.write(header)
            out.write(new)
            struct.pack_into("<HH", r["cd"], 8, flags, 0)
            struct.pack_into("<III", r["cd"], 16, crc, len(new), len(new))
        else:
            out.write(data[start:end])
    cd_start = out.tell()
    for r in records:
        out.write(r["cd"])
    tail = bytearray(data[eocd:])
    struct.pack_into("<II", tail, 12, out.tell() - cd_start, cd_start)
    out.write(tail)

check = zipfile.ZipFile(dst)
bad = check.testzip()
if bad is not None:
    sys.exit(f"rewritten zip failed CRC check: {bad}")
if check.read(STAMP.decode()) != new or len(check.infolist()) != count:
    sys.exit("rewritten zip mismatch")
print("ok", count, "entries")
