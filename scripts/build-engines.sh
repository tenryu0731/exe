#!/usr/bin/env bash
# Boxedwine の Web エンジン（JIT 版・互換版）をビルドして engine-out/ に置く。
# usage: build-engines.sh <boxedwine checkout> <out dir>
# 前提: emsdk が有効になっていること。この内容と patch-shell.py がビルド結果キャッシュのキーになる。
set -euo pipefail
src="$1"; out="$2"
here="$(cd "$(dirname "$0")" && pwd)"
cd "$src/project/emscripten"
python3 "$here/patch-shell.py" .
# 新しい emscripten では emcc でのリンク時に libc++ が入らないため em++ でリンクする
sed -i 's/^\t@\$(CC) \$(ALL) -o \$@ \$(LDFLAGS)$/\t@$(CXX) $(ALL) -o $@ $(LDFLAGS)/' makefile
grep -q '@$(CXX) $(ALL) -o' makefile
make jit
make release
for pair in jit:Jit compat:Release; do
  name="${pair%%:*}"; dir="${pair##*:}"
  mkdir -p "$out/$name"
  cp Build/$dir/boxedwine.{html,js,wasm,css} Build/$dir/boxedwine-shell.js "$out/$name/"
done
