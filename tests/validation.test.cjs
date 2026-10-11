const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runValidation, validationCommands } = require('../electron/validation.cjs');
const { configPatch, Library } = require('../electron/library.cjs');
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'duo-validation-$-'));
test('validation discovers only available npm checks, or exact configured commands', () => {
  const project = folder();
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ scripts: { test: 'node check.js', build: 'vite build', start: 'server' } })
  );
  assert.deepEqual(validationCommands(project, { validationMode: 'auto' }), [
    'npm run test',
    'npm run build',
  ]);
  assert.deepEqual(
    validationCommands(project, {
      validationMode: 'manual',
      validationCommands: ['node check.js'],
    }),
    ['node check.js']
  );
  assert.deepEqual(validationCommands(project, { validationMode: 'off' }), []);
  assert.deepEqual(validationCommands(folder(), { validationMode: 'auto' }), []);
});
test('new permissions default to project; malformed modes, bounds and command lists fail', () => {
  assert.equal(new Library().settings.accessMode, 'project');
  assert.equal(configPatch({ accessMode: 'full' }).accessMode, 'full');
  assert.throws(() => configPatch({ accessMode: 'anything' }));
  assert.throws(() => configPatch({ validationCommands: Array(9).fill('npm test') }));
  assert.throws(() => configPatch({ validationCommands: ['node test\nwhoami'] }));
  assert.throws(() => configPatch({ validationTimeoutSeconds: 901 }));
  assert.throws(() => configPatch({ maxFixCycles: 6 }));
});
test('actual command exit codes override success-looking text; literal cwd and spaced script names work', async () => {
  const project = folder();
  fs.writeFileSync(
    path.join(project, 'check space.cjs'),
    'console.log("PASSED-looking text"); console.error("actual failure"); process.exit(7);'
  );
  const failed = await runValidation(project, 'node "check space.cjs"');
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.status, 'failed');
  assert.match(failed.stdout, /PASSED/);
  assert.match(failed.stderr, /actual failure/);
  fs.writeFileSync(path.join(project, 'check space.cjs'), 'console.log(process.cwd());');
  const passed = await runValidation(project, 'node "check space.cjs"');
  assert.equal(passed.exitCode, 0);
  assert.equal(fs.realpathSync.native(passed.stdout.trim()), fs.realpathSync.native(project));
});
test('cancellation waits for command tree closure, preventing child heartbeat from continuing', async () => {
  const project = folder(),
    heartbeat = path.join(project, 'heartbeat.txt');
  fs.writeFileSync(
    path.join(project, 'long.cjs'),
    'const fs=require("node:fs"); fs.writeFileSync("heartbeat.txt","start"); setInterval(()=>fs.appendFileSync("heartbeat.txt","."),50);'
  );
  const controller = new AbortController();
  const running = runValidation(project, 'node long.cjs', { signal: controller.signal });
  const stopped = assert.rejects(running, /Arrêt demandé/);
  for (let index = 0; index < 120 && !fs.existsSync(heartbeat); index++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(fs.existsSync(heartbeat));
  controller.abort();
  await stopped;
  const contents = fs.readFileSync(heartbeat, 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(fs.readFileSync(heartbeat, 'utf8'), contents);
});
test('timeout stays a failed observed check, never a successful exit', async () => {
  const project = folder();
  fs.writeFileSync(path.join(project, 'long.cjs'), 'setInterval(()=>{},1000);');
  const result = await runValidation(project, 'node long.cjs', { timeoutMs: 1000 });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /Délai/);
});
