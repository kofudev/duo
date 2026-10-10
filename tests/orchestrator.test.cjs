const test = require('node:test');
const assert = require('node:assert/strict');
const { Orchestrator, extractJson, normalizeTasks } = require('../electron/orchestrator.cjs');
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

function harness(
  run,
  evidence = {
    capture: () => ({ files: [] }),
    changed: () => [],
    text: () => '',
    summary: () => ({ files: [] }),
  }
) {
  const calls = [],
    events = [];
  let complete;
  const done = new Promise((resolve) => {
    complete = resolve;
  });
  const providers = Object.fromEntries(
    ['codex', 'claude'].map((agent) => [
      agent,
      {
        run: async (options) => {
          calls.push({ agent, ...options });
          return run(agent, options);
        },
      },
    ])
  );
  const session = { id: 's', messages: [], tasks: [], state: 'idle' };
  const orchestrator = new Orchestrator(
    providers,
    (event) => {
      events.push(event);
      if (event.type === 'complete') complete(event.session);
    },
    () => {},
    () => 'Use concise French.',
    evidence
  );
  return {
    orchestrator,
    session,
    calls,
    events,
    done,
    config: { project: 'project', rounds: 1, mode: 'discuss', skills: [] },
  };
}
test('extract fenced plans and reject incomplete task assignment', () => {
  assert.deepEqual(extractJson('```json\n{"tasks":[]}\n```'), { tasks: [] });
  assert.equal(extractJson('No JSON here'), null);
  assert.throws(
    () => normalizeTasks({ tasks: [{ title: 'Implement', owner: 'unknown' }] }),
    /Plan invalide/
  );
  assert.throws(() => normalizeTasks({ tasks: [] }), /structuré invalide/);
  assert.throws(
    () =>
      normalizeTasks({
        tasks: Array.from({ length: 9 }, () => ({ title: 'Task', owner: 'codex' })),
      }),
    /plus de 8/
  );
  assert.throws(
    () => normalizeTasks({ tasks: [{ title: 'Task', owner: 'codex', files: ['../outside'] }] }),
    /relatifs/
  );
});
test('two parallel proposals, reciprocal discussion, read-only synthesis', async () => {
  let concurrency = 0,
    peak = 0;
  const h = harness(async (agent, options) => {
    concurrency++;
    peak = Math.max(peak, concurrency);
    await pause();
    concurrency--;
    if (options.prompt.includes('Your prior proposal')) {
      assert.ok(
        options.prompt.includes(
          agent === 'codex' ? 'Claude says: claude proposal' : 'Codex says: codex proposal'
        )
      );
      return `${agent} discussion`;
    }
    return `${agent} proposal`;
  });
  h.orchestrator.start(h.session, 'Create tool', h.config);
  const result = await h.done;
  assert.equal(peak, 2);
  assert.equal(result.state, 'completed');
  assert.equal(h.calls.length, 5);
  assert.ok(h.calls.every((call) => !call.write));
  assert.ok(h.calls.at(-1).prompt.includes('claude discussion'));
});
test('both owners build sequentially, partner verifies actual results', async () => {
  let writers = 0,
    maxWriters = 0;
  const plan = JSON.stringify({
    summary: 'App',
    tasks: [
      { title: 'Backend', owner: 'codex', files: ['server.js'] },
      { title: 'UI', owner: 'claude', files: ['app.jsx'] },
    ],
  });
  const h = harness(async (agent, options) => {
    if (options.write) {
      writers++;
      maxWriters = Math.max(maxWriters, writers);
      await pause();
      writers--;
      return `${agent} implementation`;
    }
    if (options.prompt.includes('Return ONLY valid JSON')) return plan;
    if (options.prompt.includes('Review actual current files')) {
      assert.ok(
        options.prompt.includes(
          agent === 'codex' ? 'claude implementation' : 'codex implementation'
        )
      );
      return '{"approved":true,"summary":"Checked files","issues":[]}';
    }
    return `${agent} proposal`;
  });
  h.orchestrator.start(h.session, 'Build app', { ...h.config, mode: 'build' });
  const result = await h.done;
  assert.equal(maxWriters, 1);
  assert.equal(result.state, 'completed');
  assert.deepEqual(
    h.calls.filter((c) => c.write).map((c) => c.agent),
    ['codex', 'claude']
  );
  assert.ok(result.tasks.every((t) => t.status === 'done'));
});
test('failed re-review stops subsequent task and marks attention', async () => {
  const h = harness(async (agent, options) => {
    if (options.prompt.includes('Return ONLY valid JSON'))
      return JSON.stringify({
        tasks: [
          { title: 'One', owner: 'codex' },
          { title: 'Two', owner: 'claude' },
        ],
      });
    if (options.prompt.includes('Review actual'))
      return '{"approved":false,"summary":"Missing behavior","issues":["Fix bug"]}';
    return 'Report';
  });
  h.orchestrator.start(h.session, 'Build', { ...h.config, mode: 'build' });
  const result = await h.done;
  assert.equal(result.state, 'attention');
  assert.equal(result.tasks[1].status, 'pending');
  assert.equal(h.calls.filter((c) => c.write).length, 2);
});
test('one provider fails: cancel peer and never build', async () => {
  let cancelled = false;
  const h = harness(async (agent, options) => {
    if (agent === 'codex') throw new Error('Quota exhausted');
    return new Promise((resolve, reject) => {
      const abort = () => {
        cancelled = true;
        reject(new Error('Cancelled'));
      };
      options.signal.aborted
        ? abort()
        : options.signal.addEventListener('abort', abort, { once: true });
    });
  });
  h.orchestrator.start(h.session, 'Build', { ...h.config, mode: 'build' });
  const result = await h.done;
  assert.equal(result.state, 'failed');
  assert.equal(cancelled, true);
  assert.ok(result.messages.at(-1).text.includes('Quota exhausted'));
  assert.ok(!h.calls.some((c) => c.write));
});
test('user cancellation keeps stopped state and prevents another phase', async () => {
  const h = harness(
    async (agent, options) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('Arrêt demandé.')), {
          once: true,
        })
      )
  );
  h.orchestrator.start(h.session, 'Discuss', h.config);
  h.orchestrator.stop();
  const result = await h.done;
  assert.equal(result.state, 'stopped');
  assert.equal(h.calls.length, 2);
  assert.equal(h.orchestrator.active, null);
});

