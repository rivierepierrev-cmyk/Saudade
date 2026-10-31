/**
 * Synchronisation between devices: what is exchanged and how it is merged (as in Saudade).
 *
 * Each device writes what changes in its agenda as events, in its own log (see sync/engine.ts for
 * files and encryption). Another device applies them:
 * - classes, timetable lessons, séquences, placements, extra lessons, cancelled lessons, done marks:
 *   field by field, the most recent change wins; a deletion wins over edits (an item deleted on one
 *   device never comes back, unless it is created again later, e.g. by restoring a backup);
 * - the order of classes, séquences and placements (placements are taught in that order): the most
 *   recent order wins; items it doesn't know keep their place at the end;
 * - the school calendar (first and last day, holidays, A/B weeks): field by field, the most recent wins.
 * Everything here is pure: tested without files or network.
 */
import type { Agenda, SchoolCalendar } from '../model.ts';

export type Coll = 'classes' | 'timetable' | 'sequences' | 'placements' | 'extraSlots' | 'cancellations' | 'done';
export const COLLS: Coll[] = ['classes', 'timetable', 'sequences', 'placements', 'extraSlots', 'cancellations', 'done'];
/** Collections whose order means something. */
export const ORDERED: Coll[] = ['classes', 'sequences', 'placements'];
export const CALENDAR_FIELDS: (keyof SchoolCalendar)[] = ['start', 'end', 'closures', 'abWeeks'];

/** `${ISO time}|${device}|${seq}`: compares as a string, oldest first. */
export type Clock = string;

export type SyncEvent =
  /** n: the item is created (all its fields), not just edited. */
  | { c: Clock; t: 'put'; coll: Coll; id: string; f: Record<string, unknown>; n?: 1 }
  | { c: Clock; t: 'del'; coll: Coll; id: string }
  | { c: Clock; t: 'order'; coll: Coll; list: string[] }
  | { c: Clock; t: 'cal'; f: Record<string, unknown> };

/** What this device knows about the clocks of its data (kept locally, never shared). */
export interface SyncMeta {
  seq: number;
  /** Clock of each field of each item. */
  clocks: Record<Coll, Record<string, Record<string, Clock>>>;
  dead: Record<Coll, Record<string, Clock>>;
  born: Record<Coll, Record<string, Clock>>;
  orders: Partial<Record<Coll, Clock>>;
  cal: Record<string, Clock>;
}

const byColl = <T>(): Record<Coll, Record<string, T>> => Object.fromEntries(COLLS.map((c) => [c, {}])) as Record<Coll, Record<string, T>>;

export const emptyMeta = (): SyncMeta => ({ seq: 0, clocks: byColl(), dead: byColl(), born: byColl(), orders: {}, cal: {} });

export function makeClock(now: Date, device: string, seq: number): Clock {
  return `${now.toISOString()}|${device}|${String(seq).padStart(10, '0')}`;
}

type AnyItem = Record<string, unknown>;

/** The id of an item: its own, or, for cancellations and done marks, the lesson they are about. */
export function keyOf(coll: Coll, item: AnyItem): string {
  if (coll === 'cancellations') return `${item.slotId}|${item.date}`;
  if (coll === 'done') return `${item.slotId ?? ''}|${item.extraSlotId ?? ''}|${item.date}`;
  return String(item.id);
}

/** A field without which an item can't exist: an edit of an item deleted here doesn't bring it back. */
const REQUIRED: Record<Coll, string> = {
  classes: 'name', timetable: 'classId', sequences: 'title', placements: 'sequenceId', extraSlots: 'classId', cancellations: 'slotId', done: 'date',
};

const listOf = (agenda: Agenda, coll: Coll): AnyItem[] => ((agenda[coll] as unknown as AnyItem[] | undefined) ?? []);

const same = (a: unknown, b: unknown) =>
  a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

// ---- Local changes ------------------------------------------------------------------

