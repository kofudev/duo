// Real Electron + local provider protocol fixtures. No paid AI inference.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..'),
  dataDir = path.join(root, '.cache', `pilot-ui-${randomUUID()}`),
  bin = path.join(dataDir, 'bin'),
  project = path.join(dataDir, 'project'),
  other = path.join(dataDir, 'other'),
  log = path.join(dataDir, 'calls.jsonl');
for (const folder of [bin, project, other]) fs.mkdirSync(folder, { recursive: true });
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
fs.writeFileSync(log, '');
fs.writeFileSync(path.join(project, 'README.md'), '# Local simulation\n');
for (const [name, relative] of [
  ['codex', 'node_modules/@openai/codex/bin/codex.js'],
  ['claude', 'node_modules/@anthropic-ai/claude-code/cli.js'],
]) {
  const entry = path.join(bin, relative);
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(path.join(bin, `${name}.cmd`), '@rem local fixture\r\n');
  fs.writeFileSync(
    entry,
    `require(${JSON.stringify(path.join(__dirname, 'fixtures', `${name}-cli.cjs`))});\n`
  );
}
const env = { ...process.env, DUO_TEST_USER_DATA: dataDir, DUO_FIXTURE_LOG: log };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = bin + path.delimiter + process.env.PATH;
let app, page;
const checks = [],
  errors = [];
