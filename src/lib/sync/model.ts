/**
 * Synchronisation between computers: what is exchanged and how it is merged.
 *
 * Each computer writes what changes in its library as events, in its own log (see
 * electron/sync.cjs for files and encryption). Another computer applies them:
 * - documents, extracts, cards: field by field, the most recent change wins; a
 *   deletion wins over edits (an item deleted on one computer never comes back,
 *   unless it is created again later, e.g. by restoring a backup);
 * - a card's schedule is rebuilt from its last explicit setting (creation, reset,
 *   postponement… the "base") by replaying the reviews made after it, from every
 *   computer, in time order. FSRS is deterministic, so both computers agree, and
 *   reviews made on two computers the same day are all kept;
 * - review history: union (a removed entry stays removed);
 * - folder list: the most recent list wins;
 * - settings (daily limit, target retention, theme…): field by field, the most recent wins.
 * Everything here is pure: tested without files or windows.
 */
import { ClozeItem, DocumentItem, ExtractItem, FSRSRecord, ReviewLog } from '../../types/saudade';
import { applyCardReview, createInitialFSRSRecord } from '../fsrs';

export type ItemColl = 'documents' | 'extracts' | 'clozes';
export const ITEM_COLLS: ItemColl[] = ['documents', 'extracts', 'clozes'];

/** `${ISO time}|${device}|${seq}`: compares as a string, oldest first. */
export type Clock = string;

export type SyncEvent =
  /** n: the item is created (all its fields), not just edited. */
  | { c: Clock; t: 'put'; coll: ItemColl; id: string; f: Record<string, unknown>; n?: 1 }
  | { c: Clock; t: 'del'; coll: ItemColl; id: string }
  | { c: Clock; t: 'base'; id: string; fsrs: FSRSRecord }
  | { c: Clock; t: 'log'; log: ReviewLog }
  | { c: Clock; t: 'unlog'; id: string }
  | { c: Clock; t: 'folders'; list: string[] }
  | { c: Clock; t: 'settings'; f: Record<string, unknown> };

/** What this computer knows about the clocks of its data (saved locally, never shared). */
export interface SyncMeta {
  seq: number;
  /** Clock of each field of each item ('_' = every field not listed). */
  clocks: Record<ItemColl, Record<string, Record<string, Clock>>>;
  /** Deleted items. */
  dead: Record<ItemColl, Record<string, Clock>>;
  /** When each item was last created (a deletion older than that doesn't apply). */
  born: Record<ItemColl, Record<string, Clock>>;
  /** Cards: last explicit schedule. */
  bases: Record<string, { fsrs: FSRSRecord; c: Clock }>;
  /** Removed review log entries. */
  unlogged: Record<string, Clock>;
  folders?: Clock;
  /** Clock of each setting. */
  settings: Record<string, Clock>;
}

export interface Library {
  documents: DocumentItem[];
  extracts: ExtractItem[];
  clozes: ClozeItem[];
  reviewLogs: ReviewLog[];
  folders: string[];
  settings: Record<string, unknown>;
}
export type LibraryKey = keyof Library;

export const emptyMeta = (): SyncMeta => ({
  seq: 0,
  clocks: { documents: {}, extracts: {}, clozes: {} },
  dead: { documents: {}, extracts: {}, clozes: {} },
  born: { documents: {}, extracts: {}, clozes: {} },
  bases: {},
  unlogged: {},
  settings: {},
});

export function makeClock(now: Date, device: string, seq: number): Clock {
  return `${now.toISOString()}|${device}|${String(seq).padStart(10, '0')}`;
}
export const clockTime = (c: Clock) => c.slice(0, 24);

const same = (a: unknown, b: unknown) =>
  a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

// ---- Capturing local changes ------------------------------------------------

/** A change seen when a collection is saved, before clocks are given. */
export type Change =
  | { t: 'put'; coll: ItemColl; id: string; f: Record<string, unknown>; created: boolean }
  | { t: 'del'; coll: ItemColl; id: string }
  | { t: 'fsrs'; id: string; fsrs: FSRSRecord; created: boolean }
  | { t: 'log'; log: ReviewLog }
  | { t: 'unlog'; id: string; itemId?: string }
  | { t: 'folders'; list: string[] }
  | { t: 'settings'; f: Record<string, unknown> };

