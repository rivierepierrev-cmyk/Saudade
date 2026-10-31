/**
 * The shared folder, as in Saudade, reached through a `Remote` (WebDAV, a folder of the computer, a
 * folder of the phone). In the folder:
 *   agenda-sync.json   salt of the key + a check value (no data)
 *   <device>.log       this device's events, one encrypted line each, written only by this device:
 *                      no sync conflicts. Once compacted, <device>-g<N>.log replaces it.
 * Encryption as in Saudade: key from the passphrase by scrypt (N=2^15, r=8, p=1), AES-256-GCM, lines
 * laid out as base64(iv(12) | tag(16) | ciphertext).
 * A Remote can't always append to a file, so this device's log is also kept locally and written whole
 * (it stays small: compacted past COMPACT_BYTES).
 */
import scrypt from 'scrypt-js'; // CommonJS: default import, for Node and the bundler alike
import type { SyncEvent } from './model.ts';

export const HEADER = 'agenda-sync.json';
const CHECK = 'agenda-sync-ok';
const LOG_RE = /^[0-9a-f]{16}(-g\d+)?\.log$/;
export const COMPACT_BYTES = 4 * 1024 * 1024;

/** A folder, however it is reached. */
export interface Remote {
  /** Files (not folders) and their sizes; null when the folder doesn't exist. */
  list(): Promise<Map<string, number> | null>;
  /** The file's bytes from `from` on; null when it doesn't exist. */
  read(name: string, from?: number): Promise<Uint8Array | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** Creates the folder itself when missing. */
  create(): Promise<void>;
}

/** Where this device keeps its sync state (localStorage in the app, memory in tests). */
export interface Store {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface SyncConfig {
  deviceId: string;
  /** How to reach the folder (see sync/remotes.ts), and a name to show. */
  where?: { kind: string; label: string; [k: string]: unknown } | null;
  key?: string | null; // hex
  offsets: Record<string, number>;
  generation: number;
  lastSync: string | null;
  uploaded: number;
}

export interface SyncStatus {
  enabled: boolean;
  where: string | null;
  deviceId: string;
  lastSync: string | null;
  pending: number;
  others: number;
  error: string | null;
}

// ---- Bytes and crypto ------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();
export const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (b64: string) => Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const deriveKey = (passphrase: string, salt: Uint8Array) =>
  Uint8Array.from(scrypt.syncScrypt(enc.encode(passphrase.normalize('NFC')), salt, 1 << 15, 8, 1, 32));

const aesKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function encrypt(raw: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(raw), data as BufferSource));
  // WebCrypto gives ciphertext | tag; the folder's layout is iv | tag | ciphertext.
  const res = new Uint8Array(out.length + 12);
  res.set(iv, 0);
  res.set(out.subarray(out.length - 16), 12);
  res.set(out.subarray(0, out.length - 16), 28);
  return res;
}

export async function decrypt(raw: Uint8Array, buf: Uint8Array): Promise<Uint8Array> {
  const joined = new Uint8Array(buf.length - 12);
  joined.set(buf.subarray(28), 0);
  joined.set(buf.subarray(12, 28), buf.length - 28);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) as BufferSource }, await aesKey(raw), joined as BufferSource));
}

// ---- The engine ------------------------------------------------------------------------

