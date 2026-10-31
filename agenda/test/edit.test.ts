import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addClass, addSeance, addSequence, addSlot, copySeanceTo, duplicateSeance, duplicateSequence, moveSeance, PALETTE,
  removeClass, removeSeance, removeSequence, removeSlot, sequenceLessons, slotConflicts, updateClass, updateSeance, updateSlot, weeklyLessons,
} from '../src/edit.ts';
import { layoutDay } from '../src/timetableLayout.ts';
import { timeOf } from '../src/dates.ts';
import type { Agenda, TimetableSlot } from '../src/model.ts';

const empty = (): Agenda => ({ classes: [], timetable: [], sequences: [], placements: [], calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] } });

test('classes get their own colour, and removing one removes its timetable and placements', () => {
  let a = empty();
  const ids: string[] = [];
  for (const name of ['6e B', '5e A', ' ']) {
    const r = addClass(a, name);
    a = r.agenda;
    ids.push(r.id);
  }
  assert.deepEqual(a.classes.map((c) => c.name), ['6e B', '5e A', 'Nouvelle classe']);
  assert.deepEqual(a.classes.map((c) => c.color), PALETTE.slice(0, 3));
  a = updateClass(a, ids[0], { name: '6e C' });
  assert.equal(a.classes[0].name, '6e C');

  const s1 = addSlot(a, { classId: ids[0], weekday: 1, start: '08:00', end: '08:55' });
  a = addSlot(s1.agenda, { classId: ids[1], weekday: 1, start: '09:00', end: '09:55' }).agenda;
  a = { ...a, placements: [{ id: 'p', sequenceId: 'x', classId: ids[0] }], cancellations: [{ slotId: s1.id, date: '2025-09-08' }] };
  const before = a;
  a = removeClass(a, ids[0]);
  assert.equal(a.classes.length, 2);
  assert.deepEqual(a.timetable.map((s) => s.classId), [ids[1]]);
  assert.deepEqual(a.placements, []);
  assert.deepEqual(a.cancellations, []);
  assert.equal(before.classes.length, 3, 'the previous version is untouched');
});

test('timetable lessons: edit, remove, clashes', () => {
  let a = empty();
  const r = addSlot(a, { classId: 'c', weekday: 2, start: '10:00', end: '11:00' });
  a = updateSlot(r.agenda, r.id, { room: 'B12', end: '10:55' });
  assert.deepEqual(a.timetable[0], { id: r.id, classId: 'c', weekday: 2, start: '10:00', end: '10:55', room: 'B12' });

  const t: TimetableSlot[] = [
    { id: 'a', classId: 'c1', weekday: 1, start: '08:00', end: '09:00' },
    { id: 'b', classId: 'c2', weekday: 1, start: '09:00', end: '10:00', week: 'A' },
    { id: 'c', classId: 'c3', weekday: 1, start: '14:00', end: '15:00', validTo: '2025-12-31' },
  ];
  const ids = (x: TimetableSlot[]) => x.map((s) => s.id);
  assert.deepEqual(ids(slotConflicts(t, { classId: 'z', weekday: 1, start: '08:30', end: '09:30' })), ['a', 'b']);
  assert.deepEqual(ids(slotConflicts(t, { classId: 'z', weekday: 1, start: '09:00', end: '10:00', week: 'B' })), [], 'A and B weeks');
  assert.deepEqual(ids(slotConflicts(t, { classId: 'z', weekday: 1, start: '09:00', end: '10:00', week: 'A' })), ['b']);
  assert.deepEqual(ids(slotConflicts(t, { classId: 'z', weekday: 1, start: '07:00', end: '08:00' })), [], 'touching is fine');
  assert.deepEqual(ids(slotConflicts(t, { classId: 'z', weekday: 2, start: '08:00', end: '09:00' })), []);
  assert.deepEqual(ids(slotConflicts(t, { classId: 'z', weekday: 1, start: '14:00', end: '15:00', validFrom: '2026-01-01' })), [], 'new timetable from January');
  assert.deepEqual(ids(slotConflicts(t, { id: 'a', classId: 'c1', weekday: 1, start: '08:00', end: '08:30' })), [], 'not with itself');

  a = { ...a, cancellations: [{ slotId: r.id, date: '2025-09-02' }] };
  a = removeSlot(a, r.id);
  assert.deepEqual([a.timetable, a.cancellations], [[], []]);
});

