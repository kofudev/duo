const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { findBinary } = require('./process.cjs');
const { resolveFile } = require('./files.cjs');

function validationCommands(project, config) {
  if (config.validationMode === 'off') return [];
  if (config.validationMode === 'manual') return config.validationCommands || [];
  try {
    const { target } = resolveFile(project, 'package.json');
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256000) return [];
    const scripts = JSON.parse(fs.readFileSync(target, 'utf8')).scripts || {};
    return ['test', 'build']
      .filter((name) => typeof scripts[name] === 'string' && scripts[name].trim())
      .map((name) => `npm run ${name}`);
  } catch {
    return [];
  }
}
// Exact user command travels as one argument; paths and model text are never interpolated.
function runValidation(project, command, { signal, timeoutMs = 120000 } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Arrêt demandé.'));
  if (
    typeof command !== 'string' ||
    !command.trim() ||
    command.length > 2000 ||
    /[\x00-\x1f]/.test(command)
  )
    throw new Error('Commande de validation invalide.');
  const windows = process.platform === 'win32';
  const binary = windows ? findBinary('pwsh') || findBinary('powershell') : '/bin/sh';
  if (!binary) throw new Error('PowerShell introuvable pour validations.');
  const script = `$ErrorActionPreference = 'Stop'; ${command}; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`;
  const args = windows
    ? [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ]
    : ['-c', command];
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(binary, args, {
      cwd: path.resolve(project),
      env: { ...process.env, CI: '1', npm_config_update_notifier: 'false' },
      windowsHide: true,
      detached: !windows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      received = 0,
      failure,
      killTimer,
      settled = false;
    const stop = (reason) => {
      if (failure || settled) return;
      failure = reason;
      if (!child.pid) return;
      if (windows)
        execFile(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, timeout: 5000 },
          (error) => {
            if (error) child.kill();
          }
        );
      else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill();
        }
        killTimer = setTimeout(() => {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
        }, 1500);
      }
    };
    const cancel = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', cancel);
      if (failure === 'cancelled') return reject(new Error('Arrêt demandé.'));
      resolve({
        exitCode: Number.isInteger(code) ? code : null,
        status: !failure && !error && code === 0 ? 'completed' : 'failed',
        stdout,
        stderr,
        error:
          failure === 'timeout'
            ? 'Délai de validation dépassé.'
            : failure === 'output'
              ? 'Sortie trop volumineuse.'
              : error?.message || '',
        durationMs: Date.now() - startedAt,
      });
    };
    for (const [name, stream] of [
      ['stdout', child.stdout],
      ['stderr', child.stderr],
    ]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        received += Buffer.byteLength(chunk);
        if (name === 'stdout') stdout = (stdout + chunk).slice(-12000);
        else stderr = (stderr + chunk).slice(-12000);
        if (received > 2_000_000) stop('output');
      });
    }
    child.on('error', (error) => finish(error, null));
    child.on('close', (code) => finish(null, code));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
module.exports = { validationCommands, runValidation };
