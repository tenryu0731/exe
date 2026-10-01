#!/usr/bin/env bash
# 64bit エンジン（Boxedwine64 の wasm64 マルチスレッド版 + wine64 rootfs）を取得して <out> に置く。
# 配布元: WindowsAppPlayer（https://github.com/bassdrum4/windowsappplayer、GPL-2.0）の 64/。
# usage: fetch-engine64.sh <commit> <out dir>
set -euo pipefail
commit="$1"; out="$2"
work="$(mktemp -d)"
git -C "$work" init -q
git -C "$work" remote add origin https://github.com/bassdrum4/windowsappplayer.git
git -C "$work" sparse-checkout set 64 >/dev/null
git -C "$work" fetch -q --depth 1 origin "$commit"
git -C "$work" checkout -q FETCH_HEAD
mkdir -p "$out"
cp -r "$work/64/." "$out/"
rm -f "$out/README.md"
# 分離設定はサイトの Service Worker が付けるので、付属の coi-serviceworker は使わない。
# ランチャーから iframe で使うため、デモ用のボタン類とログ欄を隠す。
python3 - "$out/index.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace('<script>window.coi = { coepCredentialless: () => false };</script>', "")
s = s.replace('<script src="coi-serviceworker.js"></script>', "")
if 'src="coi-serviceworker.js"' in s:
    sys.exit("coi-serviceworker reference remains")
s = s.replace("</head>", "<style>h1,#apps,#output,.hint{display:none!important}</style></head>", 1)
open(p, "w", encoding="utf-8").write(s)
PY
cat > "$out/NOTICE.md" <<NOTICE
# 64bit エンジン

WindowsAppPlayer（https://github.com/bassdrum4/windowsappplayer）commit $commit の 64/ をそのまま配置し、
index.html の coi-serviceworker 読み込みを外してデモ用 UI を非表示にしたもの。

- Boxedwine64（https://github.com/andrewnakas/Boxedwine64）— GPL-2.0。boxedwine64.wasm / boxedwine64.js / boxedwine-shell.js / wine64-launcher.js
- wine64（Debian）— LGPL-2.1。wine64.zip.part*
- glibc ほか rootfs — LGPL ほか各ライセンス。glibc-rootfs64.zip.part* / prefix64.zip.part*
NOTICE
du -sh "$out"
