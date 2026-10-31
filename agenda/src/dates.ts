/** Calendar dates as 'YYYY-MM-DD' strings. All arithmetic is done in UTC so time zones never shift a day. */
export type ISODate = string;

/** 1 = Monday … 7 = Sunday (ISO 8601). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const DAY_MS = 86_400_000;

export function toDate(d: ISODate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Invalid date: ${d}`);
  return new Date(`${d}T00:00:00Z`);
}

export function fromDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDate(new Date(toDate(d).getTime() + n * DAY_MS));
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

export function weekday(d: ISODate): Weekday {
  return (((toDate(d).getUTCDay() + 6) % 7) + 1) as Weekday;
}

/** Monday of the week containing d. */
export function mondayOf(d: ISODate): ISODate {
  return addDays(d, 1 - weekday(d));
}

/** Every date from `from` to `to`, both included. */
export function* eachDay(from: ISODate, to: ISODate): Generator<ISODate> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

/** 'HH:MM' → minutes since midnight. */
export function minutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
