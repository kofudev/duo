const {
  JsonRpc,
  findBinary,
  formatCliCommand,
  launch,
  stopTree,
  runCommand,
} = require('./process.cjs');
const readline = require('node:readline');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createToolBridge } = require('./tool-bridge.cjs');
const { parseVersion, mergeClaudeCatalog } = require('./models.cjs');
const { discoverClaudeModels } = require('./claude-catalog.cjs');
const { version } = require('../package.json');

class CodexProvider {
  constructor({ turnTimeoutMs = 20 * 60 * 1000, interruptGraceMs = 10000 } = {}) {
    this.rpc = null;
    this.opening = null;
    this.turnTimeoutMs = turnTimeoutMs;
    this.interruptGraceMs = interruptGraceMs;
  }
  async connect() {
    if (this.rpc && !this.rpc.closed && !this.rpc.closing) return this.rpc;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const binary = findBinary('codex');
      if (!binary) throw new Error('Codex CLI introuvable. Installer CLI officiel.');
      const rpc = new JsonRpc(binary, ['app-server', '--listen', 'stdio://'], {
        subscription: true,
      });
      try {
        await rpc.request('initialize', {
          clientInfo: { name: 'duo_personal_workspace', title: 'Duo Personal Workspace', version },
          capabilities: { experimentalApi: true },
        });
        rpc.send({ method: 'initialized', params: {} });
      } catch (error) {
        rpc.close();
        throw error;
      }
      rpc.listen((message) => {
        if (message.method === '$closed' && this.rpc === rpc) this.rpc = null;
      });
      this.rpc = rpc;
      return rpc;
    })().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }
  async models() {
    const rpc = await this.connect();
    let data = [],
      cursor = null;
    do {
      const result = await rpc.request('model/list', {
        limit: 100,
        includeHidden: true,
        ...(cursor ? { cursor } : {}),
      });
      data.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor);
    return data.map((model) => ({
      id: model.model,
      name: model.displayName,
      description: model.description,
      provider: 'codex',
      default: model.isDefault,
      hidden: model.hidden,
      defaultEffort: model.defaultReasoningEffort,
      efforts: model.supportedReasoningEfforts?.map((e) => e.reasoningEffort) || [
        model.defaultReasoningEffort || 'medium',
      ],
      modalities: model.inputModalities || ['text'],
      discovery: 'live',
      status: 'listed',
      source: 'https://learn.chatgpt.com/docs/app-server',
      verifiedAt: new Date().toISOString().slice(0, 10),
    }));
  }
  async accountInfo() {
    const rpc = await this.connect();
    const [account, limits] = await Promise.allSettled([
      rpc.request('account/read', { refreshToken: false }),
      rpc.request('account/rateLimits/read'),
    ]);
    return {
      plan: account.status === 'fulfilled' ? account.value.account?.planType || null : null,
      rateLimits:
        limits.status === 'fulfilled'
          ? limits.value.rateLimitsByLimitId || { codex: limits.value.rateLimits }
          : null,
    };
  }
  async quota() {
    const rpc = await this.connect();
    const limits = await rpc.request('account/rateLimits/read');
    return limits.rateLimitsByLimitId || limits.rateLimits || null;
  }
  async run({
    prompt,
    instructions,
    project,
    model,
    effort,
    write,
    signal,
    onDelta,
    onTool,
    onUsage = () => {},
    onQuota = () => {},
    tools = [],
    onToolCall,
    onUserInput,
    onToolResult = () => {},
    outputSchema,
  }) {
    if (signal.aborted) throw new Error('Arrêt demandé.');
    const rpc = await this.connect();
    if (signal.aborted) throw new Error('Arrêt demandé.');
    const { thread } = await rpc.request('thread/start', {
      cwd: project,
      model: model || null,
      modelProvider: 'openai',
      approvalPolicy: 'never',
      sandbox: write ? 'workspace-write' : 'read-only',
      developerInstructions: instructions,
      ephemeral: true,
      ...(tools.length
        ? { dynamicTools: tools.map((tool) => ({ type: 'function', ...tool })) }
        : {}),
    });
    if (signal.aborted) {
      await rpc.request('thread/unsubscribe', { threadId: thread.id }).catch(() => {});
      throw new Error('Arrêt demandé.');
    }
    let text = '',
      turnId,
      interrupted = false,
      finished = false,
      cancelTimer,
      cancellationError,
      usage;
    const completedMessages = new Map();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cancellationError = new Error('Codex : délai de réponse dépassé.');
        cancel();
      }, this.turnTimeoutMs);
      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(cancelTimer);
        off();
        signal.removeEventListener('abort', cancel);
        const messages = [...completedMessages.values()],
          finals = messages.filter((m) => m.phase === 'final_answer');
        const report = (finals.length ? finals : messages).map((m) => m.text).join('\n\n') || text;
        if (usage) onUsage(usage);
        if (!rpc.closed && !rpc.closing)
          rpc.request('thread/unsubscribe', { threadId: thread.id }).catch(() => {});
        error
          ? reject(error)
          : report.trim()
            ? resolve(report)
            : reject(new Error('Codex : aucun rapport final reçu.'));
      };
      const cancel = () => {
        interrupted = true;
        cancellationError ||= new Error('Arrêt demandé.');
        if (turnId) rpc.request('turn/interrupt', { threadId: thread.id, turnId }).catch(() => {});
        if (!cancelTimer)
          cancelTimer = setTimeout(() => {
            Promise.resolve(rpc.close()).then(() => finish(cancellationError));
          }, this.interruptGraceMs);
      };
      const off = rpc.listen((message) => {
        const p = message.params || {};
        if (message.method === '$closed')
          return finish(cancellationError || new Error('Connexion Codex fermée.'));
        if (message.method === 'account/rateLimits/updated') {
          onQuota(p.rateLimitsByLimitId || p.rateLimits || null);
          return;
        }
        if (p.threadId !== thread.id) return;
        if (message.id !== undefined && message.method) {
          if (message.method === 'item/tool/call' && onToolCall) {
            Promise.resolve()
              .then(() => onToolCall(p.tool, p.arguments || {}))
              .then(
                (value) =>
                  rpc.send({
                    id: message.id,
                    result: {
                      contentItems: [{ type: 'inputText', text: JSON.stringify(value) }],
                      success: true,
                    },
                  }),
                (error) =>
                  rpc.send({
                    id: message.id,
                    result: {
                      contentItems: [{ type: 'inputText', text: error.message }],
                      success: false,
                    },
                  })
              )
              .catch(() => {});
            return;
          }
          if (message.method === 'item/tool/requestUserInput' && onUserInput) {
            onUserInput(p.questions || []);
          }
          // No silent permission escalation in a headless run.
          rpc.send({
            id: message.id,
            error: {
              code: -32000,
              message: 'Interaction requise : effectuer action depuis interface Duo.',
            },
          });
        }
        if (message.method === 'item/agentMessage/delta') {
          text += p.delta;
          onDelta(p.delta);
        }
        if (message.method === 'item/completed' && p.item?.type === 'agentMessage')
          completedMessages.set(p.item.id, p.item);
        if (message.method === 'item/completed' && p.item?.type === 'commandExecution')
          onToolResult({
            kind: 'command',
            command: p.item.command,
            exitCode: p.item.exitCode ?? null,
            status: p.item.status,
            durationMs: p.item.durationMs,
          });
        if (message.method === 'thread/tokenUsage/updated') {
          usage = p.tokenUsage?.total;
          if (usage) onUsage(usage);
        }
        if (
          message.method === 'item/started' &&
          [
            'commandExecution',
            'fileChange',
            'mcpToolCall',
            'dynamicToolCall',
            'webSearch',
          ].includes(p.item?.type)
        )
          onTool(
            p.item.tool || p.item.type,
            p.item.command ||
              p.item.arguments?.path ||
              p.item.arguments?.question ||
              p.item.name ||
              ''
          );
        if (message.method === 'turn/started') {
          turnId = p.turn.id;
          if (interrupted) cancel();
        }
        if (message.method === 'turn/completed')
          finish(
            p.turn.status === 'completed' && !interrupted
              ? null
              : cancellationError || new Error(p.turn.error?.message || `Codex : ${p.turn.status}.`)
          );
      });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
        finish(new Error('Arrêt demandé.'));
        return;
      }
      rpc
        .request('turn/start', {
          threadId: thread.id,
          input: [{ type: 'text', text: prompt }],
          ...(effort ? { effort } : {}),
          ...(outputSchema ? { outputSchema } : {}),
        })
        .then((result) => {
          turnId = result.turn.id;
          if (interrupted) cancel();
        })
        .catch((error) => {
          if (error.remoteError) finish(error);
          else {
            cancellationError = error;
            cancel();
          }
        });
    });
  }
  close() {
    this.rpc?.close();
    this.rpc = null;
  }
}

