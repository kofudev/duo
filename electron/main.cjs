const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CodexProvider, ClaudeProvider, connections } = require('./providers.cjs');
const { Orchestrator } = require('./orchestrator.cjs');
const { inspectGit, commitSelected, remoteUrl, git } = require('./git.cjs');
const {
  Library,
  directory,
  createProjectFolder,
  TEMPLATES,
  configPatch,
  DEFAULT_SETTINGS,
} = require('./library.cjs');
const { Scheduler } = require('./scheduler.cjs');
const {
  createNote,
  cleanMemory,
  sharedMemoryContext,
  checkpoint,
  MAX_NOTES,
} = require('./memory.cjs');
const {
  previewMemory,
  mergeMemory,
  exportMemory,
  readMemoryImport,
} = require('./memory-transfer.cjs');
const { Skills } = require('./skills.cjs');
const { validateModels, claudeCatalog } = require('./models.cjs');
const { listFiles, searchFiles, readFile, saveFile } = require('./files.cjs');
const { JsonStore } = require('./storage.cjs');
const { listGitHubRepos, cloneGitHub, createWorktree } = require('./git-projects.cjs');
const { FileObserver } = require('./file-observer.cjs');
const { formatSession } = require('./export.cjs');
const { checkUpdate } = require('./updates.cjs');
const { SSH } = require('./ssh.cjs');
const { captureMission } = require('./mission-evidence.cjs');
let checkedUpdate = null;

let window,
  store,
  library,
  skillManager,
  ssh,
  orchestrator,
  scheduler,
  storeFile,
  mutationActive = false;
let dirtyEditors = 0;
let dirtyByProject = null;
let persistence,
  storageWarning = '';
let projectOperation = null,
  closeAfterOperation = false;
const publicOperation = () =>
  projectOperation
    ? {
        id: projectOperation.id,
        kind: projectOperation.kind,
        title: projectOperation.title,
        detail: projectOperation.detail,
        startedAt: projectOperation.startedAt,
      }
    : null;
