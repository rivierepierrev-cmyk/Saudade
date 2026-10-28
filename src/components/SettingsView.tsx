import React, { useRef, useState } from 'react';
import { Check, Download, FolderOpen, RotateCcw, Upload } from 'lucide-react';
import { SyncSettings } from './SyncSettings';

interface SettingsViewProps {
  cardCount: number;
  targetRetention: number;
  onUpdateTargetRetention: (retention: number) => void;
  dailyReviewLimit: number;
  dailyTopicLimit: number;
  onUpdateTopicLimit: (limit: number) => void;
  autoPostpone: boolean;
  onToggleAutoPostpone: (on: boolean) => void;
  onUpdateDailyLimit: (limit: number) => void;
  onExportBackup: () => void;
  onExportMarkdownMirror: () => void;
  onResetDemo: () => Promise<boolean>;
  onRestoreBackup: (file: File) => Promise<{ ok: boolean; message: string }>;
  onResetAllCards: () => Promise<boolean>;
  onOpenDataFolder?: () => void;
  dataLocation?: string | null;
}

const SECTION = 'p-5 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl';
const SECONDARY =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--fg-4a3e31)] bg-[var(--bg-ffffff)] border border-[var(--bd-d5cbbf)] rounded-lg hover:bg-[var(--bg-f3efe8)] transition-colors cursor-pointer';
const DANGER =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--fg-a84236)] hover:bg-[var(--bg-fdf2f0)] border border-[var(--bd-f2d6d3)] rounded-lg transition-colors cursor-pointer disabled:opacity-45';
const RETENTION_MARKS = [70, 75, 80, 85, 90, 95, 98];

/** Confirmation inline, in place of a destructive button. */
const Confirm: React.FC<{ question: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }> = ({
  question,
  confirmLabel,
  onConfirm,
  onCancel,
}) => (
  <div className="flex flex-wrap items-center gap-2 p-1.5 bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-xl">
    <span className="text-xs text-[var(--fg-a84236)] font-medium px-2">{question}</span>
    <button
      type="button"
      onClick={onConfirm}
      className="px-3 py-1 text-xs font-semibold text-white bg-[var(--bg-a84236)] rounded-lg hover:bg-[var(--bg-8f352b)] transition-colors cursor-pointer"
    >
      {confirmLabel}
    </button>
    <button
      type="button"
      onClick={onCancel}
      className="px-2.5 py-1 text-xs text-[var(--fg-695f54)] hover:bg-[var(--bg-e8e2d5)] rounded-lg transition-colors cursor-pointer"
    >
      Annuler
    </button>
  </div>
);

