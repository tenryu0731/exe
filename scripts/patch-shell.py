#!/usr/bin/env python3
"""Boxedwine の shell.html にスマホ向けの viewport と UI スクリプトを差し込む。

usage: patch-shell.py <boxedwine>/project/emscripten/shell.html
"""
import sys

path = sys.argv[1]
html = open(path, encoding="utf-8").read()
marker = "<!-- exe-launcher-mobile -->"
if marker in html:
    sys.exit(0)

head = (
    marker
    + '\n    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">'
    + '\n    <meta name="apple-mobile-web-app-capable" content="yes">'
    + '\n    <link rel="stylesheet" type="text/css" href="../../mobile.css">'
    + '\n    <script src="../../mobile.js"></script>\n'
)
if "</head>" not in html:
    sys.exit("shell.html: </head> not found")
html = html.replace("</head>", head + "  </head>", 1)
open(path, "w", encoding="utf-8").write(html)
