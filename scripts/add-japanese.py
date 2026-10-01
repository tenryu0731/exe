#!/usr/bin/env python3
"""Wine ファイルシステムZIPに日本語環境（フォントとロケール）を追加する。

1. ロケール：配布元には en_US.utf8 しかなく、LC_ALL=ja_JP.UTF-8 を指定しても C ロケールに
   落ちて Wine が英語（コードページ 1252）で動く。日本語のゲームの多くは Shift_JIS（932）前提の
   A 版 API を使うので、ファイル名や文字列が化けて起動に失敗する。Wine は文字コード表を自前で
   持ち、Linux 側のロケールは名前（ja_JP）の判定にしか使わないので、en_US.utf8 の中身を
   ja_JP.utf8 として複製する（UTF-8 の文字分類は言語に依存しない）。
2. フォント：配布元には日本語（CJK）フォントが入っておらず、日本語のゲームやアプリの文字が
   すべて □ になる。Kosugi（Apache License 2.0、JIS 第1・第2水準をほぼ網羅、
半角英数字は全角のちょうど半分の幅）を元に、Windows の日本語ゲームがよく指定する書体名
（MS ゴシック・MS 明朝・メイリオ など）で引けるフォントコレクション（TTC）を作り、
C:\\windows\\Fonts\\msgothic.ttc として入れる。グリフは全書体で共有するので大きさは 1 書体分。
レジストリの置換設定に頼らないので、ゲームごとに保存された古いレジストリがあっても効く。

usage: add-japanese.py <Kosugi-Regular.ttf> <LICENSE.txt> <filesystem.zip>
"""
import io
import sys
import zipfile

from fontTools.ttLib import TTFont
from fontTools.ttLib.ttCollection import TTCollection

DEST = "home/username/.wine/drive_c/windows/Fonts/"
LOCALE_SRC = "usr/lib/locale/en_US.utf8/"
LOCALE_DST = "usr/lib/locale/ja_JP.utf8/"

# (英語名, 日本語名, PostScript 名)
FACES = [
    ("MS Gothic", "ＭＳ ゴシック", "MS-Gothic"),
    ("MS PGothic", "ＭＳ Ｐゴシック", "MS-PGothic"),
    ("MS UI Gothic", None, "MS-UIGothic"),
    ("MS Mincho", "ＭＳ 明朝", "MS-Mincho"),
    ("MS PMincho", "ＭＳ Ｐ明朝", "MS-PMincho"),
    ("Meiryo", "メイリオ", "Meiryo"),
    ("Meiryo UI", None, "Meiryo-UI"),
    ("Yu Gothic", "游ゴシック", "YuGothic-Regular"),
    ("Yu Gothic UI", None, "YuGothicUI-Regular"),
    ("Yu Mincho", "游明朝", "YuMincho-Regular"),
]


def face(src, en, ja, ps):
    font = TTFont(src)
    if "DSIG" in font:
        del font["DSIG"]
    name = font["name"]
    keep = {0, 5, 9, 12, 13, 14}
    name.names = [n for n in name.names if n.nameID in keep]
    for lang, family in ((0x409, en), (0x411, ja)):
        if not family:
            continue
        name.setName(family, 1, 3, 1, lang)
        name.setName("Regular", 2, 3, 1, lang)
        name.setName(family, 4, 3, 1, lang)
    name.setName(ps + ";Kosugi 4.002", 3, 3, 1, 0x409)
    name.setName(ps, 6, 3, 1, 0x409)
    name.setName("Based on Kosugi (Apache License 2.0), renamed for Windows font compatibility", 10, 3, 1, 0x409)
    return font


def main(src, license_path, zip_path):
    coll = TTCollection()
    coll.fonts = [face(src, *f) for f in FACES]
    buf = io.BytesIO()
    coll.save(buf, shareTables=True)
    data = buf.getvalue()
    with zipfile.ZipFile(zip_path, "a", compression=zipfile.ZIP_DEFLATED) as z:
        names = set(z.namelist())
        if DEST + "msgothic.ttc" in names:
            sys.exit("font already present")
        locale = [i for i in z.infolist() if i.filename.startswith(LOCALE_SRC)]
        if not locale:
            sys.exit("no " + LOCALE_SRC + " in the filesystem")
        for info in locale:
            dst = LOCALE_DST + info.filename[len(LOCALE_SRC):]
            if dst in names:
                continue
            copy = zipfile.ZipInfo(dst, info.date_time)
            copy.external_attr = info.external_attr
            z.writestr(copy, b"" if info.is_dir() else z.read(info), zipfile.ZIP_DEFLATED)
        z.writestr(zipfile.ZipInfo(DEST + "msgothic.ttc", (2026, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
        z.writestr(zipfile.ZipInfo(DEST + "msgothic-LICENSE.txt", (2026, 1, 1, 0, 0, 0)),
                   open(license_path, "rb").read(), zipfile.ZIP_DEFLATED)
    print(f"added msgothic.ttc ({len(data):,} bytes, {len(FACES)} faces) and {len(locale)} ja_JP.utf8 locale entries")


if __name__ == "__main__":
    main(*sys.argv[1:4])
