const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Orchestrator } = require('../electron/orchestrator.cjs');
function fixture(run) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-continuity-'));
  const session = { id: 'mission', state: 'idle', messages: [], tasks: [] },
    calls = [],
    events = [];
  let complete;
  const providers = Object.fromEntries(
    ['codex', 'claude'].map((agent) => [
      agent,
      {
        run: async (options) => {
          calls.push({ agent, ...options });
          options.onUsage({ inputTokens: 1, outputTokens: 1 });
          return run(agent, options, project);
        },
      },
    ])
  );
  const orchestrator = new Orchestrator(
    providers,
    (event) => {
      events.push(event);
      if (event.type === 'complete') complete(event.session);
    },
    () => {},
    () => '',
    undefined,
    { ledger: [] }
  );
  const config = { project, mode: 'build', collaboration: 'economy', rounds: 1, skills: [] };
  return {
    session,
    calls,
    events,
    orchestrator,
    project,
    start: (prompt, overrides = {}) =>
      new Promise((resolve, reject) => {
        complete = resolve;
        try {
          orchestrator.start(session, prompt, { ...config, ...overrides });
        } catch (error) {
          reject(error);
        }
      }),
  };
}
const plan = JSON.stringify({
  summary: 'Two parts',
  tasks: [
    { title: 'One', owner: 'codex', files: ['one.js'] },
    { title: 'Two', owner: 'claude', files: ['two.js'] },
  ],
});
const approved = '{"approved":true,"summary":"actual file read","issues":[]}';
test('cancellation holds mission lock until nested partner consultation actually exits', async () => {
  let childStarted, rootClosed;
  const started = new Promise((resolve) => {
    childStarted = resolve;
  });
  const h = fixture(async (agent, options, project) => {
    if (options.prompt.startsWith('Partner codex asks:')) {
      childStarted();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => setTimeout(() => reject(new Error('Peer closed')), 40),
          { once: true }
        )
      );
    }
    if (agent === 'codex' && options.write) {
      options
        .onToolCall('duo_consult_partner', { question: 'Inspect actual files.' })
        .catch(() => {});
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => {
            rootClosed = true;
            reject(new Error('Parent closed'));
          },
          { once: true }
        )
      );
    }
    return normal(agent, options, project);
  });
  const done = h.start('Feature');
  await started;
  h.orchestrator.stop();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(rootClosed, true);
  assert.ok(h.orchestrator.active);
  await done;
  assert.equal(h.session.state, 'stopped');
  assert.equal(h.orchestrator.active, null);
});
function normal(agent, options, project) {
  if (options.outputSchema?.properties.tasks) return plan;
  if (options.write) {
    const name = agent === 'codex' ? 'one.js' : 'two.js';
    fs.writeFileSync(path.join(project, name), agent);
    return `${name} written`;
  }
  if (options.outputSchema) return approved;
  return 'Observed final summary';
}
test('budget resumption preserves objective, done tasks, real deltas and cumulative call limits', async () => {
  const h = fixture(normal);
  await h.start('Build original feature', { maxCalls: 3 });
  assert.equal(h.session.state, 'paused');
  assert.equal(h.session.tasks[0].status, 'done');
  const doneId = h.session.tasks[0].id;
  await h.start('CONTINUE', { maxCalls: 8 });
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.progress.objective, 'Build original feature');
  assert.equal(h.session.tasks[0].id, doneId);
  assert.equal(h.calls.filter((call) => call.outputSchema?.properties.tasks).length, 1);
  assert.deepEqual(
    h.calls.filter((call) => call.write).map((call) => call.agent),
    ['codex', 'claude']
  );
  assert.equal(h.session.budget.calls, 5);
  assert.equal(h.session.metrics.calls, 5);
  assert.deepEqual(h.session.recap.changes.map((file) => [file.path, file.kind]).sort(), [
    ['one.js', 'created'],
    ['two.js', 'created'],
  ]);
  await h.start('CONTINUE');
  assert.equal(h.calls.length, 5);
});
test('missing user input stops before construction; CONTINUE spends zero; answer preserves original goal', async () => {
  let answered = false;
  const h = fixture((agent, options, project) => {
    if (options.outputSchema?.properties.tasks && !answered)
      return '{"status":"waiting_user","question":"Quel dossier contient sources existantes ?","options":["Je choisis dossier existant"]}';
    if (options.outputSchema?.properties.tasks)
      assert.ok(
        options.prompt.includes('ORIGINAL OBJECTIVE') &&
          options.prompt.includes('Sources corrigées')
      );
    return normal(agent, options, project);
  });
  await h.start('ORIGINAL OBJECTIVE');
  assert.equal(h.session.state, 'waiting_user');
  assert.equal(h.calls.length, 1);
  assert.equal(h.session.tasks.length, 0);
  await h.start('CONTINUE');
  await h.start('continue');
  assert.equal(h.calls.length, 1);
  answered = true;
  await h.start('Sources corrigées : travailler dossier sélectionné.');
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.waiting, null);
  assert.equal(h.session.progress.objective, 'ORIGINAL OBJECTIVE');
});
test('interrupted review resumes review without replaying writer or completed task', async () => {
  let interrupt = true,
    h;
  h = fixture(async (agent, options, project) => {
    if (options.outputSchema && !options.outputSchema.properties.tasks && interrupt) {
      interrupt = false;
      h.orchestrator.stop();
      throw new Error('Interrupted reviewer');
    }
    return normal(agent, options, project);
  });
  await h.start('Implement');
  assert.equal(h.session.state, 'stopped');
  assert.equal(h.session.tasks[0].checkpoint, 'review');
  await h.start('CONTINUE');
  assert.equal(h.session.state, 'completed');
  assert.equal(h.calls.filter((call) => call.write && call.agent === 'codex').length, 1);
});
test('real consultation dispatches partner read-only, returns actual inspection, prevents recursion', async () => {
  const h = fixture(async (agent, options, project) => {
    if (options.prompt.startsWith('Partner codex asks:')) {
      assert.equal(agent, 'claude');
      assert.equal(options.write, false);
      await assert.rejects(
        options.onToolCall('duo_consult_partner', { question: 'Loop?' }),
        /récursive/
      );
      return `Read actual one.js: ${fs.readFileSync(path.join(project, 'one.js'), 'utf8')}`;
    }
    if (agent === 'codex' && options.write) {
      fs.writeFileSync(path.join(project, 'one.js'), 'actual-partner-canary');
      const answer = await options.onToolCall('duo_consult_partner', {
        question: 'Lire one.js et vérifier contrat.',
      });
      assert.equal(answer.partner, 'claude');
      assert.ok(answer.answer.includes('actual-partner-canary'));
      const board = await options.onToolCall('duo_team_status', {});
      assert.ok(
        board.recentMessages.some(
          (message) => message.agent === 'claude' && message.text.includes('actual-partner-canary')
        )
      );
      return 'Implemented with peer inspection';
    }
    return normal(agent, options, project);
  });
  await h.start('Collaborate');
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.budget.calls, 6);
  assert.ok(h.events.some((event) => event.message?.phase === 'Question → Claude'));
  assert.ok(h.events.some((event) => event.message?.phase === 'Réponse → Codex'));
});
test('review user blocker never triggers correction or next writer', async () => {
  const h = fixture((agent, options, project) =>
    options.outputSchema && !options.outputSchema.properties.tasks
      ? '{"status":"waiting_user","question":"Confirmer périmètre demandé ?","options":[]}'
      : normal(agent, options, project)
  );
  await h.start('Feature');
  assert.equal(h.session.state, 'waiting_user');
  assert.equal(h.calls.filter((call) => call.write).length, 1);
  assert.equal(h.session.tasks[1].status, 'pending');
  assert.equal(h.session.tasks[0].checkpoint, 'review');
});
test('legacy partial plan preserves done work, inspects partial task before correction and marks resume baseline', async () => {
  const h = fixture((agent, options, project) => {
    assert.ok(options.prompt.includes('ORIGINAL LEGACY GOAL'));
    if (
      options.outputSchema &&
      !options.outputSchema.properties.tasks &&
      !fs.existsSync(path.join(project, 'two.js'))
    )
      return '{"approved":false,"summary":"two.js missing","issues":["create two.js"]}';
    return normal(agent, options, project);
  });
  h.session.state = 'stopped';
  h.session.config = { mode: 'build' };
  h.session.messages = [
    { agent: 'user', text: 'ORIGINAL LEGACY GOAL' },
    { agent: 'user', text: 'Keep first part.' },
  ];
  h.session.tasks = [
    { id: 'old-one', title: 'One', owner: 'codex', files: ['one.js'], status: 'done' },
    { id: 'old-two', title: 'Two', owner: 'claude', files: ['two.js'], status: 'review' },
  ];
  fs.writeFileSync(path.join(h.project, 'one.js'), 'original completed work');
  await h.start('CONTINUE');
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.tasks[0].id, 'old-one');
  assert.equal(fs.readFileSync(path.join(h.project, 'one.js'), 'utf8'), 'original completed work');
  assert.equal(h.calls.filter((call) => call.outputSchema?.properties.tasks).length, 0);
  assert.deepEqual(
    h.calls.filter((call) => call.write).map((call) => call.agent),
    ['claude']
  );
  assert.equal(h.calls[0].write, false);
  assert.equal(h.session.recap.basis, 'resume');
  assert.deepEqual(
    h.session.recap.changes.map((file) => file.path),
    ['two.js']
  );
});
test('legacy completed conversation blocks redundant continue but allows explicit discussion to construction', async () => {
  const h = fixture(normal);
  h.session.state = 'completed';
  h.session.config = { mode: 'discuss' };
  h.session.messages = [{ agent: 'user', text: 'Build from discussion' }];
  await h.start('CONTINUE', { mode: 'discuss' });
  assert.equal(h.calls.length, 0);
  await h.start('CONTINUE', { mode: 'build' });
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.progress.objective, 'Build from discussion');
  assert.equal(h.session.config.mode, 'build');
  assert.equal(h.calls.filter((call) => call.write).length, 2);
});
test('compact build handoff preserves objective and criteria without replaying long reports or adding synthesis', async () => {
  let memoryQuery;
  const h = fixture((agent, options, project) => {
    if (options.outputSchema?.properties.tasks)
      return JSON.stringify({
        tasks: [
          { title: 'One', owner: 'codex', files: ['one.js'], acceptance: 'CRITICAL_CONTRACT' },
          { title: 'Two', owner: 'claude', files: ['two.js'], acceptance: 'CRITICAL_CONTRACT' },
        ],
      });
    if (options.write) {
      fs.writeFileSync(path.join(project, agent === 'codex' ? 'one.js' : 'two.js'), agent);
      return 'Long implementation details. '.repeat(1000) + 'VALIDATION_PENDING_EXTERNAL_TEST';
    }
    return approved;
  });
  h.orchestrator.services.memory = (_config, query) => {
    memoryQuery = query;
    return { text: '', selectedIds: [], total: 0 };
  };
  await h.start('PRESERVE_ORIGINAL_GOAL');
  const second = h.calls.find((call) => call.write && call.agent === 'claude');
  assert.ok(
    second.prompt.includes('PRESERVE_ORIGINAL_GOAL') && second.prompt.includes('CRITICAL_CONTRACT')
  );
  assert.ok(second.prompt.length < 7000);
  assert.ok(second.prompt.includes('VALIDATION_PENDING_EXTERNAL_TEST'));
  assert.ok(!second.prompt.includes('Long implementation details. '.repeat(30)));
  assert.ok(
    h.calls
      .filter((call) => call.outputSchema && !call.outputSchema.properties.tasks)
      .every((call) => call.prompt.includes('CRITICAL_CONTRACT'))
  );
  assert.equal(h.calls.length, 5);
  assert.equal(memoryQuery, 'PRESERVE_ORIGINAL_GOAL\n');
  assert.equal(h.session.efficiency.summaryCallsAvoided, 1);
});
test('already-reviewed persisted work assembles local summary even when provider quota is unavailable', async () => {
  const h = fixture(() => {
    throw new Error('No new inference allowed');
  });
  let quotaRequests = 0;
  for (const provider of Object.values(h.orchestrator.providers))
    provider.quota = async () => {
      quotaRequests++;
      return null;
    };
  h.session.state = 'paused';
  h.session.progress = {
    objective: 'Already finished',
    mode: 'build',
    stage: 'summary',
    updates: [],
  };
  h.session.tasks = [
    {
      id: 'finished',
      title: 'Done',
      owner: 'codex',
      files: [],
      status: 'done',
      checkpoint: 'done',
      report: 'Actual old work',
      review: approved,
    },
  ];
  h.session.budget = { calls: 3, tokens: 1000, chargedTokens: 1000 };
  await h.start('CONTINUE', { quotaPolicy: 'strict', maxCalls: 3 });
  assert.equal(h.session.state, 'completed');
  assert.equal(h.calls.length, 0);
  assert.equal(quotaRequests, 0);
  assert.equal(h.session.budget.calls, 3);
  assert.equal(h.session.efficiency.summaryCallsAvoided, 1);
});