test('storage failure stops mission and still releases scheduler with visible error', async () => {
  const h = harness(async () => 'Report');
  let saves = 0;
  h.orchestrator.save = () => {
    if (++saves > 1) throw new Error('Disk full');
  };
  h.orchestrator.start(h.session, 'Discuss', h.config);
  const result = await h.done;
  assert.equal(result.state, 'failed');
  assert.equal(h.orchestrator.active, null);
  assert.equal(result.persistenceError, 'Disk full');
  assert.ok(h.events.some((e) => e.type === 'storage/warning'));
});
test('external edit during approving review stops next task and preserves actual snapshot evidence', async () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const {
    captureReview,
    changedSince,
    evidenceText,
    evidenceSummary,
  } = require('../electron/review-evidence.cjs');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-review-concurrent-'));
  const h = harness(
    async (_agent, options) => {
      if (options.prompt.includes('Return ONLY valid JSON'))
        return JSON.stringify({
          tasks: [
            { title: 'One', owner: 'codex', files: ['one.js'] },
            { title: 'Two', owner: 'claude', files: ['two.js'] },
          ],
        });
      if (options.write) {
        fs.writeFileSync(path.join(project, 'one.js'), 'actual implemented contents');
        return 'Implementer report';
      }
      if (options.prompt.includes('Review actual current files')) {
        assert.ok(options.prompt.includes('actual implemented contents'));
        fs.writeFileSync(path.join(project, 'one.js'), 'external edit while reviewer works');
        return '{"approved":true,"issues":[]}';
      }
      return 'Proposal';
    },
    { capture: captureReview, changed: changedSince, text: evidenceText, summary: evidenceSummary }
  );
  h.orchestrator.start(h.session, 'Build', { ...h.config, project, mode: 'build' });
  const result = await h.done;
  assert.equal(result.state, 'attention');
  assert.equal(result.tasks[0].status, 'attention');
  assert.equal(result.tasks[1].status, 'pending');
  assert.equal(h.calls.filter((call) => call.write).length, 1);
  assert.ok(result.messages.at(-1).text.includes('changés pendant relecture'));
});
test('tool activity survives completed mission and is bounded to recent 500 entries', async () => {
  const h = harness(async (_agent, options) => {
    for (let i = 0; i < 150; i++) options.onTool('Read', `file-${i}.js`);
    return 'Report';
  });
  h.orchestrator.start(h.session, 'Inspect', h.config);
  const result = await h.done;
  assert.equal(result.activity.length, 500);
  assert.ok(
    result.activity.every((entry) => entry.messageId && entry.phase && entry.agent && entry.at)
  );
  assert.equal(h.events.filter((event) => event.type === 'tool').length, 750);
});
