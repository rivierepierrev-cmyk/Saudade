import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addGroup, removeGroup, renameGroup, splitInHalves, weeklyLessons } from '../src/edit.ts';
import { cancelledLessons, cancelLesson, classProgress, proposePlacement, putPlacement, removePlacement } from '../src/placements.ts';
import { lessonsOf, plan, previewPlacement } from '../src/plan.ts';
import { trackName, visibleTracks } from '../src/tracks.ts';
import type { Agenda, Sequence } from '../src/model.ts';

const seq = (id: string, n: number): Sequence => ({ id, title: id, seances: Array.from({ length: n }, (_, i) => ({ id: `${id}${i + 1}`, title: `${id} ${i + 1}` })) });

/** Two classes of the same level. 2nde 3 has whole-class lessons and half-group practicals. */
const base = (): Agenda => ({
  classes: [
    { id: 'c3', name: '2nde 3', groups: [{ id: 'g1', name: 'Groupe 1' }, { id: 'g2', name: 'Groupe 2' }] },
    { id: 'c4', name: '2nde 4' },
  ],
  timetable: [
    { id: 'c3-mon', classId: 'c3', weekday: 1, start: '08:00', end: '09:00' },
    { id: 'c3-g1', classId: 'c3', groupId: 'g1', weekday: 2, start: '10:00', end: '11:30' },
    { id: 'c3-g2', classId: 'c3', groupId: 'g2', weekday: 4, start: '14:00', end: '15:30' },
    { id: 'c4-mon', classId: 'c4', weekday: 1, start: '09:00', end: '10:00' },
  ],
  sequences: [seq('Cinématique', 3), seq('TP', 2), seq('Optique', 2)],
  placements: [],
  calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] },
});

const dates = (a: Agenda, placementId: string) =>
  plan(a).sequences.find((s) => s.placement.id === placementId)!.seances.map((s) => s.lessons.map((l) => l.date).join('+'));

test('each group has its own lessons; the class as a whole has the whole-class ones', () => {
  const a = base();
  const range = ['2025-09-01', '2025-09-14'] as const;
  assert.deepEqual(lessonsOf(a, 'c3', ...range).map((l) => l.date), ['2025-09-01', '2025-09-08']);
  assert.deepEqual(lessonsOf(a, { classId: 'c3', groupId: 'g1' }, ...range).map((l) => [l.date, l.groupId]), [['2025-09-02', 'g1'], ['2025-09-09', 'g1']]);
  assert.deepEqual(lessonsOf(a, { classId: 'c3', groupId: 'g2' }, ...range).map((l) => l.date), ['2025-09-04', '2025-09-11']);
  assert.deepEqual(weeklyLessons(a, 'c3'), { lessons: 1, minutes: 60 });
  assert.deepEqual(weeklyLessons(a, { classId: 'c3', groupId: 'g1' }), { lessons: 1, minutes: 90 });
  assert.deepEqual(weeklyLessons(a, 'c3', undefined, true), { lessons: 3, minutes: 240 });
});

test('same level, different progress: a séquence on each class, on the class and on each group', () => {
  const a: Agenda = {
    ...base(),
    placements: [
      { id: 'cin3', sequenceId: 'Cinématique', classId: 'c3', start: '2025-09-01' },
      { id: 'cin4', sequenceId: 'Cinématique', classId: 'c4', start: '2025-09-08' },
      { id: 'tp1', sequenceId: 'TP', classId: 'c3', groupId: 'g1', start: '2025-09-01' },
      { id: 'tp2', sequenceId: 'TP', classId: 'c3', groupId: 'g2', start: '2025-09-08' },
      { id: 'opt1', sequenceId: 'Optique', classId: 'c3', groupId: 'g1' },
    ],
  };
  assert.deepEqual(dates(a, 'cin3'), ['2025-09-01', '2025-09-08', '2025-09-15'], 'whole-class lessons only');
  assert.deepEqual(dates(a, 'cin4'), ['2025-09-08', '2025-09-15', '2025-09-22'], 'a week behind');
  assert.deepEqual(dates(a, 'tp1'), ['2025-09-02', '2025-09-09']);
  assert.deepEqual(dates(a, 'tp2'), ['2025-09-11', '2025-09-18']);
  assert.deepEqual(dates(a, 'opt1'), ['2025-09-16', '2025-09-23'], 'follows the TP of group 1, not of group 2');
  const r = plan(a);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.sequences.find((s) => s.placement.id === 'tp1')!.seances[0].groupId, 'g1');
  const tuesday = r.entries.find((e) => e.lesson.date === '2025-09-02')!;
  assert.deepEqual([tuesday.lesson.groupId, tuesday.planned?.seance.title], ['g1', 'TP 1']);

  const g1 = classProgress(a, r, { classId: 'c3', groupId: 'g1' }, '2025-09-10');
  assert.equal(g1.plannedUntil, '2025-09-23');
  assert.equal(g1.next?.sequenceTitle, 'Optique');
  assert.equal(classProgress(a, r, 'c3', '2025-09-10').next?.sequenceTitle, 'Cinématique');
});