/** `remoteFor` turns the saved `where` into a Remote. */
export function createEngine(store: Store, remoteFor: (where: NonNullable<SyncConfig['where']>) => Remote) {
  const config: SyncConfig = { deviceId: toHex(randomBytes(8)), offsets: {}, generation: 0, lastSync: null, uploaded: 0, ...(store.get<SyncConfig>('sync:config') ?? {}) };
  const save = () => store.set('sync:config', config);
  save();
  let ownLog = store.get<string>('sync:ownlog') ?? '';
  let lastError: string | null = null;
  let others = 0;

  const remote = () => (config.where ? remoteFor(config.where) : null);
  const key = () => (config.key ? fromHex(config.key) : null);
  const enabled = () => Boolean(config.where && config.key);
  const ownName = (g = config.generation) => (g > 0 ? `${config.deviceId}-g${g}.log` : `${config.deviceId}.log`);
  const devices = (files: Map<string, number>) =>
    new Set([...files.keys()].filter((f) => LOG_RE.test(f) && f.slice(0, 16) !== config.deviceId).map((f) => f.slice(0, 16))).size;
  const pendingLines = () => (ownLog.length > config.uploaded ? ownLog.slice(config.uploaded).split('\n').filter(Boolean).length : 0);
  const fail = (e: unknown) => {
    lastError = `Dossier de synchronisation inaccessible : ${e instanceof Error ? e.message : String(e)}`;
  };

  async function encryptLines(events: SyncEvent[]) {
    const k = key()!;
    const lines = await Promise.all(events.map(async (e) => toB64(await encrypt(k, enc.encode(JSON.stringify(e))))));
    return lines.join('\n') + '\n';
  }

  /** Uploads this device's log when the folder is behind. */
  async function flush() {
    const r = remote();
    if (!r || ownLog.length <= config.uploaded) return;
    try {
      await r.write(ownName(), ownLog);
      config.uploaded = ownLog.length;
      save();
      lastError = null;
    } catch (e) {
      fail(e);
    }
  }

  const status = (): SyncStatus => ({
    enabled: enabled(),
    where: config.where?.label ?? null,
    deviceId: config.deviceId,
    lastSync: config.lastSync,
    pending: pendingLines(),
    others,
    error: lastError,
  });

  return {
    status,
    deviceId: () => config.deviceId,
    ownLogBytes: () => ownLog.length,

    /** Is the folder already used (by another device)? */
    async inspect(where: NonNullable<SyncConfig['where']>) {
      try {
        const files = await remoteFor(where).list();
        if (!files) return { ok: true as const, used: false, others: 0 };
        return { ok: true as const, used: files.has(HEADER), others: devices(files) };
      } catch (e) {
        return { ok: false as const, error: `Connexion impossible : ${e instanceof Error ? e.message : String(e)}` };
      }
    },

    /** Turns synchronisation on with this folder: creates its header, or checks the passphrase. */
    async enable(where: NonNullable<SyncConfig['where']>, passphrase: string): Promise<{ ok: true; joined: boolean } | { ok: false; error: string }> {
      if (!passphrase || passphrase.length < 8) return { ok: false, error: 'La phrase de passe doit faire au moins 8 caractères.' };
      try {
        const rem = remoteFor(where);
        let files = await rem.list();
        if (!files) {
          await rem.create();
          files = new Map();
        }
        let k: Uint8Array;
        if (files.has(HEADER)) {
          const bytes = await rem.read(HEADER);
          if (!bytes) throw new Error(`${HEADER} introuvable`);
          const header = JSON.parse(dec.decode(bytes));
          k = deriveKey(passphrase, fromB64(header.salt));
          try {
            if (dec.decode(await decrypt(k, fromB64(header.check))) !== CHECK) throw new Error();
          } catch {
            return { ok: false, error: 'Phrase de passe incorrecte pour ce dossier.' };
          }
        } else {
          const salt = randomBytes(16);
          k = deriveKey(passphrase, salt);
          await rem.write(HEADER, JSON.stringify({ app: 'agenda-sync', version: 1, salt: toB64(salt), check: toB64(await encrypt(k, enc.encode(CHECK))) }, null, 2));
        }
        Object.assign(config, { where, key: toHex(k), offsets: {}, generation: 0, lastSync: null, uploaded: 0 });
        ownLog = '';
        store.set('sync:ownlog', ownLog);
        save();
        others = devices(files);
        lastError = null;
        return { ok: true, joined: files.has(HEADER) && others > 0 };
      } catch (e) {
        return { ok: false, error: `Connexion impossible : ${e instanceof Error ? e.message : String(e)}` };
      }
    },

    disable() {
      Object.assign(config, { where: null, key: null, offsets: {}, generation: 0, lastSync: null, uploaded: 0 });
      ownLog = '';
      store.remove('sync:ownlog');
      save();
      lastError = null;
      others = 0;
    },

    /** This device's events: kept locally, then written to the folder. */
    async append(events: SyncEvent[]) {
      if (!enabled() || events.length === 0) return;
      ownLog += await encryptLines(events);
      store.set('sync:ownlog', ownLog);
      await flush();
    },

    /** New events of the other devices, from where they were last read. Positions move on ack(token). */
    async pull(): Promise<{ events: SyncEvent[]; token: Record<string, number> | null }> {
      const rem = remote();
      const k = key();
      if (!rem || !k) return { events: [], token: null };
      await flush();
      const events: SyncEvent[] = [];
      const token: Record<string, number> = {};
      let unreadable = 0;
      try {
        const files = (await rem.list()) ?? new Map<string, number>();
        others = devices(files);
        for (const [name, size] of files) {
          if (!LOG_RE.test(name) || name.slice(0, 16) === config.deviceId) continue;
          let from = config.offsets[name] ?? 0;
          if (size < from) from = 0; // replaced: read again (applying twice is harmless)
          if (size === from) continue;
          const bytes = await rem.read(name, from);
          if (!bytes) continue;
          const end = bytes.lastIndexOf(0x0a); // complete lines only
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
        return { events: [], token: null };
      }
      return { events, token };
    },

    ack(token: Record<string, number> | null) {
      if (!enabled()) return;
      if (token) Object.assign(config.offsets, token);
      config.lastSync = new Date().toISOString();
      save();
    },

    /** Replaces this device's log by `events` (the whole state) under a new name, then removes the old one. */
    async compact(events: SyncEvent[]) {
      const rem = remote();
      if (!rem || !enabled() || events.length === 0) return { ok: false };
      const previous = ownName();
      const generation = config.generation + 1;
      const text = await encryptLines(events);
      try {
        await rem.write(ownName(generation), text);
      } catch (e) {
        fail(e);
        return { ok: false };
      }
      config.generation = generation;
      ownLog = text;
      config.uploaded = text.length;
      store.set('sync:ownlog', ownLog);
      save();
      await rem.remove(previous).catch(() => undefined);
      return { ok: true, bytes: text.length };
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;

/** A folder kept in memory: for tests. */
export function memoryRemote(files = new Map<string, Uint8Array>()): Remote & { files: Map<string, Uint8Array> } {
  let exists = files.size > 0;
  return {
    files,
    async list() {
      return exists ? new Map([...files].map(([n, b]) => [n, b.length])) : null;
    },
    async read(name, from = 0) {
      const b = files.get(name);
      return b ? b.subarray(from) : null;
    },
    async write(name, text) {
      exists = true;
      files.set(name, enc.encode(text));
    },
    async remove(name) {
      files.delete(name);
    },
    async create() {
      exists = true;
    },
  };
}

/** A store kept in memory: for tests. */
export function memoryStore(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: <T,>(k: string) => (data.has(k) ? (structuredClone(data.get(k)) as T) : undefined),
    set: (k, v) => void data.set(k, structuredClone(v)),
    remove: (k) => void data.delete(k),
  };
}
