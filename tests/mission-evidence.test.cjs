const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { captureMission, compareMission } = require('../electron/mission-evidence.cjs');
test('recap detects actual created, modified and deleted bytes; omits credentials and generated output', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-recap-'));
  fs.writeFileSync(path.join(project, 'old.js'), 'before');
  fs.writeFileSync(path.join(project, 'remove.js'), 'x');
  fs.writeFileSync(path.join(project, '.env'), 'PRIVATE_CANARY');
  fs.mkdirSync(path.join(project, 'node_modules'));
  fs.writeFileSync(path.join(project, 'node_modules', 'dep.js'), 'x');
  const before = captureMission(project);
  fs.writeFileSync(path.join(project, 'old.js'), 'after');
  fs.unlinkSync(path.join(project, 'remove.js'));
  fs.writeFileSync(path.join(project, 'new.js'), 'new');
  const recap = compareMission(before, captureMission(project));
  assert.deepEqual(recap.changes.map((entry) => [entry.path, entry.kind]).sort(), [
    ['new.js', 'created'],
    ['old.js', 'modified'],
    ['remove.js', 'deleted'],
  ]);
  assert.ok(!JSON.stringify(before).includes('PRIVATE_CANARY'));
  assert.ok(!Object.keys(before.files).includes('.env'));
  assert.ok(recap.changes[0].hash);
  assert.equal(recap.limited, false);
});
test('bounded incomplete scan does not misreport existing files as deleted', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-recap-limit-'));
  fs.writeFileSync(path.join(project, 'a.js'), 'a');
  fs.writeFileSync(path.join(project, 'b.js'), 'b');
  const before = captureMission(project),
    after = captureMission(project, { maxFiles: 1 });
  assert.equal(after.limited, true);
  assert.deepEqual(compareMission(before, after).changes, []);
});
