#!/usr/bin/python3
"""Restricted SSH receiver. Root installs this file; duo-deploy cannot edit it."""
import hashlib
import io
import json
import os
import re
import shutil
import stat
import sys
import time
import urllib.request
import uuid
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

ROOT = Path('/var/www/duo')
MAX_ARCHIVE = 20 * 1024 * 1024
MAX_EXPANDED = 50 * 1024 * 1024
EXTENSIONS = {'.html', '.css', '.js', '.json', '.txt', '.xml', '.svg', '.png', '.woff2'}


def unpack(payload, destination):
    with ZipFile(io.BytesIO(payload)) as archive:
        entries = archive.infolist()
        if len(entries) > 256 or sum(e.file_size for e in entries) > MAX_EXPANDED:
            raise ValueError('Website archive exceeds limits')
        names = set()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (not path.parts or path.is_absolute() or '\\' in entry.filename
                    or any(p in {'.', '..'} or p.startswith('.') for p in path.parts)
                    or entry.filename != path.as_posix()
                    or path.suffix.lower() not in EXTENSIONS
                    or entry.filename in names
                    or stat.S_ISLNK(entry.external_attr >> 16)
                    or entry.is_dir()):
                raise ValueError('Unsafe website entry')
            names.add(entry.filename)
        required = {'index.html', '404.html', 'style.css', 'app.js', 'release.json'}
        if not required.issubset(names):
            raise ValueError('Website files missing')
        manifest = json.loads(archive.read('release.json'))
        if not re.fullmatch(r'\d+\.\d+\.\d+', manifest.get('version', '')):
            raise ValueError('Release version invalid')
        installer = manifest.get('assets', {}).get('installer', {})
        version = manifest['version']
        expected = f'https://github.com/kofudev/duo/releases/download/v{version}/Duo-Setup-{version}.exe'
        if installer.get('url') != expected:
            raise ValueError('Official installer URL missing')
        for entry in entries:
            file = destination / entry.filename
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(archive.read(entry))
            file.chmod(0o644)
    return manifest


def switch(root, target):
    temporary = root / '.next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(root / 'current')


def health(expected):
    request = urllib.request.Request('http://127.0.0.1/release.json', headers={'Host': 'duo.varelia.fr'})
    # No proxy environment or remote redirects during the local health check.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=5) as response:
        if response.status != 200 or response.geturl() != request.full_url:
            raise ValueError('Website health check failed')
        if response.read(MAX_ARCHIVE + 1) != expected:
            raise ValueError('Served release manifest differs')


def activate(root, target, verify=health):
    current = root / 'current'
    if current.exists() and not current.is_symlink():
        raise ValueError('Current website must be a symlink')
    previous = current.readlink() if current.is_symlink() else None
    switch(root, target)
    try:
        verify((target / 'release.json').read_bytes())
    except Exception:
        if previous is not None:
            switch(root, previous)
        else:
            current.unlink(missing_ok=True)
        raise


def main():
    import fcntl  # Linux host only; archive/rollback tests also run on Windows.
    if os.environ.get('SSH_ORIGINAL_COMMAND') != 'deploy':
        raise ValueError('Only the deploy command is allowed')
    if ROOT.is_symlink() or (ROOT / 'releases').is_symlink():
        raise ValueError('Unsafe deployment root')
    payload = sys.stdin.buffer.read(MAX_ARCHIVE + 1)
    if not payload or len(payload) > MAX_ARCHIVE:
        raise ValueError('Invalid archive size')
    with (ROOT / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        name = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
        target = ROOT / 'releases' / name
        target.mkdir(mode=0o755)
        try:
            manifest = unpack(payload, target)
            activate(ROOT, target)
        except Exception:
            shutil.rmtree(target)
            raise
        # Keep five deployments. Only our regular release directories qualify.
        releases = sorted((ROOT / 'releases').iterdir(), key=lambda p: p.name, reverse=True)
        for old in releases[5:]:
            if re.fullmatch(r'\d{8}-\d{6}-[0-9a-f]{8}', old.name) and old.is_dir() and not old.is_symlink() and old.resolve().parent == (ROOT / 'releases').resolve():
                shutil.rmtree(old)
        print(json.dumps({'deployed': manifest['version'], 'archiveSha256': hashlib.sha256(payload).hexdigest(), 'directory': name}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Deploy refused: {error}', file=sys.stderr)
        sys.exit(1)
