// Native Windows workflows. AI subprocesses are local protocol fixtures; no provider requests.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.cache', `advanced-ui-${randomUUID()}`);
const projects = path.join(dataDir, 'projects'),
  original = path.join(projects, 'source'),
  relocated = path.join(projects, 'déplacé'),
  bin = path.join(dataDir, 'bin');
fs.mkdirSync(original, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'calls.jsonl'), '');
fs.writeFileSync(path.join(original, 'README.md'), '# Fichier initial\n');
fs.writeFileSync(path.join(original, 'main.js'), 'module.exports = 1;\n');
const git = (...args) =>
  execFileSync('git', args, {
    cwd: fs.existsSync(relocated) ? relocated : original,
    encoding: 'utf8',
    windowsHide: true,
  });
git('init', '-b', 'main');
git('config', 'user.name', 'Duo Fixture');
git('config', 'user.email', 'duo-fixture@example.invalid');
git('add', '.');
git('commit', '-m', 'Fixture initiale');
fs.writeFileSync(path.join(original, 'main.js'), 'module.exports = 2; // source dirty\n');
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
const env = {
  ...process.env,
  DUO_TEST_USER_DATA: dataDir,
  DUO_FIXTURE_LOG: path.join(dataDir, 'calls.jsonl'),
};
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = bin + path.delimiter + process.env.PATH;
let app, page;
const errors = [],
  checks = [];
