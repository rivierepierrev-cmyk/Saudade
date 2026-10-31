import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessLevel, levelMismatch, levelRank, levelsIn } from '../src/levels.ts';
import { addClass } from '../src/edit.ts';
import { plan } from '../src/plan.ts';
import type { Agenda } from '../src/model.ts';

test('the level is guessed from the class name', () => {
  const cases: [string, string | undefined][] = [
    ['6e B', '6e'], ['6ème 2', '6e'], ['5e1', '5e'], ['4EME A', '4e'], ['3e Prépa', '3e'],
    ['2nde 3', '2nde'], ['2de 4', '2nde'], ['Seconde B', '2nde'], ['1re STMG', '1re'], ['1ère S', '1re'],
    ['Tle G2', 'Tle'], ['Terminale 1', 'Tle'], ['T le 3', 'Tle'], ['cm2', 'CM2'], ['CE1 A', 'CE1'], ['BTS SIO', 'BTS'],
    ['Club théâtre', undefined], ['Latin', undefined], ['', undefined], ['60 élèves', undefined],
  ];
  for (const [name, level] of cases) assert.equal(guessLevel(name), level, name);
});

test('levels sort in school order; mismatches only when both are known', () => {
  assert.deepEqual(levelsIn([{ level: '2nde' }, { level: '6e' }, {}, { level: 'Atelier' }, { level: '6e' }, { level: 'CM2' }]), ['CM2', '6e', '2nde', 'Atelier']);
  assert.ok(levelRank('6e') < levelRank('5e') && levelRank('Tle') < levelRank('Atelier') && levelRank('Atelier') < levelRank(undefined));
  assert.equal(levelMismatch('6e', '4e'), true);
  assert.equal(levelMismatch('6e', '6E'), false);
  assert.equal(levelMismatch(undefined, '4e'), false);
  assert.equal(levelMismatch('6e', undefined), false);
});

test('a new class gets the level of its name', () => {
  const a: Agenda = { classes: [], timetable: [], sequences: [], placements: [], calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] } };
  assert.equal(addClass(a, '4e A').agenda.classes[0].level, '4e');
  assert.equal('level' in addClass(a, 'Atelier').agenda.classes[0], false);
});

test('several lessons the same day, different levels: each class has its own séance', () => {
  const s = (id: string, n: number) => ({ id, title: id, seances: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, title: `${id} ${i + 1}` })) });
  const a: Agenda = {
    classes: [{ id: '6B', name: '6e B', level: '6e' }, { id: '4A', name: '4e A', level: '4e' }, { id: 'T1', name: 'Tle 1', level: 'Tle' }],
    timetable: [
      { id: '1', classId: '6B', weekday: 1, start: '08:00', end: '09:00' },
      { id: '2', classId: '4A', weekday: 1, start: '09:00', end: '10:00' },
      { id: '3', classId: 'T1', weekday: 1, start: '14:00', end: '16:00' },
    ],
    sequences: [{ ...s('Fractions', 4), level: '6e' }, { ...s('Pythagore', 3), level: '4e' }, { ...s('Dérivation', 5), level: 'Tle' }],
    placements: [
      { id: 'a', sequenceId: 'Fractions', classId: '6B', start: '2025-09-01' },
      { id: 'b', sequenceId: 'Pythagore', classId: '4A', start: '2025-09-08' },
      { id: 'c', sequenceId: 'Dérivation', classId: 'T1', start: '2025-09-01' },
    ],
    calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] },
  };
  const monday = plan(a).entries.filter((e) => e.lesson.date === '2025-09-08');
  assert.deepEqual(monday.map((e) => `${e.lesson.start} ${e.lesson.classId} ${e.planned?.seance.title}`), ['08:00 6B Fractions 2', '09:00 4A Pythagore 1', '14:00 T1 Dérivation 2']);
});
