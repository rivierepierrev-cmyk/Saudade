import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ClozeItem, ExtractItem, ReviewRating, FSRSRecord } from '../types/gemma';
import { predictAllRatings, nextTopicInterval, formatInterval } from '../lib/fsrs';
import { buildCloze, getBlockSelection, BlockSelection } from '../lib/cloze';
import { buildTodayQueue, isDueToday } from '../lib/queue';
import { findPassages, setHighlight, clearHighlight } from '../lib/highlight';
import { renderClozeCard, renderTextWithMath } from '../lib/math';
import { safeHtml } from '../lib/markdown';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  Eye,
  CheckCircle2,
  Scissors,
  Check,
  RotateCcw,
  Zap,
  Shuffle,
  Layers,
  ArrowRight,
  BookOpen,
  Filter,
  Pencil,
} from 'lucide-react';

export interface ReviewQueueEntry {
  id: string;
  type: 'cloze' | 'extract';
  documentTitle: string;
  documentId?: string;
  text: string;
  note?: string;
  fsrs: FSRSRecord;
  priority: number;
  originalItem: ClozeItem | ExtractItem;
}

interface ReviewModalProps {
  clozes: ClozeItem[];
  extracts: ExtractItem[];
  initialItemId?: string;
  initialItemType?: 'cloze' | 'extract';
  targetRetention?: number;
  /** Rates a cloze card; returns its new scheduling record. */
  onRateCard: (id: string, rating: ReviewRating) => FSRSRecord | undefined;
  /** Done reading an extract for now. Not rescheduled when it isn't due today. */
  onExtractNext: (id: string) => { rescheduled: boolean; days: number } | undefined;
  /** Opens the editor of an extract or a card. */
  onEditItem: (type: 'extract' | 'cloze', id: string) => void;
  /** The selection is a whole sentence: open the card editor with it. */
  onOpenClozeEditor: (extractId: string, sentence: string) => void;
  onRetireExtract: (id: string) => void;
  onCreateExtractFromExtract: (extractId: string, text: string) => void;
  onCreateClozeFromExtract: (extractId: string, clozeText: string) => void;
  /** Maximum number of different cards reviewed per day. */
  dailyLimit: number;
  /** Ids of cards already reviewed today (they don't use up the limit again). */
  reviewedTodayIds: Set<string>;
  /** Highlight sub-extracts inside the extract being read. */
  showExtractHighlights: boolean;
  onClose: () => void;
  onNavigateToDocument?: (docId: string) => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  clozes,
  extracts,
  initialItemId,
  targetRetention = 0.90,
  onRateCard,
  onExtractNext,
  onEditItem,
  onOpenClozeEditor,
  onRetireExtract,
  onCreateExtractFromExtract,
  onCreateClozeFromExtract,
  dailyLimit,
  reviewedTodayIds,
  showExtractHighlights,
  onClose,
  onNavigateToDocument,
}) => {
  const [reviewAhead, setReviewAhead] = useState(false);
  const [sessionCompletedCount, setSessionCompletedCount] = useState(0);
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const extractTextRef = useRef<HTMLDivElement>(null);
  const [extractSelection, setExtractSelection] = useState<BlockSelection | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const showToast = (message: string, error = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 5000 : 2500);
  };

  // --- Mode Entraînement Express (sans reprogrammation FSRS) ---
  const [isFreePractice, setIsFreePractice] = useState(false);
  // Express practice only makes sense for cards: extracts are reading material.
  const practicePool = 'cloze' as 'all' | 'cloze' | 'extract';
  const [practiceCount, setPracticeCount] = useState<number>(10);
  const [practiceQueue, setPracticeQueue] = useState<ReviewQueueEntry[]>([]);
  const [practiceInitialCount, setPracticeInitialCount] = useState<number>(0);
  const [practiceCompletedCount, setPracticeCompletedCount] = useState<number>(0);
  const [practiceFinished, setPracticeFinished] = useState(false);

  // Pool disponible
  const activeClozes = useMemo(
    () => clozes.filter((c) => c.state !== 'dismissed'),
    [clozes]
  );
  const activeExtracts = useMemo(
    () => extracts.filter((e) => e.state !== 'dismissed'),
    [extracts]
  );

  const availableCounts = useMemo(() => {
    return {
      all: activeClozes.length + activeExtracts.length,
      cloze: activeClozes.length,
      extract: activeExtracts.length,
    };
  }, [activeClozes, activeExtracts]);

  // Initialisation stricte de la file de révision normale selon FSRS
  const toEntry = (c: ClozeItem | ExtractItem, type: 'cloze' | 'extract'): ReviewQueueEntry => ({
    id: c.id,
    type,
    documentTitle: c.documentTitle || 'Document',
    documentId: c.documentId,
    text: c.text,
    note: c.note,
    fsrs: c.fsrs,
    priority: c.priority,
    originalItem: c,
  });

  // The session plays today's queue (extracts and cards, same daily card limit as
  // the reading queue). "Étude anticipée" (includeAll) also takes items scheduled
  // for later. An item opened explicitly comes first.
  const buildQueue = (includeAll: boolean = false): ReviewQueueEntry[] => {
    let entries: ReviewQueueEntry[];
    if (includeAll) {
      entries = [
        ...clozes.filter((c) => c.state !== 'dismissed').map((c) => toEntry(c, 'cloze')),
        ...extracts.filter((e) => e.state !== 'dismissed').map((e) => toEntry(e, 'extract')),
      ].sort((a, b) => b.priority - a.priority);
    } else {
      entries = buildTodayQueue({ documents: [], extracts, clozes, dailyLimit, reviewedTodayIds }).map((q) =>
        toEntry(q.item as ClozeItem | ExtractItem, q.type as 'cloze' | 'extract')
      );
    }
    if (initialItemId) {
      const index = entries.findIndex((e) => e.id === initialItemId);
      if (index >= 0) {
        entries.unshift(...entries.splice(index, 1));
      } else {
        const card = clozes.find((c) => c.id === initialItemId);
        const ext = extracts.find((e) => e.id === initialItemId);
        if (card) entries.unshift(toEntry(card, 'cloze'));
        else if (ext) entries.unshift(toEntry(ext, 'extract'));
      }
    }
    return entries;
  };

  const [queue, setQueue] = useState<ReviewQueueEntry[]>(() => buildQueue(false));
  const [currentIndex, setCurrentIndex] = useState(0);

  // Entrée courante selon le mode actif
  const queuedEntry = isFreePractice ? practiceQueue[0] : queue[currentIndex];
  // Always use the latest version of the item (its schedule changes when it is
  // reviewed again in the same session, its text when it is edited).
  const liveItem = queuedEntry
    ? queuedEntry.type === 'cloze'
      ? clozes.find((c) => c.id === queuedEntry.id)
      : extracts.find((e) => e.id === queuedEntry.id)
    : undefined;
  const currentEntry: ReviewQueueEntry | undefined =
    queuedEntry && liveItem
      ? { ...queuedEntry, fsrs: liveItem.fsrs, text: liveItem.text, note: liveItem.note, priority: liveItem.priority }
      : queuedEntry;
  const predictions =
    currentEntry && currentEntry.type === 'cloze' && !isFreePractice
      ? predictAllRatings(currentEntry.fsrs, targetRetention)
      : null;

  useEffect(() => {
    setExtractSelection(null);
    setConfirmRetire(false);
  }, [currentEntry?.id, currentIndex]);

  // Like in SuperMemo: inside an extract, its sub-extracts are highlighted (the
  // extract itself is not). Follows edits of the extract and of its sub-extracts.
  const subExtractTexts =
    currentEntry?.type === 'extract' && showExtractHighlights
      ? extracts.filter((e) => e.parentExtractId === currentEntry.id).map((e) => e.text)
      : [];
  const subExtractKey = subExtractTexts.join('\u0001');
  useEffect(() => {
    const el = extractTextRef.current;
    const ranges = el && subExtractTexts.length ? findPassages(el, subExtractTexts) : [];
    setHighlight('gemma-subextracts', ranges.filter((r): r is Range => r !== null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEntry?.id, currentEntry?.text, subExtractKey]);
  useEffect(() => () => clearHighlight('gemma-subextracts'), []);

  // Lancement de l'entraînement libre sans reprogrammation
  const handleStartFreePractice = () => {
    const poolItems: ReviewQueueEntry[] = [];

    if (practicePool === 'cloze' || practicePool === 'all') {
      activeClozes.forEach((c) => {
        poolItems.push({
          id: c.id,
          type: 'cloze',
          documentTitle: c.documentTitle || 'Document',
          documentId: c.documentId,
          text: c.text,
          note: c.note,
          fsrs: c.fsrs,
          priority: c.priority,
          originalItem: c,
        });
      });
    }

    if (practicePool === 'extract' || practicePool === 'all') {
      activeExtracts.forEach((e) => {
        poolItems.push({
          id: e.id,
          type: 'extract',
          documentTitle: e.documentTitle || 'Document',
          documentId: e.documentId,
          text: e.text,
          note: e.note,
          fsrs: e.fsrs,
          priority: e.priority,
          originalItem: e,
        });
      });
    }

    if (poolItems.length === 0) return;

    // Mélange aléatoire (Fisher-Yates)
    const shuffled = [...poolItems];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const maxAllowed = Math.min(practiceCount, shuffled.length);
    const selected = shuffled.slice(0, Math.max(1, maxAllowed));

    setPracticeQueue(selected);
    setPracticeInitialCount(selected.length);
    setPracticeCompletedCount(0);
    setIsFreePractice(true);
    setPracticeFinished(false);
    setIsAnswerRevealed(false);
  };

  // Évaluation en mode Entraînement Express :
  // - 3 (Bon) ou 4 (Facile) : la carte est maîtrisée -> disparaît de la file temporaire
  // - 1 (À revoir) ou 2 (Difficile) : la carte n'est pas maîtrisée -> replacée à la fin de la file
  // - FSRS n'est JAMAIS appelé : aucune modification du calendrier d'espacement
  const handleRatePractice = (rating: ReviewRating) => {
    if (!currentEntry || practiceQueue.length === 0) return;

    if (rating === 3 || rating === 4) {
      // Carte maîtrisée, elle disparaît de la liste temporaire
      const remaining = practiceQueue.slice(1);
      const newCompleted = practiceCompletedCount + 1;
      setPracticeCompletedCount(newCompleted);

      if (remaining.length === 0) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
        setPracticeFinished(true);
      } else {
        setPracticeQueue(remaining);
      }
    } else {
      // Rating 1 (À revoir) ou 2 (Difficile) : la carte est remise dans la liste (à la fin)
      setPracticeQueue((prev) => [...prev.slice(1), prev[0]]);
    }

    setIsAnswerRevealed(false);
  };

  // Évaluation en mode révision FSRS normale
  const handleRateNormal = (rating: ReviewRating) => {
    if (!currentEntry) return;

    if (currentEntry.type !== 'cloze') return;
    const record = onRateCard(currentEntry.id, rating);
    setSessionCompletedCount((c) => c + 1);

    // Cards in learning steps come back later in the same session.
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const comesBackToday = record && new Date(record.nextReviewDate) <= endOfToday;
    if (comesBackToday) {
      setQueue((prevQueue) => [...prevQueue, currentEntry]);
    }

    if (currentIndex + 1 >= queue.length && !comesBackToday) {
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
      });
    }

    setIsAnswerRevealed(false);
    setCurrentIndex((i) => i + 1);
  };

  const advance = () => {
    setSessionCompletedCount((c) => c + 1);
    setIsAnswerRevealed(false);
    setCurrentIndex((i) => i + 1);
  };

  const handleExtractNext = () => {
    if (!currentEntry || currentEntry.type !== 'extract') return;
    onExtractNext(currentEntry.id);
    advance();
  };

  const handleRetireExtract = () => {
    if (!currentEntry || currentEntry.type !== 'extract') return;
    onRetireExtract(currentEntry.id);
    advance();
  };

  const handleSubExtract = () => {
    if (!currentEntry || !extractSelection || !extractSelection.text.trim()) return;
    onCreateExtractFromExtract(currentEntry.id, extractSelection.text.trim());
    window.getSelection()?.removeAllRanges();
    setExtractSelection(null);
    showToast('Sous-extrait créé');
  };

  const handleClozeFromSelection = () => {
    if (!currentEntry || !extractSelection) return;
    const result = buildCloze(extractSelection.context, extractSelection.start, extractSelection.end);
    if (!result.ok) {
      if (result.reason === 'whole-sentence') {
        onOpenClozeEditor(currentEntry.id, result.sentence);
        window.getSelection()?.removeAllRanges();
        setExtractSelection(null);
      } else {
        showToast(result.error, true);
      }
      return;
    }
    onCreateClozeFromExtract(currentEntry.id, result.text);
    window.getSelection()?.removeAllRanges();
    setExtractSelection(null);
    showToast('Carte à trou créée');
  };

  const handleRate = (rating: ReviewRating) => {
    if (isFreePractice) {
      handleRatePractice(rating);
    } else {
      handleRateNormal(rating);
    }
  };

  // Raccourcis clavier : Espace pour révéler, 1-4 pour évaluer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentEntry) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return;
      if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey && !isFreePractice) {
        e.preventDefault();
        onEditItem(currentEntry.type, currentEntry.id);
        return;
      }

      if (currentEntry.type === 'cloze') {
        if (e.code === 'Space' && !isAnswerRevealed) {
          e.preventDefault();
          setIsAnswerRevealed(true);
        } else if (isAnswerRevealed) {
          if (e.key === '1') handleRate(1);
          if (e.key === '2') handleRate(2);
          if (e.key === '3') handleRate(3);
          if (e.key === '4') handleRate(4);
        }
      } else if (e.altKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleSubExtract();
      } else if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleClozeFromSelection();
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        handleExtractNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });


  // --- Écran : Entraînement express terminé ---
  if (isFreePractice && practiceFinished) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div className="w-16 h-16 bg-[var(--bg-f4f7f2)] text-[var(--fg-365a2e)] border border-[var(--bd-c5d9be)] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--fg-28231d)]">
          Entraînement express réussi !
        </h2>
        <p className="mt-2 text-sm text-[var(--fg-695f54)] max-w-md mx-auto leading-relaxed">
          Vous avez maîtrisé vos <strong className="font-semibold text-[var(--fg-28231d)]">{practiceInitialCount} cartes</strong> avec succès. Comme prévu, vos calendriers de répétition espacée FSRS sont restés intacts.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => {
              setIsFreePractice(false);
              setPracticeFinished(false);
            }}
            className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)] rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Nouvelle session express</span>
          </button>
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 text-xs font-medium text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] bg-[var(--bg-ffffff)] hover:bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors"
          >
            Retour à la file de lecture
          </button>
        </div>
      </div>
    );
  }

  // --- Écran : Fin de révision du jour FSRS ou Aucune carte due ---
  if (!isFreePractice && (!currentEntry || currentIndex >= queue.length)) {
    const totalAvailable = availableCounts[practicePool];

    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Statut session principale */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[var(--bg-f3efe8)] text-[var(--fg-8c5e32)] border border-[var(--bd-e8e2d5)] rounded-2xl flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-7 h-7 text-[var(--fg-5f8550)]" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--fg-28231d)]">
            Session de révision du jour terminée !
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-[var(--fg-695f54)] max-w-md mx-auto leading-relaxed">
            {sessionCompletedCount > 0 ? (
              <>
                Vous avez révisé <strong className="font-semibold text-[var(--fg-28231d)]">{sessionCompletedCount} élément{sessionCompletedCount > 1 ? 's' : ''}</strong>. Vos intervalles FSRS ont été mis à jour et espacés dans le futur.
              </>
            ) : (
              <>
                Félicitations ! Toutes vos révisions du jour terminées.
              </>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] bg-[var(--bg-ffffff)] hover:bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors"
            >
              Retour au lecteur
            </button>

            {!reviewAhead && (
              <button
                onClick={() => {
                  const aheadQueue = buildQueue(true);
                  setQueue(aheadQueue);
                  setCurrentIndex(0);
                  setReviewAhead(true);
                }}
                className="px-4 py-2 text-xs font-medium text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] bg-[var(--bg-ffffff)] hover:bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Étude anticipée (FSRS)</span>
              </button>
            )}
          </div>
        </div>

        {/* Panneau : Entraînement Express sans reprogrammation */}
        <div className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl p-6 sm:p-7 shadow-xs">
          <div className="flex items-start gap-3.5 pb-4 border-b border-[var(--bd-f3efe8)]">
            <div className="w-10 h-10 rounded-xl bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] flex items-center justify-center shrink-0 text-[var(--fg-8c5e32)]">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-[var(--fg-28231d)]">
                  Entraînement express sans reprogrammation
                </h3>
              </div>
              <p className="text-xs text-[var(--fg-695f54)] mt-1 leading-relaxed">
                Révisez librement une sélection aléatoire de vos cartes. 
                Les cartes notées <strong className="text-[var(--fg-365a2e)]">Bon / Facile</strong> sont retirées dès qu'elles sont maîtrisées. Celles notées <strong className="text-[var(--fg-8c3a20)]">À revoir / Difficile</strong> sont remises dans la file jusqu'à assimilation complète, sans toucher à vos dates FSRS.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {/* Nombre de cartes à tirer aléatoirement */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label className="font-medium text-[var(--fg-28231d)]">
                  Nombre de cartes aléatoires à tirer
                </label>
                <span className="text-[var(--fg-8c8072)] font-mono text-[11px]">
                  Disponible : {totalAvailable} élément{totalAvailable > 1 ? 's' : ''}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, totalAvailable)}
                  value={practiceCount}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (isNaN(val)) setPracticeCount(1);
                    else setPracticeCount(Math.max(1, Math.min(val, totalAvailable)));
                  }}
                  className="w-24 px-3 py-2 text-xs font-mono font-semibold bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-lg text-[var(--fg-28231d)] focus:outline-hidden focus:border-[var(--bd-8c5e32)]"
                />

                <div className="flex items-center gap-1.5 flex-wrap">
                  {[5, 10, 20].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={totalAvailable < preset}
                      onClick={() => setPracticeCount(Math.min(preset, totalAvailable))}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border font-mono transition-colors ${
                        practiceCount === preset
                          ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] border-[var(--bd-3b3026)]'
                          : 'bg-[var(--bg-ffffff)] text-[var(--fg-695f54)] border-[var(--bd-e8e2d5)] hover:bg-[var(--bg-f3efe8)] disabled:opacity-40 disabled:hover:bg-[var(--bg-ffffff)]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}

                  <button
                    type="button"
                    disabled={totalAvailable === 0}
                    onClick={() => setPracticeCount(totalAvailable)}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border font-mono transition-colors ${
                      practiceCount === totalAvailable && totalAvailable > 0
                        ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] border-[var(--bd-3b3026)]'
                        : 'bg-[var(--bg-ffffff)] text-[var(--fg-695f54)] border-[var(--bd-e8e2d5)] hover:bg-[var(--bg-f3efe8)] disabled:opacity-40'
                    }`}
                  >
                    Tout ({totalAvailable})
                  </button>
                </div>
              </div>
            </div>

            {/* Bouton de lancement */}
            <div className="pt-2">
              <button
                type="button"
                disabled={totalAvailable === 0}
                onClick={handleStartFreePractice}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 text-xs font-semibold text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)] disabled:bg-[var(--bg-d5cebf)] disabled:cursor-not-allowed rounded-xl shadow-xs transition-all cursor-pointer active:scale-[0.99]"
              >
                <Shuffle className="w-4 h-4 text-[var(--fg-decbb0)]" />
                <span>
                  Lancer l'entraînement express ({Math.min(practiceCount, totalAvailable)} cartes tirées)
                </span>
                <ArrowRight className="w-4 h-4 ml-1 opacity-80" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isCloze = currentEntry.type === 'cloze';

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* En-tête de session */}
      {isFreePractice ? (
        <div>
          <div className="flex items-center justify-between text-xs text-[var(--fg-695f54)] mb-3 pb-3 border-b border-[var(--bd-e8e2d5)]">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[var(--fg-8c5e32)]" />
              <span className="font-semibold text-[var(--fg-28231d)]">
                Entraînement Express (sans reprogrammation)
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {practiceQueue.length} restante{practiceQueue.length > 1 ? 's' : ''} sur {practiceInitialCount}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] bg-[var(--bg-f3efe8)] text-[var(--fg-8c5e32)] px-2 py-0.5 rounded font-medium border border-[var(--bd-e8e2d5)]">
                FSRS préservé
              </span>
              <button
                onClick={() => {
                  setIsFreePractice(false);
                  setPracticeFinished(false);
                }}
                className="text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] text-xs transition-colors cursor-pointer"
              >
                Quitter l'entraînement
              </button>
            </div>
          </div>

          {/* Barre de progression de maîtrise de la session */}
          <div className="w-full bg-[var(--bg-eae4d9)] h-1.5 rounded-full overflow-hidden mb-6">
            <div
              className="bg-[var(--bg-8c5e32)] h-full transition-all duration-300 rounded-full"
              style={{
                width: `${Math.round(
                  (practiceCompletedCount / Math.max(1, practiceInitialCount)) * 100
                )}%`,
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-[var(--fg-695f54)] mb-6 pb-4 border-b border-[var(--bd-e8e2d5)]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--fg-8c5e32)]" />
            <span className="font-semibold text-[var(--fg-28231d)]">
              Révision du jour
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Élément {currentIndex + 1} sur {queue.length}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono tabular-nums text-[var(--fg-8c8072)]">
              {isCloze
                ? currentEntry.fsrs.reps === 0 || currentEntry.fsrs.phase === 'new'
                  ? 'Nouvelle carte'
                  : `Stabilité : ${formatInterval(currentEntry.fsrs.stability)} · Diff : ${currentEntry.fsrs.difficulty.toFixed(1)}`
                : `Intervalle actuel : ${formatInterval(currentEntry.fsrs.interval)}`}
            </span>
            <button
              onClick={onClose}
              className="text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] text-xs transition-colors cursor-pointer"
            >
              Quitter
            </button>
          </div>
        </div>
      )}

      {/* Carte active en blanc et beige */}
      <div className="p-8 sm:p-12 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xs min-h-[340px] flex flex-col justify-between transition-all">
        <div>
          {/* Métadonnées de l'élément (Zero-pill) */}
          <div className="flex items-center justify-between text-xs text-[var(--fg-8c8072)] mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--fg-695f54)]">
                {isCloze ? 'Carte à trou' : 'Extrait à relire'}
              </span>
              <span aria-hidden="true">·</span>
              {onNavigateToDocument && currentEntry.documentId ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateToDocument(currentEntry.documentId!);
                  }}
                  className="truncate max-w-[220px] text-[var(--fg-28231d)] font-medium hover:underline text-left cursor-pointer"
                  title="Ouvrir dans le lecteur"
                >
                  {currentEntry.documentTitle}
                </button>
              ) : (
                <span className="truncate max-w-[220px] text-[var(--fg-28231d)] font-medium">
                  {currentEntry.documentTitle}
                </span>
              )}
            </div>
            <span className="flex items-center gap-3">
              {!isFreePractice && (
                <button
                  type="button"
                  onClick={() => onEditItem(currentEntry.type, currentEntry.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)] cursor-pointer"
                  title={isCloze ? 'Modifier la carte (E)' : "Modifier l'extrait (E)"}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Modifier
                </button>
              )}
              <span className="font-mono tabular-nums">Priorité : {currentEntry.priority}%</span>
            </span>
          </div>

          {/* Énoncé de la carte */}
          {isCloze ? (
            <div className="text-xl sm:text-2xl font-serif-reading text-[var(--fg-28231d)] leading-relaxed font-normal">
              <span
                dangerouslySetInnerHTML={{ __html: safeHtml(renderClozeCard(currentEntry.text, isAnswerRevealed)) }}
              />
            </div>
          ) : (
            <div>
              <div
                ref={extractTextRef}
                onMouseUp={() => {
                  const sel = getBlockSelection(extractTextRef.current);
                  setExtractSelection(sel && sel.text.trim().length > 1 ? sel : null);
                }}
                className="text-lg sm:text-xl font-serif-reading text-[var(--fg-28231d)] leading-relaxed whitespace-pre-line select-text"
              >
                <span dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(currentEntry.text)) }} />
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-5">
                <button
                  onClick={handleSubExtract}
                  disabled={!extractSelection}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--fg-3b3026)] bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d9)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  title="Extraire la sélection dans un nouvel extrait plus court (Alt+X)"
                >
                  <Scissors className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
                  <span>Extraire la sélection</span>
                </button>
                <button
                  onClick={handleClozeFromSelection}
                  disabled={!extractSelection}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--fg-3b3026)] bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d9)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  title="Masquer la sélection dans une carte à trou ; la phrase autour sert de contexte (Alt+C)"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
                  <span>Carte à trou</span>
                </button>
                {!extractSelection && (
                  <span className="text-[11px] text-[var(--fg-8c8072)]">
                    Sélectionnez un passage (à extraire) ou un mot (à masquer).
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Note révélée */}
          {isCloze && isAnswerRevealed && currentEntry.note && (
            <div className="mt-6 pt-4 border-t border-[var(--bd-f3efe8)] text-xs text-[var(--fg-695f54)] leading-relaxed">
              <span className="font-semibold text-[var(--fg-28231d)]">Note de formulation :</span>{' '}
              {currentEntry.note}
            </div>
          )}
        </div>

        {/* Pied de carte : Révélation ou 4 évaluations en beige/blanc */}
        <div className="mt-12 pt-6 border-t border-[var(--bd-f3efe8)]">
          {!isCloze ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-[var(--fg-8c8072)] hidden sm:inline">
                Reste-t-il quelque chose à tirer de cet extrait ? <kbd className="px-1.5 py-0.5 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded font-mono text-[10px]">Entrée</kbd> = oui
              </span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {confirmRetire ? (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--fg-695f54)]">Retirer cet extrait de la file ?</span>
                    <button
                      onClick={handleRetireExtract}
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
                    title="Extrait entièrement traité (ses cartes restent)"
                  >
                    Tout est extrait · terminer
                  </button>
                )}
                <button
                  onClick={handleExtractNext}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)] rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  <span>
                    {isDueToday(currentEntry.fsrs)
                      ? `Il reste à extraire · dans ${formatInterval(nextTopicInterval(currentEntry.fsrs, currentEntry.priority))}`
                      : `Suivant · déjà prévu dans ${formatInterval(
                          (new Date(currentEntry.fsrs.nextReviewDate).getTime() - Date.now()) / 86400000
                        )}`}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : !isAnswerRevealed ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-[var(--fg-8c8072)] hidden sm:inline">
                Appuyez sur <kbd className="px-1.5 py-0.5 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded font-mono text-[10px]">Espace</kbd> pour afficher la réponse
              </span>
              <button
                onClick={() => setIsAnswerRevealed(true)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)] rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>Afficher la réponse</span>
              </button>
            </div>
          ) : (
            <div>
              <div className="text-center text-xs text-[var(--fg-8c8072)] mb-3 font-mono">
                {isFreePractice
                  ? 'Évaluez (1 et 2 remettent dans la file, 3 et 4 retirent la carte maîtrisée) :'
                  : 'Évaluez la difficulté de rappel FSRS (1 à 4 au clavier) :'}
              </div>

              {isFreePractice ? (
                // Boutons d'évaluation spécifiques à l'entraînement sans reprogrammation
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {/* 1: À revoir -> Remis dans la file */}
                  <button
                    onClick={() => handleRate(1)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[var(--bg-fdf3ee)] hover:bg-[var(--bg-f9e5dc)] border border-[var(--bd-e9c5b7)] text-[var(--fg-8c3a20)] rounded-xl transition-all cursor-pointer active:scale-95"
                    title="Remis dans la liste d'entraînement"
                  >
                    <span className="text-xs font-semibold">1 · À revoir</span>
                    <span className="text-[10px] font-medium opacity-85 mt-0.5">
                      Remis en file
                    </span>
                  </button>

                  {/* 2: Difficile -> Remis en fin de file */}
                  <button
                    onClick={() => handleRate(2)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[var(--bg-fcf7eb)] hover:bg-[var(--bg-f8eed1)] border border-[var(--bd-e4d1a0)] text-[var(--fg-7a5415)] rounded-xl transition-all cursor-pointer active:scale-95"
                    title="Remis en fin de file d'entraînement"
                  >
                    <span className="text-xs font-semibold">2 · Difficile</span>
                    <span className="text-[10px] font-medium opacity-85 mt-0.5">
                      Remis en file
                    </span>
                  </button>

                  {/* 3: Bon -> Disparaît de la liste */}
                  <button
                    onClick={() => handleRate(3)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[var(--bg-f4f7f2)] hover:bg-[var(--bg-e8f0e4)] border border-[var(--bd-c5d9be)] text-[var(--fg-365a2e)] rounded-xl transition-all cursor-pointer active:scale-95"
                    title="Maîtrisé : sort de la liste"
                  >
                    <span className="text-xs font-semibold">3 · Bon</span>
                    <span className="text-[10px] font-medium opacity-85 mt-0.5">
                      Maîtrisé (retiré)
                    </span>
                  </button>

                  {/* 4: Facile -> Disparaît de la liste */}
                  <button
                    onClick={() => handleRate(4)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d7)] border border-[var(--bd-dfd6c5)] text-[var(--fg-3b3026)] rounded-xl transition-all cursor-pointer active:scale-95"
                    title="Très facile : sort de la liste"
                  >
                    <span className="text-xs font-semibold">4 · Très facile</span>
                    <span className="text-[10px] font-medium opacity-85 mt-0.5">
                      Maîtrisé (retiré)
                    </span>
                  </button>
                </div>
              ) : (
                // Boutons d'évaluation FSRS normale avec prédictions de délai
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {/* 1: À revoir */}
                  <button
                    onClick={() => handleRate(1)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[var(--bg-fdf3ee)] hover:bg-[var(--bg-f9e5dc)] border border-[var(--bd-e9c5b7)] text-[var(--fg-8c3a20)] rounded-xl transition-all cursor-pointer"
                  >
                    <span className="text-xs font-semibold">1 · À revoir</span>
                    <span className="text-[11px] font-mono opacity-80 mt-0.5">
                      {predictions ? predictions[1].intervalDisplay : '1 j'}
                    </span>
                  </button>

                  {/* 2: Difficile */}
                  <button
                    onClick={() => handleRate(2)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[var(--bg-fcf7eb)] hover:bg-[var(--bg-f8eed1)] border border-[var(--bd-e4d1a0)] text-[var(--fg-7a5415)] rounded-xl transition-all cursor-pointer"
                  >
                    <span className="text-xs font-semibold">2 · Difficile</span>
                    <span className="text-[11px] font-mono opacity-80 mt-0.5">
                      {predictions ? predictions[2].intervalDisplay : '2 j'}
                    </span>
                  </button>

                  {/* 3: Bon */}
                  <button
                    onClick={() => handleRate(3)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[var(--bg-f4f7f2)] hover:bg-[var(--bg-e8f0e4)] border border-[var(--bd-c5d9be)] text-[var(--fg-365a2e)] rounded-xl transition-all cursor-pointer"
                  >
                    <span className="text-xs font-semibold">3 · Bon</span>
                    <span className="text-[11px] font-mono opacity-80 mt-0.5">
                      {predictions ? predictions[3].intervalDisplay : '5 j'}
                    </span>
                  </button>

                  {/* 4: Facile */}
                  <button
                    onClick={() => handleRate(4)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d7)] border border-[var(--bd-dfd6c5)] text-[var(--fg-3b3026)] rounded-xl transition-all cursor-pointer"
                  >
                    <span className="text-xs font-semibold">4 · Facile</span>
                    <span className="text-[11px] font-mono opacity-80 mt-0.5">
                      {predictions ? predictions[4].intervalDisplay : '12 j'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={`fixed bottom-6 right-6 z-50 max-w-sm flex items-start gap-2 px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium border ${
            toast.error
              ? 'bg-[var(--bg-fdf2f0)] text-[var(--fg-8f352b)] border-[var(--bd-f2d6d3)]'
              : 'bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] border-[var(--bd-3e3831)]'
          }`}
        >
          {!toast.error && <Check className="w-4 h-4 shrink-0 text-[var(--fg-8eb87d)]" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};
