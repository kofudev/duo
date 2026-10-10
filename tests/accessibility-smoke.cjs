// Native Electron accessibility audit. Catalog initialization only; no inference.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
(async () => {
  const root = path.resolve(__dirname, '..'),
    data = path.join(root, '.cache', `accessibility-${randomUUID()}`);
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
  const app = await _electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, DUO_TEST_USER_DATA: data },
  });
  const reports = [],
    errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(
      () => document.querySelector('.connection-pill')?.textContent.includes('/2'),
      null,
      { timeout: 60000 }
    );
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    async function audit(name) {
      const result = await page.evaluate(() =>
        window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        })
      );
      const report = {
        name,
        violations: result.violations.map((item) => ({
          id: item.id,
          impact: item.impact,
          description: item.description,
          nodes: item.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
            html: node.html,
          })),
        })),
        passes: result.passes.length,
        incomplete: result.incomplete.map((item) => ({ id: item.id, nodes: item.nodes.length })),
      };
      reports.push(report);
      console.log(
        JSON.stringify({
          page: name,
          passes: report.passes,
          violations: report.violations.map((item) => ({ id: item.id, nodes: item.nodes.length })),
        })
      );
    }
    await audit('welcome');
    for (const [label, name] of [
      ['Projets', 'projects'],
      ['Skills', 'skills'],
      ['Modèles', 'models'],
    ]) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await audit(name);
    }
    await page.getByRole('button', { name: 'Connexions', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await audit('connections');
    assert.equal(
      await page.evaluate(() => document.activeElement?.closest('dialog') != null),
      true
    );
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => document.activeElement?.closest('dialog') != null),
        true
      );
    }
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(
      await page
        .getByRole('button', { name: 'Connexions', exact: true })
        .evaluate((node) => node === document.activeElement),
      true
    );
    await page.getByRole('button', { name: 'Espace de travail', exact: true }).click();
    const project = path.join(data, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'README.md'), '# Accessibilité\n');
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, project);
    await page.getByRole('button', { name: 'Choisir dossier projet', exact: true }).click();
    await page.getByRole('button', { name: /^Fichiers/ }).click();
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    await page.locator('.cm-content').waitFor();
    await audit('editor');
    await page.keyboard.press('Control+p');
    await page.getByRole('dialog', { name: 'Ouvrir fichier', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Rechercher fichier projet' }).fill('readme');
    await page.getByRole('option', { name: /README/ }).waitFor();
    await audit('quick-file');
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
    await audit('compact-editor');
    fs.writeFileSync(
      path.join(root, 'qa', 'accessibility-report.json'),
      JSON.stringify(
        { axe: require('axe-core/package.json').version, reports, keyboardDialog: true, errors },
        null,
        2
      )
    );
    assert.deepEqual(errors, []);
    assert.equal(
      reports.reduce((sum, report) => sum + report.violations.length, 0),
      0,
      'See qa/accessibility-report.json'
    );
    console.log(JSON.stringify({ passed: true, pages: reports.length, keyboardDialog: true }));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
