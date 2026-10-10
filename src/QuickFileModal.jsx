import React, { useEffect, useId, useState } from 'react';
import { Search, FileText, Loader2 } from 'lucide-react';
import { Modal } from './ui';
const api = window.duo;
export default function QuickFileModal({ project, close, openFile, perform }) {
  const [query, setQuery] = useState(''),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [cursor, setCursor] = useState(0);
  const listId = useId(),
    files = result?.files || [];
  useEffect(() => {
    if (files.length)
      document.getElementById(`${listId}-${cursor}`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, files.length, listId]);
  useEffect(() => {
    let canceled = false;
    setCursor(0);
    setResult(null);
    setBusy(!!query.trim());
    if (!query.trim()) return;
    const timer = setTimeout(async () => {
      const data = await perform(() => api.searchFiles({ projectId: project.id, query }));
      if (!canceled) {
        setResult(data);
        setBusy(false);
      }
    }, 180);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [query, project.id]);
  const choose = async (file) => {
    setBusy(true);
    try {
      if (await openFile(file.path)) close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Ouvrir fichier" close={close}>
      <label className="quick-file-search">
        <Search size={16} />
        <input
          autoFocus
          role="combobox"
          aria-label="Rechercher fichier projet"
          aria-controls={listId}
          aria-expanded={!!files.length}
          aria-activedescendant={files.length ? `${listId}-${cursor}` : undefined}
          aria-autocomplete="list"
          placeholder="Nom ou chemin · mainjs → src/main.js"
          value={query}
          maxLength={160}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((old) =>
                files.length
                  ? (old + (event.key === 'ArrowDown' ? 1 : -1) + files.length) % files.length
                  : 0
              );
            }
            if (event.key === 'Enter' && files[cursor] && !busy) {
              event.preventDefault();
              choose(files[cursor]);
            }
          }}
        />
        {busy && <Loader2 size={15} className="spin" />}
      </label>
      <div className="quick-file-results" role="listbox" id={listId} aria-label="Fichiers trouvés">
        {files.map((file, index) => (
          <button
            type="button"
            role="option"
            aria-selected={cursor === index}
            id={`${listId}-${index}`}
            key={file.path}
            disabled={busy}
            onFocus={() => setCursor(index)}
            onClick={() => choose(file)}
          >
            <FileText size={15} />
            <span>
              <strong>{file.name}</strong>
              <code>{file.path}</code>
            </span>
          </button>
        ))}
      </div>
      <p className="quick-file-note">
        {!query.trim()
          ? `Chercher dans ${project.name}. Sous-dossiers inclus. ↑ ↓ choisir · Entrée ouvrir.`
          : busy
            ? 'Recherche locale…'
            : `${files.length} résultat(s) · ${result?.scanned || 0} éléments parcourus.${result?.truncated ? ' Recherche bornée : préciser nom ou utiliser explorateur.' : ''}`}
      </p>
    </Modal>
  );
}
