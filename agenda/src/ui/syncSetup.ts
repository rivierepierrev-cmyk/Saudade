import { createEngine, type Store } from '../sync/engine.ts';
import { createSyncClient } from '../sync/client.ts';
import { remoteFor } from '../sync/remotes.ts';

/** The sync state in this device's storage (agenda.sync:…). */
const localStore: Store = {
  get<T>(key: string) {
    try {
      const raw = localStorage.getItem(`agenda.${key}`);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`agenda.${key}`, JSON.stringify(value));
    } catch {
      // Storage full or unavailable: the next sync tries again.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(`agenda.${key}`);
    } catch {
      // Nothing to do.
    }
  },
};

export const syncClient = createSyncClient(createEngine(localStore, remoteFor), localStore);

/** How often the other devices are read, besides at start and when the app comes back to the front. */
export const SYNC_EVERY_MS = 2 * 60 * 1000;
