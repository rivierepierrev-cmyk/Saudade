import assert from 'node:assert';
import { splitClozeNotes, cardsForNewNote, applyNoteText, noteKeyOf } from '../src/lib/clozeNotes';
import { buildTodayQueue } from '../src/lib/queue';

const now = new Date('2026-10-27T10:00:00');
const reviewed = { stability: 9, difficulty: 5, reps: 4, lapses: 0, interval: 9, nextReviewDate: new Date(now.getTime() - 86400000).toISOString(), phase: 'review' as const };
const base: any = { documentTitle: 'D', tags: [], priority: 50, createdAt: '', updatedAt: '', state: 'review' };

// Older card with two numbers -> two cards; the first keeps its schedule
const old = { ...base, id: 'k', text: '{{c1::Paris}} est une ville de {{c2::France}}', fsrs: reviewed };
const split = splitClozeNotes([old]);
assert.deepEqual(split.map((c) => [c.id, c.clozeNumber, c.noteId, c.fsrs.reps]), [['k', 1, 'k', 4], ['k-c2', 2, 'k', 0]]);
assert.equal(splitClozeNotes(split), split, 'already split: unchanged (same array)');

// New note: one card per number, the user's second example gives 2 cards
let n = 0; const makeId = () => `id${++n}`;
const fresh = cardsForNewNote({ ...base, text: '{{c1::Paris}} est une ville et {{c1::la capitale}} de {{c2::France}}', fsrs: reviewed }, makeId);
assert.deepEqual(fresh.map((c) => [c.id, c.clozeNumber, c.noteId, c.fsrs.reps]), [['id1', 1, 'id1', 0], ['id2', 2, 'id1', 0]]);

// Editing the note: text on every card, c3 added, c2 removed
const others = [{ ...base, id: 'other', text: 'x {{c1::y}}', clozeNumber: 1, noteId: 'other', fsrs: reviewed }];
const edited = applyNoteText([...fresh, ...others], 'id2', '{{c1::Paris}} est la capitale de la {{c3::France}}', makeId, 'T');
assert.deepEqual(edited.removed.map(([, c]) => c.id), ['id2']);
assert.deepEqual(edited.created.map((c) => [c.clozeNumber, c.noteId]), [[3, 'id1']]);
assert.deepEqual(edited.cards.filter((c) => noteKeyOf(c) === 'id1').map((c) => c.text), ['{{c1::Paris}} est la capitale de la {{c3::France}}', '{{c1::Paris}} est la capitale de la {{c3::France}}']);
assert.equal(edited.cards.find((c) => c.id === 'other')!.text, 'x {{c1::y}}', 'other notes untouched');

// Queue: siblings are not shown the same day
const due = (id: string, note: string, nb: number, priority: number) => ({ ...base, id, noteId: note, clozeNumber: nb, priority, text: 't', fsrs: reviewed });
const cards = [due('a1', 'A', 1, 90), due('a2', 'A', 2, 80), due('b1', 'B', 1, 70)];
let q = buildTodayQueue({ documents: [], extracts: [], clozes: cards, dailyLimit: 50, reviewedTodayIds: new Set(), now });
assert.deepEqual(q.map((e) => e.item.id), ['a1', 'b1'], 'a2 waits for another day');
q = buildTodayQueue({ documents: [], extracts: [], clozes: cards, dailyLimit: 50, reviewedTodayIds: new Set(['a1']), now });
assert.deepEqual(q.map((e) => e.item.id), ['a1', 'b1'], 'a1 reviewed today (learning step) keeps a2 out');
console.log('notes tests OK');

// A card is located by its original sentence first, then by its current one.
{
  const { cardPassages } = await import('../src/lib/clozeNotes');
  assert.deepEqual(cardPassages({ text: 'Le {{c1::Rhône}} finit dans la mer.', sourceText: 'Le Rhône se jette dans la mer.' }), [
    'Le Rhône se jette dans la mer.',
    'Le Rhône finit dans la mer.',
  ]);
  assert.deepEqual(cardPassages({ text: 'Le {{c1::Rhône}} coule.' }), ['Le Rhône coule.']);
  assert.deepEqual(cardPassages({ text: 'Le {{c1::Rhône}} coule.', sourceText: 'Le Rhône coule.' }), ['Le Rhône coule.']);
}
