import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelledLessons, cancelLesson, classProgress, closuresBetween, insertionIndex, monthGridStart, proposePlacement, putPlacement,
  removeExtraSlot, removePlacement, restoreLesson,
} from '../src/placements.ts';
import { plan, previewPlacement } from '../src/plan.ts';
import type { Agenda, Sequence } from '../src/model.ts';

const seq = (id: string, n: number): Sequence => ({ id, title: id, seances: Array.from({ length: n }, (_, i) => ({ id: `${id}${i + 1}`, title: `${id} ${i + 1}` })) });

const base = (): Agenda => ({
  classes: [{ id: '6B', name: '6e B' }, { id: '4A', name: '4e A' }],
  timetable: [
    { id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '09:00' },
    { id: 'thu', classId: '6B', weekday: 4, start: '10:00', end: '11:00' },
    { id: 'tue', classId: '4A', weekday: 2, start: '14:00', end: '15:00' },
  ],
  sequences: [seq('A', 4), seq('B', 2), seq('C', 3)],
  placements: [],
  calendar: { start: '2025-09-01', end: '2026-07-03', closures: [{ start: '2025-10-18', end: '2025-11-02', label: 'Toussaint', kind: 'holiday' }] },
});

test('a drop on a lesson starts there and goes in date order in the class chain', () => {
  let a = base();
  a = { ...a, placements: [
    { id: 'pa', sequenceId: 'A', classId: '6B', start: '2025-09-01' }, // 1/09 → 11/09
    { id: 'x', sequenceId: 'B', classId: '4A', start: '2025-09-02' },
    { id: 'pb', sequenceId: 'B', classId: '6B' }, // 15/09 → 18/09
  ] };
  assert.equal(insertionIndex(a, '6B', '2025-09-01'), 0, 'on the first lesson of A: before A');
  assert.equal(insertionIndex(a, '6B', '2025-09-08'), 1, 'during A: after it');
  assert.equal(insertionIndex(a, '6B', '2025-09-25'), 3, 'after B');
  assert.equal(insertionIndex(a, '6B', '2025-08-25'), 0, 'before everything of the class');
  assert.equal(insertionIndex(a, '4A', '2025-09-30'), 2);
  assert.equal(insertionIndex(a, '6B', undefined), 3);

  // Dropping C on the first lesson of B (15/09) puts it there; B follows C.
  const { placement, index } = proposePlacement(a, 'C', '6B', '2025-09-15', '2025-09-01', 'pc');
  assert.deepEqual(placement, { id: 'pc', sequenceId: 'C', classId: '6B', start: '2025-09-15' });
  assert.equal(index, 1);
  const r = plan(putPlacement(a, placement, index));
  const ends = Object.fromEntries(r.sequences.map((s) => [s.placement.id, `${s.start}→${s.end}`]));
  assert.equal(ends.pc, '2025-09-15→2025-09-22');
  assert.equal(ends.pb, '2025-09-25→2025-09-29');
  assert.deepEqual(r.warnings, []);
});

test('a drop on a class follows its last séquence, or starts today', () => {
  const a = base();
  const first = proposePlacement(a, 'A', '6B', undefined, '2025-10-01', 'p1');
  assert.equal(first.placement.start, '2025-10-01', 'nothing yet: from today');
  assert.equal(proposePlacement(a, 'A', '6B', undefined, '2025-08-15', 'p').placement.start, '2025-09-01', 'before the year: its first day');
  const b = putPlacement(a, first.placement, first.index);
  const next = proposePlacement(b, 'B', '6B', undefined, '2025-10-01', 'p2');
  assert.equal(next.placement.start, undefined);
  assert.equal(next.index, 1);
  const r = plan(putPlacement(b, next.placement, next.index));
  // A: 2, 6, 9, 13 oct.; B: 16 oct., then Toussaint, 3 nov.
  assert.deepEqual([r.sequences[1].start, r.sequences[1].end], ['2025-10-16', '2025-11-03']);
});

test('moving a placement keeps its id and reorders the chain', () => {
  let a = base();
  a = { ...a, placements: [{ id: 'pa', sequenceId: 'A', classId: '6B', start: '2025-09-01' }, { id: 'pb', sequenceId: 'B', classId: '6B' }] };
  const moved = proposePlacement(a, 'A', '6B', '2025-09-22', '2025-09-01', 'pa');
  assert.equal(moved.index, 1, 'after B, which now starts first');
  const p = previewPlacement(a, moved.placement, moved.index);
  assert.equal(p.result!.start, '2025-09-22');
  const next = putPlacement(a, moved.placement, moved.index);
  assert.deepEqual(next.placements.map((x) => x.id), ['pb', 'pa']);
  assert.equal(next.placements[0].start, '2025-09-15', 'B, now first, stays where it was instead of jumping to September 1');
  assert.deepEqual(removePlacement(next, 'pa').placements.map((x) => x.id), ['pb']);
});

