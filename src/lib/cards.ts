/**
 * The two kinds of cards: cloze cards ({{c1::…}} in the text) and question/answer
 * cards (kind 'qa': question in `text`, answer in `answer`). Every screen shows a
 * card through these helpers.
 */
import { ClozeItem } from '../types/saudade';
import { clozeAnswerPreview, clozePreviewText, escapeHtml, renderClozeCard, renderTextWithMath } from './math';
import { mediaSrc } from './media';

type Card = Pick<ClozeItem, 'kind' | 'text' | 'answer' | 'clozeNumber' | 'image' | 'masks' | 'occlusionMode'>;

export const isQA = (card: Pick<ClozeItem, 'kind'>) => card.kind === 'qa';
export const isImageCard = (card: Pick<ClozeItem, 'kind'>) => card.kind === 'io';

/** "Question", "Image" or "Carte à trou". */
export const cardKindLabel = (card: Pick<ClozeItem, 'kind'>) =>
  isQA(card) ? 'Question' : isImageCard(card) ? 'Image' : 'Carte à trou';

const pct = (v: number) => `${(Math.min(1, Math.max(0, v)) * 100).toFixed(3)}%`;

/**
 * An image card: the image with its zones. The card's own zone is hidden (in the
 * accent colour) until revealed; the other zones stay hidden too ("all") or are
 * shown ("one").
 */
function renderImageCard(card: Card, revealed: boolean): string {
  const active = card.clozeNumber ?? 1;
  const masks = (card.masks ?? [])
    .filter((m) => m.n === active || card.occlusionMode !== 'one')
    .map((m) => {
      const cls = m.n !== active ? 'io-mask' : revealed ? 'io-mask io-revealed' : 'io-mask io-active';
      return `<div class="${cls}" style="left:${pct(m.x)};top:${pct(m.y)};width:${pct(m.w)};height:${pct(m.h)}"></div>`;
    })
    .join('');
  const prompt = card.text.trim() ? `<p class="io-prompt">${renderTextWithMath(card.text)}</p>` : '';
  return `${prompt}<div class="io-frame"><img src="${escapeHtml(mediaSrc(card.image ?? ''))}" alt="">${masks}</div>`;
}

/** HTML of a card: the question, then the answer once revealed. */
export function renderCard(card: Card, revealed: boolean): string {
  if (isImageCard(card)) return renderImageCard(card, revealed);
  if (!isQA(card)) return renderClozeCard(card.text, revealed, card.clozeNumber);
  const question = `<div class="qa-question">${renderTextWithMath(card.text)}</div>`;
  if (!revealed) return question;
  return `${question}<hr class="qa-separator"><div class="qa-answer">${renderTextWithMath(card.answer ?? '')}</div>`;
}

/** One-line text of a card, answer hidden (the reading queue). */
export const cardPreview = (card: Card) =>
  isImageCard(card)
    ? `${card.text.trim() || 'Image'} · zone ${card.clozeNumber ?? 1}`
    : isQA(card)
      ? card.text
      : clozePreviewText(card.text, card.clozeNumber);

/** One-line text of a card with its answer (lists in the library and the reader). */
export const cardAnswerPreview = (card: Card) =>
  isImageCard(card)
    ? cardPreview(card)
    : isQA(card)
      ? `${card.text} → ${card.answer ?? ''}`
      : clozeAnswerPreview(card.text, card.clozeNumber);
