// Image cards (zones hidden on an image, one card per zone number) and leeches.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const zlib = require('zlib');
const { readCollection } = require('./data.cjs');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-images-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-images-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const read = (n) => readCollection(dataDir, n);
const DAY = 86400000; const now = Date.now();

// A 400×300 PNG: four coloured blocks (a "diagram" to hide parts of).
function png(width, height, pixel) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const IMG = 'b'.repeat(32) + '.png';
fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'media', IMG), png(400, 300, (x, y) => (x < 200 ? (y < 150 ? [200, 60, 60] : [60, 160, 60]) : y < 150 ? [60, 90, 200] : [230, 200, 60])));

const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const later = { stability: 0, difficulty: 0, reps: 1, lapses: 0, interval: 4, nextReviewDate: new Date(now + 4 * DAY).toISOString() };
const data = {
  documents: [{ ...base, id: 'd', title: 'Anatomie', content: `# Anatomie\n\nLe schéma :\n\n![Schéma](/media/${IMG})\n\nFin.`, priority: 70, fsrs: later }],
  extracts: [],
  // Forgotten 7 times: the next lapse makes it a leech
  clozes: [{ ...base, id: 'k', documentId: 'd', documentTitle: 'Anatomie', text: 'Le {{c1::fémur}} est un os.', clozeNumber: 1, priority: 99, fsrs: { stability: 0.5, difficulty: 9, reps: 12, lapses: 7, interval: 1, lastReview: new Date(now - DAY).toISOString(), nextReviewDate: new Date(now - 1000).toISOString(), phase: 'review' } }],
  reviewLogs: [], settings: {}, folders: ['Général'],
};
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

  // 1. Reader: click the image, "Masquer des zones", draw three zones, group the third with c1
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await page.locator('article img').click();
  await page.getByRole('button', { name: 'Masquer des zones' }).click();
  const editor = page.getByRole('dialog', { name: 'Nouvelle carte image' });
  const canvas = editor.getByTestId('io-canvas');
  await canvas.locator('img').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="io-canvas"] img')?.naturalWidth > 0);
  const box = await canvas.boundingBox();
  const drag = async (x0, y0, x1, y1) => {
    await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0); await page.mouse.down();
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 4 }); await page.mouse.up();
  };
  await drag(0.05, 0.05, 0.45, 0.45); await drag(0.55, 0.05, 0.95, 0.45); await drag(0.55, 0.55, 0.95, 0.95);
  assert.equal(await editor.getByTestId('io-zone').count(), 3);
  await editor.getByLabel('Carte de la zone 3').selectOption('1');
  await editor.getByPlaceholder(/Nommez la zone/).fill('Quelle couleur ?');
  await page.screenshot({ path: path.join(OUT, 'io-editor.png') });
  await editor.getByRole('button', { name: 'Créer les cartes' }).click();
  await page.getByText('2 cartes image créées').waitFor(); await page.waitForTimeout(300);
  const images = read('clozes').filter((c) => c.kind === 'io');
  assert.deepEqual(images.map((c) => c.clozeNumber).sort(), [1, 2]);
  assert.equal(images[0].noteId, images[1].noteId); assert.equal(images[0].image, `/media/${IMG}`);
  assert.deepEqual(images[0].masks.map((m) => m.n), [1, 2, 1]);
  const z = images[0].masks[0];
  assert.ok(Math.abs(z.x - 0.05) < 0.02 && Math.abs(z.w - 0.4) < 0.02, JSON.stringify(z));

  // 2. Review: the leech card first (priority 99), forgotten an 8th time -> leech notice
  await page.getByRole('button', { name: /Révision du jour/ }).first().click();
  await page.getByText('Le', { exact: false }).first().waitFor();
  await page.keyboard.press('Space'); await page.keyboard.press('1');
  const notice = page.getByRole('alert', { name: 'Sangsue' });
  await notice.getByText('Sangsue : carte oubliée 8 fois').waitFor();
  await page.waitForTimeout(300);
  assert.equal(read('clozes').find((c) => c.id === 'k').leech, true);
  await page.screenshot({ path: path.join(OUT, 'leech-notice.png') });
  await notice.getByRole('button', { name: 'Reformuler la carte' }).click();
  const cardEditor = page.getByRole('dialog', { name: 'Modifier la carte à trou' });
  await cardEditor.waitFor(); await page.keyboard.press('Escape'); await cardEditor.waitFor({ state: 'detached' });

  // the image card c1 (c2 waits for another day: same note): zones 1 and 3 in colour, zone 2 grey
  await page.getByText(/^Image · c1 \(note de 2 cartes\)/i).waitFor();
  assert.equal(await page.locator('.io-frame .io-mask').count(), 3);
  assert.equal(await page.locator('.io-frame .io-active').count(), 2);
  await page.screenshot({ path: path.join(OUT, 'io-review.png') });
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.io-frame .io-revealed').count(), 2);
  await page.keyboard.press('3'); await page.waitForTimeout(300);
  assert.equal(read('clozes').find((c) => c.kind === 'io' && c.clozeNumber === 1).fsrs.reps, 1);

  // 3. Library: leech filter and badge; "Ce n'est plus une sangsue"
  await page.getByRole('button', { name: /^Bibliothèque/ }).first().click();
  await page.getByRole('tab', { name: 'Par type' }).click();
  await page.getByRole('button', { name: /^Cartes/ }).first().click();
  await page.getByLabel(/Seulement les sangsues \(1\)/).check();
  assert.equal(await page.getByTitle('Voir la carte').count(), 1);
  await page.getByTitle('Voir la carte').first().click();
  const viewer = page.getByRole('dialog', { name: 'Carte à trou' });
  await viewer.getByText(/Sangsue/).first().waitFor();
  await viewer.getByRole('button', { name: 'Ce n’est plus une sangsue' }).click(); await page.waitForTimeout(300);
  assert.equal(read('clozes').find((c) => c.id === 'k').leech, false);
  await page.keyboard.press('Escape');
  await page.getByLabel(/Seulement les sangsues/).click(); // no leech left: the filter goes away

  // 4. Editing the image note: zone 2 erased -> its card removed
  await page.getByTitle('Voir la carte').filter({ hasText: 'Quelle couleur ? · zone 1' }).click();
  const ioViewer = page.getByRole('dialog', { name: 'Carte image' });
  await ioViewer.getByRole('button', { name: 'Modifier' }).click();
  const ioEdit = page.getByRole('dialog', { name: 'Modifier la carte image' });
  await ioEdit.getByLabel('Effacer la zone 2').click();
  await ioEdit.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText(/Note modifiée : 1 supprimée/).waitFor(); await page.waitForTimeout(300);
  const left = read('clozes').filter((c) => c.kind === 'io');
  assert.deepEqual(left.map((c) => c.clozeNumber), [1]); assert.equal(left[0].masks.length, 2);

  // 5. Settings: threshold and "set aside"
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByLabel('Oublis pour une sangsue').fill('6');
  await page.getByLabel(/Retirer les sangsues de la file/).check(); await page.waitForTimeout(200);
  assert.equal(read('settings').leechThreshold, 6); assert.equal(read('settings').leechSuspend, true);

  assert.deepEqual(errors, []);
  await app.close();
  console.log('IMAGES E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
