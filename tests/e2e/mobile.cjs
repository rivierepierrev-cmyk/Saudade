// The phone app (mobile build, in Chromium at phone size) and the desktop app
// (Electron) share a library: the desktop through its folder, the phone through a
// fake Nextcloud WebDAV server whose files ARE that folder. Joining, a review on the
// phone, a setting on the desktop, an image, all both ways. Then a second phone uses
// that folder as a folder of its own (as when Syncthing copies it to the phone).
const { _electron, chromium } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const http = require('http'); const zlib = require('zlib');
const { readCollection } = require('./data.cjs');
const APP = path.resolve(__dirname, '../..');
const MOBILE = path.join(APP, 'dist-mobile');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-mobile-shots-'));
const davRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-dav-'));
const shared = path.join(davRoot, 'Saudade-sync'); fs.mkdirSync(shared);
const USER = 'marie', PASSWORD = 'mot-de-passe-app';

// ---- A fake Nextcloud: WebDAV over davRoot under /dav/, the mobile build elsewhere ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff': 'font/woff' };
const davLog = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/folder/')) return phoneFolder(url.slice('/folder/'.length), req, res);
  if (!url.startsWith('/dav/')) {
    let f = path.join(MOBILE, url); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(MOBILE, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res);
  }
  davLog.push(`${req.method} ${url}`);
  if (req.headers.authorization !== 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`).toString('base64')) { res.writeHead(401); return res.end(); }
  const file = path.join(davRoot, url.slice('/dav/'.length));
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.method === 'PROPFIND') {
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      const entries = [`<d:response><d:href>${url}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`];
      for (const name of fs.readdirSync(file)) {
        const st = fs.statSync(path.join(file, name));
        const href = `${url.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
        entries.push(st.isDirectory()
          ? `<d:response><d:href>${href}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`
          : `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getcontentlength>${st.size}</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>`);
      }
      res.writeHead(207, { 'Content-Type': 'application/xml' }); return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`);
    }
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      const data = fs.readFileSync(file); const range = /bytes=(\d+)-/.exec(req.headers.range || '');
      if (range) { res.writeHead(206); return res.end(data.subarray(Number(range[1]))); }
      res.writeHead(200); return res.end(data);
    }
    if (req.method === 'PUT') { fs.writeFileSync(file, body); res.writeHead(201); return res.end(); }
    if (req.method === 'MKCOL') { fs.mkdirSync(file, { recursive: true }); res.writeHead(201); return res.end(); }
    if (req.method === 'DELETE') { fs.rmSync(file, { force: true, recursive: true }); res.writeHead(204); return res.end(); }
    res.writeHead(405); res.end();
  });
});

// ---- The phone's folder (android/…/SyncFolderPlugin.java), here the shared folder itself ----
const folderLog = [];
function phoneFolder(op, req, res) {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const o = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    folderLog.push(`${op} ${o.path ?? ''}`);
    const send = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v ?? {})); };
    if (op === 'pick') return send({ uri: 'content://test/tree/Saudade-sync', name: 'Saudade-sync' });
    assert.equal(o.uri, 'content://test/tree/Saudade-sync');
    const file = path.join(shared, o.path || '');
    if (op === 'list') {
      if (!fs.existsSync(file)) return send({ exists: false });
      return send({ exists: true, files: fs.readdirSync(file).filter((n) => fs.statSync(path.join(file, n)).isFile()).map((n) => ({ name: n, size: fs.statSync(path.join(file, n)).size })) });
    }
    if (op === 'read') return fs.existsSync(file) ? send({ exists: true, data: fs.readFileSync(file).subarray(o.from || 0).toString('base64') }) : send({ exists: false });
    if (op === 'write') { fs.writeFileSync(file, Buffer.from(o.data, 'base64')); return send(); }
    if (op === 'remove') { fs.rmSync(file, { force: true }); return send(); }
    res.writeHead(404); res.end();
  });
}

// ---- The desktop library: a document with an image, a card due ----
function png(width, height, pixel) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-mobile-desk-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const read = (n) => readCollection(dataDir, n);
const DAY = 86400000; const now = Date.now();
const IMG = 'c'.repeat(32) + '.png';
fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'media', IMG), png(120, 80, (x) => (x < 60 ? [40, 120, 200] : [220, 180, 40])));
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const due = { stability: 3, difficulty: 5, reps: 2, lapses: 0, interval: 3, lastReview: new Date(now - 3 * DAY).toISOString(), nextReviewDate: new Date(now - 1000).toISOString(), phase: 'review' };
const data = {
  documents: [{ ...base, id: 'd', title: 'Géographie', content: `# Géographie\n\nLe Rhône se jette dans la mer.\n\n![Carte](/media/${IMG})`, priority: 70, fsrs: { ...due, nextReviewDate: new Date(now + 5 * DAY).toISOString() } }],
  extracts: [],
  clozes: [{ ...base, id: 'c', documentId: 'd', documentTitle: 'Géographie', text: 'Le {{c1::Rhône}} se jette dans la mer.', clozeNumber: 1, priority: 80, fsrs: due }],
  reviewLogs: [], settings: {}, folders: ['Général'],
};
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));

