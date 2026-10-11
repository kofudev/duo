// Real Electron/command execution; AI providers are isolated local protocol fixtures.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const data = path.join(root, '.cache', `autonomy-ui-${randomUUID()}`);
const project = path.join(data, 'project'),
  bin = path.join(data, 'bin'),
  log = path.join(data, 'calls.jsonl');
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
fs.writeFileSync(log, '');
fs.writeFileSync(
  path.join(project, 'check.cjs'),
  'const fs=require("node:fs"); if(!fs.readFileSync("interface.js","utf8").includes("repaired")){ console.error("interface requires repaired marker"); process.exit(3); } console.log("native validation passed");'
);
for (const [name, relative] of [
  ['codex', 'node_modules/@openai/codex/bin/codex.js'],
  ['claude', 'node_modules/@anthropic-ai/claude-code/cli.js'],
]) {
  const entry = path.join(bin, relative);
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(path.join(bin, `${name}.cmd`), '@rem Local test fixture only\r\n');
  fs.writeFileSync(
    entry,
    `require(${JSON.stringify(path.join(__dirname, 'fixtures', `${name}-cli.cjs`))});\n`
  );
}
const env = { ...process.env, DUO_TEST_USER_DATA: data, DUO_FIXTURE_LOG: log };
for (const name of Object.keys(env)) if (name.toLowerCase() === 'path') delete env[name];
env.PATH = bin + path.delimiter + process.env.PATH;
const launch = () =>
  _electron.launch({
    ...(process.env.DUO_PACKAGED_EXE
      ? { executablePath: process.env.DUO_PACKAGED_EXE, args: [] }
      : { args: [root] }),
    cwd: root,
    env,
  });
const records = () =>
  fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
let app;
(async () => {
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(
      () => document.querySelector('.connection-pill')?.textContent.includes('2/2'),
      null,
      { timeout: 60000 }
    );
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [process.env.DUO_TEST_USER_DATA + '\\project'],
      });
      dialog.showMessageBoxSync = () => 1;
    });
    await page.getByRole('button', { name: 'Choisir dossier projet', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.titlebar-project')?.textContent === 'project',
      null,
      { timeout: 60000 }
    );
    await page.getByRole('button', { name: 'Réglages mission', exact: true }).click();
    await page.getByLabel('Accès pendant construction').selectOption('full');
    await page.getByLabel('Validation après construction').selectOption('manual');
    await page.getByLabel('Commandes de validation').fill('node check.cjs');
    await page.getByLabel('Corrections maximum par étape').selectOption('2');
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const accessibility = await page.evaluate(async () =>
      (await axe.run(document.querySelector('dialog'))).violations.map(({ id }) => id)
    );
    assert.deepEqual(accessibility, []);
    // Hidden packaged windows can suspend the Windows compositor. Source runs cover raster QA;
    // packaged runs still assert the native controls, actual permissions and observed outcomes.
    if (!process.env.DUO_PACKAGED_EXE)
      await page.screenshot({ path: path.join(root, 'qa', 'autonomy-settings.png') });
    await page.getByRole('button', { name: 'Fermer fenêtre', exact: true }).click();
    await page.getByRole('button', { name: 'Construire', exact: true }).click();
    await page
      .getByLabel('Demande commune pour Codex et Claude')
      .fill('MOCK_AUTONOMY: simulation locale avec correction de validation.');
    await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.task.done').length === 3 &&
        !document.querySelector('.phase-bar'),
      null,
      { timeout: 60000 }
    );
    let library = await page.evaluate(() => window.duo.library());
    const session = library.sessions[0];
    assert.equal(session.state, 'completed');
    assert.equal(session.config.accessMode, 'full');
    assert.equal(session.config.commands, true);
    assert.equal(session.validation.state, 'passed');
    assert.equal(session.validation.repairs, 1);
    assert.deepEqual(
      session.results.filter((entry) => entry.executor === 'duo').map((entry) => entry.exitCode),
      [3, 0]
    );
    const permissions = records().filter((entry) => entry.event === 'permissions');
    assert.ok(
      permissions.some((entry) => entry.agent === 'codex' && entry.sandbox === 'danger-full-access')
    );
    assert.ok(
      permissions.some((entry) => entry.agent === 'codex' && entry.sandbox === 'read-only')
    );
    assert.ok(
      permissions.some(
        (entry) => entry.agent === 'claude' && entry.permissionMode === 'bypassPermissions'
      )
    );
    assert.ok(
      permissions.some(
        (entry) => entry.agent === 'claude' && !entry.write && !entry.tools.includes('Bash')
      )
    );
    assert.ok(
      records().some(
        (entry) =>
          entry.event === 'file-read' && entry.agent === 'codex' && entry.file === 'interface.js'
      )
    );
    const panel = page.getByRole('region', { name: 'Validation exécutée par Duo' });
    assert.match(await panel.innerText(), /Code 3/);
    await panel.locator('summary').last().click();
    assert.match(await panel.innerText(), /native validation passed/);
    if (!process.env.DUO_PACKAGED_EXE)
      await page.screenshot({ path: path.join(root, 'qa', 'autonomy-validated.png') });
    assert.deepEqual(errors, []);
    const count = records().filter((entry) => entry.event === 'start').length;
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.waitForFunction(
      () => document.querySelector('.connection-pill')?.textContent.includes('2/2'),
      null,
      { timeout: 60000 }
    );
    library = await page.evaluate(() => window.duo.library());
    assert.equal(library.settings.accessMode, 'full');
    assert.equal(library.sessions[0].validation.state, 'passed');
    assert.equal(library.sessions[0].validation.repairs, 1);
    assert.equal(records().filter((entry) => entry.event === 'start').length, count);
    console.log(
      JSON.stringify({
        passed: true,
        fullPermissionsBothProviders: true,
        readonlyReviews: true,
        realCommandCodes: [3, 0],
        peerReviewedRepair: true,
        persistentValidation: true,
        noRendererErrors: true,
        accessibilityViolations: accessibility.length,
        packaged: !!process.env.DUO_PACKAGED_EXE,
      })
    );
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
