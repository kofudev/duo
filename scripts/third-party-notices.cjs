const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'build', 'notices');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const records = [];
fs.mkdirSync(destination, { recursive: true });
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.dev || /@anthropic-ai\/claude-agent-sdk-[^/]+(?:\/|$)/.test(location))
    continue;
  const directory = path.resolve(root, location);
  if (!directory.startsWith(`${path.join(root, 'node_modules')}${path.sep}`))
    throw new Error(`Unexpected dependency path: ${location}`);
  const manifest = path.join(directory, 'package.json');
  if (!fs.existsSync(manifest)) {
    if (entry.optional) continue;
    throw new Error(`Missing production dependency: ${location}`);
  }
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const folder = encodeURIComponent(location.replace(/^node_modules\//, ''));
  const target = path.join(destination, folder);
  const notices = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (item) => item.isFile() && /^(?:licen[cs]e|notice|copying|ofl)(?:[.\-_].*)?$/i.test(item.name)
    )
    .map((item) => item.name)
    .sort();
  if (pkg.name === '@anthropic-ai/claude-agent-sdk') notices.push('README.md');
  fs.mkdirSync(target, { recursive: true });
  for (const name of notices) fs.copyFileSync(path.join(directory, name), path.join(target, name));
  if (!notices.length) {
    const fallback = path.join(root, 'build', 'license-sources', `${pkg.name}-${pkg.version}`);
    if (!fs.existsSync(fallback))
      throw new Error(`Dependency has no bundled notices: ${pkg.name}@${pkg.version}`);
    for (const item of fs.readdirSync(fallback, { withFileTypes: true }))
      if (item.isFile()) {
        fs.copyFileSync(path.join(fallback, item.name), path.join(target, item.name));
        notices.push(item.name);
      }
    fs.copyFileSync(manifest, path.join(target, 'package.json'));
    notices.push('package.json');
  }
  records.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license || entry.license || 'See original package',
    location,
    notices: notices.map((name) => `${folder}/${name}`),
  });
}
records.sort((a, b) => a.location.localeCompare(b.location));
fs.writeFileSync(path.join(destination, 'index.json'), `${JSON.stringify(records, null, 2)}\n`);
fs.writeFileSync(
  path.join(destination, 'README.md'),
  '# Dependency notices\n\nOriginal notices copied from installed production packages. See index.json for exact versions and notice paths. Electron and Chromium notices accompany Duo.exe. Bundled skills retain their original notices in resources/skills. Claude Agent SDK has separate Anthropic terms; it is not covered by Duo’s MIT license.\n'
);
console.log(
  JSON.stringify({
    packages: records.length,
    noticeFiles: records.reduce((sum, record) => sum + record.notices.length, 0),
    destination: path.relative(root, destination),
  })
);
