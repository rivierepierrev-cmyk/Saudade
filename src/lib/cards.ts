/**
 * The two kinds of cards: cloze cards ({{c1::…}} in the text) and question/answer
 * cards (kind 'qa': question in `text`, answer in `answer`). Every screen shows a
 * card through these helpers.
 */
import { ClozeItem } from '../types/saudade';
import { clozeAnswerPreview, clozePreviewText, renderClozeCard, renderTextWithMath } from './math';

type Card = Pick<ClozeItem, 'kind' | 'text' | 'answer' | 'clozeNumber'>;

export const isQA = (card: Pick<ClozeItem, 'kind'>) => card.kind === 'qa';

/** "Question" or "Carte à trou". */
export const cardKindLabel = (card: Pick<ClozeItem, 'kind'>) => (isQA(card) ? 'Question' : 'Carte à trou');

/** HTML of a card: the question, then the answer once revealed. */
export function renderCard(card: Card, revealed: boolean): string {
  if (!isQA(card)) return renderClozeCard(card.text, revealed, card.clozeNumber);
  const question = `<div class="qa-question">${renderTextWithMath(card.text)}</div>`;
  if (!revealed) return question;
  return `${question}<hr class="qa-separator"><div class="qa-answer">${renderTextWithMath(card.answer ?? '')}</div>`;
}

/** One-line text of a card, answer hidden (the reading queue). */
export const cardPreview = (card: Card) => (isQA(card) ? card.text : clozePreviewText(card.text, card.clozeNumber));

/** One-line text of a card with its answer (lists in the library and the reader). */
export const cardAnswerPreview = (card: Card) =>
  isQA(card) ? `${card.text} → ${card.answer ?? ''}` : clozeAnswerPreview(card.text, card.clozeNumber);
