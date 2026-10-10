const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.cache', `workspaces-ui-${randomUUID()}`);
const parent = path.join(dataDir, 'projects');
fs.mkdirSync(parent, { recursive: true });
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
let app, page;
const errors = [];
async function open() {
  app = await _electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, DUO_TEST_USER_DATA: dataDir },
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(
    () => document.querySelector('.connection-pill')?.textContent.includes('/2'),
    { timeout: 60000 }
  );
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [process.env.DUO_TEST_USER_DATA + '\\projects'],
    });
  });
}
(async () => {
  try {
    await open();
    const initial = await page.evaluate(() => window.duo.bootstrap());
    assert.equal(initial.schemaVersion, 4);
    assert.equal(initial.skills.length, 19);
    assert.equal(initial.skills.filter((s) => s.invalid).length, 0);
    assert.ok(initial.catalogs.claude.some((m) => m.id === 'claude-opus-5-5'));
    await page.screenshot({ path: path.join(root, 'qa', 'duo-v2-welcome.png') });
    await page.getByRole('button', { name: /^Projets/ }).click();
    await page.getByRole('heading', { name: 'Projets & workspaces', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.getByLabel('Nom workspace', { exact: true }).fill('Studio Duo');
    await page.getByRole('button', { name: 'Créer workspace', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(
      await page.getByLabel('Workspace actif').inputValue(),
      (await page.evaluate(() => window.duo.library())).activeWorkspaceId
    );
    await page.getByRole('button', { name: 'Créer projet', exact: true }).click();
    await page.getByLabel('Nom projet', { exact: true }).fill('Équipe Windows');
    await page.getByRole('button', { name: 'Choisir', exact: true }).click();
    await page.getByLabel('Modèle de départ').selectOption('node');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Créer projet', exact: true })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const projectPath = path.join(parent, 'Équipe Windows');
    assert.ok(fs.existsSync(path.join(projectPath, 'src', 'index.js')));
    assert.ok(fs.existsSync(path.join(projectPath, '.git')));
    await page.getByRole('button', { name: 'Modifier Équipe Windows', exact: true }).click();
    await page
      .getByLabel('Brief projet', { exact: true })
      .fill('Application Windows. Français. Tests utiles.');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(root, 'qa', 'duo-v2-projects.png') });
    await page.getByRole('button', { name: /^Skills/ }).click();
    await page.getByLabel('Intensité Caveman').selectOption('ultra');
    await page.getByRole('button', { name: 'Activer Debugging', exact: true }).click();
    await page.getByRole('button', { name: 'Créer skill', exact: true }).click();
    await page.getByLabel('Identifiant', { exact: true }).fill('ma-relecture');
    await page
      .getByLabel('Quand utiliser', { exact: true })
      .fill('Utiliser pour vérifier critères projet.');
    await page
      .getByLabel('Instructions', { exact: true })
      .fill('Lire fichiers. Vérifier critères. Signaler défauts concrets.');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Créer skill', exact: true })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const custom = page.getByRole('button', { name: 'Activer ma-relecture', exact: true });
    await custom.waitFor();
    assert.equal(await custom.getAttribute('aria-pressed'), 'false');
    await custom.click();
    await page.getByLabel('Rechercher skills').fill('ma-relecture');
    await page.getByRole('button', { name: 'Instructions', exact: true }).click();
    assert.ok((await page.locator('.skill-source').textContent()).includes('Lire fichiers'));
    await page.keyboard.press('Escape');
    await page.getByLabel('Rechercher skills').fill('');
    await page.screenshot({ path: path.join(root, 'qa', 'duo-v2-skills.png') });
    await page.getByRole('button', { name: 'Modèles', exact: true }).click();
    await page.getByRole('button', { name: /Claude Code/ }).click();
    await page.getByLabel('Rechercher modèles').fill('5.5');
    for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
      assert.equal(
        await page
          .locator('.model-list article code')
          .filter({ hasText: new RegExp(`^${id}$`) })
          .count(),
        1
      );
    await page.screenshot({ path: path.join(root, 'qa', 'duo-v2-models.png') });
    await page.getByLabel('Rechercher modèles').fill('haiku');
    const haiku = page
      .locator('.model-list article')
      .filter({ has: page.locator('code', { hasText: /^haiku$/ }) });
    await haiku.getByRole('button', { name: 'Choisir', exact: true }).click();
    const haikuModel = (await page.evaluate(() => window.duo.bootstrap())).catalogs.claude.find(
      (model) => model.id === 'haiku'
    );
    const effortOrder = ['low', 'medium', 'high', 'xhigh', 'max'];
    const expectedEffort =
      [...haikuModel.efforts].sort((a, b) => effortOrder.indexOf(b) - effortOrder.indexOf(a))[0] ||
      '';
    const deadline = Date.now() + 10000;
    let settings;
    do {
      settings = (await page.evaluate(() => window.duo.library())).settings;
      if (settings.claudeModel === 'haiku') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.equal(settings.claudeModel, 'haiku');
    assert.equal(settings.claudeEffort, expectedEffort);
    await page.waitForFunction(
      (effort) =>
        document.querySelector('[aria-label="Effort catalogue claude"]')?.value === effort,
      expectedEffort
    );
    await page.getByRole('button', { name: /^Projets/ }).click();
    await page.getByRole('button', { name: 'Créer projet', exact: true }).click();
    await page.getByLabel('Nom projet', { exact: true }).fill('Autre projet');
    await page.getByRole('button', { name: 'Choisir', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Créer projet', exact: true })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    let state = await page.evaluate(() => window.duo.library());
    assert.equal(state.settings.cavemanLevel, 'full');
    assert.equal(state.settings.claudeModel, 'opus');
    assert.ok(!state.settings.skills.includes('custom-ma-relecture'));
    await page
      .locator('.library-project-card')
      .filter({ has: page.getByRole('heading', { name: 'Équipe Windows', exact: true }) })
      .getByRole('button', { name: 'Choisir projet' })
      .click();
    state = await page.evaluate(() => window.duo.library());
    assert.equal(state.settings.cavemanLevel, 'ultra');
    assert.equal(state.settings.claudeModel, 'haiku');
    assert.ok(state.settings.skills.includes('custom-ma-relecture'));
    assert.equal(
      state.projects.find((p) => p.id === state.activeProjectId).description,
      'Application Windows. Français. Tests utiles.'
    );
    await page.getByRole('button', { name: 'Archiver Équipe Windows', exact: true }).click();
    assert.ok(fs.existsSync(projectPath));
    await page.getByRole('button', { name: 'Voir archives', exact: true }).click();
    await page.getByRole('button', { name: 'Restaurer', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
    for (const name of [/^Projets/, /^Skills/, /^Modèles$/]) {
      await page.getByRole('button', { name }).first().click();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false
      );
    }
    await page.screenshot({ path: path.join(root, 'qa', 'duo-v2-compact.png') });
    await app.close();
    app = null;
    await open();
    const restored = await page.evaluate(() => window.duo.library());
    assert.equal(restored.projects.length, 2);
    assert.equal(restored.workspaces.length, 2);
    assert.ok(restored.skills.some((s) => s.id === 'custom-ma-relecture'));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          'schema v4',
          '19 skills',
          'Claude models + versions',
          'workspace creation',
          'Node project + Git',
          'project brief',
          'Caveman intensity',
          'custom skill create + preview',
          'compatible effort',
          'project setting isolation',
          'archive preserves files',
          'restore',
          'compact pages',
          'restart persistence',
          'no renderer errors',
        ],
        dataDir,
      })
    );
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
