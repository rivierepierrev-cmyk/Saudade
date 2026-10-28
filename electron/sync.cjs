// Synchronisation through a folder shared by a sync client (Nextcloud, Syncthing…).
// Runs in the Electron main process; the merge itself is in src/lib/sync/model.ts.
//
// In the shared folder:
//   saudade-sync.json   salt of the key + a check value (no data)
//   <device>.log        this computer's events, one encrypted line each, only ever
//                       appended to, and only by this computer: no sync conflicts.
//                       Once compacted (see compact), <device>-g<N>.log replaces it.
//   media/<name>.enc    imported images, encrypted
// Locally, in <dataDir>/sync/: config.json (folder, key, how far each other log was
// read), outbox.jsonl (events not yet in the folder, e.g. folder unreachable) and
// meta.json (the merge clocks, kept for the page).
//
// Encryption: AES-256-GCM with a key derived from the passphrase by scrypt. The
// passphrase is never stored; the key is, protected by the system keychain
// (Electron safeStorage) when there is one.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HEADER = 'saudade-sync.json';
const CHECK = 'saudade-sync-ok';
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LOG_RE = /^[0-9a-f]{16}(-g\d+)?\.log$/;
const deviceOf = (name) => name.slice(0, 16);
const MEDIA_RE = /^[0-9a-f]{32}\.[a-z0-9]{2,5}$/;

