// Overlay the latest published release onto a staging copy, leaving source intact.
const fs = require('node:fs');
const path = require('node:path');
const { API, releaseInfo } = require('../electron/updates.cjs');
const root = path.resolve(__dirname, '..');
async function prepare() {
  const response = await fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Duo-site-deploy' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (response.status === 404 && process.argv.includes('--allow-empty')) {
    console.log('::notice::No public release yet. Site deployment starts after the first release.');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'ready=false\n');
    return;
  }
  if (!response.ok)
    throw new Error('A published Windows release is required before site deployment.');
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('Release metadata exceeds limit.');
  const release = JSON.parse(text);
  const info = releaseInfo(release, '0.0.0');
  const asset = release.assets.find((a) => a.name === 'release.json');
  if (
    !asset ||
    asset.size > 16384 ||
    asset.browser_download_url !==
      `https://github.com/kofudev/duo/releases/download/v${info.version}/release.json`
  )
    throw new Error('Published site manifest missing.');
  const downloaded = await fetch(asset.browser_download_url, {
    signal: AbortSignal.timeout(15000),
  });
  if (!downloaded.ok) throw new Error('Cannot download published site manifest.');
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  if (bytes.length > 16384 || bytes.length !== asset.size)
    throw new Error('Manifest size mismatch.');
  const digest =
    'sha256:' + require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  if (asset.digest && asset.digest !== digest) throw new Error('Manifest checksum mismatch.');
  const manifest = JSON.parse(bytes);
  if (manifest.version !== info.version || manifest.assets?.installer?.url !== info.url)
    throw new Error('Published manifest version differs.');
  for (const value of Object.values(manifest.assets)) {
    const published = release.assets.find((a) => a.browser_download_url === value.url);
    if (
      !published ||
      (value.bytes && published.size !== value.bytes) ||
      (value.sha256 && published.digest && published.digest !== `sha256:${value.sha256}`)
    )
      throw new Error('Manifest references an unverified asset.');
  }
  const output = path.join(root, 'website-package');
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(path.join(root, 'website'), output, { recursive: true });
  fs.writeFileSync(path.join(output, 'release.json'), bytes);
  const index = path.join(output, 'index.html');
  fs.writeFileSync(
    index,
    fs
      .readFileSync(index, 'utf8')
      .replace(/(<span data-version>)\d+\.\d+\.\d+(<\/span>)/g, `$1${info.version}$2`)
  );
  console.log(`Site prepared for Duo ${info.version}.`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'ready=true\n');
}
prepare().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
