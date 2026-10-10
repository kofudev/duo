const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.cache', `mission-ui-${randomUUID()}`),
  bin = path.join(fixtureDir, 'bin'),
  project = path.join(fixtureDir, 'project'),
  logFile = path.join(fixtureDir, 'calls.jsonl');
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
fs.writeFileSync(path.join(project, 'README.md'), '# Projet simulation locale\n');
fs.writeFileSync(logFile, '');
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
const env = { ...process.env, DUO_TEST_USER_DATA: fixtureDir, DUO_FIXTURE_LOG: logFile };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = bin + path.delimiter + process.env.PATH;
const records = () =>
  fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
let app;
(async () => {
  try {
    app = await _electron.launch({ args: [root], cwd: root, env });
    const page = await app.firstWindow(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(
      () => document.querySelector('.connection-pill')?.textContent.includes('2/2'),
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
    await page.evaluate(() => window.duo.settings({ collaboration: 'full' }));
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('2/2')
    );
    await page.getByRole('button', { name: 'Construire', exact: true }).click();
    await page
      .getByLabel('Demande commune pour Codex et Claude')
      .fill('Simulation locale : créer utilitaire + interface.');
    await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll('.task.done').length === 2 &&
          !document.querySelector('.phase-bar'),
        null,
        { timeout: 60000 }
      )
      .catch(async (error) => {
        console.error(
          JSON.stringify({
            body: (await page.locator('body').innerText()).slice(-6000),
            library: await page.evaluate(() => window.duo.library()),
          })
        );
        throw error;
      });
    let data = await page.evaluate(() => window.duo.library());
    const session = data.sessions[0];
    assert.equal(session.state, 'completed');
    assert.equal(session.metrics.calls, 10);
    assert.equal(session.metrics.agents.codex.calls, 6);
    assert.equal(session.metrics.agents.claude.calls, 4);
    assert.equal(session.metrics.agents.codex.inputTokens, 660);
    assert.equal(session.metrics.agents.claude.outputTokens, 200);
    assert.equal(session.metrics.agents.claude.inputTokens, 568);
    assert.equal(session.activity.length, 4);
    assert.ok(session.tasks.every((task) => task.reviewEvidence.files[0].hash));
    assert.equal(await page.locator('.structured-message.plan').count(), 1);
    assert.equal(await page.locator('.review-verdict.favorable').count(), 2);
    await page.locator('.structured-message.plan .raw-response summary').click();
    assert.ok(
      (await page.locator('.structured-message.plan .raw-response pre').innerText()).includes(
        'tasks'
      )
    );
    await page.locator('.structured-message.plan .raw-response summary').click();
    await page.getByText('Journal outils', { exact: true }).click();
    assert.equal(await page.locator('.activity-log article').count(), 4);
    await page.getByLabel('Filtrer journal outils', { exact: true }).selectOption('claude');
    assert.equal(await page.locator('.activity-log article').count(), 2);
    await page.getByText('Fichiers relus', { exact: true }).click();
    assert.equal(await page.locator('.review-evidence').count(), 2);
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const accessibility = await page.evaluate(() =>
      window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })
    );
    fs.writeFileSync(
      path.join(root, 'qa', 'accessibility-mission.json'),
      JSON.stringify(accessibility, null, 2)
    );
    assert.deepEqual(
      accessibility.violations.map((item) => item.id),
      []
    );
    const exported = path.join(fixtureDir, 'conversation.md');
    await app.evaluate(({ dialog }, output) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    }, exported);
    await page.getByRole('button', { name: 'Exporter conversation', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.error-banner'));
    const markdown = fs.readFileSync(exported, 'utf8');
    assert.ok(markdown.includes('Journal outils observés'));
    assert.ok(markdown.includes('SHA-256'));
    assert.ok(markdown.includes('568'));
    assert.ok(
      fs.readFileSync(path.join(project, 'utility.js'), 'utf8').includes('fixture-verified')
    );
    assert.ok(
      fs.readFileSync(path.join(project, 'interface.js'), 'utf8').includes('fixture-verified')
    );
    const calls = records();
    let writers = 0,
      peakWriters = 0,
      readers = 0,
      peakReaders = 0;
    for (const call of calls) {
      if (call.event === 'start') {
        call.write
          ? (peakWriters = Math.max(peakWriters, ++writers))
          : (peakReaders = Math.max(peakReaders, ++readers));
      }
      if (call.event === 'end') call.write ? writers-- : readers--;
    }
    assert.equal(peakWriters, 1);
    assert.equal(peakReaders, 2);
    assert.deepEqual(
      calls.filter((c) => c.event === 'file-read').map((c) => [c.agent, c.file]),
      [
        ['claude', 'utility.js'],
        ['codex', 'interface.js'],
      ]
    );
    assert.ok(
      calls
        .filter((c) => c.event === 'permissions' && c.agent === 'codex')
        .every((c) => c.retainsBaseInstructions)
    );
    assert.ok(
      calls
        .filter((c) => c.event === 'permissions' && c.agent === 'claude' && !c.write)
        .every((c) => !c.tools.includes('Write') && !c.tools.includes('Bash'))
    );
    await page.screenshot({ path: path.join(root, 'qa', 'duo-v2-mission-simulation.png') });
    // Human blockers survive reload; blind CONTINUE cannot spend or rebuild.
    await page
      .getByRole('button', { name: /^Nouvelle mission/ })
      .first()
      .click();
    await page
      .getByLabel('Demande commune pour Codex et Claude')
      .fill('MOCK_WAIT : modifier sources existantes, objectif conservé.');
    await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
    await page.locator('.mission-wait').waitFor();
    let blocked = await page.evaluate(() => window.duo.library());
    const blockedId = blocked.sessions[0].id,
      objective = blocked.sessions[0].progress.objective,
      callsBefore = records().filter((entry) => entry.event === 'start').length;
    assert.equal(blocked.sessions[0].state, 'waiting_user');
    await page.getByLabel('Demande commune pour Codex et Claude').fill('CONTINUE');
    await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('.phase-bar') && document.querySelector('#prompt').value === ''
    );
    assert.equal(records().filter((entry) => entry.event === 'start').length, callsBefore);
    await page.reload();
    await page.locator('.mission-wait').waitFor();
    const corrected = path.join(fixtureDir, 'sources');
    fs.mkdirSync(corrected);
    fs.writeFileSync(path.join(corrected, 'README.md'), '# Correct project sources\n');
    fs.writeFileSync(path.join(corrected, 'sources-ready.txt'), 'actual source root');
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, corrected);
    await page
      .getByRole('button', { name: 'Choisir autre dossier pour mission', exact: true })
      .click();
    await page.getByRole('button', { name: 'Reprendre mission', exact: true }).waitFor();
    blocked = await page.evaluate(() => window.duo.library());
    assert.equal(
      blocked.sessions.find((item) => item.id === blockedId).progress.objective,
      objective
    );
    assert.equal(blocked.settings.mode, 'build');
    assert.equal(blocked.settings.project, corrected);
    await page.getByRole('button', { name: 'Reprendre mission', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.task.done').length === 2 &&
        !document.querySelector('.phase-bar'),
      null,
      { timeout: 60000 }
    );
    blocked = await page.evaluate(() => window.duo.library());
    assert.equal(blocked.sessions.find((item) => item.id === blockedId).state, 'completed');
    assert.ok(fs.existsSync(path.join(corrected, 'utility.js')));
    assert.equal(await page.locator('.mission-recap .recap-files button').count(), 2);
    // A failed re-review stops before the second task.
    await page
      .getByRole('button', { name: /^Nouvelle mission/ })
      .first()
      .click();
    await page.getByRole('heading', { name: 'Une idée.', exact: false }).waitFor();
    await page
      .getByLabel('Demande commune pour Codex et Claude')
      .fill('MOCK_ATTENTION : défaut simulé persistant.');
    await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.task.attention') && !document.querySelector('.phase-bar'),
      null,
      { timeout: 60000 }
    );
    data = await page.evaluate(() => window.duo.library());
    assert.equal(data.sessions[0].state, 'attention');
    assert.equal(data.sessions[0].tasks[1].status, 'pending');
    // Cancellation interrupts Codex and kills Claude, then permits a new mission.
    await page
      .getByRole('button', { name: /^Nouvelle mission/ })
      .first()
      .click();
    await page.getByRole('heading', { name: 'Une idée.', exact: false }).waitFor();
    await page
      .getByLabel('Demande commune pour Codex et Claude')
      .fill('MOCK_CANCEL : attente simulée.');
    await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
    await page.getByRole('button', { name: 'Arrêter', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.stream-state').length === 2);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.getByRole('button', { name: 'Arrêter', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.phase-bar'), { timeout: 30000 });
    data = await page.evaluate(() => window.duo.library());
    assert.equal(data.sessions[0].state, 'stopped');
    assert.ok(records().some((c) => c.event === 'interrupt'));
    assert.deepEqual(errors, []);
    assert.equal(await page.getByRole('alert').count(), 0);
    console.log(
      JSON.stringify({
        passed: true,
        simulation: true,
        checks: [
          'real CLI subprocess protocols',
          'parallel proposals',
          'cross discussion',
          'structured task assignment',
          'readable plan and review verdicts',
          'one writer at once',
          'partner reads actual files',
          'coordinator snapshots + digests',
          'persistent tool journal + filter',
          'Markdown export with evidence and metrics',
          'authoritative finals',
          'per-agent token counts including cache',
          'read-only tool permissions',
          'native mission accessibility',
          'waiting user survives reload without CONTINUE calls',
          'existing folder correction preserves mission objective and build mode',
          'observed file recap',
          'failed review stops next task',
          'both providers cancelled',
          'no renderer errors',
        ],
        fixtureDir,
      })
    );
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
