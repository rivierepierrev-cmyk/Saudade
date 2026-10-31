import { daysBetween, type ISODate } from './dates.ts';
import type { Closure, ClosureKind } from './model.ts';

/** One line of the holidays window: a single day, or from one date to another. */
export interface ClosureRow {
  id: string;
  label: string;
  mode: 'day' | 'range';
  start: ISODate | '';
  /** Ignored for a single day. */
  end: ISODate | '';
  kind: ClosureKind;
}

export type RowError = 'missing-start' | 'missing-end' | 'end-before-start';

export const rowErrorText: Record<RowError, string> = {
  'missing-start': 'Choisissez une date.',
  'missing-end': 'Choisissez la date de fin.',
  'end-before-start': 'La fin est avant le début.',
};

let counter = 0;
export const newRowId = () => `row-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function emptyRow(mode: ClosureRow['mode'] = 'range'): ClosureRow {
  return { id: newRowId(), label: '', mode, start: '', end: '', kind: 'holiday' };
}

export function rowError(row: ClosureRow): RowError | undefined {
  if (!row.start) return 'missing-start';
  if (row.mode === 'day') return undefined;
  if (!row.end) return 'missing-end';
  if (row.end < row.start) return 'end-before-start';
  return undefined;
}

/** Number of days the row covers (weekends included), 0 while it is incomplete. */
export function rowDays(row: ClosureRow): number {
  if (rowError(row)) return 0;
  return row.mode === 'day' ? 1 : daysBetween(row.start, row.end) + 1;
}

/** Switching to « Un jour » keeps the start; switching back to a range starts as that same day. */
export function setMode(row: ClosureRow, mode: ClosureRow['mode']): ClosureRow {
  if (mode === row.mode) return row;
  return mode === 'day' ? { ...row, mode, end: '' } : { ...row, mode, end: row.end || row.start };
}

/** When the start moves past the end, the end follows, so a range never becomes invalid by accident. */
export function setStart(row: ClosureRow, start: ISODate | ''): ClosureRow {
  const end = row.mode === 'range' && start && (!row.end || row.end < start) ? start : row.end;
  return { ...row, start, end };
}

/** The valid rows as closures for the planning, in date order. Incomplete rows are left out. */
export function rowsToClosures(rows: ClosureRow[]): Closure[] {
  return rows
    .filter((r) => !rowError(r))
    .map((r) => ({
      start: r.start,
      end: r.mode === 'day' ? r.start : r.end,
      label: r.label.trim() || (r.kind === 'public-holiday' ? 'Jour férié' : r.mode === 'day' ? 'Jour sans cours' : 'Vacances'),
      kind: r.kind,
    }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

export function closuresToRows(closures: Closure[]): ClosureRow[] {
  return closures.map((c) => ({
    id: newRowId(),
    label: c.label,
    mode: c.start === c.end ? 'day' : 'range',
    start: c.start,
    end: c.start === c.end ? '' : c.end,
    kind: c.kind,
  }));
}

/** Rows sorted by start date; incomplete rows stay at the end, in the order they were added. */
export function sortRows(rows: ClosureRow[]): ClosureRow[] {
  const dated = rows.filter((r) => r.start).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return [...dated, ...rows.filter((r) => !r.start)];
}
