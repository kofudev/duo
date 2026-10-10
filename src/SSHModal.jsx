import React, { useState } from 'react';
import { Server, Plus, KeyRound, Check, Loader2, Trash2 } from 'lucide-react';
import { Modal } from './ui';
const api = window.duo;
const empty = () => ({
  name: '',
  alias: '',
  host: '',
  user: '',
  port: 22,
  root: '',
  identityFile: '',
  allowWrite: false,
  allowCommands: false,
});
export default function SSHModal({
  profiles = [],
  selected,
  project,
  close,
  perform,
  update,
  select,
  locked,
}) {
  const [form, setForm] = useState(empty),
    [aliasMode, setAliasMode] = useState(true),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  const change = (key, value) => {
    setForm((old) => ({ ...old, [key]: value }));
    setResult('');
  };
  const choose = (profile) => {
    setForm(profile);
    setAliasMode(!!profile.alias);
    setResult('');
  };
  const save = async () => {
    setBusy(true);
    try {
      const values = {
        ...form,
        alias: aliasMode ? form.alias : '',
        host: aliasMode ? '' : form.host,
        user: aliasMode ? '' : form.user,
      };
      const items = await perform(() => api.saveSSH(values));
      if (items) {
        update(items);
        const saved = items.find((item) => item.id === form.id) || items.at(-1);
        setForm(saved);
        setResult('Connexion enregistrée.');
      }
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setResult('Vérification SSH…');
    try {
      const connection = await perform(() => api.testSSH(form.id));
      setResult(
        connection
          ? `Connecté · ${connection.root} · Python ${connection.python}`
          : 'Connexion refusée. Vérifier accès et empreinte hôte dans OpenSSH.'
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const items = await perform(() => api.deleteSSH(form.id));
      if (items) {
        update(items);
        if (selected === form.id) select('');
        setForm(empty());
        setResult('Connexion supprimée.');
      }
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || locked;
  return (
    <Modal title="Serveurs SSH" close={close}>
      <p className="modal-intro">
        Codex et Claude partagent connexion choisie pour ce projet. OpenSSH garde clés et
        empreintes. Aucun mot de passe stocké dans Duo.
      </p>
      <div className="ssh-profiles">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            className={form.id === profile.id ? 'active' : ''}
            onClick={() => choose(profile)}
          >
            <Server size={14} />
            <span>{profile.name}</span>
            {selected === profile.id && <Check size={14} />}
          </button>
        ))}
        <button
          onClick={() => {
            setForm(empty());
            setAliasMode(true);
            setResult('');
          }}
        >
          <Plus size={14} />
          Nouvelle connexion
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="settings-grid">
          <label className="field">
            Nom connexion
            <input
              required
              value={form.name}
              maxLength={80}
              onChange={(event) => change('name', event.target.value)}
              placeholder="Serveur production"
              disabled={disabled}
            />
          </label>
          <label className="field">
            Connexion
            <select
              value={aliasMode ? 'alias' : 'host'}
              onChange={(event) => setAliasMode(event.target.value === 'alias')}
              disabled={disabled}
            >
              <option value="alias">Alias OpenSSH existant</option>
              <option value="host">Hôte et utilisateur</option>
            </select>
          </label>
          {aliasMode ? (
            <label className="field">
              Alias dans ~/.ssh/config
              <input
                required
                value={form.alias}
                onChange={(event) => change('alias', event.target.value)}
                placeholder="mon-vps"
                disabled={disabled}
              />
            </label>
          ) : (
            <>
              <label className="field">
                Hôte
                <input
                  required
                  value={form.host}
                  onChange={(event) => change('host', event.target.value)}
                  placeholder="192.0.2.10"
                  disabled={disabled}
                />
              </label>
              <label className="field">
                Utilisateur
                <input
                  value={form.user}
                  onChange={(event) => change('user', event.target.value)}
                  placeholder="deploy"
                  disabled={disabled}
                />
              </label>
              <label className="field">
                Port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(event) => change('port', event.target.value)}
                  disabled={disabled}
                />
              </label>
            </>
          )}
          <label className="field">
            Dossier distant autorisé
            <input
              required
              value={form.root}
              onChange={(event) => change('root', event.target.value)}
              placeholder="/var/www/mon-projet"
              disabled={disabled}
            />
          </label>
        </div>
        <label className="field">
          Clé privée OpenSSH · facultatif
          <input
            value={form.identityFile}
            onChange={(event) => change('identityFile', event.target.value)}
            placeholder="Clé agent SSH ou configuration existante"
            disabled={disabled}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={async () => {
            const file = await perform(() => api.pickSSHKey());
            if (file) change('identityFile', file);
          }}
        >
          <KeyRound size={14} />
          Choisir fichier clé
        </button>
        <div className="ssh-permissions">
          <label>
            <input
              type="checkbox"
              checked={form.allowWrite}
              onChange={(event) => change('allowWrite', event.target.checked)}
              disabled={disabled}
            />
            <span>
              <strong>Autoriser écriture de fichiers</strong>
              <small>
                Uniquement en mode Construire. Chemins relatifs, empreinte vérifiée avant
                remplacement.
              </small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.allowCommands}
              onChange={(event) => change('allowCommands', event.target.checked)}
              disabled={disabled}
            />
            <span>
              <strong>Autoriser commandes et déploiement</strong>
              <small>
                Commandes système peuvent accéder ailleurs sur serveur. Dossier de départ ≠ sandbox.
                Nécessite aussi option commandes mission.
              </small>
            </span>
          </label>
        </div>
        <p className="activity-note">
          Serveur Unix avec Python 3 requis. Première connexion : lancer SSH dans PowerShell et
          vérifier empreinte hôte. Duo refuse hôte inconnu ou empreinte changée. Enregistrer
          modifications avant tester.
        </p>
        <div className="ssh-actions">
          <button className="primary-button" type="submit" disabled={disabled}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}Enregistrer
            connexion
          </button>
          {form.id && (
            <>
              <button className="secondary-button" type="button" disabled={disabled} onClick={test}>
                Tester connexion SSH
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={disabled}
                onClick={remove}
              >
                <Trash2 size={14} />
                Supprimer
              </button>
            </>
          )}
        </div>
      </form>
      {result && (
        <p className="ssh-result" role="status">
          {result}
        </p>
      )}
      {form.id && (
        <button
          className="primary-button full"
          disabled={disabled || !project}
          onClick={() => select(form.id)}
        >
          {selected === form.id
            ? 'Connexion sélectionnée pour ce projet'
            : 'Utiliser pour ce projet'}
        </button>
      )}
      {selected && (
        <button className="text-link" disabled={disabled} onClick={() => select('')}>
          Désactiver SSH pour ce projet
        </button>
      )}
    </Modal>
  );
}
