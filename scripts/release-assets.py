"""Prepare Windows artifacts and the static site for a release.

Run after npm run dist and staging the public source files. Does not publish.
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
RELEASE = ROOT / 'release'
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def run(script, *args):
    subprocess.run([sys.executable, str(ROOT / 'scripts' / script), *args], cwd=ROOT, check=True)


original = RELEASE / f'Duo Setup {VERSION}.exe'
installer = RELEASE / f'Duo-Setup-{VERSION}.exe'
if not original.is_file() or original.stat().st_size < 1_000_000:
    raise RuntimeError('Build the Windows installer first: npm run dist')
shutil.copyfile(original, installer)
run('package-release.py', 'portable')
portable = RELEASE / f'Duo-{VERSION}-windows-x64.zip'
manifest_file = ROOT / 'website' / 'release.json'
manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
manifest['version'] = VERSION
for kind, file in [('installer', installer), ('portable', portable)]:
    manifest['assets'][kind] = {
        'url': f'https://github.com/kofudev/duo/releases/download/v{VERSION}/{file.name}',
        'bytes': file.stat().st_size,
        'sha256': digest(file),
    }
# Source/site hashes stay in the external checksum file to avoid self-reference.
manifest['assets']['source'] = {
    'url': f'https://github.com/kofudev/duo/releases/download/v{VERSION}/Duo-{VERSION}-sources.zip'
}
manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
index_file = ROOT / 'website' / 'index.html'
index_file.write_text(re.sub(r'(<span data-version>)\d+\.\d+\.\d+(</span>)', lambda match: match[1] + VERSION + match[2], index_file.read_text(encoding='utf-8')), encoding='utf-8')
subprocess.run(['node', str(ROOT / 'node_modules' / 'prettier' / 'bin' / 'prettier.cjs'), '--write', str(manifest_file)], cwd=ROOT, check=True)
run('package-release.py', 'source')
run('package-site.py')
assets = [installer, portable, RELEASE / f'Duo-{VERSION}-sources.zip', RELEASE / f'Duo-{VERSION}-site.zip']
for source, name in [(installer, 'Duo-Setup.exe'), (portable, 'Duo-Windows-x64.zip'), (assets[2], 'Duo-Sources.zip'), (manifest_file, 'release.json')]:
    alias = RELEASE / name
    shutil.copyfile(source, alias)
    assets.append(alias)
for file in assets:
    if file.suffix == '.zip':
        with ZipFile(file) as archive:
            if archive.testzip():
                raise RuntimeError(f'Archive failed its CRC check: {file.name}')
checksums = ''.join(f'{digest(file)}  {file.name}\n' for file in assets)
(RELEASE / 'SHA256SUMS.txt').write_text(checksums, encoding='ascii')
print(json.dumps({'version': VERSION, 'assets': [{'name': file.name, 'bytes': file.stat().st_size} for file in assets]}))
