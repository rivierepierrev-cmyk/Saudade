/**
 * Ties the agenda to the shared folder: local changes become events in this device's log; other
 * devices' events are merged into the agenda. Every operation runs one after the other.
 */
import type { Agenda } from '../model.ts';
import { applyRemote, compactEvents, diffAgenda, emptyMeta, snapshotEvents, type SyncMeta } from './model.ts';
import { COMPACT_BYTES, type Engine, type Store, type SyncConfig } from './engine.ts';

export type JoinMode = 'take' | 'merge';

export function createSyncClient(engine: Engine, store: Store, options: { compactBytes?: number } = {}) {
  let meta: SyncMeta = store.get<SyncMeta>('sync:meta') ?? emptyMeta();
  /** The agenda as last recorded: local changes are what differs from it. */
  let base: Agenda | undefined = store.get<Agenda>('sync:base');
  const saveState = () => {
    store.set('sync:meta', meta);
    if (base) store.set('sync:base', base);
  };
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const run = queue.then(f, f);
    queue = run.catch(() => undefined);
    return run;
  };

  /** Records what changed since the last time (synchronously: no change can slip in between). */
  function capture(current: Agenda) {
    if (!engine.status().enabled) return [];
    if (!base) {
      base = current;
      saveState();
      return [];
    }
    if (current === base) return [];
    const events = diffAgenda(base, current, new Date(), engine.deviceId(), meta);
    base = current;
    saveState();
    return events;
  }

  return {
    status: () => engine.status(),

    /** After a change made on this device. */
    recordLocal(current: Agenda) {
      const events = capture(current);
      if (!events.length) return Promise.resolve();
      return serial(() => engine.append(events));
    },

    /**
     * Sends what is pending, reads the other devices and merges. `latest` gives the agenda as it is
     * when the merge happens (the user may have changed it meanwhile). Returns the merged agenda, or
     * undefined when nothing came in.
     */
    syncNow(latest: () => Agenda): Promise<Agenda | undefined> {
      return serial(async () => {
        if (!engine.status().enabled) return undefined;
        await engine.append(capture(latest()));
        const { events, token } = await engine.pull();
        const current = latest();
        await engine.append(capture(current));
        const r = applyRemote(current, meta, events);
        base = r.agenda;
        saveState();
        engine.ack(token);
        if (engine.ownLogBytes() > (options.compactBytes ?? COMPACT_BYTES)) await engine.compact(compactEvents(base, meta));
        return r.changed ? r.agenda : undefined;
      });
    },

    inspect: (where: NonNullable<SyncConfig['where']>) => engine.inspect(where),

    /**
     * Turns synchronisation on. A device starting a folder sends its agenda. A device joining a
     * folder used by others takes the folder's agenda (`take`: the caller keeps a copy of its own)
     * or merges both (`merge`). Returns the agenda to show.
     */
    start(current: Agenda, where: NonNullable<SyncConfig['where']>, passphrase: string, mode: JoinMode = 'take') {
      return serial(async () => {
        const r = await engine.enable(where, passphrase);
        if (!r.ok) return r;
        meta = emptyMeta();
        let agenda = current;
        if (r.joined && mode === 'take') {
          const { events, token } = await engine.pull();
          const empty: Agenda = { classes: [], timetable: [], sequences: [], placements: [], calendar: { ...current.calendar, closures: [] } };
          agenda = applyRemote(empty, meta, events).agenda;
          engine.ack(token);
        } else {
          await engine.append(snapshotEvents(current, new Date(), engine.deviceId(), meta));
          if (r.joined) {
            const { events, token } = await engine.pull();
            agenda = applyRemote(current, meta, events).agenda;
            engine.ack(token);
          }
        }
        base = agenda;
        saveState();
        return { ok: true as const, joined: r.joined, agenda };
      });
    },

    stop() {
      return serial(async () => {
        engine.disable();
        meta = emptyMeta();
        base = undefined;
        store.remove('sync:meta');
        store.remove('sync:base');
      });
    },
  };
}

export type SyncClient = ReturnType<typeof createSyncClient>;
