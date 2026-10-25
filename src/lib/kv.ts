/**
 * Low-level key/value persistence.
 * - Desktop (Electron): JSON files in the app's data folder, via the preload bridge.
 *   The whole library is loaded once at startup and kept in memory; writes are sent
 *   to the main process, which writes them atomically.
 * - Browser (npm run dev): localStorage.
 * Older versions stored everything in localStorage under gemma_* / foliole_* keys;
 * those are copied over once and left untouched as a fallback copy.
 */

export type CollectionName = 'documents' | 'extracts' | 'clozes' | 'reviewLogs' | 'settings' | 'folders';

export const COLLECTIONS: CollectionName[] = ['documents', 'extracts', 'clozes', 'reviewLogs', 'settings', 'folders'];

interface DesktopInitial {
  files?: Partial<Record<CollectionName, string>>;
  warnings?: string[];
  isNew?: boolean;
  dataDir?: string;
  error?: string;
}

interface DesktopBridge {
  initial: DesktopInitial;
  write: (name: CollectionName, text: string) => Promise<void>;
  snapshot: (reason: string) => Promise<string>;
  openDataFolder: () => Promise<string>;
}

declare global {
  interface Window {
    gemmaDesktop?: DesktopBridge;
  }
}

const LEGACY_KEYS: Record<CollectionName, string[]> = {
  documents: ['gemma_documents_fr_v2', 'foliole_documents_fr_v2'],
  extracts: ['gemma_extracts_fr_v2', 'foliole_extracts_fr_v2'],
  clozes: ['gemma_clozes_fr_v2', 'foliole_clozes_fr_v2'],
  reviewLogs: ['gemma_review_logs_fr_v2', 'foliole_review_logs_fr_v2'],
  settings: ['gemma_settings_fr_v2', 'foliole_settings_fr_v2'],
  folders: ['gemma_folders_fr_v2', 'foliole_folders_fr_v2'],
};

const browserKey = (name: CollectionName) => `gemma.v3.${name}`;

// ---- Error reporting -------------------------------------------------------

type ErrorListener = (message: string) => void;
const listeners = new Set<ErrorListener>();
const pendingMessages: string[] = [];

export function reportStorageError(message: string): void {
  console.error('[Gemma storage]', message);
  if (listeners.size === 0) pendingMessages.push(message);
  listeners.forEach((l) => l(message));
}

export function onStorageError(listener: ErrorListener): () => void {
  listeners.add(listener);
  pendingMessages.splice(0).forEach((m) => listener(m));
  return () => listeners.delete(listener);
}

// ---- Backends --------------------------------------------------------------

function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readLegacy(name: CollectionName): string | null {
  // Also the keys used while the app was called Foliole (browser mode).
  for (const key of [...LEGACY_KEYS[name], `foliole.v3.${name}`]) {
    const value = safeLocalGet(key);
    if (value) return value;
  }
  return null;
}

const desktop = typeof window !== 'undefined' ? window.gemmaDesktop : undefined;
const cache = new Map<CollectionName, string>();

if (desktop) {
  const initial = desktop.initial || {};
  if (initial.error) reportStorageError(`Lecture des données impossible : ${initial.error}`);
  (initial.warnings || []).forEach(reportStorageError);
  for (const name of COLLECTIONS) {
    const text = initial.files?.[name];
    if (typeof text === 'string') cache.set(name, text);
  }
  if (initial.isNew && !initial.error) {
    // First launch of the file-based version: bring over the old localStorage library.
    for (const name of COLLECTIONS) {
      const legacy = readLegacy(name);
      if (legacy) setRaw(name, legacy);
    }
  }
} else {
  for (const name of COLLECTIONS) {
    if (safeLocalGet(browserKey(name)) === null) {
      const legacy = readLegacy(name);
      if (legacy) setRaw(name, legacy);
    }
  }
}

export const isDesktop = Boolean(desktop);
export const dataLocation: string | undefined = desktop?.initial?.dataDir;

export function getRaw(name: CollectionName): string | null {
  if (desktop) return cache.get(name) ?? null;
  return safeLocalGet(browserKey(name));
}

export function setRaw(name: CollectionName, text: string): void {
  if (desktop) {
    cache.set(name, text);
    desktop.write(name, text).catch((e: unknown) => {
      reportStorageError(`Échec de l'enregistrement (${name}) : ${e instanceof Error ? e.message : String(e)}`);
    });
    return;
  }
  try {
    localStorage.setItem(browserKey(name), text);
  } catch (e) {
    reportStorageError(
      `Échec de l'enregistrement (${name}) : ${e instanceof Error ? e.message : String(e)}. ` +
        "L'espace du navigateur est peut-être plein : exportez une sauvegarde."
    );
  }
}

/** Saves a full snapshot in the data folder (desktop only). Returns its path. */
export async function takeSnapshot(reason: string): Promise<string | null> {
  if (!desktop) return null;
  return desktop.snapshot(reason);
}

export function openDataFolder(): void {
  desktop?.openDataFolder();
}
