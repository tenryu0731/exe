# EXE Launcher

iPhone / iPad のブラウザで Windows の .exe ゲームを動かすための Web アプリです。
[Boxedwine](https://github.com/danoon2/Boxedwine)（Wine を WebAssembly 上で動かすエミュレーター）を GitHub Actions でビルドし、GitHub Pages で公開します。

公開URL（Pages を有効化した後）: https://tenryu0731.github.io/exe/

## 初回セットアップ（1回だけ）

1. GitHub のリポジトリで **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
2. **Actions** タブで「Build & Deploy」を実行する（`main` に push すると自動実行。初回失敗時は *Re-run all jobs*）
3. 完了後、上の公開URLを Safari で開く（ホーム画面に追加するとアプリ風に使える）

## 使い方

1. PC でゲームのフォルダを ZIP にして、iCloud Drive などで iPhone の「ファイル」に置く
2. ランチャーで「ファイルを選ぶ」→ ZIP（または単体の .exe）を選ぶ
3. 起動する EXE を選んで「起動」
   - 初回は Wine 本体をダウンロードします。Wi-Fi 推奨。以後はブラウザ内にキャッシュ
   - タップ＝マウスクリック。下部ボタンでキー入力、「文字入力」で英数字入力

## 構成

| パス | 内容 |
| --- | --- |
| `site/index.html` | ランチャー（ゲーム追加・一覧・起動設定）。ゲームは OPFS（ブラウザ内ファイル領域）に保存 |
| `site/sw.js` | Service Worker。ゲームZIPの配信、分割した Wine ファイルシステムの結合とキャッシュ、COOP/COEP 付与 |
| `site/store-worker.js` | ゲームファイルを少しずつ OPFS へ書き込む Worker（大きなZIP対応・日本語ファイル名の変換）|
| `site/mobile.js`, `mobile.css` | エミュレーター画面に注入するスマホ用UI（仮想キー等） |
| `scripts/patch-shell.py` | Boxedwine の Web シェルに上記UIを差し込み、ZIP をメモリ上で複製しないよう改変。ZIP内の時刻をUTCで解釈 |
| `scripts/prepare-filesystem.py` | Wine 本体の `.update-timestamp` を上記に合わせる（`--prune` で上流 Web 版と同じ規則のファイル削減も可能、既定では行わない） |
| `site/wine-saves.js` | Wine で動かしたソフトが作成・変更したファイル（Boxedwine がゲームごとの IndexedDB に保存）の書き出しと取り込み |
| `scripts/add-japanese.py` | Wine 本体に日本語環境を追加：ja_JP ロケール（無いと日本語モード＝コードページ 932 にならない）と、Kosugi フォントを「MS ゴシック」「MS 明朝」「メイリオ」等の名前で引けるようにしたフォント集（無いと日本語が □ になる） |
| `scripts/testpack/` | 「テスト用セット」（`site/demo/testpack.zip`）のソースと作成スクリプト `build.sh`（mingw-w64 が必要） |
| `scripts/probe/` | E2E 用の確認アプリ。日本語フォルダ・自分のフォルダへの保存・DirectX・日本語フォントなどを Wine 上で試す |
| `.github/workflows/mirror-fs.yml` | 開発用。配信用に整えた Wine 本体を `fs-mirror` ブランチに置く（開発環境から配布元に直接つながらないため） |
| `site/run64.html`, `run64.js` | 64bit の exe を wine64（Boxedwine64、`scripts/fetch-engine64.sh` で WindowsAppPlayer から取得）で動かす |
| `site/dos.html` | DOS の exe / com を DOSBox（js-dos の emulators、`site/vendor/js-dos/`）で動かす |
| `.github/workflows/deploy.yml` | Boxedwine（JIT版・互換版）のビルドと Pages への配備 |

## 制限

- RPGツクールMV/MZ は Wine を使わず、ゲーム本体（HTML5）をブラウザで直接動かす
- 64bit の exe は試験的な wine64 エンジン（WebAssembly Memory64 とマルチスレッドが必要。iPhone では動かない見込み）
- DOS の exe / com は DOSBox で動かす
- それ以外の主な対象は軽い 2D の古いゲーム。Direct3D 10 以降は非対応（Boxedwine 26R2 の changeLog より）
- iPhone のメモリ・CPU 次第で、起動しない／非常に遅いことがある
- 日本語のファイル名や文字（かな・漢字）を含むソフトは、UI が英語でも自動で日本語モード（LC_ALL=ja_JP.UTF-8）で起動する
- .NET 製のソフトは動かない（Wine Mono を含めていない。起動前に警告を出す）
- コンソール（文字だけの）アプリと .bat は Wine のコンソール窓で開く
- 16bit Windows（NE 形式）は Wine、DOS エクステンダー（LE 形式）は DOSBox で動かす。OS/2・ARM 版 Windows 用は非対応
- RAR・7z などは非対応（ZIP か展開済みフォルダで追加）。ZIP の圧縮方式は無圧縮と Deflate のみ

## ライセンス

Boxedwine は GPL-2.0。日本語フォントは Kosugi（Apache License 2.0、google/fonts）を書体名だけ変えて同梱（ライセンス文は Wine 本体内の `C:\windows\Fonts\msgothic-LICENSE.txt`）。ビルド済みエンジンの元コミットは配備物の `engine/BOXEDWINE_VERSION.txt` に記録されます。
