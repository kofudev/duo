const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { listFiles, searchFiles, readFile, saveFile } = require('../electron/files.cjs');
function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'duo-files-'));
}
test('quick file search finds nested Unicode and fuzzy names without following junctions', () => {
  const project = fixture(),
    outside = fixture();
  fs.mkdirSync(path.join(project, 'src'));
  fs.mkdirSync(path.join(project, 'node_modules'));
  fs.writeFileSync(path.join(project, 'src', 'Équipe.js'), 'visible');
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'visible');
  fs.writeFileSync(path.join(project, 'node_modules', 'main.js'), 'dependency');
  fs.writeFileSync(path.join(outside, 'main-private.js'), 'outside');
  fs.symlinkSync(
    outside,
    path.join(project, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.deepEqual(
    searchFiles(project, 'equipe').files.map((file) => file.path),
    ['src/Équipe.js']
  );
  assert.deepEqual(
    searchFiles(project, 'mainjs').files.map((file) => file.path),
    ['src/main.js']
  );
  const limited = searchFiles(project, 'js', { maxEntries: 1 });
  assert.equal(limited.truncated, true);
  assert.ok(limited.scanned <= 2);
  assert.throws(() => searchFiles(project, 'x'.repeat(161)), /Recherche invalide/);
});
test('file growth after size check stays bounded and cannot load huge file contents', () => {
  const project = fixture(),
    target = path.join(project, 'growing.txt');
  fs.writeFileSync(target, 'small');
  const original = fs.fstatSync;
  let grown = false;
  fs.fstatSync = (descriptor) => {
    const stat = original(descriptor);
    if (!grown) {
      grown = true;
      fs.appendFileSync(target, 'x'.repeat(600000));
    }
    return stat;
  };
  try {
    const result = readFile(project, 'growing.txt');
    assert.equal(result.readable, false);
    assert.match(result.reason, /500 Ko/);
  } finally {
    fs.fstatSync = original;
  }
});
test('replaced file descriptor fails identity check before reading outside contents', () => {
  const project = fixture(),
    outside = fixture(),
    target = path.join(project, 'visible.txt'),
    privateFile = path.join(outside, 'private.txt');
  fs.writeFileSync(target, 'visible');
  fs.writeFileSync(privateFile, 'must never read');
  const open = fs.openSync,
    read = fs.readSync;
  let reads = 0;
  fs.openSync = (file, flags, ...rest) =>
    open(file === target && flags === 'r' ? privateFile : file, flags, ...rest);
  fs.readSync = (...args) => {
    reads++;
    return read(...args);
  };
  try {
    assert.throws(() => readFile(project, 'visible.txt'), /remplacé pendant lecture/);
    assert.equal(reads, 0);
  } finally {
    fs.openSync = open;
    fs.readSync = read;
  }
});
test('explorer supports Unicode, excludes metadata/dependencies, and sorts directories first', () => {
  const project = fixture();
  for (const name of ['src', '.git', 'node_modules']) fs.mkdirSync(path.join(project, name));
  fs.writeFileSync(path.join(project, 'Équipe.md'), 'texte');
  const listed = listFiles(project);
  assert.deepEqual(
    listed.files.map((file) => file.name),
    ['src', 'Équipe.md']
  );
  assert.equal(listed.excluded, 2);
});
test('UTF-8 BOM and CRLF preserved, shorter writes do not leave old trailing content', () => {
  const project = fixture();
  const target = path.join(project, 'code.txt');
  fs.writeFileSync(target, '\uFEFFlong original\r\nsecond line\r\n');
  const original = readFile(project, 'code.txt');
  assert.ok(original.content.startsWith('\uFEFF'));
  assert.equal(original.newline, 'CRLF');
  saveFile(project, { path: 'code.txt', expectedHash: original.hash, content: '\uFEFFshort\r\n' });
  assert.equal(fs.readFileSync(target, 'utf8'), '\uFEFFshort\r\n');
});
test('stale editor refuses overwrite and retains external edit', () => {
  const project = fixture(),
    target = path.join(project, 'README.md');
  fs.writeFileSync(target, 'original');
  const opened = readFile(project, 'README.md');
  fs.writeFileSync(target, 'external change');
  assert.throws(
    () => saveFile(project, { path: 'README.md', expectedHash: opened.hash, content: 'draft' }),
    /modifié ailleurs/
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'external change');
});
test('filesystem rejects parent traversal, absolute paths and junctions outside project', () => {
  const project = fixture(),
    outside = fixture();
  fs.writeFileSync(path.join(outside, 'secret'), 'outside');
  for (const value of ['../outside', outside, 'C:secret'])
    assert.throws(() => readFile(project, value), /relatif/);
  fs.symlinkSync(
    outside,
    path.join(project, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(() => readFile(project, 'link/secret'), /symboliques/);
});
test('binary, invalid UTF-8 and oversized files remain uneditable', () => {
  const project = fixture();
  fs.writeFileSync(path.join(project, 'binary'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(project, 'invalid'), Buffer.from([255]));
  fs.writeFileSync(path.join(project, 'large'), Buffer.alloc(512001, 65));
  for (const name of ['binary', 'invalid', 'large'])
    assert.equal(readFile(project, name).readable, false);
});

test('hard-linked files cannot write through to another location', () => {
  const project = fixture(),
    outside = fixture(),
    original = path.join(outside, 'shared.txt');
  fs.writeFileSync(original, 'outside original');
  fs.linkSync(original, path.join(project, 'shared.txt'));
  const opened = readFile(project, 'shared.txt');
  assert.throws(
    () =>
      saveFile(project, { path: 'shared.txt', content: 'overwrite', expectedHash: opened.hash }),
    /plusieurs emplacements/
  );
  assert.equal(fs.readFileSync(original, 'utf8'), 'outside original');
});

test('partial filesystem writes complete without truncating valid text', () => {
  const project = fixture(),
    target = path.join(project, 'partial.txt');
  fs.writeFileSync(target, 'original');
  const opened = readFile(project, 'partial.txt'),
    originalWrite = fs.writeSync;
  fs.writeSync = (fd, buffer, offset, length, position) =>
    originalWrite(fd, buffer, offset, Math.min(length, 3), position);
  try {
    saveFile(project, {
      path: 'partial.txt',
      content: 'longer UTF-8 é texte',
      expectedHash: opened.hash,
    });
  } finally {
    fs.writeSync = originalWrite;
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'longer UTF-8 é texte');
});

test('failed write restores original contents and reports failure', () => {
  const project = fixture(),
    target = path.join(project, 'failure.txt');
  fs.writeFileSync(target, 'original contents');
  const opened = readFile(project, 'failure.txt'),
    originalWrite = fs.writeSync;
  let calls = 0;
  fs.writeSync = (fd, buffer, offset, length, position) => {
    calls++;
    if (calls === 2) throw new Error('Simulated disk failure');
    return originalWrite(fd, buffer, offset, Math.min(length, 3), position);
  };
  try {
    assert.throws(
      () =>
        saveFile(project, {
          path: 'failure.txt',
          content: 'replacement text',
          expectedHash: opened.hash,
        }),
      /original restauré/
    );
  } finally {
    fs.writeSync = originalWrite;
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'original contents');
});
