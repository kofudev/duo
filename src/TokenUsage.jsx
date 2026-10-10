import React from 'react';
import { Gauge } from 'lucide-react';
const valid = (value) => Number.isFinite(value) && value >= 0;
const count = (value) => value.toLocaleString('fr-FR');
export default function TokenUsage({ session }) {
  const records = session?.telemetry || [];
  const avoided = session?.efficiency?.summaryCallsAvoided || 0;
  if (!records.length && !avoided) return null;
  const measured = records.filter((record) => record.usageKnown && valid(record.actualTokens));
  const cacheKnown = measured.filter(
    (record) =>
      valid(record.cachedInputTokens) &&
      valid(record.inputTokens) &&
      record.cachedInputTokens <= record.inputTokens
  );
  const cached = cacheKnown.reduce((sum, record) => sum + record.cachedInputTokens, 0);
  const denominator = cacheKnown.reduce((sum, record) => sum + record.inputTokens, 0);
  const total = measured.reduce((sum, record) => sum + record.actualTokens, 0);
  return (
    <section className="token-usage" aria-label="Consommation mesurée">
      <details>
        <summary>
          <Gauge size={14} />
          <strong>Consommation mesurée</strong>
          <span>{count(total)} tokens</span>
        </summary>
        <p>
          {measured.length}/{session?.budget?.calls || records.length} appels avec usage fourni.
          Entrées + sorties, cache inclus. Appels interrompus : usage reçu peut être partiel.
        </p>
        {avoided > 0 && (
          <p className="token-avoided">
            {avoided} appel de synthèse évité → bilan assemblé localement. Relectures conservées.
          </p>
        )}
        {cacheKnown.length > 0 ? (
          <p>
            Cache lu : {count(cached)} tokens
            {denominator > 0
              ? ` · ${Math.round((cached / denominator) * 100)} % des entrées dont le cache est connu`
              : ''}
            . Réutilisation mesurée, pas pourcentage d’économie sur abonnement.
          </p>
        ) : (
          <p>Réutilisation du cache non fournie.</p>
        )}
        <div className="token-calls">
          {records.map((record) => (
            <div key={record.id}>
              <strong>
                {record.agent === 'codex' ? 'Codex' : 'Claude'} · {record.phase || 'Ancien appel'}
              </strong>
              <span>
                {record.usageKnown ? `${count(record.actualTokens)} tokens` : 'Usage inconnu'}
                {record.state === 'interrupted'
                  ? ' · interrompu'
                  : record.state === 'running'
                    ? ' · en cours'
                    : ''}
              </span>
              <small>
                Entrée {valid(record.inputTokens) ? count(record.inputTokens) : '?'} · sortie{' '}
                {valid(record.outputTokens) ? count(record.outputTokens) : '?'} · cache lu{' '}
                {valid(record.cachedInputTokens) ? count(record.cachedInputTokens) : '?'} · cache
                écrit{' '}
                {valid(record.cacheWriteInputTokens) ? count(record.cacheWriteInputTokens) : '?'}
              </small>
            </div>
          ))}
        </div>
        <p>
          Gain face à un agent seul non mesuré. Comparer mêmes tâches et même niveau de validation ;
          aucun montant en euros déduit.
        </p>
      </details>
    </section>
  );
}
