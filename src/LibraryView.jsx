import React, { useState } from 'react';
import {
  FolderOpen,
  FolderPlus,
  Plus,
  Archive,
  RotateCcw,
  Check,
  GitBranch,
  ExternalLink,
  Layers,
  Loader2,
  Pencil,
  Download,
} from 'lucide-react';
import { Modal, IconButton, Empty } from './ui';
import GitProjectModal from './GitProjectModal';
const api = window.duo;
export default function LibraryView({
  library,
  running,
  perform,
  applyData,
  notify,
  openMissions,
}) {
  const [dialog, setDialog] = useState(null),
    [working, setWorking] = useState(false),
    [showArchived, setShowArchived] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(''),
    [form, setForm] = useState({ name: '', parent: '', template: 'blank', initializeGit: true });
  const [editing, setEditing] = useState(null);
  const workspaces = library.workspaces || [],
    projects = library.projects || [];
  const currentWorkspace = workspaces.find((w) => w.id === library.activeWorkspaceId);
  const action = async (work) => {
    setWorking(true);
    try {
      const data = await perform(work);
      if (data) {
        applyData(data);
        if (data.warning) notify(data.warning);
        return data;
      }
    } finally {
      setWorking(false);
    }
  };
  const importProject = () => action(() => api.pickProject());
  const activate = async (value, open = false) => {
    if (await action(() => api.activateProject(value))) {
      if (open) openMissions();
    }
  };
  const patch = (kind, id, values) => action(() => api.patchRecord({ kind, id, values }));
  const disabled = running || working;
  return (
    <div className="library-page">
      <div className="page-heading">
        <div>
          <h1>Projets & workspaces</h1>
          <p>Dossiers, missions, skills et modèles regroupés par projet.</p>
        </div>
        <button
          className="secondary-button"
          disabled={disabled}
          onClick={() => {
            setWorkspaceName('');
            setDialog('workspace');
          }}
        >
          <Plus size={15} />
          Workspace
        </button>
      </div>
      <div className="workspace-strip" aria-label="Workspaces">
        {workspaces
          .filter((w) => !w.archived)
          .map((w) => (
            <button
              key={w.id}
              className={w.id === library.activeWorkspaceId ? 'active' : ''}
              disabled={disabled}
              onClick={() => activate({ workspaceId: w.id })}
            >
              <Layers size={15} />
              <span>{w.name}</span>
              <small>{projects.filter((p) => p.workspaceId === w.id && !p.archived).length}</small>
            </button>
          ))}
      </div>
      <div className="library-toolbar">
        <div>
          <h2>{currentWorkspace?.name || 'Workspace'}</h2>
          {currentWorkspace && (
            <IconButton
              label="Renommer workspace"
              disabled={disabled}
              onClick={() => {
                setEditing({ ...currentWorkspace, kind: 'workspace' });
                setDialog('edit');
              }}
            >
              <Pencil size={14} />
            </IconButton>
          )}
          {workspaces.filter((w) => !w.archived).length > 1 && (
            <IconButton
              label="Archiver workspace"
              disabled={disabled}
              onClick={() => patch('workspace', currentWorkspace.id, { archived: true })}
            >
              <Archive size={14} />
            </IconButton>
          )}
        </div>
        <div>
          <button
            className="secondary-button"
            disabled={disabled}
            onClick={() => setDialog('clone')}
          >
            <Download size={15} />
            Cloner GitHub
          </button>
          <button className="secondary-button" onClick={importProject} disabled={disabled}>
            <FolderOpen size={15} />
            Importer dossier
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setForm({ name: '', parent: '', template: 'blank', initializeGit: true });
              setDialog('project');
            }}
            disabled={disabled}
          >
            <FolderPlus size={15} />
            Créer projet
          </button>
        </div>
      </div>
      <div className="project-grid">
        {projects
          .filter((p) => p.workspaceId === library.activeWorkspaceId && !p.archived)
          .map((project) => (
            <article
              key={project.id}
              className={`library-project-card ${project.id === library.activeProjectId ? 'current' : ''}`}
            >
              <div className="project-card-head">
                <FolderOpen size={23} />
                {project.id === library.activeProjectId && (
                  <span className="status-badge ready">
                    <Check size={12} />
                    Actif
                  </span>
                )}
                <IconButton
                  label={`Modifier ${project.name}`}
                  disabled={disabled}
                  onClick={() => {
                    setEditing({ ...project, kind: 'project' });
                    setDialog('edit');
                  }}
                >
                  <Pencil size={14} />
                </IconButton>
              </div>
              <h3>{project.name}</h3>
              <p className="project-path" title={project.path}>
                {project.path}
              </p>
              <p className="project-description">
                {project.description || 'Ajoutez brief pour guider équipe.'}
              </p>
              <div className="project-meta">
                <span>
                  {
                    (library.sessions || []).filter(
                      (s) => s.projectId === project.id && !s.archived
                    ).length
                  }{' '}
                  missions
                </span>
                <span>{project.exists ? 'Dossier présent' : 'Dossier introuvable'}</span>
              </div>
              <footer>
                <button
                  className="secondary-button"
                  disabled={disabled}
                  onClick={() =>
                    activate({ projectId: project.id }, project.id === library.activeProjectId)
                  }
                >
                  {project.id === library.activeProjectId ? 'Ouvrir missions' : 'Choisir projet'}
                </button>
                <IconButton
                  label={`Archiver ${project.name}`}
                  disabled={disabled}
                  onClick={() => patch('project', project.id, { archived: true })}
                >
                  <Archive size={15} />
                </IconButton>
              </footer>
            </article>
          ))}
      </div>
      {!projects.some((p) => p.workspaceId === library.activeWorkspaceId && !p.archived) && (
        <Empty icon={FolderOpen} title="Premier projet">
          <p>Importer dossier existant ou créer dossier neuf.</p>
        </Empty>
      )}
      <button
        className="text-link archive-toggle"
        onClick={() => setShowArchived((value) => !value)}
      >
        <Archive size={15} />
        {showArchived ? 'Masquer archives' : 'Voir archives'}
      </button>
      {showArchived && (
        <div className="archive-list">
          {[
            ...workspaces.filter((w) => w.archived).map((w) => ({ ...w, kind: 'workspace' })),
            ...projects.filter((p) => p.archived).map((p) => ({ ...p, kind: 'project' })),
          ].map((record) => (
            <div key={record.id}>
              <span>
                <strong>{record.name}</strong>
                <small>
                  {record.kind === 'workspace' ? 'Workspace' : 'Projet'} · dossiers conservés
                </small>
              </span>
              <button
                className="secondary-button"
                disabled={disabled}
                onClick={() => patch(record.kind, record.id, { archived: false })}
              >
                <RotateCcw size={14} />
                Restaurer
              </button>
            </div>
          ))}
          {!workspaces.some((w) => w.archived) && !projects.some((p) => p.archived) && (
            <p>Aucune archive.</p>
          )}
        </div>
      )}
      <div className="info-note">
        <FolderOpen size={17} />
        Archiver retire élément de navigation. Dossiers + missions restent sur ordinateur.
      </div>
      {['clone', 'worktree'].includes(dialog) && (
        <GitProjectModal
          kind={dialog}
          project={editing}
          close={() => setDialog(null)}
          perform={perform}
          applyData={applyData}
          notify={notify}
          running={running}
        />
      )}
      {dialog === 'workspace' && (
        <Modal title="Créer workspace" close={() => setDialog(null)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (await action(() => api.createWorkspace(workspaceName))) setDialog(null);
            }}
          >
            <label className="field">
              Nom workspace
              <input
                autoFocus
                value={workspaceName}
                maxLength={80}
                required
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Studio, personnel, clients…"
              />
            </label>
            <p className="modal-intro">
              Workspace regroupe projets. Chaque projet garde réglages et historique.
            </p>
            <button className="primary-button full" disabled={disabled || !workspaceName.trim()}>
              <Plus size={15} />
              Créer workspace
            </button>
          </form>
        </Modal>
      )}
      {dialog === 'project' && (
        <Modal title="Créer projet" close={() => setDialog(null)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (await action(() => api.createProject(form))) {
                setDialog(null);
                notify('Projet créé. Prêt pour première mission.');
              }
            }}
          >
            <label className="field">
              Nom projet
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm((old) => ({ ...old, name: e.target.value }))}
                maxLength={80}
                required
                placeholder="Mon application"
              />
            </label>
            <label className="field">
              Emplacement
              <div className="folder-input">
                <input value={form.parent} readOnly placeholder="Choisir dossier parent" />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  onClick={async () => {
                    const parent = await perform(() => api.pickParent());
                    if (parent) setForm((old) => ({ ...old, parent }));
                  }}
                >
                  <FolderOpen size={16} />
                  Choisir
                </button>
              </div>
            </label>
            <label className="field">
              Modèle de départ
              <select
                value={form.template}
                onChange={(e) => setForm((old) => ({ ...old, template: e.target.value }))}
              >
                {(library.templates || []).map((template) => (
                  <option value={template.id} key={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="template-description">
              {library.templates?.find((t) => t.id === form.template)?.description}
            </p>
            <label className="checkbox-setting">
              <input
                type="checkbox"
                checked={form.initializeGit}
                onChange={(e) => setForm((old) => ({ ...old, initializeGit: e.target.checked }))}
              />
              <span>
                <strong>Initialiser dépôt Git</strong>
                <small>Branche main. Aucun commit automatique.</small>
              </span>
            </label>
            <div className="path-preview">
              <small>Dossier créé</small>
              <code>
                {form.parent && form.name
                  ? `${form.parent}\${form.name}`
                  : 'Choisir emplacement + nom'}
              </code>
            </div>
            <button
              className="primary-button full"
              disabled={disabled || !form.name.trim() || !form.parent}
            >
              {working ? <Loader2 size={15} className="spin" /> : <FolderPlus size={15} />}Créer
              projet
            </button>
          </form>
        </Modal>
      )}
      {dialog === 'edit' && (
        <Modal
          title={editing.kind === 'workspace' ? 'Modifier workspace' : 'Modifier projet'}
          close={() => setDialog(null)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await patch(editing.kind, editing.id, {
                  name: editing.name,
                  ...(editing.kind === 'project'
                    ? { description: editing.description || '', workspaceId: editing.workspaceId }
                    : {}),
                })
              )
                setDialog(null);
            }}
          >
            <label className="field">
              Nom
              <input
                autoFocus
                value={editing.name}
                maxLength={80}
                required
                onChange={(e) => setEditing((old) => ({ ...old, name: e.target.value }))}
              />
            </label>
            {editing.kind === 'project' && (
              <>
                <label className="field">
                  Workspace destination
                  <select
                    value={editing.workspaceId}
                    onChange={(e) => setEditing((old) => ({ ...old, workspaceId: e.target.value }))}
                  >
                    {workspaces
                      .filter((w) => !w.archived)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  Brief projet
                  <textarea
                    aria-label="Brief projet"
                    value={editing.description || ''}
                    maxLength={4000}
                    rows={5}
                    onChange={(e) => setEditing((old) => ({ ...old, description: e.target.value }))}
                    placeholder="Objectif, utilisateurs, contraintes, technologies…"
                  />
                </label>
                <p className="modal-intro">
                  Brief transmis aux deux IA pour chaque mission de ce projet.
                </p>
                <div className="path-preview">
                  <small>Dossier</small>
                  <code>{editing.path}</code>
                </div>
                <button
                  type="button"
                  className="secondary-button relink-button"
                  disabled={disabled}
                  onClick={() => setDialog('worktree')}
                >
                  <GitBranch size={15} />
                  Créer worktree isolé
                </button>
                <button
                  type="button"
                  className="secondary-button relink-button"
                  disabled={disabled}
                  onClick={async () => {
                    const data = await action(() => api.relinkProject(editing.id));
                    if (data) {
                      setEditing((old) => ({
                        ...old,
                        path: data.projects.find((p) => p.id === old.id).path,
                      }));
                      notify('Dossier reconnecté. Historique conservé.');
                    }
                  }}
                >
                  <FolderOpen size={15} />
                  Rechoisir dossier déplacé
                </button>
              </>
            )}
            <button className="primary-button full" disabled={disabled || !editing.name.trim()}>
              <Check size={15} />
              Enregistrer
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
