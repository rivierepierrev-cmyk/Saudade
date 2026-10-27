import React, { useState, useEffect, useRef } from 'react';
import { DocumentItem, ExtractItem } from '../types/gemma';
import { renderMarkdown } from '../lib/markdown';
import {
  Scissors,
  Sparkles,
  Bookmark,
  ExternalLink,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  AlertCircle,
} from 'lucide-react';
import { EditDocumentModal } from './EditDocumentModal';
import { buildCloze, getBlockSelection, BlockSelection } from '../lib/cloze';
import { formatInterval, nextTopicInterval } from '../lib/fsrs';
import { isDueToday } from '../lib/queue';

interface ReaderViewProps {
  currentDocument: DocumentItem;
  allDocuments: DocumentItem[];
  extracts: ExtractItem[];
  onSelectDocument: (doc: DocumentItem) => void;
  onUpdateDocument?: (updatedDoc: DocumentItem) => void;
  onCreateExtract: (documentId: string, text: string) => void;
  /** `clozeText` contains the {{c1::...}} deletion inside its context sentence. */
  onCreateCloze: (documentId: string, clozeText: string) => void;
  onUpdateProgress: (docId: string, progress: number, offset: number) => void;
  onPostponeDocument: (docId: string, days: number) => void;
  /** Done reading for now: reschedule and move on to the next due document. */
  onFinishReading: (docId: string) => void;
  /** Finished for good: the document leaves the reading queue. */
  onRetireDocument: (docId: string) => void;
  /** The selection is a whole sentence: open the card editor with it. */
  onOpenClozeEditor: (documentId: string, sentence: string) => void;
  onNextQueueItem: () => void;
  onPrevQueueItem: () => void;
  currentIndex: number;
  totalDocuments: number;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  currentDocument,
  allDocuments,
  extracts,
  onSelectDocument,
  onUpdateDocument,
  onCreateExtract,
  onCreateCloze,
  onUpdateProgress,
  onPostponeDocument,
  onFinishReading,
  onRetireDocument,
  onOpenClozeEditor,
  onNextQueueItem,
  onPrevQueueItem,
  currentIndex,
  totalDocuments,
}) => {
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans' | 'mono'>('serif');
  const [fontSize, setFontSize] = useState<number>(18);
  const [columnWidth] = useState<'narrow' | 'normal' | 'wide'>('normal');
  const [showExtractsPanel, setShowExtractsPanel] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ message: string; error?: boolean } | null>(null);

  const [blockSelection, setBlockSelection] = useState<BlockSelection | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const notificationTimer = useRef<number | undefined>(undefined);
  const selectedText = blockSelection?.text.trim() ?? '';

  const documentExtracts = extracts.filter((e) => e.documentId === currentDocument.id);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setToolbarPos(null);
    setBlockSelection(null);
  };

  const handleMouseUp = () => {
    const sel = getBlockSelection(articleRef.current);
    if (!sel || sel.text.trim().length < 2) {
      setToolbarPos(null);
      setBlockSelection(null);
      return;
    }
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    setBlockSelection(sel);
    // The toolbar is position: fixed, so viewport coordinates are used as-is.
    setToolbarPos({
      x: Math.min(window.innerWidth - 260, Math.max(20, rect.left + rect.width / 2 - 120)),
      y: rect.top > 60 ? rect.top - 48 : rect.bottom + 8,
    });
  };

  // Save the reading position once scrolling pauses, not on every scroll event.
  useEffect(() => {
    let timer: number | undefined;
    const handleScroll = () => {
      setToolbarPos(null);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!contentRef.current) return;
        const totalHeight = contentRef.current.scrollHeight - window.innerHeight;
        if (totalHeight > 0) {
          const scrollPos = window.scrollY;
          const progress = Math.min(100, Math.max(0, Math.round((scrollPos / totalHeight) * 100)));
          onUpdateProgress(currentDocument.id, progress, scrollPos);
        }
      }, 800);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [currentDocument.id, onUpdateProgress]);

  useEffect(() => setConfirmRetire(false), [currentDocument.id]);

  const showToast = (message: string, error = false) => {
    window.clearTimeout(notificationTimer.current);
    setNotification({ message, error });
    notificationTimer.current = window.setTimeout(() => setNotification(null), error ? 5000 : 2500);
  };

  const handleExtractSelection = () => {
    if (!selectedText) return;
    onCreateExtract(currentDocument.id, selectedText);
    showToast('Passage extrait dans la file !');
    clearSelection();
  };

  const handleClozeSelection = () => {
    if (!blockSelection) return;
    const result = buildCloze(blockSelection.context, blockSelection.start, blockSelection.end);
    if (!result.ok) {
      if (result.reason === 'whole-sentence') {
        onOpenClozeEditor(currentDocument.id, result.sentence);
        clearSelection();
      } else {
        showToast(result.error, true);
      }
      return;
    }
    onCreateCloze(currentDocument.id, result.text);
    showToast('Carte à trou créée !');
    clearSelection();
  };

  // Shortcuts: Alt+X extract the selection, Alt+C cloze from the selection,
  // L done reading ("Lu"), ← / → previous / next text.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if (typing || isEditModalOpen) return;
      if (!e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          onFinishReading(currentDocument.id);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onNextQueueItem();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onPrevQueueItem();
        }
        return;
      }
      if (!e.altKey || !blockSelection) return;
      const key = e.key.toLowerCase();
      if (key === 'x') {
        e.preventDefault();
        handleExtractSelection();
      } else if (key === 'c') {
        e.preventDefault();
        handleClozeSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const nextInterval = nextTopicInterval(currentDocument.fsrs, currentDocument.priority);
  // A document already read today (or scheduled for later) is not rescheduled again.
  const isDue = isDueToday(currentDocument.fsrs);
  const daysUntilNext = (new Date(currentDocument.fsrs.nextReviewDate).getTime() - Date.now()) / 86400000;

  const renderedHtml = renderMarkdown(currentDocument.content);

  const widthClass =
    columnWidth === 'narrow'
      ? 'max-w-xl'
      : columnWidth === 'wide'
      ? 'max-w-4xl'
      : 'max-w-2xl';

  const fontClass =
    fontFamily === 'serif'
      ? 'font-serif-reading'
      : fontFamily === 'mono'
      ? 'font-mono-code'
      : 'font-sans';

  return (
    <div ref={containerRef} onMouseUp={handleMouseUp} className="min-h-screen pb-32 bg-[var(--bg-faf7f2)]">
      {/* Barre d'outils du lecteur en blanc et beige */}
      <div className="sticky top-16 z-30 bg-[var(--bg-ffffff)]/95 backdrop-blur-md border-b border-[var(--bd-e8e2d5)] py-2.5 px-4 sm:px-6 transition-colors">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          {/* Sélecteur de document et navigation dans la file */}
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={onPrevQueueItem}
              className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded-lg hover:bg-[var(--bg-f3efe8)] border border-transparent hover:border-[var(--bd-e8e2d5)] transition-colors shrink-0 cursor-pointer"
              title="Texte précédent dans la file"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <select
              value={currentDocument.id}
              onChange={(e) => {
                const doc = allDocuments.find((d) => d.id === e.target.value);
                if (doc) onSelectDocument(doc);
              }}
              className="text-xs font-semibold text-[var(--fg-28231d)] bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-lg px-2.5 py-1.5 truncate max-w-xs focus:outline-none focus:ring-1 focus:ring-[var(--bd-8c5e32)]"
            >
              {allDocuments.map((doc, idx) => (
                <option key={doc.id} value={doc.id}>
                  {idx + 1}. {doc.title}
                </option>
              ))}
            </select>

            <button
              onClick={onNextQueueItem}
              className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded-lg hover:bg-[var(--bg-f3efe8)] border border-transparent hover:border-[var(--bd-e8e2d5)] transition-colors shrink-0 cursor-pointer"
              title="Texte suivant dans la file"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <span className="text-[11px] font-mono text-[var(--fg-8c8072)] tabular-nums hidden sm:inline ml-1 shrink-0">
              {currentIndex + 1}/{totalDocuments}
            </span>

            {currentDocument.sourceUrl && (
              <a
                href={currentDocument.sourceUrl}
                target="_blank"
                rel="noreferrer"
                title="Ouvrir le lien source"
                className="text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] p-1 ml-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* Réglages typographiques */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-1 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] p-0.5 rounded-lg text-xs">
              <button
                onClick={() => setFontFamily('serif')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  fontFamily === 'serif'
                    ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-xs font-semibold'
                    : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
                }`}
              >
                Sérif
              </button>
              <button
                onClick={() => setFontFamily('sans')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  fontFamily === 'sans'
                    ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-xs font-semibold'
                    : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
                }`}
              >
                Sans
              </button>
              <button
                onClick={() => setFontFamily('mono')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  fontFamily === 'mono'
                    ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-xs font-semibold'
                    : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
                }`}
              >
                Mono
              </button>
            </div>

            <div className="flex items-center gap-1 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-lg px-1 py-0.5">
              <button
                onClick={() => setFontSize((s) => Math.max(14, s - 1))}
                className="px-1.5 py-0.5 text-xs text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded font-mono cursor-pointer"
                title="Diminuer la taille du texte"
              >
                A-
              </button>
              <span className="text-xs font-mono tabular-nums text-[var(--fg-8c8072)] px-1">{fontSize}px</span>
              <button
                onClick={() => setFontSize((s) => Math.min(26, s + 1))}
                className="px-1.5 py-0.5 text-xs text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded font-mono cursor-pointer"
                title="Agrandir la taille du texte"
              >
                A+
              </button>
            </div>

            {/* Bouton Modifier l'article */}
            {onUpdateDocument && (
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--bd-e8e2d5)] bg-[var(--bg-ffffff)] text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)] transition-colors cursor-pointer"
                title="Modifier le texte, les tags, l'auteur ou la priorité de cet article"
              >
                <Edit3 className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
                <span className="hidden sm:inline">Modifier</span>
              </button>
            )}

            {/* Volet des extraits */}
            <button
              onClick={() => setShowExtractsPanel(!showExtractsPanel)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer ${
                showExtractsPanel
                  ? 'bg-[var(--bg-eae4d9)] border-[var(--bd-d6cdbc)] text-[var(--fg-28231d)] font-semibold'
                  : 'bg-[var(--bg-ffffff)] border-[var(--bd-e8e2d5)] text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)]'
              }`}
            >
              <Scissors className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
              <span>Extraits ({documentExtracts.length})</span>
            </button>
          </div>
        </div>

        {/* Indicateur de progression de lecture */}
        <div className="w-full bg-[var(--bg-e8e2d5)] h-0.5 mt-2.5">
          <div
            className="bg-[var(--bg-8c5e32)] h-0.5 transition-all duration-150"
            style={{ width: `${currentDocument.readingProgress || 5}%` }}
          />
        </div>
      </div>

      {/* Contenu principal */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-8 flex gap-8">
        <div ref={contentRef} className={`flex-1 mx-auto ${widthClass}`}>
          {/* Métadonnées du document */}
          <div className="mb-8 pb-6 border-b border-[var(--bd-e8e2d5)]">
            <div className="flex items-center gap-2 text-xs text-[var(--fg-695f54)] mb-2 flex-wrap">
              <span className="font-semibold text-[var(--fg-8c5e32)] uppercase tracking-wider text-[10px]">
                {currentDocument.format}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[10px] bg-[var(--bg-f3efe8)] px-2 py-0.5 rounded border border-[var(--bd-e8e2d5)] text-[var(--fg-4a3e31)]">
                📁 {currentDocument.folder || 'Général'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{currentDocument.author || 'Auteur non précisé'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Priorité : {currentDocument.priority}%</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Progression : {currentDocument.readingProgress || 0}%</span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--fg-28231d)] leading-tight font-serif-reading flex-1">
                {currentDocument.title}
              </h1>
              {onUpdateDocument && (
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--fg-8c5e32)] hover:text-[var(--fg-6e4723)] bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d9)] border border-[var(--bd-e8e2d5)] rounded-xl transition-colors cursor-pointer shrink-0 mt-1"
                  title="Modifier le contenu ou les métadonnées de cet article"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Modifier l'article</span>
                </button>
              )}
            </div>

            {currentDocument.tags.length > 0 && (
              <div className="mt-3 text-xs text-[var(--fg-8c8072)]">
                {currentDocument.tags.join(' · ')}
              </div>
            )}
          </div>

          {/* Corps de l'article formaté */}
          <article
            ref={articleRef}
            className={`prose max-w-none ${fontClass} leading-relaxed select-text text-[var(--fg-28231d)]`}
            style={{ fontSize: `${fontSize}px` }}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />

          {/* Commandes de fin de session et navigation fluide dans la file */}
          <div className="mt-16 pt-8 border-t border-[var(--bd-e8e2d5)] flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-[var(--fg-695f54)]">
              <Bookmark className="w-4 h-4 text-[var(--fg-8c5e32)]" />
              <span>
                Signet mémorisé · Texte {currentIndex + 1} sur {totalDocuments}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => {
                  onPostponeDocument(currentDocument.id, 3);
                  showToast('Document reporté de 3 jours');
                }}
                className="px-3.5 py-2 text-xs text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] bg-[var(--bg-ffffff)] hover:bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors cursor-pointer"
              >
                Reporter 3j
              </button>
              {confirmRetire ? (
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="text-[var(--fg-695f54)]">Retirer de la file ?</span>
                  <button
                    onClick={() => onRetireDocument(currentDocument.id)}
                    className="px-3 py-2 font-semibold text-white bg-[var(--bg-5f8550)] hover:bg-[var(--bg-4e7042)] rounded-lg cursor-pointer"
                  >
                    Oui, terminé
                  </button>
                  <button
                    onClick={() => setConfirmRetire(false)}
                    className="px-2.5 py-2 text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] rounded-lg cursor-pointer"
                  >
                    Annuler
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmRetire(true)}
                  className="px-3.5 py-2 text-xs text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] bg-[var(--bg-ffffff)] hover:bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors cursor-pointer"
                  title="Texte entièrement traité : il quitte la file de lecture (ses extraits et cartes restent)"
                >
                  Terminer ce texte
                </button>
              )}
              <button
                onClick={() => onFinishReading(currentDocument.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg shadow-xs transition-all cursor-pointer"
                title="Lu pour aujourd'hui : le texte revient selon sa priorité, puis le suivant s'ouvre (L)"
              >
                <span>
                  {isDue
                    ? `Lu · revoir dans ${formatInterval(nextInterval)}`
                    : `Suivant · déjà prévu dans ${formatInterval(daysUntilNext)}`}
                </span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <p className="hidden md:block mt-4 text-[11px] text-center text-[var(--fg-8c8072)]">
            Raccourcis : <kbd className="font-mono">L</kbd> lu · <kbd className="font-mono">←</kbd>{' '}
            <kbd className="font-mono">→</kbd> textes · <kbd className="font-mono">Alt+X</kbd> extraire ·{' '}
            <kbd className="font-mono">Alt+C</kbd> carte à trou
          </p>
        </div>
        {/* Panneau latéral d'extraits */}
        {showExtractsPanel && (
          <aside className="hidden lg:block w-80 shrink-0 sticky top-36 h-[calc(100vh-10rem)] overflow-y-auto p-4 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xs">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--bd-e8e2d5)]">
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-[var(--fg-8c5e32)]" />
                <h3 className="text-sm font-semibold text-[var(--fg-28231d)]">
                  Extraits de ce texte
                </h3>
              </div>
              <span className="text-xs font-mono text-[var(--fg-8c8072)]">
                {documentExtracts.length}
              </span>
            </div>

            {documentExtracts.length === 0 ? (
              <p className="text-xs text-[var(--fg-8c8072)] italic py-4 text-center">
                Sélectionnez du texte dans le lecteur et cliquez sur "Extraire" pour récolter des connaissances atomiques.
              </p>
            ) : (
              <div className="space-y-3">
                {documentExtracts.map((ext, idx) => (
                  <div
                    key={ext.id}
                    className="p-3 bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-xl text-xs"
                  >
                    <div className="flex items-center justify-between text-[10px] text-[var(--fg-8c8072)] mb-1">
                      <span>Passage #{idx + 1}</span>
                      <span className="font-mono tabular-nums">Prio : {ext.priority}%</span>
                    </div>
                    <p className="text-[var(--fg-28231d)] italic line-clamp-3">
                      « {ext.text} »
                    </p>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Barre d'action contextuelle flottante (HUD) */}
      {toolbarPos && selectedText && (
        <div
          style={{ left: `${toolbarPos.x}px`, top: `${toolbarPos.y}px` }}
          className="fixed z-50 flex items-center gap-1 p-1.5 bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] rounded-xl shadow-xl border border-[var(--bd-3e3831)] animate-in fade-in zoom-in-95 duration-150"
        >
          <button
            onClick={handleExtractSelection}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-3e3831)] rounded-lg transition-colors whitespace-nowrap cursor-pointer text-[var(--fg-faf7f2)]"
            title="Extraire le passage sélectionné (Alt+X)"
          >
            <Scissors className="w-3.5 h-3.5 text-[var(--fg-e6c280)]" />
            <span>Extraire</span>
          </button>

          <button
            onClick={handleClozeSelection}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-3e3831)] rounded-lg transition-colors whitespace-nowrap cursor-pointer text-[var(--fg-faf7f2)]"
            title="Masquer la sélection dans une carte à trou ; la phrase autour sert de contexte (Alt+C)"
          >
            <Sparkles className="w-3.5 h-3.5 text-[var(--fg-e6c280)]" />
            <span>Carte à trou</span>
          </button>

        </div>
      )}

      {/* Toast de confirmation */}
      {notification && (
        <div
          role={notification.error ? 'alert' : 'status'}
          className={`fixed bottom-6 right-6 z-50 max-w-sm flex items-start gap-2 px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium border animate-in slide-in-from-bottom-2 ${
            notification.error
              ? 'bg-[var(--bg-fdf2f0)] text-[var(--fg-8f352b)] border-[var(--bd-f2d6d3)]'
              : 'bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] border-[var(--bd-3e3831)]'
          }`}
        >
          {notification.error ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <Check className="w-4 h-4 shrink-0 text-[var(--fg-8eb87d)]" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Modal d'édition complète de l'article */}
      {onUpdateDocument && (
        <EditDocumentModal
          isOpen={isEditModalOpen}
          document={currentDocument}
          allAvailableTags={Array.from(new Set(allDocuments.flatMap((d) => d.tags)))}
          onClose={() => setIsEditModalOpen(false)}
          onSave={(updated) => {
            onUpdateDocument(updated);
            showToast('Article et métadonnées enregistrés avec succès !');
          }}
        />
      )}
    </div>
  );
};
