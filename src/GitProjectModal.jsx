import React, { useState } from 'react';
import {
  FolderOpen,
  GitBranch,
  Download,
  Search,
  LockKeyhole,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Modal } from './ui';
import ProviderLogo from './ProviderLogo';
const api = window.duo;
const slug = (value) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'projet';
export default function GitProjectModal({
  kind,
  project,
  close,
  perform,
  applyData,
  notify,
  running,
}) {
  const [form, setForm] = useState({
    name: kind === 'worktree' ? `${project.name} copie` : '',
    parent: '',
    repository: '',
    branch: kind === 'worktree' ? `varelia/${slug(project.name)}-copie` : '',
    ref: 'HEAD',
  });
  const [working, setWorking] = useState(false),
    [repos, setRepos] = useState(null),
    [loadingRepos, setLoadingRepos] = useState(false),
    [search, setSearch] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const disabled = working || running;
  const chooseRepository = (value) =>
    setForm((old) => ({
      ...old,
      repository: value,
      name: nameEdited
        ? old.name
        : (value.split('/').filter(Boolean).at(-1) || '').replace(/\.git$/, ''),
    }));
  const submit = async (event) => {
    event.preventDefault();
    setWorking(true);
    try {
      const result = await perform(() =>
        kind === 'clone'
          ? api.cloneProject(form)
          : api.createWorktree({ ...form, projectId: project.id })
      );
      if (result) {
        applyData(result);
        close();
        notify(
          kind === 'clone'
            ? 'Dépôt cloné. Projet prêt.'
            : 'Worktree créé. Branche + dossier isolés.'
        );
      }
    } finally {
      setWorking(false);
    }
  };
  return (
    <Modal title={kind === 'clone' ? 'Cloner dépôt GitHub' : 'Créer worktree Git'} close={close}>
      <form onSubmit={submit}>
        {kind === 'clone' ? (
          <>
            <label className="field">
              Dépôt GitHub
              <input
                autoFocus
                required
                value={form.repository}
                maxLength={350}
                disabled={disabled}
                placeholder="propriétaire/dépôt ou https://github.com/…"
                onChange={(e) => chooseRepository(e.target.value)}
              />
            </label>
            <div className="repo-loader">
              <button
                type="button"
                className="secondary-button"
                disabled={loadingRepos || disabled}
                onClick={async () => {
                  setLoadingRepos(true);
                  const result = await perform(() => api.githubRepos());
                  if (result) setRepos(result);
                  setLoadingRepos(false);
                }}
              >
                {loadingRepos ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                Charger mes dépôts
              </button>
              <small>Compte gh connecté · 100 dépôts maximum</small>
            </div>
            {repos && (
              <div className="repo-picker">
                <label className="search-field">
                  <Search size={14} />
                  <input
                    aria-label="Rechercher dépôts GitHub"
                    placeholder="Rechercher dépôt"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div>
                  {repos
                    .filter((repo) =>
                      `${repo.name} ${repo.description}`
                        .toLowerCase()
                        .includes(search.toLowerCase())
                    )
                    .map((repo) => (
                      <button
                        type="button"
                        key={repo.name}
                        onClick={() => chooseRepository(repo.name)}
                        className={form.repository === repo.name ? 'selected' : ''}
                      >
                        <ProviderLogo provider="github" size={15} />
                        <span>
                          <strong>{repo.name}</strong>
                          {repo.description && <small>{repo.description}</small>}
                        </span>
                        {repo.private && <LockKeyhole size={13} />}
                      </button>
                    ))}
                  {repos.length === 0 && <p>Aucun dépôt retourné. Coller URL directement.</p>}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="modal-intro">
              Copie Git dans dossier distinct. Branche originale reste ouverte. Modèles, skills et
              brief repris du projet source.
            </p>
            <div className="path-preview">
              <small>Projet source</small>
              <code>{project.path}</code>
            </div>
          </>
        )}
        <label className="field">
          Nom nouveau dossier
          <input
            required
            maxLength={80}
            value={form.name}
            disabled={disabled}
            onChange={(e) => {
              setNameEdited(true);
              setForm((old) => ({
                ...old,
                name: e.target.value,
                ...(kind === 'worktree' ? { branch: `varelia/${slug(e.target.value)}` } : {}),
              }));
            }}
          />
        </label>
        <label className="field">
          Emplacement
          <div className="folder-input">
            <input readOnly value={form.parent} placeholder="Choisir dossier parent" />
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={async () => {
                const parent = await perform(() => api.pickParent());
                if (parent) setForm((old) => ({ ...old, parent }));
              }}
            >
              <FolderOpen size={15} />
              Choisir
            </button>
          </div>
        </label>
        {kind === 'worktree' && (
          <div className="settings-grid">
            <label className="field">
              Nouvelle branche
              <input
                required
                value={form.branch}
                maxLength={150}
                disabled={disabled}
                onChange={(e) => setForm((old) => ({ ...old, branch: e.target.value }))}
                placeholder="varelia/mon-projet"
              />
            </label>
            <label className="field">
              Révision départ
              <input
                required
                value={form.ref}
                maxLength={200}
                disabled={disabled}
                onChange={(e) => setForm((old) => ({ ...old, ref: e.target.value }))}
                placeholder="HEAD, main, origin/main…"
              />
            </label>
          </div>
        )}
        <div className="path-preview">
          <small>Dossier créé</small>
          <code>
            {form.parent && form.name
              ? `${form.parent}\\${form.name}`
              : 'Choisir emplacement + nom'}
          </code>
        </div>
        <p className="modal-intro">
          Dossier destination doit être neuf. Annulation peut laisser fichiers partiels pour
          inspection.
        </p>
        <button
          className="primary-button full"
          disabled={
            disabled ||
            !form.parent ||
            !form.name.trim() ||
            (kind === 'clone' && !form.repository.trim())
          }
        >
          {working ? (
            <Loader2 className="spin" size={15} />
          ) : kind === 'clone' ? (
            <Download size={15} />
          ) : (
            <GitBranch size={15} />
          )}
          {working ? 'Opération en cours…' : kind === 'clone' ? 'Cloner dépôt' : 'Créer worktree'}
        </button>
      </form>
    </Modal>
  );
}