checks.push = function (...items) {
  console.log(JSON.stringify({ step: items.join('; ') }));
  return Array.prototype.push.apply(this, items);
};
async function pick(folder) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] });
    dialog.showMessageBoxSync = () => 1;
  }, folder);
}
async function modalClosed() {
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
async function projectsPage() {
  await page.getByRole('button', { name: /^Projets/ }).click();
}
async function editProject(name = 'source') {
  await projectsPage();
  await page.getByRole('button', { name: `Modifier ${name}`, exact: true }).click();
}
async function open() {
  app = await _electron.launch({ args: [root], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(
    () => document.querySelector('.connection-pill')?.textContent.includes('2/2'),
    null,
    { timeout: 60000 }
  );
}
(async () => {
  try {
    await open();
    await pick(original);
    await page.getByRole('button', { name: 'Choisir dossier projet', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.titlebar-project')?.textContent === 'source'
    );
    await page
      .getByRole('button', { name: /^Nouvelle mission/ })
      .first()
      .click();
    await page
      .getByRole('button', { name: 'Options mission Nouvelle mission', exact: true })
      .click();
    await page.getByLabel('Titre mission').fill('Mission conservée');
    await page.getByRole('button', { name: 'Enregistrer titre', exact: true }).click();
    await modalClosed();
    await page.getByLabel('Rechercher missions').fill('introuvable');
    assert.equal(await page.locator('.session-row').count(), 0);
    await page.getByLabel('Rechercher missions').fill('');
    await page
      .getByRole('button', { name: 'Options mission Mission conservée', exact: true })
      .click();
    await page.getByRole('button', { name: 'Archiver mission', exact: true }).click();
    await modalClosed();
    await page.getByRole('button', { name: 'Archives (1)', exact: true }).click();
    await page
      .getByRole('button', { name: 'Options mission Mission conservée', exact: true })
      .click();
    await page.getByRole('button', { name: 'Restaurer mission', exact: true }).click();
    await modalClosed();
    await page.getByRole('button', { name: 'Missions actives', exact: true }).click();
    checks.push('session rename, search, archive, restore');
    await editProject();
    await page.getByLabel('Brief projet').fill('Fixture déplacée. Historique conservé.');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await modalClosed();
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.getByLabel('Nom workspace', { exact: true }).fill('Studio déplacé');
    await page.getByRole('button', { name: 'Créer workspace', exact: true }).click();
    await modalClosed();
    let state = await page.evaluate(() => window.duo.library());
    const destination = state.activeWorkspaceId,
      source = state.projects[0];
    await page.getByLabel('Workspace actif').selectOption(source.workspaceId);
    await editProject();
    await page.getByLabel('Workspace destination').selectOption(destination);
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await modalClosed();
    state = await page.evaluate(() => window.duo.library());
    assert.equal(state.activeWorkspaceId, destination);
    assert.equal(state.sessions[0].workspaceId, destination);
    checks.push('move project preserves mission ownership');
    fs.renameSync(original, relocated);
    await pick(relocated);
    await editProject();
    await page.getByRole('button', { name: 'Rechoisir dossier déplacé', exact: true }).click();
    await page.waitForFunction(
      (value) => document.querySelector('.modal .path-preview code')?.textContent === value,
      relocated
    );
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await modalClosed();
    state = await page.evaluate(() => window.duo.library());
    assert.equal(state.projects[0].path, relocated);
    assert.equal(state.sessions[0].project, relocated);
    checks.push('relink moved folder preserves history');
    await page.getByRole('button', { name: /^Skills/ }).click();
    await page.getByLabel('Intensité Caveman').selectOption('ultra');
    await pick(projects);
    await editProject();
    await page.getByRole('button', { name: 'Créer worktree isolé', exact: true }).click();
    await page.getByLabel('Nom nouveau dossier').fill('copie isolée');
    await page.getByRole('button', { name: 'Choisir', exact: true }).click();
    await page.getByRole('button', { name: 'Créer worktree', exact: true }).click();
    await modalClosed();
    state = await page.evaluate(() => window.duo.library());
    const worktree = state.projects.find((p) => p.id === state.activeProjectId);
    assert.notEqual(worktree.id, source.id);
    assert.equal(state.settings.cavemanLevel, 'ultra');
    assert.equal(worktree.description, 'Fixture déplacée. Historique conservé.');
    assert.equal(git('branch', '--show-current').trim(), 'main');
    assert.ok(fs.readFileSync(path.join(relocated, 'main.js'), 'utf8').includes('source dirty'));
    assert.equal(
      execFileSync('git', ['branch', '--show-current'], {
        cwd: worktree.path,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      'varelia/copie-isolee'
    );
    checks.push('native worktree creates branch and retains dirty source');
    await page.getByRole('button', { name: /^Fichiers/ }).click();
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    await page.locator('.cm-content').waitFor();
    fs.writeFileSync(path.join(worktree.path, 'README.md'), '# Disque actualisé\n');
    await page.waitForFunction(() =>
      document.querySelector('.cm-content')?.textContent.includes('Disque actualisé')
    );
    const geometry = await page.evaluate(() => ({
      code: document.querySelector('.cm-line').getBoundingClientRect().top,
      gutter: document
        .querySelector('.cm-lineNumbers .cm-gutterElement:not(.cm-gutterElement:first-child)')
        ?.getBoundingClientRect().top,
    }));
    assert.ok(Number.isFinite(geometry.gutter));
    assert.ok(Math.abs(geometry.code - geometry.gutter) < 2, JSON.stringify(geometry));
    await page.locator('.cm-content').fill('# Brouillon worktree\n');
    fs.writeFileSync(path.join(worktree.path, 'README.md'), '# Modification concurrente\n');
    await page.locator('.editor-disk-change').waitFor();
    assert.ok((await page.locator('.cm-content').innerText()).includes('Brouillon worktree'));
    checks.push('native watcher refreshes clean buffer and preserves dirty buffer');
    checks.push('editor gutter aligns with code');
    await page.getByRole('button', { name: /^Skills/ }).click();
    await page.getByRole('button', { name: 'Créer skill', exact: true }).click();
    await page.getByLabel('Identifiant', { exact: true }).fill('fixture-edit');
    await page.getByLabel('Quand utiliser', { exact: true }).fill('Tester édition personnelle.');
    await page.getByLabel('Instructions', { exact: true }).fill('Lire critères.');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Créer skill', exact: true })
      .click();
    await modalClosed();
    await page.getByLabel('Rechercher skills').fill('fixture-edit');
    await page.getByRole('button', { name: 'Instructions', exact: true }).click();
    await page.getByRole('button', { name: 'Modifier skill', exact: true }).click();
    await page.getByLabel('Instructions', { exact: true }).fill('Brouillon valide conservé.');
    const manifest = path.join(dataDir, 'skills', 'fixture-edit', 'SKILL.md');
    fs.appendFileSync(manifest, '\nChangement externe.\n');
    await page.getByRole('button', { name: 'Enregistrer skill', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.ok(
      (await page.getByRole('dialog').getByRole('alert').innerText()).includes('modifié ailleurs')
    );
    assert.equal(
      await page.getByLabel('Instructions', { exact: true }).inputValue(),
      'Brouillon valide conservé.'
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Fermer erreur', exact: true }).click();
    checks.push('stale skill edit shows error inside dialog and preserves input');
    await projectsPage();
    await page.getByRole('button', { name: 'Cloner GitHub', exact: true }).click();
    await page.getByLabel('Dépôt GitHub', { exact: true }).pressSequentially('owner/repository');
    assert.equal(await page.getByLabel('Nom nouveau dossier').inputValue(), 'repository');
    await page.getByLabel('Nom nouveau dossier').fill('Nom choisi');
    await page
      .getByLabel('Dépôt GitHub', { exact: true })
      .fill('https://example.invalid/owner/repository');
    assert.equal(await page.getByLabel('Nom nouveau dossier').inputValue(), 'Nom choisi');
    await page.getByRole('button', { name: 'Choisir', exact: true }).click();
    await page.getByRole('button', { name: 'Cloner dépôt', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.ok((await page.getByRole('dialog').getByRole('alert').innerText()).includes('GitHub'));
    assert.ok(!fs.existsSync(path.join(projects, 'Nom choisi')));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Fermer erreur', exact: true }).click();
    checks.push('clone auto-name, manual override, invalid host rejected before network');
    await page
      .locator('.library-project-card')
      .filter({ has: page.getByRole('heading', { name: 'source', exact: true }) })
      .getByRole('button', { name: 'Choisir projet', exact: true })
      .click();
    await page.getByRole('button', { name: 'Espace de travail', exact: true }).click();
    state = await page.evaluate(() => window.duo.library());
    const preflight = await page.evaluate(
      async ({ other }) => {
        const data = await window.duo.library(),
          discovery = await window.duo.bootstrap();
        const mission = data.sessions.find((s) => s.projectId === data.activeProjectId);
        const model = discovery.models.find((item) => item.default) || discovery.models[0];
        const results = await Promise.allSettled([
          window.duo.run({
            sessionId: mission.id,
            prompt: 'Simulation locale : vérifier isolation brouillons et verrou projet.',
            config: {
              ...data.settings,
              codexModel: model.id,
              codexEffort: model.efforts.at(-1),
              mode: 'build',
            },
          }),
          window.duo.activateProject({ projectId: other }),
        ]);
        return results.map((r) => ({ status: r.status, error: r.reason?.message }));
      },
      { other: worktree.id }
    );
    assert.equal(preflight[0].status, 'fulfilled', JSON.stringify(preflight));
    assert.equal(preflight[1].status, 'rejected');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.task.done').length === 2 &&
        !document.querySelector('.phase-bar'),
      null,
      { timeout: 60000 }
    );
    assert.equal((await page.evaluate(() => window.duo.library())).activeProjectId, source.id);
    assert.ok(fs.existsSync(path.join(relocated, 'utility.js')));
    assert.equal(
      fs.readFileSync(path.join(worktree.path, 'README.md'), 'utf8'),
      '# Modification concurrente\n'
    );
    checks.push('dirty other project does not block construction');
    checks.push('preflight rejects competing project switch');
    await page
      .getByRole('button', { name: /^Nouvelle mission/ })
      .first()
      .click();
    await page.getByRole('heading', { name: 'Une idée.', exact: false }).waitFor();
    await page
      .getByLabel('Demande commune pour Codex et Claude')
      .fill('MOCK_CANCEL : arrêt global simulé.');
    await page.getByRole('button', { name: 'Lancer Duo', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.stream-state').length === 2);
    await page.getByRole('button', { name: /^Fichiers/ }).click();
    await page
      .locator('.global-mission-bar')
      .getByRole('button', { name: 'Arrêter', exact: true })
      .click();
    await page.locator('.global-mission-bar').waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.duo.library())).sessions[0].state, 'stopped');
    checks.push('global stop works from file page');
    await new Promise((resolve, reject) =>
      execFile(
        require('electron'),
        [root],
        { cwd: root, env, windowsHide: true, timeout: 12000 },
        (error) => (error ? reject(error) : resolve())
      )
    );
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1
    );
    checks.push('second instance focuses existing window');
    await page.screenshot({ path: path.join(root, 'qa', 'duo-v2-advanced.png') });
    await app.close();
    app = null;
    await open();
    state = await page.evaluate(() => window.duo.library());
    assert.equal(state.projects.length, 2);
    assert.equal(state.workspaces.length, 2);
    assert.ok(state.sessions.some((s) => s.project === relocated));
    assert.ok(state.skills.some((s) => s.id === 'custom-fixture-edit'));
    assert.deepEqual(errors, []);
    checks.push('restart preserves moved projects, sessions and skill');
    console.log(JSON.stringify({ passed: true, simulation: true, checks, dataDir }));
  } catch (error) {
    const detail = {
      error: error.message,
      rendererErrors: errors,
      checks,
      body:
        page && !page.isClosed()
          ? await page
              .locator('body')
              .innerText()
              .catch(() => '')
          : '',
    };
    fs.writeFileSync(path.join(dataDir, 'failure.json'), JSON.stringify(detail, null, 2));
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(dataDir, 'failure.png') }).catch(() => {});
    console.error(JSON.stringify(detail));
    throw error;
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
