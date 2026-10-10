import React, { useEffect, useState, useRef, lazy, Suspense } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Save,
  X,
  Copy,
  AlertCircle,
  Code2,
  Loader2,
  Search,
} from 'lucide-react';
import { Modal, IconButton, Empty } from './ui';
import QuickFileModal from './QuickFileModal';
const CodeEditor = lazy(() => import('./CodeEditor'));
const api = window.duo;
const baseName = (file) => file.split('/').pop();
const normalize = (text, newline) => (newline === 'CRLF' ? text.replace(/\r?\n/g, '\r\n') : text);
export default function FilesView({
  project,
  running,
  buffers,
  setBuffers,
  perform,
  notify,
  changes,
  quickOpen,
  closeQuickOpen,
  openQuickOpen,
}) {
  const [tree, setTree] = useState({}),
    [expanded, setExpanded] = useState(new Set([''])),
    [loading, setLoading] = useState(false),
    [confirm, setConfirm] = useState(null),
    [filter, setFilter] = useState('');
  const projectId = project?.id;
  const lastScan = useRef(null);
  const state = buffers[projectId] || { documents: {}, activePath: null },
    documents = state.documents;
  const document = documents[state.activePath];
  const update = (fn) =>
    setBuffers((old) => ({
      ...old,
      [projectId]: fn(old[projectId] || { documents: {}, activePath: null }),
    }));
  const load = async (relative) => {
    const result = await perform(() => api.listFiles({ projectId, relative }));
    if (result) setTree((old) => ({ ...old, [relative]: result }));
    return result;
  };
  useEffect(() => {
    let canceled = false;
    setTree({});
    setExpanded(new Set(['']));
    if (projectId)
      api
        .listFiles({ projectId, relative: '' })
        .then((result) => {
          if (!canceled) setTree({ '': result });
        })
        .catch((error) => {
          if (!canceled) perform(() => Promise.reject(error));
        });
    return () => {
      canceled = true;
    };
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    let canceled = false;
    const paths = changes?.paths || [''];
    const all =
      !lastScan.current ||
      lastScan.current.projectId !== projectId ||
      lastScan.current.running !== running ||
      !changes ||
      paths.includes('');
    lastScan.current = { projectId, running };
    const relevant = (relative) =>
      all ||
      paths.some(
        (changed) =>
          changed === relative ||
          changed.startsWith(relative + '/') ||
          relative.startsWith(changed + '/')
      );
    const opened = Object.values(documents).filter((doc) => relevant(doc.path));
    const folders = [...expanded].filter((relative) => relative === '' || relevant(relative));
    Promise.all(
      folders.map(async (relative) => {
        try {
          return [relative, await api.listFiles({ projectId, relative })];
        } catch {
          return [relative, null];
        }
      })
    ).then((results) => {
      if (!canceled) setTree((old) => ({ ...old, ...Object.fromEntries(results) }));
    });
    Promise.all(
      opened.map(async (doc) => {
        try {
          return { before: doc, result: await api.readFile({ projectId, relative: doc.path }) };
        } catch {
          return { before: doc, missing: true };
        }
      })
    ).then((results) => {
      if (canceled || !results.length) return;
      update((old) => {
        const next = { ...old.documents };
        for (const { before, result, missing } of results) {
          const current = next[before.path];
          if (
            !current ||
            current.hash !== before.hash ||
            current.savedContent !== before.savedContent
          )
            continue;
          if (missing) next[before.path] = { ...current, diskChanged: true, missing: true };
          else if (current.content === current.savedContent)
            next[before.path] = { ...result, savedContent: result.content, diskChanged: false };
          else
            next[before.path] = {
              ...current,
              diskChanged: result.hash !== current.hash,
              missing: false,
            };
        }
        return { ...old, documents: next };
      });
    });
    return () => {
      canceled = true;
    };
  }, [projectId, changes?.revision, running]);
  const openFile = async (relative) => {
    if (documents[relative]) {
      update((old) => ({ ...old, activePath: relative }));
      return true;
    }
    if (Object.keys(documents).length >= 50) {
      notify('Maximum 50 fichiers ouverts par projet. Fermer onglets avant continuer.');
      return false;
    }
    setLoading(true);
    try {
      const result = await perform(() => api.readFile({ projectId, relative }));
      if (result)
        update((old) => ({
          ...old,
          activePath: relative,
          documents: { ...old.documents, [relative]: { ...result, savedContent: result.content } },
        }));
      return !!result;
    } finally {
      setLoading(false);
    }
  };
  const save = async (relative) => {
    const doc = documents[relative];
    if (!doc?.readable || running || loading) return false;
    setLoading(true);
    try {
      const result = await perform(() =>
        api.saveFile({ projectId, path: relative, content: doc.content, expectedHash: doc.hash })
      );
      if (result) {
        update((old) => ({
          ...old,
          documents: {
            ...old.documents,
            [relative]: {
              ...result,
              content: old.documents[relative]?.content ?? result.content,
              savedContent: result.content,
            },
          },
        }));
        notify('Fichier enregistré.');
        return true;
      }
      return false;
    } finally {
      setLoading(false);
    }
  };
  const closeFile = (relative) => {
    const remove = () =>
      update((old) => {
        const next = { ...old.documents };
        delete next[relative];
        return {
          documents: next,
          activePath:
            old.activePath === relative ? Object.keys(next).at(-1) || null : old.activePath,
        };
      });
    if (documents[relative]?.content !== documents[relative]?.savedContent)
      setConfirm({ relative, title: 'Fermer fichier modifié ?', action: remove });
    else remove();
  };
  const reload = (relative) => {
    const read = async () => {
      const result = await perform(() => api.readFile({ projectId, relative }));
      if (result)
        update((old) => ({
          ...old,
          documents: { ...old.documents, [relative]: { ...result, savedContent: result.content } },
        }));
    };
    if (documents[relative]?.content !== documents[relative]?.savedContent)
      setConfirm({ relative, title: 'Recharger fichier modifié ?', action: read });
    else read();
  };
  const toggle = async (relative) => {
    if (!expanded.has(relative) && !tree[relative]) await load(relative);
    setExpanded((old) => {
      const next = new Set(old);
      next.has(relative) ? next.delete(relative) : next.add(relative);
      return next;
    });
  };
  const rows = (relative = '', depth = 0) =>
    (tree[relative]?.files || [])
      .filter(
        (file) =>
          !filter ||
          file.kind === 'directory' ||
          file.name.toLowerCase().includes(filter.toLowerCase())
      )
      .map((file) => (
        <React.Fragment key={file.path}>
          <button
            className={`file-tree-row ${state.activePath === file.path ? 'active' : ''}`}
            style={{ paddingLeft: `${12 + depth * 15}px` }}
            disabled={file.kind === 'link'}
            title={file.kind === 'link' ? 'Lien symbolique : non suivi' : file.path}
            onClick={() => (file.kind === 'directory' ? toggle(file.path) : openFile(file.path))}
            aria-expanded={file.kind === 'directory' ? expanded.has(file.path) : undefined}
          >
            {file.kind === 'directory' ? (
              expanded.has(file.path) ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )
            ) : (
              <span className="tree-indent" />
            )}
            {file.kind === 'directory' ? (
              expanded.has(file.path) ? (
                <FolderOpen size={15} />
              ) : (
                <Folder size={15} />
              )
            ) : (
              <FileText size={15} />
            )}
            <span>{file.name}</span>
          </button>
          {file.kind === 'directory' && expanded.has(file.path) && rows(file.path, depth + 1)}
        </React.Fragment>
      ));
  if (!project)
    return (
      <div className="files-empty">
        <Empty icon={FolderOpen} title="Choisir projet">
          <p>Créer ou importer projet depuis Projets.</p>
        </Empty>
      </div>
    );
  return (
    <div className="files-view">
      <aside className="file-explorer">
        <header>
          <strong>{project.name}</strong>
          <IconButton label="Rechercher fichier projet (Ctrl P)" onClick={openQuickOpen}>
            <Search size={14} />
          </IconButton>
          <IconButton
            label="Actualiser fichiers"
            onClick={() => {
              setTree({});
              setExpanded(new Set(['']));
              load('');
            }}
          >
            <RefreshCw size={14} />
          </IconButton>
        </header>
        <label className="file-filter">
          <Search size={14} />
          <input
            aria-label="Filtrer fichiers visibles"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer fichiers"
          />
        </label>
        <div className="file-tree">
          {rows()}
          {tree['']?.truncated && (
            <p className="tree-note">1 000 éléments affichés. Ouvrir sous-dossier.</p>
          )}
        </div>
        <footer>
          <button className="text-link" onClick={() => perform(() => api.reveal())}>
            <FolderOpen size={14} />
            Ouvrir dossier
          </button>
          <small>.git et dépendances masqués</small>
        </footer>
      </aside>
      {quickOpen && (
        <QuickFileModal
          project={project}
          close={closeQuickOpen}
          openFile={openFile}
          perform={perform}
        />
      )}
      <section className="editor-pane">
        <div className="editor-tabs" role="tablist" aria-label="Fichiers ouverts">
          {Object.values(documents).map((doc) => (
            <div
              className={`editor-tab ${state.activePath === doc.path ? 'active' : ''}`}
              key={doc.path}
            >
              <button
                role="tab"
                tabIndex={state.activePath === doc.path ? 0 : -1}
                onKeyDown={(event) => {
                  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
                  if (event.key === 'Delete') {
                    event.preventDefault();
                    closeFile(doc.path);
                  }
                  if (keys.includes(event.key)) {
                    event.preventDefault();
                    const files = Object.values(documents),
                      index = files.findIndex((file) => file.path === doc.path),
                      next =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? files.length - 1
                            : (index + (event.key === 'ArrowRight' ? 1 : -1) + files.length) %
                              files.length;
                    update((old) => ({ ...old, activePath: files[next].path }));
                    event.currentTarget
                      .closest('[role="tablist"]')
                      .querySelectorAll('[role="tab"]')
                      [next]?.focus();
                  }
                }}
                aria-selected={state.activePath === doc.path}
                onClick={() => update((old) => ({ ...old, activePath: doc.path }))}
                title={doc.path}
              >
                <FileText size={13} />
                {baseName(doc.path)}
                {doc.content !== doc.savedContent && (
                  <span className="dirty-indicator" aria-label="Modifié" />
                )}
              </button>
              <IconButton
                label={`Fermer ${doc.path}`}
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => closeFile(doc.path)}
              >
                <X size={12} />
              </IconButton>
            </div>
          ))}
        </div>
        {document ? (
          <>
            <div className="editor-toolbar">
              <code title={document.path}>{document.path}</code>
              <div>
                <IconButton label="Fermer fichier actif" onClick={() => closeFile(document.path)}>
                  <X size={14} />
                </IconButton>
                <IconButton
                  label="Copier chemin fichier"
                  onClick={() => perform(() => api.copy(document.path))}
                >
                  <Copy size={14} />
                </IconButton>
                <IconButton
                  label="Recharger fichier"
                  onClick={() => reload(document.path)}
                  disabled={loading}
                >
                  <RefreshCw size={14} />
                </IconButton>
                <button
                  className="primary-button"
                  onClick={() => save(document.path)}
                  disabled={
                    running ||
                    loading ||
                    !document.readable ||
                    document.content === document.savedContent
                  }
                >
                  {loading ? <Loader2 size={14} className="spin" /> : <Save size={14} />}Enregistrer
                </button>
              </div>
            </div>
            {running && (
              <div className="editor-running">
                <AlertCircle size={14} />
                Opération en cours. Éditeur en lecture seule.
              </div>
            )}
            {document.diskChanged && (
              <div className="editor-disk-change" role="status">
                <AlertCircle size={14} />
                <span>
                  {document.missing
                    ? 'Fichier déplacé ou supprimé sur disque.'
                    : 'Fichier changé sur disque. Brouillon conservé.'}
                </span>
                <button onClick={() => reload(document.path)}>Recharger</button>
              </div>
            )}
            {document.readable ? (
              <Suspense
                fallback={
                  <div className="editor-loading">
                    <Loader2 className="spin" size={22} />
                    Chargement éditeur
                  </div>
                }
              >
                <CodeEditor
                  key={`${projectId}:${document.path}`}
                  file={document.path}
                  content={document.content}
                  readonly={running}
                  onChange={(value) =>
                    update((old) => ({
                      ...old,
                      documents: {
                        ...old.documents,
                        [document.path]: {
                          ...old.documents[document.path],
                          content: normalize(value, document.newline),
                        },
                      },
                    }))
                  }
                  onSave={() => save(document.path)}
                />
              </Suspense>
            ) : (
              <Empty icon={FileText} title="Aperçu indisponible">
                <p>{document.reason}</p>
              </Empty>
            )}
            <footer className="editor-status">
              <span>
                {document.content !== document.savedContent
                  ? 'Modifications non enregistrées'
                  : 'Enregistré'}
              </span>
              <span>
                {document.newline || 'Binaire'} · {Math.ceil(document.size / 1024)} Ko · UTF-8
              </span>
              <span>Ctrl + S</span>
            </footer>
          </>
        ) : (
          <div className="editor-welcome">
            <Code2 size={33} />
            <h2>Votre projet, sous les yeux.</h2>
            <p>
              Ouvrir fichier depuis explorateur.
              <br />
              Coloration, recherche, historique d’édition.
            </p>
            <small>Modifications manuelles préservées par vérification du contenu.</small>
          </div>
        )}
      </section>
      {confirm && (
        <Modal title={confirm.title} close={() => setConfirm(null)}>
          <p className="modal-intro">
            Brouillon contient changements non enregistrés pour <strong>{confirm.relative}</strong>.
          </p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={() => setConfirm(null)}>
              Annuler
            </button>
            <button
              className="secondary-button"
              onClick={async () => {
                await confirm.action();
                setConfirm(null);
              }}
            >
              Abandonner brouillon
            </button>
            <button
              className="primary-button"
              disabled={running || loading}
              onClick={async () => {
                if (await save(confirm.relative)) {
                  await confirm.action();
                  setConfirm(null);
                }
              }}
            >
              Enregistrer puis continuer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
