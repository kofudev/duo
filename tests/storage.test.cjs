const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../electron/storage.cjs');
const fixture = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'duo-store-')), 'workspace.json');
test('atomic storage retries transient Windows rename locks', () => {
  const file = fixture(),
    store = new JsonStore(file, { retryDelayMs: 0 });
  store.save({ schemaVersion: 2, sessions: [] });
  const rename = fs.renameSync;
  let failures = 0;
  fs.renameSync = (source, target) => {
    if (target === file && failures++ < 3) {
      const error = new Error('Locked');
      error.code = 'EPERM';
      throw error;
    }
    return rename(source, target);
  };
  try {
    assert.equal(store.save({ schemaVersion: 2, sessions: ['latest'] }).recovered, false);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(new JsonStore(file).load().data.sessions, ['latest']);
});
test('permanent primary lock preserves newest recovery and restores it on restart', () => {
  const file = fixture(),
    store = new JsonStore(file, { retryDelayMs: 0, retries: 1 });
  store.save({ schemaVersion: 2, sessions: ['before'] });
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (target === file) {
      const error = new Error('Locked');
      error.code = 'EPERM';
      throw error;
    }
    return rename(source, target);
  };
  try {
    assert.equal(store.save({ schemaVersion: 2, sessions: ['recovered'] }).recovered, true);
  } finally {
    fs.renameSync = rename;
  }
  const reopened = new JsonStore(file),
    loaded = reopened.load();
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.data.sessions, ['recovered']);
  reopened.save(loaded.data);
  assert.equal(reopened.load().recovered, false);
  assert.equal(reopened.candidates().filter((f) => f.includes('.recovery-')).length, 0);
});
test('corrupt primary falls back to valid backup and preserves corrupt file', () => {
  const file = fixture();
  fs.writeFileSync(file, '{broken');
  fs.writeFileSync(file + '.previous', JSON.stringify({ schemaVersion: 2, sessions: ['backup'] }));
  const loaded = new JsonStore(file).load();
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.data.sessions, ['backup']);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('.corrupt-')));
});
test('future schema cannot silently overwrite newer application history', () => {
  const file = fixture();
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 5, sessions: ['keep'] }));
  assert.throws(() => new JsonStore(file).load(), /plus récente/);
  assert.equal(JSON.parse(fs.readFileSync(file)).schemaVersion, 5);
});
test('oversized UTF-8 snapshot fails before replacing last valid history', () => {
  const file = fixture(),
    store = new JsonStore(file, { maxBytes: 1024 });
  store.save({ schemaVersion: 2, sessions: ['keep'] });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(
    () => store.save({ schemaVersion: 2, sessions: ['é'.repeat(1000)] }),
    /limite stockage/
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(store.load().data.sessions, ['keep']);
  assert.ok(!fs.readdirSync(path.dirname(file)).some((name) => name.includes('.pending-')));
});
