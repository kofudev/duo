import React, { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Modal } from './ui';
const api = window.duo;
export default function UpdatesModal({ close }) {
  const [release, setRelease] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function check() {
    setBusy(true);
    setError('');
    setRelease(null);
    try {
      setRelease(await api.checkUpdate());
    } catch (e) {
      setError(e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Mises à jour Duo" close={close}>
      <p className="modal-intro">
        Vérifiez la dernière version publique. Le téléchargement ouvre directement l’installateur
        dans votre navigateur.
      </p>
      <button className="secondary-button" disabled={busy} onClick={check}>
        <RefreshCw size={16} /> {busy ? 'Vérification…' : 'Vérifier les mises à jour'}
      </button>
      <div aria-live="polite" className="update-result">
        {error && <p role="alert">{error}</p>}
        {release && (
          <>
            <p>
              Version installée : <strong>{release.current}</strong> · Version publique :{' '}
              <strong>{release.version}</strong>
            </p>
            <p>
              {release.available ? 'Nouvelle version disponible.' : 'Votre version est à jour.'}
            </p>
            {release.available && (
              <button
                className="primary-button"
                onClick={async () => {
                  try {
                    await api.downloadUpdate();
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                <Download size={16} /> Télécharger Duo {release.version}
              </button>
            )}
          </>
        )}
      </div>
      <p className="modal-intro">
        Terminez vos missions, enregistrez vos fichiers puis fermez Duo avant de lancer
        l’installateur. Vos projets et votre mémoire restent dans leur emplacement actuel.
        L’application est actuellement non signée.
      </p>
    </Modal>
  );
}
