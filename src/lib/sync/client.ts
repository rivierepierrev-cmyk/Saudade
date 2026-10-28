/**
 * Synchronisation, page side: records each change as it is saved, sends the events
 * to the main process (electron/sync.cjs writes them to the shared folder), and
 * applies the other computers' events (merge rules: ./model.ts).
 */
import { SaudadeStorage, AppSettings, observeSaves } from '../storage';
import { takeSnapshot } from '../kv';
import {
  Change, Library, LibraryKey, SyncEvent, SyncMeta, applyRemote, diffCollection, emptyMeta, eventsFromChanges, noteLocal, snapshotEvents,
} from './model';

export interface SyncStatus {
  enabled: boolean;
  folder: string | null;
  deviceId: string;
  lastSync: string | null;
  pending: number;
  others: number;
  error: string | null;
}

interface SyncBridge {
  initial: { status?: SyncStatus; meta?: string; error?: string };
  status: () => Promise<SyncStatus>;
  chooseFolder: () => Promise<string | null>;
  inspect: (folder: string) => Promise<{ ok: boolean; used?: boolean; others?: number; error?: string }>;
  enable: (folder: string, passphrase: string) => Promise<{ ok: boolean; joined?: boolean; error?: string }>;
  disable: () => Promise<void>;
  append: (events: SyncEvent[]) => Promise<void>;
  pull: () => Promise<{ events: SyncEvent[]; token: Record<string, number> | null }>;
  ack: (token: Record<string, number> | null) => Promise<void>;
  saveMeta: (text: string) => Promise<void>;
}

const bridge: SyncBridge | undefined =
  typeof window !== 'undefined' ? (window.saudadeDesktop as unknown as { sync?: SyncBridge } | undefined)?.sync : undefined;

export const syncAvailable = Boolean(bridge);

let status: SyncStatus | null = bridge?.initial?.status ?? null;
let meta: SyncMeta | null = null;
if (status?.enabled) {
  try {
    meta = bridge!.initial.meta ? { ...emptyMeta(), ...JSON.parse(bridge!.initial.meta) } : emptyMeta();
  } catch {
    meta = emptyMeta();
  }
}

const LIBRARY_KEYS: LibraryKey[] = ['documents', 'extracts', 'clozes', 'reviewLogs', 'folders', 'settings'];
const isLibraryKey = (name: string): name is LibraryKey => (LIBRARY_KEYS as string[]).includes(name);

// ---- Listeners ----------------------------------------------------------------

type Listener = () => void;
const libraryListeners = new Set<Listener>();
const statusListeners = new Set<Listener>();

