// File-based data store for the desktop app (runs in the Electron main process).
// Each collection is a JSON file in <dataDir>. Writes are atomic (tmp + rename) and
// keep the previous version as <name>.json.bak. A file that can't be parsed is never
// overwritten silently: it is moved to <dataDir>/corrupt/ and the .bak is used instead.
const fs = require('fs');
const path = require('path');

const NAMES = ['documents', 'extracts', 'clozes', 'reviewLogs', 'settings', 'folders'];
const DAILY_BACKUPS_KEPT = 7;
const EVENT_BACKUPS_KEPT = 10;

let stampCounter = 0;
// Sortable, unique timestamp (milliseconds + counter for calls within the same ms).
function stamp(d = new Date()) {
  stampCounter = (stampCounter + 1) % 1000;
  return `${d.toISOString().replace(/[:.]/g, '-').slice(0, 23)}-${String(stampCounter).padStart(3, '0')}`;
}

function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// On Windows, antivirus or indexing software can hold a file for a moment, making
// rename/copy fail with EPERM/EBUSY. Retry briefly before giving up.
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
function withRetry(fn, attempts = 8) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (i >= attempts || !RETRYABLE.has(e && e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * i);
    }
  }
}

function createStore(dataDir) {
  const backupDir = path.join(dataDir, 'backups');
  const corruptDir = path.join(dataDir, 'corrupt');
  fs.mkdirSync(backupDir, { recursive: true });

  const fileOf = (name) => path.join(dataDir, `${name}.json`);
  // Recovery messages are kept for the whole session, so a page reload still shows them.
  const warnings = [];

  function assertName(name) {
    if (!NAMES.includes(name)) throw new Error(`Collection inconnue : ${name}`);
  }

  function tryRead(file) {
    if (!fs.existsSync(file)) return { exists: false };
    const text = fs.readFileSync(file, 'utf8');
    try {
      JSON.parse(text);
      return { exists: true, ok: true, text };
    } catch {
      return { exists: true, ok: false };
    }
  }

  function quarantine(file) {
    fs.mkdirSync(corruptDir, { recursive: true });
    const dest = path.join(corruptDir, `${path.basename(file)}.${stamp()}`);
    fs.renameSync(file, dest);
    return dest;
  }

  function writeAtomic(file, text) {
    const tmp = `${file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(file)) withRetry(() => fs.copyFileSync(file, `${file}.bak`));
    withRetry(() => fs.renameSync(tmp, file));
  }

  // Returns { files: {name: jsonText}, warnings: string[], isNew, dataDir }
  function loadAll() {
    const files = {};
    for (const name of NAMES) {
      const file = fileOf(name);
      const main = tryRead(file);
      if (main.exists && main.ok) {
        files[name] = main.text;
        continue;
      }
      if (main.exists && !main.ok) {
        const moved = quarantine(file);
        warnings.push(`${name}.json était illisible et a été mis de côté (${moved}).`);
      }
      const bak = tryRead(`${file}.bak`);
      if (bak.exists && bak.ok) {
        writeAtomic(file, bak.text);
        files[name] = bak.text;
        if (main.exists) warnings.push(`${name}.json a été restauré depuis sa copie de secours.`);
      } else if (main.exists) {
        warnings.push(`${name}.json n'a pas pu être récupéré : la collection repart vide.`);
        files[name] = name === 'settings' ? '{}' : '[]';
      }
    }
    const isNew = !NAMES.some((n) => fs.existsSync(fileOf(n)) || fs.existsSync(`${fileOf(n)}.bak`));
    return { files, warnings: [...warnings], isNew, dataDir };
  }

  function write(name, text) {
    assertName(name);
    if (typeof text !== 'string') throw new Error('Contenu invalide');
    JSON.parse(text); // refuse to persist anything that isn't valid JSON
    writeAtomic(fileOf(name), text);
  }

  function readParsed(name, fallback) {
    const r = tryRead(fileOf(name));
    return r.exists && r.ok ? JSON.parse(r.text) : fallback;
  }

  function buildBackup() {
    return {
      app: 'saudade',
      version: 2,
      exportedAt: new Date().toISOString(),
      documents: readParsed('documents', []),
      extracts: readParsed('extracts', []),
      clozes: readParsed('clozes', []),
      logs: readParsed('reviewLogs', []),
      settings: readParsed('settings', {}),
      folders: readParsed('folders', []),
    };
  }

  function prune(prefix, keep) {
    const list = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort();
    for (const f of list.slice(0, Math.max(0, list.length - keep))) {
      fs.unlinkSync(path.join(backupDir, f));
    }
  }

  // Daily snapshot: at most one per day, last DAILY_BACKUPS_KEPT kept.
  function dailySnapshot() {
    const hasData = NAMES.some((n) => fs.existsSync(fileOf(n)));
    if (!hasData) return null;
    const file = path.join(backupDir, `daily-${localDay()}.json`);
    if (fs.existsSync(file)) return null;
    writeAtomic(file, JSON.stringify(buildBackup()));
    prune('daily-', DAILY_BACKUPS_KEPT);
    return file;
  }

  // Snapshot taken before a destructive action (restore, reset).
  function eventSnapshot(reason) {
    const safe = String(reason || 'manuel').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'manuel';
    const file = path.join(backupDir, `event-${stamp()}-${safe}.json`);
    writeAtomic(file, JSON.stringify(buildBackup()));
    prune('event-', EVENT_BACKUPS_KEPT);
    return file;
  }

  return { loadAll, write, dailySnapshot, eventSnapshot, dataDir, backupDir };
}

module.exports = { createStore, NAMES, withRetry };
