// Both kinds of cards through the same helpers (src/lib/cards.ts).
import assert from 'node:assert';
import { cardAnswerPreview, cardKindLabel, cardPreview, isQA, renderCard } from '../src/lib/cards';
import { applyNote, cardPassages, cardsForNewNote, noteNumbers, splitClozeNotes } from '../src/lib/clozeNotes';
import { isLeech, lapseMakesLeech } from '../src/lib/leech';

const qa = { kind: 'qa' as const, text: 'Que produit la mitochondrie ?', answer: "l'ATP ($C_{10}H_{16}$)" };
const cloze: { kind?: 'qa'; text: string; clozeNumber: number } = { text: 'Le {{c1::Rhône}} va à la {{c2::mer}}.', clozeNumber: 1 };
assert.ok(isQA(qa) && !isQA(cloze));
assert.equal(cardKindLabel(qa), 'Question'); assert.equal(cardKindLabel(cloze), 'Carte à trou');
assert.equal(cardPreview(qa), 'Que produit la mitochondrie ?', 'answer hidden');
assert.equal(cardPreview(cloze), 'Le […] va à la mer.');
assert.equal(cardAnswerPreview(qa), "Que produit la mitochondrie ? → l'ATP ($C_{10}H_{16}$)");
const hidden = renderCard(qa, false);
assert.ok(hidden.includes('mitochondrie') && !hidden.includes('ATP'), 'question only');
const shown = renderCard(qa, true);
assert.ok(shown.includes('qa-answer') && shown.includes('ATP') && shown.includes('katex'), 'answer with its formula');
assert.ok(renderCard(cloze, false).includes('cloze-blank'));
// A question is found in the text by the passage it was made from, never by its own words
assert.deepEqual(cardPassages({ ...qa, sourceText: "produit l'ATP de la cellule" }), ["produit l'ATP de la cellule"]);
assert.deepEqual(cardPassages(qa), []);
// Questions are never split like older multi-number cloze cards
const base = { tags: [], createdAt: '', updatedAt: '', priority: 50, state: 'new' as const, fsrs: { stability: 0, difficulty: 0, reps: 0, lapses: 0, interval: 0, nextReviewDate: '' } };
const stored = [{ ...base, id: 'q', ...qa }];
assert.equal(splitClozeNotes(stored), stored, 'untouched');
// Image cards: one card per zone number; the card's zone hidden, the others too ("all") or not ("one")
const zones = [{ x: 0.1, y: 0.1, w: 0.2, h: 0.1, n: 1 }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, n: 2 }, { x: 0.7, y: 0.1, w: 0.1, h: 0.1, n: 2 }];
const io = { kind: 'io' as const, text: 'Nommez la zone', image: '/media/' + 'a'.repeat(32) + '.png', masks: zones, occlusionMode: 'all' as const };
assert.deepEqual(noteNumbers(io), [1, 2]);
let n = 0;
const ioCards = cardsForNewNote({ ...base, ...io }, () => 'io' + ++n);
assert.deepEqual(ioCards.map((c) => [c.id, c.clozeNumber, c.noteId]), [['io1', 1, 'io1'], ['io2', 2, 'io1']]);
assert.equal(cardKindLabel(io), 'Image');
const c2 = { ...io, clozeNumber: 2 };
const front = renderCard(c2, false);
assert.equal((front.match(/io-mask/g) ?? []).length, 3, 'all zones hidden');
assert.equal((front.match(/io-active/g) ?? []).length, 2, 'card 2 has two zones');
assert.ok(front.includes('left:50.000%;top:50.000%;width:20.000%;height:20.000%'));
const back = renderCard(c2, true);
assert.equal((back.match(/io-revealed/g) ?? []).length, 2); assert.ok(!back.includes('io-active'));
assert.equal((renderCard({ ...c2, occlusionMode: 'one' }, false).match(/io-mask/g) ?? []).length, 2, 'only its zones');
assert.ok(front.includes('Nommez la zone') && front.includes('<img src="/media/'));
assert.equal(cardPreview(c2), 'Nommez la zone · zone 2');
assert.deepEqual(cardPassages(io), []);
// Editing the zones: zone 3 added (new card), zone 2 removed (its card removed), card 1 keeps its schedule
const edited = applyNote(ioCards, 'io1', { masks: [zones[0], { x: 0.3, y: 0.3, w: 0.1, h: 0.1, n: 3 }] }, () => 'io3', 'T');
assert.deepEqual(edited.cards.map((c) => [c.id, c.clozeNumber]), [['io1', 1], ['io3', 3]]);
assert.deepEqual(edited.removed.map(([, c]) => c.id), ['io2']);
assert.ok(edited.cards.every((c) => c.masks!.length === 2));

// Leeches: at 8 lapses, then again every 4 (a card cleared too soon comes back)
assert.deepEqual([7, 8, 9, 11, 12, 16].map((l) => lapseMakesLeech(l, 8)), [false, true, false, false, true, true]);
const lapsed = (lapses: number, leech?: boolean) => ({ leech, fsrs: { ...base.fsrs, lapses } });
assert.equal(isLeech(lapsed(8), 8), true, 'cards from before count too');
assert.equal(isLeech(lapsed(9, false), 8), false, 'cleared by hand');
assert.equal(isLeech(lapsed(2, true), 8), true);
assert.equal(isLeech(lapsed(7), 8), false);

console.log('cards tests OK');
