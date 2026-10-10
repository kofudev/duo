const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { directory } = require('./library.cjs');
const MAX_TEXT_BYTES = 512000;
const EXCLUDED = new Set(['.git', 'node_modules', '.cache', '__pycache__']);
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
function readBounded(descriptor, limit = MAX_TEXT_BYTES) {
  const buffer = Buffer.alloc(limit + 1);
  let length = 0;
  while (length < buffer.length) {
    const count = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
    if (!count) break;
    length += count;
  }
  return buffer.subarray(0, length);
}
function writeAll(descriptor, bytes) {
  let written = 0;
  while (written < bytes.length) {
    const count = fs.writeSync(descriptor, bytes, written, bytes.length - written, written);
    if (!count) throw new Error('Écriture interrompue.');
    written += count;
  }
  fs.ftruncateSync(descriptor, bytes.length);
  fs.fsyncSync(descriptor);
}
function resolveFile(project, relative = '') {
  const root = directory(project);
  if (
    typeof relative !== 'string' ||
    relative.length > 2000 ||
    /\0/.test(relative) ||
    path.isAbsolute(relative) ||
    /^[a-z]:/i.test(relative) ||
    relative.split(/[\\/]/).includes('..')
  )
    throw new Error('Chemin doit rester relatif au projet.');
  const parts = relative.split(/[\\/]/).filter((part) => part && part !== '.');
  let target = root;
  for (const part of parts) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink())
      throw new Error('Liens symboliques non suivis par éditeur.');
  }
  const actual = fs.realpathSync.native(target),
    rel = path.relative(root, actual);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
    throw new Error('Fichier hors projet.');
  return { root, target: actual, relative: rel.replaceAll('\\', '/') };
}
function listFiles(project, relative = '') {
  const { target, relative: base } = resolveFile(project, relative);
  if (!fs.statSync(target).isDirectory()) throw new Error('Dossier requis.');
  const entries = fs.readdirSync(target, { withFileTypes: true });
  const files = entries
    .filter((entry) => !EXCLUDED.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: base ? `${base}/${entry.name}` : entry.name,
      kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file',
    }));
  files.sort(
    (a, b) =>
      (a.kind !== 'directory') - (b.kind !== 'directory') || a.name.localeCompare(b.name, 'fr')
  );
  return {
    path: base,
    files: files.slice(0, 1000),
    truncated: files.length > 1000,
    excluded: entries.length - files.length,
  };
}
function searchFiles(
  project,
  query,
  { maxEntries = 20000, maxDirectories = 1500, limit = 100 } = {}
) {
  if (typeof query !== 'string' || query.length > 160 || /[\x00-\x1f]/.test(query))
    throw new Error('Recherche invalide · maximum 160 caractères.');
  const clean = (value) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const needle = clean(query.trim());
  if (!needle) return { files: [], scanned: 0, truncated: false };
  const root = directory(project),
    found = [];
  let scanned = 0,
    directories = 0,
    truncated = false;
  const score = (relative) => {
    const full = clean(relative),
      name = clean(path.basename(relative));
    if (name.includes(needle)) return 10000 - name.length;
    if (full.includes(needle)) return 5000 - full.length;
    let cursor = 0,
      gap = 0;
    for (const character of needle) {
      const index = full.indexOf(character, cursor);
      if (index < 0) return -1;
      gap += index - cursor;
      cursor = index + 1;
    }
    return 1000 - gap - full.length;
  };
  const walk = (relative, depth = 0) => {
    if (++directories > maxDirectories || depth > 24) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(resolveFile(root, relative).target, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDED.has(entry.name) || entry.isSymbolicLink()) continue;
      if (++scanned > maxEntries) {
        truncated = true;
        return;
      }
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(name, depth + 1);
      else if (entry.isFile()) {
        const rank = score(name);
        if (rank >= 0) found.push({ path: name, name: entry.name, score: rank });
      }
      if (scanned > maxEntries || directories > maxDirectories) return;
    }
  };
  walk('');
  found.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'fr'));
  return { files: found.slice(0, limit), scanned, truncated: truncated || found.length > limit };
}
function readFile(project, relative) {
  const { target, relative: name } = resolveFile(project, relative);
  const descriptor = fs.openSync(target, 'r');
  try {
    const stat = fs.fstatSync(descriptor),
      checked = resolveFile(project, relative);
    if (!stat.isFile()) throw new Error('Fichier requis.');
    if (!sameFile(stat, fs.statSync(checked.target)))
      throw new Error('Fichier remplacé pendant lecture. Recharger.');
    const large = () => ({
      path: name,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      readable: false,
      reason: 'Fichier supérieur à 500 Ko. Ouvrir éditeur externe.',
    });
    if (stat.size > MAX_TEXT_BYTES) return large();
    const bytes = readBounded(descriptor);
    if (bytes.length > MAX_TEXT_BYTES) return large();
    const base = { path: name, size: bytes.length, hash: hash(bytes), modifiedAt: stat.mtimeMs };
    if (bytes.includes(0))
      return {
        ...base,
        readable: false,
        reason: 'Fichier binaire. Prévisualisation texte indisponible.',
      };
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return { ...base, readable: false, reason: 'Encodage non UTF-8. Utiliser éditeur externe.' };
    }
    return { ...base, content, readable: true, newline: content.includes('\r\n') ? 'CRLF' : 'LF' };
  } finally {
    fs.closeSync(descriptor);
  }
}
function saveFile(project, { path: relative, content, expectedHash }) {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES ||
    content.includes('\0')
  )
    throw new Error('Contenu texte invalide · maximum 500 Ko.');
  const { target } = resolveFile(project, relative);
  const beforeStat = fs.statSync(target);
  if (!beforeStat.isFile()) throw new Error('Fichier requis.');
  if (beforeStat.nlink > 1)
    throw new Error('Fichier lié à plusieurs emplacements. Utiliser éditeur externe.');
  // In-place write preserves filesystem identity and avoids replacing an existing file with a renamed symlink.
  const descriptor = fs.openSync(target, fs.constants.O_RDWR);
  try {
    const openedStat = fs.fstatSync(descriptor);
    const checked = resolveFile(project, relative);
    if (
      !sameFile(beforeStat, openedStat) ||
      !sameFile(openedStat, fs.statSync(checked.target)) ||
      openedStat.nlink > 1
    )
      throw new Error('Fichier remplacé pendant sauvegarde. Recharger avant enregistrer.');
    if (openedStat.size > MAX_TEXT_BYTES)
      throw new Error('Fichier devenu supérieur à 500 Ko. Brouillon conservé.');
    const current = readBounded(descriptor);
    if (current.length > MAX_TEXT_BYTES)
      throw new Error('Fichier devenu supérieur à 500 Ko. Brouillon conservé.');
    if (typeof expectedHash !== 'string' || hash(current) !== expectedHash)
      throw new Error(
        'Fichier modifié ailleurs. Recharger avant enregistrer. Votre brouillon reste conservé.'
      );
    const bytes = Buffer.from(content, 'utf8');
    try {
      writeAll(descriptor, bytes);
    } catch (error) {
      try {
        writeAll(descriptor, current);
      } catch {
        throw new Error(
          `Sauvegarde échouée. Restauration échouée. Conserver brouillon et vérifier fichier : ${error.message}`
        );
      }
      throw new Error(`Sauvegarde échouée. Contenu original restauré : ${error.message}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return readFile(project, relative);
}
module.exports = {
  MAX_TEXT_BYTES,
  EXCLUDED,
  resolveFile,
  listFiles,
  searchFiles,
  readFile,
  readBounded,
  saveFile,
};
