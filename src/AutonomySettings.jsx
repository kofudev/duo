import React from 'react';
export default function AutonomySettings({ config, change }) {
  return (
    <div className="autonomy-settings">
      <label className="field">
        Accès pendant construction
        <select
          aria-label="Accès pendant construction"
          value={config.accessMode || 'project'}
          onChange={(event) => change({ accessMode: event.target.value })}
        >
          <option value="project">Projet · accès limité</option>
          <option value="full">Accès complet · ordinateur et réseau</option>
        </select>
      </label>
      <p className="access-description">
        {config.accessMode === 'full'
          ? 'Commandes, réseau et fichiers hors projet autorisés pour votre demande. Ce mode retire le sandbox local ; actions exécutées avec droits de votre compte Windows.'
          : 'Codex conserve sandbox projet. Claude utilise outils de lecture et écriture du projet ; commandes selon option ci-dessous.'}{' '}
        Discussion et relectures restent en lecture seule. Connexions SSH gardent leurs droits
        propres. Quotas restent actifs.
      </p>
      <label className="checkbox-setting">
        <input
          type="checkbox"
          checked={config.commands || config.accessMode === 'full'}
          disabled={config.accessMode === 'full'}
          onChange={(event) => change({ commands: event.target.checked })}
        />
        <span>
          <strong>Autoriser commandes projet et validations</strong>
          <small>
            Les agents et Duo peuvent lancer tests et scripts. Inclus avec accès complet.
          </small>
        </span>
      </label>
      <div className="settings-grid">
        <label className="field">
          Validation après construction
          <select
            aria-label="Validation après construction"
            value={config.validationMode || 'auto'}
            onChange={(event) => change({ validationMode: event.target.value })}
          >
            <option value="auto">Automatique · contrôles détectés et proposés</option>
            <option value="manual">Mes commandes</option>
            <option value="off">Désactivée</option>
          </select>
        </label>
        <label className="field">
          Corrections maximum par étape
          <select
            aria-label="Corrections maximum par étape"
            value={config.maxFixCycles ?? 2}
            onChange={(event) => change({ maxFixCycles: Number(event.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {config.validationMode === 'manual' && (
        <label className="field">
          Commandes de validation · une par ligne
          <textarea
            aria-label="Commandes de validation"
            key={config.project}
            defaultValue={(config.validationCommands || []).join('\n')}
            rows={3}
            maxLength={16000}
            placeholder={'npm test\nnpm run build'}
            onChange={(event) =>
              change({
                validationCommands: event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      )}
      <label className="field">
        Délai par commande · secondes
        <input
          aria-label="Délai par commande"
          type="number"
          min={10}
          max={900}
          value={config.validationTimeoutSeconds || 120}
          onChange={(event) => change({ validationTimeoutSeconds: Number(event.target.value) })}
        />
      </label>
      <p className="access-description">
        Duo exécute les commandes dans votre projet, observe leurs codes de sortie et fait corriger
        les échecs. Chaque correction est relue. Besoin de commandes autorisées. Maximum huit
        commandes ; sorties conservées dans la mission. Les scripts utilisent vos droits Windows,
        même quand ils démarrent dans le dossier projet.
      </p>
    </div>
  );
}
