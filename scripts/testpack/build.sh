#!/bin/sh
# テスト用セット（site/demo/testpack.zip）を作る。mingw-w64（i686 と x86_64）が必要
set -eu
cd "$(dirname "$0")"
dest=$(cd ../../site/demo && pwd)/testpack.zip
out=$(mktemp -d)
mkdir -p "$out/01_Probe/data" "$out/01_Probe/データ" "$out/02_Input" "$out/03_Anim_Sound" "$out/04_Console" "$out/05_Batch" "$out/06_64bit" "$out/07_DOS"
i686-w64-mingw32-gcc -O1 -s -o "$out/01_Probe/Probe.exe" ../probe/probe.c -mwindows -lgdi32
printf 'hello from data' > "$out/01_Probe/data/test.txt"
printf '\202\311\202\331\202\361\202\262' > "$out/01_Probe/データ/日本語.txt"
i686-w64-mingw32-gcc -O1 -s -o "$out/02_Input/Input.exe" input.c -mwindows -lgdi32
i686-w64-mingw32-gcc -O1 -s -o "$out/03_Anim_Sound/Anim.exe" anim.c -mwindows -lgdi32 -lwinmm
i686-w64-mingw32-gcc -O1 -s -o "$out/04_Console/Hello.exe" hello-console.c
cp start.bat "$out/05_Batch/start.bat"
x86_64-w64-mingw32-gcc -O1 -s -o "$out/06_64bit/Hello64.exe" hello64.c -mwindows
# DOS の .COM：文字を出してキー入力を待ち、終了する（16 バイトの機械語 + 文字列）
python3 - "$out/07_DOS/HELLO.COM" <<'PY'
import sys
code = bytes([0xBA, 0x10, 0x01, 0xB4, 0x09, 0xCD, 0x21, 0xB4, 0x01, 0xCD, 0x21, 0xB8, 0x00, 0x4C, 0xCD, 0x21])
msg = b"HELLO FROM DOS\r\nDOS test OK. Press any key to exit.\r\n$"
open(sys.argv[1], "wb").write(code + msg)
PY
cp README.txt "$out/README.txt"
rm -f "$dest"
(cd "$out" && find . -type f | sort | sed 's|^\./||' | python3 -c "
import sys, zipfile
with zipfile.ZipFile('$dest', 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sys.stdin.read().split('\n'):
        if name: z.write(name, name)
")
rm -rf "$out"
ls -l "$dest"
