const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  findBinary,
  formatCliCommand,
  commandFor,
  runCommand,
  subscriptionEnv,
} = require('../electron/process.cjs');

test(
  'Windows native CLI fallback chooses newest Codex installation and quotes full login path',
  { skip: process.platform !== 'win32' },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-native-discovery-')),
      local = path.join(root, 'local'),
      profile = path.join(root, "user'profile"),
      bin = path.join(local, 'OpenAI', 'Codex', 'bin');
    const saved = {
      PATH: process.env.PATH,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      USERPROFILE: process.env.USERPROFILE,
    };
    for (const [folder, time] of [
      ['aaaa-new', 2026],
      ['zzzz-old', 2020],
    ]) {
      const target = path.join(bin, folder);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'codex.exe'), 'fixture');
      fs.utimesSync(target, new Date(time, 0), new Date(time, 0));
    }
    const claude = path.join(profile, '.local', 'bin', 'claude.exe');
    fs.mkdirSync(path.dirname(claude), { recursive: true });
    fs.writeFileSync(claude, 'fixture');
    try {
      process.env.PATH = '';
      process.env.LOCALAPPDATA = local;
      process.env.USERPROFILE = profile;
      assert.equal(findBinary('codex'), path.join(bin, 'aaaa-new', 'codex.exe'));
      assert.equal(findBinary('claude'), claude);
      assert.equal(
        formatCliCommand('claude', claude, ['auth', 'login']),
        `& '${claude.replaceAll("'", "''")}' auth login`
      );
      process.env.PATH = path.dirname(claude);
      assert.equal(formatCliCommand('claude', claude, ['auth', 'login']), 'claude auth login');
    } finally {
      for (const [key, value] of Object.entries(saved))
        value === undefined ? delete process.env[key] : (process.env[key] = value);
    }
  }
);
test('Claude npm shim supports official native executable and keeps argument boundaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-cli-'));
  const executable = path.join(
    root,
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe'
  );
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, 'fixture');
  const args = ['-p', '--append-system-prompt', 'text with "quotes"; $()'];
  assert.deepEqual(commandFor(path.join(root, 'claude.cmd'), args), { binary: executable, args });
});

test('command runner preserves argument boundaries and split UTF-8 output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-command-')),
    script = path.join(root, 'output.cjs');
  fs.writeFileSync(
    script,
    'const bytes=Buffer.from(JSON.stringify(process.argv.slice(2))); process.stdout.write(bytes.subarray(0,2)); setTimeout(()=>process.stdout.write(bytes.subarray(2)),10);'
  );
  const values = ['équipe "quote"; $()', '--literal', 'space path'];
  assert.deepEqual(JSON.parse(await runCommand(process.execPath, [script, ...values])), values);
});

test('command cancellation does not release caller before child process closes', async () => {
  const controller = new AbortController();
  let child;
  const run = runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    signal: controller.signal,
    onStart: (value) => {
      child = value;
    },
  });
  controller.abort();
  await assert.rejects(run, /Arrêt demandé/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('subscription environment removes conflicting credentials with any casing', () => {
  const env = subscriptionEnv({
    AnThRoPiC_ApI_KeY: 'fixture-only',
    OPENAI_API_KEY: 'fixture-only',
    CLAUDE_CODE_USE_VERTEX: '1',
    DUO_REQUIRED_PATH: 'kept',
  });
  assert.ok(
    !Object.keys(env).some((key) =>
      /^(anthropic_api_key|openai_api_key|claude_code_use_vertex)$/i.test(key)
    )
  );
  assert.equal(env.DUO_REQUIRED_PATH, 'kept');
});
