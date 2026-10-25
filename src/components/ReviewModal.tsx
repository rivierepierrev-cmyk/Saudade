import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ClozeItem, ExtractItem, ReviewRating, FSRSRecord } from '../types/foliole';
import { predictAllRatings, nextTopicInterval, formatInterval } from '../lib/fsrs';
import { buildCloze, getBlockSelection, BlockSelection } from '../lib/cloze';
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
  /** Done reading an extract for now; returns the new interval in days. */
  onExtractNext: (id: string) => number | undefined;
  onRetireExtract: (id: string) => void;
  onCreateExtractFromExtract: (extractId: string, text: string) => void;
  onCreateClozeFromExtract: (extractId: string, clozeText: string) => void;
  /** Maximum number of different cards reviewed per day. */
  dailyLimit: number;
  /** Ids of cards already reviewed today (they don't use up the limit again). */
  reviewedTodayIds: Set<string>;
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
  onRetireExtract,
  onCreateExtractFromExtract,
  onCreateClozeFromExtract,
  dailyLimit,
  reviewedTodayIds,
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
  const buildQueue = (includeAll: boolean = false): ReviewQueueEntry[] => {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const isDue = (dateStr: string) => new Date(dateStr) <= now;

    const entries: ReviewQueueEntry[] = [];

    // 1. Cartes Cloze
    clozes.forEach((c) => {
      if (
        c.state !== 'dismissed' &&
        (includeAll || isDue(c.fsrs.nextReviewDate) || c.id === initialItemId)
      ) {
        entries.push({
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
      }
    });

    // 2. Extraits de lecture incrémentale
    extracts.forEach((e) => {
      if (
        e.state !== 'dismissed' &&
        (includeAll || isDue(e.fsrs.nextReviewDate) || e.id === initialItemId)
      ) {
        entries.push({
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
      }
    });

    // Tri par priorité décroissante, en plaçant l'item cliqué en premier si spécifié
    entries.sort((a, b) => {
      if (initialItemId) {
        if (a.id === initialItemId) return -1;
        if (b.id === initialItemId) return 1;
      }
      return b.priority - a.priority;
    });

    // Daily limit: cards not yet seen today are capped; cards already reviewed today
    // (learning steps) and extracts are always included.
    if (includeAll) return entries;
    let budget = Math.max(0, dailyLimit - reviewedTodayIds.size);
    return entries.filter((e) => {
      if (e.type !== 'cloze' || reviewedTodayIds.has(e.id) || e.id === initialItemId) return true;
      if (budget <= 0) return false;
      budget--;
      return true;
    });
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
      showToast(result.error, true);
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

  const renderClozeContent = (text: string, revealed: boolean) => {
    const clozeRegex = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/g;

    if (!revealed) {
      return text.replace(clozeRegex, '[...]');
    }

    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = clozeRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(
        <span
          key={match.index}
          className="bg-[#F3E6CE] text-[#28231D] font-bold px-1.5 py-0.5 rounded border border-[#DECBB0]"
        >
          {match[1]}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  };

  // --- Écran : Entraînement express terminé ---
  if (isFreePractice && practiceFinished) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div className="w-16 h-16 bg-[#F4F7F2] text-[#365A2E] border border-[#C5D9BE] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-[#28231D]">
          Entraînement express réussi !
        </h2>
        <p className="mt-2 text-sm text-[#695F54] max-w-md mx-auto leading-relaxed">
          Vous avez maîtrisé vos <strong className="font-semibold text-[#28231D]">{practiceInitialCount} cartes</strong> avec succès. Comme prévu, vos calendriers de répétition espacée FSRS sont restés intacts.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => {
              setIsFreePractice(false);
              setPracticeFinished(false);
            }}
            className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold text-[#FAF7F2] bg-[#3B3026] hover:bg-[#28211A] rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Nouvelle session express</span>
          </button>
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 text-xs font-medium text-[#695F54] hover:text-[#28231D] bg-white hover:bg-[#F3EFE8] border border-[#E8E2D5] rounded-lg transition-colors"
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
          <div className="w-14 h-14 bg-[#F3EFE8] text-[#8C5E32] border border-[#E8E2D5] rounded-2xl flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-7 h-7 text-[#5F8550]" />
          </div>
          <h2 className="text-2xl font-bold text-[#28231D]">
            Session de révision du jour terminée !
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-[#695F54] max-w-md mx-auto leading-relaxed">
            {sessionCompletedCount > 0 ? (
              <>
                Vous avez révisé <strong className="font-semibold text-[#28231D]">{sessionCompletedCount} élément{sessionCompletedCount > 1 ? 's' : ''}</strong>. Vos intervalles FSRS ont été mis à jour et espacés dans le futur.
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
              className="px-4 py-2 text-xs font-medium text-[#695F54] hover:text-[#28231D] bg-white hover:bg-[#F3EFE8] border border-[#E8E2D5] rounded-lg transition-colors"
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
                className="px-4 py-2 text-xs font-medium text-[#695F54] hover:text-[#28231D] bg-white hover:bg-[#F3EFE8] border border-[#E8E2D5] rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Étude anticipée (FSRS)</span>
              </button>
            )}
          </div>
        </div>

        {/* Panneau : Entraînement Express sans reprogrammation */}
        <div className="bg-white border border-[#E8E2D5] rounded-2xl p-6 sm:p-7 shadow-xs">
          <div className="flex items-start gap-3.5 pb-4 border-b border-[#F3EFE8]">
            <div className="w-10 h-10 rounded-xl bg-[#FAF7F2] border border-[#E8E2D5] flex items-center justify-center shrink-0 text-[#8C5E32]">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-[#28231D]">
                  Entraînement express sans reprogrammation
                </h3>
              </div>
              <p className="text-xs text-[#695F54] mt-1 leading-relaxed">
                Révisez librement une sélection aléatoire de vos cartes. 
                Les cartes notées <strong className="text-[#365A2E]">Bon / Facile</strong> sont retirées dès qu'elles sont maîtrisées. Celles notées <strong className="text-[#8C3A20]">À revoir / Difficile</strong> sont remises dans la file jusqu'à assimilation complète, sans toucher à vos dates FSRS.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {/* Nombre de cartes à tirer aléatoirement */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label className="font-medium text-[#28231D]">
                  Nombre de cartes aléatoires à tirer
                </label>
                <span className="text-[#8C8072] font-mono text-[11px]">
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
                  className="w-24 px-3 py-2 text-xs font-mono font-semibold bg-[#FAF7F2] border border-[#E8E2D5] rounded-lg text-[#28231D] focus:outline-hidden focus:border-[#8C5E32]"
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
                          ? 'bg-[#3B3026] text-[#FAF7F2] border-[#3B3026]'
                          : 'bg-white text-[#695F54] border-[#E8E2D5] hover:bg-[#F3EFE8] disabled:opacity-40 disabled:hover:bg-white'
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
                        ? 'bg-[#3B3026] text-[#FAF7F2] border-[#3B3026]'
                        : 'bg-white text-[#695F54] border-[#E8E2D5] hover:bg-[#F3EFE8] disabled:opacity-40'
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
                className="w-full flex items-center justify-center gap-2 px-5 py-3 text-xs font-semibold text-[#FAF7F2] bg-[#3B3026] hover:bg-[#28211A] disabled:bg-[#D5CEBF] disabled:cursor-not-allowed rounded-xl shadow-xs transition-all cursor-pointer active:scale-[0.99]"
              >
                <Shuffle className="w-4 h-4 text-[#DECBB0]" />
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
          <div className="flex items-center justify-between text-xs text-[#695F54] mb-3 pb-3 border-b border-[#E8E2D5]">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#8C5E32]" />
              <span className="font-semibold text-[#28231D]">
                Entraînement Express (sans reprogrammation)
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {practiceQueue.length} restante{practiceQueue.length > 1 ? 's' : ''} sur {practiceInitialCount}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] bg-[#F3EFE8] text-[#8C5E32] px-2 py-0.5 rounded font-medium border border-[#E8E2D5]">
                FSRS préservé
              </span>
              <button
                onClick={() => {
                  setIsFreePractice(false);
                  setPracticeFinished(false);
                }}
                className="text-[#8C8072] hover:text-[#28231D] text-xs transition-colors cursor-pointer"
              >
                Quitter l'entraînement
              </button>
            </div>
          </div>

          {/* Barre de progression de maîtrise de la session */}
          <div className="w-full bg-[#EAE4D9] h-1.5 rounded-full overflow-hidden mb-6">
            <div
              className="bg-[#8C5E32] h-full transition-all duration-300 rounded-full"
              style={{
                width: `${Math.round(
                  (practiceCompletedCount / Math.max(1, practiceInitialCount)) * 100
                )}%`,
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-[#695F54] mb-6 pb-4 border-b border-[#E8E2D5]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#8C5E32]" />
            <span className="font-semibold text-[#28231D]">
              Révision du jour
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Élément {currentIndex + 1} sur {queue.length}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono tabular-nums text-[#8C8072]">
              {isCloze
                ? currentEntry.fsrs.reps === 0 || currentEntry.fsrs.phase === 'new'
                  ? 'Nouvelle carte'
                  : `Stabilité : ${formatInterval(currentEntry.fsrs.stability)} · Diff : ${currentEntry.fsrs.difficulty.toFixed(1)}`
                : `Intervalle actuel : ${formatInterval(currentEntry.fsrs.interval)}`}
            </span>
            <button
              onClick={onClose}
              className="text-[#8C8072] hover:text-[#28231D] text-xs transition-colors cursor-pointer"
            >
              Quitter
            </button>
          </div>
        </div>
      )}

      {/* Carte active en blanc et beige */}
      <div className="p-8 sm:p-12 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs min-h-[340px] flex flex-col justify-between transition-all">
        <div>
          {/* Métadonnées de l'élément (Zero-pill) */}
          <div className="flex items-center justify-between text-xs text-[#8C8072] mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-[#695F54]">
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
                  className="truncate max-w-[220px] text-[#28231D] font-medium hover:underline text-left cursor-pointer"
                  title="Ouvrir dans le lecteur"
                >
                  {currentEntry.documentTitle}
                </button>
              ) : (
                <span className="truncate max-w-[220px] text-[#28231D] font-medium">
                  {currentEntry.documentTitle}
                </span>
              )}
            </div>
            <span className="font-mono tabular-nums">Priorité : {currentEntry.priority}%</span>
          </div>

          {/* Énoncé de la carte */}
          {isCloze ? (
            <div className="text-xl sm:text-2xl font-serif-reading text-[#28231D] leading-relaxed font-normal">
              {renderClozeContent(currentEntry.text, isAnswerRevealed)}
            </div>
          ) : (
            <div>
              <div
                ref={extractTextRef}
                onMouseUp={() => {
                  const sel = getBlockSelection(extractTextRef.current);
                  setExtractSelection(sel && sel.text.trim().length > 1 ? sel : null);
                }}
                className="text-lg sm:text-xl font-serif-reading text-[#28231D] leading-relaxed whitespace-pre-line select-text"
              >
                {currentEntry.text}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-5">
                <button
                  onClick={handleSubExtract}
                  disabled={!extractSelection}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#3B3026] bg-[#F3EFE8] hover:bg-[#EAE4D9] border border-[#E8E2D5] rounded-lg transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  title="Extraire la sélection dans un nouvel extrait plus court (Alt+X)"
                >
                  <Scissors className="w-3.5 h-3.5 text-[#8C5E32]" />
                  <span>Extraire la sélection</span>
                </button>
                <button
                  onClick={handleClozeFromSelection}
                  disabled={!extractSelection}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#3B3026] bg-[#F3EFE8] hover:bg-[#EAE4D9] border border-[#E8E2D5] rounded-lg transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  title="Masquer la sélection dans une carte à trou ; la phrase autour sert de contexte (Alt+C)"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#8C5E32]" />
                  <span>Carte à trou</span>
                </button>
                {!extractSelection && (
                  <span className="text-[11px] text-[#8C8072]">
                    Sélectionnez un passage (à extraire) ou un mot (à masquer).
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Note révélée */}
          {isCloze && isAnswerRevealed && currentEntry.note && (
            <div className="mt-6 pt-4 border-t border-[#F3EFE8] text-xs text-[#695F54] leading-relaxed">
              <span className="font-semibold text-[#28231D]">Note de formulation :</span>{' '}
              {currentEntry.note}
            </div>
          )}
        </div>

        {/* Pied de carte : Révélation ou 4 évaluations en beige/blanc */}
        <div className="mt-12 pt-6 border-t border-[#F3EFE8]">
          {!isCloze ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-[#8C8072] hidden sm:inline">
                <kbd className="px-1.5 py-0.5 bg-[#F3EFE8] border border-[#E8E2D5] rounded font-mono text-[10px]">Entrée</kbd> pour passer à la suite
              </span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {confirmRetire ? (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="text-[#695F54]">Retirer cet extrait de la file ?</span>
                    <button
                      onClick={handleRetireExtract}
                      className="px-3 py-2 font-semibold text-white bg-[#5F8550] hover:bg-[#4E7042] rounded-lg cursor-pointer"
                    >
                      Oui, terminé
                    </button>
                    <button
                      onClick={() => setConfirmRetire(false)}
                      className="px-2.5 py-2 text-[#695F54] hover:bg-[#F3EFE8] rounded-lg cursor-pointer"
                    >
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmRetire(true)}
                    className="px-3.5 py-2 text-xs text-[#695F54] hover:text-[#28231D] bg-white hover:bg-[#F3EFE8] border border-[#E8E2D5] rounded-lg transition-colors cursor-pointer"
                    title="Extrait entièrement traité (ses cartes restent)"
                  >
                    Terminer cet extrait
                  </button>
                )}
                <button
                  onClick={handleExtractNext}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#FAF7F2] bg-[#3B3026] hover:bg-[#28211A] rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  <span>
                    Suivant · revoir dans {formatInterval(nextTopicInterval(currentEntry.fsrs, currentEntry.priority))}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : !isAnswerRevealed ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-[#8C8072] hidden sm:inline">
                Appuyez sur <kbd className="px-1.5 py-0.5 bg-[#F3EFE8] border border-[#E8E2D5] rounded font-mono text-[10px]">Espace</kbd> pour afficher la réponse
              </span>
              <button
                onClick={() => setIsAnswerRevealed(true)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold text-[#FAF7F2] bg-[#3B3026] hover:bg-[#28211A] rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>Afficher la réponse</span>
              </button>
            </div>
          ) : (
            <div>
              <div className="text-center text-xs text-[#8C8072] mb-3 font-mono">
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
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[#FDF3EE] hover:bg-[#F9E5DC] border border-[#E9C5B7] text-[#8C3A20] rounded-xl transition-all cursor-pointer active:scale-95"
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
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[#FCF7EB] hover:bg-[#F8EED1] border border-[#E4D1A0] text-[#7A5415] rounded-xl transition-all cursor-pointer active:scale-95"
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
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[#F4F7F2] hover:bg-[#E8F0E4] border border-[#C5D9BE] text-[#365A2E] rounded-xl transition-all cursor-pointer active:scale-95"
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
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[#F3EFE8] hover:bg-[#EAE4D7] border border-[#DFD6C5] text-[#3B3026] rounded-xl transition-all cursor-pointer active:scale-95"
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
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[#FDF3EE] hover:bg-[#F9E5DC] border border-[#E9C5B7] text-[#8C3A20] rounded-xl transition-all cursor-pointer"
                  >
                    <span className="text-xs font-semibold">1 · À revoir</span>
                    <span className="text-[11px] font-mono opacity-80 mt-0.5">
                      {predictions ? predictions[1].intervalDisplay : '1 j'}
                    </span>
                  </button>

                  {/* 2: Difficile */}
                  <button
                    onClick={() => handleRate(2)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[#FCF7EB] hover:bg-[#F8EED1] border border-[#E4D1A0] text-[#7A5415] rounded-xl transition-all cursor-pointer"
                  >
                    <span className="text-xs font-semibold">2 · Difficile</span>
                    <span className="text-[11px] font-mono opacity-80 mt-0.5">
                      {predictions ? predictions[2].intervalDisplay : '2 j'}
                    </span>
                  </button>

                  {/* 3: Bon */}
                  <button
                    onClick={() => handleRate(3)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[#F4F7F2] hover:bg-[#E8F0E4] border border-[#C5D9BE] text-[#365A2E] rounded-xl transition-all cursor-pointer"
                  >
                    <span className="text-xs font-semibold">3 · Bon</span>
                    <span className="text-[11px] font-mono opacity-80 mt-0.5">
                      {predictions ? predictions[3].intervalDisplay : '5 j'}
                    </span>
                  </button>

                  {/* 4: Facile */}
                  <button
                    onClick={() => handleRate(4)}
                    className="flex flex-col items-center justify-center py-2.5 px-3 bg-[#F3EFE8] hover:bg-[#EAE4D7] border border-[#DFD6C5] text-[#3B3026] rounded-xl transition-all cursor-pointer"
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
              ? 'bg-[#FDF2F0] text-[#8F352B] border-[#F2D6D3]'
              : 'bg-[#28231D] text-[#FAF7F2] border-[#3E3831]'
          }`}
        >
          {!toast.error && <Check className="w-4 h-4 shrink-0 text-[#8EB87D]" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};