type AnyItem = { id: string } & Record<string, unknown>;

/** Changes between two versions of a saved collection. */
export function diffCollection(name: LibraryKey, prev: unknown, next: unknown): Change[] {
  if (name === 'folders') return same(prev, next) ? [] : [{ t: 'folders', list: [...(next as string[])] }];
  if (name === 'settings') {
    const before = (prev ?? {}) as Record<string, unknown>;
    const f = Object.fromEntries(Object.entries(next as Record<string, unknown>).filter(([k, v]) => !same(before[k], v)));
    return Object.keys(f).length > 0 ? [{ t: 'settings', f }] : [];
  }
  if (name === 'reviewLogs') {
    const before = new Set((prev as ReviewLog[]).map((l) => l.id));
    const after = new Set((next as ReviewLog[]).map((l) => l.id));
    return [
      ...(next as ReviewLog[]).filter((l) => !before.has(l.id)).map((log): Change => ({ t: 'log', log })),
      ...(prev as ReviewLog[]).filter((l) => !after.has(l.id)).map((l): Change => ({ t: 'unlog', id: l.id, itemId: l.itemId })),
    ];
  }
  const coll = name;
  const out: Change[] = [];
  const before = new Map((prev as AnyItem[]).map((i) => [i.id, i]));
  const seen = new Set<string>();
  for (const item of next as AnyItem[]) {
    seen.add(item.id);
    const old = before.get(item.id);
    const f: Record<string, unknown> = {};
    for (const k of Object.keys(item)) {
      if (k !== 'id' && (!old || !same(old[k], item[k]))) f[k] = item[k];
    }
    if (old) for (const k of Object.keys(old)) if (!(k in item)) f[k] = null;
    if (coll === 'clozes' && 'fsrs' in f) {
      out.push({ t: 'fsrs', id: item.id, fsrs: f.fsrs as FSRSRecord, created: !old });
      delete f.fsrs;
    }
    if (Object.keys(f).length > 0 || !old) out.push({ t: 'put', coll, id: item.id, f, created: !old });
  }
  for (const old of prev as AnyItem[]) if (!seen.has(old.id)) out.push({ t: 'del', coll, id: old.id });
  return out;
}

/**
 * Turns the changes saved together (one user action) into events. A card whose
 * schedule changed with a new review entry is replayed from that entry; any other
 * schedule change (creation, reset, postponement, undone review) becomes its new base.
 */
export function eventsFromChanges(changes: Change[], now: Date, device: string, meta: SyncMeta): SyncEvent[] {
  const reviewed = new Set(changes.flatMap((c) => (c.t === 'log' && c.log.itemType === 'cloze' ? [c.log.itemId] : [])));
  const unreviewed = new Set(changes.flatMap((c) => (c.t === 'unlog' && c.itemId ? [c.itemId] : [])));
  const order = { put: 0, del: 1, fsrs: 2, log: 3, unlog: 4, folders: 5, settings: 6 } as const;
  const sorted = [...changes].sort((a, b) => order[a.t] - order[b.t]);
  const events: SyncEvent[] = [];
  const clock = () => makeClock(now, device, ++meta.seq);
  for (const ch of sorted) {
    switch (ch.t) {
      case 'put':
        events.push(ch.created ? { c: clock(), t: 'put', coll: ch.coll, id: ch.id, f: ch.f, n: 1 } : { c: clock(), t: 'put', coll: ch.coll, id: ch.id, f: ch.f });
        break;
      case 'del':
        events.push({ c: clock(), t: 'del', coll: ch.coll, id: ch.id });
        break;
      case 'fsrs':
        // A plain review: the new review entry carries it.
        if (!ch.created && reviewed.has(ch.id) && !unreviewed.has(ch.id)) break;
        events.push({ c: clock(), t: 'base', id: ch.id, fsrs: ch.fsrs });
        break;
      case 'log':
        events.push({ c: clock(), t: 'log', log: ch.log });
        break;
      case 'unlog':
        events.push({ c: clock(), t: 'unlog', id: ch.id });
        break;
      case 'folders':
        events.push({ c: clock(), t: 'folders', list: ch.list });
        break;
      case 'settings':
        events.push({ c: clock(), t: 'settings', f: ch.f });
        break;
    }
  }
  return events;
}

