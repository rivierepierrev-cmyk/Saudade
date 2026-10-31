import { addDays, fromDate, type ISODate } from './dates.ts';
import type { Closure } from './model.ts';

/** Easter Sunday (Gregorian calendar, anonymous algorithm). */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fromDate(new Date(Date.UTC(year, month - 1, day)));
}

/** French public holidays of a calendar year. `alsaceMoselle` adds Good Friday and 26 December. */
export function publicHolidays(year: number, options: { alsaceMoselle?: boolean } = {}): Closure[] {
  const easter = easterSunday(year);
  const day = (md: string) => `${year}-${md}`;
  const list: [ISODate, string][] = [
    [day('01-01'), "Jour de l'an"],
    [addDays(easter, 1), 'Lundi de Pâques'],
    [day('05-01'), 'Fête du Travail'],
    [day('05-08'), 'Victoire 1945'],
    [addDays(easter, 39), 'Ascension'],
    [addDays(easter, 50), 'Lundi de Pentecôte'],
    [day('07-14'), 'Fête nationale'],
    [day('08-15'), 'Assomption'],
    [day('11-01'), 'Toussaint'],
    [day('11-11'), 'Armistice 1918'],
    [day('12-25'), 'Noël'],
  ];
  if (options.alsaceMoselle) list.push([addDays(easter, -2), 'Vendredi saint'], [day('12-26'), 'Saint-Étienne']);
  return list
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, label]) => ({ start: date, end: date, label, kind: 'public-holiday' as const }));
}

/** Public holidays falling in a school year (e.g. 1 September 2025 – 31 August 2026). */
export function publicHolidaysBetween(from: ISODate, to: ISODate, options: { alsaceMoselle?: boolean } = {}): Closure[] {
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  return years.flatMap((y) => publicHolidays(y, options)).filter((c) => c.start >= from && c.start <= to);
}

export type Zone = 'Zone A' | 'Zone B' | 'Zone C' | 'Corse' | string;

/** A record of the « Calendrier scolaire » dataset of data.education.gouv.fr (fields that are used). */
export interface OfficialHolidayRecord {
  description: string;
  start_date: string;
  end_date: string;
  zones: string;
  annee_scolaire?: string;
  location?: string;
  population?: string;
}

/** The local date in Paris of a timestamp such as '2025-10-17T22:00:00+00:00'. */
function parisDate(value: string): ISODate {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Turns official records into closures for one zone. In the dataset, `start_date` is the first day
 * without lessons and `end_date` the day lessons resume, so the closure ends the day before.
 * Records for teachers only (population « Enseignants ») are ignored, and duplicates (one record
 * per académie) are merged.
 */
export function holidaysFromOfficialRecords(records: OfficialHolidayRecord[], zone: Zone): Closure[] {
  const seen = new Map<string, Closure>();
  for (const r of records) {
    if (r.zones !== zone) continue;
    if (r.population && /enseignant/i.test(r.population) && !/élève|eleve/i.test(r.population)) continue;
    const start = parisDate(r.start_date);
    const resume = parisDate(r.end_date);
    // Summer holidays have no resumption day in the dataset at times: end_date is then the start.
    const end = resume > start ? addDays(resume, -1) : start;
    const key = `${start}|${end}`;
    if (!seen.has(key)) seen.set(key, { start, end, label: r.description.trim(), kind: 'holiday' });
  }
  return [...seen.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** URL of the official dataset for a school year (e.g. '2025-2026') and zone. */
export function officialHolidaysUrl(schoolYear: string, zone: Zone): string {
  const where = `annee_scolaire="${schoolYear}" and zones="${zone}"`;
  return `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=${encodeURIComponent(where)}&limit=100`;
}

/** Downloads the school holidays of a zone. Save the result: the agenda must work offline. */
export async function fetchOfficialHolidays(schoolYear: string, zone: Zone, fetchImpl: typeof fetch = fetch): Promise<Closure[]> {
  const res = await fetchImpl(officialHolidaysUrl(schoolYear, zone));
  if (!res.ok) throw new Error(`Calendrier scolaire indisponible (${res.status})`);
  const body = (await res.json()) as { results?: OfficialHolidayRecord[] };
  return holidaysFromOfficialRecords(body.results ?? [], zone);
}
