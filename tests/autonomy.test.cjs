const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Orchestrator } = require('../electron/orchestrator.cjs');
const { runValidation } = require('../electron/validation.cjs');
const { formatSession } = require('../electron/export.cjs');
function fixture({ writer, review, checker, beforeWrite, planner, config = {} } = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-autonomy-'));
  fs.writeFileSync(
    path.join(project, 'check.cjs'),
    'const fs=require("node:fs"); if(fs.readFileSync("result.txt","utf8")!=="good"){ console.error("expected good");process.exit(3); } console.log("verified result");'
  );
  const session = { id: project, messages: [], tasks: [], state: 'idle' },
    calls = [],
    events = [];
  let complete,
    writes = 0,
    reviews = 0;
  const providers = Object.fromEntries(
    ['codex', 'claude'].map((agent) => [
      agent,
      {
        run: async (options) => {
          calls.push({ agent, ...options });
          options.onUsage({ inputTokens: 100, outputTokens: 20 });
          if (options.outputSchema?.properties.tasks && planner)
            return planner(calls.filter((entry) => entry.outputSchema?.properties.tasks).length);
          if (options.outputSchema?.properties.tasks)
            return JSON.stringify({
              tasks: [
                {
                  title: 'Implement result',
                  owner: 'codex',
                  files: ['result.txt'],
                  acceptance: 'Result must be good.',
                },
              ],
            });
          if (options.write) {
            writes++;
            await beforeWrite?.(options, writes, project);
            fs.writeFileSync(
              path.join(project, 'result.txt'),
              writer ? writer(writes) : writes > 1 ? 'good' : 'bad'
            );
            return 'Implementer claims success';
          }
          if (options.outputSchema)
            return JSON.stringify({
              approved: review ? review(++reviews) : true,
              summary: 'Peer review',
              issues: ['Keep original acceptance criteria.'],
            });
          return 'Other report';
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
    { ledger: [], validate: checker || runValidation }
  );
  const settings = {
    project,
    mode: 'build',
    collaboration: 'economy',
    rounds: 1,
    skills: [],
    accessMode: 'full',
    validationMode: 'manual',
    validationCommands: ['node check.cjs'],
    maxFixCycles: 2,
    ...config,
  };
  return {
    project,
    session,
    calls,
    events,
    orchestrator,
    settings,
    start: (prompt = 'Create result', values = {}) =>
      new Promise((resolve) => {
        complete = resolve;
        orchestrator.start(session, prompt, { ...settings, ...values });
      }),
  };
}
test('real failed check creates a repair, peer reviews it and actual rerun passes', async () => {
  const h = fixture();
  await h.start();
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.validation.state, 'passed');
  assert.equal(h.session.validation.repairs, 1);
  assert.deepEqual(
    h.session.results.filter((entry) => entry.executor === 'duo').map((entry) => entry.exitCode),
    [3, 0]
  );
  assert.equal(h.calls.length, 5);
  assert.equal(h.calls.filter((entry) => entry.write).length, 2);
  assert.equal(h.calls.filter((entry) => entry.outputSchema?.properties.approved).length, 2);
  assert.match(h.calls.find((entry) => entry.write).instructions, /FULL HOST ACCESS/);
  assert.match(h.calls.find((entry) => entry.write).instructions, /do not use direct SSH/);
  assert.match(h.calls.find((entry) => entry.write).instructions, /Non-SSH publication/);
  assert.ok(
    h.calls
      .filter((entry) => !entry.write)
      .every((entry) => !entry.instructions.includes('FULL HOST ACCESS explicitly'))
  );
  assert.match(h.calls.filter((entry) => entry.write).at(-1).prompt, /expected good/);
  assert.match(formatSession(h.session), /code 3/);
  assert.match(formatSession(h.session), /verified result/);
});
test('persistent failure stops after bounded repairs, despite success claims and approving peers', async () => {
  const h = fixture({ writer: () => 'bad' });
  await h.start();
  assert.equal(h.session.state, 'attention');
  assert.equal(h.session.validation.state, 'failed');
  assert.equal(h.session.validation.repairs, 2);
  assert.equal(h.calls.filter((entry) => entry.write).length, 3);
  assert.equal(h.session.results.length, 3);
  assert.ok(!h.session.messages.some((message) => message.phase === 'Bilan observé'));
});
test('partner rejection gets two corrections with fresh reviews before completion', async () => {
  const h = fixture({
    writer: () => 'good',
    review: (count) => count > 2,
    config: { validationMode: 'off' },
  });
  await h.start();
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.tasks[0].corrections, 2);
  assert.equal(h.calls.filter((entry) => entry.outputSchema?.properties.approved).length, 3);
});
test('reviewed mission resumes local validation, without repeating done writers or known successful checks', async () => {
  const h = fixture({ writer: () => 'good' });
  await h.start();
  const calls = h.calls.length,
    results = h.session.results.length;
  h.session.state = 'paused';
  await h.start('CONTINUE');
  assert.equal(h.session.state, 'completed');
  assert.equal(h.calls.length, calls);
  assert.equal(h.session.results.length, results);
  h.session.state = 'paused';
  fs.writeFileSync(path.join(h.project, 'result.txt'), 'external change');
  await h.start('CONTINUE', { maxFixCycles: 0 });
  assert.equal(h.session.state, 'attention');
  assert.equal(h.session.validation.state, 'failed');
  assert.equal(h.session.results.at(-1).exitCode, 3);
});
test('validators changing source require partner review even with code zero', async () => {
  let checks = 0;
  const h = fixture({
    writer: () => 'good',
    checker: async (project) => {
      if (!checks++) fs.writeFileSync(path.join(project, 'result.txt'), 'formatted good');
      return { exitCode: 0, status: 'completed', stdout: 'formatted', stderr: '' };
    },
  });
  await h.start();
  assert.equal(h.session.state, 'completed');
  assert.equal(h.calls.filter((entry) => entry.write).length, 1);
  assert.equal(h.calls.filter((entry) => entry.outputSchema?.properties.approved).length, 2);
  assert.equal(h.session.tasks.at(-1).checkpoint, 'done');
});
test('disabled command permissions produce no execution and explicit non-validation status', async () => {
  const h = fixture({
    writer: () => 'good',
    config: { accessMode: 'project', commands: false },
    checker: () => {
      throw new Error('Must not execute');
    },
  });
  await h.start();
  assert.equal(h.session.validation.state, 'not_run');
  assert.equal(h.session.results.length, 0);
  assert.match(h.session.messages.at(-1).text, /Commandes désactivées/);
});
test('agents add actual checks in auto mode but cannot remove them or register during review', async () => {
  const h = fixture({
    config: { validationMode: 'auto' },
    beforeWrite: async (options) => {
      const added = await options.onToolCall('duo_add_validation', {
        commands: ['node check.cjs'],
      });
      assert.deepEqual(added.commands, ['node check.cjs']);
      await assert.rejects(options.onToolCall('duo_add_validation', { commands: [] }), /commandes/);
    },
  });
  await h.start();
  assert.equal(h.session.validation.state, 'passed');
  assert.equal(h.session.validation.repairs, 1);
  assert.deepEqual(h.session.progress.extraValidationCommands, ['node check.cjs']);
  assert.ok(
    h.calls
      .filter((entry) => !entry.write)
      .every((entry) => !entry.tools.some((tool) => tool.name === 'duo_add_validation'))
  );
});
test('removing detected npm script still leaves mandatory command and observed failure', async () => {
  const h = fixture({
    writer: () => 'good',
    config: { validationMode: 'auto', maxFixCycles: 0 },
    beforeWrite: async (_options, _writes, project) => {
      fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: {} }));
    },
  });
  fs.writeFileSync(
    path.join(h.project, 'package.json'),
    JSON.stringify({ scripts: { test: 'node check.cjs' } })
  );
  await h.start();
  assert.equal(h.session.state, 'attention');
  assert.deepEqual(h.session.validation.commands, ['npm run test']);
  assert.equal(h.session.results[0].status, 'failed');
  assert.notEqual(h.session.results[0].exitCode, 0);
});
test('repair waits for capacity for both writer and peer, then resumes same repair after budget increase', async () => {
  const h = fixture();
  await h.start('Create result', { maxCalls: 4 });
  assert.equal(h.session.state, 'paused');
  assert.equal(h.calls.length, 3);
  const repairId = h.session.tasks.at(-1).id;
  await h.start('CONTINUE', { maxCalls: 8 });
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.validation.state, 'passed');
  assert.equal(h.session.tasks.at(-1).id, repairId);
  assert.equal(h.calls.length, 5);
});
test('new clarification after already reviewed work appends a plan rather than repeating an old summary', async () => {
  const h = fixture({
    writer: () => 'good',
    config: { validationMode: 'off' },
    planner: (count) =>
      JSON.stringify({
        tasks: [
          {
            title: count === 1 ? 'Initial work' : 'Additional requested work',
            owner: count === 1 ? 'codex' : 'claude',
            files: ['result.txt'],
          },
        ],
      }),
  });
  await h.start();
  const firstId = h.session.tasks[0].id;
  h.session.state = 'paused';
  await h.start('Add the next requested change');
  assert.equal(h.session.state, 'completed');
  assert.equal(h.session.tasks.length, 2);
  assert.equal(h.session.tasks[0].id, firstId);
  assert.equal(h.session.tasks[1].title, 'Additional requested work');
  assert.equal(h.calls.filter((entry) => entry.write).length, 2);
  assert.match(
    h.calls.filter((entry) => entry.outputSchema?.properties.tasks).at(-1).prompt,
    /Plan only additional work/
  );
});
