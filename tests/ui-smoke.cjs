const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, '.cache', `ui-${randomUUID()}`);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
  const electron = await _electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, DUO_TEST_USER_DATA: dataDir },
  });
  const page = await electron.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.getByText('Une idée.', { exact: false }).waitFor({ timeout: 60000 });
    await page.waitForFunction(() =>
      document.querySelector('.connection-pill')?.textContent.includes('/2')
    );
    const data = await page.evaluate(() => window.duo.bootstrap());
    assert.equal(data.skills.length, 19);
    assert.ok(data.models.every((m) => m.id && m.efforts.length));
    assert.equal(data.skills.filter((s) => s.invalid).length, 0);
    assert.ok(!JSON.stringify(data.connections).includes('access_token'));
    await page.keyboard.press('Control+p');
    await page.getByRole('heading', { name: 'Projets & workspaces', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: 'Espace de travail', exact: true }).click();
    await page.screenshot({ path: path.join(root, 'qa', 'duo-welcome.png') });
    await page.getByRole('button', { name: /^Skills/ }).click();
    await page.getByRole('heading', { name: 'Skills', exact: true }).waitFor();
    const toggle = page.getByRole('button', { name: 'Activer Caveman', exact: true });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await toggle.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Activer Caveman"]')?.getAttribute('aria-pressed') ===
        'false'
    );
    await toggle.click();
    await page.screenshot({ path: path.join(root, 'qa', 'duo-skills.png') });
    await page.getByRole('button', { name: 'Connexions', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('.connection-row').count(), 3);
    await page.getByRole('button', { name: 'Copier commande claude' }).click();
    const clipboard = await electron.evaluate(({ clipboard }) => clipboard.readText());
    assert.equal(clipboard, 'claude auth login');
    await page.screenshot({ path: path.join(root, 'qa', 'duo-connections.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Espace de travail', exact: true }).click();
    await page.getByRole('button', { name: 'Réglages mission' }).click();
    const effort = await page.getByLabel('Effort Claude', { exact: true }).inputValue();
    assert.ok(
      !effort ||
        data.catalogs.claude
          .find((m) => m.id === data.settings.claudeModel)
          ?.efforts.includes(effort)
    );
    await page.getByLabel('Tours discussion').selectOption('2');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: /^Nouvelle mission/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Créer un projet/ }).click();
    assert.ok((await page.locator('#prompt').inputValue()).includes('application de gestion'));
    await page.getByRole('button', { name: 'Lancer Duo' }).click();
    await page.getByRole('alert').waitFor();
    assert.ok((await page.getByRole('alert').innerText()).includes('Choisir dossier projet'));
    await page.getByRole('button', { name: 'Fermer erreur' }).click();
    await electron.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 720)
    );
    await page.screenshot({ path: path.join(root, 'qa', 'duo-compact.png') });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    assert.equal(overflow, false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('.duo-mark')).animationName
      ),
      'none'
    );
    assert.equal((await page.evaluate(() => window.duo.library())).settings.rounds, 2);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          'native bootstrap',
          'model catalog',
          'Ctrl P without project',
          'skill toggles',
          'connection dialog',
          'clipboard',
          'settings persistence',
          'new session',
          'prompt suggestions',
          'project requirement',
          'compact layout',
          'reduced motion',
          'no renderer exceptions',
        ],
        models: data.models.length,
        screenshots: 'qa/',
      })
    );
  } finally {
    await electron.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