async function withProjectOperation(kind, title, work) {
  return withMutation(async () => {
    projectOperation = {
      id: randomUUID(),
      kind,
      title,
      detail: 'Préparation…',
      startedAt: Date.now(),
      controller: new AbortController(),
    };
    emit({ type: 'project/operation', operation: publicOperation() });
    try {
      return await work({
        signal: projectOperation.controller.signal,
        progress: (detail) => {
          if (projectOperation) {
            projectOperation.detail = detail;
            emit({ type: 'project/operation', operation: publicOperation() });
          }
        },
      });
    } finally {
      projectOperation = null;
      emit({ type: 'project/operation', operation: null });
      if (closeAfterOperation && !window.isDestroyed()) setImmediate(() => window.close());
    }
  });
}
let connectionProbe, lastConnections;
function probeConnections() {
  const project = library?.project?.path;
  if (!connectionProbe)
    connectionProbe = connections(codex, project && fs.existsSync(project) ? project : undefined)
      .then((result) => {
        lastConnections = result;
        return result;
      })
      .finally(() => {
        connectionProbe = null;
      });
  return connectionProbe;
}
const codex = new CodexProvider();
const fileObserver = new FileObserver(emit);
function skillRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'skills')
    : path.join(__dirname, '..', 'resources');
}
function skillContext(ids, context) {
  return skillManager.context(ids, context);
}
function librarySnapshot() {
  return {
    ...library.snapshot(),
    skills: skillManager.list(library.settings.project).filter((s) => !s.hidden),
    templates: TEMPLATES,
  };
}
const approvedParents = new Set();
function save() {
  const result = persistence.save(store);
  if (result.warning && storageWarning !== result.warning) {
    storageWarning = result.warning;
    emit({ type: 'storage/warning', warning: storageWarning });
  }
  if (!result.recovered) storageWarning = '';
  fileObserver.watch(library.project?.path || null, library.project?.id || null);
}
function emit(event) {
  if (event.type === 'complete') scheduler?.complete(event.session);
  if (window && !window.isDestroyed()) window.webContents.send('duo:event', event);
}
function validProject(project) {
  if (
    !project ||
    project !== store.settings.project ||
    !fs.existsSync(project) ||
    !fs.statSync(project).isDirectory()
  )
    throw new Error('Choisir dossier projet valide.');
  return project;
}
function projectFor(id) {
  if (id !== store.activeProjectId) throw new Error('Projet changé. Actualiser vue fichiers.');
  return validProject(store.settings.project);
}
function guardMutation() {
  if (orchestrator.active)
    throw new Error('Mission en cours. Arrêter avant modifier projet ou Git.');
  if (mutationActive) throw new Error('Opération projet en cours. Attendre fin opération.');
}
async function withMutation(work) {
  guardMutation();
  mutationActive = true;
  try {
    return await work();
  } finally {
    mutationActive = false;
  }
}
function handler(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Origine IPC invalide.');
    return fn(...args);
  });
}
function register() {
  handler('duo:update:check', async () => {
    checkedUpdate = null;
    checkedUpdate = await checkUpdate(app.getVersion());
    return checkedUpdate;
  });
  handler('duo:update:download', async () => {
    if (!checkedUpdate?.available)
      throw new Error('Vérifier les mises à jour avant téléchargement.');
    await shell.openExternal(checkedUpdate.url);
    return true;
  });
  handler('duo:bootstrap', () => ({
    ...librarySnapshot(),
    ...(lastConnections || {
      connections: {},
      models: [],
      catalogs: { codex: [], claude: claudeCatalog() },
    }),
    storageWarning,
    projectOperation: publicOperation(),
    activeSession: orchestrator.active?.sessionId || null,
  }));
  handler('duo:connections', probeConnections);
  handler('duo:library', () => librarySnapshot());
  handler('duo:workspace:create', (name) => {
    guardMutation();
    library.createWorkspace(name);
    save();
    return librarySnapshot();
  });
  handler('duo:library:activate', (value) => {
    guardMutation();
    library.activate(value);
    save();
    return librarySnapshot();
  });
  handler('duo:library:patch', ({ kind, id, values }) => {
    guardMutation();
    library.patchRecord(kind, id, values);
    save();
    return librarySnapshot();
  });
  handler('duo:project:parent', async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Emplacement nouveau projet',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory'],
    });
    if (picked.canceled) return null;
    const parent = directory(picked.filePaths[0]);
    approvedParents.add(parent);
    return parent;
  });
  handler('duo:project:create', (values) =>
    withMutation(async () => {
      if (!values || !approvedParents.has(values.parent))
        throw new Error('Choisir emplacement avec sélecteur dossier.');
      const result = await createProjectFolder(values, git);
      library.importProject(result.path, values.name);
      save();
      return { ...librarySnapshot(), warning: result.warning };
    })
  );
  handler('duo:project:relink', async (id) => {
    guardMutation();
    const picked = await dialog.showOpenDialog(window, {
      title: 'Rechoisir dossier projet déplacé',
      properties: ['openDirectory'],
    });
    if (picked.canceled) return null;
    guardMutation();
    library.relinkProject(id, picked.filePaths[0]);
    save();
    return librarySnapshot();
  });
  handler('duo:github:repos', listGitHubRepos);
  handler('duo:project:cancel', () => {
    projectOperation?.controller.abort();
    return true;
  });
  handler('duo:project:clone', (values) =>
    withProjectOperation('clone', 'Clonage GitHub', async (options) => {
      if (!values || !approvedParents.has(values.parent))
        throw new Error('Choisir emplacement avec sélecteur dossier.');
      const result = await cloneGitHub(values, options);
      library.importProject(result.path, values.name);
      save();
      return librarySnapshot();
    })
  );
  handler('duo:project:worktree', (values) =>
    withProjectOperation('worktree', 'Création worktree Git', async (options) => {
      if (!values || !approvedParents.has(values.parent))
        throw new Error('Choisir emplacement avec sélecteur dossier.');
      const source = library.data.projects.find((p) => p.id === values.projectId);
      if (!source || source.archived) throw new Error('Projet source introuvable.');
      const result = await createWorktree(source.path, values, options),
        created = library.importProject(result.path, values.name);
      created.settings = {
        ...source.settings,
        ...(source.settings.skills ? { skills: [...source.settings.skills] } : {}),
      };
      created.description = source.description;
      save();
      return librarySnapshot();
    })
  );
  handler('duo:project', async () => {
    if (orchestrator.active) throw new Error('Arrêter mission avant changement projet.');
    const picked = await dialog.showOpenDialog(window, {
      title: 'Choisir projet pour Duo',
      properties: ['openDirectory'],
    });
    if (picked.canceled) return null;
    guardMutation();
    const chosen = picked.filePaths[0];
    const info = await inspectGit(chosen);
    guardMutation();
    library.importProject(chosen);
    save();
    return { ...librarySnapshot(), project: store.settings.project, git: info };
  });
  handler('duo:settings', (values) => {
    library.updateSettings(values);
    save();
    return store.settings;
  });
  handler('duo:new', () => {
    const session = library.newSession();
    save();
    return session;
  });
  handler('duo:session:activate', (id) => {
    const session = store.sessions.find((s) => s.id === id);
    if (mutationActive || session?.projectId !== store.activeProjectId) guardMutation();
    library.activateSession(id);
    save();
    return librarySnapshot();
  });
  handler('duo:session:patch', ({ id, values }) => {
    if (mutationActive || orchestrator.active?.sessionId === id) guardMutation();
    const session = library.patchSession(id, values);
    save();
    return session;
  });
  handler('duo:session:rebind', (id) =>
    withMutation(async () => {
      const session = store.sessions.find((item) => item.id === id && !item.archived);
      if (
        !session ||
        !['waiting_user', 'failed', 'paused', 'stopped', 'attention'].includes(session.state)
      )
        throw new Error('Mission doit être interrompue avant changer dossier.');
      if (
        session.tasks.some((task) => task.status === 'done') ||
        session.recap?.changes.length ||
        session.results?.some(
          (entry) => entry.remote && ['created', 'modified', 'command'].includes(entry.kind)
        )
      )
        throw new Error(
          'Travail déjà effectué dans ce projet. Conserver cette mission et créer nouvelle mission pour autre dossier.'
        );
      if (dirtyEditors || Object.values(dirtyByProject || {}).some(Boolean))
        throw new Error('Enregistrer brouillons avant changer dossier mission.');
      const picked = await dialog.showOpenDialog(window, {
        title: 'Choisir dossier existant pour cette mission',
        properties: ['openDirectory'],
        defaultPath: path.dirname(session.project),
      });
      if (picked.canceled) return null;
      const previous = session.project,
        project = library.importProject(picked.filePaths[0]);
      session.project = project.path;
      session.projectId = project.id;
      session.workspaceId = project.workspaceId;
      const selectedSSH = library.settings.sshProfileId;
      library.updateSettings({ ...configPatch(session.config), sshProfileId: selectedSSH });
      session.config = { ...session.config, ...library.settings };
      session.progress ||= {
        objective:
          [...session.messages].find((item) => item.agent === 'user')?.text || session.title,
        mode: session.config.mode,
        updates: [],
      };
      session.progress.stage = 'plan';
      session.progress.planText = null;
      session.progress.updates ||= [];
      session.progress.updates.push(
        `Utilisateur a choisi nouveau dossier : ${project.path}. Ancien dossier : ${previous}. Réinspecter sources, construire nouveau plan pour dossier choisi.`
      );
      session.progress.baseline = captureMission(project.path);
      session.tasks = [];
      session.recap = null;
      session.waiting = null;
      session.state = 'paused';
      session.phase = '';
      orchestrator.message(
        session,
        'system',
        'Dossier corrigé',
        `Mission conservée. Nouveau dossier : ${project.path}. Reprendre pour inspecter sources et établir plan adapté.`
      );
      save();
      return librarySnapshot();
    })
  );
  handler('duo:ssh:list', () => store.sshProfiles);
  handler('duo:ssh:key', async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Choisir clé privée OpenSSH (contenu jamais importé)',
      properties: ['openFile'],
    });
    return picked.canceled ? null : picked.filePaths[0];
  });
  handler('duo:ssh:save', (input) =>
    withMutation(async () => {
      ssh.save(input);
      save();
      return store.sshProfiles;
    })
  );
  handler('duo:ssh:delete', (id) =>
    withMutation(async () => {
      if (!store.sshProfiles.some((profile) => profile.id === id))
        throw new Error('Connexion SSH introuvable.');
      store.sshProfiles.splice(
        store.sshProfiles.findIndex((profile) => profile.id === id),
        1
      );
      for (const project of store.projects)
        if (project.settings.sshProfileId === id) project.settings.sshProfileId = '';
      if (store.defaultSettings.sshProfileId === id) store.defaultSettings.sshProfileId = '';
      save();
      return store.sshProfiles;
    })
  );
  handler('duo:ssh:test', (id) => withMutation(() => ssh.call(id, 'probe')));
  handler('duo:skill:detail', (id) => skillManager.detail(id, store.settings.project));
  handler('duo:skill:create', (values) => {
    const result = skillManager.create(values);
    return { ...result, skills: librarySnapshot().skills };
  });
  handler('duo:skill:update', ({ id, ...values }) => {
    guardMutation();
    const result = skillManager.update(id, values);
    return { ...result, skills: librarySnapshot().skills };
  });
  handler('duo:skill:reveal', (id) =>
    shell.openPath(skillManager.detail(id, store.settings.project).root)
  );
  handler('duo:skill:import', async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Importer dossier contenant SKILL.md',
      properties: ['openDirectory'],
    });
    if (picked.canceled) return null;
    const result = skillManager.import(picked.filePaths[0]);
    return { ...result, skills: librarySnapshot().skills };
  });
  const runMission = ({ sessionId, prompt, config }, targetProjectId = null) =>
    withMutation(async () => {
      if (!config || typeof config !== 'object') throw new Error('Réglages mission requis.');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 60000)
        throw new Error('Prompt requis (max. 60 000 caractères).');
      const target = library.data.projects.find(
        (item) => item.id === (targetProjectId || store.activeProjectId) && !item.archived
      );
      if (
        !target ||
        !store.workspaces.some((item) => item.id === target.workspaceId && !item.archived)
      )
        throw new Error('Projet mission introuvable ou archivé.');
      const project = directory(target.path);
      config = { ...DEFAULT_SETTINGS, ...configPatch(config) };
      if (!['discuss', 'build'].includes(config.mode)) throw new Error('Mode invalide.');
      if (config.mode === 'build' && (dirtyByProject ? dirtyByProject[target.id] : dirtyEditors))
        throw new Error('Enregistrer ou fermer brouillons éditeur avant construire.');
      const rounds = Number(config.rounds);
      if (![1, 2, 3, 4, 5].includes(rounds)) throw new Error('Nombre de tours invalide.');
      const session = store.sessions.find((s) => s.id === sessionId);
      if (!session) throw new Error('Mission introuvable.');
      if (session.messages.length && session.project !== project)
        throw new Error(
          'Mission liée à autre projet. Rechoisir dossier précédent ou créer nouvelle mission.'
        );
      const status = await connections(codex, project);
      if (config.mode === 'build' && (dirtyByProject ? dirtyByProject[target.id] : dirtyEditors))
        throw new Error('Enregistrer ou fermer brouillons éditeur avant construire.');
      if (!status.connections.codex.connected || !status.connections.claude.connected)
        throw new Error(
          'Connecter Codex + Claude Code via leurs CLI officiels, puis actualiser connexions.'
        );
      for (const value of [
        config.codexModel,
        config.claudeModel,
        config.codexEffort,
        config.claudeEffort,
      ])
        if (typeof value !== 'string' || value.length > 160)
          throw new Error('Modèle ou effort invalide.');
      validateModels(config, status.catalogs);
      const availableSkills = skillManager.list(project).filter((s) => !s.invalid);
      const skills = Array.isArray(config.skills)
        ? config.skills.filter((id) => availableSkills.some((s) => s.id === id))
        : [];
      const normalized = {
        ...config,
        project,
        projectId: target.id,
        workspaceId: target.workspaceId,
        projectBrief: target.description || '',
        rounds,
        skills,
        commands: config.commands === true || config.accessMode === 'full',
      };
      if (normalized.sshProfileId) ssh.profile(normalized.sshProfileId);
      if (session.archived || session.projectId !== target.id)
        throw new Error(
          'Mission liée à autre projet ou archivée. Créer nouvelle mission dans projet actif.'
        );
      session.projectId = target.id;
      session.workspaceId = target.workspaceId;
      session.title = session.messages.length ? session.title : prompt.trim().slice(0, 64);
      orchestrator.start(session, prompt.trim(), normalized);
      return session;
    });
  handler('duo:run', runMission);
  scheduler = new Scheduler(store.schedules, {
    launch: (job) => runMission(job, job.projectId),
    available: () => !orchestrator.active && !mutationActive && !projectOperation,
    save,
    notify: (error) => emit({ type: 'schedule/changed', schedules: store.schedules, error }),
  });
  scheduler.start();
  handler('duo:schedule:create', ({ prompt, dueAt, config }) => {
    guardMutation();
    validProject(store.settings.project);
    const normalized = { ...DEFAULT_SETTINGS, ...configPatch(config || {}) };
    const session = library.newSession();
    session.title =
      String(prompt || '')
        .trim()
        .slice(0, 64) || 'Mission planifiée';
    try {
      scheduler.add({
        prompt,
        dueAt,
        config: normalized,
        projectId: store.activeProjectId,
        sessionId: session.id,
      });
    } catch (error) {
      store.sessions.splice(store.sessions.indexOf(session), 1);
      throw error;
    }
    return librarySnapshot();
  });
  handler('duo:schedule:cancel', (id) => {
    scheduler.cancel(id);
    return store.schedules;
  });
  const memoryTarget = ({ scope = 'project', projectId } = {}) => {
    if (scope === 'personal') return { owner: store, key: 'personalMemory' };
    if (scope !== 'project') throw new Error('Portée mémoire invalide.');
    projectFor(projectId);
    return { owner: library.project, key: 'memory' };
  };
  handler('duo:memory:list', () => ({
    projectId: store.activeProjectId,
    notes: cleanMemory(library.project?.memory),
    personalNotes: cleanMemory(store.personalMemory),
  }));
  handler('duo:memory:preview', ({ text, source }) => previewMemory(text, source));
  handler('duo:memory:file', async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: 'Importer mémoire',
      filters: [{ name: 'Mémoire UTF-8', extensions: ['md', 'txt', 'json'] }],
      properties: ['openFile'],
    });
    return picked.canceled ? null : readMemoryImport(picked.filePaths[0]);
  });
  handler('duo:memory:import', ({ notes, source, ...target }) => {
    guardMutation();
    const { owner, key } = memoryTarget(target);
    const result = mergeMemory(owner[key], notes, source);
    owner[key] = result.notes;
    save();
    return result;
  });
  handler('duo:memory:export', async (target) => {
    const { owner, key } = memoryTarget(target),
      content = exportMemory(owner[key], target.scope || 'project');
    const result = await dialog.showSaveDialog(window, {
      defaultPath:
        target.scope === 'personal' ? 'duo-memoire-personnelle.json' : 'duo-memoire-projet.json',
      filters: [{ name: 'Mémoire Duo', extensions: ['json'] }],
    });
    if (result.canceled) return null;
    fs.writeFileSync(result.filePath, content, 'utf8');
    return result.filePath;
  });
  handler('duo:usage', () => {
    const entries = store.usageLedger.filter((entry) => entry.at > Date.now() - 86400000);
    return {
      calls: entries.length,
      tokens: entries.reduce((sum, entry) => sum + entry.actualTokens, 0),
      chargedTokens: entries.reduce((sum, entry) => sum + entry.chargedTokens, 0),
      unknown: entries.filter((entry) => !entry.usageKnown || entry.state === 'interrupted').length,
    };
  });
  handler('duo:quota', async () => ({
    at: Date.now(),
    codex: lastConnections?.connections.codex.connected
      ? await codex.quota().catch(() => null)
      : null,
    claude: null,
  }));
  handler('duo:memory:save', ({ id, projectId, scope, expectedUpdatedAt, ...values }) => {
    guardMutation();
    const { owner, key } = memoryTarget({ scope, projectId });
    const notes = (owner[key] ||= []);
    const note = createNote(values);
    if (id) {
      const index = notes.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('Note introuvable.');
      if (notes[index].updatedAt !== expectedUpdatedAt)
        throw new Error('Note modifiée. Actualiser mémoire.');
      notes[index] = {
        ...note,
        id,
        at: notes[index].at,
        source: notes[index].source,
        updatedAt: Math.max(note.updatedAt, (notes[index].updatedAt || 0) + 1),
      };
    } else {
      if (notes.length >= MAX_NOTES)
        throw new Error('200 notes maximum. Supprimer notes anciennes.');
      notes.push(note);
    }
    save();
    return notes;
  });
  handler('duo:memory:delete', ({ id, projectId, scope }) => {
    guardMutation();
    const { owner, key } = memoryTarget({ scope, projectId });
    owner[key] = cleanMemory(owner[key]).filter((note) => note.id !== id);
    save();
    return owner[key];
  });
  handler('duo:stop', () => {
    orchestrator.stop();
    return true;
  });
  handler('duo:files:list', ({ projectId, relative }) =>
    listFiles(projectFor(projectId), relative)
  );
  handler('duo:files:search', ({ projectId, query }) => searchFiles(projectFor(projectId), query));
  handler('duo:files:read', ({ projectId, relative }) => readFile(projectFor(projectId), relative));
  handler('duo:files:save', ({ projectId, ...value }) => {
    guardMutation();
    return saveFile(projectFor(projectId), value);
  });
  handler('duo:editor:dirty', (value) => {
    const count = typeof value === 'number' ? value : value?.total;
    if (!Number.isInteger(count) || count < 0 || count > 5000)
      throw new Error('État éditeur invalide.');
    let projects = null;
    if (typeof value === 'object' && value?.projects && !Array.isArray(value.projects)) {
      projects = {};
      let total = 0;
      for (const [id, amount] of Object.entries(value.projects)) {
        if (
          !store.projects.some((p) => p.id === id) ||
          !Number.isInteger(amount) ||
          amount < 0 ||
          amount > 500
        )
          throw new Error('État brouillons projet invalide.');
        projects[id] = amount;
        total += amount;
      }
      if (total !== count) throw new Error('Nombre brouillons incohérent.');
    }
    dirtyEditors = count;
    dirtyByProject = projects;
    return true;
  });
  handler('duo:git', () => inspectGit(validProject(store.settings.project)));
  handler('duo:commit', (payload) =>
    withMutation(() => commitSelected(validProject(store.settings.project), payload))
  );
  handler('duo:push', () =>
    withMutation(async () => {
      const project = validProject(store.settings.project);
      const info = await inspectGit(project);
      const { response } = await dialog.showMessageBox(window, {
        type: 'question',
        message: 'Publier commits vers dépôt distant ?',
        detail: `Dépôt : ${info.root}\nBranche : ${info.branch}\nDistant : ${info.remote}\n\nPush publie tous commits locaux de cette branche.`,
        buttons: ['Annuler', 'Publier commits'],
        defaultId: 0,
        cancelId: 0,
      });
      if (response !== 1) return null;
      await git(project, ['push']);
      return 'Push terminé.';
    })
  );
  handler('duo:remote', async () => {
    const info = await inspectGit(validProject(store.settings.project));
    const url = remoteUrl(info.remote || '');
    if (!url) throw new Error('Aucun dépôt GitHub associé à origin.');
    await shell.openExternal(url);
    return true;
  });
  handler('duo:copy', (text) => {
    if (typeof text !== 'string' || text.length > 500000) throw new Error('Texte invalide.');
    clipboard.writeText(text);
    return true;
  });
  handler('duo:link', async (value) => {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('Liens HTTPS uniquement.');
    await shell.openExternal(url.href);
    return true;
  });
  handler('duo:reveal', () => shell.openPath(validProject(store.settings.project)));
  handler('duo:export', async (id) => {
    const session = store.sessions.find((s) => s.id === id);
    if (!session) throw new Error('Mission introuvable.');
    const result = await dialog.showSaveDialog(window, {
      defaultPath: `duo-${id.slice(0, 8)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled) return null;
    fs.writeFileSync(result.filePath, formatSession(session), 'utf8');
    return result.filePath;
  });
  handler('duo:window', (action) => {
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
}

app.setName('Duo');
if (process.env.DUO_TEST_USER_DATA)
  app.setPath('userData', path.resolve(process.env.DUO_TEST_USER_DATA));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(() => {
      Menu.setApplicationMenu(null);
      storeFile = path.join(app.getPath('userData'), 'workspace.json');
      persistence = new JsonStore(storeFile);
      const loadedStore = persistence.load(),
        parsed = loadedStore.data;
      if (loadedStore.recovered) storageWarning = 'Historique récupéré depuis sauvegarde locale.';
      library = new Library(parsed);
      store = library.data;
      Object.defineProperty(store, 'settings', { get: () => library.settings, enumerable: false });
      skillManager = new Skills(skillRoot(), path.join(app.getPath('userData'), 'skills'));
      ssh = new SSH({ profiles: store.sshProfiles });
      save();
      if (loadedStore.recovered && !storageWarning)
        storageWarning = 'Historique récupéré depuis sauvegarde locale.';
      orchestrator = new Orchestrator(
        { codex, claude: new ClaudeProvider() },
        emit,
        save,
        skillContext,
        undefined,
        {
          ledger: store.usageLedger,
          ssh,
          memory: (config, prompt) =>
            sharedMemoryContext(
              store.projects.find((project) => project.id === config.projectId)?.memory,
              store.personalMemory,
              prompt,
              config
            ),
          checkpoint: (session, config) => {
            if (config.memoryEnabled)
              checkpoint(
                store.projects.find((project) => project.id === config.projectId),
                session
              );
          },
        }
      );
      window = new BrowserWindow({
        width: 1460,
        height: 960,
        minWidth: 940,
        minHeight: 660,
        frame: false,
        backgroundColor: '#111413',
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      register();
      window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
      window.once('ready-to-show', () => {
        if (!process.env.DUO_TEST_USER_DATA) window.show();
      });
      window.on('close', (event) => {
        if (dirtyEditors && !closeAfterOperation) {
          const choice = dialog.showMessageBoxSync(window, {
            type: 'question',
            message: 'Changements non enregistrés. Fermer sans enregistrer ?',
            detail: `${dirtyEditors} fichier(s) ouvert(s) modifié(s).`,
            buttons: ['Continuer édition', 'Fermer sans enregistrer'],
            defaultId: 0,
            cancelId: 0,
          });
          if (choice === 0) return event.preventDefault();
        }
        if (projectOperation) {
          event.preventDefault();
          const choice = dialog.showMessageBoxSync(window, {
            type: 'question',
            message: 'Opération projet en cours. Arrêter puis fermer ?',
            detail: projectOperation.title,
            buttons: ['Continuer opération', 'Arrêter + fermer'],
            defaultId: 0,
            cancelId: 0,
          });
          if (choice === 1) {
            closeAfterOperation = true;
            projectOperation.controller.abort();
          }
          return;
        }
        if (orchestrator.active) {
          const choice = dialog.showMessageBoxSync(window, {
            type: 'question',
            message: 'Mission en cours. Arrêter puis fermer ?',
            buttons: ['Continuer mission', 'Arrêter + fermer'],
            defaultId: 0,
            cancelId: 0,
          });
          if (choice === 0) return event.preventDefault();
          orchestrator.stop();
          const session = store.sessions.find((s) => s.id === orchestrator.active.sessionId);
          if (session) session.state = 'stopped';
          save();
        }
        codex.close();
        scheduler.close();
        fileObserver.close();
      });
    })
    .catch((error) => {
      codex.close();
      fileObserver.close();
      dialog.showErrorBox(
        'Duo · démarrage interrompu',
        `${error.message}\n\nHistorique conservé dans :\n${storeFile || app.getPath('userData')}\n\nFermer autres instances Duo. Pour historique de version plus récente, ouvrir version correspondante.`
      );
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
}
