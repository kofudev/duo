const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseStatus, inspectGit, commitSelected, remoteUrl, git } = require('../electron/git.cjs');

test('Git status supports spaces, Unicode, renames, and untracked paths', () => {
  const result = parseStatus(' M file with spaces.js\0R  après.js\0avant.js\0?? new.js\0');
  assert.equal(result[0].path, 'file with spaces.js');
  assert.equal(result[1].previous, 'avant.js');
  assert.equal(result[1].path, 'après.js');
  assert.equal(result[2].untracked, true);
  assert.equal(remoteUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo');
  assert.equal(remoteUrl('https://evil.example/repo.git'), null);
});
async function fixture() {
  const root = path.resolve(__dirname, '..', '.cache', `test-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Duo Tests']);
  await git(root, ['config', 'user.email', 'duo-tests@example.invalid']);
  for (const file of ['one.txt', 'two.txt']) fs.writeFileSync(path.join(root, file), 'original\n');
  await git(root, ['add', '--', 'one.txt', 'two.txt']);
  await git(root, ['commit', '-m', 'Initial']);
  return root;
}
test('selected commit preserves unrelated staged and working-tree changes', async () => {
  const root = await fixture();
  fs.writeFileSync(path.join(root, 'one.txt'), 'changed one\n');
  fs.writeFileSync(path.join(root, 'two.txt'), 'changed two\n');
  await git(root, ['add', '--', 'two.txt']);
  const snapshot = await inspectGit(root);
  await commitSelected(root, {
    files: ['one.txt'],
    message: 'Commit one',
    signature: snapshot.signature,
  });
  assert.equal((await git(root, ['diff', '--cached', '--name-only'])).trim(), 'two.txt');
  assert.equal((await git(root, ['show', 'HEAD:two.txt'])).trim(), 'original');
  assert.equal((await git(root, ['show', 'HEAD:one.txt'])).trim(), 'changed one');
  assert.equal(fs.readFileSync(path.join(root, 'two.txt'), 'utf8'), 'changed two\n');
});
test('stale preview rejects commit before staging', async () => {
  const root = await fixture();
  fs.writeFileSync(path.join(root, 'one.txt'), 'changed one\n');
  const snapshot = await inspectGit(root);
  fs.writeFileSync(path.join(root, 'one.txt'), 'changed again\n');
  await assert.rejects(
    commitSelected(root, {
      files: ['one.txt'],
      message: 'Do not commit',
      signature: snapshot.signature,
    }),
    /Actualiser diff/
  );
  assert.equal((await git(root, ['diff', '--cached', '--name-only'])).trim(), '');
});
test('new file commits only chosen path and invalid paths rejected', async () => {
  const root = await fixture();
  fs.writeFileSync(path.join(root, 'new.txt'), 'new\n');
  const snapshot = await inspectGit(root);
  await assert.rejects(
    commitSelected(root, { files: ['../outside'], message: 'Bad', signature: snapshot.signature }),
    /absent du diff/
  );
  await commitSelected(root, {
    files: ['new.txt'],
    message: 'New file',
    signature: snapshot.signature,
  });
  assert.equal((await git(root, ['show', 'HEAD:new.txt'])).trim(), 'new');
});

test('nested project status and commits stay inside selected folder', async () => {
  const root = await fixture(),
    project = path.join(root, 'mon projet [test]');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'Équipe.txt'), 'project initial');
  await git(root, ['add', '--', 'mon projet [test]/Équipe.txt']);
  await git(root, ['commit', '-m', 'Project']);
  fs.writeFileSync(path.join(root, 'one.txt'), 'outside edit');
  await git(root, ['add', '--', 'one.txt']);
  fs.writeFileSync(path.join(project, 'Équipe.txt'), 'project edit');
  const snapshot = await inspectGit(project);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.scope, 'mon projet [test]');
  assert.deepEqual(
    snapshot.files.map((f) => f.path),
    ['Équipe.txt']
  );
  assert.ok(!snapshot.diff.includes('one.txt'));
  await commitSelected(project, {
    files: ['Équipe.txt'],
    message: 'Scoped project',
    signature: snapshot.signature,
  });
  assert.equal((await git(root, ['diff', '--cached', '--name-only'])).trim(), 'one.txt');
  assert.equal((await git(root, ['show', 'HEAD:one.txt'])).trim(), 'original');
  assert.equal(
    (await git(root, ['show', 'HEAD:mon projet [test]/Équipe.txt'])).trim(),
    'project edit'
  );
});

test('nested project refuses cross-boundary rename commit', async () => {
  const root = await fixture(),
    project = path.join(root, 'inside');
  fs.mkdirSync(project);
  await git(root, ['mv', '--', 'one.txt', 'inside/moved.txt']);
  const snapshot = await inspectGit(project);
  assert.equal(snapshot.files[0].outsideRename, true);
  await assert.rejects(
    commitSelected(project, {
      files: ['moved.txt'],
      message: 'Unsafe scope',
      signature: snapshot.signature,
    }),
    /hors projet/
  );
  assert.equal((await git(root, ['show', 'HEAD:one.txt'])).trim(), 'original');
});

test('Git pathspec metacharacters cannot include neighbouring files in selected commit', async () => {
  const root = await fixture();
  for (const name of ['one[1].txt', 'one1.txt']) fs.writeFileSync(path.join(root, name), 'initial');
  await git(root, ['add', '--', ':(literal)one[1].txt', ':(literal)one1.txt']);
  await git(root, ['commit', '-m', 'Literal fixtures']);
  for (const name of ['one[1].txt', 'one1.txt']) fs.writeFileSync(path.join(root, name), 'changed');
  const snapshot = await inspectGit(root);
  await commitSelected(root, {
    files: ['one[1].txt'],
    message: 'One exact file',
    signature: snapshot.signature,
  });
  assert.equal((await git(root, ['show', 'HEAD:one[1].txt'])).trim(), 'changed');
  assert.equal((await git(root, ['show', 'HEAD:one1.txt'])).trim(), 'initial');
  assert.ok((await git(root, ['status', '--porcelain'])).includes('one1.txt'));
});

test('Git cannot select files reached through a directory junction outside project', async () => {
  const root = await fixture(),
    outside = path.join(root, '..', `outside-${randomUUID()}`);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'external.txt'), 'external');
  fs.symlinkSync(
    outside,
    path.join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const snapshot = await inspectGit(root);
  assert.ok(!snapshot.files.some((file) => file.path.startsWith('linked/')));
  await assert.rejects(
    commitSelected(root, {
      files: ['linked/external.txt'],
      message: 'Blocked',
      signature: snapshot.signature,
    }),
    /absent du diff/
  );
});
