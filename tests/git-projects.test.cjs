const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { githubRepository, cloneGitHub, createWorktree } = require('../electron/git-projects.cjs');
const { git } = require('../electron/git.cjs');
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'duo-git-project-'));
test('GitHub repository input accepts canonical names and rejects injected or credential-bearing URLs', () => {
  assert.equal(githubRepository('https://github.com/owner/repo.git').name, 'owner/repo');
  assert.equal(githubRepository('owner/.github').cloneUrl, 'https://github.com/owner/.github.git');
  for (const value of [
    '--config/x',
    'owner/..',
    'owner/repo; calc',
    'https://user:secret@github.com/owner/repo',
    'https://evil.example/owner/repo',
    'https://github.com/owner/repo?token=secret',
  ])
    assert.throws(() => githubRepository(value));
});
test('clone uses argument arrays, fresh destination, and cancellation-aware runner', async () => {
  const parent = fixture(),
    controller = new AbortController();
  let call;
  const result = await cloneGitHub(
    { parent, name: 'Mon dépôt', repository: 'owner/repo' },
    {
      signal: controller.signal,
      runner: async (binary, args, options) => {
        call = { binary, args, options };
        fs.mkdirSync(path.join(parent, 'Mon dépôt'));
      },
    }
  );
  assert.equal(result.path, fs.realpathSync.native(path.join(parent, 'Mon dépôt')));
  assert.ok(call.args.includes(result.path));
  assert.equal(call.options.signal, controller.signal);
  assert.equal(call.options.env.GIT_TERMINAL_PROMPT, '0');
  await assert.rejects(
    cloneGitHub({ parent, name: 'Mon dépôt', repository: 'owner/repo' }),
    /existe déjà/
  );
});
test('real worktree creates separate branch and preserves dirty source checkout', async () => {
  const root = fixture(),
    parent = fixture();
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Duo Test']);
  await git(root, ['config', 'user.email', 'duo@example.invalid']);
  fs.writeFileSync(path.join(root, 'keep.txt'), 'committed');
  await git(root, ['add', '--', 'keep.txt']);
  await git(root, ['commit', '-m', 'Initial']);
  fs.writeFileSync(path.join(root, 'keep.txt'), 'user dirty');
  const created = await createWorktree(root, {
    parent,
    name: 'Copie équipe',
    branch: 'varelia/équipe',
    ref: 'HEAD',
  });
  assert.equal((await git(root, ['branch', '--show-current'])).trim(), 'main');
  assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'user dirty');
  assert.equal((await git(created.path, ['branch', '--show-current'])).trim(), 'varelia/équipe');
  assert.equal(fs.readFileSync(path.join(created.path, 'keep.txt'), 'utf8'), 'committed');
  await assert.rejects(
    createWorktree(root, { parent, name: 'Bad', branch: 'main', ref: 'HEAD' }),
    /varelia/
  );
  await assert.rejects(
    createWorktree(root, { parent, name: 'Bad', branch: 'varelia/bad', ref: '--upload-pack=evil' }),
    /Révision/
  );
});
