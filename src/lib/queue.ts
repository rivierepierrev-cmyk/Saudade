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
  /** Maximum number of documents and extracts per day (the most important first). */
  topicLimit?: number;
  /** Cards already reviewed today: they come back (learning steps) without using the limit. */
  reviewedTodayIds: Set<string>;
  now?: Date;
}

/**
 * Everything to do today, in queue order (highest priority first, then the
 * longest overdue). Cards not yet seen today are capped by the daily limit.
 */
export function buildTodayQueue({ documents, extracts, clozes, dailyLimit, topicLimit = Infinity, reviewedTodayIds, now = new Date() }: QueueInput): QueueEntry[] {

  let budget = Math.max(0, dailyLimit - reviewedTodayIds.size);
  // Like Anki: two cards of the same note are not shown the same day (the second
  // would be answered from what the first just showed). They stay due.
  const busyNotes = new Set(clozes.filter((c) => reviewedTodayIds.has(c.id)).map(noteKeyOf));
  const cards = due(clozes, now)
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
    ...dueTopics(documents, extracts, now).slice(0, Math.max(0, topicLimit)),
    ...cards.map((item) => ({ type: 'cloze' as const, item })),
  ];
  return entries.sort((a, b) => order(a.item, b.item));
}

const due = <T extends { state: string; fsrs: FSRSRecord }>(list: T[], now: Date) =>
  list.filter((i) => i.state !== 'dismissed' && isDueToday(i.fsrs, now));
// Highest priority first, then the one waiting the longest.
const order = (a: { priority: number; fsrs: FSRSRecord }, b: { priority: number; fsrs: FSRSRecord }) =>
  b.priority - a.priority || new Date(a.fsrs.nextReviewDate).getTime() - new Date(b.fsrs.nextReviewDate).getTime();

/** Documents and extracts due today, most important first. */
function dueTopics(documents: DocumentItem[], extracts: ExtractItem[], now: Date): QueueEntry[] {
  return [
    ...due(documents, now).map((item) => ({ type: 'document' as const, item })),
    ...due(extracts, now).map((item) => ({ type: 'extract' as const, item })),
  ].sort((a, b) => order(a.item, b.item));
}

/** Documents and extracts due today beyond the daily limit (the least important). */
export function topicSurplus(
  documents: DocumentItem[],
  extracts: ExtractItem[],
  topicLimit: number,
  now: Date = new Date()
): Array<{ type: 'document'; item: DocumentItem } | { type: 'extract'; item: ExtractItem }> {
  return dueTopics(documents, extracts, now).slice(Math.max(0, topicLimit)) as Array<
    { type: 'document'; item: DocumentItem } | { type: 'extract'; item: ExtractItem }
  >;
}

/** Cards due today left out by the daily card limit (or waiting for a sibling's day). */
export function cardBacklog(clozes: ClozeItem[], queue: QueueEntry[], now: Date = new Date()): number {
  const inQueue = new Set(queue.filter((e) => e.type === 'cloze').map((e) => e.item.id));
  return due(clozes, now).filter((c) => !inQueue.has(c.id)).length;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Days a document or extract is put off when the day is full: 1 at the highest
 * priority, up to half its interval (at most 15 days) at the lowest.
 */
export function postponeDays(priority: number, interval: number): number {
  const p = Math.min(100, Math.max(0, Number.isFinite(priority) ? priority : 50));
  return 1 + Math.round(((100 - p) / 100) * Math.min(Math.max(interval, 1), 30) / 2);
}

/** Schedule of a postponed document or extract: a later day, and an interval at least that long. */
export function postponeTopic(fsrs: FSRSRecord, priority: number, now: Date = new Date()): FSRSRecord {
  const days = postponeDays(priority, fsrs.interval);
  const next = startOfDay(now);
  next.setDate(next.getDate() + days);
  return { ...fsrs, nextReviewDate: next.toISOString(), interval: Math.max(fsrs.interval, days) };
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
