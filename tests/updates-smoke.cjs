const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
(async () => {
  const root = path.resolve(__dirname, '..');
  const data = path.join(root, '.cache', `updates-${randomUUID()}`);
  fs.mkdirSync(data, { recursive: true });
  const electron = await _electron.launch({
    ...(process.env.DUO_PACKAGED_EXE
      ? { executablePath: process.env.DUO_PACKAGED_EXE, args: [] }
      : { args: [root] }),
    env: { ...process.env, DUO_TEST_USER_DATA: data },
  });
  try {
    const page = await electron.firstWindow();
    await page.getByRole('button', { name: 'Mises à jour', exact: true }).click();
    await electron.evaluate(({ shell }) => {
      globalThis.updateDownloads = [];
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v9.0.0',
            draft: false,
            prerelease: false,
            assets: [
              {
                name: 'Duo-Setup-9.0.0.exe',
                size: 120000000,
                browser_download_url:
                  'https://github.com/kofudev/duo/releases/download/v9.0.0/Duo-Setup-9.0.0.exe',
              },
            ],
          })
        );
      shell.openExternal = async (url) => {
        globalThis.updateDownloads.push(url);
      };
    });
    await page.getByRole('button', { name: 'Vérifier les mises à jour', exact: true }).click();
    await page.getByRole('button', { name: 'Télécharger Duo 9.0.0', exact: true }).click();
    assert.deepEqual(await electron.evaluate(() => globalThis.updateDownloads), [
      'https://github.com/kofudev/duo/releases/download/v9.0.0/Duo-Setup-9.0.0.exe',
    ]);
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        })
      ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))
    );
    assert.deepEqual(violations, []);
    await electron.evaluate(() => {
      globalThis.fetch = async () => {
        throw new Error('Hors connexion');
      };
    });
    await page.getByRole('button', { name: 'Vérifier les mises à jour', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Hors connexion' }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Télécharger Duo 9.0.0', exact: true }).count(),
      0
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          'update dialog',
          'direct installer only',
          'offline error clears stale download',
          'zero reported axe violations',
          'keyboard dialog close',
        ],
      })
    );
  } finally {
    await electron.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
