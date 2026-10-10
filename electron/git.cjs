const { runCommand, findBinary } = require('./process.cjs');
const { createHash } = require('node:crypto');
const { statSync, lstatSync } = require('node:fs');
const path = require('node:path');

function parseStatus(raw) {
  const parts = raw.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const status = parts[i].slice(0, 2),
      name = parts[i].slice(3);
    const previous = /[RC]/.test(status) ? parts[++i] : null;
    files.push({ path: name, previous, status, untracked: status === '??' });
  }
  return files;
}
async function git(project, args) {
  const binary = findBinary('git');
  if (!binary) throw new Error('Git introuvable.');
  return runCommand(binary, ['-C', project, ...args], { timeout: 30000 });
}
async function inspectGit(project) {
  try {
    const root = (await git(project, ['rev-parse', '--show-toplevel'])).trim();
    const selected = path.resolve(project),
      relative = path.relative(root, selected);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw new Error('Projet hors dépôt Git.');
    const scope = relative.replaceAll('\\', '/'),
      pathspec = scope ? [`:(literal)${scope}/`] : [];
    const [raw, diff, branch, remote, stagedChanges] = await Promise.all([
      git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...pathspec]),
      git(root, ['diff', 'HEAD', '--', ...pathspec]).catch(
        async () =>
          (await git(root, ['diff', '--cached', '--', ...pathspec])) +
          (await git(root, ['diff', '--', ...pathspec]))
      ),
      git(root, ['branch', '--show-current']),
      git(root, ['remote', 'get-url', 'origin']).catch(() => ''),
      scope
        ? git(root, ['diff', '--cached', '--name-status', '-z', '--find-renames', '--']).catch(
            () => ''
          )
        : Promise.resolve(''),
    ]);
    const stagedRenames = new Map(),
      changes = stagedChanges.split('\0');
    for (let i = 0; i < changes.length && changes[i]; i++) {
      const status = changes[i];
      if (/^[RC]/.test(status)) {
        const previous = changes[++i],
          destination = changes[++i];
        stagedRenames.set(destination, previous);
      } else i++;
    }
    const within = (name) => {
      const value = path.relative(selected, path.resolve(root, name));
      return value === '..' || value.startsWith('..' + path.sep) || path.isAbsolute(value)
        ? null
        : value.replaceAll('\\', '/');
    };
    const files = parseStatus(raw)
      .map((file) => {
        const previous = file.previous || stagedRenames.get(file.path) || null;
        return {
          ...file,
          path: within(file.path),
          repoPath: file.path,
          repoPrevious: previous,
          previous: previous ? within(previous) : null,
          outsideRename: !!previous && within(previous) === null,
        };
      })
      .filter((file) => {
        if (file.path === null) return false;
        let current = selected;
        for (const segment of file.path.split('/').slice(0, -1)) {
          current = path.join(current, segment);
          try {
            if (lstatSync(current).isSymbolicLink()) return false;
          } catch {
            break;
          }
        }
        return true;
      });
    const stats = files.map((file) => {
      try {
        const s = statSync(path.join(root, file.repoPath));
        return [file.path, s.size, s.mtimeMs];
      } catch {
        return [file.path, null];
      }
    });
    const signature = createHash('sha256')
      .update(
        raw +
          diff +
          JSON.stringify(stats) +
          JSON.stringify(files.map((f) => [f.repoPath, f.repoPrevious]))
      )
      .digest('hex');
    return {
      available: true,
      root,
      project: selected,
      scope,
      branch: branch.trim() || 'HEAD détachée',
      remote: remote.trim(),
      files,
      diff: diff.slice(0, 160000),
      signature,
    };
  } catch (error) {
    return { available: false, error: error.message, files: [], diff: '' };
  }
}
async function commitSelected(project, { files, message, signature }) {
  if (typeof message !== 'string' || !message.trim() || message.length > 2000)
    throw new Error('Message commit requis (max. 2 000 caractères).');
  if (!Array.isArray(files) || !files.length)
    throw new Error('Sélectionner fichiers avant commit.');
  const snapshot = await inspectGit(project);
  if (!snapshot.available) throw new Error(snapshot.error);
  if (signature !== snapshot.signature)
    throw new Error('Fichiers modifiés depuis aperçu. Actualiser diff avant commit.');
  const allowed = new Map(snapshot.files.map((file) => [file.path, file]));
  const paths = new Set();
  for (const name of files) {
    const file = allowed.get(name);
    if (!file) throw new Error('Fichier sélectionné absent du diff.');
    if (file.outsideRename)
      throw new Error(
        'Renommage depuis hors projet. Ouvrir dépôt complet avant committer cette opération.'
      );
    paths.add(file.repoPath);
    if (file.repoPrevious) paths.add(file.repoPrevious);
  }
  const literalPaths = [...paths].map((name) => `:(literal)${name}`);
  await git(snapshot.root, ['add', '--', ...literalPaths]);
  return git(snapshot.root, ['commit', '--only', '-m', message.trim(), '--', ...literalPaths]);
}
function remoteUrl(remote) {
  const match = remote.match(
    /^(?:git@github\.com:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/
  );
  return match ? `https://github.com/${match[1]}` : null;
}
module.exports = { parseStatus, inspectGit, commitSelected, remoteUrl, git };