export const SettingsView: React.FC<SettingsViewProps> = ({
  cardCount,
  targetRetention,
  onUpdateTargetRetention,
  dailyReviewLimit,
  dailyTopicLimit,
  onUpdateTopicLimit,
  autoPostpone,
  onToggleAutoPostpone,
  onUpdateDailyLimit,
  onExportBackup,
  onExportMarkdownMirror,
  onResetDemo,
  onRestoreBackup,
  onResetAllCards,
  onOpenDataFolder,
  dataLocation,
}) => {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmResetCards, setConfirmResetCards] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<File | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const retention = Math.round(targetRetention * 100);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8 pb-6 border-b border-[var(--bd-e8e2d5)]">
        <h1 className="page-title">Réglages</h1>
      </div>

      <div className="space-y-5">
        {/* Révisions */}
        <section className={SECTION} aria-labelledby="settings-review">
          <h2 id="settings-review" className="text-sm font-semibold text-[var(--fg-28231d)]">
            Révisions
          </h2>

          <label className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--fg-4a4137)]">
            Au plus
            <input
              type="number"
              min={1}
              max={999}
              value={dailyReviewLimit}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) onUpdateDailyLimit(val);
              }}
              className="w-20 px-2 py-1 tabular-nums text-[var(--fg-28231d)] bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-md"
              aria-label="Cartes différentes par jour"
            />
            cartes à trou différentes par jour
          </label>
          <p className="mt-1 text-xs text-[var(--fg-8c8072)]">
            Une carte ratée revient dans la journée sans compter à nouveau. Les cartes au-delà attendent le lendemain.
          </p>

          <label className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--fg-4a4137)]">
            Au plus
            <input
              type="number"
              min={1}
              max={999}
              value={dailyTopicLimit}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) onUpdateTopicLimit(val);
              }}
              className="w-20 px-2 py-1 tabular-nums text-[var(--fg-28231d)] bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-md"
              aria-label="Documents et extraits par jour"
            />
            documents et extraits par jour
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm text-[var(--fg-4a4137)] cursor-pointer">
            <input
              type="checkbox"
              checked={autoPostpone}
              onChange={(e) => onToggleAutoPostpone(e.target.checked)}
              className="mt-1"
            />
            <span>
              Reporter automatiquement le surplus chaque matin
              <span className="block text-xs text-[var(--fg-8c8072)]">
                Les moins prioritaires sont reprogrammés plus tard (de 1 jour à environ deux semaines selon leur priorité), pour que la file
                du jour reste faisable. Sinon, ils attendent dans l’ordre des priorités.
              </span>
            </span>
          </label>

          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <label htmlFor="settings-retention" className="text-sm text-[var(--fg-4a4137)]">
                Taux de rappel visé
              </label>
              <span className="text-lg font-semibold tabular-nums text-[var(--fg-8c5e32)]">{retention} %</span>
            </div>
            <input
              id="settings-retention"
              type="range"
              min={70}
              max={98}
              step={1}
              value={retention}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) onUpdateTargetRetention(val / 100);
              }}
              className="mt-2 w-full h-2 bg-[var(--bg-f3efe8)] rounded-lg appearance-none cursor-pointer accent-[var(--fg-8c5e32)] block"
            />
            <div className="relative w-full h-5 mt-1.5 select-none">
              {RETENTION_MARKS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onUpdateTargetRetention(val / 100)}
                  style={{ left: `calc(8px + (100% - 16px) * ${(val - 70) / 28})` }}
                  className={`absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums cursor-pointer hover:text-[var(--fg-8c5e32)] ${
                    retention === val ? 'text-[var(--fg-8c5e32)] font-bold' : 'text-[var(--fg-8c8072)]'
                  }`}
                  title={`Viser ${val} %`}
                >
                  {val} %
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-[var(--fg-8c8072)]">
              La part des cartes dont vous vous souviendrez au moment de la révision. Plus haut, les révisions sont plus fréquentes ; 90 % est un bon équilibre.
            </p>
          </div>
        </section>

        {/* Synchronisation */}
        <section className={SECTION} aria-labelledby="settings-sync">
          <h2 id="settings-sync" className="text-sm font-semibold text-[var(--fg-28231d)]">
            Synchronisation
          </h2>
          <SyncSettings onDone={showToast} />
        </section>

        {/* Sauvegardes et données */}
        <section className={SECTION} aria-labelledby="settings-data">
          <h2 id="settings-data" className="text-sm font-semibold text-[var(--fg-28231d)]">
            Sauvegardes et données
          </h2>
          {dataLocation && (
            <p className="mt-1 text-xs text-[var(--fg-8c8072)]">
              Données : <span className="font-mono break-all">{dataLocation}</span> — 7 sauvegardes quotidiennes dans « backups ».
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onExportBackup();
                showToast('Sauvegarde exportée');
              }}
              className={SECONDARY}
              title="Toute la bibliothèque dans un fichier JSON, restaurable ici"
            >
              <Download className="w-3.5 h-3.5" />
              Exporter une sauvegarde
            </button>
            <button
              type="button"
              onClick={() => {
                onExportMarkdownMirror();
                showToast('Export Markdown terminé');
              }}
              className={SECONDARY}
              title="Les extraits et cartes en Markdown, lisibles dans n'importe quel éditeur"
            >
              <Download className="w-3.5 h-3.5" />
              Exporter en Markdown
            </button>
            {onOpenDataFolder && (
              <button type="button" onClick={onOpenDataFolder} className={SECONDARY}>
                <FolderOpen className="w-3.5 h-3.5" />
                Ouvrir le dossier des données
              </button>
            )}
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  setRestoreError(null);
                  setPendingRestore(file);
                }
              }}
            />
            {pendingRestore ? (
              <Confirm
                question={`Remplacer toute la bibliothèque par « ${pendingRestore.name} » ?`}
                confirmLabel="Oui, restaurer"
                onConfirm={async () => {
                  const file = pendingRestore;
                  setPendingRestore(null);
                  const result = await onRestoreBackup(file);
                  if (result.ok) showToast(result.message);
                  else setRestoreError(result.message);
                }}
                onCancel={() => setPendingRestore(null)}
              />
            ) : (
              <button type="button" onClick={() => restoreInputRef.current?.click()} className={SECONDARY}>
                <Upload className="w-3.5 h-3.5" />
                Restaurer une sauvegarde…
              </button>
            )}
          </div>
          {restoreError && (
            <p role="alert" className="mt-3 text-xs text-[var(--fg-a84236)]">
              Restauration impossible : {restoreError}
            </p>
          )}
        </section>

        {/* Réinitialiser */}
        <section className={SECTION} aria-labelledby="settings-reset">
          <h2 id="settings-reset" className="text-sm font-semibold text-[var(--fg-28231d)]">
            Réinitialiser
          </h2>
          <p className="mt-1 text-xs text-[var(--fg-8c8072)]">
            Une sauvegarde de sécurité est créée automatiquement avant toute restauration ou réinitialisation.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {confirmResetCards ? (
              <Confirm
                question={`Remettre les ${cardCount} cartes à zéro et effacer leur historique ?`}
                confirmLabel="Oui, réinitialiser"
                onConfirm={async () => {
                  setConfirmResetCards(false);
                  if (await onResetAllCards()) showToast('Cartes réinitialisées (sauvegarde créée avant)');
                }}
                onCancel={() => setConfirmResetCards(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setConfirmResetCards(true)}
                disabled={cardCount === 0}
                className={DANGER}
                title="Comme si aucune carte n'avait jamais été révisée (les extraits et documents ne changent pas)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Réinitialiser toutes les cartes
              </button>
            )}
            {confirmReset ? (
              <Confirm
                question="Remplacer la bibliothèque par les données de démo ?"
                confirmLabel="Oui, écraser"
                onConfirm={async () => {
                  setConfirmReset(false);
                  if (await onResetDemo()) showToast('Données de démo réinitialisées');
                }}
                onCancel={() => setConfirmReset(false)}
              />
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)} className={DANGER}>
                <RotateCcw className="w-3.5 h-3.5" />
                Réinitialiser les données de démo
              </button>
            )}
          </div>
        </section>
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] text-xs font-medium rounded-xl shadow-lg border border-[var(--bd-3b3026)]"
        >
          <Check className="w-4 h-4 text-[var(--fg-5f8550)]" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
};
