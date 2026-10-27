/**
 * Today's queue: the single definition used by the reading queue, the review
 * session, the badge in the top bar and the reader's "next document".
 */
import { DocumentItem, ExtractItem, ClozeItem, FSRSRecord } from '../types/saudade';
import { noteKeyOf } from './clozeNotes';

export type QueueEntry =
  | { type: 'document'; item: DocumentItem }
  | { type: 'extract'; item: ExtractItem }
  | { type: 'cloze'; item: ClozeItem };

export function endOfToday(now: Date = new Date()): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function isDueToday(fsrs: FSRSRecord, now: Date = new Date()): boolean {
  return new Date(fsrs.nextReviewDate) <= endOfToday(now);
}

interface QueueInput {
  documents: DocumentItem[];
  extracts: ExtractItem[];
  clozes: ClozeItem[];
  /** Maximum number of different cards per day. */
  dailyLimit: number;
  /** Cards already reviewed today: they come back (learning steps) without using the limit. */
  reviewedTodayIds: Set<string>;
  now?: Date;
}

/**
 * Everything to do today, in queue order (highest priority first, then the
 * longest overdue). Cards not yet seen today are capped by the daily limit.
 */
export function buildTodayQueue({ documents, extracts, clozes, dailyLimit, reviewedTodayIds, now = new Date() }: QueueInput): QueueEntry[] {
  const due = <T extends { state: string; fsrs: FSRSRecord }>(list: T[]) =>
    list.filter((i) => i.state !== 'dismissed' && isDueToday(i.fsrs, now));
  const order = (a: { priority: number; fsrs: FSRSRecord }, b: { priority: number; fsrs: FSRSRecord }) =>
    b.priority - a.priority || new Date(a.fsrs.nextReviewDate).getTime() - new Date(b.fsrs.nextReviewDate).getTime();

  let budget = Math.max(0, dailyLimit - reviewedTodayIds.size);
  // Like Anki: two cards of the same note are not shown the same day (the second
  // would be answered from what the first just showed). They stay due.
  const busyNotes = new Set(clozes.filter((c) => reviewedTodayIds.has(c.id)).map(noteKeyOf));
  const cards = due(clozes)
    .sort(order)
    .filter((c) => {
      if (reviewedTodayIds.has(c.id)) return true;
      if (busyNotes.has(noteKeyOf(c))) return false;
      if (budget <= 0) return false;
      budget--;
      busyNotes.add(noteKeyOf(c));
      return true;
    });

  const entries: QueueEntry[] = [
    ...due(documents).map((item) => ({ type: 'document' as const, item })),
    ...due(extracts).map((item) => ({ type: 'extract' as const, item })),
    ...cards.map((item) => ({ type: 'cloze' as const, item })),
  ];
  return entries.sort((a, b) => order(a.item, b.item));
}

/** Date of the next item after today, for the empty queue message. */
export function nextAfterToday(lists: Array<Array<{ state: string; fsrs: FSRSRecord }>>, now: Date = new Date()): Date | null {
  const end = endOfToday(now).getTime();
  let next: number | null = null;
  for (const list of lists) {
    for (const i of list) {
      if (i.state === 'dismissed') continue;
      const t = new Date(i.fsrs.nextReviewDate).getTime();
      if (t > end && (next === null || t < next)) next = t;
    }
  }
  return next === null ? null : new Date(next);
}
