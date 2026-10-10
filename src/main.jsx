import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MessageBody from './MessageBody';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Folder,
  FolderOpen,
  MessageSquare,
  Layers,
  Plug,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Minus,
  Square,
  GitBranch,
  GitCommitHorizontal,
  GitFork as Github,
  RefreshCw,
  Download,
  Copy,
  Sparkles,
  SlidersHorizontal,
  Circle,
  CheckCircle2,
  AlertCircle,
  StopCircle,
  Workflow,
  Eye,
  Code2,
  ExternalLink,
  Loader2,
  Clock3,
  CalendarClock,
} from 'lucide-react';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/jetbrains-mono/400.css';
import './style.css';
import LibraryView from './LibraryView';
import SessionList from './SessionList';
import FilesView from './FilesView';
import ConnectionsModal from './ConnectionsModal';
import UpdatesModal from './UpdatesModal';
import SkillsView from './SkillsView';
import ModelsView, { highestEffort } from './ModelsView';
import ActivityPanel from './ActivityPanel';
import PilotView, { ScheduleDialog } from './PilotView';
import { Modal, IconButton, ErrorContext } from './ui';

const api = window.duo;
const labels = { codex: 'Codex', claude: 'Claude', user: 'Vous', system: 'Duo' };
const skillIcons = {
  caveman: MessageSquare,
  engineering: Code2,
  review: Eye,
  'ui-ux-pro-max': Sparkles,
};
const basename = (value) => value?.split(/[\\/]/).filter(Boolean).pop() || 'Aucun projet';
function Mark({ small = false }) {
  return (
    <span className={`duo-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}
function AgentMark({ agent }) {
  return (
    <span className={`agent-mark ${agent}`} aria-hidden="true">
      {agent === 'codex' ? <Workflow size={18} /> : <Sparkles size={18} />}
    </span>
  );
}

function App() {
  const [loaded, setLoaded] = useState(false),
    [sessions, setSessions] = useState([]),
    [current, setCurrent] = useState(null);
  const [config, setConfig] = useState({
    mode: 'discuss',
    rounds: 1,
    skills: [],
    project: '',
    claudeModel: 'opus',
    claudeEffort: 'max',
  });
  const [models, setModels] = useState([]),
    [catalogs, setCatalogs] = useState({ codex: [], claude: [] }),
    [skills, setSkills] = useState([]),
    [connections, setConnections] = useState({});
  const [fileChanges, setFileChanges] = useState({});
  const [fileBuffers, setFileBuffers] = useState({});
  const [library, setLibrary] = useState({
    workspaces: [],
    projects: [],
    sessions: [],
    templates: [],
  });
  const [streams, setStreams] = useState({}),
    [active, setActive] = useState(null),
    [tools, setTools] = useState({});
  const [prompt, setPrompt] = useState(''),
    [view, setView] = useState('workspace'),
    [inspector, setInspector] = useState('mission');
  const [modal, setModal] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [gitInfo, setGitInfo] = useState(null),
    [selectedFiles, setSelectedFiles] = useState([]),
    [commitMessage, setCommitMessage] = useState('');
  const [projectOperation, setProjectOperation] = useState(null);
  const [checkingConnections, setCheckingConnections] = useState(true);
  const [storageNotice, setStorageNotice] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const scrollRef = useRef(null),
    textRef = useRef(null);
  const session = sessions.find((s) => s.id === current);
  const running = !!active;
  const runningSession = sessions.find((s) => s.id === active);
  const perform = async (work) => {
    try {
      setError('');
      return await work();
    } catch (e) {
      setError(e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
      return null;
    }
  };
  const normalizeConfig = (settings, codexModels = models, claudeModels = catalogs.claude) => {
    const codexModel =
      codexModels.find((m) => m.id === settings.codexModel) ||
      codexModels.find((m) => m.default) ||
      codexModels[0];
    const claudeModel = claudeModels.find((m) => m.id === settings.claudeModel);
    return {
      ...settings,
      codexModel: codexModel?.id || settings.codexModel || '',
      codexEffort: codexModel?.efforts.includes(settings.codexEffort)
        ? settings.codexEffort
        : highestEffort(codexModel),
      claudeEffort: claudeModel?.efforts.includes(settings.claudeEffort)
        ? settings.claudeEffort
        : '',
    };
  };
  const applyData = (data) => {
    setLibrary(data);
    setSessions(data.sessions);
    if (data.skills) setSkills(data.skills);
    setConfig(normalizeConfig(data.settings));
    setCurrent((old) =>
      data.sessions.some((s) => s.id === old && !s.archived && s.projectId === data.activeProjectId)
        ? old
        : data.sessions.find(
            (s) =>
              !s.archived &&
              s.projectId === data.activeProjectId &&
              s.workspaceId === data.activeWorkspaceId
          )?.id || null
    );
    setGitInfo(null);
    setSelectedFiles([]);
  };
  const refresh = async () => {
    setBusy(true);
    setCheckingConnections(true);
    try {
      await perform(async () => {
        const result = await api.connections();
        setConnections(result.connections);
        setModels(result.models);
        setCatalogs(result.catalogs);
        setConfig((old) => normalizeConfig(old, result.models, result.catalogs.claude));
      });
    } finally {
      setBusy(false);
      setCheckingConnections(false);
    }
  };
  const activateProject = async (value) => {
    const data = await perform(() => api.activateProject(value));
    if (data) {
      applyData(data);
      setView('workspace');
    }
  };
  const selectSession = async (item) => {
    const data = await perform(() => api.activateSession(item.id));
    if (data) {
      applyData(data);
      setCurrent(item.id);
      setView('workspace');
    }
  };
  const loadGit = async () => {
    const result = await perform(() => api.git());
    if (result) {
      setGitInfo(result);
      setSelectedFiles([]);
    }
  };
  const changeConfig = (values) => {
    setConfig((old) => ({ ...old, ...values }));
    perform(() => api.settings(values));
  };
  const newSession = async () => {
    const result = await perform(() => api.newSession());
    if (result) {
      setSessions((old) => [result, ...old]);
      setCurrent(result.id);
      setView('workspace');
      setPrompt('');
      textRef.current?.focus();
    }
  };
  const pickProject = async () => {
    const result = await perform(() => api.pickProject());
    if (result) {
      applyData(result);
      setGitInfo(result.git);
    }
  };
  const toggleSkill = (id) =>
    changeConfig({
      skills: config.skills.includes(id)
        ? config.skills.filter((s) => s !== id)
        : [...config.skills, id],
    });

  useEffect(() => {
    if (!api) {
      setError('Interface desktop requise. Lancer npm start ou Duo.exe.');
      setLoaded(true);
      return;
    }
    const pendingDeltas = new Map();
    let streamTimer;
    const flushStreams = () => {
      const batch = new Map(pendingDeltas);
      pendingDeltas.clear();
      streamTimer = null;
      setStreams((old) => {
        const next = { ...old };
        for (const [id, delta] of batch)
          if (next[id]) next[id] = { ...next[id], text: next[id].text + delta };
        return next;
      });
    };
    const unsubscribe = api.onEvent((event) => {
      if (event.type === 'files/changed') {
        setFileChanges((old) => ({
          ...old,
          [event.projectId]: {
            revision: (old[event.projectId]?.revision || 0) + 1,
            paths: event.paths,
          },
        }));
        return;
      }
      if (event.type === 'files/watch-unavailable') {
        setNotice('Surveillance fichiers indisponible. Actualiser explorateur manuellement.');
        return;
      }
      if (event.type === 'schedule/changed') {
        setLibrary((old) => ({ ...old, schedules: event.schedules }));
        if (event.error) setError(event.error);
        return;
      }
      if (event.type === 'project/operation') {
        setProjectOperation(event.operation);
        return;
      }
      if (event.type === 'storage/warning') {
        setStorageNotice(event.warning);
        return;
      }
      if (event.type === 'stream/start')
        setStreams((old) => ({ ...old, [event.id]: { ...event, text: '' } }));
      if (event.type === 'stream/delta') {
        pendingDeltas.set(event.id, (pendingDeltas.get(event.id) || '') + event.delta);
        if (!streamTimer) streamTimer = setTimeout(flushStreams, 32);
      }
      if (event.type === 'stream/end' || event.type === 'message') {
        pendingDeltas.delete(event.id || event.message.id);
        setStreams((old) => {
          const next = { ...old };
          delete next[event.id || event.message.id];
          return next;
        });
      }
      if (event.type === 'tool') {
        setTools((old) => ({ ...old, [event.agent]: { tool: event.tool, detail: event.detail } }));
        if (event.entry)
          setSessions((old) =>
            old.map((item) =>
              item.id === event.sessionId
                ? { ...item, activity: [...(item.activity || []), event.entry].slice(-500) }
                : item
            )
          );
      }
      if (['message', 'phase', 'tasks', 'metrics', 'budget', 'complete'].includes(event.type))
        setSessions((old) =>
          old.map((item) => {
            if (item.id !== event.sessionId) return item;
            if (event.type === 'message')
              return {
                ...item,
                messages: [
                  ...item.messages.filter((m) => m.id !== event.message.id),
                  event.message,
                ],
              };
            if (event.type === 'phase') return { ...item, phase: event.phase, state: 'running' };
            if (event.type === 'tasks') return { ...item, tasks: event.tasks };
            if (event.type === 'budget') return { ...item, budget: event.budget };
            if (event.type === 'metrics') return { ...item, metrics: event.metrics };
            if (event.type === 'complete') return event.session;
            return item;
          })
        );
      if (event.type === 'phase') setActive(event.sessionId);
      if (event.type === 'complete') {
        pendingDeltas.clear();
        clearTimeout(streamTimer);
        streamTimer = null;
        setActive(null);
        setStreams({});
        setTools({});
      }
    });
    perform(async () => {
      const data = await api.bootstrap();
      setLibrary(data);
      setSessions(data.sessions);
      setSkills(data.skills);
      setConnections(data.connections);
      setModels(data.models);
      setCatalogs(data.catalogs);
      setActive(data.activeSession);
      setProjectOperation(data.projectOperation);
      if (data.storageWarning) setStorageNotice(data.storageWarning);
      setConfig(normalizeConfig(data.settings, data.models, data.catalogs.claude));
      setCurrent(
        data.sessions.find(
          (s) =>
            !s.archived &&
            s.projectId === data.activeProjectId &&
            s.workspaceId === data.activeWorkspaceId
        )?.id || null
      );
      setLoaded(true);
      await refresh();
    }).finally(() => setLoaded(true));
    return () => {
      clearTimeout(streamTimer);
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' });
  }, [
    session?.messages.length,
    Object.values(streams)
      .map((s) => s.text.length)
      .join(','),
  ]);
  useEffect(() => {
    if (inspector === 'git' && config.project) loadGit();
  }, [inspector, config.project, active]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const handler = (event) => {
      if (!loaded || document.querySelector('dialog[open]') || !event.ctrlKey) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newSession();
      }
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (config.project) {
          setView('files');
          setQuickOpen(true);
        } else {
          setView('projects');
          setNotice('Choisir projet avant recherche fichiers.');
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [loaded, config.project]);

  const launch = async () => {
    if (!prompt.trim() || running || busy || projectOperation || checkingConnections || !loaded)
      return;
    if (!config.project) {
      setError('Choisir dossier projet avant lancement.');
      return;
    }
    if (config.mode === 'build' && dirtyCounts[library.activeProjectId]) {
      setError('Enregistrer ou fermer brouillons éditeur avant construire.');
      setView('files');
      return;
    }
    if (!connections.codex?.connected || !connections.claude?.connected) {
      setModal('connections');
      return;
    }
    setBusy(true);
    let started = false;
    await perform(async () => {
      let id = current;
      if (!id) {
        const created = await api.newSession();
        setSessions((old) => [created, ...old]);
        setCurrent(created.id);
        id = created.id;
      }
      setActive(id);
      const result = await api.run({ sessionId: id, prompt, config });
      started = true;
      setSessions((old) => old.map((s) => (s.id === id ? { ...s, title: result.title } : s)));
      if (result.state !== 'running') setActive(null);
      setPrompt('');
      setView('workspace');
    });
    if (!started) setActive(null);
    setBusy(false);
  };
  const commit = async () => {
    setBusy(true);
    const result = await perform(() =>
      api.commit({ files: selectedFiles, message: commitMessage, signature: gitInfo.signature })
    );
    if (result) {
      setNotice('Commit créé.');
      setCommitMessage('');
      await loadGit();
    }
    setBusy(false);
  };
  const currentStreams = Object.values(streams).filter((s) => s.sessionId === current);
  const connectionCount = ['codex', 'claude'].filter((a) => connections[a]?.connected).length;
  const selectedModel = models.find((m) => m.id === config.codexModel);
  const selectedClaude = catalogs.claude.find((m) => m.id === config.claudeModel);
  const activeProject = library.projects.find((p) => p.id === library.activeProjectId);
  const visibleSessions = sessions.filter(
    (s) => s.projectId === library.activeProjectId && s.workspaceId === library.activeWorkspaceId
  );
  const messages = [...(session?.messages || []), ...currentStreams];
  const dirtyCounts = Object.fromEntries(
    Object.entries(fileBuffers).map(([id, value]) => [
      id,
      Object.values(value.documents || {}).filter((doc) => doc.content !== doc.savedContent).length,
    ])
  );
  const dirtyCount = Object.values(dirtyCounts).reduce((total, count) => total + count, 0);
  useEffect(() => {
    api?.editorDirty({ total: dirtyCount, projects: dirtyCounts }).catch(() => {});
  }, [JSON.stringify(dirtyCounts)]);
  const taskCount = session?.tasks.filter((t) => t.status === 'done').length || 0;

  return (
    <ErrorContext.Provider value={{ error, clearError: () => setError('') }}>
      <div className={`app ${view !== 'workspace' ? 'management-view' : ''}`}>
        <div className="titlebar">
          <div>
            <Mark small />
            <span>Duo</span>
            <span className="titlebar-separator">/</span>
            <span className="titlebar-project">{basename(config.project)}</span>
          </div>
          <span className="personal-label">WORKSPACE PERSONNEL</span>
          <div className="window-controls">
            <IconButton label="Réduire" onClick={() => api?.window('minimize')}>
              <Minus size={15} />
            </IconButton>
            <IconButton label="Agrandir" onClick={() => api?.window('maximize')}>
              <Square size={12} />
            </IconButton>
            <IconButton label="Fermer Duo" onClick={() => api?.window('close')}>
              <X size={16} />
            </IconButton>
          </div>
        </div>
        <aside className="sidebar">
          <div className="brand">
            <Mark />
            <div>
              <strong>
                duo<span>.</span>
              </strong>
              <small>Deux esprits. Un projet.</small>
            </div>
          </div>
          <label className="workspace-picker">
            Workspace
            <select
              aria-label="Workspace actif"
              value={library.activeWorkspaceId || ''}
              disabled={running || !!projectOperation || busy}
              onChange={(e) => activateProject({ workspaceId: e.target.value })}
            >
              {library.workspaces
                .filter((w) => !w.archived)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </label>
          <button className="new-button" onClick={newSession} disabled={!loaded}>
            <Plus size={17} />
            Nouvelle mission<span>Ctrl N</span>
          </button>
          <nav aria-label="Navigation principale">
            <button
              className={view === 'workspace' ? 'selected' : ''}
              onClick={() => setView('workspace')}
            >
              <MessageSquare size={17} />
              Espace de travail
            </button>
            <button
              className={view === 'skills' ? 'selected' : ''}
              onClick={() => setView('skills')}
            >
              <Layers size={17} />
              Skills<span className="nav-count">{config.skills.length}</span>
            </button>
            <button
              className={view === 'projects' ? 'selected' : ''}
              onClick={() => setView('projects')}
            >
              <FolderOpen size={17} />
              Projets
              <span className="nav-count">
                {library.projects.filter((p) => !p.archived).length}
              </span>
            </button>
            <button
              className={view === 'models' ? 'selected' : ''}
              onClick={() => setView('models')}
            >
              <SlidersHorizontal size={17} />
              Modèles
            </button>
            <button className={view === 'files' ? 'selected' : ''} onClick={() => setView('files')}>
              <Code2 size={17} />
              Fichiers{dirtyCount > 0 && <span className="nav-count">{dirtyCount}</span>}
            </button>
            <button className={view === 'pilot' ? 'selected' : ''} onClick={() => setView('pilot')}>
              <Clock3 size={17} />
              Pilotage & mémoire
            </button>
            <button onClick={() => setModal('connections')}>
              <Plug size={17} />
              Connexions
              <span className="connection-dot" />
            </button>
            <button onClick={() => setModal('updates')}>
              <Download size={17} />
              Mises à jour
            </button>
          </nav>
          <div className="sidebar-section">
            <span>MISSIONS</span>
            <IconButton label="Nouvelle mission" onClick={newSession}>
              <Plus size={14} />
            </IconButton>
          </div>
          <SessionList
            sessions={visibleSessions}
            current={current}
            projectId={library.activeProjectId}
            active={active}
            select={selectSession}
            perform={perform}
            update={(result) => {
              setSessions((old) => old.map((s) => (s.id === result.id ? result : s)));
              if (result.archived && result.id === current) setCurrent(null);
            }}
          />
          <button
            className="project-card"
            onClick={pickProject}
            disabled={running || !!projectOperation || busy}
          >
            <Folder size={18} />
            <span>
              <strong>{basename(config.project)}</strong>
              <small>{config.project ? 'Changer dossier' : 'Choisir dossier projet'}</small>
            </span>
            <ChevronRight size={15} />
          </button>
          <div className="sidebar-footer">
            <span className="local-dot" />
            Local · Windows<span>v{__APP_VERSION__}</span>
          </div>
        </aside>
        <main className="main">
          <header className="workspace-header">
            <div>
              <span>{view === 'skills' ? 'Personnalisation' : 'Espace de travail'}</span>
              <ChevronRight size={14} />
              <strong>
                {view === 'skills'
                  ? 'Skills'
                  : view === 'projects'
                    ? 'Projets & workspaces'
                    : view === 'models'
                      ? 'Modèles & effort'
                      : view === 'files'
                        ? 'Fichiers projet'
                        : view === 'pilot'
                          ? 'Pilotage & mémoire'
                          : session?.title || 'Nouvelle mission'}
              </strong>
            </div>
            <div className="header-actions">
              <span className="connection-pill">
                <i className={connectionCount === 2 ? 'ready' : ''} />
                {loaded && !checkingConnections
                  ? `${connectionCount}/2 IA connectées`
                  : 'Connexion…'}
              </span>
              {session?.messages.length > 0 && (
                <IconButton
                  label="Exporter conversation"
                  onClick={() => perform(() => api.export(current))}
                >
                  <Download size={17} />
                </IconButton>
              )}
              <IconButton label="Réglages mission" onClick={() => setModal('settings')}>
                <SlidersHorizontal size={18} />
              </IconButton>
            </div>
          </header>
          {running && (view !== 'workspace' || current !== active) && (
            <div className="global-mission-bar" role="status">
              <Loader2 size={14} className="spin" />
              <span>{runningSession?.phase || 'Mission en cours'}</span>
              <button onClick={() => runningSession && selectSession(runningSession)}>
                Voir mission
              </button>
              <button onClick={() => perform(() => api.stop())}>
                <StopCircle size={14} />
                Arrêter
              </button>
            </div>
          )}
          {projectOperation && (
            <div className="global-mission-bar project-operation" role="status">
              <Loader2 size={14} className="spin" />
              <span>
                <strong>{projectOperation.title}</strong> · {projectOperation.detail}
              </span>
              <button onClick={() => perform(() => api.cancelProjectOperation())}>
                <StopCircle size={14} />
                Annuler opération
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <IconButton label="Fermer erreur" onClick={() => setError('')}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {storageNotice && (
            <div className="error-banner storage-warning" role="alert">
              <AlertCircle size={17} />
              <span>{storageNotice}</span>
              <IconButton label="Fermer information stockage" onClick={() => setStorageNotice('')}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <CheckCircle2 size={17} />
              {notice}
            </div>
          )}
          {view === 'pilot' ? (
            <PilotView
              config={config}
              changeConfig={changeConfig}
              project={activeProject}
              running={running || !!projectOperation}
              perform={perform}
              notify={setNotice}
              schedules={library.schedules || []}
              setSchedules={(schedules) => setLibrary((old) => ({ ...old, schedules }))}
              openSchedule={() => setModal('schedule')}
              openSession={(id) => {
                const item = sessions.find((s) => s.id === id);
                if (item) selectSession(item);
              }}
              session={runningSession || session}
            />
          ) : view === 'skills' ? (
            <SkillsView
              skills={skills}
              config={config}
              changeConfig={changeConfig}
              perform={perform}
              setSkills={setSkills}
              projectName={activeProject?.name}
              notify={setNotice}
            />
          ) : view === 'projects' ? (
            <LibraryView
              library={{ ...library, sessions }}
              running={running || !!projectOperation}
              perform={perform}
              applyData={applyData}
              notify={setNotice}
              openMissions={() => setView('workspace')}
            />
          ) : view === 'files' ? (
            <FilesView
              openQuickOpen={() => setQuickOpen(true)}
              quickOpen={quickOpen}
              closeQuickOpen={() => setQuickOpen(false)}
              project={activeProject}
              changes={fileChanges[library.activeProjectId]}
              running={running || !!projectOperation}
              buffers={fileBuffers}
              setBuffers={setFileBuffers}
              perform={perform}
              notify={setNotice}
            />
          ) : view === 'models' ? (
            <ModelsView
              catalogs={catalogs}
              config={config}
              changeConfig={changeConfig}
              connections={connections}
              refresh={refresh}
              busy={busy}
              perform={perform}
              notify={setNotice}
            />
          ) : (
            <>
              <div className="conversation" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="welcome">
                    <span className="eyebrow">
                      <i />
                      L’INTELLIGENCE, EN ÉQUIPE
                    </span>
                    <h1>
                      Une idée.
                      <br />
                      <span>Deux façons de l’améliorer.</span>
                    </h1>
                    <p>
                      Codex et Claude discutent, répartissent travail,
                      <br />
                      puis construisent votre projet ensemble.
                    </p>
                    <div className="agent-cards">
                      {['codex', 'claude'].map((agent) => (
                        <article key={agent} className={`agent-card ${agent}`}>
                          <div className="agent-card-top">
                            <AgentMark agent={agent} />
                            <strong>{labels[agent]}</strong>
                            <button
                              className={`agent-connection ${connections[agent]?.connected ? 'connected' : ''}`}
                              onClick={() => setModal('connections')}
                            >
                              <i />
                              {connections[agent]?.connected ? 'Connecté' : 'À connecter'}
                            </button>
                          </div>
                          <label className="model-select">
                            Modèle
                            <select
                              value={config[`${agent}Model`] || ''}
                              onChange={(e) =>
                                changeConfig(
                                  agent === 'codex'
                                    ? {
                                        codexModel: e.target.value,
                                        codexEffort: highestEffort(
                                          models.find((m) => m.id === e.target.value)
                                        ),
                                      }
                                    : {
                                        claudeModel: e.target.value,
                                        claudeEffort: highestEffort(
                                          catalogs.claude.find((m) => m.id === e.target.value)
                                        ),
                                      }
                                )
                              }
                            >
                              {agent === 'codex' ? (
                                models.length ? (
                                  models.map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.name}
                                    </option>
                                  ))
                                ) : (
                                  <option value="">Chargement modèles…</option>
                                )
                              ) : (
                                catalogs.claude.map((m) => (
                                  <option
                                    key={m.id}
                                    value={m.id}
                                    disabled={m.status === 'update-required'}
                                  >
                                    {m.name}
                                    {m.status === 'update-required' ? ' · actualiser CLI' : ''}
                                  </option>
                                ))
                              )}
                            </select>
                            <ChevronDown size={14} />
                          </label>
                          <div className="agent-card-bottom">
                            <span>
                              {agent === 'codex' ? 'Abonnement ChatGPT' : 'Abonnement Claude Code'}
                            </span>
                            <button onClick={() => setModal('settings')}>
                              Effort {config[`${agent}Effort`] || 'auto'} <ChevronDown size={11} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="workflow">
                      <span>
                        <MessageSquare size={14} />
                        Prompt partagé
                      </span>
                      <ArrowRight size={13} />
                      <span>
                        <Workflow size={14} />
                        Discussion
                      </span>
                      <ArrowRight size={13} />
                      <span>
                        <Code2 size={14} />
                        Construction
                      </span>
                      <ArrowRight size={13} />
                      <span>
                        <Eye size={14} />
                        Relecture
                      </span>
                    </div>
                    <div className="suggestions">
                      {[
                        [
                          Code2,
                          'Créer un projet',
                          'Passez de l’idée au code.',
                          'Crée une application de gestion de tâches. Proposez ensemble architecture, UX, puis répartissez implémentation.',
                        ],
                        [
                          GitBranch,
                          'Améliorer du code',
                          'Deux regards sur votre repo.',
                          'Analysez ce projet. Identifiez bugs concrets et améliorations utiles. Débattez priorités, puis proposez corrections.',
                        ],
                        [
                          Sparkles,
                          'Challenger une idée',
                          'Trouvez ce qui vous échappe.',
                          'Challengez cette idée : ',
                        ],
                      ].map(([Icon, title, text, value]) => (
                        <button
                          key={title}
                          onClick={() => {
                            setPrompt(value);
                            textRef.current?.focus();
                          }}
                        >
                          <Icon size={19} />
                          <strong>{title}</strong>
                          <span>{text}</span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="messages">
                    {messages.map((message) => (
                      <article key={message.id} className={`message ${message.agent}`}>
                        <div className="message-heading">
                          {['codex', 'claude'].includes(message.agent) ? (
                            <AgentMark agent={message.agent} />
                          ) : message.agent === 'user' ? (
                            <span className="user-avatar">V</span>
                          ) : (
                            <Mark small />
                          )}
                          <strong>{labels[message.agent]}</strong>
                          <span>{message.phase}</span>
                          {streams[message.id] ? (
                            <span className="stream-state">
                              <i />
                              En cours
                            </span>
                          ) : (
                            <IconButton
                              label="Copier message"
                              onClick={() =>
                                perform(async () => {
                                  await api.copy(message.text);
                                  setNotice('Message copié.');
                                })
                              }
                            >
                              <Copy size={14} />
                            </IconButton>
                          )}
                        </div>
                        <div className="message-body">
                          <MessageBody
                            message={message}
                            openUrl={(href) => perform(() => api.openUrl(href))}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div className="composer-area">
                {session?.phase && (
                  <div className="phase-bar" role="status">
                    <span className="pulse-dot" />
                    {session.phase}
                    <button onClick={() => perform(() => api.stop())}>
                      <StopCircle size={14} />
                      Arrêter
                    </button>
                  </div>
                )}
                <div className="composer">
                  <label htmlFor="prompt" className="sr-only">
                    Demande commune pour Codex et Claude
                  </label>
                  <textarea
                    id="prompt"
                    ref={textRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Une idée, un problème, un projet. Donnez-leur direction."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        launch();
                      }
                    }}
                    rows={3}
                  />
                  <div className="composer-controls">
                    <div>
                      <IconButton
                        label="Choisir dossier projet"
                        onClick={pickProject}
                        disabled={running}
                      >
                        <Folder size={18} />
                      </IconButton>
                      <div className="mode-switch">
                        <button
                          className={config.mode === 'discuss' ? 'active' : ''}
                          onClick={() => changeConfig({ mode: 'discuss' })}
                        >
                          <MessageSquare size={13} />
                          Discuter
                        </button>
                        <button
                          className={config.mode === 'build' ? 'active' : ''}
                          onClick={() => changeConfig({ mode: 'build' })}
                        >
                          <Code2 size={13} />
                          Construire
                        </button>
                      </div>
                      <button className="skill-chip" onClick={() => setView('skills')}>
                        <Layers size={13} />
                        {config.skills.length} skills
                      </button>
                    </div>
                    <IconButton
                      label="Planifier demande"
                      onClick={() => setModal('schedule')}
                      disabled={!config.project || running || !!projectOperation}
                    >
                      <CalendarClock size={18} />
                    </IconButton>
                    <button
                      className="send-button"
                      onClick={launch}
                      disabled={
                        !prompt.trim() ||
                        running ||
                        !!projectOperation ||
                        busy ||
                        checkingConnections ||
                        !loaded
                      }
                    >
                      {busy ? <Loader2 size={16} className="spin" /> : <ArrowUpRight size={17} />}
                      <span>Lancer Duo</span>
                    </button>
                  </div>
                </div>
                <div className="composer-footer">
                  <span>
                    <i />
                    {config.mode === 'build'
                      ? 'Écritures projet · relecture croisée'
                      : 'Discussion · lecture seule'}
                  </span>
                  <span>Ctrl + Entrée pour lancer</span>
                </div>
              </div>
            </>
          )}
        </main>
        <aside className="inspector">
          <div className="inspector-tabs">
            <button
              className={inspector === 'mission' ? 'active' : ''}
              onClick={() => setInspector('mission')}
            >
              <Workflow size={15} />
              Mission
            </button>
            <button
              className={inspector === 'git' ? 'active' : ''}
              onClick={() => setInspector('git')}
            >
              <GitBranch size={15} />
              Git
            </button>
          </div>
          {inspector === 'mission' ? (
            <div className="inspector-content">
              <div className="section-heading">
                <h2>Votre équipe</h2>
                <span>2 agents</span>
              </div>
              {['codex', 'claude'].map((agent) => (
                <div className="team-member" key={agent}>
                  <AgentMark agent={agent} />
                  <div>
                    <strong>{labels[agent]}</strong>
                    <small>
                      {running
                        ? currentStreams.some((s) => s.agent === agent)
                          ? 'En cours'
                          : 'En attente'
                        : connections[agent]?.connected
                          ? 'Prêt à travailler'
                          : 'Connexion requise'}
                    </small>
                  </div>
                  <span className={`team-status ${connections[agent]?.connected ? 'ready' : ''}`} />
                  {tools[agent] && (
                    <div className="tool-detail">
                      <Code2 size={11} />
                      {tools[agent].tool}
                      <span>{tools[agent].detail}</span>
                    </div>
                  )}
                </div>
              ))}
              <div className="section-heading plan-heading">
                <h2>Plan partagé</h2>
                {session?.tasks.length > 0 && (
                  <span>
                    {taskCount}/{session.tasks.length}
                  </span>
                )}
              </div>
              {session?.tasks.length ? (
                <div className="task-list">
                  {session.tasks.map((task) => (
                    <div className={`task ${task.status}`} key={task.id}>
                      <span>
                        {task.status === 'done' ? (
                          <Check size={12} />
                        ) : task.status === 'attention' ? (
                          <AlertCircle size={12} />
                        ) : (
                          task.order
                        )}
                      </span>
                      <div>
                        <strong>{task.title}</strong>
                        <small>
                          {labels[task.owner]} ·{' '}
                          {
                            {
                              pending: 'À faire',
                              running: 'Construction',
                              review: 'Relecture',
                              done: 'Validé',
                              attention: 'À vérifier',
                            }[task.status]
                          }
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-plan">
                  <div className="plan-symbol">
                    <i />
                    <i />
                    <i />
                  </div>
                  <strong>Une place pour chaque tâche.</strong>
                  <p>
                    Choisissez Construire.
                    <br />
                    Plan et échanges apparaissent pendant mission.
                  </p>
                </div>
              )}
              <div className="section-heading">
                <h2>Skills actifs</h2>
                <button onClick={() => setView('skills')}>
                  Gérer <ArrowUpRight size={12} />
                </button>
              </div>
              <div className="inspector-skills">
                {skills.map((skill) => {
                  const Icon = skillIcons[skill.id] || Layers;
                  return (
                    <button
                      key={skill.id}
                      className={config.skills.includes(skill.id) ? 'on' : ''}
                      onClick={() => toggleSkill(skill.id)}
                    >
                      <Icon size={13} />
                      {skill.name}
                      {config.skills.includes(skill.id) && <Check size={11} />}
                    </button>
                  );
                })}
              </div>
              <div className="round-card">
                <div>
                  <Workflow size={16} />
                  <strong>Discussion croisée</strong>
                </div>
                <span>
                  {config.collaboration === 'economy'
                    ? 'Mode économe · relecture croisée'
                    : `${config.rounds} tour(s) · discussion complète`}
                </span>
                <button onClick={() => setModal('settings')}>
                  Ajuster <ChevronRight size={13} />
                </button>
              </div>
              <div className="budget-card">
                <strong>
                  <Clock3 size={14} />
                  {session?.budget
                    ? session.budget.deadline
                      ? `Limite ${new Date(session.budget.deadline).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Durée libre · quotas actifs'
                    : config.timeLimitEnabled
                      ? `${config.durationMinutes || 60} min maximum`
                      : 'Durée libre · quotas actifs'}
                </strong>
                <span>
                  {session?.budget?.calls || 0}/{session?.budget?.maxCalls || config.maxCalls || 24}{' '}
                  appels · {(session?.budget?.tokens || 0).toLocaleString('fr-FR')} tokens connus
                </span>
                {session?.budget?.quotaWarnings?.map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
                {session?.stopReason && <small>{session.stopReason.message}</small>}
                {session?.context && (
                  <small>
                    Mémoire : {session.context.selectedMemoryIds.length}/
                    {session.context.totalNotes} notes · contexte{' '}
                    {session.context.memoryChars + session.context.historyChars} caractères
                  </small>
                )}
                <button className="text-link" onClick={() => setView('pilot')}>
                  Temps, quotas, mémoire <ChevronRight size={12} />
                </button>
              </div>
              <div className="mission-metrics">
                <div>
                  <strong>Appels mission</strong>
                  <span>{session?.metrics?.calls || 0}</span>
                </div>
                {Object.entries(session?.metrics?.agents || {}).map(([agent, metrics]) => (
                  <div key={agent}>
                    <strong>{labels[agent]}</strong>
                    <span>
                      {metrics.inputTokens !== null && metrics.outputTokens !== null
                        ? `${(metrics.inputTokens + metrics.outputTokens).toLocaleString('fr-FR')} tokens`
                        : `${metrics.calls} appels`}
                    </span>
                  </div>
                ))}
              </div>
              <ActivityPanel key={session?.id} session={session} />
              <div className="local-note">
                <Circle size={12} />
                Historique sur votre ordinateur.
                <br />
                Prompts envoyés aux deux fournisseurs.
              </div>
            </div>
          ) : (
            <div className="inspector-content git-panel">
              <div className="section-heading">
                <h2>Modifications</h2>
                <IconButton
                  label="Actualiser Git"
                  onClick={loadGit}
                  disabled={!config.project || busy}
                >
                  <RefreshCw size={14} />
                </IconButton>
              </div>
              {gitInfo?.available ? (
                <>
                  <div className="branch">
                    <GitBranch size={14} />
                    {gitInfo.branch}
                  </div>
                  {gitInfo.scope && (
                    <div className="git-scope">
                      <small>Dépôt parent</small>
                      <code title={gitInfo.root}>{gitInfo.root}</code>
                      <span>Fichiers affichés : projet choisi uniquement.</span>
                    </div>
                  )}
                  <p className="git-hint">Sélectionnez fichiers à committer.</p>
                  <div className="changed-files">
                    {gitInfo.files.length ? (
                      gitInfo.files.map((file) => (
                        <label key={file.path}>
                          <input
                            type="checkbox"
                            checked={selectedFiles.includes(file.path)}
                            onChange={(e) =>
                              setSelectedFiles((old) =>
                                e.target.checked
                                  ? [...old, file.path]
                                  : old.filter((p) => p !== file.path)
                              )
                            }
                            disabled={running}
                          />
                          <span title={file.path}>{file.path}</span>
                          <b>{file.status.trim()}</b>
                        </label>
                      ))
                    ) : (
                      <div className="git-clean">
                        <CheckCircle2 size={20} />
                        Dossier de travail propre.
                      </div>
                    )}
                  </div>
                  <button className="secondary-button full" onClick={() => setModal('diff')}>
                    <Eye size={15} />
                    Voir diff complet
                  </button>
                  <label className="field">
                    Message commit
                    <input
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="feat: …"
                    />
                  </label>
                  <button
                    className="primary-button full"
                    onClick={commit}
                    disabled={!selectedFiles.length || !commitMessage.trim() || running || busy}
                  >
                    <GitCommitHorizontal size={16} />
                    Créer commit ({selectedFiles.length})
                  </button>
                  <button
                    className="secondary-button full"
                    onClick={async () => {
                      setBusy(true);
                      const result = await perform(() => api.push());
                      if (result) setNotice('Push terminé.');
                      setBusy(false);
                    }}
                    disabled={running || busy || !gitInfo.remote}
                  >
                    <ArrowUpRight size={15} />
                    Push vers distant
                  </button>
                  <button className="text-link" onClick={() => perform(() => api.remote())}>
                    <Github size={15} />
                    Ouvrir dépôt GitHub <ExternalLink size={12} />
                  </button>
                </>
              ) : (
                <div className="empty-git">
                  <GitBranch size={30} />
                  <h3>Votre code, au même endroit.</h3>
                  <p>Choisissez dossier contenant dépôt Git pour voir modifications.</p>
                  <button className="secondary-button" onClick={pickProject} disabled={running}>
                    <FolderOpen size={15} />
                    Choisir projet
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>
        {modal === 'schedule' && (
          <ScheduleDialog
            config={config}
            project={activeProject}
            initialPrompt={prompt}
            close={() => setModal(null)}
            perform={perform}
            applyData={applyData}
            notify={setNotice}
          />
        )}
        {modal === 'connections' && (
          <ConnectionsModal
            connections={connections}
            close={() => setModal(null)}
            busy={busy}
            refresh={refresh}
            perform={perform}
            notify={setNotice}
          />
        )}
        {modal === 'updates' && <UpdatesModal close={() => setModal(null)} />}
        {modal === 'settings' && (
          <Modal title="Réglages mission" close={() => setModal(null)}>
            <p className="modal-intro">
              Modèles disponibles via outils installés. Effort élevé consomme davantage quota.
            </p>
            <div className="settings-grid">
              <label className="field">
                Modèle Codex
                <select
                  value={config.codexModel || ''}
                  onChange={(e) =>
                    changeConfig({
                      codexModel: e.target.value,
                      codexEffort: highestEffort(models.find((m) => m.id === e.target.value)),
                    })
                  }
                >
                  {models.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Effort Codex
                <select
                  aria-label="Effort Codex"
                  value={config.codexEffort || ''}
                  onChange={(e) => changeConfig({ codexEffort: e.target.value })}
                >
                  {(selectedModel?.efforts || []).map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Modèle Claude
                <select
                  aria-label="Modèle Claude"
                  value={config.claudeModel}
                  onChange={(e) =>
                    changeConfig({
                      claudeModel: e.target.value,
                      claudeEffort: highestEffort(
                        catalogs.claude.find((m) => m.id === e.target.value)
                      ),
                    })
                  }
                >
                  {catalogs.claude.map((m) => (
                    <option value={m.id} key={m.id} disabled={m.status === 'update-required'}>
                      {m.name}
                      {m.status === 'update-required' ? ` · CLI ${m.minimumVersion}+ requis` : ''}
                    </option>
                  ))}
                  {!selectedClaude && (
                    <option value={config.claudeModel}>{config.claudeModel}</option>
                  )}
                </select>
              </label>
              <label className="field">
                Effort Claude
                <select
                  aria-label="Effort Claude"
                  value={config.claudeEffort}
                  onChange={(e) => changeConfig({ claudeEffort: e.target.value })}
                >
                  <option value="">Automatique</option>
                  {(selectedClaude?.efforts || []).map((e) => (
                    <option key={e}>{e}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Tours discussion
                <select
                  aria-label="Tours discussion"
                  value={config.rounds}
                  onChange={(e) => changeConfig({ rounds: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5].map((r) => (
                    <option key={r} value={r}>
                      {r} tour{r > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Mode initial
                <select
                  value={config.mode}
                  onChange={(e) => changeConfig({ mode: e.target.value })}
                >
                  <option value="discuss">Discuter · lecture seule</option>
                  <option value="build">Construire · modifier fichiers</option>
                </select>
              </label>
            </div>
            <label className="field">
              ID Claude personnalisé
              <input
                value={selectedClaude ? '' : config.claudeModel}
                onChange={(e) =>
                  changeConfig({ claudeModel: e.target.value || 'opus', claudeEffort: '' })
                }
                placeholder="Option avancée · capacités non vérifiées"
              />
            </label>
            <label className="checkbox-setting">
              <input
                type="checkbox"
                checked={config.allowUsageCredits || false}
                onChange={(e) => changeConfig({ allowUsageCredits: e.target.checked })}
              />
              <span>
                <strong>Autoriser crédits supplémentaires Claude</strong>
                <small>
                  Fable peut utiliser crédits payants au-delà forfait. Désactivé par défaut.
                </small>
              </span>
            </label>
            <label className="checkbox-setting">
              <input
                type="checkbox"
                checked={config.commands}
                onChange={(e) => changeConfig({ commands: e.target.checked })}
              />
              <span>
                <strong>Autoriser commandes projet à Claude</strong>
                <small>
                  Claude peut lancer tests + scripts. Codex suit sandbox projet de son CLI.
                </small>
              </span>
            </label>
            <button
              className="secondary-button full"
              onClick={() => {
                setModal(null);
                setView('pilot');
              }}
            >
              <Clock3 size={16} />
              Régler durée, quotas et mémoire
            </button>
            <div className="info-note">
              <Workflow size={17} />
              Analyses simultanées. Écritures séquentielles. Relecture obligatoire. Actions commit +
              push depuis panneau Git.
            </div>
          </Modal>
        )}
        {modal === 'diff' && (
          <Modal title="Diff Git" close={() => setModal(null)} wide>
            <p className="modal-intro">
              Fichiers suivis comparés à HEAD. Fichiers nouveaux listés dans panneau Git.
            </p>
            <pre className="diff">{gitInfo?.diff || 'Aucun diff pour fichiers suivis.'}</pre>
          </Modal>
        )}
      </div>
    </ErrorContext.Provider>
  );
}
createRoot(document.getElementById('root')).render(<App />);
