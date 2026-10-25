/**
 * Free Spaced Repetition Scheduler (FSRS) Core Engine
 * Standard FSRS-4.5 implementation for spaced repetition interval calculation.
 */

import { FSRSRecord, ReviewRating } from '../types/foliole';

// Standard FSRS-4.5 optimized weights
const DEFAULT_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898,
];

const DESIRED_RETENTION = 0.90; // Standard 90% target retention rate

export interface SchedulePrediction {
  rating: ReviewRating;
  ratingLabel: 'À revoir' | 'Difficile' | 'Bon' | 'Facile';
  interval: number; // in days
  intervalDisplay: string;
  nextReviewDate: string; // ISO
  stability: number;
  difficulty: number;
}

/**
 * Formate un nombre de jours en libellé lisible en français
 */
export function formatInterval(days: number): string {
  if (days <= 0) return 'Immédiat';
  if (days < 1) return `${Math.round(days * 24 * 60)} min`;
  if (days === 1) return '1 j';
  if (days < 30) return `${Math.round(days)} j`;
  if (days < 365) {
    const months = (days / 30.4).toFixed(1).replace('.0', '');
    return `${months} mois`;
  }
  const years = (days / 365).toFixed(1).replace('.0', '');
  return `${years} an${parseFloat(years) > 1 ? 's' : ''}`;
}

/**
 * Creates default FSRS record for brand new items
 */
export function createInitialFSRSRecord(initialIntervalDays: number = 0): FSRSRecord {
  const now = new Date();
  const nextReview = new Date(now.getTime() + initialIntervalDays * 86400000);

  return {
    stability: 2.0,
    difficulty: 5.0,
    reps: 0,
    lapses: 0,
    interval: initialIntervalDays,
    nextReviewDate: nextReview.toISOString(),
    lastReview: undefined,
  };
}

/**
 * Calculate Retrievability R given elapsed days and stability S
 */
export function calculateRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + elapsedDays / (9 * stability), -1);
}

/**
 * Predict next intervals for all 4 ratings (Again, Hard, Good, Easy)
 */
export function predictAllRatings(
  currentRecord: FSRSRecord,
  desiredRetention: number = DESIRED_RETENTION
): Record<ReviewRating, SchedulePrediction> {
  return {
    1: calculateNextFSRS(currentRecord, 1, new Date(), desiredRetention),
    2: calculateNextFSRS(currentRecord, 2, new Date(), desiredRetention),
    3: calculateNextFSRS(currentRecord, 3, new Date(), desiredRetention),
    4: calculateNextFSRS(currentRecord, 4, new Date(), desiredRetention),
  };
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
  const w = DEFAULT_WEIGHTS;
  const ratingIndex = rating - 1;

  let newStability: number;
  let newDifficulty: number;
  let newReps = record.reps + 1;
  let newLapses = record.lapses + (rating === 1 ? 1 : 0);

  // If first review
  if (record.reps === 0) {
    newStability = Math.max(0.1, w[ratingIndex]);
    newDifficulty = Math.min(10, Math.max(1, w[4] - Math.exp(w[5] * (rating - 1)) + 1));
  } else {
    // Elapsed time calculation
    const lastDate = record.lastReview ? new Date(record.lastReview) : new Date(record.nextReviewDate);
    const elapsedDays = Math.max(0, (reviewDate.getTime() - lastDate.getTime()) / 86400000);
    const r = calculateRetrievability(elapsedDays, record.stability);

    // Update Difficulty
    const deltaD = -w[6] * (rating - 3);
    const meanReversionD = w[7] * (w[4] - Math.exp(w[5] * 2) + 1) + (1 - w[7]) * (record.difficulty + deltaD);
    newDifficulty = Math.min(10, Math.max(1, meanReversionD));

    // Update Stability
    if (rating === 1) {
      // Lapse (Again)
      newStability = Math.max(
        0.1,
        w[11] *
          Math.pow(newDifficulty, -w[12]) *
          (Math.pow(record.stability + 1, w[13]) - 1) *
          Math.exp(w[14] * (1 - r))
      );
    } else {
      // Successful recall
      const hardPenalty = rating === 2 ? w[15] : 1;
      const easyBonus = rating === 4 ? w[16] : 1;

      newStability = Math.max(
        0.1,
        record.stability *
          (1 +
            Math.exp(w[8]) *
              (11 - newDifficulty) *
              Math.pow(record.stability, -w[9]) *
              (Math.exp(w[10] * (1 - r)) - 1) *
              hardPenalty *
              easyBonus)
      );
    }
  }

  // Calculate Interval based on desired retention (customizable, safe bounded between 0.70 and 0.98)
  // Formula: I = (9 * S) * (1/R - 1)
  const safeRetention = Math.min(0.98, Math.max(0.70, desiredRetention));
  const factor = 9 * (1 / safeRetention - 1);
  let interval = Math.max(1, Math.round(newStability * factor));

  // Rating 1 is scheduled for immediate / 1 day review
  if (rating === 1) {
    interval = 1;
  } else if (rating === 2 && interval < 2) {
    interval = Math.max(1, Math.round(record.interval * 1.2));
  }

  const nextReviewDate = new Date(reviewDate.getTime() + interval * 86400000).toISOString();

  const ratingLabels: Record<ReviewRating, 'À revoir' | 'Difficile' | 'Bon' | 'Facile'> = {
    1: 'À revoir',
    2: 'Difficile',
    3: 'Bon',
    4: 'Facile',
  };

  return {
    rating,
    ratingLabel: ratingLabels[rating],
    interval,
    intervalDisplay: formatInterval(interval),
    nextReviewDate,
    stability: Number(newStability.toFixed(2)),
    difficulty: Number(newDifficulty.toFixed(2)),
  };
}
