/**
 * Saudade Core Domain Types
 * Incremental Reading & Spaced Repetition (FSRS)
 */

export type ItemType = 'document' | 'extract' | 'cloze';

export type ReviewRating = 1 | 2 | 3 | 4; // 1: Again, 2: Hard, 3: Good, 4: Easy

export type ItemState = 'new' | 'learning' | 'review' | 'dismissed';

/** Learning phase of a cloze card (FSRS). Unused for documents and extracts. */
export type CardPhase = 'new' | 'learning' | 'review' | 'relearning';

export interface FSRSRecord {
  stability: number;   // S: Days required for retrievability to drop from 100% to 90%
  difficulty: number;  // D: Inherent memory difficulty (1.0 to 10.0)
  reps: number;        // Review repetitions count
  lapses: number;      // Times forgotten (rated Again)
  lastReview?: string; // ISO date string
  nextReviewDate: string; // ISO date string
  interval: number;    // Scheduled interval in days
  phase?: CardPhase;   // Cards only; missing on records from older versions (treated as 'review')
  learningSteps?: number; // Cards only: current short-term learning step
}

export interface DocumentItem {
  id: string;
  title: string;
  author?: string;
  sourceUrl?: string;
  folder?: string; // Dossier ou chemin hiérarchique, ex. "Sciences/Neurosciences"
  /** 'writing': a text the user writes over time (incremental writing). */
  format: 'markdown' | 'article' | 'book' | 'pdf' | 'note' | 'writing';
  content: string;
  tags: string[];
  priority: number; // 0 to 100 (100 = highest priority)
  readingProgress: number; // 0 to 100%
  lastReadOffset: number; // character position
  createdAt: string;
  updatedAt: string;
  fsrs: FSRSRecord;
  state: ItemState;
  extractedCount?: number;
}

export interface ExtractItem {
  id: string;
  documentId: string;
  documentTitle: string;
  parentExtractId?: string; // Set when extracted from another extract
  sourceStart?: number; // Where the passage starts in the document's Markdown (to edit it there too)
  folder?: string; // Hérité du document ou dossier propre
  text: string;
  note?: string;
  tags: string[];
  priority: number; // 0 to 100
  createdAt: string;
  updatedAt: string;
  fsrs: FSRSRecord;
  state: ItemState;
}

/** A zone hidden on an image card, in fractions of the image (0 to 1); n = its card. */
export interface OcclusionMask {
  x: number;
  y: number;
  w: number;
  h: number;
  n: number;
}

export interface ClozeItem {
  id: string;
  documentId?: string;
  extractId?: string;
  documentTitle?: string;
  folder?: string; // Hérité du document ou dossier propre
  /** Deletion number shown by this card (the N of {{cN::…}}). Missing on cards from older versions. */
  clozeNumber?: number;
  /** Cards made from the same text (one per deletion number) share this id. */
  noteId?: string;
  /** The sentence as it stood in the document or extract when the card was made: the card
   *  is found there by it, even after being reworded. */
  sourceText?: string;
  /**
   * 'qa': a question/answer card (question in `text`, answer in `answer`).
   * 'io': an image with hidden zones (`image`, `masks`; `text` = optional instruction),
   * one card per zone number, like cloze numbers. Missing: a cloze card.
   */
  kind?: 'qa' | 'io';
  text: string; // e.g. "The {{c1::hippocampus}} is essential for memory consolidation."
  /** Question/answer cards: the answer (Markdown-free text, LaTeX allowed). */
  answer?: string;
  /** Image cards: the image (/media/…), its zones, and whether the other zones stay hidden. */
  image?: string;
  masks?: OcclusionMask[];
  occlusionMode?: 'all' | 'one';
  /** Leech (forgotten again and again): true when flagged, false once cleared by hand. */
  leech?: boolean;
  note?: string;
  tags: string[];
  priority: number;
  createdAt: string;
  updatedAt: string;
  fsrs: FSRSRecord;
  state: ItemState;
}

export interface ReviewLog {
  id: string;
  itemId: string;
  itemType: ItemType;
  rating: ReviewRating;
  scheduledInterval: number;
  actualInterval: number;
  reviewDate: string;
  state: ItemState;
  /** Cards: the target retention used for this review (to replay it on another computer). */
  retention?: number;
}

export interface SaudadeStats {
  totalDocuments: number;
  totalExtracts: number;
  totalClozes: number;
  dueTodayCount: number;
  reviewsCompletedToday: number;
  averageRetention: number | null; // % of successful card recalls over 30 days; null without reviews
  streakDays: number;
}


export type ActiveTab = 'queue' | 'reader' | 'review' | 'library' | 'stats' | 'settings';
