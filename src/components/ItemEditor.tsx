import React, { useEffect, useRef, useState } from 'react';
import { X, EyeOff, Eye, Undo2 } from 'lucide-react';
import { parseClozes, renderClozeCard, renderTextWithMath } from '../lib/math';
import { safeHtml } from '../lib/markdown';

export interface ItemEditorProps {
  mode: 'extract' | 'cloze';
  title: string;
  /** Where the item comes from (document title…). */
  context?: string;
  /** Explanation shown above the text (what saving will change). */
  info?: string;
  initialText: string;
  saveLabel?: string;
  onSave: (text: string) => void;
  onClose: () => void;
}

/** Editor for an extract or a cloze card, with a live preview (formulas included). */
export const ItemEditor: React.FC<ItemEditorProps> = ({
  mode,
  title,
  context,
  info,
  initialText,
  saveLabel = 'Enregistrer',
  onSave,
  onClose,
}) => {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  }, [onClose]);

  const hasCloze = parseClozes(text).some((p) => p.type === 'cloze' && p.value.trim());

  const hideSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = text.slice(start, end);
    if (!selected.trim()) {
      setError('Sélectionnez dans le texte le mot ou l’expression à masquer.');
      return;
    }
    const lead = selected.match(/^\s*/)![0];
    const trail = selected.match(/\s*$/)![0];
    const core = selected.trim();
    const next = `${text.slice(0, start)}${lead}{{c1::${core}}}${trail}${text.slice(end)}`;
    setText(next);
    setError(null);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + lead.length + core.length + 8;
      el.setSelectionRange(caret, caret);
    });
  };

  const removeHoles = () => {
    setText(
      parseClozes(text)
        .map((p) => p.value)
        .join('')
    );
    setError(null);
  };

  const save = () => {
    const value = text.trim();
    if (!value) {
      setError('Le texte ne peut pas être vide.');
      return;
    }
    if (mode === 'cloze' && !hasCloze) {
      setError('Ajoutez au moins un trou : sélectionnez un mot puis « Masquer la sélection ».');
      return;
    }
    onSave(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (mode === 'cloze' && e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      hideSelection();
    }
  };

  const previewHtml =
    mode === 'cloze' ? renderClozeCard(text, showAnswer) : renderTextWithMath(text);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--bd-e8e2d5)]">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--fg-28231d)]">{title}</h2>
            {context && <p className="text-xs text-[var(--fg-695f54)] truncate">{context}</p>}
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

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          {info && <p className="text-xs text-[var(--fg-695f54)] leading-relaxed">{info}</p>}

          {mode === 'cloze' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()} // keep the textarea selection
                onClick={hideSelection}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)] rounded-lg cursor-pointer"
                title="Masquer le texte sélectionné (Alt+C)"
              >
                <EyeOff className="w-3.5 h-3.5" />
                Masquer la sélection
              </button>
              <button
                type="button"
                onClick={removeHoles}
                disabled={!hasCloze}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--fg-4a3e31)] bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d9)] border border-[var(--bd-e8e2d5)] rounded-lg disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Retirer les trous
              </button>
              <span className="text-[11px] text-[var(--fg-8c8072)]">
                Syntaxe : <code className="font-mono">{'{{c1::réponse}}'}</code> ou{' '}
                <code className="font-mono">{'{{c1::réponse::indice}}'}</code>
              </span>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={mode === 'cloze' ? 5 : 8}
            aria-label="Texte"
            className="w-full px-3 py-2 text-sm font-mono leading-relaxed bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-lg text-[var(--fg-28231d)] focus:outline-none focus:ring-1 focus:ring-[var(--bd-8c5e32)] resize-y"
          />

          <div className="border border-[var(--bd-e8e2d5)] rounded-xl">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--bd-f3efe8)] text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-695f54)]">
              <span>Aperçu{mode === 'cloze' ? (showAnswer ? ' · réponse' : ' · question') : ''}</span>
              {mode === 'cloze' && (
                <button
                  type="button"
                  onClick={() => setShowAnswer((v) => !v)}
                  className="flex items-center gap-1 normal-case tracking-normal font-medium text-[var(--fg-8c5e32)] hover:underline cursor-pointer"
                >
                  {showAnswer ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showAnswer ? 'Voir la question' : 'Voir la réponse'}
                </button>
              )}
            </div>
            <div
              className="px-4 py-3 text-lg font-serif-reading text-[var(--fg-28231d)] leading-relaxed min-h-[3rem]"
              dangerouslySetInnerHTML={{ __html: safeHtml(previewHtml) }}
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-[var(--fg-a84236)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-[var(--bd-e8e2d5)] bg-[var(--bg-faf7f2)]">
          <span className="text-[11px] text-[var(--fg-8c8072)]">
            <kbd className="font-mono">Ctrl+Entrée</kbd> enregistrer · <kbd className="font-mono">Échap</kbd> annuler
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded-lg cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={save}
              className="px-4 py-2 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg shadow-xs cursor-pointer"
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
