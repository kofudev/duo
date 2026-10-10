const fs = require('node:fs');
const { EXCLUDED } = require('./files.cjs');
class FileObserver {
  constructor(emit, debounceMs = 180) {
    this.emit = emit;
    this.debounceMs = debounceMs;
    this.root = null;
    this.pending = new Set();
    this.timer = null;
    this.watcher = null;
  }
  watch(root, projectId) {
    if (this.root === root && this.projectId === projectId) return;
    this.close();
    if (!root || !fs.existsSync(root)) return;
    this.root = root;
    this.projectId = projectId;
    try {
      this.watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, filename) =>
        this.changed(filename)
      );
      this.watcher.on('error', () => {
        this.close();
        this.emit({ type: 'files/watch-unavailable', projectId });
      });
    } catch {
      this.close();
      this.emit({ type: 'files/watch-unavailable', projectId });
    }
  }
  changed(filename) {
    const relative = filename ? String(filename).replaceAll('\\', '/') : '';
    if (relative.split('/').some((part) => EXCLUDED.has(part))) return;
    if (this.pending.size < 500) this.pending.add(relative);
    else this.pending.add('');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const paths = [...this.pending];
      this.pending.clear();
      this.emit({ type: 'files/changed', projectId: this.projectId, paths });
    }, this.debounceMs);
  }
  close() {
    clearTimeout(this.timer);
    this.pending.clear();
    this.watcher?.close();
    this.watcher = null;
    this.root = null;
    this.projectId = null;
  }
}
module.exports = { FileObserver };
