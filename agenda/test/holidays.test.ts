import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easterSunday, holidaysFromOfficialRecords, officialHolidaysUrl, publicHolidays, publicHolidaysBetween, fetchOfficialHolidays } from '../src/holidays.ts';
import { addDays, mondayOf, weekday } from '../src/dates.ts';

test('dates', () => {
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(weekday('2025-09-01'), 1);
  assert.equal(weekday('2025-09-07'), 7);
  assert.equal(mondayOf('2025-09-07'), '2025-09-01');
  assert.throws(() => addDays('2025-9-1', 1));
});

test('Easter Sunday', () => {
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
  assert.equal(easterSunday(2038), '2038-04-25');
});

test('French public holidays', () => {
  const h = publicHolidays(2026);
  assert.equal(h.length, 11);
  const find = (label: string) => h.find((x) => x.label === label)?.start;
  assert.equal(find('Lundi de Pâques'), '2026-04-06');
  assert.equal(find('Ascension'), '2026-05-14');
  assert.equal(find('Lundi de Pentecôte'), '2026-05-25');
  assert.ok(h.every((x) => x.kind === 'public-holiday' && x.start === x.end));
  const am = publicHolidays(2026, { alsaceMoselle: true });
  assert.equal(am.length, 13);
  assert.equal(am.find((x) => x.label === 'Vendredi saint')?.start, '2026-04-03');

  const year = publicHolidaysBetween('2025-09-01', '2026-07-04');
  assert.deepEqual(year.map((x) => x.start), [
    '2025-11-01', '2025-11-11', '2025-12-25', '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25',
  ]);
});

const records = [
  // Same holidays repeated for two académies, with UTC timestamps as the API returns them.
  { description: 'Vacances de la Toussaint', start_date: '2025-10-17T22:00:00+00:00', end_date: '2025-11-02T23:00:00+00:00', zones: 'Zone A', location: 'Lyon', population: '-' },
  { description: 'Vacances de la Toussaint', start_date: '2025-10-17T22:00:00+00:00', end_date: '2025-11-02T23:00:00+00:00', zones: 'Zone A', location: 'Grenoble', population: '-' },
  { description: "Vacances d'Hiver ", start_date: '2026-02-06T23:00:00+00:00', end_date: '2026-02-22T23:00:00+00:00', zones: 'Zone A', location: 'Lyon', population: '-' },
  { description: "Vacances d'Hiver", start_date: '2026-02-13T23:00:00+00:00', end_date: '2026-03-01T23:00:00+00:00', zones: 'Zone C', location: 'Paris', population: '-' },
  { description: 'Pré-rentrée Enseignants', start_date: '2025-08-29T22:00:00+00:00', end_date: '2025-08-29T22:00:00+00:00', zones: 'Zone A', location: 'Lyon', population: 'Enseignants' },
];

test('official school holidays: local dates, resumption day excluded, one per zone', () => {
  assert.deepEqual(holidaysFromOfficialRecords(records, 'Zone A'), [
    { start: '2025-10-18', end: '2025-11-02', label: 'Vacances de la Toussaint', kind: 'holiday' },
    { start: '2026-02-07', end: '2026-02-22', label: "Vacances d'Hiver", kind: 'holiday' },
  ]);
  assert.deepEqual(holidaysFromOfficialRecords(records, 'Zone C').map((c) => [c.start, c.end]), [['2026-02-14', '2026-03-01']]);
});

test('official school holidays: download', async () => {
  const url = officialHolidaysUrl('2025-2026', 'Zone A');
  assert.ok(url.startsWith('https://data.education.gouv.fr/') && url.includes(encodeURIComponent('zones="Zone A"')));
  const fake = (async () => new Response(JSON.stringify({ results: records }))) as typeof fetch;
  assert.equal((await fetchOfficialHolidays('2025-2026', 'Zone A', fake)).length, 2);
  const down = (async () => new Response('', { status: 503 })) as typeof fetch;
  await assert.rejects(fetchOfficialHolidays('2025-2026', 'Zone A', down), /503/);
});
