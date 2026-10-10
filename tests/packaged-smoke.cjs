const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const data = path.join(root, '.cache', `packaged-${randomUUID()}`);
  fs.mkdirSync(data, { recursive: true });
  const executablePath =
    process.env.DUO_PACKAGED_EXE || path.join(root, 'release', 'win-unpacked', 'Duo.exe');
  fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
  const electron = await _electron.launch({
    executablePath,
    args: [],
    env: { ...process.env, DUO_TEST_USER_DATA: data },
  });
  try {
    const page = await electron.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(
      () => document.querySelector('.connection-pill')?.textContent.includes('/2'),
      { timeout: 60000 }
    );
    const state = await page.evaluate(() => window.duo.bootstrap());
    const runtime = await electron.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      resources: process.resourcesPath,
    }));
    const skillRoot = path.join(runtime.resources, 'skills', 'ui-ux-pro-max');
    const packaged = {
      packaged: runtime.packaged,
      skill: fs.existsSync(path.join(skillRoot, 'SKILL.md')),
      data: fs.existsSync(path.join(skillRoot, 'data')),
      script: fs.existsSync(path.join(skillRoot, 'scripts', 'search.py')),
      license: fs.existsSync(path.join(skillRoot, 'LICENSE')),
    };
    assert.ok(Object.values(packaged).every(Boolean));
    assert.equal(state.skills.length, 19);
    assert.deepEqual(errors, []);
    for (const name of ['README.md', 'THIRD_PARTY.md', 'LICENSE', 'licenses/index.json'])
      assert.ok(fs.statSync(path.join(runtime.resources, name)).size > 0, name);
    const notices = JSON.parse(
      fs.readFileSync(path.join(runtime.resources, 'licenses', 'index.json'), 'utf8')
    );
    assert.ok(notices.length > 100);
    for (const record of notices)
      for (const name of record.notices)
        assert.ok(fs.statSync(path.join(runtime.resources, 'licenses', name)).size > 0, name);
    assert.ok(
      notices.some(
        (record) =>
          record.name === '@anthropic-ai/claude-agent-sdk' &&
          record.notices.some((name) => name.endsWith('LICENSE.md'))
      )
    );
    assert.equal(await electron.evaluate(({ Menu }) => Menu.getApplicationMenu()), null);
    assert.equal(state.skills.filter((skill) => skill.invalid).length, 0);
    assert.equal(
      await electron.evaluate(({ app }) => app.getVersion()),
      require('../package.json').version
    );
    await page.getByRole('button', { name: 'Modèles', exact: true }).click();
    await page.getByRole('button', { name: /^Claude Code/ }).click();
    assert.equal(
      await page.locator('.model-update code').innerText(),
      state.connections.claude.updateCommand || 'claude update'
    );
    await page
      .locator('.model-update')
      .getByRole('button', { name: 'Copier', exact: true })
      .click();
    assert.equal(
      await electron.evaluate(({ clipboard }) => clipboard.readText()),
      state.connections.claude.updateCommand || 'claude update'
    );
    await page.getByRole('button', { name: 'Espace de travail', exact: true }).click();
    if (state.connections.claude?.installed) {
      assert.ok(!state.connections.claude.catalogError, state.connections.claude.catalogError);
      assert.ok(state.catalogs.claude.some((model) => model.discovery === 'live'));
    }
    const project = path.join(data, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'README.md'), '# Paquet Windows\n');
    await electron.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, project);
    await page.getByRole('button', { name: 'Choisir dossier projet', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.titlebar-project')?.textContent === 'project'
    );
    await page.getByRole('button', { name: /^Fichiers/ }).click();
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    await page.locator('.cm-content').fill('# Éditeur empaqueté vérifié\n');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.editor-status')?.textContent.includes('Enregistré')
    );
    assert.equal(
      fs.readFileSync(path.join(project, 'README.md'), 'utf8'),
      '# Éditeur empaqueté vérifié\n'
    );
    await page.getByRole('button', { name: 'Espace de travail', exact: true }).click();
    await electron.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setBackgroundThrottling(false);
      window.show();
    });
    await page.screenshot({ path: path.join(root, 'qa', 'duo-packaged.png'), timeout: 15000 });
    console.log(
      JSON.stringify({
        passed: true,
        ...packaged,
        models: state.models.length,
        claudeLiveModels: state.catalogs.claude.filter((model) => model.discovery === 'live')
          .length,
        dependencyNotices: notices.length,
        editorSave: true,
        executablePath,
      })
    );
  } finally {
    await electron.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