/** Everything in the library as events: the first time a computer synchronises. */
export function snapshotEvents(lib: Library, now: Date, device: string, meta: SyncMeta): SyncEvent[] {
  const empty: Library = { documents: [], extracts: [], clozes: [], reviewLogs: [], folders: [], settings: {} };
  const changes = (Object.keys(empty) as LibraryKey[]).flatMap((k) => diffCollection(k, empty[k], lib[k]));
  // History first in time: the bases are taken after it, so it is never replayed.
  const logs = changes.filter((c) => c.t === 'log');
  const rest = changes.filter((c) => c.t !== 'log');
  return [...eventsFromChanges(logs, now, device, meta), ...eventsFromChanges(rest, now, device, meta)];
}

// ---- Compacting a log -------------------------------------------------------

/** Older than any real clock: for data no clock was ever recorded for. */
const ORIGIN: Clock = '1970-01-01T00:00:00.000Z|0000000000000000|0000000000';

/**
 * This computer's knowledge as few events, each change keeping its ORIGINAL clock:
 * the log can be replaced by them without making old values look new. Another
 * computer applying them keeps its own more recent changes.
 */
export function compactEvents(lib: Library, meta: SyncMeta): SyncEvent[] {
  const events: SyncEvent[] = [];
  for (const coll of ITEM_COLLS) {
    for (const item of lib[coll] as unknown as AnyItem[]) {
      const clocks = meta.clocks[coll][item.id] ?? {};
      const fields = Object.keys(item).filter((k) => k !== 'id' && !(coll === 'clozes' && k === 'fsrs'));
      const clockOf = (k: string) => clocks[k] ?? clocks._ ?? meta.born[coll][item.id] ?? ORIGIN;
      const born = meta.born[coll][item.id] ?? fields.map(clockOf).reduce((a, b) => (b < a ? b : a), clockOf(fields[0] ?? 'id'));
      // Created with every field at its oldest clock, then each later change at its own.
      events.push({ c: born, t: 'put', coll, id: item.id, f: Object.fromEntries(fields.map((k) => [k, item[k]])), n: 1 });
      const later = new Map<Clock, Record<string, unknown>>();
      for (const k of fields) {
        const c = clockOf(k);
        if (c > born) later.set(c, { ...(later.get(c) ?? {}), [k]: item[k] });
      }
      for (const [c, f] of later) events.push({ c, t: 'put', coll, id: item.id, f });
      if (coll === 'clozes') {
        const base = meta.bases[item.id];
        events.push(base ? { c: base.c, t: 'base', id: item.id, fsrs: base.fsrs } : { c: born, t: 'base', id: item.id, fsrs: item.fsrs as FSRSRecord });
      }
    }
    for (const [id, c] of Object.entries(meta.dead[coll])) events.push({ c, t: 'del', coll, id });
  }
  for (const log of lib.reviewLogs) events.push({ c: `${log.reviewDate}|${ORIGIN.slice(25)}`, t: 'log', log });
  for (const [id, c] of Object.entries(meta.unlogged)) events.push({ c, t: 'unlog', id });
  events.push({ c: meta.folders ?? ORIGIN, t: 'folders', list: [...lib.folders] });
  const settingsByClock = new Map<Clock, Record<string, unknown>>();
  for (const [k, v] of Object.entries(lib.settings)) {
    const c = meta.settings[k] ?? ORIGIN;
    settingsByClock.set(c, { ...(settingsByClock.get(c) ?? {}), [k]: v });
  }
  for (const [c, f] of settingsByClock) events.push({ c, t: 'settings', f });
  return events;
}

// ---- Recording and applying events ----------------------------------------

