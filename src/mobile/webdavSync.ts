/**
 * Synchronisation for the phone app: the same shared folder as the desktop app
 * (electron/sync.cjs: saudade-sync.json, one encrypted log per device, media/*.enc),
 * reached through Nextcloud's WebDAV instead of a local folder. Same encryption:
 * scrypt (same parameters) and AES-256-GCM, lines and files laid out as
 * iv(12) | tag(16) | ciphertext, so both apps read each other's files.
 *
 * On the phone, requests go through Capacitor's native HTTP (no browser CORS rules,
 * which Nextcloud doesn't answer); in a browser (tests), through fetch.
 * WebDAV can't append to a file: this device's log is kept here and uploaded whole
 * (it stays small: compacted past 4 MB, see lib/sync/client.ts).
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { syncScrypt } from 'scrypt-js';
import { idbDelete, idbGet, idbSet } from './idb';
import { mediaNames, storeMedia } from './bridge';
import type { SyncEvent } from '../lib/sync/model';

const HEADER = 'saudade-sync.json';
const CHECK = 'saudade-sync-ok';
const LOG_RE = /^[0-9a-f]{16}(-g\d+)?\.log$/;
const MEDIA_RE = /^[0-9a-f]{32}\.[a-z0-9]{2,5}\.enc$/;

interface Config {
  deviceId: string;
  url?: string | null;
  user?: string | null;
  password?: string | null;
  key?: string | null; // hex
  offsets: Record<string, number>;
  generation: number;
  lastSync: string | null;
  uploaded: number; // how much of this device's log the server has
}

/** Where to reach the folder: Nextcloud's WebDAV address of the folder, and an app password. */
export interface WebdavSpec {
  url: string;
  user: string;
  password: string;
}

// ---- Bytes, base64, crypto --------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const deriveKey = (passphrase: string, salt: Uint8Array) =>
  Uint8Array.from(syncScrypt(enc.encode(passphrase.normalize('NFC')), salt, 1 << 15, 8, 1, 32));

const aesKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function encrypt(raw: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(raw), data as BufferSource));
  // WebCrypto gives ciphertext | tag; the folder's layout is iv | tag | ciphertext.
  const tag = out.subarray(out.length - 16);
  const body = out.subarray(0, out.length - 16);
  const res = new Uint8Array(12 + 16 + body.length);
  res.set(iv, 0);
  res.set(tag, 12);
  res.set(body, 28);
  return res;
}

async function decrypt(raw: Uint8Array, buf: Uint8Array): Promise<Uint8Array> {
  const joined = new Uint8Array(buf.length - 12);
  joined.set(buf.subarray(28), 0);
  joined.set(buf.subarray(12, 28), buf.length - 28);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) as BufferSource }, await aesKey(raw), joined as BufferSource));
}

// ---- WebDAV -----------------------------------------------------------------------

interface Reply {
  status: number;
  text: string;
  bytes: Uint8Array;
}