checks.push = function (...items) {
  console.log(JSON.stringify({ step: items.join('; ') }));
  return Array.prototype.push.apply(this, items);
};
async function open() {
  app = await _electron.launch({
    ...(process.env.DUO_PACKAGED_EXE
      ? { executablePath: process.env.DUO_PACKAGED_EXE, args: [] }
      : { args: [root] }),
    cwd: root,
    env,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(
    () => document.querySelector('.connection-pill')?.textContent.includes('2/2'),
    null,
    { timeout: 60000 }
  );
}
async function pick(folder) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] });
    dialog.showMessageBoxSync = () => 1;
  }, folder);
  await page.getByRole('button', { name: 'Choisir dossier projet', exact: true }).click();
  await page.waitForFunction(
    (name) => document.querySelector('.titlebar-project')?.textContent === name,
    path.basename(folder)
  );
}
async function pilot() {
  await page.getByRole('button', { name: 'Pilotage & mémoire', exact: true }).click();
  await page.getByRole('heading', { name: 'Pilotage & mémoire', exact: true }).waitFor();
}
async function waitData(predicate, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let data;
  do {
    data = await page.evaluate(() => window.duo.library());
    if (predicate(data)) return data;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  throw new Error(
    'Backend condition timed out: ' +
      JSON.stringify({
        schedules: data.schedules,
        states: data.sessions.map((session) => session.state),
      })
  );
}
async function mission(prompt) {
  await page.getByRole('button', { name: 'Espace de travail', exact: true }).click();
  await page
    .getByRole('button', { name: /^Nouvelle mission/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Construire', exact: true }).click();
  await page.getByLabel('Demande commune pour Codex et Claude').fill(prompt);
  await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
  const data = await waitData(
    (data) =>
      data.sessions[0].state !== 'running' &&
      data.sessions[0].messages.some(
        (message) => message.agent === 'user' && message.text === prompt
      )
  );
  return data.sessions[0];
}
(async () => {
  try {
    await open();
    await pick(project);
    await pilot();
    await page.getByLabel('Activer limite de durée', { exact: false }).check();
    await page.getByLabel('Durée maximale (minutes)', { exact: true }).fill('180');
    await page.getByLabel('Durée maximale (minutes)', { exact: true }).press('Tab');
    await waitData((data) => data.settings.durationMinutes === 180);
    await page.getByLabel('Titre note', { exact: true }).fill('Contrainte interface');
    await page
      .getByLabel('Contenu mémoire', { exact: true })
      .fill('Interface publique doit rester compatible. Voir interface.js.');
    await page.getByLabel('Tags (séparés par virgules)').fill('interface, api');
    await page.getByLabel('Épingler · contexte prioritaire', { exact: true }).check();
    await page.getByRole('button', { name: 'Ajouter note', exact: true }).click();
    await page.locator('.memory-list article').waitFor();
    assert.equal((await page.evaluate(() => window.duo.memory())).notes.length, 1);
    checks.push('duration preference and pinned project note saved');
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await page
      .getByLabel('Contenu mémoire', { exact: true })
      .fill('API stable. Vérifier interface.js avant changement.');
    await page.getByRole('button', { name: 'Enregistrer note', exact: true }).click();
    await waitData((data) =>
      data.projects
        .find((project) => project.id === data.activeProjectId)
        .memory[0].text.startsWith('API stable')
    );
    checks.push('memory edit saved');
    await page.getByRole('button', { name: 'Planifier', exact: true }).click();
    await page
      .getByLabel('Demande planifiée', { exact: true })
      .fill('Plan futur simulation locale');
    await page.getByRole('button', { name: 'Enregistrer planification', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await pilot();
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await waitData((data) => data.schedules[0].state === 'cancelled');
    checks.push('schedule dialog + cancellation');
    await page.evaluate(() => window.duo.settings({ maxCalls: 3 }));
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('2/2')
    );
    const paused = await mission('Simulation locale : utilitaire et interface');
    assert.equal(paused.state, 'paused');
    assert.equal(paused.budget.calls, 3);
    assert.equal(paused.tasks[0].status, 'done');
    assert.equal(paused.tasks[1].status, 'pending');
    assert.equal(paused.context.selectedMemoryIds.length, 1);
    assert.equal(paused.context.totalNotes, 1);
    checks.push('native budget pause after validated first task; selected memory injected');
    await pilot();
    assert.ok(
      (await page.evaluate(() => window.duo.memory())).notes.some(
        (note) => note.kind === 'checkpoint'
      )
    );
    await page.screenshot({ path: path.join(root, 'qa', 'duo-pilot.png') });
    await page.evaluate(() => window.duo.settings({ quotaPolicy: 'strict', maxCalls: 24 }));
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('2/2')
    );
    const strict = await mission('Simulation strict quota');
    assert.equal(strict.state, 'paused');
    assert.equal(strict.stopReason.code, 'quota-unknown');
    assert.equal(strict.budget.calls, 0);
    assert.equal(strict.tasks.length, 0);
    checks.push('strict policy blocks unknown Claude quota before any inference or file edit');
    // A future job remains tied to its own project while user works elsewhere.
    const initial = await page.evaluate(() => window.duo.library());
    const firstId = initial.activeProjectId;
    const scheduled = await page.evaluate(() =>
      window.duo.schedule({
        prompt: 'Simulation locale planifiée : utilitaire + interface',
        dueAt: Date.now() + 12000,
        config: {
          ...(window.__testConfig || {}),
          mode: 'build',
          collaboration: 'economy',
          maxCalls: 24,
          quotaPolicy: 'available',
          durationMinutes: 2,
          codexModel: 'fixture-codex',
          codexEffort: 'high',
          claudeModel: 'opus',
          claudeEffort: 'max',
          skills: ['project-memory', 'quota-efficiency'],
        },
      })
    );
    const jobId = scheduled.schedules.at(-1).id;
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('2/2')
    );
    await pick(other);
    await waitData((data) => {
      const job = data.schedules.find((job) => job.id === jobId);
      if (['blocked', 'failed', 'paused'].includes(job?.state))
        throw new Error('Schedule failed: ' + JSON.stringify(job));
      return job?.state === 'completed';
    });
    let state = await page.evaluate(() => window.duo.library());
    const job = state.schedules.find((job) => job.id === jobId),
      result = state.sessions.find((session) => session.id === job.sessionId);
    assert.equal(result.projectId, firstId);
    assert.notEqual(state.activeProjectId, firstId);
    assert.equal(result.budget.calls, 6);
    assert.equal(result.state, 'completed');
    assert.equal(fs.existsSync(path.join(other, 'utility.js')), false);
    assert.ok(
      fs.readFileSync(path.join(project, 'interface.js'), 'utf8').includes('fixture-verified')
    );
    checks.push(
      'scheduled six-call mission writes original project while another project selected'
    );
    await page.evaluate((id) => window.duo.activateProject({ projectId: id }), firstId);
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('2/2')
    );
    await pilot();
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const accessibility = await page.evaluate(() =>
      window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })
    );
    fs.writeFileSync(
      path.join(root, 'qa', 'accessibility-pilot.json'),
      JSON.stringify(accessibility, null, 2)
    );
    assert.deepEqual(
      accessibility.violations.map((item) => item.id),
      []
    );
    checks.push('pilot WCAG audit no reported violations');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
    await page.waitForFunction(() => window.innerWidth <= 960);
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(layout.pageWidth <= layout.width);
    // Hidden packaged Windows windows can suspend compositor screenshots after resize.
    // Compact raster is checked with the source app; installed app checks actual geometry.
    if (!process.env.DUO_PACKAGED_EXE)
      await page.screenshot({ path: path.join(root, 'qa', 'duo-pilot-compact.png') });
    const before = await page.evaluate(() => window.duo.usage());
    await app.close();
    app = null;
    await open();
    state = await page.evaluate(() => window.duo.library());
    assert.equal(state.schemaVersion, 4);
    assert.ok(state.projects.find((project) => project.id === firstId).memory.length >= 3);
    assert.equal((await page.evaluate(() => window.duo.usage())).calls, before.calls);
    assert.equal(state.schedules.find((job) => job.id === jobId).state, 'completed');
    checks.push('restart retains notes, usage ledger and completed schedule without replay');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(root, 'qa', 'pilot-report.json'),
      JSON.stringify(
        { passed: true, packaged: !!process.env.DUO_PACKAGED_EXE, checks, errors, dataDir },
        null,
        2
      )
    );
    console.log(JSON.stringify({ passed: true, checks, dataDir }));
  } catch (error) {
    if (page) {
      console.error((await page.locator('body').innerText()).slice(-6500));
      await page.screenshot({ path: path.join(root, 'qa', 'pilot-failure.png') });
    }
    throw error;
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