const itemClock = (meta: SyncMeta, coll: ItemColl, id: string, field: string): Clock => {
  const c = meta.clocks[coll][id];
  return c ? (c[field] ?? c._ ?? '') : '';
};

/** Records this computer's own events in its clocks (its data already has them). */
export function noteLocal(meta: SyncMeta, events: SyncEvent[]): void {
  for (const e of events) {
    switch (e.t) {
      case 'put': {
        const clocks = (meta.clocks[e.coll][e.id] ??= {});
        for (const k of Object.keys(e.f)) clocks[k] = e.c;
        if (e.n) {
          meta.born[e.coll][e.id] = e.c;
          delete meta.dead[e.coll][e.id];
        }
        break;
      }
      case 'del':
        meta.dead[e.coll][e.id] = e.c;
        delete meta.clocks[e.coll][e.id];
        if (e.coll === 'clozes') delete meta.bases[e.id];
        break;
      case 'base':
        meta.bases[e.id] = { fsrs: e.fsrs, c: e.c };
        break;
      case 'unlog':
        meta.unlogged[e.id] = e.c;
        break;
      case 'folders':
        meta.folders = e.c;
        break;
      case 'settings':
        for (const k of Object.keys(e.f)) meta.settings[k] = e.c;
        break;
    }
  }
}

/** A card's schedule: its base, then every review made after it, in time order. */
export function replayCard(base: { fsrs: FSRSRecord; c: Clock }, logs: ReviewLog[], defaultRetention: number): FSRSRecord {
  const from = clockTime(base.c);
  return logs
    .filter((l) => l.reviewDate > from)
    .sort((a, b) => (a.reviewDate < b.reviewDate ? -1 : a.reviewDate > b.reviewDate ? 1 : a.id < b.id ? -1 : 1))
    .reduce((fsrs, l) => applyCardReview(fsrs, l.rating, new Date(l.reviewDate), l.retention ?? defaultRetention), base.fsrs);
}

const REQUIRED: Record<ItemColl, string> = { documents: 'content', extracts: 'text', clozes: 'text' };

/**
 * Applies another computer's events. Returns the new library (only the changed
 * collections are new arrays) and which collections changed. `meta` is updated.
 */
