"""Create a deployable static website archive, with index.html at its root."""
import hashlib
import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--prepared', action='store_true')
arguments = parser.parse_args()
SITE = ROOT / ('website-package' if arguments.prepared else 'website')
if not (SITE / 'index.html').is_file():
    raise RuntimeError('Website folder missing')
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
OUTPUT = ROOT / 'release' / f'Duo-{VERSION}-site.zip'
OUTPUT.parent.mkdir(exist_ok=True)
with ZipFile(OUTPUT, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(SITE.rglob('*')):
        relative = file.relative_to(SITE)
        if file.is_file() and not file.is_symlink() and not any(part.startswith('.') for part in relative.parts):
            archive.write(file, relative.as_posix())
with ZipFile(OUTPUT) as archive:
    if archive.testzip() or 'index.html' not in archive.namelist():
        raise RuntimeError('Invalid website archive')
print(json.dumps({'artifact': OUTPUT.name, 'bytes': OUTPUT.stat().st_size, 'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest()}))