test('dropping on a group: placement on that group, in its own chain', () => {
  let a: Agenda = { ...base(), placements: [{ id: 'tp1', sequenceId: 'TP', classId: 'c3', groupId: 'g1', start: '2025-09-01' }] };
  const g2 = { classId: 'c3', groupId: 'g2' };
  const first = proposePlacement(a, 'TP', g2, undefined, '2025-09-10', 'tp2');
  assert.deepEqual(first.placement, { id: 'tp2', sequenceId: 'TP', classId: 'c3', groupId: 'g2', start: '2025-09-10' }, 'group 2 has nothing yet: from today');
  a = putPlacement(a, first.placement, first.index);
  const next = proposePlacement(a, 'Optique', { classId: 'c3', groupId: 'g1' }, undefined, '2025-09-10', 'opt1');
  assert.equal(next.placement.start, undefined, 'group 1 has a séquence: follows it');
  const p = previewPlacement(a, next.placement, next.index);
  assert.deepEqual([p.result!.start, p.result!.end], ['2025-09-16', '2025-09-23']);
  a = putPlacement(a, next.placement, next.index);

  // Removing the first séquence of group 1 keeps the one that followed; group 2 is not touched.
  const removed = removePlacement(a, 'tp1');
  assert.equal(removed.placements.find((x) => x.id === 'opt1')!.start, '2025-09-16');
  assert.equal(removed.placements.find((x) => x.id === 'tp2')!.start, '2025-09-10');
});

test('cancelling a group lesson moves only that group', () => {
  let a: Agenda = {
    ...base(),
    placements: [
      { id: 'tp1', sequenceId: 'TP', classId: 'c3', groupId: 'g1', start: '2025-09-01' },
      { id: 'cin3', sequenceId: 'Cinématique', classId: 'c3', start: '2025-09-01' },
    ],
  };
  a = cancelLesson(a, 'c3-g1', '2025-09-02');
  assert.deepEqual(dates(a, 'tp1'), ['2025-09-09', '2025-09-16']);
  assert.deepEqual(dates(a, 'cin3'), ['2025-09-01', '2025-09-08', '2025-09-15']);
  assert.deepEqual(cancelledLessons(a, '2025-09-01', '2025-09-07').map((l) => [l.date, l.groupId]), [['2025-09-02', 'g1']]);
});

test('groups: add, rename, remove; names and visible tracks', () => {
  let a = base();
  assert.equal(trackName(a, { classId: 'c3', groupId: 'g2' }), '2nde 3 · Groupe 2');
  assert.equal(trackName(a, { classId: 'c4' }), '2nde 4');
  assert.deepEqual(visibleTracks(a).map((t) => trackName(a, t)), ['2nde 3', '2nde 3 · Groupe 1', '2nde 3 · Groupe 2', '2nde 4']);

  a = splitInHalves(a, 'c4');
  assert.deepEqual(a.classes[1].groups!.map((g) => g.name), ['Groupe 1', 'Groupe 2']);
  assert.ok(visibleTracks(a).some((t) => t.classId === 'c4' && !t.groupId), 'whole class still shown: it has lessons');
  a = { ...a, timetable: a.timetable.filter((s) => s.classId !== 'c4') };
  assert.ok(!visibleTracks(a).some((t) => t.classId === 'c4' && !t.groupId), 'only groups, no whole-class lessons');
  const r = addGroup(a, 'c4', 'Latin');
  a = renameGroup(r.agenda, 'c4', r.id, 'Latinistes');
  assert.deepEqual(a.classes[1].groups!.map((g) => g.name), ['Groupe 1', 'Groupe 2', 'Latinistes']);
  assert.equal(addGroup(removeGroup(a, 'c4', a.classes[1].groups![0].id), 'c4').agenda.classes[1].groups!.at(-1)!.name, 'Groupe 1', 'reuses a free name');

  // Removing a group removes its lessons, its séquences and cancellations, not the rest of the class.
  a = { ...base(), placements: [{ id: 'tp2', sequenceId: 'TP', classId: 'c3', groupId: 'g2' }, { id: 'cin3', sequenceId: 'Cinématique', classId: 'c3' }], cancellations: [{ slotId: 'c3-g2', date: '2025-09-04' }] };
  a = removeGroup(a, 'c3', 'g2');
  assert.deepEqual(a.classes[0].groups, [{ id: 'g1', name: 'Groupe 1' }]);
  assert.deepEqual(a.timetable.map((s) => s.id), ['c3-mon', 'c3-g1', 'c4-mon']);
  assert.deepEqual(a.placements.map((p) => p.id), ['cin3']);
  assert.deepEqual(a.cancellations, []);
  a = removeGroup(a, 'c3', 'g1');
  assert.equal('groups' in a.classes[0], false);
});

test('a placement on a group that no longer exists is reported', () => {
  const a: Agenda = { ...base(), placements: [{ id: 'x', sequenceId: 'TP', classId: 'c3', groupId: 'gone' }] };
  assert.deepEqual(plan(a).warnings.map((w) => w.kind), ['unknown-group']);
});
