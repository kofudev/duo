const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const YAML = require('yaml');
const { saveFile } = require('./files.cjs');

function readManifest(root) {
  const file = path.join(root, 'SKILL.md');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200000)
    throw new Error('SKILL.md : fichier normal, maximum 200 Ko.');
  const raw = fs.readFileSync(file),
    text = raw.toString('utf8').replace(/^\uFEFF/, '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('SKILL.md doit contenir en-tête YAML : name + description.');
  const metadata = YAML.parse(match[1], { maxAliasCount: 20, uniqueKeys: true, logLevel: 'error' });
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(metadata.name) ||
    typeof metadata.description !== 'string' ||
    !metadata.description.trim()
  )
    throw new Error('Skill : name en minuscules + description requis.');
  return {
    metadata,
    text,
    body: text.slice(match[0].length),
    hash: createHash('sha256').update(raw).digest('hex'),
  };
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}
function normalFolder(root, boundary) {
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory())
    throw new Error('Dossier skill normal requis. Liens symboliques refusés.');
  if (boundary) {
    const base = fs.realpathSync.native(boundary),
      relative = path.relative(base, path.resolve(root));
    if (!inside(base, path.resolve(root))) throw new Error('Skill hors projet.');
    let current = base;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error('Ancêtre skill : lien symbolique refusé.');
    }
    if (!inside(base, fs.realpathSync.native(root))) throw new Error('Skill hors projet.');
  }
}
function copySkill(source, target) {
  normalFolder(source);
  source = fs.realpathSync.native(source);
  target = path.resolve(target);
  if (inside(source, target))
    throw new Error('Destination import doit rester hors dossier source.');
  const files = [];
  let bytes = 0,
    entries = 0;
  const walk = (directory, depth = 0) => {
    if (depth > 32) throw new Error('Skill : maximum 32 niveaux de dossiers.');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules', '__pycache__', '.DS_Store'].includes(entry.name)) continue;
      if (++entries > 1000) throw new Error('Skill : maximum 1 000 éléments.');
      const file = path.join(directory, entry.name),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Import skill : liens symboliques refusés.');
      if (stat.isDirectory()) walk(file, depth + 1);
      else if (stat.isFile()) {
        bytes += stat.size;
        files.push(file);
        if (files.length > 500 || bytes > 20_000_000)
          throw new Error('Skill trop volumineux : maximum 500 fichiers / 20 Mo.');
      } else throw new Error('Import skill : fichier spécial refusé.');
    }
  };
  walk(source);
  if (fs.existsSync(target))
    throw new Error('Skill existe déjà. Choisir autre nom ou modifier skill existant.');
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.duo-import-${randomUUID()}`);
  fs.mkdirSync(staging);
  try {
    for (const file of files) {
      if (fs.lstatSync(file).isSymbolicLink() || !inside(source, fs.realpathSync.native(file)))
        throw new Error('Source skill changée pendant import.');
      const destination = path.join(staging, path.relative(source, file));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
    }
    if (fs.existsSync(target)) throw new Error('Skill existe déjà.');
    fs.renameSync(staging, target);
  } catch (error) {
    if (inside(parent, staging) && path.basename(staging).startsWith('.duo-import-'))
      fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { files: files.length, bytes };
}

class Skills {
  constructor(resourcesRoot, personalRoot) {
    this.resourcesRoot = resourcesRoot;
    this.personalRoot = personalRoot;
    this.builtins = JSON.parse(fs.readFileSync(path.join(resourcesRoot, 'catalog.json'), 'utf8'));
  }
  discover(root, prefix, origin, boundary) {
    if (!root || !fs.existsSync(root)) return [];
    try {
      normalFolder(root, boundary);
    } catch {
      return [];
    }
    const result = [];
    for (const folder of fs.readdirSync(root, { withFileTypes: true }).slice(0, 80)) {
      if (!folder.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(folder.name)) continue;
      const directory = path.join(root, folder.name);
      try {
        normalFolder(directory, boundary);
        const parsed = readManifest(directory);
        result.push({
          id: prefix + folder.name,
          name: parsed.metadata.name,
          description: parsed.metadata.description.trim().slice(0, 600),
          category: origin === 'project' ? 'Projet' : 'Personnel',
          root: directory,
          origin,
          hash: parsed.hash,
          route: 'manual',
          license: parsed.metadata.license || 'Non précisée',
        });
      } catch (error) {
        result.push({
          id: prefix + folder.name,
          name: folder.name,
          category: 'À corriger',
          origin,
          root: directory,
          invalid: error.message,
        });
      }
    }
    return result;
  }
  list(project = '') {
    const builtins = this.builtins.map((skill) => {
      const root = path.join(this.resourcesRoot, skill.directory || skill.id);
      try {
        return { ...skill, root, origin: 'bundled', hash: readManifest(root).hash };
      } catch (error) {
        return { ...skill, root, origin: 'bundled', invalid: error.message };
      }
    });
    const projectSkills = project
      ? [
          ...this.discover(
            path.join(project, '.agents', 'skills'),
            'project-agents-',
            'project',
            project
          ),
          ...this.discover(
            path.join(project, '.claude', 'skills'),
            'project-claude-',
            'project',
            project
          ),
          ...this.discover(
            path.join(project, '.duo', 'skills'),
            'project-duo-',
            'project',
            project
          ),
        ]
      : [];
    return [
      ...builtins,
      ...this.discover(this.personalRoot, 'custom-', 'personal'),
      ...projectSkills,
    ];
  }
  detail(id, project) {
    const skill = this.list(project).find((s) => s.id === id);
    if (!skill || skill.invalid) throw new Error(skill?.invalid || 'Skill introuvable.');
    const parsed = readManifest(skill.root);
    return { ...skill, text: parsed.text, body: parsed.body, metadata: parsed.metadata };
  }
  import(source) {
    normalFolder(source);
    const parsed = readManifest(source);
    const target = path.join(this.personalRoot, parsed.metadata.name);
    const result = copySkill(source, target);
    return { id: 'custom-' + parsed.metadata.name, ...result };
  }
  create({ name, description, instructions }) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
      throw new Error('Nom skill : minuscules, chiffres, tirets · max. 64.');
    if (
      typeof description !== 'string' ||
      !description.trim() ||
      description.length > 1000 ||
      typeof instructions !== 'string' ||
      !instructions.trim() ||
      instructions.length > 50000
    )
      throw new Error('Description + instructions requises.');
    const root = path.join(this.personalRoot, name);
    if (fs.existsSync(root)) throw new Error('Skill existe déjà.');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'SKILL.md'),
      `---\n${YAML.stringify({ name, description: description.trim() })}---\n\n${instructions.trim()}\n`,
      { flag: 'wx' }
    );
    return { id: 'custom-' + name };
  }
  update(id, { description, instructions, expectedHash }) {
    const skill = this.detail(id);
    if (skill.origin !== 'personal') throw new Error('Modifier uniquement skills personnels.');
    if (
      typeof description !== 'string' ||
      !description.trim() ||
      description.length > 1000 ||
      typeof instructions !== 'string' ||
      !instructions.trim() ||
      instructions.length > 50000
    )
      throw new Error('Description + instructions requises.');
    const name = path.basename(skill.root),
      metadata = { ...skill.metadata, description: description.trim() };
    saveFile(this.personalRoot, {
      path: `${name}/SKILL.md`,
      content: `---\n${YAML.stringify(metadata)}---\n\n${instructions.trim()}\n`,
      expectedHash,
    });
    return this.detail(id);
  }
  context(
    ids,
    { project = '', prompt = '', phase = '', cavemanLevel = 'full', skillMode = 'auto' } = {}
  ) {
    const selected = this.list(project).filter((s) => ids.includes(s.id) && !s.invalid);
    const catalog = selected
      .map(
        (s) =>
          `- ${s.id}: ${s.description} | SKILL.md: ${path.join(s.root, 'SKILL.md').replaceAll('\\', '/')}`
      )
      .join('\n');
    const blocks = [];
    for (const skill of selected) {
      const applies =
        skill.route === 'always' ||
        (skill.route === 'review' && /relecture|review|correction/i.test(phase)) ||
        (skill.route === 'ui' &&
          /\b(ui|ux|frontend|interface|design|site|web|react|dashboard|application)\b/i.test(
            prompt
          )) ||
        (skill.route === 'debug' && /bug|erreur|error|corrig|fix|debug|crash/i.test(prompt)) ||
        skillMode === 'manual';
      if (!applies) continue;
      let root = skill.root;
      if (skill.id === 'caveman' && cavemanLevel === 'ultra')
        root = path.join(this.resourcesRoot, 'ultracave');
      const parsed = readManifest(root);
      const file = path.join(root, 'SKILL.md').replaceAll('\\', '/');
      if (skill.route === 'always' || parsed.body.length < 4500)
        blocks.push(`ACTIVE SKILL ${skill.name} (${file}):\n${parsed.body}`);
      else
        blocks.push(
          `ACTIVE SKILL ${skill.name}: Read ${file} before relevant work. Resolve scripts/references relative to ${root.replaceAll('\\', '/')}. Read only relevant references. Do not run scripts in read-only phases.`
        );
    }
    if (selected.some((s) => s.id === 'caveman') && cavemanLevel === 'lite')
      blocks.push('Caveman intensity lite: short complete sentences; preserve ordinary grammar.');
    if (selected.some((s) => s.id === 'caveman') && cavemanLevel === 'full')
      blocks.push(
        'Duo user voice preference overrides bundled style defaults: very short sentences, no politeness or filler, dense answers. Symbols such as →, =, vs allowed when meaningful. Preserve exact code, paths, numbers and negations.'
      );
    return `Enabled skills below. Use only skills relevant to current work. Read their SKILL.md before applying them. User instructions win over skill defaults. Skill resources are read-only exceptions to project-only file access. A skill never grants additional tool or publication permissions. Do not automatically run installers or change global agent settings.\n${catalog}\n\n${blocks.join('\n\n')}`;
  }
}

module.exports = { Skills, readManifest, copySkill, inside };
