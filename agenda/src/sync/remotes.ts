/**
 * Ways to reach the shared folder.
 * - WebDAV (Nextcloud): the folder's WebDAV address, a user and an app password. Requests go through
 *   the app's native HTTP when it has one (desktop and phone apps: no browser CORS rules, which
 *   Nextcloud doesn't answer), else through fetch.
 * - A folder of the device that a sync client keeps up to date (Nextcloud or Syncthing client on a
 *   computer, Syncthing on a phone), through the native app.
 */
import type { Remote, SyncConfig } from './engine.ts';
import { fromB64, toB64 } from './engine.ts';

export interface WebdavWhere {
  kind: 'webdav';
  label: string;
  url: string;
  user: string;
  password: string;
}
export interface FolderWhere {
  kind: 'folder';
  label: string;
  /** What the native app needs to open the folder again (a path, or an Android access URI). */
  ref: string;
}
export type Where = WebdavWhere | FolderWhere;

/** What a native shell (desktop or phone app) provides to the page, on window.agendaNative. */
export interface NativeBridge {
  platform: 'desktop' | 'android';
  http?(o: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; data: string /* base64 */ }>;
  folder?: {
    pick(): Promise<{ ref: string; label: string } | null>;
    list(o: { ref: string }): Promise<{ exists: boolean; files?: { name: string; size: number }[] }>;
    read(o: { ref: string; name: string; from: number }): Promise<{ exists: boolean; data?: string /* base64 */ }>;
    write(o: { ref: string; name: string; data: string /* base64 */ }): Promise<void>;
    remove(o: { ref: string; name: string }): Promise<void>;
  };
}

export const native = (): NativeBridge | undefined => (globalThis as { agendaNative?: NativeBridge }).agendaNative;

const enc = new TextEncoder();
const dec = new TextDecoder();

interface Reply {
  status: number;
  bytes: Uint8Array;
}

async function request(w: WebdavWhere, method: string, name: string, options: { headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  const url = `${w.url.replace(/\/+$/, '')}/${name.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
  const auth = btoa(String.fromCharCode(...enc.encode(`${w.user}:${w.password}`)));
  const headers = { Authorization: `Basic ${auth}`, ...options.headers };
  const http = native()?.http;
  if (http) {
    const r = await http({ url, method, headers, body: options.body });
    return { status: r.status, bytes: fromB64(r.data) };
  }
  const r = await fetch(url, { method, headers, body: options.body });
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
}

const ok = (r: Reply) => r.status >= 200 && r.status < 300;
const httpError = (r: Reply, what: string) =>
  new Error(r.status === 401 ? 'identifiant ou mot de passe refusé' : r.status === 404 ? `${what} introuvable` : `${what} : erreur ${r.status}`);

export function webdavRemote(w: WebdavWhere): Remote {
  return {
    async list() {
      const r = await request(w, 'PROPFIND', '', {
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>',
      });
      if (r.status === 404) return null;
      if (r.status !== 207) throw httpError(r, 'dossier');
      const doc = new DOMParser().parseFromString(dec.decode(r.bytes), 'application/xml');
      const out = new Map<string, number>();
      for (const res of Array.from(doc.getElementsByTagNameNS('DAV:', 'response'))) {
        const href = decodeURIComponent(res.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? '');
        const name = href.replace(/\/+$/, '').split('/').pop() ?? '';
        if (!name || res.getElementsByTagNameNS('DAV:', 'collection').length > 0) continue;
        out.set(name, Number(res.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent ?? 0));
      }
      return out;
    },
    async read(name, from = 0) {
      const r = await request(w, 'GET', name, { headers: from > 0 ? { Range: `bytes=${from}-` } : {} });
      if (r.status === 404) return null;
      if (!ok(r)) throw httpError(r, name);
      return r.status === 206 || from === 0 ? r.bytes : r.bytes.subarray(from);
    },
    async write(name, text) {
      const r = await request(w, 'PUT', name, { body: text, headers: { 'Content-Type': name.endsWith('.json') ? 'application/json' : 'text/plain' } });
      if (!ok(r)) throw httpError(r, `envoi de ${name}`);
    },
    async remove(name) {
      await request(w, 'DELETE', name);
    },
    async create() {
      const r = await request(w, 'MKCOL', '');
      if (!ok(r)) throw httpError(r, 'création du dossier');
    },
  };
}

export function folderRemote(w: FolderWhere): Remote {
  const folder = () => {
    const f = native()?.folder;
    if (!f) throw new Error("dossier accessible seulement depuis l'application");
    return f;
  };
  return {
    async list() {
      const r = await folder().list({ ref: w.ref });
      return r.exists ? new Map((r.files ?? []).map((f) => [f.name, f.size])) : null;
    },
    async read(name, from = 0) {
      const r = await folder().read({ ref: w.ref, name, from });
      return r.exists ? fromB64(r.data ?? '') : null;
    },
    write: (name, text) => folder().write({ ref: w.ref, name, data: toB64(enc.encode(text)) }),
    remove: (name) => folder().remove({ ref: w.ref, name }),
    async create() {
      // The folder was chosen, so it exists.
    },
  };
}

export const remoteFor = (where: NonNullable<SyncConfig['where']>): Remote =>
  where.kind === 'folder' ? folderRemote(where as unknown as FolderWhere) : webdavRemote(where as unknown as WebdavWhere);