/** Events for what changed between two versions of the agenda (one user action, or several). */
export function diffAgenda(prev: Agenda, next: Agenda, now: Date, device: string, meta: SyncMeta): SyncEvent[] {
  const events: SyncEvent[] = [];
  const clock = () => makeClock(now, device, ++meta.seq);
  for (const coll of COLLS) {
    const before = new Map(listOf(prev, coll).map((i) => [keyOf(coll, i), i]));
    const seen = new Set<string>();
    for (const item of listOf(next, coll)) {
      const id = keyOf(coll, item);
      seen.add(id);
      const old = before.get(id);
      const f: AnyItem = {};
      for (const k of Object.keys(item)) if (k !== 'id' && (!old || !same(old[k], item[k]))) f[k] = item[k];
      if (old) for (const k of Object.keys(old)) if (!(k in item)) f[k] = null;
      if (!old) events.push({ c: clock(), t: 'put', coll, id, f, n: 1 });
      else if (Object.keys(f).length) events.push({ c: clock(), t: 'put', coll, id, f });
    }
    for (const id of before.keys()) if (!seen.has(id)) events.push({ c: clock(), t: 'del', coll, id });
    if (ORDERED.includes(coll)) {
      const a = listOf(prev, coll).map((i) => keyOf(coll, i));
      const b = listOf(next, coll).map((i) => keyOf(coll, i));
      // Removals, and additions at the end, need no order: every device does the same.
      const kept = new Set(b);
      const expected = [...a.filter((id) => kept.has(id)), ...b.filter((id) => !before.has(id))];
      if (!same(expected, b)) events.push({ c: clock(), t: 'order', coll, list: b });
    }
  }
  const f: AnyItem = {};
  for (const k of CALENDAR_FIELDS) if (!same(prev.calendar[k], next.calendar[k])) f[k] = next.calendar[k] ?? null;
  if (Object.keys(f).length) events.push({ c: clock(), t: 'cal', f });
  noteLocal(meta, events);
  return events;
}

const emptyAgenda = (calendar: SchoolCalendar): Agenda => ({ classes: [], timetable: [], sequences: [], placements: [], calendar: { ...calendar, closures: [] } });

/** Everything in the agenda as events: the first time a device synchronises a folder. */
export function snapshotEvents(agenda: Agenda, now: Date, device: string, meta: SyncMeta): SyncEvent[] {
  const empty = emptyAgenda(agenda.calendar);
  const events = diffAgenda({ ...empty, calendar: { start: '', end: '', closures: [] } }, agenda, now, device, meta);
  for (const coll of ORDERED) {
    if (!events.some((e) => e.t === 'order' && e.coll === coll) && listOf(agenda, coll).length) {
      const e: SyncEvent = { c: makeClock(now, device, ++meta.seq), t: 'order', coll, list: listOf(agenda, coll).map((i) => keyOf(coll, i)) };
      events.push(e);
      noteLocal(meta, [e]);
    }
  }
  return events;
}

/** Older than any real clock: for data no clock was ever recorded for. */
const ORIGIN: Clock = '1970-01-01T00:00:00.000Z|0000000000000000|0000000000';

/**
 * This device's knowledge as few events, each change keeping its ORIGINAL clock: the log can be
 * replaced by them without making old values look new.
 */
export function compactEvents(agenda: Agenda, meta: SyncMeta): SyncEvent[] {
  const events: SyncEvent[] = [];
  for (const coll of COLLS) {
    for (const item of listOf(agenda, coll)) {
      const id = keyOf(coll, item);
      const clocks = meta.clocks[coll][id] ?? {};
      const fields = Object.keys(item).filter((k) => k !== 'id');
      const clockOf = (k: string) => clocks[k] ?? meta.born[coll][id] ?? ORIGIN;
      const born = meta.born[coll][id] ?? fields.map(clockOf).reduce((a, b) => (b < a ? b : a), ORIGIN);
      events.push({ c: born, t: 'put', coll, id, f: Object.fromEntries(fields.map((k) => [k, item[k]])), n: 1 });
      const later = new Map<Clock, AnyItem>();
      for (const k of fields) {
        const c = clockOf(k);
        if (c > born) later.set(c, { ...(later.get(c) ?? {}), [k]: item[k] });
      }
      for (const [c, f] of later) events.push({ c, t: 'put', coll, id, f });
    }
    for (const [id, c] of Object.entries(meta.dead[coll])) events.push({ c, t: 'del', coll, id });
    if (ORDERED.includes(coll)) events.push({ c: meta.orders[coll] ?? ORIGIN, t: 'order', coll, list: listOf(agenda, coll).map((i) => keyOf(coll, i)) });
  }
  const byClock = new Map<Clock, AnyItem>();
  for (const k of CALENDAR_FIELDS) {
    const c = meta.cal[k] ?? ORIGIN;
    byClock.set(c, { ...(byClock.get(c) ?? {}), [k]: agenda.calendar[k] ?? null });
  }
  for (const [c, f] of byClock) events.push({ c, t: 'cal', f });
  return events;
}

// ---- Recording and applying events -----------------------------------------------------

