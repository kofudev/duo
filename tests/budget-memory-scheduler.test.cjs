const test = require('node:test');
const assert = require('node:assert/strict');
const { UsageBudget, budgetPatch, cleanLedger, quotaWindows } = require('../electron/budget.cjs');
const {
  createNote,
  selectMemory,
  recentContext,
  checkpoint,
  memoryContext,
} = require('../electron/memory.cjs');
const { Scheduler } = require('../electron/scheduler.cjs');
const { Library } = require('../electron/library.cjs');
const { Orchestrator } = require('../electron/orchestrator.cjs');

function budget(options = {}, ledger = []) {
  const session = { id: 's' };
  let time = 1000000;
  const instance = new UsageBudget(
    session,
    {
      timeLimitEnabled: true,
      durationMinutes: 2,
      maxCalls: 4,
      tokenBudget: 10000,
      callTokenReserve: 3000,
      dailyCalls: 10,
      dailyTokens: 20000,
      ...options,
    },
    ledger,
    { now: () => time }
  );
  return { instance, session, ledger, advance: (ms) => (time += ms) };
}
test('budget validates numeric ranges and modes; no silent unbounded settings', () => {
  assert.throws(() => budgetPatch({ durationMinutes: 0 }), /durationMinutes/);
  assert.throws(() => budgetPatch({ maxCalls: Infinity }), /maxCalls/);
  assert.throws(() => budgetPatch({ quotaPolicy: 'ignore' }), /invalide/);
  assert.equal(budgetPatch({ durationMinutes: '180' }).durationMinutes, 180);
});
test('parallel capacity reserves enough for both agents before spending anything', () => {
  const h = budget({ tokenBudget: 5000 });
  assert.throws(() => h.instance.capacity(2), /simultanées/);
  assert.equal(h.ledger.length, 0);
});
test('usage reservations update monotonically and are released only for completed known calls', () => {
  const h = budget();
  const first = h.instance.reserve('codex'),
    second = h.instance.reserve('claude');
  assert.equal(h.session.budget.chargedTokens, 6000);
  h.instance.observe(first, { inputTokens: 500, outputTokens: 100 });
  h.instance.observe(first, { inputTokens: 500, outputTokens: 100 });
  h.instance.finish(first, true);
  assert.equal(h.session.budget.tokens, 600);
  assert.equal(h.session.budget.chargedTokens, 3600);
  h.instance.finish(second, false);
  assert.equal(second.chargedTokens, 3000);
  assert.equal(h.session.budget.unknownCalls, 1);
  assert.equal(h.instance.daily().tokens, 3600);
});
test('actual usage may exceed reservation; token threshold interrupts and prohibits next call', () => {
  const h = budget({ tokenBudget: 5000 });
  const entry = h.instance.reserve('codex');
  h.instance.observe(entry, { inputTokens: 4800, outputTokens: 700 });
  assert.equal(h.session.budget.tokens, 5500);
  assert.equal(entry.chargedTokens, 5500);
  assert.throws(() => h.instance.reserve('claude'), /Seuil tokens/);
});
test('timebox and rolling-day budgets account for other projects and interrupted usage', () => {
  const h = budget({}, [{ id: 'old', at: 990000, chargedTokens: 19000, usageKnown: false }]);
  assert.throws(() => h.instance.reserve('codex'), /24 h/);
  h.advance(120001);
  assert.throws(() => h.instance.reserve('codex'), /Durée maximale/);
  const clean = cleanLedger([
    { id: 'pending', at: Date.now(), chargedTokens: 6000, state: 'running' },
  ]);
  assert.equal(clean[0].state, 'interrupted');
  assert.equal(clean[0].chargedTokens, 6000);
});
test('quota reserve uses freshest windows; unknown and expired snapshots fail in strict mode', async () => {
  const h = budget({ quotaReserve: 20 });
  await assert.rejects(
    () =>
      h.instance.quota('codex', {
        quota: async () => ({ codex: { primary: { usedPercent: 80, resetsAt: 2000 } } }),
      }),
    /Réserve 20/
  );
  const strict = budget({ quotaPolicy: 'strict' });
  await assert.rejects(() => strict.instance.quota('claude', {}), /Mode strict/);
  await assert.rejects(
    () =>
      strict.instance.quota('codex', {
        quota: async () => ({ primary: { usedPercent: 1, resetsAt: 999 } }),
      }),
    /indisponible/
  );
  assert.equal(quotaWindows({ codex: { primary: { usedPercent: null } } }).length, 0);
});
test('available quota mode records warning, never fabricates remaining Claude usage', async () => {
  const h = budget();
  await h.instance.quota('claude', {});
  await h.instance.quota('claude', {});
  assert.equal(h.session.budget.quotaWarnings.length, 1);
  assert.equal(h.session.budget.quotas, undefined);
});
test('streamed quota updates preserve other windows and stop at reserve during current call', async () => {
  const h = budget();
  await h.instance.quota('codex', {
    quota: async () => ({
      codex: { primary: { usedPercent: 10 }, secondary: { usedPercent: 30 } },
    }),
  });
  h.instance.observeQuota('codex', { limitId: 'codex', primary: { usedPercent: 83 } });
  assert.equal(h.session.budget.quotas.codex.windows.length, 2);
  assert.equal(h.instance.stopReason.code, 'quota-reserve');
  assert.throws(() => h.instance.reserve('codex'), /pendant appel/);
});
test('memory picks relevant tagged notes and pinned constraints within hard context bounds', () => {
  const notes = [
    createNote({ title: 'Auth', text: 'JWT refresh in auth.ts', tags: 'auth, login' }),
    createNote({ title: 'Palette', text: 'Green colors', tags: 'design' }),
    createNote({ title: 'Important constraint', text: 'No database migration', pinned: true }),
  ];
  const selected = selectMemory(notes, 'fix login auth');
  assert.equal(selected.length, 2);
  assert.equal(selected[0].pinned, true);
  assert.ok(!selected.some((note) => note.title === 'Palette'));
  assert.equal(selectMemory(notes, 'auth', { maxChars: 50 }).length, 0);
  assert.equal(memoryContext(notes, 'auth').total, 3);
});
test('memory marks stale notes, validates size, and retains manual notes during checkpoint recycling', () => {
  assert.throws(() => createNote({ title: 'x', text: 'x'.repeat(1601) }), /1600/);
  const note = createNote({ title: 'Auth', text: 'jwt' });
  note.updatedAt = Date.now() - 31 * 86400000;
  assert.equal(selectMemory([note], 'jwt')[0].stale, true);
  const project = {
    memory: Array.from({ length: 199 }, (_, index) =>
      createNote({ title: String(index), text: 'manual' })
    ),
  };
  project.memory.push({ ...note, id: 'old', kind: 'checkpoint' });
  checkpoint(project, {
    id: 's',
    title: 'Feature',
    messages: [{ agent: 'user', text: 'auth change' }],
    state: 'paused',
    tasks: [
      { title: 'Login', status: 'done', files: ['auth.ts'] },
      { title: 'Review', status: 'attention', files: ['ui.ts'] },
    ],
  });
  assert.equal(project.memory.length, 200);
  assert.equal(project.memory.filter((note) => note.kind === 'note').length, 199);
  assert.ok(project.memory.at(-1).text.includes('pas preuve tests'));
  assert.ok(project.memory.at(-1).text.includes('Review (attention)'));
});
test('recent context is bounded, keeps latest history, excludes current user prompt duplication', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    agent: 'codex',
    text: String(index) + 'x'.repeat(5000),
  }));
  messages.push({ agent: 'user', text: 'CURRENT' });
  const context = recentContext(messages);
  assert.ok(context.length <= 7000);
  assert.ok(context.includes('19xxx'));
  assert.ok(!context.includes('CURRENT'));
  assert.ok(!context.includes('0xxx'));
});
function schedulerHarness() {
  let now = 1000000,
    available = true,
    launches = 0;
  const jobs = [];
  const scheduler = new Scheduler(jobs, {
    launch: async () => {
      launches++;
    },
    available: () => available,
    save: () => {},
    notify: () => {},
    now: () => now,
  });
  return {
    scheduler,
    jobs,
    advance: (ms) => (now += ms),
    blocked: () => (available = false),
    ready: () => (available = true),
    launches: () => launches,
    add: (overrides = {}) =>
      scheduler.add({
        prompt: 'Implement',
        dueAt: now + 20000,
        projectId: 'p',
        sessionId: 's',
        config: { durationMinutes: 60 },
        ...overrides,
      }),
  };
}
test('scheduled job launches once, queues behind active work and completes with mission state', async () => {
  const h = schedulerHarness();
  const job = h.add();
  h.advance(22000);
  h.blocked();
  await h.scheduler.tick();
  assert.equal(h.launches(), 0);
  h.ready();
  await Promise.all([h.scheduler.tick(), h.scheduler.tick()]);
  assert.equal(h.launches(), 1);
  assert.equal(job.state, 'running');
  h.scheduler.complete({ id: 's', state: 'paused', stopReason: { message: 'Budget' } });
  assert.equal(job.state, 'paused');
  await h.scheduler.tick();
  assert.equal(h.launches(), 1);
});
test('missed start never launches silently; cancelling excludes pending job', async () => {
  const h = schedulerHarness();
  const missed = h.add();
  h.advance(1000000);
  await h.scheduler.tick();
  assert.equal(missed.state, 'missed');
  assert.equal(h.launches(), 0);
  const cancelled = h.add({ sessionId: 's2' });
  h.scheduler.cancel(cancelled.id);
  h.advance(30000);
  await h.scheduler.tick();
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(h.launches(), 0);
});
test('scheduler reports launch failure and releases dispatching after persistence failure', async () => {
  const h = schedulerHarness();
  const job = h.add();
  h.scheduler.launch = async () => {
    throw new Error('Auth missing');
  };
  h.advance(30000);
  await h.scheduler.tick();
  assert.equal(job.state, 'blocked');
  assert.equal(job.error, 'Auth missing');
  const second = h.add({ sessionId: 's2' });
  h.scheduler.save = () => {
    throw new Error('Disk full');
  };
  h.advance(30000);
  await assert.rejects(() => h.scheduler.tick(), /Disk full/);
  assert.equal(h.scheduler.dispatching, false);
  assert.equal(second.state, 'blocked');
});
test('restart preserves memory, global ledger and planned jobs; interrupted jobs never replay', () => {
  const initial = new Library();
  const workspaceId = initial.data.activeWorkspaceId;
  initial.data.projects.push({
    id: 'p',
    path: process.cwd(),
    workspaceId,
    name: 'App',
    settings: {},
    memory: [createNote({ title: 'Fact', text: 'JWT auth' })],
  });
  initial.data.usageLedger.push({
    id: 'r',
    at: Date.now(),
    chargedTokens: 6000,
    actualTokens: 100,
    state: 'running',
  });
  initial.data.schedules.push(
    { id: 'job', prompt: 'run', state: 'running' },
    { id: 'later', prompt: 'run', state: 'scheduled' }
  );
  const reloaded = new Library(initial.data);
  assert.equal(reloaded.data.projects[0].memory.length, 1);
  assert.equal(reloaded.data.usageLedger[0].state, 'interrupted');
  assert.equal(reloaded.data.schedules[0].state, 'interrupted');
  assert.equal(reloaded.data.schedules[1].state, 'scheduled');
});
function mission(options = {}) {
  const session = { id: 'm', title: 'Mission', messages: [], tasks: [] },
    calls = [],
    ledger = [];
  let complete;
  const done = new Promise((resolve) => (complete = resolve));
  const providers = Object.fromEntries(
    ['codex', 'claude'].map((agent) => [
      agent,
      {
        quota: async () => ({ primary: { usedPercent: 10, resetsAt: Date.now() / 1000 + 3600 } }),
        run: async (args) => {
          calls.push({ agent, ...args });
          args.onUsage({ inputTokens: 100, outputTokens: 20 });
          if (args.prompt.includes('Return ONLY valid JSON'))
            return JSON.stringify({
              tasks: [
                { title: 'Backend', owner: 'codex' },
                { title: 'UI', owner: 'claude' },
              ],
            });
          if (args.prompt.includes('Review actual')) return '{"approved":true}';
          return 'Result';
        },
      },
    ])
  );
  const orchestrator = new Orchestrator(
    providers,
    (event) => {
      if (event.type === 'complete') complete(event.session);
    },
    () => {},
    () => '',
    {
      capture: () => ({ files: [] }),
      changed: () => [],
      text: () => '',
      summary: () => ({ files: [] }),
    },
    { ledger }
  );
  return {
    session,
    providers,
    orchestrator,
    calls,
    ledger,
    done,
    config: {
      project: process.cwd(),
      skills: [],
      mode: 'build',
      rounds: 1,
      collaboration: 'economy',
      ...options,
    },
  };
}
test('economy builds both assigned tasks and mandatory peer reviews in six calls', async () => {
  const h = mission();
  h.orchestrator.start(h.session, 'App', h.config);
  const result = await h.done;
  assert.equal(result.state, 'completed');
  assert.equal(h.calls.length, 6);
  assert.deepEqual(
    h.calls.filter((call) => call.write).map((call) => call.agent),
    ['codex', 'claude']
  );
  assert.equal(result.budget.tokens, 720);
  assert.equal(h.ledger.filter((record) => record.state === 'completed').length, 6);
});
test('budget pause preserves completed task and prevents next writer without extra summary call', async () => {
  const h = mission({ maxCalls: 3 });
  h.orchestrator.start(h.session, 'App', h.config);
  const result = await h.done;
  assert.equal(result.state, 'paused');
  assert.equal(result.tasks[0].status, 'done');
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls.filter((call) => call.write).length, 1);
  assert.equal(result.stopReason.code, 'calls');
  assert.equal(h.orchestrator.active, null);
});
test('quota checks for parallel calls complete before either provider consumes inference', async () => {
  const h = mission({ mode: 'discuss' });
  h.providers.codex.quota = async () => ({ primary: { usedPercent: 95 } });
  h.orchestrator.start(h.session, 'Discuss', h.config);
  const result = await h.done;
  assert.equal(result.state, 'paused');
  assert.equal(h.calls.length, 0);
  assert.equal(result.stopReason.code, 'quota-reserve');
});
test('strict economy preflight blocks whole mission when Claude quota cannot be read', async () => {
  const h = mission({ quotaPolicy: 'strict' });
  delete h.providers.claude.quota;
  h.orchestrator.start(h.session, 'Build', h.config);
  const result = await h.done;
  assert.equal(result.state, 'paused');
  assert.equal(result.budget.calls, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(result.tasks.length, 0);
});
test('deadline cancels both running providers and preserves reservations until they exit', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = mission({ mode: 'discuss', durationMinutes: 1, timeLimitEnabled: true });
  let running = 0,
    exits = 0,
    ready;
  const started = new Promise((resolve) => (ready = resolve));
  for (const provider of Object.values(h.providers))
    provider.run = (options) =>
      new Promise((resolve, reject) => {
        if (++running === 2) ready();
        options.signal.addEventListener(
          'abort',
          () => {
            exits++;
            reject(new Error('Stopped'));
          },
          { once: true }
        );
      });
  h.orchestrator.start(h.session, 'Discuss', h.config);
  await started;
  context.mock.timers.tick(60001);
  const result = await h.done;
  assert.equal(exits, 2);
  assert.equal(result.state, 'paused');
  assert.equal(result.stopReason.code, 'duration');
  assert.equal(h.ledger.filter((record) => record.state === 'interrupted').length, 2);
  assert.equal(result.budget.chargedTokens, 100000);
  assert.equal(h.orchestrator.active, null);
});
