EXE Launcher テスト用セット / test pack

「起動するファイル」で 1 つ選んで起動します。成功するとこうなります。

01_Probe/Probe.exe        日本語・セーブ・DirectX・フォントの確認。緑の「OK」が並び、
                          赤の「NG」は Wine Mono の 1 行だけ（.NET は未対応のため）。
02_Input/Input.exe        画面をなぞると青い線が描かれ、押したキーと入力した文字が表示される。
03_Anim_Sound/Anim.exe    黄色いボールが跳ね回り、壁に当たるたびに音が鳴る。左上に FPS（1 秒の描画回数）。
04_Console/Hello.exe      黒い窓で名前を聞かれ、入力すると「Hello, 名前! It works.」と返す
                          （日本語モードでは文字の間が広く表示される。Wine の仕様）。
05_Batch/start.bat        黒い窓に「If you can read this, .bat files work.」と出る。
06_64bit/Hello64.exe      「64-bit OK」と出る（試験的な 64bit 用エンジン。PC・Android の Chrome・Edge・Firefox
                          向けで、数分かかるか起動しないこともある。iPhone・iPad ではブラウザによらず
                          「まだ 64bit のソフトを動かせません」と出るのが正しい動き）。
07_DOS/HELLO.COM          DOS の画面に「HELLO FROM DOS」と出て、キーを押すと終わる。

すべてこのランチャーのために書いた小さなプログラムです（scripts/testpack にソースあり）。
