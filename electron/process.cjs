const { spawn, execFile } = require('node:child_process');
const { existsSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function findBinary(name) {
  const dirs = (process.env.PATH || '')
    .split(path.delimiter)
    .filter((dir) => dir && path.isAbsolute(dir));
  if (
    name === 'claude' &&
    process.platform === 'win32' &&
    path.isAbsolute(process.env.USERPROFILE || '')
  )
    dirs.push(path.join(process.env.USERPROFILE, '.local', 'bin'));
  if (name === 'codex' && process.platform === 'win32') {
    const base = path.isAbsolute(process.env.LOCALAPPDATA || '')
      ? path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
      : null;
    if (base && existsSync(base)) {
      const folders = readdirSync(base)
        .map((folder) => {
          const candidate = path.join(base, folder);
          try {
            const stat = statSync(candidate);
            return stat.isDirectory() ? { path: candidate, modified: stat.mtimeMs } : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.modified - a.modified);
      for (const folder of folders) dirs.push(folder.path);
    }
  }
  for (const dir of dirs) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      const candidate = path.join(dir, name + ext);
      try {
        if (existsSync(candidate)) {
          const stat = statSync(candidate);
          if (stat.isFile() && stat.size > 0) return candidate;
        }
      } catch {}
    }
  }
  return null;
}
function formatCliCommand(name, binary, args) {
  const dirs = (process.env.PATH || '')
    .split(path.delimiter)
    .filter((dir) => dir && path.isAbsolute(dir));
  const samePath = (value) =>
    process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const onPath = binary && dirs.some((dir) => samePath(dir) === samePath(path.dirname(binary)));
  const entry =
    !binary || !path.isAbsolute(binary) || onPath ? name : `& '${binary.replaceAll("'", "''")}'`;
  return `${entry} ${args.join(' ')}`;
}

// Invoke npm CLI entrypoints with Node directly. Never interpolate user prompts into a shell.
function commandFor(binary, args) {
  if (binary.endsWith('.cmd')) {
    const dir = path.dirname(binary);
    const entries = binary.endsWith('claude.cmd')
      ? [
          path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
          path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        ]
      : binary.endsWith('codex.cmd')
        ? [path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')]
        : [];
    const entry = entries.find((file) => {
      try {
        const stat = statSync(file);
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    });
    if (!entry) throw new Error('CLI npm non compatible. Installer version native officielle.');
    if (entry.endsWith('.exe')) return { binary: entry, args };
    const node = findBinary('node');
    if (!node) throw new Error('Node.js introuvable pour lancer CLI npm.');
    return { binary: node, args: [entry, ...args] };
  }
  return { binary, args };
}

function launch(binary, args, options = {}) {
  const command = commandFor(binary, args);
  const env = options.subscription
    ? subscriptionEnv(options.env)
    : { ...process.env, ...options.env };
  return spawn(command.binary, command.args, {
    cwd: options.cwd,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
function subscriptionEnv(overrides = {}) {
  const env = { ...process.env, ...overrides },
    keys = new Set([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_PROFILE',
      'OPENAI_API_KEY',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'CLAUDE_CODE_USE_MANTLE',
      'ANTHROPIC_BASE_URL',
      'OPENAI_BASE_URL',
    ]);
  for (const key of Object.keys(env)) if (keys.has(key.toUpperCase())) delete env[key];
  return env;
}

function runCommand(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('Arrêt demandé.'));
    const child = launch(binary, args, options);
    let stdout = '',
      stderr = '',
      failure,
      done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      error ? reject(error) : resolve(value);
    };
    const terminate = (error) => {
      failure ||= error;
      stopTree(child);
    };
    const cancel = () => terminate(new Error('Arrêt demandé.'));
    const timer = setTimeout(
      () => terminate(new Error('Commande trop longue.')),
      options.timeout || 20000
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) terminate(new Error('Sortie trop volumineuse.'));
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-16000);
      options.onStderr?.(chunk);
    });
    child.stdin.on('error', (error) => terminate(error));
    child.on('error', (error) => finish(error));
    child.on('close', (code) =>
      finish(
        failure ||
          (code === 0
            ? null
            : new Error(stderr.trim() || stdout.trim() || `Commande échouée (${code}).`)),
        options.includeStderr ? stdout + stderr : stdout
      )
    );
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    options.onStart?.(child);
    child.stdin.end(options.input || '');
  });
}

function stopTree(child) {
  if (!child || !child.pid || child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32')
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGTERM');
}

class JsonRpc {
  constructor(binary, args, options = {}) {
    this.child = launch(binary, args, options);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.stderr = '';
    this.closed = false;
    this.closing = false;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    readline.createInterface({ input: this.child.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          const error = new Error(message.error.message);
          error.remoteError = true;
          error.code = message.error.code;
          pending.reject(error);
        } else pending.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-8000);
    });
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', (code) => {
      this.closed = true;
      this.fail(new Error(`Codex arrêté (${code}). ${this.stderr.slice(-500)}`));
      for (const listener of this.listeners) listener({ method: '$closed', params: { code } });
      this.resolveExit();
    });
  }
  fail(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  send(message) {
    if (this.closed || this.closing || this.child.stdin.destroyed)
      throw new Error('Connexion Codex fermée.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} : délai dépassé.`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  listen(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  close() {
    if (!this.closed && !this.closing) {
      this.closing = true;
      stopTree(this.child);
    }
    return this.exitPromise;
  }
}

module.exports = {
  findBinary,
  formatCliCommand,
  commandFor,
  subscriptionEnv,
  launch,
  runCommand,
  stopTree,
  JsonRpc,
};
