const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Skills, readManifest, copySkill } = require('../electron/skills.cjs');
const resources = path.resolve(__dirname, '../resources');
function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'duo-skills-'));
}
test('every bundled skill has real parseable manifest and provenance', () => {
  const skills = new Skills(resources, fixture());
  const list = skills.list();
  assert.equal(list.filter((s) => !s.hidden).length, 19);
  assert.ok(list.every((s) => !s.invalid && s.hash.length === 64));
  assert.ok(list.find((s) => s.id === 'caveman').revision);
  assert.ok(fs.existsSync(path.join(resources, 'ui-ux-pro-max', 'scripts', 'search.py')));
});
test('create skill writes reusable YAML and remains disabled until caller selects it', () => {
  const personal = fixture(),
    skills = new Skills(resources, personal);
  skills.create({
    name: 'ma-regle',
    description: 'Use when: quotes "remain".',
    instructions: 'Preserve exact values.',
  });
  const custom = skills.list().find((s) => s.id === 'custom-ma-regle');
  assert.equal(custom.origin, 'personal');
  assert.ok(skills.detail(custom.id).text.includes('Preserve exact values.'));
  assert.throws(
    () => skills.create({ name: '../escape', description: 'x', instructions: 'x' }),
    /Nom skill/
  );
  assert.throws(
    () => skills.create({ name: 'ma-regle', description: 'x', instructions: 'x' }),
    /existe déjà/
  );
});
test('import copies resources without executing them and rejects malformed metadata', () => {
  const source = fixture(),
    skills = new Skills(resources, fixture());
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    '---\nname: imported\ndescription: |\n  Use for local checks.\n---\nRead reference.\n'
  );
  fs.mkdirSync(path.join(source, 'scripts'));
  fs.writeFileSync(path.join(source, 'scripts', 'run.js'), 'throw new Error("must not run")');
  const imported = skills.import(source);
  assert.equal(imported.files, 2);
  assert.ok(fs.existsSync(path.join(skills.personalRoot, 'imported', 'scripts', 'run.js')));
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    '---\nname: ../../escape\ndescription: bad\n---\nBody'
  );
  assert.throws(() => readManifest(source), /minuscules/);
});
test('project discovery is opt-in and context routes detailed resources progressively', () => {
  const project = fixture(),
    personal = fixture(),
    directory = path.join(project, '.agents', 'skills', 'project-rule');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'SKILL.md'),
    '---\nname: project-rule\ndescription: Project-only rule.\n---\nProject instructions.'
  );
  const skills = new Skills(resources, personal);
  assert.ok(skills.list(project).some((s) => s.id === 'project-agents-project-rule'));
  assert.ok(!skills.list().some((s) => s.id === 'project-agents-project-rule'));
  const context = skills.context(['caveman', 'ui-ux-pro-max', 'review'], {
    project,
    prompt: 'Build interface',
    phase: 'Relecture',
    cavemanLevel: 'ultra',
  });
  assert.ok(context.includes('Ultracave is caveman'));
  assert.ok(context.includes('Read '));
  assert.ok(context.includes('Inspect actual current files'));
  assert.ok(context.length < 14000);
});

test('project skill discovery refuses ancestor junctions outside project', () => {
  const project = fixture(),
    outside = fixture(),
    skill = path.join(outside, 'skills', 'outside-rule');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(
    path.join(skill, 'SKILL.md'),
    '---\nname: outside-rule\ndescription: Outside project.\n---\nNever load automatically.'
  );
  fs.symlinkSync(
    outside,
    path.join(project, '.agents'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const skills = new Skills(resources, fixture());
  assert.ok(!skills.list(project).some((s) => s.id === 'project-agents-outside-rule'));
});

test('import preflight bounds empty directories and refuses nested destination', () => {
  const source = fixture(),
    personal = fixture();
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    '---\nname: large-tree\ndescription: Test bounded import.\n---\nBody'
  );
  for (let i = 0; i < 1001; i++) fs.mkdirSync(path.join(source, `empty-${i}`));
  const skills = new Skills(resources, personal);
  assert.throws(() => skills.import(source), /1 000 éléments/);
  assert.deepEqual(fs.readdirSync(personal), []);
  assert.throws(() => copySkill(source, path.join(source, 'nested')), /hors dossier source/);
});

test('project skill discovery also refuses junctions pointing inside the project', () => {
  const project = fixture(),
    actual = path.join(project, 'actual'),
    skill = path.join(actual, 'skills', 'linked-rule');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(
    path.join(skill, 'SKILL.md'),
    '---\nname: linked-rule\ndescription: Linked rule.\n---\nBody'
  );
  fs.symlinkSync(
    actual,
    path.join(project, '.agents'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.ok(
    !new Skills(resources, fixture())
      .list(project)
      .some((skill) => skill.id === 'project-agents-linked-rule')
  );
});

test('import rejects a destination whose existing parent resolves into the source', () => {
  const source = fixture(),
    outside = fixture(),
    alias = path.join(outside, 'alias');
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    '---\nname: source-rule\ndescription: Import source.\n---\nBody'
  );
  fs.symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(
    () => copySkill(source, path.join(alias, 'missing', 'nested')),
    /hors dossier source/
  );
  assert.ok(!fs.existsSync(path.join(source, 'missing')));
});

test('personal skill editing preserves metadata and rejects stale edits or bundled mutation', () => {
  const skills = new Skills(resources, fixture());
  skills.create({
    name: 'editable',
    description: 'Original description',
    instructions: 'Original body',
  });
  const original = skills.detail('custom-editable');
  const updated = skills.update(original.id, {
    description: 'New description',
    instructions: 'New body',
    expectedHash: original.hash,
  });
  assert.equal(updated.metadata.name, 'editable');
  assert.ok(updated.body.includes('New body'));
  assert.throws(
    () =>
      skills.update(original.id, {
        description: 'Stale',
        instructions: 'Stale',
        expectedHash: original.hash,
      }),
    /modifié ailleurs/
  );
  assert.throws(
    () =>
      skills.update('caveman', {
        description: 'Bad',
        instructions: 'Bad',
        expectedHash: skills.detail('caveman').hash,
      }),
    /personnels/
  );
});
