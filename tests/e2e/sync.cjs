// Two copies of the app, two profiles, one shared folder (as with Nextcloud):
// turning synchronisation on, taking the library on the second computer, reviews,
// edits and deletions going both ways, nothing readable in the folder.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { readCollection } = require('./data.cjs');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-sync-shots-'));
const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-nextcloud-'));
const DAY = 86400000; const now = Date.now();
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const due = { stability: 3, difficulty: 5, reps: 2, lapses: 0, interval: 3, lastReview: new Date(now - 3 * DAY).toISOString(), nextReviewDate: new Date(now - 1000).toISOString(), phase: 'review' };

function profile(name, data) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), `saudade-sync-${name}-`));
  const dataDir = path.join(cfg, 'Saudade', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));
  return { cfg, dataDir, read: (n) => readCollection(dataDir, n) };
}
const A = profile('a', {
  documents: [{ ...base, id: 'd', title: 'Géographie', content: '# Géographie\n\nLe Rhône se jette dans la mer Méditerranée.', priority: 70, fsrs: { ...due, nextReviewDate: new Date(now + 5 * DAY).toISOString() } }],
  extracts: [{ ...base, id: 'e', documentId: 'd', documentTitle: 'Géographie', text: 'Le Rhône se jette dans la mer Méditerranée.', priority: 60, fsrs: { ...due, nextReviewDate: new Date(now + 5 * DAY).toISOString() } }],
  clozes: [{ ...base, id: 'c', documentId: 'd', documentTitle: 'Géographie', text: 'Le {{c1::Rhône}} se jette dans la mer.', priority: 80, fsrs: due }],
  reviewLogs: [], settings: {}, folders: ['Général'],
});
const B = profile('b', {
  documents: [{ ...base, id: 'b-doc', title: 'Brouillon du portable', content: 'Rien', priority: 10, fsrs: due }],
  extracts: [], clozes: [], reviewLogs: [], settings: { dailyReviewLimit: 20, theme: 'dark' }, folders: ['Général'],
});

async function launch(p) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: p.cfg } });
  // The folder picker answers the shared folder.
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, shared);
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  return { app, page, errors };
}
const settle = (page) => page.waitForTimeout(400);
async function syncNow(page) {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await page.getByText(/changements? reçus?|Déjà à jour/).last().waitFor();
  await settle(page);
}