class ClaudeProvider {
  async run({
    prompt,
    instructions,
    project,
    model,
    effort,
    write,
    commands,
    signal,
    onDelta,
    onTool,
    onUsage = () => {},
    tools: sharedTools = [],
    onToolCall,
    onToolResult = () => {},
    outputSchema,
  }) {
    const binary = findBinary('claude');
    if (!binary) throw new Error('Claude Code introuvable. Installer CLI officiel.');
    const bridge = sharedTools.length
      ? await createToolBridge(sharedTools, onToolCall, signal)
      : null;
    let bridgeFolder, mcpConfig;
    if (bridge) {
      try {
        bridgeFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-tools-'));
        mcpConfig = path.join(bridgeFolder, 'mcp.json');
        fs.writeFileSync(
          mcpConfig,
          JSON.stringify({
            mcpServers: {
              duo: {
                type: 'stdio',
                command: process.execPath,
                args: [path.join(__dirname, 'mcp-proxy.cjs')],
                env: {
                  ELECTRON_RUN_AS_NODE: '1',
                  DUO_TOOL_ENDPOINT: bridge.url,
                  DUO_TOOL_TOKEN: bridge.token,
                },
              },
            },
          }),
          { mode: 0o600 }
        );
      } catch (error) {
        bridge.close();
        if (mcpConfig && fs.existsSync(mcpConfig)) fs.unlinkSync(mcpConfig);
        if (bridgeFolder) fs.rmdirSync(bridgeFolder);
        throw error;
      }
    }
    const tools = write
      ? ['Read', 'Glob', 'Grep', 'Edit', 'Write', ...(commands ? ['Bash'] : [])]
      : ['Read', 'Glob', 'Grep'];
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      write ? 'acceptEdits' : bridge ? 'default' : 'plan',
      '--tools',
      tools.join(','),
      '--allowedTools',
      ...tools,
      ...sharedTools.map((tool) => `mcp__duo__${tool.name}`),
      '--settings',
      JSON.stringify({ disableAllHooks: true }),
      '--strict-mcp-config',
      '--mcp-config',
      mcpConfig || JSON.stringify({ mcpServers: {} }),
      ...(!bridge ? ['--disallowedTools', 'mcp__*'] : []),
      '--append-system-prompt',
      instructions,
      '--no-session-persistence',
    ];
    if (model && model !== 'default') args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (outputSchema) args.push('--json-schema', JSON.stringify(outputSchema));
    try {
      return await new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error('Arrêt demandé.'));
        const child = launch(binary, args, { cwd: project, subscription: true });
        const toolCalls = new Map();
        let text = '',
          stderr = '',
          final = null,
          done = false,
          cancelError = null;
        const finish = (error) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', cancel);
          error
            ? reject(error)
            : resolve(
                final?.structured_output
                  ? JSON.stringify(final.structured_output)
                  : final?.result || text
              );
        };
        const cancel = () => {
          cancelError = new Error('Arrêt demandé.');
          stopTree(child);
        };
        const timer = setTimeout(
          () => {
            cancelError = new Error('Claude : délai de 20 minutes dépassé.');
            stopTree(child);
          },
          20 * 60 * 1000
        );
        signal.addEventListener('abort', cancel, { once: true });
        readline.createInterface({ input: child.stdout }).on('line', (line) => {
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          const delta =
            event.type === 'stream_event' && event.event?.delta?.type === 'text_delta'
              ? event.event.delta.text
              : null;
          if (delta) {
            text += delta;
            onDelta(delta);
          }
          if (event.type === 'assistant')
            for (const block of event.message?.content || [])
              if (block.type === 'tool_use') {
                onTool(block.name, block.input?.file_path || block.input?.command || '');
                toolCalls.set(block.id, { name: block.name, input: block.input });
              }
          if (event.type === 'user')
            for (const block of event.message?.content || []) {
              const call = toolCalls.get(block.tool_use_id);
              if (block.type === 'tool_result' && call?.name === 'Bash')
                onToolResult({
                  kind: 'command',
                  command: call.input?.command,
                  status: block.is_error ? 'failed' : 'completed',
                  exitCode: null,
                });
            }
          if (event.type === 'result') {
            final = event;
            if (event.usage) {
              const validTokens = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
              const fresh = validTokens(event.usage.input_tokens),
                cached = validTokens(event.usage.cache_read_input_tokens),
                created = validTokens(event.usage.cache_creation_input_tokens);
              onUsage({
                inputTokens: fresh === null ? null : fresh + (cached || 0) + (created || 0),
                outputTokens: validTokens(event.usage.output_tokens),
                cachedInputTokens: cached,
                cacheWriteInputTokens: created,
              });
            }
          }
        });
        child.stderr.on('data', (chunk) => {
          stderr = (stderr + chunk).slice(-8000);
        });
        child.on('error', finish);
        child.on('close', (code) =>
          finish(
            cancelError ||
              (code === 0 && final && !final.is_error
                ? null
                : new Error(final?.result || stderr || `Claude échoué (${code}).`))
          )
        );
        child.stdin.end(prompt);
      });
    } finally {
      bridge?.close();
      if (mcpConfig && fs.existsSync(mcpConfig)) fs.unlinkSync(mcpConfig);
      if (bridgeFolder) fs.rmdirSync(bridgeFolder);
    }
  }
}

