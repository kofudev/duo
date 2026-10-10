import React from 'react';
import { Check, AlertCircle, Copy, RefreshCw, Loader2, ExternalLink, Plug } from 'lucide-react';
import { Modal, IconButton } from './ui';
import { AgentMark } from './ProviderLogo';
const api = window.duo;
const resetTime = (value) =>
  Number.isFinite(value)
    ? new Date(value * 1000).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Indisponible';
export function Quotas({ limits }) {
  if (!limits)
    return (
      <p className="quota-unavailable">Quotas Codex indisponibles. Actualiser pour vérifier.</p>
    );
  return (
    <div className="quota-list">
      {Object.entries(limits)
        .filter(([, value]) => value)
        .map(([id, value]) => (
          <div key={id}>
            <strong>{value.limitName || id}</strong>
            {[
              ['primary', 'Fenêtre courte'],
              ['secondary', 'Fenêtre longue'],
            ].map(([key, label]) => {
              const limit = value[key];
              if (!limit || !Number.isFinite(limit.usedPercent)) return null;
              const remaining = Math.max(0, Math.min(100, 100 - limit.usedPercent));
              return (
                <div className="quota-window" key={key}>
                  <div>
                    <span>{label}</span>
                    <b>{Math.round(remaining)} % restants</b>
                  </div>
                  <progress value={remaining} max={100} aria-label={`${label} quota restant`} />
                  <small>Renouvellement {resetTime(limit.resetsAt)}</small>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
export default function ConnectionsModal({
  connections,
  close,
  busy,
  refresh,
  perform,
  notify,
  openSSH,
}) {
  const copy = async (text) => {
    if (await perform(() => api.copy(text))) notify('Commande copiée. Exécuter dans PowerShell.');
  };
  return (
    <Modal title="Connexions" close={close}>
      <p className="modal-intro">
        CLI officiels gèrent connexions. Duo utilise abonnements déjà connectés. Aucun mot de passe
        ni jeton importé.
      </p>
      {[
        ['codex', 'Codex CLI'],
        ['claude', 'Claude Code'],
        ['github', 'GitHub CLI'],
      ].map(([id, title]) => {
        const connection = connections[id] || {},
          command =
            connection.command ||
            { codex: 'codex login', claude: 'claude auth login', github: 'gh auth login' }[id];
        return (
          <div className="connection-row" key={id}>
            <div>
              <AgentMark agent={id} />
              <span>
                <strong>{title}</strong>
                <small>
                  {connection.connected
                    ? 'Connecté'
                    : connection.installed
                      ? 'Installé · connexion requise'
                      : 'CLI introuvable'}
                  {connection.version && ` · ${connection.version}`}
                  {connection.plan && ` · plan ${connection.plan}`}
                </small>
              </span>
            </div>
            <span className={`status-badge ${connection.connected ? 'ready' : ''}`}>
              {connection.connected ? <Check size={13} /> : <AlertCircle size={13} />}
              {connection.connected ? 'Prêt' : 'À configurer'}
            </span>
            {connection.error && <p className="connection-error">{connection.error}</p>}
            <div className="command">
              <code>{command}</code>
              <IconButton label={`Copier commande ${id}`} onClick={() => copy(command)}>
                <Copy size={15} />
              </IconButton>
            </div>
            {connection.updateCommand && (
              <button
                className="text-link connection-update"
                onClick={() => copy(connection.updateCommand)}
              >
                <RefreshCw size={12} />
                Copier commande mise à jour
              </button>
            )}
          </div>
        );
      })}
      <h3 className="quota-heading">Abonnement ChatGPT</h3>
      {connections.codex?.connected ? (
        <Quotas limits={connections.codex.rateLimits} />
      ) : (
        <p className="quota-unavailable">Connecter Codex pour voir quotas.</p>
      )}
      <p className="quota-unavailable">
        Claude : quotas compte non exposés par cette intégration. Compteurs mission issus des
        réponses, quand disponibles.
      </p>
      <div className="info-note">
        <Plug size={17} />
        <span>
          Usage personnel local. Accès selon abonnement + organisation. Crédits supplémentaires
          Claude désactivés par défaut.
        </span>
      </div>
      <button className="primary-button full" onClick={refresh} disabled={busy}>
        {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}Actualiser
        connexions
      </button>
      <button className="secondary-button full" onClick={openSSH}>
        Gérer serveurs SSH
      </button>
      <button
        className="text-link"
        onClick={() => perform(() => api.openUrl('https://code.claude.com/docs/en/authentication'))}
      >
        Aide connexion Claude <ExternalLink size={13} />
      </button>
    </Modal>
  );
}
