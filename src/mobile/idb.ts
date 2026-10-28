/**
 * A small key-value store in IndexedDB (the phone app's disk). Keys:
 *   collection:<name>  JSON text of a collection (documents without their text)
 *   content:<id>       a document's text
 *   media:<name>       an image (Blob)
 *   backup:<stamp>     a full backup (JSON text), the last few kept
 *   sync:<what>        synchronisation state (see webdavSync.ts)
 */
const DB = 'saudade';
const STORE = 'kv';

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return opening;
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = body(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

export const idbGet = <T = unknown>(key: string) => run<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
export const idbSet = (key: string, value: unknown) => run('readwrite', (s) => void s.put(value, key));
export const idbDelete = (key: string) => run('readwrite', (s) => void s.delete(key));

/** Several writes in one transaction: all or nothing. */
export const idbBatch = (puts: Array<[string, unknown]>, deletes: string[] = []) =>
  run('readwrite', (s) => {
    for (const [k, v] of puts) s.put(v, k);
    for (const k of deletes) s.delete(k);
  });

/** Keys starting with `prefix`. */
export const idbKeys = (prefix: string) =>
  run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`))).then(
    (keys) => (keys ?? []).map(String)
  );