test('a séquence that followed another stays put when that one moves later or is removed', () => {
  let a = base();
  a = { ...a, placements: [{ id: 'pa', sequenceId: 'A', classId: '6B', start: '2025-10-09' }, { id: 'pb', sequenceId: 'B', classId: '6B' }] };
  // A: 9, 13, 16 oct., 3 nov. — B follows: 6, 10 nov.
  assert.equal(plan(a).sequences[1].end, '2025-11-10');

  // Moving A a week later (16 oct., 3, 6, 10 nov.): B keeps following it (13, 17 nov.).
  const later = proposePlacement(a, 'A', '6B', '2025-10-16', '2025-10-01', 'pa');
  assert.equal(later.index, 0);
  const p = previewPlacement(a, later.placement, later.index);
  assert.deepEqual(p.shifted.map((s) => [s.title, s.endBefore, s.endAfter]), [['B', '2025-11-10', '2025-11-17']]);

  // Moving A after B: B keeps its dates.
  const after = proposePlacement(a, 'A', '6B', '2025-12-01', '2025-10-01', 'pa');
  const r = plan(putPlacement(a, after.placement, after.index));
  assert.deepEqual(r.sequences.map((s) => [s.placement.id, s.start]), [['pb', '2025-11-06'], ['pa', '2025-12-01']]);

  // Removing A: B stays on 6 November rather than going back to September.
  const removed = removePlacement(a, 'pa');
  assert.deepEqual(removed.placements, [{ id: 'pb', sequenceId: 'B', classId: '6B', start: '2025-11-06' }]);
  assert.deepEqual(removePlacement(removed, 'pb').placements, []);
});

test('cancelling a lesson shifts what follows; restoring it puts it back', () => {
  let a = base();
  a = { ...a, placements: [{ id: 'pa', sequenceId: 'A', classId: '6B', start: '2025-09-01' }] };
  assert.equal(plan(a).sequences[0].end, '2025-09-11');
  a = cancelLesson(a, 'thu', '2025-09-04', 'Sortie');
  a = cancelLesson(a, 'thu', '2025-09-04', 'Sortie scolaire');
  assert.equal(a.cancellations!.length, 1, 'once');
  assert.equal(plan(a).sequences[0].end, '2025-09-15');
  assert.deepEqual(cancelledLessons(a, '2025-09-01', '2025-09-07').map((l) => [l.date, l.start, l.classId, l.reason]), [['2025-09-04', '10:00', '6B', 'Sortie scolaire']]);
  assert.deepEqual(cancelledLessons(a, '2025-09-08', '2025-09-14'), []);
  a = restoreLesson(a, 'thu', '2025-09-04');
  assert.equal(plan(a).sequences[0].end, '2025-09-11');
  assert.deepEqual(removeExtraSlot({ ...a, extraSlots: [{ id: 'x', classId: '6B', date: '2025-09-05', start: '08:00', end: '09:00' }] }, 'x').extraSlots, []);
});

test('closures between two dates, progress of a class, month grid', () => {
  const a: Agenda = { ...base(), placements: [{ id: 'pa', sequenceId: 'A', classId: '6B', start: '2025-10-09' }] };
  assert.deepEqual(closuresBetween(a, '2025-10-09', '2025-11-06', '6B').map((c) => c.label), ['Toussaint']);
  assert.deepEqual(closuresBetween(a, '2025-09-01', '2025-10-17'), []);

  const r = plan(a);
  const p = classProgress(a, r, '6B', '2025-10-10');
  assert.equal(p.planned, 4);
  assert.equal(p.plannedUntil, '2025-11-03'); // 9, 13, 16 oct., Toussaint, 3 nov.
  assert.deepEqual(p.next, { date: '2025-10-13', sequenceTitle: 'A', seanceTitle: 'A 2', index: 1, total: 4 });
  assert.ok(p.elapsed > 0.1 && p.elapsed < 0.2);
  assert.equal(p.freeAhead, p.lessons - 12 - 3, 'every lesson from today (12 before) except the 3 planned ones');
  assert.equal(classProgress(a, r, '4A', '2025-10-10').next, undefined);

  assert.equal(monthGridStart('2025-10-15'), '2025-09-29');
  assert.equal(monthGridStart('2025-09-20'), '2025-09-01');
  assert.equal(monthGridStart('2026-02-10'), '2026-01-26');
});
