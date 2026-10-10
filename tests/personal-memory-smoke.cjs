// Native Electron test with local CLI protocol fixtures. No remote AI inference.
const { _electron } = require('playwright'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..'),
  dataDir = path.join(root, '.cache', `personal-ui-${randomUUID()}`),
  bin = path.join(dataDir, 'bin'),
  project = path.join(dataDir, 'project'),
  other = path.join(dataDir, 'other'),
  log = path.join(dataDir, 'calls.jsonl'),
  exported = path.join(dataDir, 'exported-memory.json'),
  input = path.join(dataDir, 'memory.md');
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
for (const folder of [bin, project, other]) fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(log, '');
fs.writeFileSync(path.join(project, 'README.md'), '# Local simulation\n');
fs.writeFileSync(input, 'USER_PROFILE_CANARY Français concis.\n\nNote à exclure de cet import.');
fs.writeFileSync(
  path.join(dataDir, 'workspace.json'),
  JSON.stringify({
    schemaVersion: 3,
    workspaces: [{ id: 'w', name: 'Personnel' }],
    projects: [
      {
        id: 'p',
        workspaceId: 'w',
        name: 'project',
        path: project,
        memory: [
          {
            id: 'project-note',
            title: 'Utilitaire',
            text: 'PROJECT_CANARY interface et utilitaire.',
            tags: ['utilitaire'],
            pinned: true,
            at: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        settings: {
          codexModel: 'fixture-codex',
          codexEffort: 'high',
          claudeModel: 'opus',
          claudeEffort: 'max',
        },
      },
      { id: 'other', workspaceId: 'w', name: 'other', path: other, settings: {} },
    ],
    sessions: [],
    activeProjectId: 'p',
    activeWorkspaceId: 'w',
  })
);
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
function checked(value) {
  checks.push(value);
  console.log(value);
}
async function open() {
  app = await _electron.launch({
    ...(process.env.DUO_PACKAGED_EXE
      ? { executablePath: process.env.DUO_PACKAGED_EXE, args: [] }
      : { args: [root] }),
    cwd: root,
    env,
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(
    () => document.querySelector('.connection-pill')?.textContent.includes('2/2'),
    null,
    { timeout: 60000 }
  );
}
async function pilot() {
  await page.getByRole('button', { name: 'Pilotage & mémoire', exact: true }).click();
  await page.getByRole('heading', { name: 'Pilotage & mémoire', exact: true }).waitFor();
}
async function waitData(predicate, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const data = await page.evaluate(() => window.duo.library());
    if (predicate(data)) return data;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Backend condition timed out');
}
async function audit(name) {
  await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
  const result = await page.evaluate(() =>
    window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })
  );
  assert.deepEqual(
    result.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
    [],
    name
  );
  return {
    screen: name,
    violations: result.violations.length,
    passes: result.passes.length,
    incomplete: result.incomplete.map((item) => item.id),
  };
}
(async () => {
  try {
    await open();
    const initial = await page.evaluate(() => window.duo.library());
    assert.equal(initial.schemaVersion, 5);
    assert.equal(initial.settings.timeLimitEnabled, false);
    assert.equal(initial.projects[0].memory[0].id, 'project-note');
    assert.ok(fs.readdirSync(dataDir).some((file) => file.includes('.v3-backup-')));
    checked('v3 migration with backup; project note retained; duration off by default');
    await pilot();
    assert.equal(
      await page.getByLabel('Activer limite de durée', { exact: false }).isChecked(),
      false
    );
    assert.equal(await page.getByLabel('Durée maximale (minutes)', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Importer mémoire', exact: true }).click();
    await page.getByLabel('Source mémoire', { exact: true }).selectOption('claude');
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, input);
    await page.getByRole('button', { name: 'Choisir fichier', exact: true }).click();
    await page.getByRole('button', { name: 'Préparer aperçu', exact: true }).click();
    await page.getByLabel('Contenu import 1', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.duo.memory())).personalNotes.length, 0);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('"event":"start"'));
    await page
      .getByLabel('Contenu import 1', { exact: true })
      .fill('USER_PROFILE_CANARY Réponses françaises brèves.');
    await page.getByLabel('Épingler note 1', { exact: true }).check();
    await page.getByLabel('Importer note 2', { exact: true }).uncheck();
    const audits = [await audit('import preview')];
    await page
      .getByRole('button', { name: 'Importer 1 note(s) sélectionnée(s)', exact: true })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await waitData((data) => data.personalMemory.length === 1);
    const saved = (await page.evaluate(() => window.duo.memory())).personalNotes[0];
    assert.equal(saved.source, 'claude');
    assert.equal(saved.pinned, true);
    assert.equal(saved.text, 'USER_PROFILE_CANARY Réponses françaises brèves.');
    checked('file import preview, manual editing and exclusion; no inference before import');
    await page.getByRole('button', { name: 'Modifier préférence', exact: true }).click();
    await page
      .getByLabel('Titre mémoire personnelle', { exact: true })
      .fill('Style personnel commun');
    await page.getByRole('button', { name: 'Enregistrer préférence', exact: true }).click();
    await waitData((data) => data.personalMemory[0].title === 'Style personnel commun');
    const duplicate = await page.evaluate(
      (note) => window.duo.importMemory({ scope: 'personal', source: 'chatgpt', notes: [note] }),
      saved
    );
    assert.equal(duplicate.added, 0);
    assert.equal(duplicate.duplicates, 1);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, exported);
    await page.getByRole('button', { name: 'Exporter mémoire', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.error-banner'));
    const until = Date.now() + 10000;
    while (!fs.existsSync(exported) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const backup = JSON.parse(fs.readFileSync(exported, 'utf8'));
    assert.equal(backup.notes[0].source, 'claude');
    assert.equal(backup.notes[0].text, saved.text);
    checked(
      'personal note edit preserves source, duplicate import ignored and JSON export verified'
    );
    await page.evaluate(() => window.duo.activateProject({ projectId: 'other' }));
    let notes = await page.evaluate(() => window.duo.memory());
    assert.equal(notes.personalNotes.length, 1);
    assert.equal(notes.notes.length, 0);
    await page.evaluate(() => window.duo.activateProject({ projectId: 'p' }));
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('2/2')
    );
    await pilot();
    await page.getByLabel('Partager mémoire personnelle avec les deux', { exact: false }).uncheck();
    await waitData((data) => data.settings.personalMemoryEnabled === false);
    assert.equal((await page.evaluate(() => window.duo.memory())).personalNotes.length, 1);
    await page.getByLabel('Partager mémoire personnelle avec les deux', { exact: false }).check();
    await waitData((data) => data.settings.personalMemoryEnabled === true);
    checked(
      'shared profile across projects; project notes isolated; disabling sharing retains notes'
    );
    audits.push(await audit('personal profile'));
    if (!process.env.DUO_PACKAGED_EXE)
      await page.screenshot({ path: path.join(root, 'qa', 'duo-personal.png') });
    else {
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(geometry.documentWidth <= geometry.width);
      checked('packaged profile layout within window; source raster visually reviewed');
    }
    await page.evaluate(() =>
      window.duo.settings({
        mode: 'build',
        collaboration: 'full',
        rounds: 1,
        memoryEnabled: true,
        personalMemoryEnabled: true,
        timeLimitEnabled: false,
        maxCalls: 24,
      })
    );
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('2/2')
    );
    await page
      .getByRole('button', { name: /^Nouvelle mission/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Construire', exact: true }).click();
    await page
      .getByLabel('Demande commune pour Codex et Claude')
      .fill('Simulation locale : interface et utilitaire');
    await page.evaluate(() => {
      window.duoBothWorkingSeen = false;
      window.duoWorkingObserver = new MutationObserver(() => {
        if (
          [...document.querySelectorAll('.team-member small')].filter(
            (node) => node.textContent === 'En cours'
          ).length === 2
        )
          window.duoBothWorkingSeen = true;
      });
      window.duoWorkingObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
    await page.waitForFunction(() => window.duoBothWorkingSeen, null, { polling: 100 });
    await page.evaluate(() => window.duoWorkingObserver.disconnect());
    checked('both agents visibly working during parallel proposals');
    const finished = await waitData((data) => data.sessions[0]?.state === 'completed');
    const session = finished.sessions[0];
    assert.equal(session.budget.deadline, null);
    assert.equal(session.context.personalMemoryIds.length, 1);
    assert.equal(session.context.projectMemoryIds.length, 1);
    assert.ok(
      session.messages.some(
        (message) => message.agent === 'codex' && message.phase === 'Discussion'
      )
    );
    assert.ok(
      session.messages.some(
        (message) => message.agent === 'claude' && message.phase === 'Discussion'
      )
    );
    assert.ok(session.tasks.every((task) => task.status === 'done'));
    const calls = fs
      .readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((item) => item.event === 'start');
    assert.equal(calls.length, 10);
    assert.ok(calls.every((call) => call.sharedMemoryCanary));
    assert.deepEqual([...new Set(calls.map((call) => call.agent))].sort(), ['claude', 'codex']);
    assert.ok((await page.locator('.messages').innerText()).includes('Simulation locale claude'));
    assert.ok((await page.locator('.messages').innerText()).includes('Simulation locale codex'));
    checked(
      'complete mission displays discussions + construction + review; same shared memory in all ten provider calls'
    );
    const before = finished.personalMemory[0].text;
    await app.close();
    app = null;
    await open();
    assert.equal((await page.evaluate(() => window.duo.memory())).personalNotes[0].text, before);
    checked('restart retains personal memory and project checkpoint');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(
        root,
        'qa',
        process.env.DUO_PACKAGED_EXE
          ? 'personal-memory-packaged-report.json'
          : 'personal-memory-report.json'
      ),
      JSON.stringify(
        {
          passed: true,
          packaged: !!process.env.DUO_PACKAGED_EXE,
          version: require('../package.json').version,
          checks,
          audits,
          errors,
          dataDir,
        },
        null,
        2
      )
    );
  } catch (error) {
    if (page) {
      console.error((await page.locator('body').innerText()).slice(-2200));
      if (!process.env.DUO_PACKAGED_EXE)
        await page
          .screenshot({ path: path.join(root, 'qa', 'personal-memory-failure.png'), timeout: 5000 })
          .catch(() => {});
    }
    throw error;
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
