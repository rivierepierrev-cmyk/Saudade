import React, { useEffect, useRef, useState } from 'react';
import { X, Pencil, BookOpen, Eye, EyeOff, Sparkles, Scissors } from 'lucide-react';
import { ClozeItem, DocumentItem, ExtractItem, FSRSRecord } from '../types/gemma';
import { renderClozeCard, renderTextWithMath, clozePreviewText } from '../lib/math';
import { safeHtml } from '../lib/markdown';
import { formatInterval } from '../lib/fsrs';
import { isDueToday } from '../lib/queue';

export type ViewedItem = { type: 'extract'; item: ExtractItem } | { type: 'cloze'; item: ClozeItem };

interface ItemViewerProps {
  viewed: ViewedItem;
  document?: DocumentItem;
  parentExtract?: ExtractItem;
  /** Cards created from this extract. */
  childCards: ClozeItem[];
  onEdit: () => void;
  /** Opens the document in the reader, on this passage. */
  onOpenInDocument?: () => void;
  onView: (type: 'extract' | 'cloze', id: string) => void;
  onClose: () => void;
}

function whenLabel(fsrs: FSRSRecord, dismissed: boolean): string {
  if (dismissed) return 'Terminé (hors de la file)';
  const date = new Date(fsrs.nextReviewDate);
  if (isDueToday(fsrs)) return "Aujourd'hui (dans la file du jour)";
  const days = (date.getTime() - Date.now()) / 86400000;
  return `${date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} (dans ${formatInterval(days)})`;
}

/** Read-only view of an extract or a card, opened from the library. */
export const ItemViewer: React.FC<ItemViewerProps> = ({
  viewed,
  document: doc,
  parentExtract,
  childCards,
  onEdit,
  onOpenInDocument,
  onView,
  onClose,
}) => {
  const [revealed, setRevealed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { item } = viewed;
  const isCloze = viewed.type === 'cloze';

  useEffect(() => {
    setRevealed(false);
    // Focus the window itself (not a button), so Space reveals the answer.
    panelRef.current?.focus();
  }, [item.id]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (isCloze && e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      setRevealed((r) => !r);
    }
  };

  const html = isCloze ? renderClozeCard(item.text, revealed) : renderTextWithMath(item.text);
  const fsrs = item.fsrs;
  const meta: Array<[string, string]> = [
    [isCloze ? 'Prochaine révision' : 'Prochaine lecture', whenLabel(fsrs, item.state === 'dismissed')],
    ['Priorité', `${item.priority} %`],
    isCloze
      ? ['Révisions', `${fsrs.reps}${fsrs.lapses ? ` · ${fsrs.lapses} oubli${fsrs.lapses > 1 ? 's' : ''}` : ''}${fsrs.reps ? ` · stabilité ${formatInterval(fsrs.stability)}` : ''}`]
      : ['Lectures', String(fsrs.reps)],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={isCloze ? 'Carte à trou' : 'Extrait'}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden outline-none"
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--bd-e8e2d5)]">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-[var(--fg-8c5e32)]">
              {isCloze ? <Sparkles className="w-3.5 h-3.5" /> : <Scissors className="w-3.5 h-3.5" />}
              {isCloze ? 'Carte à trou' : parentExtract ? 'Sous-extrait' : 'Extrait'}
            </div>
            <p className="mt-0.5 text-sm font-medium text-[var(--fg-28231d)] truncate">
              {doc?.title ?? item.documentTitle ?? 'Sans document'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-5">
          <div
            className="text-xl font-serif-reading text-[var(--fg-28231d)] leading-relaxed select-text"
            dangerouslySetInnerHTML={{ __html: safeHtml(html) }}
          />
          {isCloze && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg-8c5e32)] hover:underline cursor-pointer"
            >
              {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {revealed ? 'Masquer la réponse' : 'Afficher la réponse'} (Espace)
            </button>
          )}
          {item.note && (
            <p className="text-xs text-[var(--fg-695f54)]">
              <span className="font-semibold text-[var(--fg-28231d)]">Note :</span> {item.note}
            </p>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {meta.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-[var(--fg-695f54)]">{label}</dt>
                <dd className="text-[var(--fg-28231d)]">{value}</dd>
              </React.Fragment>
            ))}
            {parentExtract && (
              <>
                <dt className="text-[var(--fg-695f54)]">Extrait parent</dt>
                <dd>
                  <button
                    type="button"
                    onClick={() => onView('extract', parentExtract.id)}
                    className="text-left text-[var(--fg-8c5e32)] hover:underline cursor-pointer line-clamp-1"
                  >
                    « {parentExtract.text.slice(0, 90)}
                    {parentExtract.text.length > 90 ? '…' : ''} »
                  </button>
                </dd>
              </>
            )}
          </dl>

          {!isCloze && childCards.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[var(--fg-28231d)] mb-1.5">
                Cartes tirées de cet extrait ({childCards.length})
              </h3>
              <ul className="space-y-1">
                {childCards.map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      onClick={() => onView('cloze', card.id)}
                      className="w-full text-left px-3 py-1.5 text-xs rounded-lg border border-[var(--bd-e8e2d5)] text-[var(--fg-4a3e31)] hover:bg-[var(--bg-f3efe8)] cursor-pointer"
                      dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(clozePreviewText(card.text))) }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-3 border-t border-[var(--bd-e8e2d5)] bg-[var(--bg-faf7f2)]">
          {onOpenInDocument && (
            <button
              type="button"
              onClick={onOpenInDocument}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--fg-3b3026)] bg-[var(--bg-ffffff)] hover:bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
              Voir dans le document
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg shadow-xs cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
            Modifier
          </button>
        </div>
      </div>
    </div>
  );
};
