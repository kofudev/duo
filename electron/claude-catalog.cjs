const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { findBinary, commandFor, subscriptionEnv } = require('./process.cjs');
async function discoverClaudeModels({
  binary = findBinary('claude'),
  metadataRoot = path.join(os.tmpdir(), 'duo-cli-metadata'),
  timeoutMs = 12000,
} = {}) {
  if (!binary) throw new Error('Claude Code introuvable.');
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const command = commandFor(binary, []),
    entry = command.args[0] || command.binary;
  fs.mkdirSync(metadataRoot, { recursive: true });
  let release, child, timer;
  const closed = new Promise((resolve) => {
    release = resolve;
  });
  // Keep streaming input open without yielding any user message. Initialization only.
  async function* emptyInput() {
    await closed;
  }
  const request = query({
    prompt: emptyInput(),
    options: {
      pathToClaudeCodeExecutable: entry,
      cwd: metadataRoot,
      env: subscriptionEnv(),
      persistSession: false,
      tools: [],
      settingSources: [],
      settings: { disableAllHooks: true },
      strictMcpConfig: true,
      mcpServers: {},
      permissionMode: 'plan',
      maxTurns: 1,
      spawnClaudeCodeProcess: (options) => {
        const executable = entry.endsWith('.js') ? findBinary('node') : entry;
        if (!executable) throw new Error('Node.js introuvable.');
        child = spawn(executable, options.args, {
          cwd: options.cwd,
          env: subscriptionEnv(options.env),
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return child;
      },
    },
  });
  try {
    return await Promise.race([
      request.supportedModels(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Catalogue Claude : délai dépassé.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    request.close();
    release();
    if (child && child.exitCode === null && child.signalCode === null)
      await Promise.race([
        new Promise((resolve) => child.once('close', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
  }
}
module.exports = { discoverClaudeModels };
