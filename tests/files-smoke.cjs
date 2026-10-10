const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
(async () => {
  const root = path.resolve(__dirname, '..'),
    dataDir = path.join(root, '.cache', `files-ui-${randomUUID()}`),
    project = path.join(dataDir, 'project');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
  fs.writeFileSync(path.join(project, 'README.md'), '# Original\n');
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'console.log("Duo");\n');
  const app = await _electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, DUO_TEST_USER_DATA: dataDir },
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(
      () => document.querySelector('.connection-pill')?.textContent.includes('/2'),
      { timeout: 60000 }
    );
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [process.env.DUO_TEST_USER_DATA + '\\project'],
      });
      dialog.showMessageBoxSync = () => 1;
    });
    await page.evaluate(() => window.duo.pickProject());
    const state = await page.evaluate(() => window.duo.library());
    // Reload fetches imported project through normal bootstrap.
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('/2')
    );
    await page.getByRole('button', { name: /^Fichiers/ }).click();
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    const editor = page.locator('.cm-content');
    await editor.waitFor();
    await page.getByRole('button', { name: /^Skills/ }).click();
    await page.keyboard.press('Control+p');
    await page.getByRole('dialog', { name: 'Ouvrir fichier', exact: true }).waitFor();
    await page
      .getByRole('combobox', { name: 'Rechercher fichier projet', exact: true })
      .fill('mainjs');
    await page.getByRole('option', { name: /main.js/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () => document.querySelector('.editor-toolbar>code')?.textContent === 'src/main.js'
    );
    await page.getByRole('tab', { name: 'README.md', exact: true }).click();
    await editor.fill('# Modifié avec Duo\n');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.editor-status')?.textContent.includes('Enregistré')
    );
    assert.equal(fs.readFileSync(path.join(project, 'README.md'), 'utf8'), '# Modifié avec Duo\n');
    await editor.fill('# Brouillon conservé\n');
    await page.getByRole('button', { name: /^Skills/ }).click();
    await page.getByRole('button', { name: /^Fichiers/ }).click();
    assert.ok((await page.locator('.cm-content').innerText()).includes('Brouillon conservé'));
    fs.writeFileSync(path.join(project, 'README.md'), '# Changement externe\n');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.ok((await page.getByRole('alert').innerText()).includes('modifié ailleurs'));
    assert.equal(
      fs.readFileSync(path.join(project, 'README.md'), 'utf8'),
      '# Changement externe\n'
    );
    await page.getByRole('button', { name: 'Recharger fichier', exact: true }).click();
    await page.getByRole('dialog', { name: 'Recharger fichier modifié ?' }).waitFor();
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    assert.ok((await page.locator('.cm-content').innerText()).includes('Brouillon conservé'));
    await page.getByRole('button', { name: 'Recharger fichier', exact: true }).click();
    await page.getByRole('button', { name: 'Abandonner brouillon', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.ok((await page.locator('.cm-content').innerText()).includes('Changement externe'));
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'src', exact: true }).click();
    await page.getByRole('button', { name: 'main.js', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 2);
    assert.equal(await page.getByRole('tab').count(), 2);
    await page.getByRole('tab', { name: 'README.md', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await page.getByRole('tab', { name: 'main.js', exact: true }).getAttribute('aria-selected'),
      'true'
    );
    await page.keyboard.press('Home');
    assert.equal(
      await page.getByRole('tab', { name: 'README.md', exact: true }).getAttribute('aria-selected'),
      'true'
    );
    await page.keyboard.press('End');
    await page.keyboard.press('Delete');
    assert.equal(await page.getByRole('tab').count(), 1);
    await page.getByRole('button', { name: 'main.js', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 2);
    await page.screenshot({ path: path.join(root, 'qa', 'duo-v2-editor.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          'native explorer',
          'Ctrl P nested search and keyboard open',
          'lazy syntax editor',
          'real file save',
          'draft survives navigation',
          'external edit conflict',
          'reload confirmation',
          'tabs + arrow/Home/End/Delete navigation',
          'compact editor',
          'no renderer errors',
        ],
        projectId: state.activeProjectId,
      })
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
