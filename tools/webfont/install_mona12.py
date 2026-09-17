#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import tempfile
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

REGULAR = 'Mona/02 Text Only/Mona12TextKR.woff2'
BOLD = 'Mona/02 Text Only/Mona12TextKR-Bold.woff2'
PREVIEW_TEXT = '나의 브랜드를 꾸며 보세요! 123 ABC 모나12 품절 교사 지급 전용'


def main() -> int:
    parser = argparse.ArgumentParser(description='Install Mona12 Text KR webfont assets for B.R.A.N.D. 2.0')
    parser.add_argument('archive', help='Path to MonaFont-woff2.zip')
    parser.add_argument('--out', default='public/fonts/mona12-kr', help='Output directory')
    args = parser.parse_args()

    archive = Path(args.archive).resolve()
    out = Path(args.out).resolve()
    if not archive.is_file():
        raise SystemExit(f'Archive not found: {archive}')

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zf:
        names = set(zf.namelist())
        missing = [name for name in (REGULAR, BOLD) if name not in names]
        if missing:
            raise SystemExit('Required Mona12 KR files are missing: ' + ', '.join(missing))
        # fontAssetUrl.ts resolves runtime faces as /<slug>/<weight>.woff2.
        (out / '400.woff2').write_bytes(zf.read(REGULAR))
        (out / '700.woff2').write_bytes(zf.read(BOLD))

    # Validate runtime faces and build a tiny fixed-string preview subset.
    TTFont(str(out / '400.woff2')).close()
    TTFont(str(out / '700.woff2')).close()

    with tempfile.TemporaryDirectory() as tmp_dir:
        source = Path(tmp_dir) / 'regular.woff2'
        shutil.copy2(out / '400.woff2', source)
        font = TTFont(str(source))
        options = subset.Options()
        options.flavor = 'woff2'
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text=PREVIEW_TEXT)
        subsetter.subset(font)
        font.flavor = 'woff2'
        font.save(str(out / 'preview.woff2'))
        font.close()

    TTFont(str(out / 'preview.woff2')).close()
    print('OK: Mona12 Text KR installed')
    print(f'  400.woff2:   {(out / "400.woff2").stat().st_size / 1024:.1f} KiB')
    print(f'  700.woff2:   {(out / "700.woff2").stat().st_size / 1024:.1f} KiB')
    print(f'  preview:     {(out / "preview.woff2").stat().st_size / 1024:.1f} KiB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
