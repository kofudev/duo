const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseInfo, isNewer, checkUpdate, API } = require('../electron/updates.cjs');
function release(version = '0.4.2') {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `Duo-Setup-${version}.exe`,
        size: 120000000,
        browser_download_url: `https://github.com/kofudev/duo/releases/download/v${version}/Duo-Setup-${version}.exe`,
      },
    ],
  };
}
test('update comparison handles numeric versions and refuses downgrades', () => {
  assert.equal(isNewer('0.4.10', '0.4.9'), true);
  assert.equal(isNewer('0.4.1', '0.4.1'), false);
  assert.equal(isNewer('0.4.1', '0.5.0'), false);
  assert.throws(() => isNewer('0.4.2-beta', '0.4.1'));
});
test('only official stable versioned installers may be opened', () => {
  assert.equal(releaseInfo(release(), '0.4.1').available, true);
  for (const mutation of [
    (r) => (r.draft = true),
    (r) => (r.prerelease = true),
    (r) => (r.assets = []),
    (r) => (r.assets[0].size = 0),
    (r) => (r.assets[0].browser_download_url = 'https://example.com/setup.exe'),
    (r) => (r.tag_name = 'v0.4.2/../../x'),
  ]) {
    const value = release();
    mutation(value);
    assert.throws(() => releaseInfo(value, '0.4.1'));
  }
});
test('update check has a bounded public request and explicit offline failure', async () => {
  const result = await checkUpdate('0.4.1', async (url, options) => {
    assert.equal(url, API);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify(release()));
  });
  assert.equal(result.version, '0.4.2');
  await assert.rejects(
    checkUpdate('0.4.1', async () => new Response('', { status: 404 })),
    /Aucune version publique/
  );
  await assert.rejects(
    checkUpdate('0.4.1', async () => new Response('x'.repeat(1048577))),
    /volumineuse/
  );
});
