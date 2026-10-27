// Deleting an extract or a card removes its mark in the source text (and undo
// restores it); resetting cards to "never reviewed", one or all.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.GEMMA_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-cleanup-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-cleanup-')); const dataDir = path.join(cfg, 'Gemma', 'data');
const read = (n) => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
const DAY = 86400000; const now = Date.now();
const rec = (days, reps = 1) => ({ stability: 8, difficulty: 5, reps, lapses: 1, interval: 8, lastReview: new Date(now - DAY).toISOString(), nextReviewDate: new Date(now + days * DAY).toISOString(), phase: 'review' });
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const content = "# Mémoire\n\nL'hippocampe consolide les souvenirs pendant le sommeil.\n\nLe cortex préfrontal planifie les actions complexes.\n\nLa répétition espacée renforce la mémoire à long terme.";
const logs = [1, 2, 3].map((n) => ({ id: 'l' + n, itemId: 'c2', itemType: 'cloze', rating: 3, scheduledInterval: n, actualInterval: n, reviewDate: new Date(now - (10 - n) * DAY).toISOString(), state: 'review' }));
const data = {
  documents: [{ ...base, id: 'd', title: 'Mémoire', content, priority: 70, fsrs: rec(3) }],
  extracts: [{ ...base, id: 'e1', documentId: 'd', documentTitle: 'Mémoire', text: "L'hippocampe consolide les souvenirs pendant le sommeil.", priority: 80, fsrs: rec(4) }],
  clozes: [
    { ...base, id: 'c1', documentId: 'd', documentTitle: 'Mémoire', text: 'Le cortex {{c1::préfrontal}} planifie les actions complexes.', priority: 70, fsrs: rec(5) },
    { ...base, id: 'c2', documentId: 'd', documentTitle: 'Mémoire', text: 'La répétition espacée renforce la mémoire à {{c1::long terme}}.', priority: 60, fsrs: rec(9, 3) },
  ],
  reviewLogs: logs, settings: {}, folders: ['Général'],
};
fs.mkdirSync(dataDir, { recursive: true });
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));
const marks = (page) => page.evaluate(() => {
  const get = (n) => [...(CSS.highlights.get(n) ?? [])].map((r) => r.toString().replace(/\s+/g, ' ').trim());
  return { extracts: get('gemma-extracts'), cards: get('gemma-cards') };
});
const tab = (page, name) => page.getByRole('button', { name }).first().click();
const toReader = async (page) => { await tab(page, /^Lecteur/); await page.waitForSelector('article p'); await page.waitForTimeout(300); };
const toLibraryGrid = async (page, objects) => {
  await tab(page, /Bibliothèque/); await page.getByRole('button', { name: /Vue Fiches/ }).click();
  await page.getByRole('button', { name: objects }).first().click();
};

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

  // 1. Extract highlighted, both card sentences underlined
  await toReader(page);
  let m = await marks(page);
  assert.deepEqual(m.extracts, ["L'hippocampe consolide les souvenirs pendant le sommeil."]);
  assert.deepEqual(m.cards.sort(), ['La répétition espacée renforce la mémoire à long terme.', 'Le cortex préfrontal planifie les actions complexes.']);
  await page.getByRole('button', { name: /Extraits \(/ }).first().click();
  await page.screenshot({ path: path.join(OUT, 'reader-marks.png') });

  // 2. Deleting the extract removes its highlight; "Annuler" brings it back
  await toLibraryGrid(page, /^Extraits/);
  await page.getByTitle('Supprimer cet extrait et le retirer de la file').first().click();
  await page.getByRole('button', { name: 'Confirmer' }).first().click();
  await toReader(page);
  assert.deepEqual((await marks(page)).extracts, [], 'extract highlight removed');
  await page.getByTitle('Annuler (Ctrl+Z)').click(); await page.waitForTimeout(300);
  assert.equal((await marks(page)).extracts.length, 1, 'undo restores the highlight');

  // 3. Deleting a card removes its underline
  await toLibraryGrid(page, /^(Cartes|Clozes|Cloze)/);
  await page.getByTitle('Supprimer cette carte cloze et la retirer de la file').first().click();
  await page.getByRole('button', { name: 'Confirmer' }).first().click(); await page.waitForTimeout(200);
  const left = read('clozes').map((c) => c.id);
  await toReader(page);
  assert.equal((await marks(page)).cards.length, 1, 'one card left underlined');
  assert.equal(left.length, 1);

  // 4. Reset the remaining card with history (if it is c2) from the viewer
  if (left[0] !== 'c2') throw new Error('expected c2 to remain, got ' + left[0]);
  await toLibraryGrid(page, /^(Cartes|Clozes|Cloze)/);
  await page.getByTitle('Voir la carte').first().click();
  const viewer = page.getByRole('dialog', { name: 'Carte à trou' });
  await viewer.getByText(/Révisions/).waitFor();
  await viewer.getByRole('button', { name: 'Réinitialiser' }).click();
  await viewer.getByText(/historique de révision sera effacé/).waitFor();
  await page.screenshot({ path: path.join(OUT, 'reset-confirm.png') });
  await viewer.getByRole('button', { name: 'Réinitialiser' }).click(); await page.waitForTimeout(300);
  let c2 = read('clozes').find((c) => c.id === 'c2');
  assert.equal(c2.fsrs.reps, 0); assert.equal(c2.fsrs.lapses, 0); assert.equal(c2.fsrs.phase, 'new'); assert.equal(c2.state, 'new');
  assert.ok(new Date(c2.fsrs.nextReviewDate) <= new Date(), 'due now, like a new card');
  assert.equal(read('reviewLogs').filter((l) => l.itemId === 'c2').length, 0, 'history removed');
  await page.keyboard.press('Escape');
  await page.getByTitle('Annuler (Ctrl+Z)').click(); await page.waitForTimeout(300);
  c2 = read('clozes').find((c) => c.id === 'c2');
  assert.equal(c2.fsrs.reps, 3, 'undo restores the schedule'); assert.equal(read('reviewLogs').length, 3, 'and the history');

  // 5. Reset all cards from Analytique (with a safety snapshot)
  await tab(page, /Analytique/);
  await page.getByRole('button', { name: 'Réinitialiser toutes les cartes' }).click();
  await page.getByRole('button', { name: 'Oui, réinitialiser' }).click(); await page.waitForTimeout(500);
  assert.ok(read('clozes').every((c) => c.fsrs.reps === 0 && c.fsrs.phase === 'new'));
  assert.equal(read('reviewLogs').length, 0);
  assert.ok(fs.readdirSync(path.join(dataDir, 'backups')).some((f) => f.includes('avant-reinitialisation-cartes')));
  assert.deepEqual(errors, []);
  await app.close();
  console.log('CLEANUP E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