async function request(
  spec: WebdavSpec,
  method: string,
  name: string,
  options: { headers?: Record<string, string>; body?: string; binary?: boolean } = {}
): Promise<Reply> {
  const url = `${spec.url.replace(/\/+$/, '')}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${spec.user}:${spec.password}`)))}`, ...options.headers };
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({ method, url, headers, data: options.body, responseType: options.binary ? 'arraybuffer' : 'text' });
    const data = typeof r.data === 'string' ? r.data : r.data == null ? '' : JSON.stringify(r.data);
    return { status: r.status, text: options.binary ? '' : data, bytes: options.binary ? fromB64(data) : enc.encode(data) };
  }
  const r = await fetch(url, { method, headers, body: options.body });
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, text: options.binary ? '' : dec.decode(bytes), bytes };
}

const ok = (r: Reply) => r.status >= 200 && r.status < 300;
const httpError = (r: Reply, what: string) =>
  new Error(r.status === 401 ? 'identifiant ou mot de passe refusé' : r.status === 404 ? `${what} introuvable` : `${what} : erreur ${r.status}`);

/** Names and sizes in a folder (PROPFIND, depth 1); null when the folder doesn't exist. */
async function list(spec: WebdavSpec, folder = ''): Promise<Map<string, number> | null> {
  const r = await request(spec, 'PROPFIND', folder, {
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>',
  });
  if (r.status === 404) return null;
  if (r.status !== 207) throw httpError(r, 'dossier');
  const doc = new DOMParser().parseFromString(r.text, 'application/xml');
  const out = new Map<string, number>();
  for (const res of Array.from(doc.getElementsByTagNameNS('DAV:', 'response'))) {
    const href = decodeURIComponent(res.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? '');
    const name = href.replace(/\/+$/, '').split('/').pop() ?? '';
    const isDir = res.getElementsByTagNameNS('DAV:', 'collection').length > 0;
    if (!name || isDir) continue;
    out.set(name, Number(res.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent ?? 0));
  }
  return out;
}

// ---- The bridge (same interface as the desktop's, see lib/sync/client.ts) ----------------

export async function createWebdavSync() {
  const config: Config = { deviceId: toHex(randomBytes(8)), offsets: {}, generation: 0, lastSync: null, uploaded: 0, ...((await idbGet<Config>('sync:config')) ?? {}) };
  const save = () => idbSet('sync:config', config);
  await save();
  let lastError: string | null = null;
  let ownLog = (await idbGet<string>('sync:ownlog')) ?? '';

  const spec = (): WebdavSpec | null => (config.url && config.user && config.password ? { url: config.url, user: config.user, password: config.password } : null);
  const key = () => (config.key ? fromHex(config.key) : null);
  const enabled = () => Boolean(spec() && key());
  const ownName = (g = config.generation) => (g > 0 ? `${config.deviceId}-g${g}.log` : `${config.deviceId}.log`);
  const devices = (files: Map<string, number>) =>
    new Set([...files.keys()].filter((f) => LOG_RE.test(f) && f.slice(0, 16) !== config.deviceId).map((f) => f.slice(0, 16))).size;
  const pendingLines = () => (ownLog.length > config.uploaded ? ownLog.slice(config.uploaded).split('\n').filter(Boolean).length : 0);
  let others = 0;

  const fail = (e: unknown) => {
    lastError = `Nextcloud inaccessible : ${e instanceof Error ? e.message : String(e)}`;
  };

  /** Uploads this device's log when the server is behind. */
  async function flush() {
    const s = spec();
    if (!s || ownLog.length <= config.uploaded) return;
    try {
      const r = await request(s, 'PUT', ownName(), { body: ownLog, headers: { 'Content-Type': 'text/plain' } });
      if (!ok(r)) throw httpError(r, 'envoi');
      config.uploaded = ownLog.length;
      await save();
      lastError = null;
    } catch (e) {
      fail(e);
    }
  }

  async function encryptLines(events: SyncEvent[]) {
    const k = key()!;
    const lines = await Promise.all(events.map(async (e) => toB64(await encrypt(k, enc.encode(JSON.stringify(e))))));
    return lines.join('\n') + '\n';
  }

  async function status() {
    return { enabled: enabled(), folder: config.url ?? null, deviceId: config.deviceId, lastSync: config.lastSync, pending: pendingLines(), others, ownLogBytes: ownLog.length, error: lastError };
  }

  return {
    kind: 'webdav' as const,
    initial: { status: await status(), meta: (await idbGet<string>('sync:meta')) ?? '' },
    status,
    chooseFolder: async () => null,

    /** spec: JSON of WebdavSpec. */
    async inspect(specText: string) {
      try {
        const s = JSON.parse(specText) as WebdavSpec;
        const files = await list(s);
        if (!files) return { ok: true, used: false, others: 0 };
        return { ok: true, used: files.has(HEADER), others: devices(files) };
      } catch (e) {
        return { ok: false, error: `Connexion impossible : ${e instanceof Error ? e.message : String(e)}` };
      }
    },

    async enable(specText: string, passphrase: string) {
      if (!passphrase || passphrase.length < 8) return { ok: false, error: 'La phrase de passe doit faire au moins 8 caractères.' };
      try {
        const s = JSON.parse(specText) as WebdavSpec;
        let files = await list(s);
        if (!files) {
          const r = await request(s, 'MKCOL', '');
          if (!ok(r)) throw httpError(r, 'création du dossier');
          files = new Map();
        }
        let k: Uint8Array;
        if (files.has(HEADER)) {
          const r = await request(s, 'GET', HEADER);
          if (!ok(r)) throw httpError(r, HEADER);
          const header = JSON.parse(r.text);
          k = deriveKey(passphrase, fromB64(header.salt));
          try {
            if (dec.decode(await decrypt(k, fromB64(header.check))) !== CHECK) throw new Error();
          } catch {
            return { ok: false, error: 'Phrase de passe incorrecte pour ce dossier.' };
          }
        } else {
          const salt = randomBytes(16);
          k = deriveKey(passphrase, salt);
          const header = { app: 'saudade-sync', version: 1, salt: toB64(salt), check: toB64(await encrypt(k, enc.encode(CHECK))) };
          const r = await request(s, 'PUT', HEADER, { body: JSON.stringify(header, null, 2), headers: { 'Content-Type': 'application/json' } });
          if (!ok(r)) throw httpError(r, 'en-tête');
        }
        Object.assign(config, { url: s.url, user: s.user, password: s.password, key: toHex(k), offsets: {}, generation: 0, lastSync: null, uploaded: 0 });
        ownLog = '';
        await idbSet('sync:ownlog', ownLog);
        await save();
        others = devices(files);
        lastError = null;
        return { ok: true, joined: files.has(HEADER) && others > 0 };
      } catch (e) {
        return { ok: false, error: `Connexion impossible : ${e instanceof Error ? e.message : String(e)}` };
      }
    },

    async disable() {
      Object.assign(config, { url: null, user: null, password: null, key: null, offsets: {}, generation: 0, lastSync: null, uploaded: 0 });
      ownLog = '';
      await idbSet('sync:ownlog', '');
      await idbDelete('sync:meta');
      await save();
      lastError = null;
    },

    async append(events: SyncEvent[]) {
      if (!enabled() || events.length === 0) return;
      ownLog += await encryptLines(events);
      await idbSet('sync:ownlog', ownLog);
      await flush();
    },

    async pull() {
      const s = spec();
      const k = key();
      if (!s || !k) return { events: [], token: null };
      await flush();
      const events: SyncEvent[] = [];
      const token: Record<string, number> = {};
      let unreadable = 0;
      try {
        const files = (await list(s)) ?? new Map<string, number>();
        others = devices(files);
        // Images this phone doesn't have yet (the phone adds none).
        const media = (await list(s, 'media')) ?? new Map<string, number>();
        const have = new Set(await mediaNames());
        for (const file of media.keys()) {
          const name = file.slice(0, -'.enc'.length);
          if (!MEDIA_RE.test(file) || have.has(name)) continue;
          const r = await request(s, 'GET', `media/${file}`, { binary: true });
          if (!ok(r)) continue;
          try {
            await storeMedia(name, await decrypt(k, r.bytes));
          } catch {
            // still uploading, or not ours: next time
          }
        }
        for (const [name, size] of files) {
          if (!LOG_RE.test(name) || name.slice(0, 16) === config.deviceId) continue;
          let from = config.offsets[name] ?? 0;
          if (size < from) from = 0; // replaced: read again (applying twice is harmless)
          if (size === from) continue;
          const r = await request(s, 'GET', name, { headers: { Range: `bytes=${from}-` } });
          if (!ok(r)) throw httpError(r, name);
          const bytes = r.status === 206 ? r.bytes : r.bytes.subarray(from);
          const end = bytes.lastIndexOf(0x0a);
          if (end < 0) continue;
          for (const line of dec.decode(bytes.subarray(0, end)).split('\n')) {
            if (!line) continue;
            try {
              events.push(JSON.parse(dec.decode(await decrypt(k, fromB64(line)))));
            } catch {
              unreadable++;
            }
          }
          token[name] = from + end + 1;
        }
        lastError = unreadable > 0 ? `${unreadable} ligne(s) illisible(s) ignorée(s) (autre phrase de passe ?).` : null;
      } catch (e) {
        fail(e);
      }
      return { events, token };
    },

    async ack(token: Record<string, number> | null) {
      if (!enabled()) return;
      if (token) Object.assign(config.offsets, token);
      config.lastSync = new Date().toISOString();
      await save();
    },

    async compact(events: SyncEvent[]) {
      const s = spec();
      if (!s || !enabled() || events.length === 0) return { ok: false };
      const previous = ownName();
      const generation = config.generation + 1;
      const text = await encryptLines(events);
      const r = await request(s, 'PUT', ownName(generation), { body: text, headers: { 'Content-Type': 'text/plain' } });
      if (!ok(r)) {
        fail(httpError(r, 'compactage'));
        return { ok: false };
      }
      config.generation = generation;
      ownLog = text;
      config.uploaded = text.length;
      await idbSet('sync:ownlog', ownLog);
      await save();
      await request(s, 'DELETE', previous).catch(() => undefined);
      return { ok: true, bytes: text.length };
    },

    saveMeta: (text: string) => idbSet('sync:meta', text),
  };
}
