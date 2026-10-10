const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { FileObserver } = require('../electron/file-observer.cjs');
test('native watcher debounces source changes and ignores dependency/index paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-watcher-')),
    events = [];
  const observer = new FileObserver((event) => events.push(event), 25);
  observer.watch(root, 'project');
  assert.ok(observer.watcher);
  fs.writeFileSync(path.join(root, 'real.txt'), 'change');
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (events.length) {
        clearInterval(timer);
        clearTimeout(limit);
        resolve();
      }
    }, 10);
    const limit = setTimeout(() => {
      clearInterval(timer);
      reject(new Error('Watcher event missing'));
    }, 3000);
  });
  assert.ok(
    events.some(
      (event) =>
        event.type === 'files/changed' &&
        event.projectId === 'project' &&
        event.paths.includes('real.txt')
    )
  );
  events.length = 0;
  observer.changed('node_modules/dependency.js');
  observer.changed('.git/index');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(events.length, 0);
  observer.close();
  assert.equal(observer.root, null);
  assert.equal(observer.watcher, null);
});
