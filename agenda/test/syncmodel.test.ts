import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRemote, compactEvents, diffAgenda, emptyMeta, snapshotEvents, type SyncEvent, type SyncMeta } from '../src/sync/model.ts';
import type { Agenda } from '../src/model.ts';

/** A device: its agenda, its clocks, and the events it has written to its log. */
interface Device {
  id: string;
  agenda: Agenda;
  meta: SyncMeta;
  log: SyncEvent[];
  read: number; // how much of the other's log it has applied
}

let minute = 0;
const tick = () => new Date(Date.UTC(2025, 9, 1, 8, minute++));

const base = (): Agenda => ({
  classes: [{ id: '6B', name: '6e B', level: '6e' }, { id: '4A', name: '4e A' }],
  timetable: [{ id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '08:55' }],
  sequences: [{ id: 'frac', title: 'Fractions', seances: [{ id: 'f1', title: 'Découverte' }] }, { id: 'geo', title: 'Géométrie', seances: [] }],
  placements: [{ id: 'p1', sequenceId: 'frac', classId: '6B', start: '2025-09-01' }, { id: 'p2', sequenceId: 'geo', classId: '6B' }],
  calendar: { start: '2025-09-01', end: '2026-07-03', closures: [{ start: '2025-10-18', end: '2025-11-02', label: 'Toussaint', kind: 'holiday' }] },
});

const device = (id: string, agenda: Agenda): Device => ({ id, agenda, meta: emptyMeta(), log: [], read: 0 });

/** A user change on a device. */
function edit(d: Device, change: (a: Agenda) => Agenda) {
  const next = change(d.agenda);
  d.log.push(...diffAgenda(d.agenda, next, tick(), d.id, d.meta));
  d.agenda = next;
}

/** `to` reads what `from` wrote since last time. */
function pull(to: Device, from: Device) {
  const events = from.log.slice(to.read);
  to.read = from.log.length;
  to.agenda = applyRemote(to.agenda, to.meta, events).agenda;
}

/** A starts the folder with its agenda; B joins, taking it. */
function pair(): [Device, Device] {
  const a = device('aaaaaaaaaaaaaaaa', base());
  a.log.push(...snapshotEvents(a.agenda, tick(), a.id, a.meta));
  const b = device('bbbbbbbbbbbbbbbb', { ...base(), classes: [], timetable: [], sequences: [], placements: [], calendar: { start: '2024-09-01', end: '2025-07-04', closures: [] } });
  pull(b, a);
  return [a, b];
}

test('a device joining takes the whole agenda of the folder', () => {
  const [a, b] = pair();
  assert.deepEqual(b.agenda, a.agenda);
});

test('changes on both sides, field by field, most recent wins', () => {
  const [a, b] = pair();
  edit(a, (x) => ({ ...x, classes: x.classes.map((c) => (c.id === '6B' ? { ...c, name: '6e B (Mme L.)' } : c)) }));
  edit(b, (x) => ({ ...x, classes: x.classes.map((c) => (c.id === '6B' ? { ...c, color: '#ff0000' } : c)) }));
  edit(b, (x) => ({ ...x, sequences: x.sequences.map((s) => (s.id === 'frac' ? { ...s, title: 'Fractions !' } : s)) }));
  edit(a, (x) => ({ ...x, sequences: x.sequences.map((s) => (s.id === 'frac' ? { ...s, title: 'Les fractions' } : s)) })); // later: wins
  pull(a, b);
  pull(b, a);
  assert.deepEqual(a.agenda, b.agenda);
  assert.deepEqual(a.agenda.classes[0], { id: '6B', name: '6e B (Mme L.)', level: '6e', color: '#ff0000' });
  assert.equal(a.agenda.sequences[0].title, 'Les fractions');
});

