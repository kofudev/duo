import React, { useEffect, useState } from 'react';
import { Search, Archive, RotateCcw, MoreHorizontal, Check, Loader2 } from 'lucide-react';
import { Modal, IconButton } from './ui';
const api = window.duo;
export default function SessionList({
  sessions,
  current,
  projectId,
  active,
  select,
  perform,
  update,
}) {
  const [query, setQuery] = useState(''),
    [archives, setArchives] = useState(false),
    [editing, setEditing] = useState(null),
    [working, setWorking] = useState(false);
  useEffect(() => {
    setQuery('');
    setArchives(false);
    setEditing(null);
  }, [projectId]);
  const items = sessions.filter(
    (s) => !!s.archived === archives && s.title.toLowerCase().includes(query.toLowerCase())
  );
  const archivedCount = sessions.filter((s) => s.archived).length;
  const patch = async (values) => {
    setWorking(true);
    try {
      const result = await perform(() => api.patchSession({ id: editing.id, values }));
      if (result) {
        update(result);
        setEditing(null);
      }
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <label className="session-search">
        <Search size={12} />
        <input
          aria-label="Rechercher missions"
          placeholder="Rechercher missions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="session-list" tabIndex={0} role="region" aria-label="Liste missions">
        {items.length ? (
          items.map((s) => (
            <div className={`session-row ${current === s.id ? 'selected' : ''}`} key={s.id}>
              <button className="session-open" onClick={() => select(s)}>
                <span className={`session-dot ${s.state}`} />
                <span>{s.title}</span>
                {s.state === 'running' && <Loader2 size={13} className="spin" />}
              </button>
              <IconButton
                label={`Options mission ${s.title}`}
                disabled={active === s.id}
                onClick={() => setEditing({ ...s })}
              >
                <MoreHorizontal size={14} />
              </IconButton>
            </div>
          ))
        ) : (
          <div className="empty-sessions">
            {query ? (
              'Aucune mission trouvée.'
            ) : archives ? (
              'Aucune mission archivée.'
            ) : (
              <>
                Votre prochaine idée
                <br />
                commence ici.
              </>
            )}
          </div>
        )}
      </div>
      {(archivedCount > 0 || archives) && (
        <button
          className={`session-archives ${archives ? 'active' : ''}`}
          onClick={() => setArchives((value) => !value)}
        >
          <Archive size={12} />
          {archives ? 'Missions actives' : `Archives (${archivedCount})`}
        </button>
      )}
      {editing && (
        <Modal title="Modifier mission" close={() => setEditing(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              patch({ title: editing.title });
            }}
          >
            <label className="field">
              Titre mission
              <input
                autoFocus
                required
                maxLength={80}
                value={editing.title}
                onChange={(e) => setEditing((old) => ({ ...old, title: e.target.value }))}
              />
            </label>
            <p className="modal-intro">Archiver conserve échanges, plan et fichiers du projet.</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={working}
                onClick={() => patch({ archived: !editing.archived })}
              >
                {editing.archived ? <RotateCcw size={15} /> : <Archive size={15} />}
                {editing.archived ? 'Restaurer mission' : 'Archiver mission'}
              </button>
              <button className="primary-button" disabled={working || !editing.title.trim()}>
                <Check size={15} />
                Enregistrer titre
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