const syncDesktop = async (page) => {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await page.getByText(/changements? reçus?|Déjà à jour/).last().waitFor(); await page.waitForTimeout(400);
};

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  let desktop, browser;
  try {
    // 1. Desktop: turns synchronisation on with the shared folder
    desktop = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
    await desktop.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, shared);
    const dpage = await desktop.firstWindow(); await dpage.setViewportSize({ width: 1280, height: 900 }); await dpage.waitForSelector('nav');
    const errors = []; dpage.on('pageerror', (e) => errors.push(String(e)));
    await dpage.getByRole('button', { name: 'Réglages' }).click();
    await dpage.getByRole('button', { name: 'Choisir le dossier…' }).click();
    await dpage.getByLabel('Phrase de passe (8 caractères au moins)').fill('cerise-orage-42');
    await dpage.getByLabel('Confirmer la phrase de passe').fill('cerise-orage-42');
    await dpage.getByRole('button', { name: 'Activer la synchronisation' }).click();
    await dpage.getByText(/aucun autre appareil pour l’instant/).waitFor();
    await syncDesktop(dpage); // sends the image to the folder

    // 2. Phone: the mobile build at phone size, Nextcloud reached over WebDAV
    browser = await chromium.launch();
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    phone.on('pageerror', (e) => errors.push('phone: ' + String(e)));
    await phone.goto(`http://127.0.0.1:${port}/`);
    await phone.getByRole('button', { name: 'Réglages' }).click();
    await phone.getByLabel('Adresse WebDAV du dossier').fill(`http://127.0.0.1:${port}/dav/Saudade-sync`);
    await phone.getByLabel('Identifiant').fill(USER);
    await phone.getByLabel('Mot de passe d’application').fill('faux');
    await phone.getByRole('button', { name: 'Se connecter' }).click();
    await phone.getByText(/identifiant ou mot de passe refusé/).waitFor();
    await phone.getByLabel('Mot de passe d’application').fill(PASSWORD);
    await phone.getByRole('button', { name: 'Se connecter' }).click();
    await phone.getByText('Ce dossier contient déjà la bibliothèque d’un autre ordinateur.').waitFor();
    await phone.getByLabel('Phrase de passe du dossier').fill('cerise-orage-42');
    await phone.getByRole('button', { name: 'Activer la synchronisation' }).click();
    await phone.getByText(/1 autre appareil/).waitFor({ timeout: 60000 });
    await phone.screenshot({ path: path.join(OUT, 'phone-settings.png') });

    // the desktop's library on the phone, image included
    await phone.getByRole('button', { name: 'Lecteur' }).click();
    await phone.locator('article h1', { hasText: 'Géographie' }).waitFor();
    await phone.waitForFunction(() => { const img = document.querySelector('article img'); return img && img.complete && img.naturalWidth === 120; }, null, { timeout: 15000 });
    assert.match(await phone.locator('article img').getAttribute('src'), /^blob:/);
    await phone.screenshot({ path: path.join(OUT, 'phone-reader.png') });

    // 3. A review on the phone reaches the desktop
    await phone.getByRole('button', { name: 'Révision du jour' }).click();
    try {
      await phone.getByRole('button', { name: /Afficher la réponse/ }).click({ timeout: 15000 });
    } catch (e) {
      await phone.screenshot({ path: path.join(OUT, 'phone-review-fail.png') });
      throw e;
    }
    await phone.getByRole('button', { name: /3 · Bon/ }).click();
    await phone.waitForTimeout(800);
    await phone.screenshot({ path: path.join(OUT, 'phone-review-done.png') });
    assert.ok(fs.readdirSync(shared).filter((f) => f.endsWith('.log')).length === 2, 'the phone wrote its log in the folder');
    await syncDesktop(dpage);
    assert.equal(read('clozes')[0].fsrs.reps, 3, 'review made on the phone');
    assert.equal(read('reviewLogs').length, 1);

    // 4. A setting changed on the desktop reaches the phone
    await dpage.getByLabel('Cartes différentes par jour').fill('25'); await dpage.waitForTimeout(400);
    await phone.getByRole('button', { name: 'Réglages' }).click();
    await phone.getByRole('button', { name: 'Synchroniser maintenant' }).click();
    await phone.getByText(/changements? reçus?|Déjà à jour/).last().waitFor();
    assert.equal(await phone.getByLabel('Cartes différentes par jour').inputValue(), '25');

    // 5. The phone reloaded: its data stays (IndexedDB), sync still on
    await phone.reload();
    await phone.getByRole('button', { name: 'Réglages' }).click();
    await phone.getByText(/Activée/).waitFor();
    assert.equal(await phone.getByLabel('Cartes différentes par jour').inputValue(), '25');
    assert.ok(davLog.some((l) => l.startsWith('GET /dav/Saudade-sync/media/')), 'image fetched over WebDAV');

    // 6. A second phone, with the folder copied onto it (Syncthing): it chooses that folder
    const phone2 = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    phone2.on('pageerror', (e) => errors.push('phone2: ' + String(e)));
    await phone2.addInitScript(() => {
      const call = (op) => async (o) => (await fetch(`/folder/${op}`, { method: 'POST', body: JSON.stringify(o ?? {}) })).json();
      window.saudadeTestFolder = { pick: call('pick'), list: call('list'), read: call('read'), write: call('write'), remove: call('remove') };
    });
    await phone2.goto(`http://127.0.0.1:${port}/?second`);
    await phone2.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('saudade'); q.onsuccess = q.onerror = q.onblocked = r; }));
    await phone2.reload();
    await phone2.getByRole('button', { name: 'Réglages' }).click();
    await phone2.getByLabel('Dossier du téléphone (Syncthing…)').check();
    await phone2.getByRole('button', { name: 'Choisir le dossier…' }).click();
    await phone2.getByText('Ce dossier contient déjà la bibliothèque d’un autre ordinateur.').waitFor();
    await phone2.getByLabel('Phrase de passe du dossier').fill('cerise-orage-42');
    await phone2.getByRole('button', { name: 'Activer la synchronisation' }).click();
    await phone2.getByText(/2 autres appareils/).waitFor({ timeout: 60000 });
    await phone2.getByText('Saudade-sync', { exact: true }).waitFor();
    assert.equal(await phone2.getByLabel('Cartes différentes par jour').inputValue(), '25', 'settings from the folder');
    await phone2.screenshot({ path: path.join(OUT, 'phone2-settings.png') });
    await phone2.getByRole('button', { name: 'Lecteur' }).click();
    await phone2.locator('article h1', { hasText: 'Géographie' }).waitFor();
    await phone2.waitForFunction(() => { const img = document.querySelector('article img'); return img && img.complete && img.naturalWidth === 120; }, null, { timeout: 15000 });
    assert.ok(folderLog.includes('read media/' + fs.readdirSync(path.join(shared, 'media'))[0]), 'image read from the folder');
    // a change on it reaches the desktop
    await phone2.getByRole('button', { name: 'Réglages' }).click();
    await phone2.getByLabel('Cartes différentes par jour').fill('30'); await phone2.waitForTimeout(1500);
    assert.equal(fs.readdirSync(shared).filter((f) => f.endsWith('.log')).length, 3, 'the second phone wrote its log in the folder');
    await syncDesktop(dpage);
    assert.equal(await dpage.getByLabel('Cartes différentes par jour').inputValue(), '30', 'setting from the second phone');

    assert.deepEqual(errors, []);
    console.log('MOBILE E2E OK', OUT);
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    await browser?.close(); await desktop?.close(); server.close();
  }
});
