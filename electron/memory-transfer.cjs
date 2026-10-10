const fs = require('node:fs');
const { createNote, cleanMemory, MAX_NOTES, MAX_TEXT } = require('./memory.cjs');
const MAX_IMPORT_CHARS = 320000,
  MAX_IMPORT_BYTES = 1280000;
const SOURCES = ['chatgpt', 'claude', 'codex', 'other', 'duo'];
const fingerprint = (text) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
function chunks(text) {
  const result = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (line.length > MAX_TEXT) {
      if (current.trim()) result.push(current.trim());
      current = '';
      for (let offset = 0; offset < line.length; offset += MAX_TEXT)
        result.push(line.slice(offset, offset + MAX_TEXT));
    } else if (current.length + line.length + 1 > MAX_TEXT || (!line.trim() && current.trim())) {
      if (current.trim()) result.push(current.trim());
      current = line;
    } else current += `${current ? '\n' : ''}${line}`;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
function previewMemory(text, source = 'other') {
  if (!SOURCES.includes(source)) throw new Error('Source mémoire invalide.');
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_IMPORT_CHARS)
    throw new Error('Importer texte mémoire non vide, 320 000 caractères maximum.');
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  let entries;
  if (/^\{|^\[\s*(?:\{|"|\])/.test(normalized)) {
    let parsed;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw new Error('JSON invalide. Coller texte ou export mémoire Duo.');
    }
    if (parsed?.format === 'duo-memory' && parsed.version !== 1)
      throw new Error('Version export mémoire non prise en charge.');
    entries = Array.isArray(parsed)
      ? parsed
      : parsed?.format === 'duo-memory'
        ? parsed.notes
        : null;
    if (!Array.isArray(entries))
      throw new Error(
        'JSON mémoire attendu : liste de notes ou export Duo. Export conversations complet non pris en charge.'
      );
  } else
    entries = chunks(normalized).map((text, index) => ({
      title:
        text
          .split('\n')[0]
          .replace(/^[-*#\s]+/, '')
          .slice(0, 100) || `Mémoire ${index + 1}`,
      text,
    }));
  if (!entries.length || entries.length > MAX_NOTES) throw new Error('Import : 1 à 200 notes.');
  const seen = new Set(),
    notes = [];
  let duplicates = 0;
  for (const entry of entries) {
    const value = typeof entry === 'string' ? { title: 'Mémoire importée', text: entry } : entry;
    if (!value || typeof value !== 'object') throw new Error('Entrée mémoire invalide.');
    const note = createNote({
      title: value.title || 'Mémoire importée',
      text: value.text,
      tags: value.tags || [],
      pinned: value.pinned === true,
    });
    const key = fingerprint(note.text);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    notes.push({ ...note, source, selected: true });
  }
  return { notes, duplicates, source };
}
function mergeMemory(existing, entries, source = 'other') {
  if (
    !SOURCES.includes(source) ||
    !Array.isArray(entries) ||
    !entries.length ||
    entries.length > MAX_NOTES
  )
    throw new Error('Import mémoire invalide.');
  const notes = cleanMemory(existing),
    seen = new Set(notes.map((note) => fingerprint(note.text)));
  let added = 0,
    duplicates = 0;
  for (const value of entries) {
    const note = createNote(value);
    if (seen.has(fingerprint(note.text))) {
      duplicates++;
      continue;
    }
    seen.add(fingerprint(note.text));
    notes.push({ ...note, source });
    added++;
  }
  if (notes.length > MAX_NOTES)
    throw new Error('200 notes maximum. Réduire import ou supprimer anciennes notes.');
  return { notes, added, duplicates };
}
function exportMemory(notes, scope) {
  if (!['personal', 'project'].includes(scope)) throw new Error('Portée mémoire invalide.');
  return (
    JSON.stringify(
      {
        format: 'duo-memory',
        version: 1,
        scope,
        exportedAt: new Date().toISOString(),
        notes: cleanMemory(notes).map(({ title, text, tags, pinned, source }) => ({
          title,
          text,
          tags,
          pinned,
          source,
        })),
      },
      null,
      2
    ) + '\n'
  );
}
function readMemoryImport(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_IMPORT_BYTES)
      throw new Error('Fichier mémoire : texte UTF-8, 1,28 Mo maximum.');
    const buffer = Buffer.alloc(MAX_IMPORT_BYTES + 1);
    let size = 0,
      bytes;
    do {
      bytes = fs.readSync(descriptor, buffer, size, buffer.length - size, null);
      size += bytes;
    } while (bytes && size < buffer.length);
    if (size > MAX_IMPORT_BYTES) throw new Error('Fichier mémoire trop volumineux.');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    } catch {
      throw new Error('Fichier mémoire doit être encodé UTF-8.');
    }
  } finally {
    fs.closeSync(descriptor);
  }
}
module.exports = { previewMemory, mergeMemory, exportMemory, readMemoryImport, MAX_IMPORT_CHARS };
