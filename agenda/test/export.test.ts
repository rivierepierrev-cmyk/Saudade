import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldLine, icsText, toICS } from '../src/ics.ts';
import { backupName, fromBackup, toBackup } from '../src/backup.ts';
import { plan } from '../src/plan.ts';
import type { Agenda } from '../src/model.ts';

const agenda = (): Agenda => ({
  classes: [{ id: '6B', name: '6e B' }],
  timetable: [{ id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '08:55', room: 'B12' }],
  sequences: [{ id: 'f', title: 'Fractions', seances: [{ id: 'f1', title: 'Découverte', objectives: 'Comparer; ordonner, simplifier', homework: 'Ex. 3\np. 42' }, { id: 'f2', title: 'Exercices' }] }],
  placements: [{ id: 'p', sequenceId: 'f', classId: '6B', start: '2025-09-01' }],
  calendar: { start: '2025-09-01', end: '2025-09-15', closures: [] },
});

test('iCalendar text and folding', () => {
  assert.equal(icsText('a;b,c\\d\ne'), 'a\;b\\,c\\\\d\\ne');
  assert.equal(foldLine('short'), 'short');
  const long = `SUMMARY:${'é'.repeat(60)}`;
  const folded = foldLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(new TextEncoder().encode(p).length <= 75, p);
  assert.ok(parts.slice(1).every((p) => p.startsWith(' ')));
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), long, 'nothing lost, no character cut');
});

test('one event per lesson, in local time, with the séance', () => {
  const a = agenda();
  const ics = toICS(a, plan(a), new Date('2025-10-01T10:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('TZID:Europe/Paris'));
  const events = ics.split('BEGIN:VEVENT').slice(1);
  assert.equal(events.length, 3, '1, 8 and 15 September');
  const first = events[0].replace(/\r\n /g, '');
  assert.match(first, /DTSTART;TZID=Europe\/Paris:20250901T080000\r\n/);
  assert.match(first, /DTEND;TZID=Europe\/Paris:20250901T085500\r\n/);
  assert.match(first, /SUMMARY:6e B · Fractions 1\/2 : Découverte\r\n/);
  assert.match(first, /DESCRIPTION:Objectifs : Comparer\; ordonner\\, simplifier\\n\\nDevoirs : Ex\. 3\\np\. 42\r\n/);
  assert.match(first, /LOCATION:Salle B12\r\n/);
  assert.match(first, /UID:6B--2025-09-01-0800@agenda-enseignant\r\n/);
  assert.match(first, /DTSTAMP:20251001T100000Z/);
  assert.match(events[2], /SUMMARY:6e B\r\n/, 'a free lesson is the class only');
  assert.ok(!events[2].includes('DESCRIPTION'));
});

test('backup round trip, and files that are not backups', () => {
  const a = agenda();
  const text = toBackup(a, new Date('2025-10-01T10:00:00Z'));
  assert.equal(JSON.parse(text).format, 'agenda-enseignant');
  assert.deepEqual(fromBackup(text), a);
  assert.deepEqual(fromBackup(JSON.stringify(a)), a, 'a bare agenda is accepted');
  assert.throws(() => fromBackup('pas du json'), /pas une sauvegarde/);
  assert.throws(() => fromBackup(JSON.stringify({ format: 'autre', agenda: a })), /pas une sauvegarde/);
  assert.throws(() => fromBackup(JSON.stringify({ format: 'agenda-enseignant', version: 2, agenda: a })), /plus récente/);
  assert.throws(() => fromBackup(JSON.stringify({ classes: [] })), /incomplète/);
  assert.throws(() => fromBackup(JSON.stringify({ ...a, calendar: { start: 'x', end: '2026-07-03', closures: [] } })), /incomplète/);
  assert.equal(backupName(new Date(2025, 9, 1)), 'agenda-2025-10-01.json');
});
