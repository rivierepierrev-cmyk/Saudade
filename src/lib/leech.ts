/**
 * Leeches: cards forgotten again and again (as in Anki and SuperMemo). They cost
 * many reviews and usually need rewording, splitting, or giving up.
 */
import { ClozeItem } from '../types/saudade';

export const DEFAULT_LEECH_THRESHOLD = 8;

/** A leech: flagged, or forgotten `threshold` times and never cleared. */
export const isLeech = (card: Pick<ClozeItem, 'leech' | 'fsrs'>, threshold: number) =>
  card.leech === true || (card.leech === undefined && card.fsrs.lapses >= threshold);

/**
 * After a lapse: does it make the card a leech? At the threshold, then again every
 * half threshold (8, 12, 16… by default), so a card cleared too soon comes back.
 */
export function lapseMakesLeech(lapses: number, threshold: number): boolean {
  if (lapses < threshold) return false;
  return (lapses - threshold) % Math.max(1, Math.ceil(threshold / 2)) === 0;
}