function encrypt(key, buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

function decrypt(key, buf) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

const deriveKey = (passphrase, salt) => crypto.scryptSync(String(passphrase).normalize('NFC'), salt, 32, SCRYPT);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function appendDurable(file, text) {
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * dataDir: the app's data folder. keyStore: { protect(buf) -> string, unprotect(string) -> buf }
 * (Electron safeStorage in the app, plain hex in tests).
 */
function createSync(dataDir, keyStore) {
  const dir = path.join(dataDir, 'sync');
  const mediaDir = path.join(dataDir, 'media');
  fs.mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, 'config.json');
  const outboxFile = path.join(dir, 'outbox.jsonl');
  const metaFile = path.join(dir, 'meta.json');

  const config = readJson(configFile, {});
  if (!config.deviceId) config.deviceId = crypto.randomBytes(8).toString('hex');
  config.offsets = config.offsets || {};
  const saveConfig = () => writeAtomic(configFile, JSON.stringify(config, null, 2));
  saveConfig();

  let key = null;
  let lastError = null;
  if (config.folder && config.key) {
    try {
      key = keyStore.unprotect(config.key);
    } catch {
      lastError = 'Clé de synchronisation illisible : réactivez la synchronisation.';
    }
  }

  const enabled = () => Boolean(config.folder && key);
  const ownLogName = (generation = config.generation || 0) =>
    generation > 0 ? `${config.deviceId}-g${generation}.log` : `${config.deviceId}.log`;
  const ownLog = () => path.join(config.folder, ownLogName());
  const otherLogs = (folder) =>
    fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => LOG_RE.test(f) && deviceOf(f) !== config.deviceId) : [];
  const otherDevices = (folder) => new Set(otherLogs(folder).map(deviceOf)).size;

  /** What a folder holds: a sync header (another computer already uses it) and logs. */
  function inspect(folder) {
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      return { ok: false, error: 'Dossier introuvable.' };
    }
    const header = readJson(path.join(folder, HEADER), null);
    return { ok: true, used: Boolean(header && header.salt), others: otherDevices(folder) };
  }

  /** Turns synchronisation on with this folder: creates its header, or checks the passphrase. */
  function enable(folder, passphrase) {
    const info = inspect(folder);
    if (!info.ok) return info;
    if (!passphrase || String(passphrase).length < 8) return { ok: false, error: 'La phrase de passe doit faire au moins 8 caractères.' };
    const headerFile = path.join(folder, HEADER);
    let header = readJson(headerFile, null);
    let k;
    if (header && header.salt) {
      k = deriveKey(passphrase, Buffer.from(header.salt, 'base64'));
      try {
        if (decrypt(k, Buffer.from(header.check, 'base64')).toString('utf8') !== CHECK) throw new Error();
      } catch {
        return { ok: false, error: 'Phrase de passe incorrecte pour ce dossier.' };
      }
    } else {
      const salt = crypto.randomBytes(16);
      k = deriveKey(passphrase, salt);
      header = { app: 'saudade-sync', version: 1, salt: salt.toString('base64'), check: encrypt(k, Buffer.from(CHECK)).toString('base64') };
      writeAtomic(headerFile, JSON.stringify(header, null, 2));
    }
    key = k;
    config.folder = folder;
    config.key = keyStore.protect(k);
    config.offsets = {};
    config.lastSync = null;
    config.generation = 0;
    saveConfig();
    lastError = null;
    return { ok: true, joined: info.used && info.others > 0 };
  }

  function disable() {
    key = null;
    config.folder = null;
    config.key = null;
    config.offsets = {};
    config.lastSync = null;
    saveConfig();
    fs.rmSync(outboxFile, { force: true });
    writeAtomic(metaFile, '');
    lastError = null;
  }

  /** Events of this computer: kept in the outbox first, then copied to the folder. */
  function append(events) {
    if (!enabled() || !Array.isArray(events) || events.length === 0) return;
    appendDurable(outboxFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    flush();
  }

  function flush() {
    if (!enabled() || !fs.existsSync(outboxFile)) return;
    const lines = fs.readFileSync(outboxFile, 'utf8').split('\n').filter(Boolean);
    if (lines.length === 0) return;
    try {
      const file = ownLog();
      // After a crash in the middle of a line, start on a new one.
      let prefix = '';
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        const fd = fs.openSync(file, 'r');
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, fs.statSync(file).size - 1);
        fs.closeSync(fd);
        if (last.toString() !== '\n') prefix = '\n';
      }
      appendDurable(file, prefix + lines.map((l) => encrypt(key, Buffer.from(l)).toString('base64')).join('\n') + '\n');
      fs.rmSync(outboxFile, { force: true });
      lastError = null;
    } catch (e) {
      lastError = `Dossier de synchronisation inaccessible : ${e.message}`;
    }
  }

  /** Images: send the ones the folder lacks, fetch the ones this computer lacks. */
  function syncMedia() {
    const remoteDir = path.join(config.folder, 'media');
    fs.mkdirSync(remoteDir, { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });
    const local = new Set(fs.readdirSync(mediaDir).filter((f) => MEDIA_RE.test(f)));
    const remote = new Set(fs.readdirSync(remoteDir).filter((f) => f.endsWith('.enc')).map((f) => f.slice(0, -4)).filter((f) => MEDIA_RE.test(f)));
    for (const name of local) {
      if (!remote.has(name)) writeAtomic(path.join(remoteDir, `${name}.enc`), encrypt(key, fs.readFileSync(path.join(mediaDir, name))));
    }
    for (const name of remote) {
      if (local.has(name)) continue;
      try {
        writeAtomic(path.join(mediaDir, name), decrypt(key, fs.readFileSync(path.join(remoteDir, `${name}.enc`))));
      } catch {
        // still being downloaded by the sync client, or not ours: next time
      }
    }
  }

  /**
   * New events of the other computers, from where they were last read. The read
   * positions move only on ack(token), once the page has applied and saved them.
   */
  function pull() {
    if (!enabled()) return { events: [], token: null };
    flush();
    const events = [];
    const token = {};
    let unreadable = 0;
    try {
      syncMedia();
      for (const name of otherLogs(config.folder)) {
        const file = path.join(config.folder, name);
        const size = fs.statSync(file).size;
        let from = config.offsets[name] || 0;
        if (size < from) from = 0; // replaced by the sync client: read it again (merging is idempotent)
        if (size === from) continue;
        const buf = Buffer.alloc(size - from);
        const fd = fs.openSync(file, 'r');
        fs.readSync(fd, buf, 0, buf.length, from);
        fs.closeSync(fd);
        const end = buf.lastIndexOf(0x0a); // complete lines only
        if (end < 0) continue;
        for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
          if (!line) continue;
          try {
            events.push(JSON.parse(decrypt(key, Buffer.from(line, 'base64')).toString('utf8')));
          } catch {
            unreadable++;
          }
        }
        token[name] = from + end + 1;
      }
      lastError = unreadable > 0 ? `${unreadable} ligne(s) illisible(s) ignorée(s) (autre phrase de passe ?).` : null;
    } catch (e) {
      lastError = `Dossier de synchronisation inaccessible : ${e.message}`;
    }
    return { events, token };
  }

  /**
   * Replaces this computer's log by `events` (the page's compactEvents: the whole
   * state, each change with its original clock) under a new name, then removes the
   * old one. The other computers read the new file from its start; applying it
   * again is harmless. The outbox is part of that state, so it is emptied.
   */
  function compact(events) {
    if (!enabled() || !Array.isArray(events) || events.length === 0) return { ok: false };
    const previous = ownLog();
    const generation = (config.generation || 0) + 1;
    const next = path.join(config.folder, ownLogName(generation));
    const lines = events.map((e) => encrypt(key, Buffer.from(JSON.stringify(e))).toString('base64')).join('\n') + '\n';
    const tmp = path.join(config.folder, `.${ownLogName(generation)}.tmp`);
    fs.writeFileSync(tmp, lines);
    fs.renameSync(tmp, next);
    config.generation = generation;
    saveConfig();
    fs.rmSync(outboxFile, { force: true });
    if (previous !== next) fs.rmSync(previous, { force: true });
    return { ok: true, bytes: Buffer.byteLength(lines) };
  }

  function ack(token) {
    if (!enabled()) return;
    if (token) Object.assign(config.offsets, token);
    config.lastSync = new Date().toISOString();
    saveConfig();
  }

  function status() {
    const pending = fs.existsSync(outboxFile) ? fs.readFileSync(outboxFile, 'utf8').split('\n').filter(Boolean).length : 0;
    let others = 0;
    let ownLogBytes = 0;
    try {
      others = enabled() ? otherDevices(config.folder) : 0;
      ownLogBytes = enabled() && fs.existsSync(ownLog()) ? fs.statSync(ownLog()).size : 0;
    } catch {
      // folder unreachable: shown through lastError
    }
    return { enabled: enabled(), folder: config.folder || null, deviceId: config.deviceId, lastSync: config.lastSync || null, pending, others, ownLogBytes, error: lastError };
  }

  const readMeta = () => {
    try {
      return fs.readFileSync(metaFile, 'utf8');
    } catch {
      return '';
    }
  };
  const writeMeta = (text) => writeAtomic(metaFile, String(text));

  return { inspect, enable, disable, append, flush, pull, ack, compact, status, readMeta, writeMeta, dir };
}

module.exports = { createSync, encrypt, decrypt, deriveKey };
