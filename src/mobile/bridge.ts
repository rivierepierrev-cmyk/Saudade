/**
 * The phone app's counterpart of the desktop preload (electron/preload.cjs): the same
 * window.saudadeDesktop interface, backed by IndexedDB instead of files. The rest of
 * the app (lib/kv.ts, lib/sync/client.ts…) works unchanged on top of it.
 */
import { idbBatch, idbDelete, idbGet, idbKeys, idbSet } from './idb';
import { setMediaResolver } from '../lib/media';
import { createWebdavSync } from './webdavSync';

const NAMES = ['documents', 'extracts', 'clozes', 'reviewLogs', 'settings', 'folders'] as const;
const BACKUPS_KEPT = 5;

// Writes happen in the order they were asked for, one after the other.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T,>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task);
  queue = next.catch(() => undefined);
  return next;
};

/** documents.json without the texts + the texts that changed (as electron/store.cjs). */
function splitDocuments(docs: Array<Record<string, unknown>>) {
  const changed: Array<[string, string]> = [];
  const meta = docs.map((d) => {
    const { content, ...rest } = d;
    if (typeof content === 'string') changed.push([String(d.id), content]);
    return rest;
  });
  return { metaText: JSON.stringify(meta), changed };
}

async function writeDocuments(metaText: string, changed: Array<[string, string]>) {
  JSON.parse(metaText);
  await idbBatch([...changed.map(([id, text]): [string, unknown] => [`content:${id}`, text]), ['collection:documents', metaText]]);
}

async function readDocuments(text: string, warnings: string[]): Promise<string> {
  const docs = JSON.parse(text) as Array<Record<string, unknown>>;
  for (const d of docs) {
    if (typeof d.content === 'string') continue;
    const content = await idbGet<string>(`content:${d.id}`);
    if (content === undefined) warnings.push(`Le texte du document « ${d.title ?? d.id} » est introuvable.`);
    d.content = content ?? '';
  }
  return JSON.stringify(docs);
}

async function buildBackup(): Promise<string> {
  const read = async (name: string, fallback: unknown) => {
    const text = await idbGet<string>(`collection:${name}`);
    if (!text) return fallback;
    return JSON.parse(name === 'documents' ? await readDocuments(text, []) : text);
  };
  return JSON.stringify({
    app: 'saudade',
    version: 2,
    exportedAt: new Date().toISOString(),
    documents: await read('documents', []),
    extracts: await read('extracts', []),
    clozes: await read('clozes', []),
    logs: await read('reviewLogs', []),
    settings: await read('settings', {}),
    folders: await read('folders', []),
  });
}

// ---- Images -------------------------------------------------------------------

const mediaUrls = new Map<string, string>();
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

/** Keeps an image (from the sync) and makes it displayable. */
export async function storeMedia(name: string, bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream' });
  await idbSet(`media:${name}`, blob);
  if (!mediaUrls.has(name)) mediaUrls.set(name, URL.createObjectURL(blob));
}
export async function mediaNames(): Promise<string[]> {
  return (await idbKeys('media:')).map((k) => k.slice('media:'.length));
}
export async function mediaBytes(name: string): Promise<Uint8Array | null> {
  const blob = await idbGet<Blob>(`media:${name}`);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

// ---- Installation -----------------------------------------------------------------

export async function installMobileBridge(): Promise<void> {
  const warnings: string[] = [];
  const files: Record<string, string> = {};
  for (const name of NAMES) {
    const text = await idbGet<string>(`collection:${name}`);
    if (typeof text !== 'string') continue;
    try {
      files[name] = name === 'documents' ? await readDocuments(text, warnings) : (JSON.parse(text), text);
    } catch {
      warnings.push(`Les données « ${name} » sont illisibles.`);
    }
  }
  for (const name of await mediaNames()) {
    const blob = await idbGet<Blob>(`media:${name}`);
    if (blob) mediaUrls.set(name, URL.createObjectURL(blob));
  }
  setMediaResolver((name) => mediaUrls.get(name));

  const sync = await createWebdavSync();
  const bridge = {
    initial: { files, warnings, isNew: Object.keys(files).length === 0, dataDir: 'Téléphone (stockage de l’application)' },
    write: (name: string, text: string) =>
      serial(async () => {
        const value = JSON.parse(text);
        if (name === 'documents' && Array.isArray(value)) {
          const { metaText, changed } = splitDocuments(value);
          await writeDocuments(metaText, changed);
        } else {
          await idbSet(`collection:${name}`, text);
        }
      }),
    writeDocuments: (metaText: string, changed: Array<[string, string]>) => serial(() => writeDocuments(metaText, changed)),
    snapshot: (reason: string) =>
      serial(async () => {
        const key = `backup:${new Date().toISOString()}-${String(reason).replace(/[^a-z0-9-]/gi, '').slice(0, 30)}`;
        await idbSet(key, await buildBackup());
        const all = (await idbKeys('backup:')).sort();
        for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) await idbDelete(old);
        return key;
      }),
    openDataFolder: async () => '',
    sync,
  };
  (window as unknown as { saudadeDesktop: unknown }).saudadeDesktop = bridge;
}
