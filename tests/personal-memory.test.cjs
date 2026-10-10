const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const {
  previewMemory,
  mergeMemory,
  exportMemory,
  readMemoryImport,
} = require('../electron/memory-transfer.cjs');
const { createNote, sharedMemoryContext } = require('../electron/memory.cjs');
const { UsageBudget, BUDGET_DEFAULTS, budgetPatch } = require('../electron/budget.cjs');
const { Library } = require('../electron/library.cjs');
const { JsonStore } = require('../electron/storage.cjs');
const { Orchestrator } = require('../electron/orchestrator.cjs');

test('pasted dated memories are text; preview keeps contents and splits within note bounds', () => {
  const value = '[2026-10-10] - Répondre en français.\n\n' + 'Architecture utile. '.repeat(180);
  const result = previewMemory(value, 'chatgpt');
  assert.ok(result.notes.length >= 3);
  assert.ok(result.notes.every((note) => note.text.length <= 1600));
  assert.equal(result.notes[0].text, '[2026-10-10] - Répondre en français.');
  assert.ok(result.notes.every((note) => !note.pinned));
});
test('preview and import remove duplicate memories without overwriting existing notes', () => {
  const result = previewMemory('Français concis.\n\nfrançais   concis.', 'claude');
  assert.equal(result.notes.length, 1);
  assert.equal(result.duplicates, 1);
  const existing = [createNote({ title: 'Préférence', text: 'Français concis.', pinned: true })];
  const merged = mergeMemory(existing, result.notes, 'claude');
  assert.equal(merged.added, 0);
  assert.equal(merged.duplicates, 1);
  assert.equal(merged.notes[0].id, existing[0].id);
  assert.equal(merged.notes[0].pinned, true);
});
test('JSON export round-trips actual memory without importing chat archives or unknown versions', () => {
  const original = [
    createNote({ title: 'Profil', text: 'React + TypeScript', tags: ['react'], pinned: true }),
  ];
  const text = exportMemory(original, 'personal');
  const preview = previewMemory(text, 'duo');
  assert.equal(preview.notes[0].text, original[0].text);
  assert.deepEqual(preview.notes[0].tags, ['react']);
  assert.equal(preview.notes[0].pinned, true);
  assert.throws(() => previewMemory('{"conversations":[]}', 'chatgpt'), /conversations/);
  assert.throws(
    () => previewMemory('{"format":"duo-memory","version":2,"notes":[]}', 'duo'),
    /Version/
  );
});
test('invalid or oversized import is rejected atomically; text and selected entries are revalidated', () => {
  const existing = [createNote({ title: 'Keep', text: 'Retain' })];
  assert.throws(
    () =>
      mergeMemory(existing, [
        { title: 'New', text: 'Valid' },
        { title: 'Bad', text: '' },
      ]),
    /Note/
  );
  assert.equal(existing.length, 1);
  assert.throws(() => previewMemory('x'.repeat(320001)), /320 000/);
  assert.throws(
    () => mergeMemory(existing, [{ title: 'New', text: 'Valid' }], 'invalid'),
    /invalide/
  );
  const many = Array.from({ length: 200 }, (_, index) =>
    createNote({ title: String(index), text: 'Unique ' + index })
  );
  assert.throws(() => mergeMemory(many, [{ title: 'Extra', text: 'Extra' }]), /200 notes/);
  assert.equal(many.length, 200);
});
test('selected import file accepts UTF-8 BOM and refuses invalid UTF-8 and oversized files', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-memory-import-')),
    file = path.join(folder, 'memory.txt');
  fs.writeFileSync(file, '\uFEFFFrançais.');
  assert.equal(readMemoryImport(file), 'Français.');
  fs.writeFileSync(file, Buffer.from([255, 254, 0]));
  assert.throws(() => readMemoryImport(file), /UTF-8/);
  fs.writeFileSync(file, Buffer.alloc(1280001));
  assert.throws(() => readMemoryImport(file), /maximum/);
});
test('personal and project memories have independent controls and bounded targeted context', () => {
  const personal = [
      createNote({ title: 'Style', text: 'PERSONAL_CANARY Français bref.', pinned: true }),
      createNote({ title: 'Other', text: 'irrelevant beach' }),
    ],
    project = [createNote({ title: 'Auth', text: 'PROJECT_CANARY auth.ts', tags: ['auth'] })];
  const context = sharedMemoryContext(project, personal, 'auth');
  assert.ok(context.text.includes('PERSONAL_CANARY'));
  assert.ok(context.text.includes('PROJECT_CANARY'));
  assert.ok(!context.text.includes('beach'));
  assert.equal(context.personalIds.length, 1);
  assert.equal(context.projectIds.length, 1);
  assert.ok(context.text.length < 7000);
  assert.ok(
    !sharedMemoryContext(project, personal, 'auth', { personalMemoryEnabled: false }).text.includes(
      'PERSONAL_CANARY'
    )
  );
  assert.ok(
    !sharedMemoryContext(project, personal, 'auth', { memoryEnabled: false }).text.includes(
      'PROJECT_CANARY'
    )
  );
});
test('v3 migration backs up history, preserves project notes and stores shared profile separately', () => {
  const raw = {
    schemaVersion: 3,
    workspaces: [{ id: 'w', name: 'Old' }],
    projects: [
      {
        id: 'p',
        workspaceId: 'w',
        path: os.tmpdir(),
        memory: [createNote({ title: 'Project', text: 'Preserved' })],
      },
    ],
    sessions: [{ id: 's', messages: [{ agent: 'user', text: 'Existing history' }] }],
    activeProjectId: 'p',
    activeWorkspaceId: 'w',
  };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-memory-migrate-')),
    file = path.join(folder, 'workspace.json');
  fs.writeFileSync(file, JSON.stringify(raw));
  const persistence = new JsonStore(file),
    library = new Library(persistence.load().data);
  assert.equal(library.data.schemaVersion, 5);
  assert.equal(library.data.projects[0].memory[0].text, 'Preserved');
  assert.ok(fs.readdirSync(folder).some((name) => name.includes('.v3-backup-')));
  library.data.personalMemory.push(createNote({ title: 'Profile', text: 'Shared' }));
  persistence.save(library.data);
  const reopened = new Library(persistence.load().data);
  assert.equal(reopened.data.personalMemory[0].text, 'Shared');
  assert.equal(reopened.data.sessions[0].messages[0].text, 'Existing history');
});
test('disabled duration keeps quota and call guards after unlimited elapsed time', () => {
  assert.equal(BUDGET_DEFAULTS.timeLimitEnabled, false);
  assert.equal(budgetPatch({ timeLimitEnabled: true }).timeLimitEnabled, true);
  let time = 0;
  const session = { id: 's' },
    budget = new UsageBudget(
      session,
      { maxCalls: 1, durationMinutes: 1, timeLimitEnabled: false },
      [],
      { now: () => time }
    );
  assert.equal(session.budget.deadline, null);
  time += 3 * 86400000;
  budget.check();
  const record = budget.reserve('codex');
  budget.finish(record, true);
  assert.throws(() => budget.reserve('claude'), /appels/);
});
test('older planned missions keep frozen duration while new missions default to duration off', () => {
  const raw = {
    schemaVersion: 3,
    workspaces: [{ id: 'w', name: 'Old' }],
    projects: [],
    schedules: [
      { id: 'j', prompt: 'Existing plan', state: 'scheduled', config: { durationMinutes: 180 } },
    ],
  };
  const library = new Library(raw);
  assert.equal(library.data.schedules[0].config.timeLimitEnabled, true);
  assert.equal(library.settings.timeLimitEnabled, false);
  assert.equal(library.data.schedules[0].config.durationMinutes, 180);
});
test('both providers receive same shared memory; turning project memory off keeps personal profile', async () => {
  const prompts = [],
    personal = [createNote({ title: 'Profile', text: 'PERSONAL_CANARY French', pinned: true })];
  let complete;
  const done = new Promise((resolve) => (complete = resolve));
  const provider = {
    run: async (options) => {
      prompts.push(options.prompt);
      options.onDelta('Visible reply');
      return 'Visible reply';
    },
  };
  const events = [],
    orchestrator = new Orchestrator(
      { codex: provider, claude: provider },
      (event) => {
        events.push(event);
        if (event.type === 'complete') complete(event.session);
      },
      () => {},
      () => '',
      undefined,
      { memory: (config, prompt) => sharedMemoryContext([], personal, prompt, config) }
    );
  orchestrator.start({ id: 's', messages: [], tasks: [] }, 'Discuss useful idea', {
    mode: 'discuss',
    rounds: 1,
    collaboration: 'economy',
    memoryEnabled: false,
    personalMemoryEnabled: true,
    skills: [],
    project: os.tmpdir(),
  });
  const session = await done;
  assert.equal(session.state, 'completed');
  assert.equal(prompts.length, 3);
  assert.ok(prompts.every((prompt) => prompt.includes('PERSONAL_CANARY')));
  assert.ok(events.some((event) => event.type === 'stream/delta'));
  assert.equal(session.context.personalMemoryIds.length, 1);
});
