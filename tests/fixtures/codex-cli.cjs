const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const { log, report } = require('./ai-runtime.cjs');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('codex-cli 0.162.0');
  process.exit(0);
}
if (args[0] === 'login') {
  console.error('Logged in using ChatGPT (LOCAL FIXTURE)');
  process.exit(0);
}
const threads = new Map();
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const notify = (method, params) => send({ method, params });
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params = {} } = request;
  if (id === undefined) return;
  const reply = (result) => send({ id, result });
  if (method === 'initialize') return reply({ userAgent: 'Duo local protocol fixture' });
  if (method === 'model/list')
    return reply({
      data: [
        {
          model: 'fixture-codex',
          displayName: 'Codex · simulation locale',
          isDefault: true,
          hidden: false,
          defaultReasoningEffort: 'high',
          supportedReasoningEfforts: ['low', 'high', 'max', 'ultra'].map((reasoningEffort) => ({
            reasoningEffort,
          })),
          inputModalities: ['text'],
        },
      ],
      nextCursor: null,
    });
  if (method === 'account/read')
    return reply({ account: { type: 'chatgpt', planType: 'fixture' } });
  if (method === 'account/rateLimits/read')
    return reply({
      rateLimitsByLimitId: {
        codex: {
          primary: {
            usedPercent: 12,
            windowDurationMins: 300,
            resetsAt: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      },
    });
  if (method === 'thread/start') {
    const threadId = randomUUID();
    threads.set(threadId, params);
    log({
      event: 'permissions',
      agent: 'codex',
      sandbox: params.sandbox,
      retainsBaseInstructions: !params.baseInstructions,
      hasSkills: params.developerInstructions.includes('SKILL'),
    });
    return reply({ thread: { id: threadId } });
  }
  if (method === 'thread/unsubscribe') {
    threads.delete(params.threadId);
    return reply({});
  }
  if (method === 'turn/interrupt') {
    log({ event: 'interrupt', agent: 'codex' });
    reply({});
    return setTimeout(
      () =>
        notify('turn/completed', {
          threadId: params.threadId,
          turn: { id: params.turnId, status: 'interrupted' },
        }),
      170
    );
  }
  if (method !== 'turn/start')
    return send({ id, error: { code: -32601, message: 'Unsupported fixture method ' + method } });
  const turnId = randomUUID(),
    threadId = params.threadId,
    config = threads.get(threadId),
    prompt = params.input[0].text;
  reply({ turn: { id: turnId } });
  notify('turn/started', { threadId, turn: { id: turnId } });
  if (prompt.includes('MOCK_CANCEL')) {
    log({ event: 'waiting', agent: 'codex' });
    return;
  }
  try {
    const text = await report(
      'codex',
      prompt,
      path.resolve(config.cwd),
      config.sandbox === 'workspace-write',
      (name, file) =>
        notify('item/started', {
          threadId,
          item: {
            id: randomUUID(),
            type: name === 'Write' ? 'fileChange' : 'commandExecution',
            command: `${name} ${file}`,
          },
        })
    );
    notify('item/agentMessage/delta', { threadId, delta: text.slice(0, 40) });
    notify('item/agentMessage/delta', { threadId, delta: text.slice(40) });
    notify('item/completed', {
      threadId,
      item: { id: randomUUID(), type: 'agentMessage', phase: 'final_answer', text },
    });
    notify('thread/tokenUsage/updated', {
      threadId,
      tokenUsage: {
        total: { inputTokens: 110, outputTokens: 45, cachedInputTokens: 10, totalTokens: 155 },
      },
    });
    notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
  } catch (error) {
    notify('turn/completed', {
      threadId,
      turn: { id: turnId, status: 'failed', error: { message: error.message } },
    });
  }
});