(async () => {
  const a = await launch(A); const b = await launch(B);

  // 1. Computer A: a new folder, a passphrase typed twice
  await a.page.getByRole('button', { name: 'Réglages' }).click();
  await a.page.getByRole('button', { name: 'Choisir le dossier…' }).click();
  await a.page.getByText(/Nouveau dossier : la bibliothèque de cet ordinateur y sera envoyée/).waitFor();
  await a.page.getByLabel('Phrase de passe (8 caractères au moins)').fill('cerise-orage-42');
  await a.page.getByLabel('Confirmer la phrase de passe').fill('cerise-orage-4');
  await a.page.getByText('Les deux phrases ne sont pas identiques.').waitFor();
  assert.ok(await a.page.getByRole('button', { name: 'Activer la synchronisation' }).isDisabled());
  await a.page.getByLabel('Confirmer la phrase de passe').fill('cerise-orage-42');
  await a.page.getByRole('button', { name: 'Activer la synchronisation' }).click();
  await a.page.getByText(/aucun autre ordinateur pour l’instant/).waitFor();
  await a.page.screenshot({ path: path.join(OUT, 'sync-on.png') });
  const files = fs.readdirSync(shared);
  assert.ok(files.includes('saudade-sync.json') && files.some((f) => f.endsWith('.log')), files.join());
  const raw = files.filter((f) => f.endsWith('.log')).map((f) => fs.readFileSync(path.join(shared, f), 'utf8')).join();
  assert.ok(!raw.includes('Rhône') && !raw.includes('Géographie'), 'nothing readable in the shared folder');

  // 2. Computer B joins: wrong passphrase refused, then takes A's library (its own saved first)
  await b.page.getByRole('button', { name: 'Réglages' }).click();
  await b.page.getByRole('button', { name: 'Choisir le dossier…' }).click();
  await b.page.getByText('Ce dossier contient déjà la bibliothèque d’un autre ordinateur.').waitFor();
  assert.ok(await b.page.getByLabel(/Prendre la bibliothèque du dossier/).isChecked(), 'taking it is the default');
  await b.page.getByLabel('Phrase de passe du dossier').fill('pas-la-bonne');
  await b.page.getByRole('button', { name: 'Activer la synchronisation' }).click();
  await b.page.getByText('Phrase de passe incorrecte pour ce dossier.').waitFor();
  await b.page.getByLabel('Phrase de passe du dossier').fill('cerise-orage-42');
  await b.page.getByRole('button', { name: 'Activer la synchronisation' }).click();
  await b.page.getByText(/1 autre ordinateur/).waitFor();
  await settle(b.page);
  assert.deepEqual(B.read('documents').map((d) => [d.id, d.content]), A.read('documents').map((d) => [d.id, d.content]), 'B has A’s library');
  assert.deepEqual(B.read('clozes'), A.read('clozes'));
  assert.ok(fs.readdirSync(path.join(B.dataDir, 'backups')).some((f) => f.includes('avant-synchronisation')), 'B’s own library saved');
  assert.equal(B.read('settings').dailyReviewLimit, 50, 'B took A’s settings');
  assert.equal(await b.page.evaluate(() => document.documentElement.dataset.theme ?? 'system'), 'system', 'and its theme, on screen');
  // B's screen shows it too
  await b.page.getByRole('button', { name: /^Bibliothèque/ }).first().click();
  await b.page.getByText('Géographie').first().waitFor();
  assert.equal(await b.page.getByText('Brouillon du portable').count(), 0);

  // 3. A reviews the card; B lowers the document's priority. Both see both.
  await a.page.getByRole('button', { name: /Révision du jour/ }).first().click();
  await a.page.keyboard.press('Space'); await a.page.keyboard.press('3'); await settle(a.page);
  await b.page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await b.page.getByRole('button', { name: /Moins important/ }).click(); await settle(b.page);
  await syncNow(a.page); await syncNow(b.page); await syncNow(a.page);
  for (const P of [A, B]) {
    assert.equal(P.read('clozes')[0].fsrs.reps, 3, 'review counted on both');
    assert.equal(P.read('documents')[0].priority, 50, 'priority lowered on both');
    assert.equal(P.read('reviewLogs').length, 1);
  }
  assert.deepEqual(A.read('clozes'), B.read('clozes'), 'same schedule on both');

  // 3b. A setting changed on A reaches B (and its screen)
  await a.page.getByRole('button', { name: 'Réglages' }).click();
  await a.page.getByLabel('Cartes différentes par jour').fill('30'); await settle(a.page);
  await syncNow(a.page); await syncNow(b.page);
  assert.equal(B.read('settings').dailyReviewLimit, 30);
  assert.equal(await b.page.getByLabel('Cartes différentes par jour').inputValue(), '30');

  // 4. A deletes the extract: gone on B too
  await a.page.getByRole('button', { name: /File de lecture/ }).first().click();
  await a.page.getByRole('button', { name: /^Bibliothèque/ }).first().click();
  await a.page.getByRole('tab', { name: 'Par type' }).click();
  await a.page.getByRole('button', { name: /^Extraits/ }).first().click();
  await a.page.getByTitle(/Supprimer cet extrait/).first().click();
  await a.page.getByRole('button', { name: 'Confirmer' }).first().click(); await settle(a.page);
  assert.equal(A.read('extracts').length, 0);
  await syncNow(a.page); await syncNow(b.page);
  assert.equal(B.read('extracts').length, 0, 'deleted on B');
  await b.page.screenshot({ path: path.join(OUT, 'sync-b.png') });

  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.app.close(); await b.app.close();
  console.log('SYNC E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
