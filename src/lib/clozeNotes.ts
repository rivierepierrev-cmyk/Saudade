/**
 * Cloze notes: a text with deletions {{c1::…}} {{c2::…}} gives one card per number.
 * The cards of a note share its text (editing one edits the note) and the note id;
 * each card has its own schedule.
 */
import { ClozeItem } from '../types/saudade';
import { clozeNumbers, parseClozes } from './math';
import { createInitialFSRSRecord } from './fsrs';

export const noteKeyOf = (card: ClozeItem) => card.noteId ?? card.id;

/** The card numbers of a note: deletion numbers, or zone numbers of an image. */
export function noteNumbers(note: Pick<ClozeItem, 'kind' | 'text' | 'masks'>): number[] {
  if (note.kind === 'io') return [...new Set((note.masks ?? []).map((m) => m.n))].sort((a, b) => a - b);
  return clozeNumbers(note.text);
}

/**
 * Cards from older versions showed every deletion at once. Each one becomes one card
 * per number: the existing card keeps its schedule and history for its first number,
 * the other numbers become new cards. Returns the same array when nothing changes.
 */
export function splitClozeNotes(cards: ClozeItem[]): ClozeItem[] {
  // Question/answer cards have no deletion number.
  if (cards.every((c) => c.clozeNumber !== undefined || c.kind === 'qa')) return cards;
  const out: ClozeItem[] = [];
  for (const card of cards) {
    if (card.clozeNumber !== undefined || card.kind === 'qa') {
      out.push(card);
      continue;
    }
    const [first = 1, ...others] = clozeNumbers(card.text);
    out.push({ ...card, clozeNumber: first, noteId: noteKeyOf(card) });
    for (const n of others) {
      out.push({
        ...card,
        id: `${card.id}-c${n}`,
        clozeNumber: n,
        noteId: noteKeyOf(card),
        fsrs: createInitialFSRSRecord(0),
        state: card.state === 'dismissed' ? 'dismissed' : 'new',
      });
    }
  }
  return out;
}

/** New cards for a new note: one per deletion number. */
/** What to look for in the source to find a card: its original sentence, then its current one. */
export function cardPassages(card: Pick<ClozeItem, 'text' | 'sourceText' | 'kind'>): string[] {
  // A question is written by hand: only the passage it was made from is in the text.
  if (card.kind === 'qa') return card.sourceText ? [card.sourceText] : [];
  if (card.kind === 'io') return [];
  const current = parseClozes(card.text).map((p) => p.value).join('');
  return card.sourceText && card.sourceText !== current ? [card.sourceText, current] : [current];
}

export function cardsForNewNote(template: Omit<ClozeItem, 'id' | 'clozeNumber' | 'noteId'>, makeId: () => string): ClozeItem[] {
  const numbers = noteNumbers(template);
  const ids = (numbers.length ? numbers : [1]).map(() => makeId());
  return (numbers.length ? numbers : [1]).map((n, i) => ({
    ...template,
    id: ids[i],
    clozeNumber: n,
    noteId: ids[0],
    fsrs: createInitialFSRSRecord(0),
  }));
}

/**
 * New text for the note of `cardId`: every card of the note gets it; a new deletion
 * number creates a card, a number that disappears removes its card.
 */
export function applyNoteText(
  cards: ClozeItem[],
  cardId: string,
  text: string,
  makeId: () => string,
  now: string
): { cards: ClozeItem[]; created: ClozeItem[]; removed: Array<[number, ClozeItem]> } {
  return applyNote(cards, cardId, { text }, makeId, now);
}

/**
 * New content for the note of `cardId` (text, or image zones…): every card of the note
 * gets it; a new number creates a card, a number that disappears removes its card.
 */
export function applyNote(
  cards: ClozeItem[],
  cardId: string,
  patch: Partial<Pick<ClozeItem, 'text' | 'image' | 'masks' | 'occlusionMode'>>,
  makeId: () => string,
  now: string
): { cards: ClozeItem[]; created: ClozeItem[]; removed: Array<[number, ClozeItem]> } {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return { cards, created: [], removed: [] };
  const key = noteKeyOf(card);
  const numbers = new Set(noteNumbers({ ...card, ...patch }));
  const same = (c: ClozeItem) => (Object.keys(patch) as Array<keyof typeof patch>).every((k) => JSON.stringify(c[k]) === JSON.stringify(patch[k]));
  const removed: Array<[number, ClozeItem]> = [];
  const kept: ClozeItem[] = [];
  cards.forEach((c, index) => {
    if (noteKeyOf(c) !== key) {
      kept.push(c);
    } else if (numbers.has(c.clozeNumber ?? 1)) {
      kept.push(same(c) ? c : { ...c, ...patch, updatedAt: now });
    } else {
      removed.push([index, c]);
    }
  });
  const existing = new Set(cards.filter((c) => noteKeyOf(c) === key).map((c) => c.clozeNumber ?? 1));
  const created: ClozeItem[] = [...numbers]
    .filter((n) => !existing.has(n))
    .map((n) => ({
      ...card,
      ...patch,
      id: makeId(),
      clozeNumber: n,
      noteId: key,
      fsrs: createInitialFSRSRecord(0),
      state: 'new',
      leech: undefined,
      createdAt: now,
      updatedAt: now,
    }));
  // New cards go right after the edited one.
  const at = kept.findIndex((c) => c.id === cardId);
  const next = [...kept];
  next.splice(at >= 0 ? at + 1 : next.length, 0, ...created);
  return { cards: next, created, removed };
}