function isClaudeSubscription(auth) {
  if (auth.loggedIn !== true || (auth.apiProvider && auth.apiProvider !== 'firstParty'))
    return false;
  if (['claude.ai', 'subscription', 'oauth_token'].includes(auth.authMethod)) return true;
  return (
    auth.authMethod === 'oauth' &&
    ['free', 'pro', 'max', 'team', 'enterprise'].includes(
      String(auth.subscriptionType || '').toLowerCase()
    )
  );
}
async function connections(codex, project) {
  const codexBinary = findBinary('codex'),
    claudeBinary = findBinary('claude'),
    ghBinary = findBinary('gh');
  const [openai, anthropic, github, codexVersion, claudeVersion] = await Promise.allSettled([
    codexBinary
      ? runCommand(codexBinary, ['login', 'status'], { subscription: true, includeStderr: true })
      : Promise.reject(new Error('CLI manquant')),
    claudeBinary
      ? runCommand(claudeBinary, ['auth', 'status'], { subscription: true, cwd: project })
      : Promise.reject(new Error('CLI manquant')),
    ghBinary ? runCommand(ghBinary, ['auth', 'status']) : Promise.reject(new Error('CLI manquant')),
    codexBinary
      ? runCommand(codexBinary, ['--version'], { subscription: true })
      : Promise.reject(new Error('CLI manquant')),
    claudeBinary
      ? runCommand(claudeBinary, ['--version'], { subscription: true })
      : Promise.reject(new Error('CLI manquant')),
  ]);
  let claudeAuth = {};
  if (anthropic.status === 'fulfilled')
    try {
      claudeAuth = JSON.parse(anthropic.value);
    } catch {}
  const status = {
    codex: {
      installed: !!codexBinary,
      connected: openai.status === 'fulfilled' && /ChatGPT/i.test(openai.value),
      command: formatCliCommand('codex', codexBinary, ['login']),
      version: codexVersion.status === 'fulfilled' ? parseVersion(codexVersion.value) : '',
      updateCommand: 'npm install -g @openai/codex@latest',
    },
    claude: {
      installed: !!claudeBinary,
      connected: isClaudeSubscription(claudeAuth),
      command: formatCliCommand('claude', claudeBinary, ['auth', 'login']),
      version: claudeVersion.status === 'fulfilled' ? parseVersion(claudeVersion.value) : '',
      updateCommand: formatCliCommand('claude', claudeBinary, ['update']),
      authMethod: claudeAuth.authMethod || null,
      plan: claudeAuth.subscriptionType || null,
    },
    github: {
      installed: !!ghBinary,
      connected: github.status === 'fulfilled',
      command: 'gh auth login',
    },
  };
  const claudeDiscovery = claudeBinary
    ? discoverClaudeModels({ binary: claudeBinary }).catch((error) => {
        status.claude.catalogError = error.message;
        return [];
      })
    : Promise.resolve([]);
  let models = [];
  if (status.codex.connected) {
    const [modelResult, accountResult] = await Promise.allSettled([
      codex.models(),
      codex.accountInfo(),
    ]);
    if (modelResult.status === 'fulfilled') models = modelResult.value;
    else status.codex.error = modelResult.reason.message;
    if (accountResult.status === 'fulfilled') Object.assign(status.codex, accountResult.value);
  }
  const claudeModels = await claudeDiscovery;
  return {
    connections: status,
    models,
    catalogs: { codex: models, claude: mergeClaudeCatalog(status.claude.version, claudeModels) },
  };
}

module.exports = { CodexProvider, ClaudeProvider, connections, isClaudeSubscription };
