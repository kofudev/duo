const fs = require('node:fs');
const path = require('node:path');
const { directory, folderName } = require('./library.cjs');
const { git } = require('./git.cjs');
const { findBinary, runCommand } = require('./process.cjs');
function githubRepository(value) {
  if (typeof value !== 'string' || value.length > 350) throw new Error('Dépôt GitHub invalide.');
  let name = value.trim();
  if (/^https:\/\//i.test(name)) {
    const url = new URL(name);
    if (
      url.hostname.toLowerCase() !== 'github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== '443')
    )
      throw new Error('URL GitHub.com HTTPS sans identifiants requise.');
    name = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  name = name.replace(/\.git$/i, '');
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}\/[a-zA-Z0-9_.-]{1,100}$/.test(name) ||
    ['.', '..'].includes(name.split('/')[1])
  )
    throw new Error('Dépôt attendu : propriétaire/nom ou URL GitHub HTTPS.');
  return { name, url: `https://github.com/${name}`, cloneUrl: `https://github.com/${name}.git` };
}
function destination(parent, name) {
  const parentRoot = directory(parent),
    safeName = folderName(name),
    target = path.resolve(parentRoot, safeName);
  if (path.dirname(target) !== parentRoot || fs.existsSync(target))
    throw new Error('Dossier destination existe déjà. Choisir autre nom.');
  return { parent: parentRoot, path: target, name: safeName };
}
async function listGitHubRepos() {
  const binary = findBinary('gh');
  if (!binary) throw new Error('GitHub CLI introuvable. Installer gh puis gh auth login.');
  const raw = await runCommand(binary, [
    'repo',
    'list',
    '--limit',
    '100',
    '--json',
    'nameWithOwner,url,isPrivate,description,pushedAt',
  ]);
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('Réponse GitHub inattendue.');
  return rows
    .filter((repo) => typeof repo.nameWithOwner === 'string')
    .map((repo) => ({
      name: repo.nameWithOwner,
      url: githubRepository(repo.url).url,
      private: repo.isPrivate === true,
      description: String(repo.description || '').slice(0, 250),
      pushedAt: repo.pushedAt || null,
    }));
}
async function cloneGitHub(values, { signal, progress = () => {}, runner = runCommand } = {}) {
  const repository = githubRepository(values.repository),
    target = destination(values.parent, values.name);
  const github = findBinary('gh'),
    binary = github || findBinary('git');
  if (!binary) throw new Error('Installer Git pour cloner dépôt.');
  const args = github
    ? ['repo', 'clone', repository.name, target.path, '--', '--progress']
    : ['clone', '--progress', '--', repository.cloneUrl, target.path];
  await runner(binary, args, {
    cwd: target.parent,
    timeout: 10 * 60 * 1000,
    signal,
    env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    onStderr: (chunk) => {
      const line = chunk
        .split(/[\r\n]/)
        .filter(Boolean)
        .at(-1);
      if (line) progress(line.slice(0, 250));
    },
  });
  return { path: directory(target.path), repository: repository.name };
}
async function createWorktree(project, values, { signal, progress = () => {} } = {}) {
  const target = destination(values.parent, values.name),
    root = (await git(project, ['rev-parse', '--show-toplevel'])).trim();
  if (
    typeof values.branch !== 'string' ||
    !values.branch.startsWith('varelia/') ||
    values.branch.length > 150
  )
    throw new Error('Branche nouvelle requise : varelia/nom.');
  await git(root, ['check-ref-format', '--branch', values.branch]);
  const ref = values.ref || 'HEAD';
  if (typeof ref !== 'string' || ref.startsWith('-') || ref.length > 200 || /[\x00-\x20]/.test(ref))
    throw new Error('Révision Git invalide.');
  const revision = (await git(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  const binary = findBinary('git');
  await runCommand(
    binary,
    ['-C', root, 'worktree', 'add', '-b', values.branch, '--', target.path, revision],
    { timeout: 120000, signal, onStderr: (text) => progress(text.trim().slice(-250)) }
  );
  return { path: directory(target.path), branch: values.branch, revision };
}
module.exports = { githubRepository, destination, listGitHubRepos, cloneGitHub, createWorktree };
