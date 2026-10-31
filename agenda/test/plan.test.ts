import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayEntries, lessonsOf, plan, previewPlacement, weekEntries, weekType } from '../src/plan.ts';
import { publicHolidaysBetween } from '../src/holidays.ts';
import type { Agenda, Closure, Sequence } from '../src/model.ts';

// Zone A, 2025-2026.
const holidays: Closure[] = [
  { start: '2025-10-18', end: '2025-11-02', label: 'Toussaint', kind: 'holiday' },
  { start: '2025-12-20', end: '2026-01-04', label: 'Noël', kind: 'holiday' },
  { start: '2026-02-07', end: '2026-02-22', label: 'Hiver', kind: 'holiday' },
  { start: '2026-04-04', end: '2026-04-19', label: 'Printemps', kind: 'holiday' },
];

const seq = (id: string, n: number, title = id): Sequence => ({
  id,
  title,
  seances: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i + 1}`, title: `${title} ${i + 1}` })),
});

function agenda(over: Partial<Agenda> = {}): Agenda {
  return {
    classes: [{ id: '6B', name: '6e B' }, { id: '4A', name: '4e A' }],
    timetable: [
      { id: '6B-mon', classId: '6B', weekday: 1, start: '08:00', end: '09:00' },
      { id: '6B-thu', classId: '6B', weekday: 4, start: '10:00', end: '11:00' },
      { id: '4A-tue', classId: '4A', weekday: 2, start: '14:00', end: '15:00' },
    ],
    sequences: [seq('fractions', 6, 'Fractions'), seq('geometrie', 3, 'Géométrie')],
    placements: [],
    calendar: { start: '2025-09-01', end: '2026-07-03', closures: [...holidays, ...publicHolidaysBetween('2025-09-01', '2026-07-03')] },
    ...over,
  };
}

const dates = (r: ReturnType<typeof plan>, placementId: string) =>
  r.sequences.find((s) => s.placement.id === placementId)!.seances.map((s) => s.lessons.map((l) => l.date).join('+'));

test('a dropped séquence gets the class lessons in order, skipping the holidays', () => {
  const r = plan(agenda({ placements: [{ id: 'p1', sequenceId: 'fractions', classId: '6B', start: '2025-10-06' }] }));
  assert.deepEqual(dates(r, 'p1'), ['2025-10-06', '2025-10-09', '2025-10-13', '2025-10-16', '2025-11-03', '2025-11-06']);
  const s = r.sequences[0];
  assert.equal(s.start, '2025-10-06');
  assert.equal(s.end, '2025-11-06');
  assert.equal(s.unscheduled, 0);
  assert.deepEqual(r.warnings, []);
  assert.equal(s.seances[4].seance.title, 'Fractions 5');
  assert.equal(s.seances[4].lessons[0].start, '08:00');
});

test('public holidays are skipped: 11 November 2025 is a Tuesday', () => {
  const r = plan(agenda({ placements: [{ id: 'p', sequenceId: 'geometrie', classId: '4A', start: '2025-11-04' }] }));
  assert.deepEqual(dates(r, 'p'), ['2025-11-04', '2025-11-18', '2025-11-25']);
});

test('a start date on a day without lesson begins at the next lesson', () => {
  const r = plan(agenda({ placements: [{ id: 'p', sequenceId: 'geometrie', classId: '6B', start: '2025-10-18' }] }));
  assert.equal(r.sequences[0].start, '2025-11-03');
});

test('séquences of a class follow each other; other classes are independent', () => {
  const r = plan(agenda({
    placements: [
      { id: 'p1', sequenceId: 'fractions', classId: '6B', start: '2025-10-06' },
      { id: 'p2', sequenceId: 'geometrie', classId: '6B' },
      { id: 'p3', sequenceId: 'geometrie', classId: '4A' },
    ],
  }));
  assert.deepEqual(dates(r, 'p2'), ['2025-11-10', '2025-11-13', '2025-11-17']);
  assert.deepEqual(dates(r, 'p3'), ['2025-09-02', '2025-09-09', '2025-09-16']);
  assert.deepEqual(r.sequences.map((s) => s.placement.id), ['p1', 'p2', 'p3']);
});

test('adding a holiday or cancelling a lesson moves everything after it', () => {
  const base = agenda({ placements: [{ id: 'p1', sequenceId: 'fractions', classId: '6B', start: '2025-10-06' }, { id: 'p2', sequenceId: 'geometrie', classId: '6B' }] });
  const cancelled = plan({ ...base, cancellations: [{ slotId: '6B-thu', date: '2025-10-09', reason: 'Sortie' }] });
  assert.deepEqual(dates(cancelled, 'p1'), ['2025-10-06', '2025-10-13', '2025-10-16', '2025-11-03', '2025-11-06', '2025-11-10']);
  assert.equal(cancelled.sequences[1].end, '2025-11-20');

  const stage: Closure = { start: '2025-10-13', end: '2025-10-17', label: 'Stage', kind: 'closure', classIds: ['6B'] };
  const calendar = { ...base.calendar, closures: [...base.calendar.closures, stage] };
  const closed = plan({ ...base, calendar });
  assert.deepEqual(dates(closed, 'p1'), ['2025-10-06', '2025-10-09', '2025-11-03', '2025-11-06', '2025-11-10', '2025-11-13']);
  const other = plan({ ...base, calendar, placements: [{ id: 'q', sequenceId: 'geometrie', classId: '4A', start: '2025-10-14' }] });
  assert.equal(other.sequences[0].start, '2025-10-14', 'a closure for one class does not affect the others');
});

test('a double séance takes two lessons and is flagged when holidays fall between them', () => {
  const sequences: Sequence[] = [{ id: 's', title: 'Projet', seances: [
    { id: 'a', title: 'Lancement' },
    { id: 'b', title: 'Atelier', slots: 2 },
    { id: 'c', title: 'Bilan' },
  ] }];
  const r = plan(agenda({ sequences, placements: [{ id: 'p', sequenceId: 's', classId: '6B', start: '2025-10-13' }] }));
  assert.deepEqual(dates(r, 'p'), ['2025-10-13', '2025-10-16+2025-11-03', '2025-11-06']);
  assert.deepEqual(r.sequences[0].seances.map((s) => s.interrupted), [false, true, false]);
  const atelier = r.entries.filter((e) => e.planned?.seance.id === 'b').map((e) => `${e.planned!.part}/${e.planned!.parts}`);
  assert.deepEqual(atelier, ['1/2', '2/2']);
});

test('a start date inside the previous séquence is pushed back, with a warning', () => {
  const r = plan(agenda({ placements: [
    { id: 'p1', sequenceId: 'fractions', classId: '6B', start: '2025-10-06' },
    { id: 'p2', sequenceId: 'geometrie', classId: '6B', start: '2025-10-13' },
  ] }));
  assert.equal(r.sequences[1].start, '2025-11-10');
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].kind, 'pushed-back');
  assert.match(r.warnings[0].message, /13\/10\/2025/);
});

test('a later start leaves free lessons in between', () => {
  const r = plan(agenda({ placements: [
    { id: 'p1', sequenceId: 'geometrie', classId: '6B', start: '2025-09-01' },
    { id: 'p2', sequenceId: 'geometrie', classId: '6B', start: '2025-09-15' },
  ] }));
  assert.equal(r.sequences[0].end, '2025-09-08');
  assert.equal(r.sequences[1].start, '2025-09-15');
  assert.equal(dayEntries(r, '2025-09-11')[0].planned, undefined);
});

test('a séquence that does not fit before the end of the year', () => {
  const r = plan(agenda({ placements: [{ id: 'p', sequenceId: 'fractions', classId: '6B', start: '2026-06-18' }] }));
  const s = r.sequences[0];
  assert.deepEqual(dates(r, 'p'), ['2026-06-18', '2026-06-22', '2026-06-25', '2026-06-29', '2026-07-02']);
  assert.equal(s.unscheduled, 1);
  assert.equal(s.end, '2026-07-02');
  assert.equal(r.warnings[0].kind, 'overflow');
});

test('unknown or empty séquences and classes give warnings, not errors', () => {
  const r = plan(agenda({
    sequences: [seq('vide', 0)],
    placements: [
      { id: 'a', sequenceId: 'nope', classId: '6B' },
      { id: 'b', sequenceId: 'vide', classId: '6B' },
      { id: 'c', sequenceId: 'vide', classId: 'nope' },
    ],
  }));
  assert.deepEqual(r.warnings.map((w) => w.kind).sort(), ['empty-sequence', 'unknown-class', 'unknown-sequence']);
  assert.equal(r.sequences.find((s) => s.placement.id === 'b')!.start, undefined);
});

test('A/B weeks, counted over school weeks only', () => {
  // A one-week break, so that counting it or not gives different weeks afterwards.
  const closures: Closure[] = [{ start: '2025-10-18', end: '2025-10-26', label: 'Toussaint', kind: 'holiday' }];
  const calendar = { start: '2025-09-01', end: '2026-07-03', closures, abWeeks: { referenceMonday: '2025-09-01', skipHolidayWeeks: true } };
  assert.equal(weekType(calendar, '2025-09-03'), 'A');
  assert.equal(weekType(calendar, '2025-09-08'), 'B');
  assert.equal(weekType(calendar, '2025-10-13'), 'A'); // 7th school week
  assert.equal(weekType(calendar, '2025-10-20'), undefined); // holidays
  assert.equal(weekType(calendar, '2025-10-27'), 'B'); // resumes where it stopped
  assert.equal(weekType({ ...calendar, abWeeks: { referenceMonday: '2025-09-01', skipHolidayWeeks: false } }, '2025-10-27'), 'A');
  assert.equal(weekType(calendar, '2025-08-25'), 'B', 'before the reference week');

  const a = agenda({
    calendar,
    timetable: [
      { id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '09:00' },
      { id: 'fri-a', classId: '6B', weekday: 5, start: '15:00', end: '16:00', week: 'A' },
    ],
  });
  assert.deepEqual(lessonsOf(a, '6B', '2025-09-01', '2025-09-14').map((l) => `${l.date} ${l.slotId}`), [
    '2025-09-01 mon', '2025-09-05 fri-a', '2025-09-08 mon',
  ]);
});

test('timetable changes during the year, and one-off extra lessons', () => {
  const a = agenda({
    timetable: [
      { id: 'old', classId: '6B', weekday: 1, start: '08:00', end: '09:00', validTo: '2025-09-14' },
      { id: 'new', classId: '6B', weekday: 3, start: '09:00', end: '10:00', validFrom: '2025-09-15' },
    ],
    extraSlots: [{ id: 'x', classId: '6B', date: '2025-09-12', start: '13:00', end: '14:00' }],
  });
  assert.deepEqual(lessonsOf(a, '6B', '2025-09-01', '2025-09-21').map((l) => `${l.date} ${l.slotId ?? l.extraSlotId}`), [
    '2025-09-01 old', '2025-09-08 old', '2025-09-12 x', '2025-09-17 new',
  ]);
});

test('same-day lessons are ordered by time', () => {
  const a = agenda({ timetable: [
    { id: 'pm', classId: '6B', weekday: 1, start: '14:00', end: '15:00' },
    { id: 'am', classId: '6B', weekday: 1, start: '9:00', end: '10:00' },
  ] });
  assert.deepEqual(lessonsOf(a, '6B', '2025-09-01', '2025-09-01').map((l) => l.slotId), ['am', 'pm']);
});

test('week and day views list every lesson, planned or free', () => {
  const r = plan(agenda({ placements: [{ id: 'p', sequenceId: 'geometrie', classId: '6B', start: '2025-09-04' }] }));
  const week = weekEntries(r, '2025-09-03');
  assert.deepEqual(week.map((e) => `${e.lesson.date} ${e.lesson.classId} ${e.planned ? `${e.planned.index + 1}/${e.planned.total}` : '-'}`), [
    '2025-09-01 6B -', '2025-09-02 4A -', '2025-09-04 6B 1/3',
  ]);
  assert.equal(dayEntries(r, '2025-09-04')[0].planned!.seance.title, 'Géométrie 1');
});

test('preview of a drop: dates, end date, and the séquences it pushes', () => {
  const a = agenda({ placements: [
    { id: 'p1', sequenceId: 'fractions', classId: '6B', start: '2025-10-06' },
    { id: 'p2', sequenceId: 'geometrie', classId: '6B' },
    { id: 'p3', sequenceId: 'geometrie', classId: '4A' },
  ] });
  // Insert « Géométrie » before « Fractions » in 6B, starting 15 September.
  const p = previewPlacement(a, { id: 'new', sequenceId: 'geometrie', classId: '6B', start: '2025-09-15' }, 0);
  assert.equal(p.result!.start, '2025-09-15');
  assert.equal(p.result!.end, '2025-09-22');
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.shifted, []); // fractions has its own start date after it

  const q = previewPlacement(a, { id: 'new', sequenceId: 'geometrie', classId: '6B' }, 1);
  assert.equal(q.result!.start, '2025-11-10');
  assert.deepEqual(q.shifted, [{ placementId: 'p2', title: 'Géométrie', endBefore: '2025-11-17', endAfter: '2025-11-27' }]);
  assert.equal(a.placements.length, 3, 'the agenda itself is not changed');
});
