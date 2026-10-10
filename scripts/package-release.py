"""Package explicit source files and the complete portable Windows app."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
RELEASE = ROOT / 'release'
SKIP = {'__pycache__', '.git', 'node_modules', '.cache'}


def files(folder, skip=SKIP):
    for item in sorted(folder.rglob('*')):
        relative = item.relative_to(folder)
        if any(part in skip for part in relative.parts) or item.is_symlink():
            continue
        if item.is_file():
            yield item


def digest(file):
    sha = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()


def portable():
    folder = RELEASE / 'win-unpacked'
    if not (folder / 'Duo.exe').is_file() or not (folder / 'resources/app.asar').is_file():
        raise RuntimeError('Build Windows application first: npm run dist')
    output = RELEASE / f'Duo-{VERSION}-windows-x64.zip'
    prefix = f'Duo-{VERSION}'
    with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
        for item in files(folder, skip=set()):
            archive.write(item, f'{prefix}/{item.relative_to(folder).as_posix()}')
        archive.writestr(f'{prefix}/LISEZ-MOI.txt', 'Extraire dossier complet. Ouvrir Duo.exe.\n\nCLI officiels Codex et Claude Code requis. Connexions → copier commandes, connecter abonnements, actualiser. Git/GitHub CLI facultatifs selon opérations.\n\nGuide : resources/README.md\nLicences : resources/THIRD_PARTY.md et resources/licenses\nApplication indépendante. Installateur et exécutable non signés.\n')
    return output


def source():
    output = RELEASE / f'Duo-{VERSION}-sources.zip'
    prefix = f'Duo-{VERSION}-sources'
    repository = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=ROOT, text=True).strip()).resolve()
    if repository != ROOT:
        raise RuntimeError('Source packaging requires this project as its own Git root')
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    selected = [ROOT / name for name in tracked if name]
    if not selected:
        raise RuntimeError('Stage the reviewed public sources before packaging')
    for item in selected:
        parts = item.relative_to(ROOT).parts
        if any(part in SKIP | {'qa', 'release', 'dist', 'website-package', 'notices'} for part in parts) or item.name.startswith('.env'):
            raise RuntimeError(f'Private or generated source path was staged: {item.name}')
    manifest = []
    with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
        for item in sorted(set(selected)):
            if not item.is_file() or item.is_symlink():
                raise RuntimeError(f'Expected regular source file: {item}')
            relative = item.relative_to(ROOT).as_posix()
            manifest.append({'path': relative, 'bytes': item.stat().st_size, 'sha256': digest(item)})
            archive.write(item, f'{prefix}/{relative}')
        archive.writestr(f'{prefix}/SOURCE-MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('kind', choices=['portable', 'source'])
    arguments = parser.parse_args()
    RELEASE.mkdir(exist_ok=True)
    artifact = portable() if arguments.kind == 'portable' else source()
    with ZipFile(artifact) as check:
        bad = check.testzip()
        if bad:
            raise RuntimeError(f'Archive CRC failure: {bad}')
        count = len(check.namelist())
    print(json.dumps({'artifact': artifact.name, 'files': count, 'bytes': artifact.stat().st_size, 'sha256': digest(artifact)}))
