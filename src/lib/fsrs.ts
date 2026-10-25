/**
 * Scheduling.
 * - Cloze cards (memory): FSRS-6 via the ts-fsrs library, with short-term learning
 *   steps (e.g. "À revoir" brings a card back after a few minutes).
 * - Documents and extracts (reading material, "topics"): no memory model. Each time
 *   you finish a reading session the interval grows by a factor that depends on the
 *   priority: high-priority material comes back often, low-priority material drifts away.
 */

import { fsrs, generatorParameters, createEmptyCard, Card, State, Grade, FSRS } from 'ts-fsrs';
import { FSRSRecord, ReviewRating, CardPhase } from '../types/gemma';

const DAY_MS = 86400000;
const DESIRED_RETENTION = 0.9;

export interface SchedulePrediction {
  rating: ReviewRating;
  ratingLabel: 'À revoir' | 'Difficile' | 'Bon' | 'Facile';
  interval: number; // in days (fractional during learning steps)
  intervalDisplay: string;
  nextReviewDate: string; // ISO
  stability: number;
  difficulty: number;
  phase: CardPhase;
  learningSteps: number;
}

const RATING_LABELS: Record<ReviewRating, SchedulePrediction['ratingLabel']> = {
  1: 'À revoir',
  2: 'Difficile',
  3: 'Bon',
  4: 'Facile',
};

const PHASE_TO_STATE: Record<CardPhase, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const STATE_TO_PHASE: Record<State, CardPhase> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

/**
 * Formate un nombre de jours en libellé lisible en français
 */
export function formatInterval(days: number): string {
  if (days <= 0) return 'Immédiat';
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))} min`;
  if (days < 1) return `${Math.round(days * 24)} h`;
  if (days < 1.5) return '1 j';
  if (days < 30) return `${Math.round(days)} j`;
  if (days < 365) {
    const months = (days / 30.4).toFixed(1).replace('.0', '');
    return `${months} mois`;
  }
  const years = (days / 365).toFixed(1).replace('.0', '');
  return `${years} an${parseFloat(years) > 1 ? 's' : ''}`;
}

/**
 * Creates the scheduling record of a brand new item, due after `initialIntervalDays`.
 */
export function createInitialFSRSRecord(initialIntervalDays: number = 0): FSRSRecord {
  const nextReview = new Date(Date.now() + initialIntervalDays * DAY_MS);
  return {
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    interval: initialIntervalDays,
    nextReviewDate: nextReview.toISOString(),
    lastReview: undefined,
    phase: 'new',
    learningSteps: 0,
  };
}

// ---- Cards (FSRS) ------------------------------------------------------------

const schedulers = new Map<number, FSRS>();
function scheduler(desiredRetention: number): FSRS {
  const retention = Math.min(0.98, Math.max(0.7, desiredRetention));
  let f = schedulers.get(retention);
  if (!f) {
    f = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true, enable_short_term: true }));
    schedulers.set(retention, f);
  }
  return f;
}

/** Converts a stored record to a ts-fsrs card. Records from older versions have no phase. */
function toCard(record: FSRSRecord, now: Date): Card {
  if (record.reps === 0 || record.phase === 'new') return createEmptyCard(now);
  const lastReview = record.lastReview ? new Date(record.lastReview) : new Date(record.nextReviewDate);
  return {
    due: new Date(record.nextReviewDate),
    stability: Math.max(0.1, record.stability),
    difficulty: Math.min(10, Math.max(1, record.difficulty)),
    elapsed_days: 0,
    scheduled_days: Math.max(0, Math.round(record.interval)),
    reps: record.reps,
    lapses: record.lapses,
    learning_steps: record.learningSteps ?? 0,
    state: PHASE_TO_STATE[record.phase ?? 'review'],
    last_review: lastReview,
  };
}

function toPrediction(card: Card, rating: ReviewRating, now: Date): SchedulePrediction {
  const interval = Math.max(0, (card.due.getTime() - now.getTime()) / DAY_MS);
  return {
    rating,
    ratingLabel: RATING_LABELS[rating],
    interval,
    intervalDisplay: formatInterval(interval),
    nextReviewDate: card.due.toISOString(),
    stability: Number(card.stability.toFixed(2)),
    difficulty: Number(card.difficulty.toFixed(2)),
    phase: STATE_TO_PHASE[card.state],
    learningSteps: card.learning_steps,
  };
}

/**
 * Predict next intervals for all 4 ratings (Again, Hard, Good, Easy)
 */
export function predictAllRatings(
  currentRecord: FSRSRecord,
  desiredRetention: number = DESIRED_RETENTION,
  now: Date = new Date()
): Record<ReviewRating, SchedulePrediction> {
  const preview = scheduler(desiredRetention).repeat(toCard(currentRecord, now), now);
  const result = {} as Record<ReviewRating, SchedulePrediction>;
  for (const rating of [1, 2, 3, 4] as ReviewRating[]) {
    result[rating] = toPrediction(preview[rating as Grade].card, rating, now);
  }
  return result;
}

/**
 * Calculate new FSRS state after a review rating
 */
export function calculateNextFSRS(
  record: FSRSRecord,
  rating: ReviewRating,
  reviewDate: Date = new Date(),
  desiredRetention: number = DESIRED_RETENTION
): SchedulePrediction {
  const { card } = scheduler(desiredRetention).next(toCard(record, reviewDate), reviewDate, rating as Grade);
  return toPrediction(card, rating, reviewDate);
}

/** New scheduling record after a card review. */
export function applyCardReview(
  record: FSRSRecord,
  rating: ReviewRating,
  now: Date,
  desiredRetention: number
): FSRSRecord {
  const p = calculateNextFSRS(record, rating, now, desiredRetention);
  return {
    stability: p.stability,
    difficulty: p.difficulty,
    reps: record.reps + 1,
    lapses: record.lapses + (rating === 1 && record.reps > 0 ? 1 : 0),
    lastReview: now.toISOString(),
    nextReviewDate: p.nextReviewDate,
    interval: p.interval,
    phase: p.phase,
    learningSteps: p.learningSteps,
  };
}

// ---- Topics (documents and extracts) ---------------------------------------

const clampPriority = (p: number) => Math.min(100, Math.max(0, Number.isFinite(p) ? p : 50));

/** Growth factor of the reading interval: 1.2 at priority 100, 3.0 at priority 0. */
export function topicGrowthFactor(priority: number): number {
  return 1.2 + (1 - clampPriority(priority) / 100) * 1.8;
}

/** First reading interval: 1 day at priority 100, up to 7 days at priority 0. */
export function firstTopicInterval(priority: number): number {
  return Math.max(1, Math.round(1 + ((100 - clampPriority(priority)) / 100) * 6));
}

export function nextTopicInterval(record: FSRSRecord, priority: number): number {
  if (record.reps === 0 || record.interval < 1) return firstTopicInterval(priority);
  return Math.max(Math.round(record.interval) + 1, Math.round(record.interval * topicGrowthFactor(priority)));
}

/** New scheduling record after a reading session of a document or extract ("Suivant"). */
export function applyTopicReview(record: FSRSRecord, priority: number, now: Date): FSRSRecord {
  const interval = nextTopicInterval(record, priority);
  return {
    ...record,
    reps: record.reps + 1,
    interval,
    lastReview: now.toISOString(),
    nextReviewDate: new Date(now.getTime() + interval * DAY_MS).toISOString(),
  };
}
