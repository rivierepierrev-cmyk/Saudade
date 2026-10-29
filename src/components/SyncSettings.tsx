import React, { useEffect, useState } from 'react';
import { Cloud, FolderOpen, RefreshCw } from 'lucide-react';
import {
  SyncStatus, chooseFolder, disableSync, enableSync, getStatus, inspectFolder, onStatusChanged, syncAvailable, syncNow, syncTransport,
} from '../lib/sync/client';

const SECONDARY =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--fg-4a3e31)] bg-[var(--bg-ffffff)] border border-[var(--bd-d5cbbf)] rounded-lg hover:bg-[var(--bg-f3efe8)] transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-default';
const PRIMARY =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-default';
const INPUT =
  'w-full max-w-sm px-2.5 py-1.5 text-sm text-[var(--fg-28231d)] bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-md';

function ago(iso: string | null): string {
  if (!iso) return 'jamais';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The phone's folders come as JSON ({kind: 'folder', uri, name}); show their name. */
function folderLabel(folder: string): string {
  try {
    const spec = JSON.parse(folder) as { name?: string };
    return spec.name ?? folder;
  } catch {
    return folder;
  }
}

/** Réglages › Synchronisation: a shared folder (Nextcloud…) and a passphrase. */
export const SyncSettings: React.FC<{ onDone: (message: string) => void }> = ({ onDone }) => {
  const [status, setStatus] = useState<SyncStatus | null>(getStatus());
  const [folder, setFolder] = useState<string | null>(null);
  const [folderInfo, setFolderInfo] = useState<{ used: boolean; others: number } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  // Phone: Nextcloud reached through WebDAV (address of the folder, user, app password).
  const [dav, setDav] = useState({ url: '', user: '', password: '' });
  // …or a folder of the phone that Syncthing (or another app) keeps in sync.
  const [phoneMode, setPhoneMode] = useState<'nextcloud' | 'folder'>('nextcloud');
  const useDav = syncTransport === 'webdav' && phoneMode === 'nextcloud';
  const [, setTick] = useState(0);

  useEffect(() => onStatusChanged(() => setStatus(getStatus())), []);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000); // "il y a …"
    return () => window.clearInterval(t);
  }, []);

  if (!syncAvailable) {
    return <p className="mt-2 text-xs text-[var(--fg-8c8072)]">Disponible dans l’application de bureau.</p>;
  }

  const pick = async () => {
    setError(null);
    const chosen = useDav ? JSON.stringify({ ...dav, url: dav.url.trim(), user: dav.user.trim() }) : await chooseFolder();
    if (!chosen) return;
    setBusy(true);
    const info = await inspectFolder(chosen).finally(() => setBusy(false));
    if (!info.ok) {
      setError(info.error ?? 'Dossier inutilisable.');
      return;
    }
    setFolder(chosen);
    setFolderInfo({ used: Boolean(info.used), others: info.others ?? 0 });
    setReplace(true);
  };

  const joining = Boolean(folderInfo?.used);
  const takesLibrary = joining && (folderInfo?.others ?? 0) > 0;
  const canEnable =
    Boolean(folder) && passphrase.length >= 8 && (joining || passphrase === confirmation) && !busy;

  const enable = async () => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      const r = await enableSync(folder, passphrase, takesLibrary && replace);
      if (!r.ok) {
        setError(r.error ?? 'Activation impossible.');
        return;
      }
      setFolder(null);
      setFolderInfo(null);
      setPassphrase('');
      setConfirmation('');
      onDone('Synchronisation activée');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (status?.enabled) {
    return (
      <div className="mt-3 space-y-3">
        <p className="flex items-center gap-2 text-sm text-[var(--fg-4a4137)]">
          <Cloud className="w-4 h-4 text-[var(--fg-5f8550)]" />
          Activée · <span className="font-mono text-xs break-all">{status.folder}</span>
        </p>
        <p className="text-xs text-[var(--fg-695f54)]">
          Dernière synchronisation : {ago(status.lastSync)}
          {' · '}
          {status.others === 0 ? 'aucun autre appareil pour l’instant' : `${status.others} autre${status.others > 1 ? 's' : ''} appareil${status.others > 1 ? 's' : ''}`}
          {status.pending > 0 && ` · ${status.pending} modification${status.pending > 1 ? 's' : ''} en attente d’envoi`}
        </p>
        {status.error && (
          <p role="alert" className="text-xs text-[var(--fg-a84236)]">
            {status.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={SECONDARY}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const n = await syncNow();
                onDone(n > 0 ? `${n} changement${n > 1 ? 's' : ''} reçu${n > 1 ? 's' : ''}` : 'Déjà à jour');
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            Synchroniser maintenant
          </button>
          {confirmOff ? (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--fg-695f54)]">Désactiver ? Les données restent sur cet ordinateur et dans le dossier.</span>
              <button
                type="button"
                className={SECONDARY}
                onClick={async () => {
                  setConfirmOff(false);
                  await disableSync();
                  onDone('Synchronisation désactivée');
                }}
              >
                Oui, désactiver
              </button>
              <button type="button" className="px-2 py-1 text-[var(--fg-695f54)] cursor-pointer" onClick={() => setConfirmOff(false)}>
                Annuler
              </button>
            </span>
          ) : (
            <button type="button" className={SECONDARY} onClick={() => setConfirmOff(true)}>
              Désactiver
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--fg-8c8072)]">
          Avant de passer à un autre appareil, attendez que Nextcloud ou Syncthing indique que tout est synchronisé.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-[var(--fg-8c8072)]">
        Gardez la même bibliothèque sur plusieurs ordinateurs grâce à un dossier partagé (Nextcloud, Syncthing…). Tout ce qui y est
        écrit est chiffré avec votre phrase de passe : le serveur ne peut pas le lire.
      </p>
      {syncTransport === 'webdav' && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--fg-4a4137)]">
          <legend className="sr-only">Passer par</legend>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="phone-mode" checked={phoneMode === 'nextcloud'} onChange={() => { setPhoneMode('nextcloud'); setFolder(null); setFolderInfo(null); setError(null); }} />
            Nextcloud (WebDAV)
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="phone-mode" checked={phoneMode === 'folder'} onChange={() => { setPhoneMode('folder'); setFolder(null); setFolderInfo(null); setError(null); }} />
            Dossier du téléphone (Syncthing…)
          </label>
        </fieldset>
      )}
      {syncTransport === 'webdav' && phoneMode === 'folder' && (
        <p className="text-xs text-[var(--fg-8c8072)]">
          Partagez le dossier de synchronisation avec le téléphone dans Syncthing (par exemple dans <span className="font-mono">Documents/Saudade-sync</span>),
          puis choisissez-le ici. Les échanges ont lieu quand Syncthing tourne sur le téléphone et sur un ordinateur en même temps.
        </p>
      )}
      {useDav ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--fg-8c8072)]">
            Dans Nextcloud (Fichiers › Paramètres › WebDAV), copiez l’adresse WebDAV et ajoutez-y le nom du dossier partagé, par
            exemple <span className="font-mono">…/remote.php/dav/files/vous/Saudade-sync</span>. Créez un mot de passe d’application
            (Paramètres personnels › Sécurité).
          </p>
          <label className="block text-xs text-[var(--fg-695f54)]">
            Adresse WebDAV du dossier
            <input type="url" value={dav.url} onChange={(e) => setDav({ ...dav, url: e.target.value })} className={`${INPUT} mt-1 block`} placeholder="https://…/remote.php/dav/files/…/Saudade-sync" />
          </label>
          <label className="block text-xs text-[var(--fg-695f54)]">
            Identifiant
            <input type="text" value={dav.user} onChange={(e) => setDav({ ...dav, user: e.target.value })} className={`${INPUT} mt-1 block`} autoComplete="username" />
          </label>
          <label className="block text-xs text-[var(--fg-695f54)]">
            Mot de passe d’application
            <input type="password" value={dav.password} onChange={(e) => setDav({ ...dav, password: e.target.value })} className={`${INPUT} mt-1 block`} autoComplete="current-password" />
          </label>
          <button type="button" className={SECONDARY} onClick={pick} disabled={busy || !dav.url.trim() || !dav.user.trim() || !dav.password}>
            <Cloud className="w-3.5 h-3.5" />
            {busy && !folder ? 'Connexion…' : 'Se connecter'}
          </button>
          {folder && <p className="text-xs text-[var(--fg-5f8550)]">Connecté.</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={SECONDARY} onClick={pick}>
            <FolderOpen className="w-3.5 h-3.5" />
            {folder ? 'Changer de dossier…' : 'Choisir le dossier…'}
          </button>
          {folder && <span className="font-mono text-xs break-all text-[var(--fg-4a4137)]">{folderLabel(folder)}</span>}
        </div>
      )}

      {folder && folderInfo && (
        <div className="space-y-3">
          {takesLibrary ? (
            <fieldset className="space-y-1.5 text-sm text-[var(--fg-4a4137)]">
              <legend className="text-xs text-[var(--fg-695f54)] mb-1">
                Ce dossier contient déjà la bibliothèque d’un autre ordinateur.
              </legend>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="sync-mode" checked={replace} onChange={() => setReplace(true)} className="mt-1" />
                <span>
                  Prendre la bibliothèque du dossier <span className="text-xs text-[var(--fg-8c8072)]">(recommandé pour un deuxième ordinateur ; celle d’ici est sauvegardée, puis remplacée)</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="sync-mode" checked={!replace} onChange={() => setReplace(false)} className="mt-1" />
                <span>Fusionner avec la bibliothèque de cet ordinateur</span>
              </label>
            </fieldset>
          ) : (
            !joining && (
              <p className="text-xs text-[var(--fg-695f54)]">
                Nouveau dossier : la bibliothèque de cet ordinateur y sera envoyée. Choisissez une phrase de passe et notez-la : sans
                elle, les autres appareils ne pourront pas lire le dossier (les données d’ici restent intactes).
              </p>
            )
          )}
          <label className="block text-xs text-[var(--fg-695f54)]">
            {joining ? 'Phrase de passe du dossier' : 'Phrase de passe (8 caractères au moins)'}
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className={`${INPUT} mt-1 block`}
              autoComplete="new-password"
            />
          </label>
          {!joining && (
            <label className="block text-xs text-[var(--fg-695f54)]">
              Confirmer la phrase de passe
              <input
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className={`${INPUT} mt-1 block`}
                autoComplete="new-password"
              />
            </label>
          )}
          {!joining && confirmation && passphrase !== confirmation && (
            <p className="text-xs text-[var(--fg-a84236)]">Les deux phrases ne sont pas identiques.</p>
          )}
          <button type="button" className={PRIMARY} disabled={!canEnable} onClick={enable}>
            <Cloud className="w-3.5 h-3.5" />
            {busy ? 'Activation…' : 'Activer la synchronisation'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--fg-a84236)]">
          {error}
        </p>
      )}
    </div>
  );
};
