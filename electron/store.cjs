// File-based data store for the desktop app (runs in the Electron main process).
// Each collection is a JSON file in <dataDir>. Writes are atomic (tmp + rename) and
// keep the previous version as <name>.json.bak. A file that can't be parsed is never
// overwritten silently: it is moved to <dataDir>/corrupt/ and the .bak is used instead.
// A document's text lives in its own file, <dataDir>/contents/<id>.md, so saving the
// reading position or a title doesn't rewrite every book: documents.json only holds
// the documents' other fields.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

  const contentsDir = path.join(dataDir, 'contents');
  const fileOf = (name) => path.join(dataDir, `${name}.json`);
  // Readable file name for ordinary ids, a hash for anything else (never a path).
  const contentFile = (id) =>
    path.join(
      contentsDir,
      /^[A-Za-z0-9_-]{1,100}$/.test(id) ? `${id}.md` : `h-${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 32)}.md`
    );
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

  function readContent(id) {
    const file = contentFile(id);
    for (const f of [file, `${file}.bak`]) {
      if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    }
    return null;
  }

  function writeContent(id, text) {
    if (typeof id !== 'string' || typeof text !== 'string') throw new Error('Contenu de document invalide');
    fs.mkdirSync(contentsDir, { recursive: true });
    writeAtomic(contentFile(id), text);
  }

  // Documents: the texts that changed first, then the list. Texts of removed documents
  // stay until the next start (documents.json.bak may still list them), see removeOrphans.
  function writeDocuments(metaText, changed = []) {
    const meta = JSON.parse(metaText);
    if (!Array.isArray(meta) || !Array.isArray(changed)) throw new Error('Liste de documents invalide');
    for (const [id, text] of changed) writeContent(id, text);
    writeAtomic(fileOf('documents'), metaText);
  }

  // Deletes the texts no longer listed in documents.json nor in its .bak copy.
  function removeOrphans() {
    if (!fs.existsSync(contentsDir)) return;
    const keep = new Set();
    for (const f of [fileOf('documents'), `${fileOf('documents')}.bak`]) {
      const r = tryRead(f);
      if (!r.exists) continue;
      if (!r.ok) return; // unsure what is still needed: keep everything
      const list = JSON.parse(r.text);
      if (!Array.isArray(list)) return;
      for (const d of list) if (d && d.id !== undefined) keep.add(path.basename(contentFile(String(d.id))));
    }
    for (const f of fs.readdirSync(contentsDir)) {
      const base = f.replace(/\.(bak|tmp)$/, '');
      if (base.endsWith('.md') && !keep.has(base)) withRetry(() => fs.unlinkSync(path.join(contentsDir, f)));
    }
  }

  // Splits whole documents (with their text) into the list + one file per text.
  function splitDocuments(docs) {
    const changed = [];
    const meta = docs.map((d) => {
      if (!d || typeof d !== 'object') return d;
      const { content, ...rest } = d;
      if (typeof content === 'string') changed.push([d.id, content]);
      return rest;
    });
    return { metaText: JSON.stringify(meta), changed };
  }

  // documents.json as stored -> documents with their text. Older files (texts inside)
  // are moved to the new layout on the way.
  function withContents(text, warn = true) {
    const docs = JSON.parse(text);
    if (!Array.isArray(docs)) return text;
    if (docs.some((d) => d && typeof d.content === 'string')) {
      const { metaText, changed } = splitDocuments(docs);
      writeDocuments(metaText, changed);
    }
    for (const d of docs) {
      if (!d || typeof d !== 'object' || typeof d.content === 'string') continue;
      const content = readContent(d.id);
      if (content === null && warn) warnings.push(`Le texte du document « ${d.title || d.id} » est introuvable.`);
      d.content = content ?? '';
    }
    return JSON.stringify(docs);
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
    if (files.documents) {
      files.documents = withContents(files.documents);
      removeOrphans();
    }
    const isNew = !NAMES.some((n) => fs.existsSync(fileOf(n)) || fs.existsSync(`${fileOf(n)}.bak`));
    return { files, warnings: [...warnings], isNew, dataDir };
  }

  function write(name, text) {
    assertName(name);
    if (typeof text !== 'string') throw new Error('Contenu invalide');
    const value = JSON.parse(text); // refuse to persist anything that isn't valid JSON
    if (name === 'documents' && Array.isArray(value)) {
      const { metaText, changed } = splitDocuments(value);
      writeDocuments(metaText, changed);
      return;
    }
    writeAtomic(fileOf(name), text);
  }

  function readParsed(name, fallback) {
    const r = tryRead(fileOf(name));
    if (!(r.exists && r.ok)) return fallback;
    return JSON.parse(name === 'documents' ? withContents(r.text, false) : r.text);
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

  return { loadAll, write, writeDocuments, dailySnapshot, eventSnapshot, dataDir, backupDir, contentsDir };
}

module.exports = { createStore, NAMES, withRetry };
