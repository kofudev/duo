const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { BUDGET_DEFAULTS, budgetPatch, cleanLedger } = require('./budget.cjs');
const { cleanMemory } = require('./memory.cjs');

const DEFAULT_SKILLS = [
  'caveman',
  'engineering',
  'review',
  'ui-ux-pro-max',
  'debugging',
  'accessibility',
  'project-memory',
  'quota-efficiency',
];
const DEFAULT_SETTINGS = Object.freeze({
  codexModel: '',
  claudeModel: 'opus',
  codexEffort: '',
  claudeEffort: 'max',
  rounds: 1,
  mode: 'discuss',
  skills: DEFAULT_SKILLS,
  commands: false,
  allowUsageCredits: false,
  cavemanLevel: 'full',
  skillMode: 'auto',
  ...BUDGET_DEFAULTS,
});
const CONFIG_KEYS = Object.keys(DEFAULT_SETTINGS);

function cleanName(value, fallback) {
  if (typeof value !== 'string') throw new Error('Nom requis.');
  const name = value.trim();
  if (!name && fallback) return fallback;
  if (!name || name.length > 80 || /[\x00-\x1f]/.test(name))
    throw new Error('Nom requis · maximum 80 caractères.');
  return name;
}
function configPatch(values = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error('Réglages invalides.');
  const patch = budgetPatch(values);
  for (const key of CONFIG_KEYS) {
    if (key in BUDGET_DEFAULTS) continue;
    if (!(key in values)) continue;
    const value = values[key];
    if (key === 'skills') {
      if (
        !Array.isArray(value) ||
        value.length > 64 ||
        value.some((id) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(id))
      )
        throw new Error('Liste skills invalide.');
      patch.skills = [...new Set(value)];
    } else if (key === 'commands' || key === 'allowUsageCredits') patch[key] = value === true;
    else if (key === 'rounds') {
      if (![1, 2, 3, 4, 5].includes(Number(value))) throw new Error('Discussion : 1 à 5 tours.');
      patch.rounds = Number(value);
    } else {
      if (typeof value !== 'string' || value.length > 160 || /[\x00-\x1f]/.test(value))
        throw new Error('Réglage invalide.');
      const options = {
        mode: ['discuss', 'build'],
        cavemanLevel: ['lite', 'full', 'ultra'],
        skillMode: ['auto', 'manual'],
      }[key];
      if (options && !options.includes(value)) throw new Error('Option invalide.');
      patch[key] = value;
    }
  }
  return patch;
}
function pathKey(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value))
    throw new Error('Dossier absolu requis.');
  let resolved;
  try {
    resolved = fs.realpathSync.native(value);
    if (!fs.statSync(resolved).isDirectory()) throw new Error();
  } catch {
    throw new Error('Dossier introuvable. Choisir emplacement existant.');
  }
  return resolved;
}
function folderName(value) {
  const name = cleanName(value);
  if (
    /[<>:"/\\|?*]/.test(name) ||
    /[. ]$/.test(name) ||
    name === '.' ||
    name === '..' ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('Nom dossier incompatible Windows.');
  return name;
}
function sessionShape(session) {
  return {
    ...session,
    id: session.id || randomUUID(),
    title: String(session.title || 'Nouvelle mission'),
    messages: Array.isArray(session.messages) ? session.messages : [],
    tasks: Array.isArray(session.tasks) ? session.tasks : [],
    state: session.state === 'running' ? 'stopped' : session.state || 'idle',
    phase: session.state === 'running' ? '' : session.phase || '',
  };
}

class Library {
  constructor(raw = {}) {
    this.data = this.migrate(raw);
    this.ensureSelection();
  }
  migrate(raw) {
    if (
      [2, 3, 4].includes(raw?.schemaVersion) &&
      Array.isArray(raw.workspaces) &&
      Array.isArray(raw.projects)
    ) {
      const workspaces = raw.workspaces
        .filter((w) => typeof w?.id === 'string' && typeof w.name === 'string')
        .map((w) => ({ ...w, archived: w.archived === true }));
      const ids = new Set(workspaces.map((w) => w.id));
      const projects = raw.projects
        .filter(
          (p) => typeof p?.id === 'string' && typeof p.path === 'string' && ids.has(p.workspaceId)
        )
        .map((p) => ({
          ...p,
          memory: cleanMemory(p.memory),
          archived: p.archived === true,
          settings: this.safeConfig(p.settings),
          description: String(p.description || '').slice(0, 4000),
        }));
      return {
        schemaVersion: 4,
        personalMemory: cleanMemory(raw.personalMemory),
        defaultSettings: { ...DEFAULT_SETTINGS, ...this.safeConfig(raw.defaultSettings) },
        workspaces,
        projects,
        usageLedger: cleanLedger(raw.usageLedger),
        schedules: Array.isArray(raw.schedules)
          ? raw.schedules
              .filter((job) => job && typeof job.id === 'string' && typeof job.prompt === 'string')
              .slice(-200)
              .map((job) => ({
                ...job,
                config:
                  job.config && typeof job.config === 'object'
                    ? {
                        ...job.config,
                        timeLimitEnabled:
                          raw.schemaVersion < 4 && job.config.timeLimitEnabled === undefined
                            ? true
                            : job.config.timeLimitEnabled === true,
                      }
                    : job.config,
                state: ['running', 'starting'].includes(job.state) ? 'interrupted' : job.state,
              }))
          : [],
        sessions: (Array.isArray(raw.sessions) ? raw.sessions : [])
          .filter((s) => s && typeof s === 'object')
          .map(sessionShape),
        activeWorkspaceId: raw.activeWorkspaceId || null,
        activeProjectId: raw.activeProjectId || null,
      };
    }
    const workspace = {
      id: randomUUID(),
      name: 'Personnel',
      createdAt: Date.now(),
      archived: false,
    };
    const settings = { ...DEFAULT_SETTINGS, ...this.safeConfig(raw.settings) };
    const projects = [],
      sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
        .filter((s) => s && typeof s === 'object')
        .map(sessionShape);
    const paths = [raw.settings?.project, ...sessions.map((s) => s.project)].filter(
      (p) => typeof p === 'string' && p.trim()
    );
    for (const root of paths)
      if (!projects.some((p) => pathKey(p.path) === pathKey(root)))
        projects.push({
          id: randomUUID(),
          workspaceId: workspace.id,
          name: path.basename(root),
          path: path.resolve(root),
          settings: {},
          description: '',
          createdAt: Date.now(),
          archived: false,
        });
    for (const session of sessions) {
      const project = projects.find(
        (p) => session.project && pathKey(p.path) === pathKey(session.project)
      );
      session.projectId = project?.id || null;
      session.workspaceId = workspace.id;
    }
    const activeProject = projects.find(
      (p) => raw.settings?.project && pathKey(p.path) === pathKey(raw.settings.project)
    );
    return {
      schemaVersion: 4,
      personalMemory: [],
      defaultSettings: settings,
      workspaces: [workspace],
      projects,
      usageLedger: [],
      schedules: [],
      sessions,
      activeWorkspaceId: workspace.id,
      activeProjectId: activeProject?.id || null,
    };
  }
  safeConfig(value) {
    const result = {};
    for (const key of CONFIG_KEYS)
      if (value && key in value)
        try {
          Object.assign(result, configPatch({ [key]: value[key] }));
        } catch {}
    return result;
  }
  ensureSelection() {
    if (!this.data.workspaces.some((w) => !w.archived))
      this.data.workspaces.push({
        id: randomUUID(),
        name: 'Personnel',
        createdAt: Date.now(),
        archived: false,
      });
    let workspace = this.data.workspaces.find(
      (w) => w.id === this.data.activeWorkspaceId && !w.archived
    );
    if (!workspace) {
      workspace = this.data.workspaces.find((w) => !w.archived);
      this.data.activeWorkspaceId = workspace.id;
    }
    if (
      !this.data.projects.some(
        (p) => p.id === this.data.activeProjectId && p.workspaceId === workspace.id && !p.archived
      )
    )
      this.data.activeProjectId =
        this.data.projects.find((p) => p.workspaceId === workspace.id && !p.archived)?.id || null;
  }
  get project() {
    return this.data.projects.find((p) => p.id === this.data.activeProjectId && !p.archived);
  }
  get settings() {
    return {
      ...this.data.defaultSettings,
      ...this.project?.settings,
      project: this.project?.path || '',
      projectId: this.project?.id || null,
      workspaceId: this.data.activeWorkspaceId,
    };
  }
  snapshot() {
    return {
      ...this.data,
      settings: this.settings,
      projects: this.data.projects.map((p) => ({ ...p, exists: fs.existsSync(p.path) })),
    };
  }
  updateSettings(values) {
    const target = this.project ? this.project.settings : this.data.defaultSettings;
    Object.assign(target, configPatch(values));
    return this.settings;
  }
  createWorkspace(name) {
    const workspace = {
      id: randomUUID(),
      name: cleanName(name),
      createdAt: Date.now(),
      archived: false,
    };
    this.data.workspaces.push(workspace);
    this.activate({ workspaceId: workspace.id });
    return workspace;
  }
  activate({ workspaceId, projectId } = {}) {
    let chosenProject = null;
    if (projectId) {
      const project = this.data.projects.find((p) => p.id === projectId && !p.archived);
      if (!project) throw new Error('Projet introuvable ou archivé.');
      workspaceId = project.workspaceId;
      chosenProject = project.id;
    }
    if (workspaceId) {
      if (!this.data.workspaces.some((w) => w.id === workspaceId && !w.archived))
        throw new Error('Workspace introuvable ou archivé.');
      this.data.activeWorkspaceId = workspaceId;
    }
    this.data.activeProjectId = chosenProject;
    this.ensureSelection();
    return this.snapshot();
  }
  importProject(root, name) {
    const resolved = directory(root);
    const existing = this.data.projects.find((p) => pathKey(p.path) === pathKey(resolved));
    if (existing) {
      existing.archived = false;
      this.data.workspaces.find((w) => w.id === existing.workspaceId).archived = false;
      this.activate({ projectId: existing.id });
      return existing;
    }
    const project = {
      id: randomUUID(),
      workspaceId: this.data.activeWorkspaceId,
      name: cleanName(name || path.basename(resolved) || 'Projet'),
      path: resolved,
      settings: {},
      description: '',
      createdAt: Date.now(),
      archived: false,
    };
    this.data.projects.push(project);
    this.data.activeProjectId = project.id;
    return project;
  }
  patchRecord(kind, id, values) {
    const rows =
      kind === 'workspace' ? this.data.workspaces : kind === 'project' ? this.data.projects : null;
    const record = rows?.find((item) => item.id === id);
    if (!record) throw new Error('Élément introuvable.');
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new Error('Modifications invalides.');
    const patch = {};
    if ('name' in values) patch.name = cleanName(values.name);
    if ('description' in values && kind === 'project') {
      if (typeof values.description !== 'string' || values.description.length > 4000)
        throw new Error('Brief : maximum 4 000 caractères.');
      patch.description = values.description;
    }
    if ('workspaceId' in values && kind === 'project') {
      if (!this.data.workspaces.some((w) => w.id === values.workspaceId && !w.archived))
        throw new Error('Workspace destination introuvable ou archivé.');
      patch.workspaceId = values.workspaceId;
    }
    if ('archived' in values) {
      if (
        values.archived === true &&
        kind === 'workspace' &&
        this.data.workspaces.filter((w) => !w.archived).length < 2
      )
        throw new Error('Conserver au moins un workspace actif.');
      patch.archived = values.archived === true;
    }
    Object.assign(record, patch);
    if (kind === 'project' && patch.workspaceId) {
      for (const session of this.data.sessions)
        if (session.projectId === id) session.workspaceId = patch.workspaceId;
      if (this.data.activeProjectId === id) this.data.activeWorkspaceId = patch.workspaceId;
    }
    this.ensureSelection();
    return this.snapshot();
  }
  relinkProject(id, root) {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) throw new Error('Projet introuvable.');
    const resolved = directory(root);
    if (this.data.projects.some((p) => p.id !== id && pathKey(p.path) === pathKey(resolved)))
      throw new Error('Dossier déjà lié à autre projet.');
    project.path = resolved;
    for (const session of this.data.sessions)
      if (session.projectId === id) session.project = resolved;
    return this.snapshot();
  }
  newSession() {
    const session = {
      id: randomUUID(),
      title: 'Nouvelle mission',
      messages: [],
      tasks: [],
      state: 'idle',
      phase: '',
      createdAt: Date.now(),
      project: this.settings.project,
      projectId: this.data.activeProjectId,
      workspaceId: this.data.activeWorkspaceId,
    };
    this.data.sessions.unshift(session);
    return session;
  }
  activateSession(id) {
    const session = this.data.sessions.find((s) => s.id === id);
    if (!session) throw new Error('Mission introuvable.');
    const workspace = this.data.workspaces.find((w) => w.id === session.workspaceId);
    const project = this.data.projects.find((p) => p.id === session.projectId);
    if (workspace?.archived || project?.archived)
      throw new Error('Restaurer projet ou workspace avant ouvrir mission.');
    this.activate({ workspaceId: workspace?.id, projectId: project?.id });
    return this.snapshot();
  }
  patchSession(id, values) {
    const session = this.data.sessions.find((s) => s.id === id);
    if (!session) throw new Error('Mission introuvable.');
    if ('title' in values) session.title = cleanName(values.title);
    if ('archived' in values) session.archived = values.archived === true;
    return session;
  }
}

const TEMPLATES = [
  { id: 'blank', name: 'Projet libre', description: 'README + dossier prêt pour Duo.' },
  { id: 'web', name: 'Site web', description: 'HTML, CSS, JavaScript · aucun package requis.' },
  {
    id: 'node',
    name: 'Application Node.js',
    description: 'Point entrée + package.json · Node 22+.',
  },
];
function templateFiles(name, template) {
  const instructions =
    '# Instructions projet\n\nSuivre conventions présentes. Préserver changements utilisateur. Vérifier résultat avant annoncer réussite.\n';
  const common = {
    '.gitignore': 'node_modules/\ndist/\n.env\n.env.*\n!.env.example\n*.log\n.DS_Store\n',
    'AGENTS.md': instructions,
  };
  if (template === 'blank')
    return {
      ...common,
      'README.md': `# ${name}\n\nProjet créé avec Duo. Ouvrir mission, décrire résultat souhaité, puis choisir Construire.\n`,
    };
  if (template === 'node')
    return {
      ...common,
      'README.md': `# ${name}\n\nPrérequis : Node.js 22+.\n\n\`\`\`sh\nnpm start\n\`\`\`\n`,
      'package.json':
        JSON.stringify(
          {
            name:
              name
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/^-+|-+$/g, '') || 'duo-project',
            version: '0.1.0',
            private: true,
            type: 'module',
            scripts: { start: 'node src/index.js' },
            engines: { node: '>=22' },
          },
          null,
          2
        ) + '\n',
      'src/index.js': `const message = ${JSON.stringify(name + ' → prêt à construire.')};\nconsole.log(message);\n`,
    };
  if (template === 'web')
    return {
      ...common,
      'README.md': `# ${name}\n\nOuvrir index.html dans navigateur. Aucun package requis.\n`,
      'index.html':
        '<!doctype html>\n<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Projet Duo</title><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head><body><main><p class="eyebrow">PROJET DUO</p><h1>Une idée commence ici.</h1><p>Construisez prochain chapitre avec votre équipe.</p><button id="start" type="button">Commencer</button><p id="status" role="status"></p></main></body></html>\n',
      'style.css':
        ':root{font-family:system-ui,sans-serif;color:#eef5f0;background:#111a16;color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center}main{max-width:42rem;padding:2rem}h1{font-size:clamp(2.4rem,6vw,4.4rem);line-height:1.05}.eyebrow{color:#b4d9bf;letter-spacing:.12em}button{padding:.8rem 1.3rem;border:0;border-radius:.7rem;background:#b4d9bf;color:#15281c;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid white;outline-offset:4px}#status{min-height:1.5em}\n',
      'app.js':
        'document.querySelector("#start").addEventListener("click", () => { document.querySelector("#status").textContent = "Projet prêt. À vous de construire."; });\n',
    };
  throw new Error('Modèle projet inconnu.');
}
async function createProjectFolder(
  { parent, name, template = 'blank', initializeGit = true },
  git
) {
  const parentRoot = directory(parent),
    safeName = folderName(name);
  const root = path.resolve(parentRoot, safeName);
  if (path.dirname(root) !== parentRoot)
    throw new Error('Dossier doit rester dans emplacement choisi.');
  const files = templateFiles(safeName, template);
  if (fs.existsSync(root))
    throw new Error('Dossier existe déjà. Importer projet ou choisir autre nom.');
  fs.mkdirSync(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { flag: 'wx' });
  }
  let warning = '';
  if (initializeGit)
    try {
      await git(root, ['init', '-b', 'main']);
    } catch (error) {
      warning = `Projet créé. Initialisation Git échouée : ${error.message}`;
    }
  return { path: root, warning, template };
}

module.exports = {
  Library,
  DEFAULT_SETTINGS,
  CONFIG_KEYS,
  configPatch,
  cleanName,
  directory,
  folderName,
  pathKey,
  TEMPLATES,
  createProjectFolder,
};
