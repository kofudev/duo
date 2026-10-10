const test = require('node:test');
const assert = require('node:assert/strict');
const { SSH, cleanProfile, sshArgs } = require('../electron/ssh.cjs');
const profile = () => cleanProfile({ name: 'QA server', alias: 'qa-server', root: '/srv/project' });
test('SSH profile rejects option injection, traversal and root; keys are metadata only', () => {
  for (const input of [
    { alias: '-oProxyCommand=bad' },
    { alias: '', host: 'host;evil' },
    { alias: '', host: 'host', user: 'root;evil' },
    { root: '/' },
    { root: '/srv/../etc' },
    { port: 65536 },
    { identityFile: 'relative-key' },
  ])
    assert.throws(() => cleanProfile({ ...profile(), ...input }));
  const args = sshArgs(profile());
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('BatchMode=yes'));
  assert.equal(args.at(-1), 'qa-server');
});
test('SSH calls use fixed helper and stdin JSON; read phases cannot write or execute', async () => {
  const item = profile(),
    calls = [];
  const ssh = new SSH({
    profiles: [item],
    binary: () => 'ssh',
    execute: async (binary, args, options) => {
      calls.push({ binary, args, options });
      return JSON.stringify({ ok: true, result: { hash: 'a'.repeat(64) } });
    },
  });
  await ssh.call(item.id, 'read', { path: 'unicode "$(evil);.txt' });
  assert.equal(JSON.parse(calls[0].options.input).path, 'unicode "$(evil);.txt');
  assert.ok(!calls[0].args.join(' ').includes('evil'));
  assert.ok(calls[0].args.at(-1).startsWith('python3 -c'));
  await assert.rejects(
    ssh.call(item.id, 'write', { path: 'test', content: 'x', expectedHash: null }, { write: true }),
    /désactivée/
  );
  item.allowWrite = true;
  await assert.rejects(
    ssh.call(item.id, 'write', { path: 'test', content: 'x', expectedHash: null }),
    /désactivée/
  );
  await assert.rejects(ssh.call(item.id, 'read', { path: '../outside' }), /relatif/);
  await ssh.call(
    item.id,
    'write',
    { path: 'test', content: 'x', expectedHash: null },
    { write: true }
  );
  item.allowCommands = true;
  await assert.rejects(
    ssh.call(item.id, 'run', { command: 'printf hi' }, { write: true }),
    /désactivées/
  );
  await ssh.call(item.id, 'run', { command: 'printf hi' }, { write: true, commands: true });
  assert.equal(calls.length, 3);
});
test('host refusal and remote errors stay failures, never connection success', async () => {
  const item = profile();
  const ssh = new SSH({
    profiles: [item],
    binary: () => 'ssh',
    execute: async () => {
      throw new Error('Host key verification failed');
    },
  });
  await assert.rejects(ssh.call(item.id, 'probe'), /Host key/);
  ssh.execute = async () => '{"ok":false,"error":"Symlink refused"}';
  await assert.rejects(ssh.call(item.id, 'read', { path: 'link' }), /Symlink/);
});
