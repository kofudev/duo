const test = require('node:test');
const assert = require('node:assert/strict');
const { CodexProvider } = require('../electron/providers.cjs');
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('Codex full host access applies only to writable phases; reviewers retain read-only sandbox', async () => {
  for (const write of [true, false]) {
    const f = fixture();
    const running = f.provider.run({ ...f.runOptions, write, accessMode: 'full' });
    await tick();
    assert.equal(f.requests[0].params.sandbox, write ? 'danger-full-access' : 'read-only');
    assert.equal(f.requests[0].params.approvalPolicy, 'never');
    f.emit('item/completed', {
      item: { id: 'final', type: 'agentMessage', text: 'Actual report' },
    });
    f.emit('turn/completed', { turn: { status: 'completed' } });
    await running;
  }
});
test('Codex dynamic tool request gets actual scoped callback result and structured turn schema', async () => {
  const f = fixture();
  const schema = { type: 'object', properties: { approved: { type: 'boolean' } } };
  const run = f.provider.run({
    ...f.runOptions,
    outputSchema: schema,
    tools: [
      {
        name: 'duo_team_status',
        description: 'Status',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    onToolCall: async (name, args) => {
      assert.equal(name, 'duo_team_status');
      assert.deepEqual(args, {});
      return { actual: 'shared-board' };
    },
  });
  await tick();
  f.rpc.raw({
    id: 88,
    method: 'item/tool/call',
    params: {
      threadId: 'thread',
      tool: 'duo_team_status',
      arguments: {},
      callId: 'call',
      turnId: 'turn',
    },
  });
  await tick();
  assert.equal(f.requests[0].params.dynamicTools[0].type, 'function');
  assert.deepEqual(
    f.requests.find((entry) => entry.method === 'turn/start').params.outputSchema,
    schema
  );
  assert.equal(JSON.parse(f.replies[0].result.contentItems[0].text).actual, 'shared-board');
  assert.equal(f.replies[0].result.success, true);
  f.emit('item/completed', {
    item: { id: 'final', type: 'agentMessage', phase: 'final_answer', text: '{"approved":true}' },
  });
  f.emit('turn/completed', { turn: { status: 'completed' } });
  await run;
});
function fixture(options = {}) {
  const listeners = new Set(),
    requests = [],
    replies = [],
    controller = new AbortController();
  const rpc = {
    closed: false,
    closing: false,
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'thread' } };
      if (method === 'turn/start') return { turn: { id: 'turn' } };
      return {};
    },
    listen: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send: (reply) => replies.push(reply),
    raw: (message) => {
      for (const fn of listeners) fn(message);
    },
    emit: (method, params) => {
      for (const fn of listeners) fn({ method, params });
    },
    close: async () => {
      rpc.closing = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      rpc.closed = true;
      rpc.emit('$closed', {});
    },
  };
  const provider = new CodexProvider(options);
  provider.connect = async () => rpc;
  const deltas = [],
    usage = [],
    tools = [];
  const runOptions = {
    prompt: 'request',
    instructions: 'Duo instructions',
    project: 'project',
    model: 'model',
    effort: 'high',
    write: true,
    signal: controller.signal,
    onDelta: (d) => deltas.push(d),
    onTool: (...t) => tools.push(t),
    onUsage: (value) => usage.push(value),
  };
  return {
    provider,
    rpc,
    requests,
    replies,
    controller,
    deltas,
    usage,
    tools,
    runOptions,
    emit: (method, params = {}) => rpc.emit(method, { threadId: 'thread', ...params }),
  };
}
test('Codex final item is authoritative, commentary not included in plan JSON, usage preserved', async () => {
  const f = fixture();
  const run = f.provider.run(f.runOptions);
  await tick();
  f.emit('item/agentMessage/delta', { delta: 'Investigating...' });
  f.emit('item/completed', {
    item: { id: 'commentary', type: 'agentMessage', phase: 'commentary', text: 'Investigating...' },
  });
  f.emit('item/agentMessage/delta', { delta: '{"tasks":[]}' });
  f.emit('item/completed', {
    item: {
      id: 'final',
      type: 'agentMessage',
      phase: 'final_answer',
      text: '{"tasks":[{"title":"Actual"}]}',
    },
  });
  f.emit('thread/tokenUsage/updated', {
    tokenUsage: { total: { inputTokens: 20, outputTokens: 12, totalTokens: 32 } },
  });
  f.emit('turn/completed', { turn: { status: 'completed' } });
  assert.equal(await run, '{"tasks":[{"title":"Actual"}]}');
  assert.equal(f.usage[0].totalTokens, 32);
  assert.equal(f.requests[0].params.developerInstructions, 'Duo instructions');
  assert.equal(f.requests[0].params.baseInstructions, undefined);
  assert.equal(f.requests[0].params.modelProvider, 'openai');
  assert.ok(f.requests.some((r) => r.method === 'thread/unsubscribe'));
});
test('Codex ignores other thread events and refuses server permission escalation', async () => {
  const f = fixture();
  const run = f.provider.run(f.runOptions);
  await tick();
  f.rpc.emit('item/agentMessage/delta', { threadId: 'other', delta: 'wrong' });
  f.emit('item/agentMessage/delta', { delta: 'right' });
  // A server request includes id at the top level, not inside params.
  f.rpc.raw({
    id: 7,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread', command: 'outside-project' },
  });
  assert.equal(f.replies[0].id, 7);
  assert.equal(f.replies[0].error.code, -32000);
  assert.equal(f.replies[0].result, undefined);
  assert.deepEqual(f.deltas, ['right']);
  f.emit('item/completed', { item: { id: 'final', type: 'agentMessage', text: 'right' } });
  f.emit('turn/completed', { turn: { status: 'completed' } });
  await run;
  assert.equal(f.requests[0].params.approvalPolicy, 'never');
});
test('Codex user abort waits for interrupted completion before resolving scheduler', async () => {
  const f = fixture({ interruptGraceMs: 1000 });
  let settled = false;
  const run = f.provider.run(f.runOptions);
  const result = assert.rejects(run, /Arrêt demandé/).then(() => {
    settled = true;
  });
  await tick();
  f.controller.abort();
  await tick();
  assert.equal(settled, false);
  assert.ok(f.requests.some((r) => r.method === 'turn/interrupt'));
  f.emit('turn/completed', { turn: { status: 'interrupted' } });
  await result;
});
test('Codex timeout retains lock until subprocess has actually closed', async () => {
  const f = fixture({ turnTimeoutMs: 5, interruptGraceMs: 5 });
  let settled = false;
  let confirmClosed;
  const closed = new Promise((resolve) => {
    confirmClosed = resolve;
  });
  let confirmClosing;
  const closing = new Promise((resolve) => {
    confirmClosing = resolve;
  });
  f.rpc.close = async () => {
    f.rpc.closing = true;
    confirmClosing();
    await closed;
    f.rpc.closed = true;
    f.rpc.emit('$closed', {});
  };
  const run = f.provider.run(f.runOptions);
  const result = assert.rejects(run, /délai/).then(() => {
    settled = true;
  });
  await closing;
  assert.equal(f.rpc.closing, true);
  assert.equal(settled, false);
  confirmClosed();
  await result;
  assert.equal(f.rpc.closed, true);
});

test('abort after thread creation releases subscription without starting turn', async () => {
  const f = fixture(),
    request = f.rpc.request;
  f.rpc.request = async (method, params) => {
    const result = await request(method, params);
    if (method === 'thread/start') f.controller.abort();
    return result;
  };
  await assert.rejects(f.provider.run(f.runOptions), /Arrêt demandé/);
  assert.ok(f.requests.some((r) => r.method === 'thread/unsubscribe'));
  assert.ok(!f.requests.some((r) => r.method === 'turn/start'));
});
test('quota notifications without thread id reach budget observer during running turn', async () => {
  const f = fixture(),
    quotas = [];
  const run = f.provider.run({ ...f.runOptions, onQuota: (value) => quotas.push(value) });
  await tick();
  const limits = { limitId: 'codex', primary: { usedPercent: 85, resetsAt: 2000000000 } };
  f.rpc.emit('account/rateLimits/updated', { rateLimits: limits });
  assert.deepEqual(quotas, [limits]);
  f.emit('item/completed', { item: { id: 'final', type: 'agentMessage', text: 'Done' } });
  f.emit('turn/completed', { turn: { status: 'completed' } });
  assert.equal(await run, 'Done');
});
