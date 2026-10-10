"""Exercise malicious ZIP rejection and atomic rollback without SSH/network."""
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile, ZipInfo

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).resolve().parents[1] / 'deploy/site-receiver.py')
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


def payload(extra=None):
    data = io.BytesIO()
    with ZipFile(data, 'w') as archive:
        for name in ['index.html', '404.html', 'style.css', 'app.js']:
            archive.writestr(name, 'Duo')
        archive.writestr('release.json', json.dumps({'version': '0.4.1', 'assets': {'installer': {'url': 'https://github.com/kofudev/duo/releases/download/v0.4.1/Duo-Setup-0.4.1.exe'}}}))
        if extra:
            archive.writestr(*extra)
    return data.getvalue()


class Deployment(unittest.TestCase):
    def test_real_site_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = receiver.unpack(payload(), Path(folder))
            self.assertEqual(manifest['version'], '0.4.1')
            self.assertTrue((Path(folder) / 'index.html').is_file())

    def test_refuses_traversal_hidden_executable_and_symlink(self):
        link = ZipInfo('assets/link.png')
        link.external_attr = 0o120777 << 16
        entries = [('../escape.html', 'x'), ('/absolute.html', 'x'), ('assets/../../escape.html', 'x'), ('.env', 'x'), ('execute.py', 'x'), (link, 'x')]
        # Python normalizes OS separators when creating/reading ZIPs on Windows.
        if __import__('os').name != 'nt':
            entries.append(('assets\\escape.html', 'x'))
        for entry in entries:
            with self.subTest(entry=str(entry[0])), tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError):
                    receiver.unpack(payload(entry), Path(folder))
                self.assertEqual(list(Path(folder).iterdir()), [])

    @unittest.skipIf(__import__('os').name == 'nt', 'Symlink activation verified on Linux deployment host')
    def test_health_failure_restores_previous_site(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = root / 'old'
            new = root / 'new'
            old.mkdir()
            new.mkdir()
            (new / 'release.json').write_text('{}')
            (root / 'current').symlink_to(old)
            def fail(_):
                raise ValueError('Health failed')
            with self.assertRaises(ValueError):
                receiver.activate(root, new, fail)
            self.assertEqual((root / 'current').resolve(), old)
            receiver.activate(root, new, lambda data: self.assertEqual(data, b'{}'))
            self.assertEqual((root / 'current').resolve(), new)


if __name__ == '__main__':
    unittest.main()
