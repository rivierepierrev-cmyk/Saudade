import { minutes } from './dates.ts';

export interface Placed<T> {
  item: T;
  /** 0-based column among the lessons it overlaps with, and how many columns that group has. */
  col: number;
  cols: number;
}

/**
 * Side-by-side layout of the lessons of one day: lessons at the same time (A and B weeks, or a clash)
 * share the width; the others take all of it.
 */
export function layoutDay<T extends { start: string; end: string }>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(b.end) - minutes(a.end));
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -1;
  let colEnds: number[] = [];
  const close = () => {
    for (const p of group) p.cols = colEnds.length;
    group = [];
    colEnds = [];
  };
  for (const item of sorted) {
    const start = minutes(item.start);
    if (start >= groupEnd) close();
    let col = colEnds.findIndex((end) => end <= start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = minutes(item.end);
    const placed = { item, col, cols: 1 };
    group.push(placed);
    out.push(placed);
    groupEnd = Math.max(start >= groupEnd ? 0 : groupEnd, minutes(item.end));
  }
  close();
  return out;
}
