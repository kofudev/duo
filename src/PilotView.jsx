import React, { useEffect, useState } from 'react';
import {
  Clock3,
  ShieldCheck,
  Brain,
  CalendarClock,
  Plus,
  Trash2,
  Pencil,
  Pin,
  X,
  RefreshCw,
  ArrowUpRight,
} from 'lucide-react';
import { Modal, IconButton } from './ui';
import { Quotas } from './ConnectionsModal';
import PersonalMemory from './PersonalMemory';

const api = window.duo;
const states = {
  scheduled: 'En attente',
  starting: 'Préparation',
  running: 'En cours',
  completed: 'Terminée',
  paused: 'Budget atteint',
  stopped: 'Arrêtée',
  blocked: 'Bloquée',
  missed: 'Départ manqué',
  interrupted: 'Interrompue',
  failed: 'Échec',
  cancelled: 'Annulée',
  attention: 'À vérifier',
  waiting_user: 'Réponse requise',
};
function NumberField({ label, name, value, min, max, change, help }) {
  const [draft, setDraft] = useState(String(value ?? min));
  useEffect(() => setDraft(String(value ?? min)), [value, min]);
  const commit = (event) => {
    const number = Number(draft);
    if (Number.isInteger(number) && number >= min && number <= max) change({ [name]: number });
    else {
      setDraft(String(value ?? min));
      event.target.setCustomValidity(`Valeur entre ${min} et ${max}.`);
      event.target.reportValidity();
    }
  };
  return (
    <label className="field">
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => {
          event.target.setCustomValidity('');
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {help && <small>{help}</small>}
    </label>
  );
}
export function BudgetFields({ config, change }) {
  return (
    <>
      <div className="pilot-mode">
        <label className="field">
          Coordination
          <select
            value={config.collaboration || 'economy'}
            onChange={(event) => change({ collaboration: event.target.value })}
          >
            <option value="economy">Économe · construire + relire</option>
            <option value="full">Complète · propositions + débats</option>
          </select>
        </label>
        <p>
          {config.collaboration === 'full'
            ? `Deux analyses, ${config.rounds} tour(s) de débat visibles, plan, construction, relecture.`
            : 'Discussion : deux avis + synthèse. Construction : plan direct, tâches réparties, relecture partenaire. Échanges visibles dans chat.'}
        </p>
      </div>
      <div className="settings-grid">
        <label className="checkbox-setting">
          <input
            type="checkbox"
            checked={config.timeLimitEnabled === true}
            onChange={(event) => change({ timeLimitEnabled: event.target.checked })}
          />
          <span>
            <strong>Activer limite de durée</strong>
            <small>Facultatif. Désactivé → travail jusqu’à résultat ou budget atteint.</small>
          </span>
        </label>
        {config.timeLimitEnabled === true && (
          <NumberField
            label="Durée maximale (minutes)"
            name="durationMinutes"
            value={config.durationMinutes}
            min={1}
            max={1440}
            change={change}
            help="Arrêt anticipé si objectif terminé. Aucun temps rempli artificiellement."
          />
        )}
        <NumberField
          label="Appels maximum par mission"
          name="maxCalls"
          value={config.maxCalls}
          min={1}
          max={200}
          change={change}
        />
        <NumberField
          label="Budget tokens par mission"
          name="tokenBudget"
          value={config.tokenBudget}
          min={1000}
          max={20000000}
          change={change}
        />
        <NumberField
          label="Réservation tokens par appel"
          name="callTokenReserve"
          value={config.callTokenReserve}
          min={1000}
          max={1000000}
          change={change}
          help="Estimation prudente. Usage réel peut dépasser réservation."
        />
        <NumberField
          label="Appels Duo maximum sur 24 h"
          name="dailyCalls"
          value={config.dailyCalls}
          min={1}
          max={1000}
          change={change}
        />
        <NumberField
          label="Tokens Duo maximum sur 24 h"
          name="dailyTokens"
          value={config.dailyTokens}
          min={1000}
          max={100000000}
          change={change}
        />
        <NumberField
          label="Réserve quota fournisseur (%)"
          name="quotaReserve"
          value={config.quotaReserve}
          min={5}
          max={95}
          change={change}
        />
        <label className="field">
          Quota indisponible
          <select
            value={config.quotaPolicy || 'available'}
            onChange={(event) => change({ quotaPolicy: event.target.value })}
          >
            <option value="available">Continuer avec budgets locaux</option>
            <option value="strict">Bloquer tout appel sans quota connu</option>
          </select>
        </label>
      </div>
      <div className="info-note">
        <ShieldCheck size={18} />
        <span>
          Codex : quotas relus avant chaque phase. Claude : quota automatique indisponible, mode
          strict bloque Claude. Quotas partagés avec autres applis ; appels en cours peuvent
          dépasser seuil tokens. Pas de garantie zéro dépassement.
        </span>
      </div>
      <label className="checkbox-setting">
        <input
          type="checkbox"
          checked={config.memoryEnabled !== false}
          onChange={(event) => change({ memoryEnabled: event.target.checked })}
        />
        <span>
          <strong>Mémoire projet ciblée</strong>
          <small>
            Maximum 6 notes pertinentes, 4 500 caractères réservés. Checkpoint local automatique,
            aucun appel IA supplémentaire.
          </small>
        </span>
      </label>
    </>
  );
}
function futureLocal() {
  const date = new Date(Date.now() + 5 * 60000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function ScheduleDialog({
  config,
  project,
  initialPrompt,
  close,
  perform,
  applyData,
  notify,
}) {
  const [text, setText] = useState(initialPrompt || ''),
    [date, setDate] = useState(futureLocal),
    [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const result = await perform(() =>
      api.schedule({ prompt: text, dueAt: new Date(date).getTime(), config })
    );
    if (result) {
      applyData(result);
      notify('Mission planifiée. Duo doit rester ouvert.');
      close();
    }
    setBusy(false);
  };
  return (
    <Modal title="Planifier mission" close={close}>
      <form onSubmit={submit}>
        <p className="modal-intro">
          {project?.name || 'Choisir projet'} ·{' '}
          {config.mode === 'build' ? 'Construction + relecture' : 'Discussion'} ·{' '}
          {config.timeLimitEnabled
            ? `maximum ${config.durationMinutes} min`
            : 'sans limite de durée'}
          . Modèles et réglages actuels enregistrés pour cette mission.
        </p>
        <label className="field">
          Départ (heure locale)
          <input
            type="datetime-local"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        <label className="field">
          Demande planifiée
          <textarea
            aria-label="Demande planifiée"
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={60000}
            required
          />
        </label>
        <div className="info-note">
          <CalendarClock size={18} />
          <span>
            Duo ouvert + Windows réveillé. Une seule mission à la fois. Retard supérieur à 15 min →
            départ manqué, sans exécution automatique. Connexion ou budget manquant → mission
            bloquée.
          </span>
        </div>
        <button
          type="submit"
          className="primary-button full"
          disabled={busy || !project || !text.trim()}
        >
          <CalendarClock size={16} />
          Enregistrer planification
        </button>
      </form>
    </Modal>
  );
}
export default function PilotView({
  config,
  changeConfig,
  project,
  running,
  perform,
  notify,
  schedules,
  setSchedules,
  openSchedule,
  openSession,
  session,
}) {
  const [notes, setNotes] = useState([]),
    [search, setSearch] = useState(''),
    [usage, setUsage] = useState(null),
    [quota, setQuota] = useState(null);
  const [editing, setEditing] = useState(null),
    [title, setTitle] = useState(''),
    [text, setText] = useState(''),
    [tags, setTags] = useState(''),
    [pinned, setPinned] = useState(false);
  const load = async () => {
    const result = await perform(() => api.memory());
    if (result?.projectId === project?.id) setNotes(result.notes);
    const totals = await perform(() => api.usage());
    if (totals) setUsage(totals);
    const snapshot = await perform(() => api.quota());
    if (snapshot) setQuota(snapshot);
  };
  useEffect(() => {
    setNotes([]);
    setEditing(null);
    setTitle('');
    setText('');
    setTags('');
    setPinned(false);
    load();
  }, [project?.id, running]);
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const timer = setInterval(
      () =>
        api
          .usage()
          .then((result) => {
            if (alive) setUsage(result);
          })
          .catch(() => {}),
      3000
    );
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [running]);
  const liveLimits = session?.state === 'running' ? session.budget?.quotas?.codex : null;
  const limits = liveLimits
    ? Object.fromEntries(
        liveLimits.windows.map((window) => [
          window.limitId,
          Object.fromEntries(
            liveLimits.windows
              .filter((item) => item.limitId === window.limitId)
              .map((item) => [item.kind, item])
          ),
        ])
      )
    : quota?.codex;
  const edit = (note) => {
    setEditing(note);
    setTitle(note?.title || '');
    setText(note?.text || '');
    setTags(note?.tags?.join(', ') || '');
    setPinned(note?.pinned || false);
  };
  const save = async (event) => {
    event.preventDefault();
    const result = await perform(() =>
      api.saveMemory({
        id: editing?.id,
        expectedUpdatedAt: editing?.updatedAt,
        projectId: project.id,
        title,
        text,
        tags,
        pinned,
      })
    );
    if (result) {
      setNotes(result);
      edit(null);
      notify('Note enregistrée.');
    }
  };
  const visible = notes
    .filter((note) =>
      `${note.title} ${note.text} ${note.tags.join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const currentJobs = schedules
    .filter((job) => job.projectId === project?.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="pilot-page">
      <div className="management-heading">
        <div>
          <span className="eyebrow">AUTONOMIE MAÎTRISÉE</span>
          <h1>Pilotage & mémoire</h1>
          <p>Travail utile. Contexte ciblé. Budgets visibles.</p>
        </div>
        <button className="secondary-button" onClick={load}>
          <RefreshCw size={16} />
          Actualiser usage
        </button>
      </div>
      <div className="pilot-stats">
        <article>
          <Clock3 size={20} />
          <strong>
            {config.timeLimitEnabled ? `${config.durationMinutes || 60} min` : 'Libre'}
          </strong>
          <span>{config.timeLimitEnabled ? 'maximum par mission' : 'durée · quotas actifs'}</span>
        </article>
        <article>
          <ShieldCheck size={20} />
          <strong>
            {usage?.calls || 0} / {config.dailyCalls}
          </strong>
          <span>appels Duo · dernières 24 h</span>
        </article>
        <article>
          <Brain size={20} />
          <strong>{(usage?.tokens || 0).toLocaleString('fr-FR')}</strong>
          <span>
            tokens connus · {(usage?.chargedTokens || 0).toLocaleString('fr-FR')} comptés avec
            réservations
          </span>
        </article>
      </div>
      <PersonalMemory
        config={config}
        changeConfig={changeConfig}
        running={running}
        perform={perform}
        notify={notify}
      />
      <div className="pilot-columns">
        <section className="pilot-card">
          <div className="section-heading">
            <h2>Temps & quotas</h2>
            <ShieldCheck size={18} />
          </div>
          <div className="pilot-quota">
            <h3>Quota Codex disponible</h3>
            <Quotas limits={limits} />
            <small>
              Relevé{' '}
              {new Date(liveLimits?.at || quota?.at || Date.now()).toLocaleTimeString('fr-FR')} ·
              seuil réserve {config.quotaReserve} %
            </small>
            <p className="pilot-help">
              Claude → quota non exposé. Vérifier /usage dans Claude Code. Mode strict empêche
              démarrage sans cette donnée.
            </p>
          </div>
          <BudgetFields config={config} change={changeConfig} />
          {usage?.unknown > 0 && (
            <p className="pilot-warning">
              {usage.unknown} appel(s) avec usage incomplet → réservation conservée. Limites 24 h
              comptent tous projets Duo.
            </p>
          )}
          <p className="pilot-help">
            Abonnement ≠ tarif API. Aucune estimation euros inventée. Comparez appels, tokens connus
            et résultat réel. Effort maximal consomme davantage ; réglez-le dans Modèles.
          </p>
        </section>
        <section className="pilot-card">
          <div className="section-heading">
            <h2>Départs planifiés</h2>
            <button className="text-link" disabled={!project || running} onClick={openSchedule}>
              <Plus size={15} />
              Planifier
            </button>
          </div>
          <p className="pilot-help">
            Duo reste ouvert. Les missions attendent leur tour. Chaque mission garde ses réglages au
            moment de planification.
          </p>
          <div
            className="scheduled-list"
            tabIndex={0}
            role="region"
            aria-label="Départs planifiés du projet"
          >
            {currentJobs.length ? (
              currentJobs.map((job) => (
                <article key={job.id}>
                  <div>
                    <strong>{new Date(job.dueAt).toLocaleString('fr-FR')}</strong>
                    <span className={`job-state ${job.state}`}>
                      {states[job.state] || job.state}
                    </span>
                  </div>
                  <p>{job.prompt.slice(0, 220)}</p>
                  <small>
                    {job.config.timeLimitEnabled
                      ? `${job.config.durationMinutes} min max`
                      : 'Durée libre'}{' '}
                    · {job.config.maxCalls} appels max ·{' '}
                    {job.config.collaboration === 'economy' ? 'Économe' : 'Complète'}
                  </small>
                  {job.error && <p className="pilot-warning">{job.error}</p>}
                  <div className="job-actions">
                    {job.state === 'scheduled' && (
                      <button
                        className="text-link"
                        onClick={async () => {
                          const result = await perform(() => api.cancelSchedule(job.id));
                          if (result) setSchedules(result);
                        }}
                      >
                        <X size={14} />
                        Annuler
                      </button>
                    )}
                    <button
                      className="text-link"
                      disabled={running}
                      onClick={() => openSession(job.sessionId)}
                    >
                      <ArrowUpRight size={14} />
                      Ouvrir mission
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="pilot-empty">
                <CalendarClock size={28} />
                <strong>Aucun départ prévu.</strong>
                <span>Planifiez une demande avec durée maximale.</span>
              </div>
            )}
          </div>
          {session?.stopReason && (
            <div className="info-note">
              <Clock3 size={16} />
              <span>{session.stopReason.message}</span>
            </div>
          )}
        </section>
      </div>
      <section className="pilot-card memory-card">
        <div className="section-heading">
          <h2>Mémoire · {project?.name || 'aucun projet'}</h2>
          <span>{notes.length}/200 notes</span>
        </div>
        <p className="pilot-help">
          Décisions, contraintes, chemins utiles. Recherche locale par mots et tags ; notes
          épinglées prioritaires. Checkpoints = états du coordinateur et verdicts IA à date.
          Revalider fichiers avant reprise.
        </p>
        <div className="memory-columns">
          <div>
            <label className="field">
              Chercher mémoire
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="auth, architecture, chemin…"
              />
            </label>
            <div
              className="memory-list"
              tabIndex={0}
              role="region"
              aria-label="Notes mémoire du projet"
            >
              {visible.map((note) => (
                <article className={editing?.id === note.id ? 'selected' : ''} key={note.id}>
                  <div>
                    <strong>
                      {note.pinned && <Pin size={12} />}
                      {note.title}
                    </strong>
                    <small>
                      {note.kind === 'checkpoint' ? 'Checkpoint' : 'Note'} ·{' '}
                      {new Date(note.updatedAt || note.at).toLocaleDateString('fr-FR')}
                    </small>
                  </div>
                  <p tabIndex={0} role="region" aria-label={`Contenu note ${note.title}`}>
                    {note.text}
                  </p>
                  <div className="memory-tags">
                    {note.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <div className="job-actions">
                    <button className="text-link" disabled={running} onClick={() => edit(note)}>
                      <Pencil size={13} />
                      Modifier
                    </button>
                    <IconButton
                      label={`Supprimer note ${note.title}`}
                      disabled={running}
                      onClick={async () => {
                        const result = await perform(() =>
                          api.deleteMemory({ id: note.id, projectId: project.id })
                        );
                        if (result) {
                          setNotes(result);
                          if (editing?.id === note.id) edit(null);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                    {note.sessionId && (
                      <button
                        className="text-link"
                        disabled={running}
                        onClick={() => openSession(note.sessionId)}
                      >
                        Mission source <ArrowUpRight size={12} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!visible.length && (
                <p className="pilot-help">
                  Aucune note correspondante. Fin de mission → checkpoint automatique.
                </p>
              )}
            </div>
          </div>
          <form onSubmit={save}>
            <div className="section-heading">
              <h3>{editing ? 'Modifier note' : 'Nouvelle note'}</h3>
              {editing && (
                <button type="button" className="text-link" onClick={() => edit(null)}>
                  Annuler
                </button>
              )}
            </div>
            <label className="field">
              Titre note
              <input
                maxLength={100}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              Contenu mémoire
              <textarea
                aria-label="Contenu mémoire"
                rows={7}
                maxLength={1600}
                required
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Décision précise + raison + fichiers concernés."
              />
            </label>
            <label className="field">
              Tags (séparés par virgules)
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="architecture, auth, src/login.ts"
              />
            </label>
            <label className="checkbox-setting">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(event) => setPinned(event.target.checked)}
              />
              <span>Épingler · contexte prioritaire</span>
            </label>
            <button
              className="primary-button full"
              type="submit"
              disabled={!project || running || !title.trim() || !text.trim()}
            >
              <Brain size={16} />
              {editing ? 'Enregistrer note' : 'Ajouter note'}
            </button>
            <p className="pilot-help">
              Pas de secrets. Note ancienne peut devenir fausse. Désactiver mémoire arrête son
              injection et les futurs checkpoints.
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
