"""Unix-only tests for the same helper shipped in the Windows app."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("remote", Path(__file__).resolve().parents[1] / "electron/ssh-remote.py")
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


@unittest.skipIf(os.name != "posix", "Unix remote helper requires dir_fd and O_NOFOLLOW")
class RemoteSecurity(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="duo-ssh-qa-")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def call(self, operation, **values):
        return remote.main({"root": str(self.root), "operation": operation, **values})

    def test_actual_read_create_replace_and_conflict(self):
        created = self.call("write", path="test.txt", content="héllo", expectedHash=None)
        self.assertEqual(created["kind"], "created")
        read = self.call("read", path="test.txt")
        self.assertEqual(read["content"], "héllo")
        with self.assertRaises(ValueError):
            self.call("write", path="test.txt", content="bad", expectedHash=None)
        changed = self.call("write", path="test.txt", content="next", expectedHash=read["hash"])
        self.assertEqual(changed["kind"], "modified")
        self.assertEqual((self.root / "test.txt").read_text(), "next")
        self.assertFalse(any(p.name.startswith(".duo-") for p in self.root.iterdir()))

    def test_traversal_symlinks_sensitive_files_and_hardlinks(self):
        (self.root / "outside-link").symlink_to("/etc", target_is_directory=True)
        (self.root / ".env").write_text("PRIVATE_CANARY")
        (self.root / "one.txt").write_text("private")
        os.link(self.root / "one.txt", self.root / "hard.txt")
        for name in ("../escape", "/etc/passwd", "outside-link/passwd", ".env", "hard.txt"):
            with self.assertRaises((ValueError, OSError)):
                self.call("read", path=name)
            with self.assertRaises((ValueError, OSError)):
                self.call("write", path=name, content="bad", expectedHash=None)
        self.assertEqual((self.root / "one.txt").read_text(), "private")

    def test_injection_is_literal_path_and_bounded_read(self):
        name = 'quote "$(touch bad);.txt'
        self.call("write", path=name, content="literal", expectedHash=None)
        self.assertEqual(self.call("read", path=name)["content"], "literal")
        self.assertFalse((self.root / "bad").exists())
        (self.root / "big.txt").write_bytes(b"x" * (remote.LIMIT + 1))
        with self.assertRaises(ValueError):
            self.call("read", path="big.txt")

    def test_command_exit_failure_timeout_and_output_limit(self):
        result = self.call("run", command="printf 'actual output'; exit 7", timeout=3)
        self.assertEqual(result["exitCode"], 7)
        self.assertEqual(result["stdout"], "actual output")
        self.assertEqual(result["cwd"], str(self.root))
        slow = self.call("run", command="sleep 5", timeout=1)
        self.assertIsNotNone(slow["warning"])
        noisy = self.call("run", command="python3 -c \"print('x'*600000)\"", timeout=5)
        self.assertLessEqual(len(noisy["stdout"]), remote.LIMIT)
        self.assertIsNotNone(noisy["warning"])


if __name__ == "__main__":
    unittest.main()
