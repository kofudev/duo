const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { protectedName } = require('./review-evidence.cjs');
const { resolveFile } = require('./files.cjs');
const EXCLUDED = new Set(['.git', 'node_modules', '.cache', '__pycache__', 'dist', 'release']);

// Hashes only: source contents never enter the persistent baseline.
function captureMission(project, { maxFiles = 5000, maxBytes = 64 * 1024 * 1024 } = {}) {
  const files = {};
  let scanned = 0,
    bytes = 0,
    limited = false;
  const walk = (relative, depth = 0) => {
    if (depth > 24 || scanned >= maxFiles) {
      limited = true;
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(resolveFile(project, relative).target, { withFileTypes: true });
    } catch {
      limited = true;
      return;
    }
    for (const entry of entries) {
      if (EXCLUDED.has(entry.name) || entry.isSymbolicLink()) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (protectedName(name)) continue;
      if (entry.isDirectory()) walk(name, depth + 1);
      else if (entry.isFile()) {
        if (++scanned > maxFiles) {
          limited = true;
          return;
        }
        try {
          const { target } = resolveFile(project, name),
            stat = fs.statSync(target);
          if (stat.nlink !== 1) {
            limited = true;
            continue;
          }
          if (stat.size > 2 * 1024 * 1024 || bytes + stat.size > maxBytes) {
            files[name] = {
              stamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
              size: stat.size,
            };
            limited = true;
          } else {
            const fd = fs.openSync(target, 'r');
            try {
              const actual = fs.fstatSync(fd);
              if (actual.size > 2 * 1024 * 1024 || actual.ino !== stat.ino) {
                limited = true;
                continue;
              }
              const buffer = Buffer.alloc(actual.size + 1);
              const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
              if (count !== actual.size) {
                limited = true;
                continue;
              }
              bytes += count;
              files[name] = {
                hash: createHash('sha256').update(buffer.subarray(0, count)).digest('hex'),
                size: count,
              };
            } finally {
              fs.closeSync(fd);
            }
          }
        } catch {
          limited = true;
        }
      }
    }
  };
  walk('');
  return { project, at: Date.now(), files, limited, scanned };
}
function compareMission(before, after) {
  const changes = [];
  for (const name of new Set([...Object.keys(before.files), ...Object.keys(after.files)])) {
    const old = before.files[name],
      current = after.files[name];
    if (!current && after.limited) {
      // An incomplete scan must never invent a deletion.
      try {
        fs.lstatSync(path.join(after.project, name));
        continue;
      } catch (error) {
        if (error.code !== 'ENOENT') continue;
      }
    }
    if (!old || !current || (old.hash || old.stamp) !== (current.hash || current.stamp))
      changes.push({
        path: name,
        kind: !old ? 'created' : !current ? 'deleted' : 'modified',
        hash: current?.hash || null,
        size: current?.size ?? null,
      });
  }
  return {
    at: after.at,
    since: before.at,
    changes,
    limited: before.limited || after.limited,
    scanned: after.scanned,
  };
}
module.exports = { captureMission, compareMission };