/** Called after other computers' changes were applied: reload the library. */
export function onLibraryChanged(listener: Listener): () => void {
  libraryListeners.add(listener);
  return () => libraryListeners.delete(listener);
}
export function onStatusChanged(listener: Listener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
export const getStatus = () => status;

async function refreshStatus() {
  if (!bridge) return;
  status = await bridge.status();
  statusListeners.forEach((l) => l());
}

// ---- Clocks, saved shortly after changes ------------------------------------------

let metaTimer: ReturnType<typeof setTimeout> | undefined;
function compactMeta(m: SyncMeta): SyncMeta {
  // An item whose fields all have the same clock keeps just one.
  const clocks = Object.fromEntries(
    Object.entries(m.clocks).map(([coll, items]) => [
      coll,
      Object.fromEntries(
        Object.entries(items).map(([id, fields]) => {
          const values = new Set(Object.values(fields));
          return [id, values.size === 1 ? { _: [...values][0] } : fields];
        })
      ),
    ])
  ) as SyncMeta['clocks'];
  return { ...m, clocks };
}
function saveMetaNow() {
  clearTimeout(metaTimer);
  metaTimer = undefined;
  if (bridge && meta) void bridge.saveMeta(JSON.stringify(compactMeta(meta)));
}
function saveMetaSoon() {
  if (!metaTimer) metaTimer = setTimeout(saveMetaNow, 1500);
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => metaTimer && saveMetaNow());

// ---- Recording local changes ------------------------------------------------------

let applying = false;
let batch: Change[] = [];
let batchScheduled = false;

function flushBatch() {
  batchScheduled = false;
  const changes = batch.splice(0);
  if (!bridge || !meta || !status || changes.length === 0) return;
  const events = eventsFromChanges(changes, new Date(), status.deviceId, meta);
  if (events.length === 0) return;
  noteLocal(meta, events);
  void bridge.append(events).then(refreshStatus);
  saveMetaSoon();
}

// Changes saved during the same user action (a review saves the card, then the
// history) are sent together: see eventsFromChanges.
observeSaves((name, prev, next) => {
  if (applying || !meta || !isLibraryKey(name)) return;
  batch.push(...diffCollection(name, prev ?? [], next));
  if (!batchScheduled) {
    batchScheduled = true;
    queueMicrotask(flushBatch);
  }
});

const currentLibrary = (): Library => ({
  documents: SaudadeStorage.getDocuments(),
  extracts: SaudadeStorage.getExtracts(),
  clozes: SaudadeStorage.getClozes(),
  reviewLogs: SaudadeStorage.getReviewLogs(),
  folders: SaudadeStorage.getFolders(),
  settings: { ...SaudadeStorage.getSettings() },
});

function saveLibrary(lib: Library, which: Iterable<LibraryKey>) {
  applying = true;
  try {
    for (const key of which) {
      if (key === 'documents') SaudadeStorage.saveDocuments(lib.documents);
      if (key === 'extracts') SaudadeStorage.saveExtracts(lib.extracts);
      if (key === 'clozes') SaudadeStorage.saveClozes(lib.clozes);
      if (key === 'reviewLogs') SaudadeStorage.saveReviewLogs(lib.reviewLogs);
      if (key === 'folders') SaudadeStorage.saveFolders(lib.folders.length > 0 ? lib.folders : ['Général']);
      if (key === 'settings') SaudadeStorage.saveSettings({ ...SaudadeStorage.getSettings(), ...(lib.settings as Partial<AppSettings>) });
    }
  } finally {
    applying = false;
  }
}

// ---- Applying the other computers' changes ------------------------------------------

let pulling: Promise<number> | null = null;

/** Fetches and applies what the other computers did. Returns how many events were applied. */
export function syncNow(): Promise<number> {
  if (!bridge || !meta) return Promise.resolve(0);
  if (!pulling) {
    pulling = (async () => {
      flushBatch();
      const { events, token } = await bridge.pull();
      if (events.length > 0 && meta) {
        const { lib, changed } = applyRemote(currentLibrary(), meta, events, SaudadeStorage.getSettings().targetRetention);
        saveLibrary(lib, changed);
        saveMetaNow();
        if (changed.size > 0) libraryListeners.forEach((l) => l());
      }
      await bridge.ack(token);
      await refreshStatus();
      return events.length;
    })().finally(() => {
      pulling = null;
    });
  }
  return pulling;
}

// ---- Turning it on and off ----------------------------------------------------------

export const chooseFolder = () => bridge?.chooseFolder() ?? Promise.resolve(null);
export const inspectFolder = (folder: string) => bridge!.inspect(folder);

/**
 * Turns synchronisation on. `replace`: this computer takes the library already in
 * the folder (its own is saved in a backup first); otherwise its library is sent
 * and merged with what is there.
 */
export async function enableSync(folder: string, passphrase: string, replace: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!bridge) return { ok: false, error: 'Synchronisation disponible dans l’application de bureau seulement.' };
  const r = await bridge.enable(folder, passphrase);
  if (!r.ok) return { ok: false, error: r.error };
  await refreshStatus();
  meta = emptyMeta();
  if (replace) {
    await takeSnapshot('avant-synchronisation');
    // The library is replaced; settings stay until the folder's arrive.
    const empty = { documents: [], extracts: [], clozes: [], reviewLogs: [], folders: ['Général'], settings: {} };
    saveLibrary(empty, LIBRARY_KEYS.filter((k) => k !== 'settings'));
    libraryListeners.forEach((l) => l());
  } else {
    const events = snapshotEvents(currentLibrary(), new Date(), status!.deviceId, meta);
    noteLocal(meta, events);
    await bridge.append(events);
  }
  saveMetaNow();
  await syncNow();
  return { ok: true };
}

export async function disableSync(): Promise<void> {
  if (!bridge) return;
  batch = [];
  meta = null;
  await bridge.disable();
  await refreshStatus();
}
