import { useState } from 'react';
import type { Agenda } from '../model.ts';
import type { SyncClient, JoinMode } from '../sync/client.ts';
import { native, type Where } from '../sync/remotes.ts';
import { Window } from './Window.tsx';

interface Props {
  client: SyncClient;
  agenda: Agenda;
  /** The agenda to show after turning synchronisation on (the folder's, or both merged). */
  onStarted: (agenda: Agenda, previous: Agenda | undefined) => void;
  onSyncNow: () => Promise<void>;
  onStopped: () => void;
  onClose: () => void;
}

const ago = (iso: string | null) => {
  if (!iso) return 'jamais';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

/** Synchronisation between devices through a shared folder (Nextcloud, Syncthing…), as in Saudade. */
export function SyncWindow({ client, agenda, onStarted, onSyncNow, onStopped, onClose }: Props) {
  const status = client.status();
  const bridge = native();
  const [kind, setKind] = useState<'webdav' | 'folder'>(bridge?.folder && bridge.platform === 'desktop' ? 'folder' : 'webdav');
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [folder, setFolder] = useState<{ ref: string; label: string } | null>(null);
  const [checked, setChecked] = useState<{ used: boolean; others: number } | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [mode, setMode] = useState<JoinMode>('take');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, refresh] = useState(0);

  const where = (): Where | null =>
    kind === 'folder'
      ? folder && { kind: 'folder', label: folder.label, ref: folder.ref }
      : url.trim() && user.trim() && password
        ? { kind: 'webdav', label: url.trim().replace(/^https?:\/\//, '').replace(/\/remote\.php\/dav\/files\/[^/]+\/?/, ' › '), url: url.trim(), user: user.trim(), password }
        : null;

  const check = async () => {
    const w = where();
    if (!w) return setError(kind === 'folder' ? 'Choisissez le dossier.' : "Remplissez l'adresse, l'identifiant et le mot de passe.");
    setBusy(true);
    setError(null);
    const r = await client.inspect(w as never);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setChecked({ used: r.used, others: r.others });
  };

  const start = async () => {
    const w = where();
    if (!w || !checked) return;
    if (!checked.used && pass !== pass2) return setError('Les deux phrases de passe sont différentes.');
    setBusy(true);
    setError(null);
    const r = await client.start(agenda, w as never, pass, mode);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onStarted(r.agenda, r.joined && mode === 'take' ? agenda : undefined);
  };

  if (status.enabled) {
    return (
      <Window
        title="Synchronisation"
        className="window-narrow"
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              className="ghost danger-text"
              onClick={async () => {
                if (!window.confirm("Désactiver la synchronisation sur cet appareil ? L'agenda reste ici, et dans le dossier pour les autres appareils.")) return;
                await client.stop();
                onStopped();
              }}
            >
              Désactiver
            </button>
            <span className="spacer" />
            <button type="button" className="ghost" onClick={onClose}>Fermer</button>
            <button type="button" className="primary" disabled={busy} onClick={async () => { setBusy(true); await onSyncNow(); setBusy(false); refresh((n) => n + 1); }}>
              {busy ? 'Synchronisation…' : 'Synchroniser maintenant'}
            </button>
          </>
        }
      >
        <dl className="sync-status">
          <dt>Dossier</dt><dd>{status.where}</dd>
          <dt>Dernière synchronisation</dt><dd>{ago(status.lastSync)}</dd>
          <dt>Autres appareils</dt><dd>{status.others || 'aucun pour l\'instant'}</dd>
          {status.pending > 0 && (<><dt>En attente d'envoi</dt><dd>{status.pending} modification(s)</dd></>)}
        </dl>
        {status.error && <p className="warning" role="alert">{status.error}</p>}
        <p className="muted small">Automatique au démarrage, toutes les 2 minutes et au retour sur l'application. Tout ce qui est écrit dans le dossier est chiffré avec votre phrase de passe.</p>
      </Window>
    );
  }

  return (
    <Window
      title="Synchronisation"
      subtitle="Le même agenda sur l'ordinateur et le téléphone, par un dossier partagé (Nextcloud, Syncthing…). Tout y est chiffré."
      className="window-medium"
      onClose={onClose}
      footer={
        <>
          {error && <span className="error" role="alert">{error}</span>}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Annuler</button>
          {!checked ? (
            <button type="button" className="primary" disabled={busy} onClick={check}>{busy ? 'Connexion…' : 'Vérifier le dossier'}</button>
          ) : (
            <button type="button" className="primary" disabled={busy || pass.length < 8} onClick={start}>{busy ? 'Activation…' : 'Activer'}</button>
          )}
        </>
      }
    >
      <div className="form">
        {bridge?.folder && (
          <div className="mode" role="radiogroup" aria-label="Accès au dossier">
            <button type="button" role="radio" aria-checked={kind === 'folder'} onClick={() => { setKind('folder'); setChecked(null); }}>
              {bridge.platform === 'android' ? 'Dossier du téléphone (Syncthing…)' : "Dossier de l'ordinateur"}
            </button>
            <button type="button" role="radio" aria-checked={kind === 'webdav'} onClick={() => { setKind('webdav'); setChecked(null); }}>Nextcloud (WebDAV)</button>
          </div>
        )}

        {kind === 'folder' ? (
          <div className="pick-folder">
            <button type="button" className="ghost" onClick={async () => { const f = await bridge?.folder?.pick(); if (f) { setFolder(f); setChecked(null); } }}>Choisir le dossier…</button>
            <span className="muted">{folder?.label ?? (bridge?.platform === 'android' ? 'Un dossier que Syncthing tient à jour' : 'Un dossier que Nextcloud, Syncthing ou Dropbox synchronise')}</span>
          </div>
        ) : (
          <>
            <label>
              <span>Adresse WebDAV du dossier</span>
              <input value={url} placeholder="https://cloud.exemple.fr/remote.php/dav/files/vous/Agenda-sync" onChange={(e) => { setUrl(e.target.value); setChecked(null); }} />
            </label>
            <p className="muted small">Dans Nextcloud : Fichiers › Paramètres (en bas à gauche) › adresse WebDAV, suivie du nom d'un dossier (créé s'il n'existe pas).</p>
            <div className="form-pair">
              <label>
                <span>Identifiant</span>
                <input value={user} autoComplete="username" onChange={(e) => { setUser(e.target.value); setChecked(null); }} />
              </label>
              <label>
                <span>Mot de passe d'application</span>
                <input type="password" value={password} autoComplete="current-password" onChange={(e) => { setPassword(e.target.value); setChecked(null); }} />
              </label>
            </div>
            <p className="muted small">Nextcloud › Paramètres personnels › Sécurité › créer un mot de passe d'application.</p>
            {!bridge && <p className="warning small">Dans un navigateur, Nextcloud refuse souvent la connexion : utilisez l'application pour ordinateur ou pour téléphone.</p>}
          </>
        )}

        {checked && (
          <>
            <p className="sync-checked" role="status">
              {checked.used
                ? `Dossier déjà utilisé${checked.others ? ` par ${checked.others === 1 ? 'un autre appareil' : `${checked.others} autres appareils`}` : ''} : saisissez sa phrase de passe.`
                : 'Nouveau dossier : choisissez une phrase de passe (8 caractères au moins). Notez-la : il la faudra sur chaque appareil.'}
            </p>
            <label>
              <span>Phrase de passe</span>
              <input type="password" value={pass} autoComplete="new-password" onChange={(e) => setPass(e.target.value)} />
            </label>
            {!checked.used && (
              <label>
                <span>Phrase de passe (encore)</span>
                <input type="password" value={pass2} autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} />
              </label>
            )}
            {checked.used && checked.others > 0 && (
              <fieldset>
                <legend>Cet appareil a déjà un agenda</legend>
                <label className="check">
                  <input type="radio" name="join" checked={mode === 'take'} onChange={() => setMode('take')} />
                  Prendre l'agenda du dossier (celui de cet appareil est gardé en copie)
                </label>
                <label className="check">
                  <input type="radio" name="join" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                  Fusionner les deux agendas
                </label>
              </fieldset>
            )}
          </>
        )}
      </div>
    </Window>
  );
}
