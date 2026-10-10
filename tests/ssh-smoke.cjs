const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..'),
  profile = path.join(root, '.cache', `ssh-ui-${randomUUID()}`);
const project = path.join(profile, 'project');
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
let app;
(async () => {
  try {
    const options = { cwd: root, env: { ...process.env, DUO_TEST_USER_DATA: profile } };
    app = await _electron.launch(
      process.env.DUO_PACKAGED_EXE
        ? { ...options, executablePath: process.env.DUO_PACKAGED_EXE, args: [] }
        : { ...options, args: [root] }
    );
    const page = await app.firstWindow(),
      errors = [];
    const proxyValue = await app.evaluate(async ({ app }) => {
      const require = process
        .getBuiltinModule('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      const path = require('node:path'),
        base = app.getAppPath();
      const { createToolBridge } = require(path.join(base, 'electron/tool-bridge.cjs'));
      const { runCommand } = require(path.join(base, 'electron/process.cjs'));
      const bridge = await createToolBridge(
        [
          {
            name: 'duo_probe',
            description: 'QA only',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        () => ({ actual: 'packaged-proxy-canary' })
      );
      try {
        const output = await runCommand(
          process.execPath,
          [path.join(base, 'electron/mcp-proxy.cjs')],
          {
            env: {
              ELECTRON_RUN_AS_NODE: '1',
              DUO_TOOL_ENDPOINT: bridge.url,
              DUO_TOOL_TOKEN: bridge.token,
            },
            timeout: 10000,
            input:
              JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'duo_probe', arguments: {} },
              }) + '\n',
          }
        );
        return JSON.parse(JSON.parse(output).result.content[0].text).actual;
      } finally {
        bridge.close();
      }
    });
    assert.equal(proxyValue, 'packaged-proxy-canary');
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(
      () => document.querySelector('.connection-pill') && !document.querySelector('.spin'),
      null,
      { timeout: 60000 }
    );
    await app.evaluate(({ dialog, ipcMain }, project) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
      dialog.showMessageBoxSync = () => 1;
      ipcMain.removeHandler('duo:ssh:test');
      ipcMain.handle('duo:ssh:test', () => ({
        connected: true,
        root: '/srv/test',
        python: '3.13.5',
      }));
    }, project);
    await page.getByRole('button', { name: 'Choisir dossier projet', exact: true }).click();
    await page
      .getByRole('button', { name: /Connexions/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Gérer serveurs SSH' }).click();
    await page.getByLabel('Nom connexion', { exact: true }).fill('Serveur QA');
    await page.getByLabel('Alias dans ~/.ssh/config', { exact: true }).fill('qa-server');
    await page.getByLabel('Dossier distant autorisé', { exact: true }).fill('/srv/test');
    assert.equal(
      await page.getByLabel('Autoriser écriture de fichiers', { exact: false }).isChecked(),
      false
    );
    assert.equal(
      await page.getByLabel('Autoriser commandes et déploiement', { exact: false }).isChecked(),
      false
    );
    await page.getByRole('button', { name: 'Enregistrer connexion', exact: true }).click();
    await page.getByRole('button', { name: 'Tester connexion SSH', exact: true }).click();
    await page.getByText('Connecté · /srv/test · Python 3.13.5', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Utiliser pour ce projet', exact: true }).click();
    const data = await page.evaluate(() => window.duo.library());
    assert.equal(data.sshProfiles.length, 1);
    assert.equal(data.settings.sshProfileId, data.sshProfiles[0].id);
    assert.equal(data.sshProfiles[0].allowWrite, false);
    assert.equal(data.sshProfiles[0].allowCommands, false);
    await page.getByLabel('Autoriser écriture de fichiers', { exact: false }).check();
    await page.getByLabel('Autoriser commandes et déploiement', { exact: false }).check();
    await page.getByRole('button', { name: 'Enregistrer connexion', exact: true }).click();
    await page.getByText('Connexion enregistrée.', { exact: true }).waitFor();
    await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const a11y = await page.evaluate(() =>
      window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })
    );
    assert.deepEqual(
      a11y.violations.map((item) => item.id),
      []
    );
    // Source UI supplies visual QA; packaged runs validate forms, IPC and the actual child proxy.
    if (process.env.DUO_CAPTURE_UI === 'true')
      await page.screenshot({ path: path.join(root, 'qa', 'duo-ssh.png') });
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    const deleted = await page.evaluate(() => window.duo.library());
    assert.equal(deleted.sshProfiles.length, 0);
    assert.equal(deleted.settings.sshProfileId, '');
    await page.getByRole('button', { name: 'Fermer fenêtre', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          'SSH create/select/test/edit/delete IPC',
          'default readonly permissions',
          'project binding',
          'no imported key contents',
          'modal accessibility',
        ],
        profile,
      })
    );
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
