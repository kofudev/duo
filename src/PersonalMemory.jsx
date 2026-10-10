import React, { useEffect, useState } from 'react';
import { Brain, Download, Upload, Copy, Pencil, Trash2, Pin, Plus } from 'lucide-react';
import { Modal, IconButton } from './ui';
const api = window.duo;
const exportPrompt =
  'Affiche les informations que tu as mémorisées à mon sujet : préférences, façon de répondre, projets et outils. Une note précise par paragraphe, avec titre. N’invente rien. Distingue souvenir explicite et déduction. Indique ce que tu ne peux pas consulter. Je veux relire ces notes avant de les transférer à deux assistants dans Duo.';

function ImportDialog({ close, perform, imported, notify }) {
  const [text, setText] = useState(''),
    [source, setSource] = useState('chatgpt'),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false);
  const change = (id, values) =>
    setPreview((old) => ({
      ...old,
      notes: old.notes.map((note) => (note.id === id ? { ...note, ...values } : note)),
    }));
  const selected = preview?.notes.filter((note) => note.selected) || [];
  const inspect = async () => {
    setBusy(true);
    const result = await perform(() => api.previewMemory({ text, source }));
    if (result) setPreview(result);
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true);
    const result = await perform(() =>
      api.importMemory({ scope: 'personal', source, notes: selected })
    );
    if (result) {
      imported(result.notes);
      notify(`${result.added} note(s) ajoutée(s) · ${result.duplicates} doublon(s) ignoré(s).`);
      close();
    }
    setBusy(false);
  };
  return (
    <Modal title="Importer mémoire personnelle" close={close}>
      <p className="modal-intro">
        Relisez ce qui sera partagé avec Codex et Claude. Import local ; notes utilisées seulement
        lors d’une mission.
      </p>
      <label className="field">
        Source mémoire
        <select
          aria-label="Source mémoire"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setPreview(null);
          }}
        >
          <option value="chatgpt">ChatGPT</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex local</option>
          <option value="duo">Export Duo</option>
          <option value="other">Autre</option>
        </select>
      </label>
      <label className="field">
        Texte mémoire à importer
        <textarea
          aria-label="Texte mémoire à importer"
          rows={7}
          maxLength={320000}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
          }}
          placeholder="Coller notes exportées, Markdown ou JSON mémoire Duo…"
        />
      </label>
      <div className="memory-actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={async () => {
            const value = await perform(() => api.pickMemoryFile());
            if (value !== null && value !== undefined) {
              setText(value);
              setPreview(null);
            }
          }}
        >
          <Upload size={14} />
          Choisir fichier
        </button>
        <button className="primary-button" disabled={busy || !text.trim()} onClick={inspect}>
          Préparer aperçu
        </button>
      </div>
      {preview && (
        <>
          <p className="pilot-help">
            {preview.notes.length} note(s) · {preview.duplicates} doublon(s) retiré(s). Épingler
            seulement préférences utiles à chaque mission.
          </p>
          <div
            className="memory-import-preview"
            tabIndex={0}
            role="region"
            aria-label="Aperçu mémoire importée"
          >
            {preview.notes.map((note, index) => (
              <article key={note.id}>
                <label className="simple-checkbox">
                  <input
                    type="checkbox"
                    checked={note.selected}
                    onChange={(event) => change(note.id, { selected: event.target.checked })}
                  />
                  Importer note {index + 1}
                </label>
                <label className="field">
                  Titre import {index + 1}
                  <input
                    aria-label={`Titre import ${index + 1}`}
                    maxLength={100}
                    value={note.title}
                    onChange={(event) => change(note.id, { title: event.target.value })}
                  />
                </label>
                <label className="field">
                  Contenu import {index + 1}
                  <textarea
                    aria-label={`Contenu import ${index + 1}`}
                    rows={4}
                    maxLength={1600}
                    value={note.text}
                    onChange={(event) => change(note.id, { text: event.target.value })}
                  />
                </label>
                <label className="simple-checkbox">
                  <input
                    type="checkbox"
                    checked={note.pinned}
                    onChange={(event) => change(note.id, { pinned: event.target.checked })}
                  />
                  Épingler note {index + 1}
                </label>
              </article>
            ))}
          </div>
          <button
            className="primary-button full"
            disabled={
              busy ||
              !selected.length ||
              selected.some((note) => !note.title.trim() || !note.text.trim())
            }
            onClick={submit}
          >
            <Brain size={15} />
            Importer {selected.length} note(s) sélectionnée(s)
          </button>
        </>
      )}
    </Modal>
  );
}
export default function PersonalMemory({ config, changeConfig, running, perform, notify }) {
  const [notes, setNotes] = useState([]),
    [importing, setImporting] = useState(false),
    [editing, setEditing] = useState(null),
    [showEditor, setShowEditor] = useState(false);
  const [title, setTitle] = useState(''),
    [text, setText] = useState(''),
    [pinned, setPinned] = useState(true);
  useEffect(() => {
    let alive = true;
    api
      .memory()
      .then((result) => {
        if (alive) setNotes(result.personalNotes || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [running]);
  const edit = (note) => {
    setEditing(note);
    setTitle(note?.title || '');
    setText(note?.text || '');
    setPinned(note?.pinned ?? true);
    setShowEditor(true);
  };
  const save = async (event) => {
    event.preventDefault();
    const result = await perform(() =>
      api.saveMemory({
        scope: 'personal',
        id: editing?.id,
        expectedUpdatedAt: editing?.updatedAt,
        title,
        text,
        pinned,
      })
    );
    if (result) {
      setNotes(result);
      setShowEditor(false);
      notify('Mémoire personnelle enregistrée.');
    }
  };
  return (
    <section className="pilot-card personal-memory-card">
      <div className="section-heading">
        <h2>Mémoire personnelle · partagée</h2>
        <span>{notes.length}/200 notes</span>
      </div>
      <p className="pilot-help">
        Votre profil commun, dans tous projets. Codex et Claude reçoivent mêmes extraits : quatre
        notes maximum, 2 500 caractères réservés. Épinglées prioritaires ; autres choisies selon
        demande.
      </p>
      <label className="checkbox-setting">
        <input
          type="checkbox"
          checked={config.personalMemoryEnabled !== false}
          onChange={(event) => changeConfig({ personalMemoryEnabled: event.target.checked })}
        />
        <span>
          <strong>Partager mémoire personnelle avec les deux</strong>
          <small>
            Désactiver pour ce projet conserve notes, sans les ajouter aux prochains prompts.
          </small>
        </span>
      </label>
      <div className="memory-actions">
        <button className="primary-button" disabled={running} onClick={() => setImporting(true)}>
          <Upload size={15} />
          Importer mémoire
        </button>
        <button
          className="secondary-button"
          onClick={async () => {
            const path = await perform(() => api.exportMemory({ scope: 'personal' }));
            if (path) notify('Export mémoire enregistré.');
          }}
          disabled={!notes.length}
        >
          <Download size={15} />
          Exporter mémoire
        </button>
        <button className="text-link" disabled={running} onClick={() => edit(null)}>
          <Plus size={15} />
          Ajouter préférence
        </button>
      </div>
      <details className="memory-guide">
        <summary>Récupérer mémoire ChatGPT / Claude</summary>
        <p>
          Connexion abonnement conserve accès aux modèles. Mémoire des chats web doit être
          transférée séparément.
        </p>
        <p>
          ChatGPT : ouvrez réglages de mémoire dans Personnalisation, puis copiez notes voulues.
          Claude : Paramètres → Mémoire ; consultez mémoire ou demandez son export en texte. Dans un
          chat existant, ce prompt aide à recueillir souvenirs accessibles. Relisez réponse : export
          peut être incomplet.
        </p>
        <button
          className="secondary-button"
          onClick={async () => {
            const result = await perform(() => api.copy(exportPrompt));
            if (result) notify('Prompt copié. Coller dans ChatGPT ou Claude.');
          }}
        >
          <Copy size={14} />
          Copier prompt export
        </button>
        <p>
          Codex local / Claude Code : importer fichier mémoire choisi (.md/.txt), puis vérifier
          aperçu. ZIP des conversations ne constitue pas export mémoire. Aucune connexion
          automatique aux comptes web.
        </p>
        <div className="memory-actions">
          <button
            className="text-link"
            onClick={() =>
              perform(() => api.openUrl('https://learn.chatgpt.com/docs/customization/memories'))
            }
          >
            Guide ChatGPT
          </button>
          <button
            className="text-link"
            onClick={() =>
              perform(() =>
                api.openUrl(
                  'https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude'
                )
              )
            }
          >
            Guide Claude
          </button>
        </div>
      </details>
      {showEditor && (
        <form className="personal-memory-editor" onSubmit={save}>
          <label className="field">
            Titre mémoire personnelle
            <input
              aria-label="Titre mémoire personnelle"
              maxLength={100}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            Contenu mémoire personnelle
            <textarea
              aria-label="Contenu mémoire personnelle"
              rows={4}
              maxLength={1600}
              required
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="simple-checkbox">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
            />
            Épingler préférence personnelle
          </label>
          <div className="memory-actions">
            <button
              className="primary-button"
              disabled={running || !title.trim() || !text.trim()}
              type="submit"
            >
              Enregistrer préférence
            </button>
            <button className="text-link" type="button" onClick={() => setShowEditor(false)}>
              Annuler édition
            </button>
          </div>
        </form>
      )}
      <div
        className="personal-memory-list"
        tabIndex={0}
        role="region"
        aria-label="Notes mémoire personnelle"
      >
        {notes.map((note) => (
          <article key={note.id}>
            <div>
              <strong>
                {note.pinned && <Pin size={12} />}
                {note.title}
              </strong>
              <small>
                {note.source || 'Duo'} ·{' '}
                {new Date(note.updatedAt || note.at).toLocaleDateString('fr-FR')}
              </small>
            </div>
            <p>{note.text}</p>
            <div className="memory-actions">
              <button className="text-link" disabled={running} onClick={() => edit(note)}>
                <Pencil size={13} />
                Modifier préférence
              </button>
              <IconButton
                label={`Supprimer préférence ${note.title}`}
                disabled={running}
                onClick={async () => {
                  const result = await perform(() =>
                    api.deleteMemory({ scope: 'personal', id: note.id })
                  );
                  if (result) {
                    setNotes(result);
                    if (editing?.id === note.id) setShowEditor(false);
                  }
                }}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          </article>
        ))}
      </div>
      {!notes.length && (
        <p className="pilot-help">
          Importez souvenirs existants ou ajoutez préférences utiles. Import n’envoie aucune note
          aux fournisseurs.
        </p>
      )}
      {importing && (
        <ImportDialog
          close={() => setImporting(false)}
          perform={perform}
          notify={notify}
          imported={setNotes}
        />
      )}
    </section>
  );
}
