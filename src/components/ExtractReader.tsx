import React, { useEffect, useRef, useState } from 'react';
import { Check, AlertCircle, HelpCircle, Scissors, Sparkles, X } from 'lucide-react';
import { ClozeItem, ExtractItem } from '../types/saudade';
import { buildCloze, getBlockSelection, BlockSelection } from '../lib/cloze';
import { cardPassages } from '../lib/clozeNotes';
import { findPassages, setHighlight, clearHighlight } from '../lib/highlight';
import { renderTextWithMath } from '../lib/math';
import { safeHtml } from '../lib/markdown';

interface ExtractReaderProps {
  extract: ExtractItem;
  /** Extracts and cards already taken from this extract (highlighted in its text). */
  childExtracts: ExtractItem[];
  childCards: ClozeItem[];
  showHighlights: boolean;
  onCreateExtract: (text: string) => void;
  /** Opens the cloze editor on this text (the selection already hidden). */
  onOpenClozeEditor: (text: string) => void;
  onOpenQAEditor: (passage: string) => void;
  onClose: () => void;
}

/**
 * An extract read like a document in the reader: large text, its sub-extracts and
 * cards highlighted, and a selection gives new extracts or cards (Alt+X, Alt+C, Alt+Q).
 */
export const ExtractReader: React.FC<ExtractReaderProps> = ({
  extract,
  childExtracts,
  childCards,
  showHighlights,
  onCreateExtract,
  onOpenClozeEditor,
  onOpenQAEditor,
  onClose,
}) => {
  const textRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<BlockSelection | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [notification, setNotification] = useState<{ message: string; error?: boolean } | null>(null);
  const notificationTimer = useRef<number | undefined>(undefined);

  const showToast = (message: string, error = false) => {
    window.clearTimeout(notificationTimer.current);
    setNotification({ message, error });
    notificationTimer.current = window.setTimeout(() => setNotification(null), error ? 5000 : 2500);
  };

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setToolbarPos(null);
  };

  const handleMouseUp = () => {
    const sel = getBlockSelection(textRef.current);
    if (!sel || sel.text.trim().length < 2) {
      setSelection(null);
      setToolbarPos(null);
      return;
    }
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    setSelection(sel);
    setToolbarPos({
      x: Math.min(window.innerWidth - 330, Math.max(20, rect.left + rect.width / 2 - 160)),
      y: rect.top > 60 ? rect.top - 48 : rect.bottom + 8,
    });
  };

  const extractSelection = () => {
    if (!selection?.text.trim()) return;
    onCreateExtract(selection.text.trim());
    showToast('Sous-extrait créé');
    clearSelection();
  };

  const clozeSelection = () => {
    if (!selection) return;
    const result = buildCloze(selection.context, selection.start, selection.end);
    if (!result.ok && result.reason !== 'whole-sentence') {
      showToast(result.error, true);
      return;
    }
    onOpenClozeEditor(result.ok ? result.text : result.sentence);
    clearSelection();
  };

  const questionSelection = () => {
    if (!selection?.text.trim()) return;
    onOpenQAEditor(selection.text);
    clearSelection();
  };

  // Keyboard: Alt+X / Alt+C / Alt+Q on the selection, Escape closes (when no editor is open).
  const keysRef = useRef({ extractSelection, clozeSelection, questionSelection, onClose, selection });
  keysRef.current = { extractSelection, clozeSelection, questionSelection, onClose, selection };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (document.querySelector('[role="dialog"]')) return; // a card editor is open above
      if (e.key === 'Escape') {
        e.preventDefault();
        k.onClose();
        return;
      }
      if (!e.altKey || !k.selection) return;
      const key = e.key.toLowerCase();
      if (key === 'x') k.extractSelection();
      else if (key === 'c') k.clozeSelection();
      else if (key === 'q') k.questionSelection();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // What was already taken from this extract: sub-extracts (gold), cards (green).
  const childKey = [...childExtracts.map((e) => e.text), '\u0002', ...childCards.flatMap(cardPassages)].join('\u0001');
  useEffect(() => {
    const root = textRef.current;
    if (!root || !showHighlights) {
      clearHighlight('saudade-subextracts');
      clearHighlight('saudade-subcards');
      return;
    }
    const present = (r: Range | null): r is Range => r !== null;
    setHighlight('saudade-subextracts', findPassages(root, childExtracts.map((e) => e.text)).filter(present));
    setHighlight('saudade-subcards', findPassages(root, childCards.flatMap(cardPassages)).filter(present));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childKey, extract.text, showHighlights]);
  useEffect(
    () => () => {
      clearHighlight('saudade-subextracts');
      clearHighlight('saudade-subcards');
    },
    []
  );

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-[var(--bg-faf7f2)]"
      aria-label="Lecture de l’extrait"
      onScroll={() => setToolbarPos(null)}
    >
      <div className="sticky top-0 z-10 bg-[var(--bg-ffffff)]/95 backdrop-blur-md border-b border-[var(--bd-e8e2d5)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-[var(--fg-695f54)] truncate">
            <span className="font-semibold uppercase tracking-wider text-[10px] text-[var(--fg-8c5e32)]">
              {extract.parentExtractId ? 'Sous-extrait' : 'Extrait'}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="text-[var(--fg-28231d)] font-medium">{extract.documentTitle}</span>
            <span aria-hidden="true"> · </span>
            <span className="tabular-nums">
              {childExtracts.length} sous-extrait{childExtracts.length > 1 ? 's' : ''}, {childCards.length} carte{childCards.length > 1 ? 's' : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--bd-e8e2d5)] bg-[var(--bg-ffffff)] text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)] cursor-pointer shrink-0"
            title="Fermer (Échap)"
          >
            <X className="w-3.5 h-3.5" />
            Fermer
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div
          ref={textRef}
          onMouseUp={handleMouseUp}
          onTouchEnd={() => window.setTimeout(handleMouseUp, 400)}
          className="text-lg sm:text-xl font-serif-reading text-[var(--fg-28231d)] leading-relaxed whitespace-pre-line select-text"
          dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(extract.text)) }}
        />
        <p className="mt-10 pt-6 border-t border-[var(--bd-e8e2d5)] text-xs text-[var(--fg-8c8072)]">
          Sélectionnez un passage pour en faire un sous-extrait (Alt+X), une carte à trou (Alt+C) ou une question (Alt+Q).
        </p>
      </div>

      {toolbarPos && selection && (
        <div
          style={{ left: `${toolbarPos.x}px`, top: `${toolbarPos.y}px` }}
          className="fixed z-50 flex items-center gap-1 p-1.5 bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] rounded-xl shadow-xl border border-[var(--bd-3e3831)]"
        >
          {(
            [
              [extractSelection, Scissors, 'Extraire', 'Extraire le passage sélectionné dans un sous-extrait (Alt+X)'],
              [clozeSelection, Sparkles, 'Carte à trou', 'Masquer la sélection dans une carte à trou (Alt+C)'],
              [questionSelection, HelpCircle, 'Question', 'Carte question/réponse : la sélection sert de réponse (Alt+Q)'],
            ] as const
          ).map(([action, Icon, label, title]) => (
            <button
              key={label}
              onClick={action}
              title={title}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-3e3831)] rounded-lg transition-colors whitespace-nowrap cursor-pointer text-[var(--fg-faf7f2)]"
            >
              <Icon className="w-3.5 h-3.5 text-[var(--fg-e6c280)]" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {notification && (
        <div
          role={notification.error ? 'alert' : 'status'}
          className={`fixed bottom-6 right-6 z-50 max-w-sm flex items-start gap-2 px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium border ${
            notification.error
              ? 'bg-[var(--bg-fdf2f0)] text-[var(--fg-8f352b)] border-[var(--bd-f2d6d3)]'
              : 'bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] border-[var(--bd-3e3831)]'
          }`}
        >
          {notification.error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0 text-[var(--fg-8eb87d)]" />}
          <span>{notification.message}</span>
        </div>
      )}
    </div>
  );
};
