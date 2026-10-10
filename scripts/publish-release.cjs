// Publish only complete, verified assets. Never overwrite a published release.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { version } = require('../package.json');
const { parseChecksums } = require('./release-checks.cjs');
const root = path.resolve(__dirname, '..');
const tag = `v${version}`;
const repo = 'kofudev/duo';
function gh(args, allowFailure = false) {
  const result = cp.spawnSync('gh', [...args, '--repo', repo], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0 && !allowFailure)
    throw new Error(result.stderr || result.error?.message || 'GitHub command failed');
  return result;
}
function sha(file) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
async function publish() {
  if (process.env.GITHUB_REF && process.env.GITHUB_REF !== `refs/tags/${tag}`)
    throw new Error('Tag must match package version.');
  const names = [
    `Duo-Setup-${version}.exe`,
    `Duo-${version}-windows-x64.zip`,
    `Duo-${version}-sources.zip`,
    `Duo-${version}-site.zip`,
    'Duo-Setup.exe',
    'Duo-Windows-x64.zip',
    'Duo-Sources.zip',
    'release.json',
    'SHA256SUMS.txt',
  ];
  const folder = path.join(root, 'release');
  for (const name of names)
    if (!fs.statSync(path.join(folder, name)).size) throw new Error(`Empty artifact: ${name}`);
  const sums = parseChecksums(fs.readFileSync(path.join(folder, 'SHA256SUMS.txt'), 'utf8'));
  for (const name of names.filter((n) => n !== 'SHA256SUMS.txt')) {
    if (sums.get(name) !== sha(path.join(folder, name)).slice(7))
      throw new Error(`Checksum differs: ${name}`);
  }
  const existing = gh(['release', 'view', tag, '--json', 'isDraft'], true);
  if (existing.status === 0 && !JSON.parse(existing.stdout).isDraft)
    throw new Error('Release already published. Ship a new version.');
  if (existing.status !== 0) {
    const changes = fs
      .readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
      .split(/^# /m)
      .slice(1)
      .find((s) => s.startsWith(`Duo ${version} `));
    if (!changes) throw new Error('Changelog entry missing.');
    const notes = path.join(folder, 'RELEASE-NOTES.md');
    fs.writeFileSync(
      notes,
      changes.slice(changes.indexOf('\n') + 1).trim() +
        '\n\nTélécharger **Duo-Setup.exe** pour installer Duo sur Windows x64. La version portable se trouve dans **Duo-Windows-x64.zip**. Les empreintes sont dans **SHA256SUMS.txt**.\n\nVersion indépendante, actuellement non signée. Connexions via les CLI officiels Codex et Claude Code.\n'
    );
    gh([
      'release',
      'create',
      tag,
      '--draft',
      '--verify-tag',
      '--title',
      `Duo ${version}`,
      '--notes-file',
      notes,
    ]);
  }
  gh(['release', 'upload', tag, ...names.map((n) => path.join(folder, n)), '--clobber']);
  const metadata = cp.spawnSync('gh', ['api', `repos/${repo}/releases/tags/${tag}`], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (metadata.status !== 0) throw new Error('Cannot verify release metadata.');
  const details = JSON.parse(metadata.stdout);
  if (!details.draft || details.assets.length !== names.length)
    throw new Error('Draft asset count differs.');
  for (const name of names) {
    const file = path.join(folder, name),
      asset = details.assets.find((a) => a.name === name);
    if (!asset || asset.size !== fs.statSync(file).size || asset.state !== 'uploaded')
      throw new Error(`Uploaded asset differs: ${name}`);
    if (asset.digest !== sha(file)) throw new Error(`GitHub checksum differs: ${name}`);
  }
  gh(['release', 'edit', tag, '--draft=false', '--latest']);
  console.log(`Published ${tag}: ${names.length} verified assets.`);
}
publish().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
