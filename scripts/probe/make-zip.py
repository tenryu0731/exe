#!/usr/bin/env python3
"""E2E 用の確認アプリ ZIP を作る。日本語のフォルダ名を Shift_JIS・区切り「\\」で書く
（Windows の古い ZIP ツールが作る形。ランチャーが UTF-8・「/」に直せるかも確かめる）。

usage: make-zip.py <probe.exe> <out.zip>
"""
import struct
import sys
import zlib


def mkzip(path, entries):
    out = b""
    cd = b""
    for name, data in entries:
        crc = zlib.crc32(data) & 0xffffffff
        comp = zlib.compressobj(9, zlib.DEFLATED, -15)
        c = comp.compress(data) + comp.flush()
        lh = struct.pack("<IHHHHHIIIHH", 0x04034b50, 20, 0, 8, 0, 0, crc, len(c), len(data), len(name), 0)
        cd += struct.pack("<IHHHHHHIIIHHHHHII", 0x02014b50, 20, 20, 0, 8, 0, 0, crc, len(c), len(data),
                          len(name), 0, 0, 0, 0, 0, len(out)) + name
        out += lh + name + c
    end = struct.pack("<IHHHHIIH", 0x06054b50, 0, 0, len(entries), len(entries), len(cd), len(out), 0)
    open(path, "wb").write(out + cd + end)


sj = lambda s: s.encode("cp932")
mkzip(sys.argv[2], [
    (sj("テスト ゲーム\\Probe.exe"), open(sys.argv[1], "rb").read()),
    (sj("テスト ゲーム\\data\\test.txt"), b"hello from data"),
    (sj("テスト ゲーム\\データ\\日本語.txt"), "にほんご".encode("cp932")),
])
