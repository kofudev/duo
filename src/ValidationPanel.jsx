import React from 'react';
import { ShieldCheck } from 'lucide-react';
const labels = {
  configured: 'Commandes prêtes',
  running: 'En cours',
  passed: 'Commandes réussies',
  failed: 'Échec observé',
  repairing: 'Correction et relecture',
  interrupted: 'Interrompue',
  unconfigured: 'Aucune commande',
  not_run: 'Non exécutée',
  disabled: 'Désactivée',
  review_required: 'Modifications à relire',
};
export default function ValidationPanel({ session }) {
  const validation = session?.validation;
  const checks = (session?.results || []).filter((entry) => entry.executor === 'duo');
  if (!validation) return null;
  return (
    <section
      className={`validation-panel ${validation.state}`}
      aria-label="Validation exécutée par Duo"
    >
      <strong>
        <ShieldCheck size={15} /> Validation · {labels[validation.state] || validation.state}
      </strong>
      {validation.reason && <p>{validation.reason}</p>}
      {validation.state === 'configured' && <p>{(validation.commands || []).join(' · ')}</p>}
      {validation.repairs > 0 && <p>{validation.repairs} cycle(s) de correction automatique.</p>}
      {(checks.length ? checks : validation.results || []).slice(-16).map((entry) => (
        <details key={entry.id}>
          <summary>
            <code>{entry.command}</code>
            <span>
              {Number.isInteger(entry.exitCode)
                ? `Code ${entry.exitCode}`
                : entry.status === 'running'
                  ? 'En cours'
                  : 'Code inconnu'}
            </span>
          </summary>
          {entry.error && <p>{entry.error}</p>}
          <pre>
            {[entry.stdout, entry.stderr].filter(Boolean).join('\n') || 'Aucune sortie fournie.'}
          </pre>
        </details>
      ))}
      {checks.length > 0 && (
        <p>Derniers contrôles, y compris échecs corrigés. Historique conservé dans export.</p>
      )}
      {validation.state === 'passed' && (
        <p>
          Codes de sortie observés. Cela ne garantit pas couverture complète des tests ni réussite
          du déploiement.
        </p>
      )}
    </section>
  );
}
