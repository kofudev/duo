import React from 'react';
import {
  FilePlus2,
  FilePenLine,
  FileX2,
  CheckCircle2,
  CircleAlert,
  Terminal,
  Server,
} from 'lucide-react';
const kinds = {
  created: ['Créé', FilePlus2],
  modified: ['Modifié', FilePenLine],
  deleted: ['Supprimé', FileX2],
};
export default function MissionRecap({ session, openFile }) {
  const recap = session?.recap,
    results = session?.results || [];
  if (!recap && !results.length) return null;
  const remote = results.filter(
    (entry) => entry.remote && ['created', 'modified', 'write'].includes(entry.kind)
  );
  const commands = results.filter((entry) => entry.kind === 'command');
  return (
    <section className="mission-recap" aria-label="Récapitulatif observé">
      <div className="recap-heading">
        <CheckCircle2 size={16} />
        <strong>Récapitulatif observé</strong>
        <span>{recap?.changes.length || 0} fichiers locaux</span>
      </div>
      <p>
        {recap?.basis === 'resume'
          ? 'Comparaison depuis reprise de cette ancienne mission.'
          : 'Comparaison avant / après mission.'}{' '}
        Modifications extérieures éventuelles incluses ; aucune réussite déduite du seul discours
        des agents.
      </p>
      <div className="recap-files">
        {(recap?.changes || []).map((file) => {
          const [label, Icon] = kinds[file.kind];
          return (
            <button
              key={file.path}
              disabled={file.kind === 'deleted'}
              onClick={() => openFile(file.path)}
            >
              <Icon size={14} />
              <code>{file.path}</code>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {recap && !recap.changes.length && <p>Aucun changement local observé.</p>}
      {recap?.limited && (
        <p className="recap-limited">
          <CircleAlert size={13} />
          Couverture limitée : fichiers sensibles, dépendances, sorties générées et liens exclus.
          Gros fichiers suivis par métadonnées.
        </p>
      )}
      {remote.map((entry) => (
        <div className="recap-command" key={entry.id}>
          <Server size={14} />
          <strong>{entry.connection}</strong>
          <code>{entry.path}</code>
          <span>
            {kinds[entry.kind]?.[0] ||
              (entry.status === 'unknown'
                ? 'Résultat inconnu · vérifier serveur'
                : entry.status === 'failed'
                  ? 'Échec signalé'
                  : 'En cours')}
          </span>
        </div>
      ))}
      {commands.length > 0 && (
        <details>
          <summary>
            <Terminal size={14} />
            Commandes observées · {commands.length}
          </summary>
          {commands.map((entry) => (
            <div className="recap-command" key={entry.id}>
              <strong>
                {entry.remote
                  ? entry.connection
                  : entry.agent === 'system'
                    ? 'Duo'
                    : entry.agent === 'codex'
                      ? 'Codex'
                      : 'Claude'}
              </strong>
              <code>{entry.command}</code>
              <span>
                {Number.isInteger(entry.exitCode)
                  ? `Code ${entry.exitCode}`
                  : entry.status === 'failed'
                    ? 'Échec signalé'
                    : entry.status === 'unknown'
                      ? 'Résultat inconnu · vérifier serveur'
                      : entry.status === 'running'
                        ? 'En cours'
                        : 'Terminé · code non fourni'}
              </span>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