/** Records this device's own events in its clocks (its data already has them). */
export function noteLocal(meta: SyncMeta, events: SyncEvent[]): void {
  for (const e of events) {
    if (e.t === 'put') {
      const clocks = (meta.clocks[e.coll][e.id] ??= {});
      for (const k of Object.keys(e.f)) clocks[k] = e.c;
      if (e.n) {
        meta.born[e.coll][e.id] = e.c;
        delete meta.dead[e.coll][e.id];
      }
    } else if (e.t === 'del') {
      meta.dead[e.coll][e.id] = e.c;
      delete meta.clocks[e.coll][e.id];
    } else if (e.t === 'order') {
      meta.orders[e.coll] = e.c;
    } else {
      for (const k of Object.keys(e.f)) meta.cal[k] = e.c;
    }
  }
}

/** Applies other devices' events. Returns the new agenda (the same object when nothing changed). `meta` is updated. */
export function applyRemote(agenda: Agenda, meta: SyncMeta, events: SyncEvent[]): { agenda: Agenda; changed: boolean } {
  const items = Object.fromEntries(COLLS.map((coll) => [coll, new Map(listOf(agenda, coll).map((i) => [keyOf(coll, i), i]))])) as Record<Coll, Map<string, AnyItem>>;
  const changed = new Set<Coll>();
  const orders: Partial<Record<Coll, string[]>> = {};
  let calendar = agenda.calendar;
  let calChanged = false;

  for (const e of [...events].sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0))) {
    if (e.t === 'put') {
      const map = items[e.coll];
      if (e.n) {
        if ((meta.dead[e.coll][e.id] ?? '') >= e.c) continue; // deleted after
        if ((meta.born[e.coll][e.id] ?? '') < e.c) meta.born[e.coll][e.id] = e.c;
        delete meta.dead[e.coll][e.id];
      }
      const current = map.get(e.id);
      if (!current) {
        if (!e.n || !(REQUIRED[e.coll] in e.f)) continue; // an edit of an item deleted here
        const fresh: AnyItem = e.coll === 'cancellations' || e.coll === 'done' ? {} : { id: e.id };
        for (const [k, v] of Object.entries(e.f)) if (v !== null) fresh[k] = v;
        map.set(e.id, fresh);
        meta.clocks[e.coll][e.id] = Object.fromEntries(Object.keys(e.f).map((k) => [k, e.c]));
        changed.add(e.coll);
        continue;
      }
      const next: AnyItem = { ...current };
      const clocks = (meta.clocks[e.coll][e.id] ??= {});
      let touched = false;
      for (const [k, v] of Object.entries(e.f)) {
        if (e.c <= (clocks[k] ?? '')) continue;
        clocks[k] = e.c;
        if (same(next[k], v === null ? undefined : v)) continue;
        if (v === null) delete next[k];
        else next[k] = v;
        touched = true;
      }
      if (touched) {
        map.set(e.id, next);
        changed.add(e.coll);
      }
    } else if (e.t === 'del') {
      if ((meta.born[e.coll][e.id] ?? '') > e.c) continue; // created again after this deletion
      if ((meta.dead[e.coll][e.id] ?? '') < e.c) meta.dead[e.coll][e.id] = e.c;
      delete meta.clocks[e.coll][e.id];
      if (items[e.coll].delete(e.id)) changed.add(e.coll);
    } else if (e.t === 'order') {
      if ((meta.orders[e.coll] ?? '') >= e.c) continue;
      meta.orders[e.coll] = e.c;
      orders[e.coll] = e.list;
    } else {
      for (const [k, v] of Object.entries(e.f)) {
        if ((meta.cal[k] ?? '') >= e.c) continue;
        meta.cal[k] = e.c;
        if (same(calendar[k as keyof SchoolCalendar], v === null ? undefined : v)) continue;
        const next = { ...calendar } as Record<string, unknown>;
        if (v === null) delete next[k];
        else next[k] = v;
        calendar = next as unknown as SchoolCalendar;
        calChanged = true;
      }
    }
  }

  const out: Agenda = { ...agenda };
  let any = calChanged;
  for (const coll of COLLS) {
    const order = orders[coll];
    if (!changed.has(coll) && !order) continue;
    const map = items[coll];
    let list = [...map.values()];
    if (order) {
      // The order given first; items it doesn't know after, in their current order.
      const rank = new Map(order.map((id, i) => [id, i]));
      list = list
        .map((item, i) => ({ item, i, r: rank.get(keyOf(coll, item)) }))
        .sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.i - b.i)
        .map((x) => x.item);
    }
    const before = listOf(agenda, coll);
    if (list.length === before.length && list.every((x, i) => x === before[i])) continue;
    (out as unknown as Record<string, unknown>)[coll] = list;
    any = true;
  }
  if (calChanged) out.calendar = calendar;
  return any ? { agenda: out, changed: true } : { agenda, changed: false };
}
