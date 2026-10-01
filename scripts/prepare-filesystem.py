#!/usr/bin/env python3
"""配布元の Wine ファイルシステムZIPを、ブラウザ配信用に加工する。

1. --prune 指定時のみ、実行に不要なファイルを除く（上流 Boxedwine の Web 版と同じ規則）。
   既定では除かない（完全版のまま配信する）
   - web_runtime_policy.json の remove_files（上流 tools/buildWine/ で監査済みの一覧。
     Boxedwine commit 922848c の同名ファイルを複製）
   - Wine の開発用ファイル（opt/wine/include/、opt/wine/lib/**/*.a）、SDK ツール
   - Vulkan / DXVK / Gecko、winetricks、テスト用 EXE
   上流 tools/buildWine/web_runtime.py の exclusions() と build_wine.is_wine_development_file() に準拠。
2. home/username/.wine/.update-timestamp を、wine.inf の ZIP 内時刻を UTC とみなした値にする
   （Boxedwine を ZIP 時刻 UTC 解釈に改変しているため。patch-shell.py 参照。合わないと
   起動のたびに Wine のプレフィックス更新が走る）
3. installed.txt から除いたパッケージを外す

残すエントリは圧縮済みデータをそのままコピーする。

usage: prepare-filesystem.py [--prune] <in.zip> <out.zip>
"""
import calendar
import json
import os
import struct
import sys
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
POLICY = json.load(open(os.path.join(HERE, "web_runtime_policy.json"), encoding="utf-8"))
DRIVE = "home/username/.wine/drive_c/"
STAMP = "home/username/.wine/.update-timestamp"
WINE_INF = "opt/wine/share/wine/wine.inf"
SDK_TOOLS = {"function_grep.pl", "widl", "winebuild", "winecpp", "winedump",
             "wineg++", "winegcc", "winemaker", "wmc", "wrc"}
VULKAN = {"libvulkan.so", "libvulkan.so.1", "winevulkan.dll", "winevulkan.dll.so", "winevulkan.so",
          "vulkan-1.dll", "vulkan-1.dll.so"}
REMOVE_FILES = {n for group in POLICY["remove_files"].values() for n in group}
REQUIRED = {"opt/wine/lib/wine/i386-unix/wine", DRIVE + "windows/system32/shell32.dll",
            DRIVE + "webgl/wined3d.dll", DRIVE + "windows/temp/", STAMP, WINE_INF}


def excluded(name):
    if name in REMOVE_FILES:
        return True
    if name.rstrip("/") == "opt/wine/include" or name.startswith("opt/wine/include/"):
        return True
    if name.startswith("opt/wine/lib/") and name.endswith(".a"):
        return True
    if name.startswith(("dep/", DRIVE + "dxvk/", DRIVE + "windows/system32/gecko/")):
        return True
    if name in {"packages.txt", "recreateInstructions.txt", "usr/local/bin/winetricks", DRIVE + "webgl/ddraw_test.exe"}:
        return True
    base = name.rsplit("/", 1)[-1]
    if base.endswith(".link"):
        base = base[:-5]
    if base in VULKAN:
        return True
    return name.startswith("opt/wine/bin/") and base in SDK_TOOLS


def main(src, dst, prune=False):
    zin = zipfile.ZipFile(src)
    names = set(zin.namelist())
    missing = REQUIRED - names
    if missing:
        sys.exit(f"required entries missing: {sorted(missing)}")

    replace = {}
    old = zin.read(STAMP)
    value = calendar.timegm(zin.getinfo(WINE_INF).date_time + (0, 0, 0))
    digits = old.rstrip(b"\r\n")
    replace[STAMP.encode()] = str(value).encode() + old[len(digits):]
    print(f"wine.inf {zin.getinfo(WINE_INF).date_time} -> {value}; .update-timestamp {old!r} -> {replace[STAMP.encode()]!r}")
    if "installed.txt" in names:
        lines = zin.read("installed.txt").decode().split()
        kept = [n for n in dict.fromkeys(lines) if n not in POLICY["remove_packages"]]
        replace[b"installed.txt"] = "".join(n + "\n" for n in kept).encode()

    data = open(src, "rb").read()
    eocd = data.rfind(b"PK\x05\x06")
    count, cd_size, cd_offset = struct.unpack_from("<HII", data, eocd + 10)
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
    kept = [r for r in records if not (prune and excluded(r["name"].decode("utf-8", "replace")))]
    removed = len(records) - len(kept)

    with open(dst, "wb") as out:
        for r in sorted(kept, key=lambda r: r["local"]):
            start, end = r["local"], next_offset[r["local"]]
            struct.pack_into("<I", r["cd"], 42, out.tell())
            if r["name"] in replace:
                new = replace[r["name"]]
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
        for r in kept:
            out.write(r["cd"])
        tail = bytearray(data[eocd:])
        struct.pack_into("<HHII", tail, 8, len(kept), len(kept), out.tell() - cd_start, cd_start)
        out.write(tail)

    check = zipfile.ZipFile(dst)
    bad = check.testzip()
    if bad is not None:
        sys.exit(f"rewritten zip failed CRC check: {bad}")
    out_names = set(check.namelist())
    if REQUIRED - out_names:
        sys.exit(f"required entries removed: {sorted(REQUIRED - out_names)}")
    if check.read(STAMP) != replace[STAMP.encode()]:
        sys.exit("timestamp not rewritten")
    print(f"removed {removed} of {len(records)} entries; {os.path.getsize(src):,} -> {os.path.getsize(dst):,} bytes")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--prune"]
    main(args[0], args[1], prune="--prune" in sys.argv[1:])
