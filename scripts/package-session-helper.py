#!/usr/bin/env python3
"""Build a reproducible, allowlisted unpacked-extension download. No secrets."""
import io
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ('manifest.json', 'policy.mjs', 'background.mjs', 'bridge.js',
         'consent.html', 'consent.css', 'consent.mjs', 'README.txt')
SOURCE = ROOT / 'extensions/session-helper'
TARGET = ROOT / 'assets/downloads/gettoken-session-helper.zip'


def archive_bytes():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (SOURCE / name).read_bytes())
    return buffer.getvalue()


if __name__ == '__main__':
    content = archive_bytes()
    if '--check' in sys.argv:
        if not TARGET.exists() or TARGET.read_bytes() != content:
            sys.exit('Extension package is stale. Run python3 scripts/package-session-helper.py')
        print('Verified Session Key helper package.')
    else:
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        TARGET.write_bytes(content)
        print('Packaged Session Key helper (unpacked developer-mode installation).')
