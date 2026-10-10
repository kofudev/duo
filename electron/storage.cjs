const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const pause = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
function readJson(file, maxBytes = 100_000_000) {
  const stat = fs.statSync(file);
  if (stat.size > maxBytes) throw new Error('Historique supérieur à limite stockage.');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Historique JSON invalide.');
  if (data.schemaVersion && data.schemaVersion > 4)
    throw new Error('Historique créé par version Duo plus récente.');
  return { data, file, time: Number(data.storageSavedAt) || stat.mtimeMs };
}
class JsonStore {
  constructor(file, { retryDelayMs = 25, retries = 8, maxBytes = 100_000_000 } = {}) {
    this.file = path.resolve(file);
    this.retryDelayMs = retryDelayMs;
    this.retries = retries;
    this.maxBytes = maxBytes;
    this.lastBackup = 0;
    this.lastSavedAt = 0;
  }
  candidates() {
    const parent = path.dirname(this.file),
      name = path.basename(this.file);
    if (!fs.existsSync(parent)) return [];
    return [
      this.file,
      this.file + '.previous',
      ...fs
        .readdirSync(parent)
        .filter((value) => value.startsWith(name + '.recovery-') && value.endsWith('.json'))
        .map((value) => path.join(parent, value)),
    ].filter(fs.existsSync);
  }
  load() {
    const valid = [],
      errors = [];
    for (const file of this.candidates()) {
      try {
        valid.push(readJson(file, this.maxBytes));
      } catch (error) {
        if (/version Duo plus récente/.test(error.message)) throw error;
        errors.push({ file, error: error.message });
      }
    }
    valid.sort((a, b) => b.time - a.time);
    const chosen = valid[0];
    this.lastSavedAt = chosen?.time || 0;
    if (fs.existsSync(this.file) && errors.some((error) => error.file === this.file))
      fs.copyFileSync(this.file, this.file + `.corrupt-${Date.now()}`);
    if (chosen?.data.schemaVersion !== 4 && chosen?.file === this.file)
      fs.copyFileSync(
        this.file,
        this.file +
          `.v${[2, 3].includes(chosen.data.schemaVersion) ? chosen.data.schemaVersion : 1}-backup-${Date.now()}`
      );
    return { data: chosen?.data || {}, recovered: !!chosen && chosen.file !== this.file, errors };
  }
  save(data) {
    const savedAt = Math.max(Date.now(), this.lastSavedAt + 1),
      text = JSON.stringify({ ...data, storageSavedAt: savedAt }, null, 2);
    if (Buffer.byteLength(text, 'utf8') > this.maxBytes)
      throw new Error(
        'Historique supérieur à limite stockage (100 Mo par défaut). Exporter conversations puis réduire historique avant sauvegarde.'
      );
    const parent = path.dirname(this.file);
    fs.mkdirSync(parent, { recursive: true });
    const temporary = this.file + `.pending-${randomUUID()}`;
    const descriptor = fs.openSync(temporary, 'wx');
    try {
      fs.writeFileSync(descriptor, text);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (fs.existsSync(this.file) && Date.now() - this.lastBackup > 30000) {
      try {
        readJson(this.file, this.maxBytes);
        fs.copyFileSync(this.file, this.file + '.previous');
        this.lastBackup = Date.now();
      } catch {}
    }
    let renameError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        fs.renameSync(temporary, this.file);
        renameError = null;
        break;
      } catch (error) {
        renameError = error;
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === this.retries) break;
        pause(this.retryDelayMs);
      }
    }
    this.lastSavedAt = savedAt;
    if (renameError) {
      // Keep the fully flushed snapshot. Startup selects the newest valid snapshot.
      const recovery = this.file + `.recovery-${savedAt}-${randomUUID()}.json`;
      fs.copyFileSync(temporary, recovery, fs.constants.COPYFILE_EXCL);
      const recoveryDescriptor = fs.openSync(recovery, 'r+');
      try {
        fs.fsyncSync(recoveryDescriptor);
      } finally {
        fs.closeSync(recoveryDescriptor);
      }
      try {
        fs.unlinkSync(temporary);
      } catch {}
      return {
        recovered: true,
        file: recovery,
        warning:
          'Historique principal verrouillé. Sauvegarde récupération conservée. Fermer Duo puis rouvrir pour rétablir stockage.',
      };
    }
    // Remove only this store's obsolete, known recovery snapshots after primary is durable.
    for (const file of this.candidates())
      if (file.startsWith(this.file + '.recovery-')) {
        try {
          if (readJson(file, this.maxBytes).time <= savedAt && path.dirname(file) === parent)
            fs.unlinkSync(file);
        } catch {}
      }
    return { recovered: false, file: this.file };
  }
}
module.exports = { JsonStore, readJson };
