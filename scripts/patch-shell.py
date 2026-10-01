#!/usr/bin/env python3
"""Boxedwine の Web シェルをスマホ向けに改変する。

- shell.html: viewport と スマホ用UI（mobile.css / mobile.js）を差し込む
- boxedwine-shell.js: 読み込んだZIPをメモリ上で複製しない（canOwn=true）
- source/io/fszip.cpp: ZIP内の時刻を端末のタイムゾーンではなくUTCで解釈する
  （mktime だと日本時間の端末で wine.inf の時刻がずれ、毎回 Wine の設定更新が走る）

usage: patch-shell.py <boxedwine>/project/emscripten
"""
import os
import sys

src = sys.argv[1]


def patch(name, old, new, marker):
    path = os.path.normpath(os.path.join(src, name))
    text = open(path, encoding="utf-8", newline="").read()
    if marker in text:
        return
    if old not in text:
        sys.exit(f"{name}: patch target not found: {old!r}")
    open(path, "w", encoding="utf-8", newline="").write(text.replace(old, new, 1))


patch(
    "shell.html",
    "</head>",
    "<!-- exe-launcher-mobile -->"
    '\n    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">'
    '\n    <meta name="apple-mobile-web-app-capable" content="yes">'
    '\n    <link rel="stylesheet" type="text/css" href="../../mobile.css">'
    '\n    <script src="../../mobile.js"></script>\n  </head>',
    "exe-launcher-mobile",
)

patch(
    "boxedwine-shell.js",
    "FS.createDataFile(dir, name, buf, true, true);",
    "FS.createDataFile(dir, name, buf, true, true, true); // exe-launcher: canOwn",
    "exe-launcher: canOwn",
)

patch(
    "../../source/io/fszip.cpp",
    "zipInfo[i].lastModified = ((U64)mktime(&tm))*1000l;",
    "zipInfo[i].lastModified = ((U64)timegm(&tm))*1000l; // exe-launcher: UTC",
    "exe-launcher: UTC",
)
