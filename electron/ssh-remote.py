"""Bounded operations for an explicitly selected Unix SSH target (Python 3)."""
import base64
import hashlib
import json
import os
import selectors
import signal
import stat
import subprocess
import sys
import time
import uuid

LIMIT = 512000
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def directory(root, relative=""):
    if not root.startswith("/") or root == "/" or ".." in root.split("/"):
        raise ValueError("Dossier distant absolu requis, hors racine système.")
    parts = (root + "/" + relative).split("/")
    if ".." in parts or "\x00" in relative or relative.startswith("/"):
        raise ValueError("Chemin distant doit rester relatif.")
    fd = os.open("/", FLAGS)
    try:
        for part in parts:
            if part and part != ".":
                next_fd = os.open(part, FLAGS, dir_fd=fd)
                os.close(fd)
                fd = next_fd
        return fd
    except Exception:
        os.close(fd)
        raise


def parent(root, relative):
    parts = relative.split("/")
    if not relative or relative.startswith("/") or any(p in ("", ".", "..") for p in parts):
        raise ValueError("Chemin fichier relatif requis.")
    if any(p in (".git", ".ssh") for p in parts):
        raise ValueError("Métadonnées Git interdites.")
    name = parts[-1].lower()
    if (name.startswith(".env") and name not in (".env.example", ".env.sample", ".env.template")) or name.endswith((".pem", ".key", ".pfx", ".p12")) or name.startswith(("credentials", "secrets")) or name in (".npmrc", ".netrc"):
        raise ValueError("Fichier sensible exclu des outils distants.")
    return directory(root, "/".join(parts[:-1])), parts[-1]


def read_at(fd, name):
    file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        info = os.fstat(file_fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("Fichier régulier requis.")
        with os.fdopen(file_fd, "rb", closefd=False) as stream:
            data = stream.read(LIMIT + 1)
        if len(data) > LIMIT:
            raise ValueError("Fichier trop volumineux (512 Ko max.).")
        return data
    finally:
        os.close(file_fd)


def execute(root, command, timeout):
    # cwd is a starting directory, not a sandbox for arbitrary shell commands.
    proc = subprocess.Popen(command, shell=True, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    selector = selectors.DefaultSelector()
    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    selector.register(proc.stdout, selectors.EVENT_READ, "stdout")
    selector.register(proc.stderr, selectors.EVENT_READ, "stderr")
    deadline = time.monotonic() + timeout
    reason = None
    try:
        while selector.get_map():
            if time.monotonic() >= deadline:
                reason = "Délai distant dépassé."
                break
            for key, _ in selector.select(0.1):
                chunk = os.read(key.fileobj.fileno(), 16384)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                buffers[key.data].extend(chunk)
                if sum(len(value) for value in buffers.values()) > LIMIT:
                    reason = "Sortie distante tronquée à 512 Ko."
                    break
            if reason:
                break
        if reason:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        proc.wait(timeout=5)
    finally:
        selector.close()
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        proc.stdout.close()
        proc.stderr.close()
    return {"exitCode": proc.returncode, "stdout": bytes(buffers["stdout"][:LIMIT]).decode("utf8", "replace"), "stderr": bytes(buffers["stderr"][:LIMIT]).decode("utf8", "replace"), "warning": reason, "cwd": root}


def main(request):
    root = request["root"]
    operation = request["operation"]
    fd = directory(root)
    os.close(fd)
    relative = request.get("path", "")
    if operation == "probe":
        return {"connected": True, "root": root, "platform": sys.platform, "python": sys.version.split()[0]}
    if operation == "list":
        fd = directory(root, relative)
        try:
            names = sorted(os.listdir(fd))
            entries = []
            for name in names[:1000]:
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                entries.append({"name": name, "kind": "link" if stat.S_ISLNK(info.st_mode) else "directory" if stat.S_ISDIR(info.st_mode) else "file", "size": info.st_size})
            return {"path": relative, "entries": entries, "truncated": len(names) > 1000}
        finally:
            os.close(fd)
    if operation in ("read", "write"):
        fd, name = parent(root, relative)
        temporary = ".duo-" + uuid.uuid4().hex
        try:
            if operation == "read":
                data = read_at(fd, name)
                return {"path": relative, "content": data.decode("utf8"), "hash": hashlib.sha256(data).hexdigest()}
            data = request["content"].encode("utf8")
            if len(data) > LIMIT:
                raise ValueError("Contenu trop volumineux.")
            try:
                existing = read_at(fd, name)
                current = hashlib.sha256(existing).hexdigest()
                mode = stat.S_IMODE(os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode)
            except FileNotFoundError:
                current, mode = None, 0o644
            if "expectedHash" not in request or request["expectedHash"] != current:
                raise ValueError("Fichier changé depuis lecture. Relire avant écrire.")
            output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=fd)
            with os.fdopen(output, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
                os.fchmod(stream.fileno(), mode)
            # Check again before replacement, including unexpected new files.
            try:
                latest = hashlib.sha256(read_at(fd, name)).hexdigest()
            except FileNotFoundError:
                latest = None
            if latest != current:
                raise ValueError("Modification concurrente : écriture annulée.")
            os.replace(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
            os.fsync(fd)
            return {"path": relative, "kind": "created" if current is None else "modified", "hash": hashlib.sha256(data).hexdigest(), "size": len(data)}
        finally:
            try:
                os.unlink(temporary, dir_fd=fd)
            except FileNotFoundError:
                pass
            os.close(fd)
    if operation == "run":
        return execute(root, request["command"], min(120, max(1, request.get("timeout", 60))))
    raise ValueError("Opération distante inconnue.")


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(800001)
        if len(raw) > 800000:
            raise ValueError("Requête trop volumineuse.")
        print(json.dumps({"ok": True, "result": main(json.loads(raw))}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
