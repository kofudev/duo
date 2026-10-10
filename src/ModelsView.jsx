import React, { useState } from 'react';
import {
  Search,
  Check,
  RefreshCw,
  ExternalLink,
  Copy,
  AlertCircle,
  SlidersHorizontal,
} from 'lucide-react';
const api = window.duo;
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const highestEffort = (model) =>
  [...(model?.efforts || [])].sort((a, b) => effortOrder.indexOf(b) - effortOrder.indexOf(a))[0] ||
  '';
export default function ModelsView({
  catalogs,
  config,
  changeConfig,
  connections,
  refresh,
  busy,
  perform,
  notify,
}) {
  const [provider, setProvider] = useState('codex'),
    [query, setQuery] = useState(''),
    [legacy, setLegacy] = useState(true);
  const models = (catalogs[provider] || []).filter(
    (m) =>
      (legacy || !m.legacy) &&
      `${m.name} ${m.id} ${m.description || ''}`.toLowerCase().includes(query.toLowerCase())
  );
  const chosen = (catalogs[provider] || []).find((m) => m.id === config[`${provider}Model`]);
  const updateCommand = connections.claude?.updateCommand || 'claude update';
  return (
    <div className="models-page">
      <div className="page-heading">
        <div>
          <h1>Modèles & effort</h1>
          <p>Catalogue source, compatibilité CLI, choix par projet.</p>
        </div>
        <button className="secondary-button" onClick={refresh} disabled={busy}>
          <RefreshCw size={15} />
          Actualiser
        </button>
      </div>
      <div className="provider-tabs">
        <button
          className={provider === 'codex' ? 'active' : ''}
          onClick={() => setProvider('codex')}
        >
          ChatGPT / Codex <span>{catalogs.codex?.length || 0}</span>
        </button>
        <button
          className={provider === 'claude' ? 'active' : ''}
          onClick={() => setProvider('claude')}
        >
          Claude Code <span>{catalogs.claude?.length || 0}</span>
        </button>
      </div>
      <div className="model-summary">
        <div>
          <SlidersHorizontal size={19} />
          <span>
            <strong>{chosen?.name || config[`${provider}Model`] || 'Aucun modèle choisi'}</strong>
            <small>
              Effort {config[`${provider}Effort`] || 'automatique'} · CLI{' '}
              {connections[provider]?.version || 'introuvable'}
            </small>
          </span>
        </div>
        <label className="field inline">
          Effort
          <select
            aria-label={`Effort catalogue ${provider}`}
            value={config[`${provider}Effort`] || ''}
            onChange={(e) => changeConfig({ [`${provider}Effort`]: e.target.value })}
          >
            {provider === 'claude' && <option value="">Automatique</option>}
            {(chosen?.efforts || []).map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="skill-controls">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Rechercher modèles"
            placeholder="Nom ou ID modèle"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {provider === 'claude' && (
          <label className="simple-checkbox">
            <input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} />
            Versions précédentes
          </label>
        )}
      </div>
      <div className="model-list">
        {models.map((model) => {
          const active = config[`${provider}Model`] === model.id;
          return (
            <article key={model.id} className={active ? 'selected' : ''}>
              <div>
                <h2>
                  {model.name}
                  {model.alias && <span className="tiny-tag">Alias</span>}
                </h2>
                <code>{model.id}</code>
                {model.description && <p>{model.description}</p>}
                <div className="model-tags">
                  {model.efforts.length ? (
                    model.efforts.map((e) => (
                      <span
                        key={e}
                        className={e === config[`${provider}Effort`] && active ? 'active' : ''}
                      >
                        {e}
                      </span>
                    ))
                  ) : (
                    <span>Effort automatique</span>
                  )}
                  {model.discovery === 'live' && <span>Catalogue CLI</span>}
                  {model.context && <span>Contexte {model.context}</span>}
                  {model.mayUseCredits && <span className="warning-tag">Crédits possibles</span>}
                </div>
                <small
                  className={`model-availability ${model.status === 'update-required' ? 'warning' : ''}`}
                >
                  {model.status === 'update-required'
                    ? `CLI ${model.minimumVersion}+ requis`
                    : model.discovery === 'live'
                      ? 'Annoncé par CLI · accès selon compte'
                      : 'Documenté · accès compte à vérifier'}
                  {model.resolved &&
                    ` · ${model.resolvedSource === 'live' ? 'alias CLI' : 'alias prévu'} ${model.resolved}`}
                </small>
              </div>
              <button
                className={active ? 'secondary-button' : 'primary-button'}
                disabled={model.status === 'update-required'}
                onClick={() =>
                  changeConfig({
                    [`${provider}Model`]: model.id,
                    [`${provider}Effort`]: highestEffort(model),
                  })
                }
              >
                {active ? <Check size={14} /> : <SlidersHorizontal size={14} />}
                {active ? 'Choisi' : 'Choisir'}
              </button>
            </article>
          );
        })}
        {!models.length && (
          <div className="page-empty">
            <Search size={28} />
            <p>
              {provider === 'codex'
                ? 'Connecter Codex puis actualiser catalogue.'
                : 'Aucun modèle trouvé.'}
            </p>
          </div>
        )}
      </div>
      <div className="info-note">
        <AlertCircle size={17} />
        <span>
          {provider === 'codex'
            ? 'Catalogue chargé depuis Codex App Server. Modèles des chats web absents de ce catalogue ne sont pas exposés par cette connexion.'
            : 'Métadonnées CLI via SDK officiel, complétées par versions documentées. Abonnement et organisation déterminent accès final.'}
        </span>
      </div>
      {provider === 'claude' && connections.claude?.catalogError && (
        <p className="model-catalog-fallback">
          Découverte CLI indisponible : {connections.claude.catalogError}. Catalogue documentaire
          conservé.
        </p>
      )}
      {provider === 'claude' && (
        <div className="model-update">
          <span>Mettre à jour Claude Code</span>
          <code>{updateCommand}</code>
          <button
            className="text-link"
            onClick={async () => {
              const result = await perform(() => api.copy(updateCommand));
              if (result) notify('Commande copiée. Exécuter dans PowerShell.');
            }}
          >
            <Copy size={14} />
            Copier
          </button>
        </div>
      )}
      <button
        className="text-link"
        onClick={() =>
          perform(() =>
            api.openUrl(
              provider === 'codex'
                ? 'https://learn.chatgpt.com/docs/app-server'
                : 'https://code.claude.com/docs/en/model-config'
            )
          )
        }
      >
        Documentation officielle <ExternalLink size={13} />
      </button>
    </div>
  );
}
