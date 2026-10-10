const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  captureReview,
  changedSince,
  evidenceText,
  evidenceSummary,
} = require('../electron/review-evidence.cjs');
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'duo-evidence-'));
test('review snapshots contain actual file bytes and digest, never just implementer report', () => {
  const project = fixture();
  fs.writeFileSync(path.join(project, 'main.js'), 'const evidence = "actual-file";\n');
  const snapshot = captureReview(project, { files: ['main.js'] });
  assert.ok(evidenceText(snapshot).includes('actual-file'));
  assert.match(snapshot.files[0].hash, /^[a-f0-9]{64}$/);
  assert.equal(evidenceSummary(snapshot).files[0].content, undefined);
  assert.deepEqual(changedSince(snapshot), []);
  fs.writeFileSync(path.join(project, 'main.js'), 'changed-during-review');
  assert.deepEqual(changedSince(snapshot), ['main.js']);
});
test('review snapshots bound excerpts, preserve deletion evidence, and omit credentials', () => {
  const project = fixture();
  fs.writeFileSync(path.join(project, 'large.txt'), 'x'.repeat(100));
  fs.writeFileSync(path.join(project, '.env.local'), 'SECRET_VALUE_MUST_NOT_BE_SENT');
  const snapshot = captureReview(
    project,
    { files: ['large.txt', 'deleted.txt', '.env.local'] },
    { maxChars: 20, perFileChars: 20 }
  );
  assert.equal(snapshot.files[0].content.length, 20);
  assert.equal(snapshot.files[0].truncated, true);
  assert.equal(snapshot.files[1].status, 'missing');
  assert.equal(snapshot.files[2].status, 'redacted');
  assert.ok(!evidenceText(snapshot).includes('SECRET_VALUE_MUST_NOT_BE_SENT'));
  fs.writeFileSync(path.join(project, 'deleted.txt'), 'returned');
  assert.deepEqual(changedSince(snapshot), ['deleted.txt']);
});
test('review snapshots reject paths or junctions outside selected project', () => {
  const project = fixture(),
    outside = fixture();
  fs.writeFileSync(path.join(outside, 'private.txt'), 'OUTSIDE_BYTES');
  fs.symlinkSync(
    outside,
    path.join(project, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const snapshot = captureReview(project, { files: ['../outside.txt', 'linked/private.txt'] });
  assert.ok(snapshot.files.every((file) => file.status === 'blocked'));
  assert.ok(!evidenceText(snapshot).includes('OUTSIDE_BYTES'));
});
