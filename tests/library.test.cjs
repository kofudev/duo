const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Library, createProjectFolder, folderName } = require('../electron/library.cjs');
const { git } = require('../electron/git.cjs');
function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'duo-library-'));
}

test('v1 migration preserves messages and associates every historical project', () => {
  const root = fixture(),
    other = fixture();
  const session = {
    id: 'old',
    title: 'Ancien projet',
    project: other,
    state: 'running',
    phase: 'Écriture',
    messages: [{ id: 'm', agent: 'user', text: 'Ne pas perdre' }],
    tasks: [{ id: 't', status: 'done' }],
    results: [{ id: 'check', executor: 'duo', status: 'running' }],
    validation: { state: 'running', results: [{ id: 'check', status: 'running' }] },
  };
  const library = new Library({
    settings: { project: root, rounds: 2, skills: ['caveman'] },
    sessions: [session],
  });
  assert.equal(library.data.projects.length, 2);
  assert.equal(library.settings.project, root);
  assert.deepEqual(library.data.sessions[0].messages, session.messages);
  assert.equal(library.data.sessions[0].state, 'stopped');
  assert.equal(library.data.sessions[0].phase, '');
  assert.equal(library.data.sessions[0].validation.state, 'interrupted');
  assert.equal(library.data.sessions[0].validation.results[0].status, 'unknown');
  assert.equal(library.data.sessions[0].results[0].status, 'unknown');
  library.activateSession('old');
  assert.equal(library.settings.project, other);
  const reloaded = new Library(JSON.parse(JSON.stringify(library.data)));
  assert.equal(reloaded.settings.rounds, 2);
  assert.equal(reloaded.settings.project, other);
});
test('project settings and sessions stay isolated across workspaces', () => {
  const library = new Library();
  const first = library.importProject(fixture(), 'Premier');
  library.updateSettings({ skills: ['caveman'], claudeModel: 'sonnet', rounds: 3 });
  const mission = library.newSession();
  const workspace = library.createWorkspace('Studio');
  const second = library.importProject(fixture(), 'Second');
  library.updateSettings({ skills: ['review'], claudeModel: 'opus', rounds: 1 });
  assert.equal(second.workspaceId, workspace.id);
  library.activateSession(mission.id);
  assert.equal(library.settings.projectId, first.id);
  assert.deepEqual(library.settings.skills, ['caveman']);
  assert.equal(library.settings.claudeModel, 'sonnet');
  library.activate({ projectId: second.id });
  assert.deepEqual(library.settings.skills, ['review']);
  assert.throws(() => library.updateSettings({ rounds: 6 }), /1 à 5/);
});
test('archive changes metadata only and restores same project/history', () => {
  const library = new Library(),
    root = fixture();
  fs.writeFileSync(path.join(root, 'keep.txt'), 'keep');
  const project = library.importProject(root, 'Keep');
  const mission = library.newSession();
  library.patchRecord('project', project.id, { archived: true });
  assert.equal(library.settings.project, '');
  assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'keep');
  assert.throws(() => library.activateSession(mission.id), /Restaurer/);
  library.patchRecord('project', project.id, { archived: false });
  library.activateSession(mission.id);
  assert.equal(library.data.sessions.length, 1);
  assert.throws(
    () => library.patchRecord('workspace', library.data.activeWorkspaceId, { archived: true }),
    /au moins/
  );
});
test('import deduplicates canonical paths and never reassigns existing history', () => {
  const library = new Library(),
    root = fixture();
  const first = library.importProject(root, 'Premier');
  library.createWorkspace('Autre');
  const imported = library.importProject(path.join(root, '.'), 'Alias');
  assert.equal(imported.id, first.id);
  assert.equal(library.data.projects.length, 1);
  assert.equal(library.data.activeWorkspaceId, first.workspaceId);
});
test('new project validates Windows names, traversal, and preserves existing directories', async () => {
  const parent = fixture();
  fs.mkdirSync(path.join(parent, 'existant'));
  fs.writeFileSync(path.join(parent, 'existant', 'keep'), 'original');
  for (const name of ['../outside', 'C:\\escape', 'CON', 'LPT1.txt', 'trailing.', 'bad?'])
    assert.throws(() => folderName(name));
  await assert.rejects(createProjectFolder({ parent, name: 'existant' }, git), /existe déjà/);
  assert.equal(fs.readFileSync(path.join(parent, 'existant', 'keep'), 'utf8'), 'original');
  await assert.rejects(
    createProjectFolder({ parent, name: 'Projet', template: 'unknown' }, git),
    /inconnu/
  );
  assert.equal(fs.existsSync(path.join(parent, 'Projet')), false);
});
test('Node template creates runnable Unicode project and main Git branch', async () => {
  const result = await createProjectFolder(
    { parent: fixture(), name: 'Équipe Duo', template: 'node' },
    git
  );
  assert.equal(result.warning, '');
  assert.equal((await git(result.path, ['branch', '--show-current'])).trim(), 'main');
  const { execFileSync } = require('node:child_process');
  const output = execFileSync(process.execPath, ['src/index.js'], {
    cwd: result.path,
    encoding: 'utf8',
  });
  assert.ok(output.includes('Équipe Duo'));
  assert.ok(fs.existsSync(path.join(result.path, 'AGENTS.md')));
});

test('moving project workspace preserves settings and reassigns its history', () => {
  const library = new Library(),
    project = library.importProject(fixture(), 'Projet');
  library.updateSettings({ claudeModel: 'sonnet' });
  const mission = library.newSession();
  const destination = library.createWorkspace('Destination');
  library.activate({ projectId: project.id });
  library.patchRecord('project', project.id, { workspaceId: destination.id });
  assert.equal(library.data.activeWorkspaceId, destination.id);
  assert.equal(library.settings.claudeModel, 'sonnet');
  assert.equal(mission.workspaceId, destination.id);
  library.activateSession(mission.id);
  assert.equal(library.settings.projectId, project.id);
});

test('relink updates session paths and refuses duplicate project ownership', () => {
  const library = new Library(),
    original = fixture(),
    moved = fixture();
  const project = library.importProject(original, 'Moved'),
    session = library.newSession();
  library.relinkProject(project.id, moved);
  assert.equal(project.path, fs.realpathSync.native(moved));
  assert.equal(session.project, fs.realpathSync.native(moved));
  const other = library.importProject(fixture(), 'Other');
  assert.throws(() => library.relinkProject(other.id, moved), /déjà lié/);
  assert.throws(
    () =>
      library.patchRecord('project', project.id, {
        name: 'Should not mutate',
        description: 'x'.repeat(4001),
      }),
    /4 000/
  );
  assert.equal(project.name, 'Moved');
});
