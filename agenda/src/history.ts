/** Undo / redo over successive versions of a value. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** When the present was recorded, and what was being typed in (to group keystrokes). */
  at: number;
  key?: string;
}

export const LIMIT = 100;
/** Changes typed in the same field less than this apart count as one. */
export const GROUP_MS = 1500;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], at: 0 });

/**
 * Records a new version. With a `key` (the text field being typed in), changes in the same field close
 * together replace the present instead of adding a step, so one undo removes a word, not a letter.
 */
export function record<T>(h: History<T>, next: T, now: number, key?: string): History<T> {
  if (next === h.present) return h;
  if (key && key === h.key && now - h.at < GROUP_MS) return { ...h, present: next, future: [], at: now };
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [], at: now, key };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], at: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), at: 0 };
}
