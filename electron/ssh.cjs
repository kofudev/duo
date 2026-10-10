const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { findBinary, runCommand } = require('./process.cjs');
function cleanProfile(input, existing) {
  const text = (key, limit = 160) => {
    const value = String(input[key] || '').trim();
    if (value.length > limit || /[\x00-\x1f]/.test(value)) throw new Error('Profil SSH invalide.');
    return value;
  };
  const name = text('name', 80),
    alias = text('alias'),
    host = text('host'),
    user = text('user');
  if (!name) throw new Error('Nom connexion requis.');
  if (alias ? !/^[a-z0-9][a-z0-9_.-]*$/i.test(alias) : !/^[a-z0-9][a-z0-9.:-]*$/i.test(host))
    throw new Error('Alias OpenSSH ou hôte valide requis.');
  if (user && !/^[a-z_][a-z0-9_-]{0,63}$/i.test(user)) throw new Error('Utilisateur SSH invalide.');
  const port = Number(input.port || 22),
    root = text('root', 1024),
    identityFile = text('identityFile', 2000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port SSH invalide.');
  if (!root.startsWith('/') || root === '/' || root.split('/').includes('..'))
    throw new Error('Dossier distant absolu requis, hors racine système.');
  if (identityFile && !path.isAbsolute(identityFile))
    throw new Error('Chemin clé SSH absolu requis.');
  return {
    id: existing?.id || randomUUID(),
    name,
    alias,
    host: alias ? '' : host,
    user: alias ? '' : user,
    port,
    root: root.replace(/\/+$/, ''),
    identityFile,
    allowWrite: input.allowWrite === true,
    allowCommands: input.allowCommands === true,
    updatedAt: Date.now(),
  };
}
function sshArgs(profile) {
  return [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2',
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    ...(!profile.alias ? ['-p', String(profile.port)] : []),
    ...(profile.identityFile ? ['-i', profile.identityFile] : []),
    profile.alias || `${profile.user ? profile.user + '@' : ''}${profile.host}`,
  ];
}
class SSH {
  constructor({ profiles = [], execute = runCommand, binary = () => findBinary('ssh') } = {}) {
    this.profiles = profiles;
    this.execute = execute;
    this.binary = binary;
  }
  profile(id) {
    const stored = this.profiles.find((entry) => entry.id === id);
    if (!stored) throw new Error('Connexion SSH introuvable.');
    return cleanProfile(stored, stored);
  }
  save(input) {
    const existing = input.id ? this.profiles.find((entry) => entry.id === input.id) : null;
    if (input.id && !existing) throw new Error('Connexion SSH introuvable.');
    const profile = cleanProfile(input, existing);
    if (existing) Object.assign(existing, profile);
    else {
      if (this.profiles.length >= 50) throw new Error('Maximum 50 connexions SSH.');
      this.profiles.push(profile);
    }
    return profile;
  }
  async call(id, operation, input = {}, { write = false, commands = false, signal } = {}) {
    const profile = this.profile(id),
      binary = this.binary();
    if (!binary) throw new Error('OpenSSH introuvable. Installer client OpenSSH Windows.');
    if (operation === 'write' && (!write || !profile.allowWrite))
      throw new Error('Écriture SSH désactivée pour cette mission ou connexion.');
    if (operation === 'run' && (!write || !commands || !profile.allowCommands))
      throw new Error(
        'Commandes SSH désactivées. Activer commandes mission et autorisation connexion.'
      );
    if (!['probe', 'list', 'read', 'write', 'run'].includes(operation))
      throw new Error('Opération SSH inconnue.');
    if (
      typeof input.path !== 'undefined' &&
      (typeof input.path !== 'string' ||
        input.path.length > 2000 ||
        /[\x00-\x1f\\]/.test(input.path) ||
        input.path.startsWith('/') ||
        input.path.split('/').includes('..'))
    )
      throw new Error('Chemin distant relatif requis.');
    if (
      operation === 'write' &&
      (typeof input.content !== 'string' ||
        Buffer.byteLength(input.content) > 512000 ||
        !('expectedHash' in input) ||
        (input.expectedHash !== null && !/^[a-f0-9]{64}$/.test(input.expectedHash)))
    )
      throw new Error('Contenu ou empreinte SSH invalide.');
    if (
      operation === 'run' &&
      (typeof input.command !== 'string' ||
        !input.command.trim() ||
        input.command.length > 6000 ||
        /\0/.test(input.command))
    )
      throw new Error('Commande SSH invalide.');
    const code = fs.readFileSync(path.join(__dirname, 'ssh-remote.py')).toString('base64');
    const remote = `python3 -c "import base64;exec(base64.b64decode('${code}'))"`;
    // JSON travels through stdin; filenames, content and commands are never shell-interpolated.
    const output = await this.execute(binary, [...sshArgs(profile), remote], {
      input: JSON.stringify({ ...input, root: profile.root, operation }),
      signal,
      timeout: 150000,
    });
    let response;
    try {
      response = JSON.parse(output);
    } catch {
      throw new Error('Réponse SSH invalide. Python 3 requis sur serveur.');
    }
    if (!response.ok) throw new Error(response.error || 'Opération SSH échouée.');
    return { connection: profile.name, ...response.result };
  }
}
module.exports = { SSH, cleanProfile, sshArgs };