test('lessons per week, A/B lessons counting for half', () => {
  const a: Agenda = {
    ...empty(),
    timetable: [
      { id: '1', classId: 'c', weekday: 1, start: '08:00', end: '08:55' },
      { id: '2', classId: 'c', weekday: 3, start: '10:00', end: '11:00' },
      { id: '3', classId: 'c', weekday: 5, start: '14:00', end: '15:00', week: 'A' },
      { id: '4', classId: 'c', weekday: 2, start: '08:00', end: '09:00', validFrom: '2026-01-05' },
      { id: '5', classId: 'other', weekday: 1, start: '09:00', end: '10:00' },
    ],
  };
  assert.deepEqual(weeklyLessons(a, 'c'), { lessons: 3, minutes: 175 }, 'without A/B weeks, every lesson counts');
  const ab = { ...a, calendar: { ...a.calendar, abWeeks: { referenceMonday: '2025-09-01', skipHolidayWeeks: true } } };
  assert.deepEqual(weeklyLessons(ab, 'c'), { lessons: 2.5, minutes: 145 });
  assert.equal(weeklyLessons(ab, 'c', '2026-01-05').lessons, 3.5);
});

test('séquences: add, duplicate, remove', () => {
  let a = empty();
  const r = addSequence(a, 'Fractions');
  a = r.agenda;
  a = addSeance(a, r.id, { title: 'Découverte' }).agenda;
  a = addSeance(a, r.id, { slots: 2 }).agenda;
  assert.deepEqual(a.sequences[0].seances.map((s) => s.title), ['Découverte', 'Séance 2']);
  assert.equal(sequenceLessons(a.sequences[0]), 3);

  const d = duplicateSequence(a, r.id);
  a = d.agenda;
  assert.deepEqual(a.sequences.map((s) => s.title), ['Fractions', 'Fractions (copie)']);
  const [orig, copy] = a.sequences;
  assert.notEqual(orig.seances[0].id, copy.seances[0].id, 'séances are copied, not shared');
  assert.equal(copy.color, orig.color);

  a = { ...a, placements: [{ id: 'p1', sequenceId: r.id, classId: 'c' }, { id: 'p2', sequenceId: d.id, classId: 'c' }] };
  a = removeSequence(a, r.id);
  assert.deepEqual(a.sequences.map((s) => s.id), [d.id]);
  assert.deepEqual(a.placements.map((p) => p.id), ['p2']);
});

test('séance blocks: reorder, duplicate, edit, remove, reuse in another séquence', () => {
  let a = empty();
  const s = addSequence(a, 'A');
  a = s.agenda;
  for (const t of ['1', '2', '3', '4']) a = addSeance(a, s.id, { title: t }).agenda;
  const titles = () => a.sequences[0].seances.map((x) => x.title).join('');
  a = moveSeance(a, s.id, 0, 3);
  assert.equal(titles(), '2341');
  a = moveSeance(a, s.id, 3, 0);
  assert.equal(titles(), '1234');
  a = moveSeance(a, s.id, 1, 2);
  assert.equal(titles(), '1324');
  a = moveSeance(a, s.id, 2, 99);
  assert.equal(titles(), '1342');
  assert.equal(moveSeance(a, s.id, 9, 0).sequences[0].seances.length, 4);

  const second = a.sequences[0].seances[1];
  const dup = duplicateSeance(a, s.id, second.id);
  a = dup.agenda;
  assert.equal(titles(), '13342');
  assert.notEqual(a.sequences[0].seances[2].id, second.id);

  a = updateSeance(a, s.id, dup.id, { title: 'X', objectives: 'Comparer' });
  assert.equal(titles(), '13X42');
  a = removeSeance(a, s.id, second.id);
  assert.equal(titles(), '1X42');
  a = addSeance(a, s.id, { title: '0' }, 0).agenda;
  assert.equal(titles(), '01X42');

  const other = addSequence(a, 'B');
  a = other.agenda;
  const reused = copySeanceTo(a, s.id, dup.id, other.id);
  a = reused.agenda;
  assert.deepEqual(a.sequences[1].seances.map((x) => [x.title, x.objectives]), [['X', 'Comparer']]);
  a = updateSeance(a, other.id, reused.id, { title: 'Y' });
  assert.equal(titles(), '01X42', 'the original is not changed');
});

test('lessons of a day side by side when they overlap', () => {
  const at = (start: string, end: string) => ({ start, end, id: `${start}-${end}` });
  const layout = layoutDay([at('10:00', '11:00'), at('08:00', '09:00'), at('08:00', '09:00'), at('08:30', '09:30'), at('09:00', '09:30')]);
  const show = Object.fromEntries(layout.map((p) => [`${p.item.id}#${p.col}`, p.cols]));
  assert.deepEqual(show, { '08:00-09:00#0': 3, '08:00-09:00#1': 3, '08:30-09:30#2': 3, '09:00-09:30#0': 3, '10:00-11:00#0': 1 });
  assert.deepEqual(layoutDay([]), []);
  assert.equal(timeOf(8 * 60 + 5), '08:05');
  assert.equal(timeOf(-3), '00:00');
});
