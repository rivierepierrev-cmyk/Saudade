import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closuresToRows, emptyRow, rowDays, rowError, rowsToClosures, setMode, setStart, sortRows, type ClosureRow } from '../src/closureRows.ts';

const row = (over: Partial<ClosureRow>): ClosureRow => ({ ...emptyRow(), ...over });

test('a line is either one day or from one date to another', () => {
  assert.equal(rowError(row({ mode: 'day', start: '' })), 'missing-start');
  assert.equal(rowError(row({ mode: 'day', start: '2025-11-11' })), undefined);
  assert.equal(rowError(row({ mode: 'range', start: '2025-10-18', end: '' })), 'missing-end');
  assert.equal(rowError(row({ mode: 'range', start: '2025-10-18', end: '2025-10-17' })), 'end-before-start');
  assert.equal(rowError(row({ mode: 'range', start: '2025-10-18', end: '2025-11-02' })), undefined);
  assert.equal(rowDays(row({ mode: 'range', start: '2025-10-18', end: '2025-11-02' })), 16);
  assert.equal(rowDays(row({ mode: 'day', start: '2025-11-11', end: '2025-12-01' })), 1, 'the end of a single day is ignored');
  assert.equal(rowDays(row({ mode: 'range', start: '2025-10-18' })), 0);
});

test('switching between one day and two dates keeps what was typed', () => {
  const r = row({ mode: 'range', start: '2025-10-18', end: '2025-11-02' });
  const day = setMode(r, 'day');
  assert.deepEqual([day.mode, day.start, day.end], ['day', '2025-10-18', '']);
  const back = setMode(day, 'range');
  assert.deepEqual([back.start, back.end], ['2025-10-18', '2025-10-18']);
  assert.equal(setMode(r, 'range'), r);
});

test('moving the start after the end moves the end too', () => {
  const r = row({ mode: 'range', start: '2025-10-18', end: '2025-11-02' });
  assert.equal(setStart(r, '2025-10-20').end, '2025-11-02');
  assert.equal(setStart(r, '2025-11-05').end, '2025-11-05');
  assert.equal(setStart(row({ mode: 'range' }), '2025-12-20').end, '2025-12-20');
  assert.equal(setStart(row({ mode: 'day' }), '2025-12-20').end, '');
});

test('lines become closures for the planning, and back', () => {
  const rows = [
    row({ mode: 'range', start: '2025-12-20', end: '2026-01-04', label: ' Noël ' }),
    row({ mode: 'day', start: '2025-11-11', end: '2025-11-30', kind: 'public-holiday' }),
    row({ mode: 'range', start: '2026-02-07', end: '' }),
    row({ mode: 'day', start: '2026-05-15', label: 'Pont' }),
    row({ mode: 'day', start: '2026-06-12' }),
    row({ mode: 'range', start: '2026-04-04', end: '2026-04-19' }),
  ];
  const closures = rowsToClosures(rows);
  assert.deepEqual(closures, [
    { start: '2025-11-11', end: '2025-11-11', label: 'Jour férié', kind: 'public-holiday' },
    { start: '2025-12-20', end: '2026-01-04', label: 'Noël', kind: 'holiday' },
    { start: '2026-04-04', end: '2026-04-19', label: 'Vacances', kind: 'holiday' },
    { start: '2026-05-15', end: '2026-05-15', label: 'Pont', kind: 'holiday' },
    { start: '2026-06-12', end: '2026-06-12', label: 'Jour sans cours', kind: 'holiday' },
  ]);
  const again = closuresToRows(closures);
  assert.deepEqual(again.map((r) => [r.mode, r.start, r.end]).slice(0, 3), [['day', '2025-11-11', ''], ['range', '2025-12-20', '2026-01-04'], ['range', '2026-04-04', '2026-04-19']]);
  assert.deepEqual(rowsToClosures(again), closures);
  assert.equal(new Set(again.map((r) => r.id)).size, 5);
});

test('lines are sorted by date, new empty lines stay last', () => {
  const a = row({ start: '2026-02-07' });
  const b = row({ start: '' });
  const c = row({ start: '2025-10-18' });
  assert.deepEqual(sortRows([a, b, c]).map((r) => r.id), [c.id, a.id, b.id]);
});
