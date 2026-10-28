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
  format: 'markdown' | 'article' | 'book' | 'pdf' | 'note';
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
  text: string; // e.g. "The {{c1::hippocampus}} is essential for memory consolidation."
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
