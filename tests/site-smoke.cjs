// Local browser checks. No GitHub requests, provider auth or remote inference.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const { createServer } = require('../scripts/site-preview.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'qa');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const checks = [],
    audits = [],
    errors = [],
    requests = [];
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    assert.equal((await page.goto(base)).status(), 200);
    await page.evaluate(() => document.fonts.ready);
    const manifest = await (await fetch(base + '/release.json')).json();
    assert.equal(manifest.version, require('../package.json').version);
    const installer = page.getByRole('link', { name: 'Télécharger pour Windows', exact: false });
    assert.equal(await installer.getAttribute('href'), manifest.assets.installer.url);
    assert.equal(
      await page.locator('[data-download="portable"]').getAttribute('href'),
      manifest.assets.portable.url
    );
    const localLinks = await page
      .locator('[href], [src]')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute('href') || node.getAttribute('src'))
          .filter((value) => value && !value.startsWith('https:'))
      );
    for (const value of new Set(localLinks)) {
      if (value.startsWith('#')) {
        if (value.length > 1) assert.equal(await page.locator(value).count(), 1, value);
      } else assert.equal((await fetch(new URL(value, base))).status, 200, value);
    }
    checks.push('HTTP 200, local assets, section anchors and release download URLs');
    assert.equal((await fetch(base + '/missing-page')).status, 404);
    await page.getByRole('button', { name: 'Copier codex login', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'codex login');
    await page.getByRole('button', { name: 'Copier claude auth login', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'claude auth login');
    checks.push('both CLI login commands copy exactly');
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    async function audit(name) {
      const result = await page.evaluate(() =>
        window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        })
      );
      audits.push({
        name,
        violations: result.violations.map((item) => ({
          id: item.id,
          nodes: item.nodes.map((node) => node.target),
        })),
        incomplete: result.incomplete.map((item) => item.id),
      });
      assert.deepEqual(audits.at(-1).violations, [], name);
    }
    for (const name of ['01 Discussion', '02 Répartition', '03 Relecture', '04 Mémoire']) {
      const tab = page.getByRole('tab', { name });
      await tab.click();
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
      await audit(name);
    }
    await page.getByRole('tab', { name: '01 Discussion' }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await page.getByRole('tab', { name: '02 Répartition' }).getAttribute('aria-selected'),
      'true'
    );
    await page.keyboard.press('End');
    assert.equal(
      await page.getByRole('tab', { name: '04 Mémoire' }).getAttribute('aria-selected'),
      'true'
    );
    await page.keyboard.press('Home');
    assert.equal(
      await page.getByRole('tab', { name: '01 Discussion' }).getAttribute('aria-selected'),
      'true'
    );
    checks.push('all four collaboration examples and keyboard tab navigation');
    await page
      .getByText('Duo peut garantir de ne jamais atteindre mes quotas ?', { exact: true })
      .click();
    assert.equal(await page.locator('details[open]').count(), 1);
    assert.match(await page.locator('details[open] p').innerText(), /Non\./);
    await page.locator('details[open] summary').click();
    await page.screenshot({ path: path.join(output, 'site-desktop.png'), fullPage: true });
    await page.locator('#mission-demo').screenshot({ path: path.join(output, 'site-mission.png') });
    checks.push('FAQ reveals quota limitations');
    for (const width of [390, 320, 768, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `horizontal overflow at ${width}px`
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    const menu = page.getByRole('button', { name: 'Menu', exact: false });
    await menu.click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await menu.click();
    await page
      .locator('#navigation')
      .getByRole('link', { name: 'Installation', exact: true })
      .click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
      'auto'
    );
    await audit('mobile 390px');
    await page.screenshot({ path: path.join(output, 'site-mobile.png'), fullPage: true });
    checks.push('320–1440px layouts, mobile menu, Escape and reduced motion');
    assert.deepEqual(errors, []);
    assert.ok(
      requests.every((url) => url.startsWith(base)),
      'unexpected external request'
    );
    checks.push('no renderer errors or third-party requests');
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const fallback = await noJS.newPage();
    await fallback.goto(base);
    assert.equal(
      await fallback
        .getByRole('link', { name: 'Télécharger pour Windows', exact: false })
        .getAttribute('href'),
      manifest.assets.installer.url
    );
    await noJS.close();
    checks.push('installer link works without JavaScript');
    fs.writeFileSync(
      path.join(output, 'site-report.json'),
      JSON.stringify({ passed: true, checks, audits, errors }, null, 2)
    );
    console.log(
      JSON.stringify({
        passed: true,
        checks,
        accessibilityViolations: audits.reduce(
          (count, audit) => count + audit.violations.length,
          0
        ),
      })
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