export function applyRemote(
  lib: Library,
  meta: SyncMeta,
  events: SyncEvent[],
  defaultRetention: number
): { lib: Library; changed: Set<LibraryKey> } {
  const changed = new Set<LibraryKey>();
  const items: Record<ItemColl, Map<string, AnyItem>> = {
    documents: new Map(lib.documents.map((i) => [i.id, i as unknown as AnyItem])),
    extracts: new Map(lib.extracts.map((i) => [i.id, i as unknown as AnyItem])),
    clozes: new Map(lib.clozes.map((i) => [i.id, i as unknown as AnyItem])),
  };
  const logs = new Map(lib.reviewLogs.map((l) => [l.id, l]));
  let folders = lib.folders;
  let settings = lib.settings;
  const replay = new Set<string>();
  // Items created here: listed first, newest first, as the app does.
  const created: Record<ItemColl, string[]> = { documents: [], extracts: [], clozes: [] };

  for (const e of [...events].sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0))) {
    switch (e.t) {
      case 'put': {
        const map = items[e.coll];
        if (e.n) {
          if ((meta.dead[e.coll][e.id] ?? '') >= e.c) break; // deleted after
          if ((meta.born[e.coll][e.id] ?? '') < e.c) meta.born[e.coll][e.id] = e.c;
          delete meta.dead[e.coll][e.id];
        }
        const current = map.get(e.id);
        if (!current) {
          if (!e.n || !(REQUIRED[e.coll] in e.f)) break; // an edit of an item this computer deleted
          const fresh: AnyItem = { id: e.id };
          for (const [k, v] of Object.entries(e.f)) if (v !== null) fresh[k] = v;
          map.set(e.id, fresh);
          created[e.coll].unshift(e.id);
          meta.clocks[e.coll][e.id] = Object.fromEntries(Object.keys(e.f).map((k) => [k, e.c]));
          changed.add(e.coll);
          if (e.coll === 'clozes') replay.add(e.id);
          break;
        }
        const next: AnyItem = { ...current };
        const clocks = (meta.clocks[e.coll][e.id] ??= {});
        let touched = false;
        for (const [k, v] of Object.entries(e.f)) {
          if (e.c <= itemClock(meta, e.coll, e.id, k)) continue;
          clocks[k] = e.c;
          if (v === null) delete next[k];
          else next[k] = v;
          touched = true;
        }
        if (touched) {
          map.set(e.id, next);
          changed.add(e.coll);
        }
        break;
      }
      case 'del': {
        const map = items[e.coll];
        if ((meta.born[e.coll][e.id] ?? '') > e.c) break; // created again after this deletion
        if ((meta.dead[e.coll][e.id] ?? '') < e.c) meta.dead[e.coll][e.id] = e.c;
        delete meta.clocks[e.coll][e.id];
        if (map.delete(e.id)) changed.add(e.coll);
        if (e.coll === 'clozes') delete meta.bases[e.id];
        break;
      }
      case 'base': {
        const base = meta.bases[e.id];
        if (base && base.c >= e.c) break;
        meta.bases[e.id] = { fsrs: e.fsrs, c: e.c };
        replay.add(e.id);
        break;
      }
      case 'log': {
        if (logs.has(e.log.id) || meta.unlogged[e.log.id]) break;
        logs.set(e.log.id, e.log);
        changed.add('reviewLogs');
        if (e.log.itemType === 'cloze') replay.add(e.log.itemId);
        break;
      }
      case 'unlog': {
        if ((meta.unlogged[e.id] ?? '') < e.c) meta.unlogged[e.id] = e.c;
        const log = logs.get(e.id);
        if (log && logs.delete(e.id)) {
          changed.add('reviewLogs');
          if (log.itemType === 'cloze') replay.add(log.itemId);
        }
        break;
      }
      case 'folders':
        if (meta.folders && meta.folders >= e.c) break;
        meta.folders = e.c;
        if (!same(folders, e.list)) {
          folders = [...e.list];
          changed.add('folders');
        }
        break;
      case 'settings':
        for (const [k, v] of Object.entries(e.f)) {
          if ((meta.settings[k] ?? '') >= e.c) continue;
          meta.settings[k] = e.c;
          if (!same(settings[k], v)) {
            settings = { ...settings, [k]: v };
            changed.add('settings');
          }
        }
        break;
    }
  }

  // Cards: rebuild the schedules touched, from their base and the reviews after it.
  const allLogs = [...logs.values()];
  for (const id of replay) {
    const card = items.clozes.get(id);
    const base = meta.bases[id];
    if (!card || !base) continue;
    const retention = typeof settings.targetRetention === 'number' ? settings.targetRetention : defaultRetention;
    const fsrs = replayCard(base, allLogs.filter((l) => l.itemType === 'cloze' && l.itemId === id), retention);
    if (!same(card.fsrs, fsrs)) {
      items.clozes.set(id, { ...card, fsrs });
      changed.add('clozes');
    }
  }
  // A card created elsewhere always has a schedule.
  for (const [id, card] of items.clozes) {
    if (!card.fsrs) {
      items.clozes.set(id, { ...card, fsrs: createInitialFSRSRecord(0) });
      changed.add('clozes');
    }
  }

  const list = (coll: ItemColl) => {
    const map = items[coll];
    const first = created[coll].filter((id) => map.has(id));
    const firstSet = new Set(first);
    return [...first.map((id) => map.get(id)!), ...[...map.values()].filter((i) => !firstSet.has(i.id))];
  };
  return {
    lib: {
      documents: changed.has('documents') ? (list('documents') as unknown as DocumentItem[]) : lib.documents,
      extracts: changed.has('extracts') ? (list('extracts') as unknown as ExtractItem[]) : lib.extracts,
      clozes: changed.has('clozes') ? (list('clozes') as unknown as ClozeItem[]) : lib.clozes,
      reviewLogs: changed.has('reviewLogs') ? allLogs : lib.reviewLogs,
      folders,
      settings,
    },
    changed,
  };
}
