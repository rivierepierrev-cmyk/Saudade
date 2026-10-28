// Both kinds of cards through the same helpers (src/lib/cards.ts).
import assert from 'node:assert';
import { cardAnswerPreview, cardKindLabel, cardPreview, isQA, renderCard } from '../src/lib/cards';
import { cardPassages, splitClozeNotes } from '../src/lib/clozeNotes';

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
console.log('cards tests OK');
