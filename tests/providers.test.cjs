const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const processTools = require('../electron/process.cjs');
let child,
  launchOptions,
  kills = 0;
processTools.findBinary = () => 'fixture-claude';
processTools.launch = (_binary, args, options) => {
  launchOptions = { args, options };
  return child;
};
processTools.stopTree = (target) => {
  kills++;
  setTimeout(() => target.emit('close', 143), 20);
};
const { ClaudeProvider } = require('../electron/providers.cjs');
test('Claude full construction uses bypass with shell and web; reviewers cannot write or execute', async () => {
  for (const write of [true, false]) {
    const f = fixture();
    const running = f.provider.run({ ...f.options, write, accessMode: 'full', commands: false });
    const args = launchOptions.args;
    assert.equal(args[args.indexOf('--permission-mode') + 1], write ? 'bypassPermissions' : 'plan');
    const tools = args[args.indexOf('--tools') + 1].split(',');
    assert.equal(tools.includes('Bash'), write);
    assert.equal(tools.includes('Write'), write);
    assert.equal(tools.includes('WebFetch'), write);
    f.line({ type: 'result', result: 'Actual report' });
    child.emit('close', 0);
    await running;
  }
});
test('Claude scoped MCP config never places bridge token in argv, restricts native tools and removes private config on exit', async () => {
  const fs = require('node:fs');
  const f = fixture();
  const before = launchOptions;
  const result = f.provider.run({
    ...f.options,
    tools: [
      {
        name: 'duo_team_status',
        description: 'Status',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    onToolCall: () => ({ actual: 'board' }),
    outputSchema: { type: 'object', properties: {} },
  });
  for (let i = 0; i < 100 && launchOptions === before; i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  const configPath = launchOptions.args[launchOptions.args.indexOf('--mcp-config') + 1],
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(!launchOptions.args.join(' ').includes(config.mcpServers.duo.env.DUO_TOOL_TOKEN));
  assert.ok(launchOptions.args.includes('mcp__duo__duo_team_status'));
  assert.ok(!launchOptions.args.includes('mcp__*'));
  assert.equal(launchOptions.args[launchOptions.args.indexOf('--permission-mode') + 1], 'default');
  assert.ok(!launchOptions.args.includes('Bash'));
  assert.ok(!launchOptions.args.includes('Write'));
  f.line({ type: 'result', result: 'Natural language', structured_output: { approved: true } });
  child.emit('close', 0);
  assert.deepEqual(JSON.parse(await result), { approved: true });
  assert.equal(fs.existsSync(configPath), false);
});
function fixture() {
  child = new EventEmitter();
  child.pid = 1;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  const signal = new AbortController();
  const deltas = [],
    tools = [],
    usage = [];
  const options = {
    prompt: 'User request',
    instructions: 'Concise French',
    project: 'project',
    model: 'opus',
    effort: 'max',
    write: false,
    signal: signal.signal,
    onDelta: (d) => deltas.push(d),
    onTool: (...t) => tools.push(t),
    onUsage: (value) => usage.push(value),
  };
  return {
    signal,
    deltas,
    tools,
    usage,
    options,
    provider: new ClaudeProvider(),
    line: (data) => child.stdout.write(JSON.stringify(data) + '\n'),
  };
}
test('Claude stream exposes text and tool events; final report remains authoritative', async () => {
  const f = fixture();
  const result = f.provider.run(f.options);
  f.line({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'Hello ' } } });
  f.line({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/file.js' } }] },
  });
  f.line({ type: 'result', is_error: false, result: 'Final report' });
  child.emit('close', 0);
  assert.equal(await result, 'Final report');
  assert.deepEqual(f.deltas, ['Hello ']);
  assert.equal(f.tools[0][0], 'Read');
  assert.equal(launchOptions.options.subscription, true);
  assert.ok(launchOptions.args.includes('plan'));
  assert.ok(!launchOptions.args.includes('Bash'));
  assert.deepEqual(JSON.parse(launchOptions.args[launchOptions.args.indexOf('--settings') + 1]), {
    disableAllHooks: true,
  });
  assert.ok(launchOptions.args.includes('--strict-mcp-config'));
  assert.ok(launchOptions.args.includes('mcp__*'));
});
test('Claude input totals include both cache reads and cache creation without counting output twice', async () => {
  const f = fixture(),
    result = f.provider.run(f.options);
  f.line({
    type: 'result',
    result: 'Complete',
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 20,
    },
  });
  child.emit('close', 0);
  await result;
  assert.deepEqual(f.usage, [
    { inputTokens: 110, outputTokens: 5, cachedInputTokens: 80, cacheWriteInputTokens: 20 },
  ]);
});
test('successful process exit does not hide provider error result', async () => {
  const f = fixture();
  const result = f.provider.run(f.options);
  f.line({ type: 'result', is_error: true, result: 'Subscription quota exceeded' });
  child.emit('close', 0);
  await assert.rejects(result, /quota exceeded/);
});
test('cancelled Claude run waits for child exit before scheduler unlocks', async () => {
  const f = fixture();
  let settled = false;
  const before = kills;
  const result = f.provider.run({ ...f.options, write: true, commands: true });
  const expected = assert.rejects(result, /Arrêt demandé/).then(() => {
    settled = true;
  });
  f.signal.abort();
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(kills, before + 1);
  assert.equal(settled, false);
  await expected;
  assert.equal(settled, true);
  assert.ok(launchOptions.args.includes('Bash'));
});
test('pre-cancelled requests do not launch process', async () => {
  const f = fixture();
  f.signal.abort();
  const previous = launchOptions;
  await assert.rejects(f.provider.run(f.options), /Arrêt demandé/);
  assert.equal(launchOptions, previous);
});