test('creations, deletions, and a deletion winning over an edit', () => {
  const [a, b] = pair();
  edit(a, (x) => ({ ...x, sequences: [...x.sequences, { id: 'pyth', title: 'Pythagore', seances: [] }] }));
  edit(b, (x) => ({ ...x, cancellations: [{ slotId: 'mon', date: '2025-09-08', reason: 'Sortie' }], done: [{ slotId: 'mon', date: '2025-09-01', seanceId: 'f1' }] }));
  edit(a, (x) => ({ ...x, classes: x.classes.filter((c) => c.id !== '4A') }));
  edit(b, (x) => ({ ...x, classes: x.classes.map((c) => (c.id === '4A' ? { ...c, name: '4e A bis' } : c)) })); // edit after the deletion
  pull(a, b);
  pull(b, a);
  assert.deepEqual(a.agenda, b.agenda);
  assert.deepEqual(a.agenda.classes.map((c) => c.id), ['6B'], 'deleted stays deleted');
  assert.deepEqual(a.agenda.sequences.map((s) => s.id), ['frac', 'geo', 'pyth']);
  assert.deepEqual(a.agenda.cancellations, [{ slotId: 'mon', date: '2025-09-08', reason: 'Sortie' }]);
  assert.deepEqual(a.agenda.done, [{ slotId: 'mon', date: '2025-09-01', seanceId: 'f1' }]);

  // Restoring the cancelled lesson on one device removes it on the other.
  edit(a, (x) => ({ ...x, cancellations: [] }));
  pull(b, a);
  assert.deepEqual(b.agenda.cancellations, []);
});

test('the order of placements (the chain of a class) is synchronised', () => {
  const [a, b] = pair();
  edit(a, (x) => ({ ...x, placements: [x.placements[1], x.placements[0]] }));
  edit(b, (x) => ({ ...x, placements: [...x.placements, { id: 'p3', sequenceId: 'geo', classId: '4A' }] }));
  pull(a, b);
  pull(b, a);
  assert.deepEqual(a.agenda.placements.map((p) => p.id), ['p2', 'p1', 'p3']);
  assert.deepEqual(b.agenda.placements.map((p) => p.id), ['p2', 'p1', 'p3']);
  // Adding at the end or removing needs no order event.
  const before = a.log.length;
  edit(a, (x) => ({ ...x, placements: x.placements.filter((p) => p.id !== 'p1') }));
  assert.deepEqual(a.log.slice(before).map((e) => e.t), ['del']);
});

test('the calendar: holidays and school year, field by field', () => {
  const [a, b] = pair();
  edit(a, (x) => ({ ...x, calendar: { ...x.calendar, closures: [...x.calendar.closures, { start: '2025-11-11', end: '2025-11-11', label: 'Armistice', kind: 'public-holiday' }] } }));
  edit(b, (x) => ({ ...x, calendar: { ...x.calendar, end: '2026-07-04', abWeeks: { referenceMonday: '2025-09-01', skipHolidayWeeks: true } } }));
  pull(a, b);
  pull(b, a);
  assert.deepEqual(a.agenda.calendar, b.agenda.calendar);
  assert.equal(a.agenda.calendar.closures.length, 2);
  assert.equal(a.agenda.calendar.end, '2026-07-04');
  edit(b, (x) => ({ ...x, calendar: { ...x.calendar, abWeeks: undefined } }));
  pull(a, b);
  assert.equal('abWeeks' in a.agenda.calendar, false, 'a removed field is removed');
});

test('applying the same events twice changes nothing; nothing to apply keeps the same object', () => {
  const [a, b] = pair();
  edit(a, (x) => ({ ...x, classes: [...x.classes, { id: '3C', name: '3e C' }] }));
  const events = a.log.slice(b.read);
  pull(b, a);
  const once = b.agenda;
  assert.equal(applyRemote(b.agenda, b.meta, events).agenda, once);
  assert.equal(applyRemote(b.agenda, b.meta, []).changed, false);
});

test('a compacted log gives the same agenda, without making old values look new', () => {
  const [a, b] = pair();
  edit(a, (x) => ({ ...x, classes: x.classes.map((c) => (c.id === '6B' ? { ...c, name: 'old name' } : c)) }));
  pull(b, a);
  edit(b, (x) => ({ ...x, classes: x.classes.map((c) => (c.id === '6B' ? { ...c, name: 'new name' } : c)) })); // more recent
  // A compacts its log; a third device reads A's compacted log and B's log.
  const compacted = compactEvents(a.agenda, a.meta);
  const c = device('cccccccccccccccc', { ...base(), classes: [], timetable: [], sequences: [], placements: [] });
  c.agenda = applyRemote(c.agenda, c.meta, [...compacted, ...b.log]).agenda;
  assert.equal(c.agenda.classes.find((x) => x.id === '6B')!.name, 'new name');
  // B reading A's compacted log keeps its own more recent change.
  b.agenda = applyRemote(b.agenda, b.meta, compacted).agenda;
  assert.equal(b.agenda.classes.find((x) => x.id === '6B')!.name, 'new name');
  pull(a, b);
  assert.deepEqual(c.agenda.classes, a.agenda.classes);
});
