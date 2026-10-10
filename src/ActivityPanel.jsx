import React, { useState } from 'react';
import { ListChecks, FileCheck2, Terminal, ShieldCheck } from 'lucide-react';
const labels = { codex: 'Codex', claude: 'Claude' };
const states = {
  text: 'Texte lu',
  missing: 'Absent',
  redacted: 'Contenu omis',
  opaque: 'Aperçu limité',
  directory: 'Dossier',
  blocked: 'Lecture bloquée',
};
export default function ActivityPanel({ session }) {
  const [agent, setAgent] = useState('all');
  const activity = session?.activity || [];
  const records = activity.filter((entry) => agent === 'all' || entry.agent === agent);
  const evidence = (session?.tasks || []).filter((task) => task.reviewEvidence?.files.length);
  return (
    <div className="activity-panel">
      <details>
        <summary>
          <ListChecks size={14} />
          <strong>Journal outils</strong>
          <span>{activity.length}</span>
        </summary>
        <label className="activity-filter">
          Agent
          <select
            aria-label="Filtrer journal outils"
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
          >
            <option value="all">Deux agents</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <div className="activity-log" role="log" aria-label="Événements outils CLI">
          {records.map((entry) => (
            <article key={entry.id}>
              <div>
                <Terminal size={11} />
                <strong>{labels[entry.agent]}</strong>
                <span>
                  {new Date(entry.at).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
              <small>
                {entry.phase} · {entry.tool}
              </small>
              {entry.detail && <code title={entry.detail}>{entry.detail}</code>}
            </article>
          ))}
          {!records.length && <p>Aucun appel outil observé pour ce filtre.</p>}
        </div>
        <p className="activity-note">
          Invocations annoncées par CLI. Résultats et validations dans rapports. 500 événements
          récents conservés.
        </p>
      </details>
      {evidence.length > 0 && (
        <details>
          <summary>
            <FileCheck2 size={14} />
            <strong>Fichiers relus</strong>
            <span>{evidence.length}</span>
          </summary>
          <p className="activity-note">
            Snapshots locaux transmis avant relecture. Extraits bornés. Fichiers sensibles usuels
            (.env, clés, métadonnées Git) omis du snapshot.
          </p>
          {evidence.map((task) => (
            <section className="review-evidence" key={task.id}>
              <strong>{task.title}</strong>
              {task.reviewEvidence.files.map((file) => (
                <div key={file.path}>
                  <ShieldCheck size={11} />
                  <span>
                    <code title={file.path}>{file.path}</code>
                    <small>
                      {states[file.status] || file.status}
                      {file.truncated ? ' · extrait' : ''}
                      {file.hash ? ` · SHA ${file.hash.slice(0, 8)}` : ''}
                    </small>
                  </span>
                </div>
              ))}
            </section>
          ))}
        </details>
      )}
    </div>
  );
}
