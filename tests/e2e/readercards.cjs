// Reader: "Texte à trou" always opens the editor, never takes in a heading that
// wasn't selected; the "Cartes (N)" panel lists the document's cards.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-readercards-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-readercards-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const { readCollection } = require('./data.cjs');
const read = (n) => readCollection(dataDir, n);
const DAY = 86400000; const now = Date.now();
const rec = (days) => ({ stability: 5, difficulty: 5, reps: 1, lapses: 0, interval: 5, lastReview: new Date(now - DAY).toISOString(), nextReviewDate: new Date(now + days * DAY).toISOString(), phase: 'review' });
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const CONTENT = '# Géographie\n\nParis est une ville. Lyon est sur le Rhône.\n\n## Fleuves\n\nLe Rhône se jette dans la mer.\n\n## Montagnes\n\nLe Mont Blanc est haut.';
const data = {
  documents: [{ ...base, id: 'd', title: 'Géographie', content: CONTENT, priority: 70, fsrs: rec(4) }],
  extracts: [],
  clozes: [{ ...base, id: 'k', documentId: 'd', documentTitle: 'Géographie', text: 'Le Mont Blanc est {{c1::haut}}.', priority: 50, fsrs: rec(10) }],
  reviewLogs: [], settings: {}, folders: ['Général'],
};
fs.mkdirSync(dataDir, { recursive: true });
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));

// Select from `from` (in a block starting with fromBlock) to `to` (offset in a block starting with toBlock).
const selectBetween = (page, a, b) => page.evaluate(([a, b]) => {
  const node = (start) => {
    const el = [...document.querySelectorAll('article h1, article h2, article p')].find((x) => x.textContent.startsWith(start));
    return el.firstChild;
  };
  const r = document.createRange();
  const na = node(a.block); r.setStart(na, na.textContent.indexOf(a.at));
  const nb = node(b.block); r.setEnd(nb, b.at === '' ? 0 : nb.textContent.indexOf(b.at) + b.at.length);
  getSelection().removeAllRanges(); getSelection().addRange(r);
  document.querySelector('article').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}, [a, b]);

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await page.waitForSelector('article p');
  const editor = page.getByRole('dialog', { name: 'Nouvelle carte à trou' });

  // 1. A drag that runs into the next heading: the heading stays out, editor opens
  await selectBetween(page, { block: 'Paris', at: 'Lyon' }, { block: 'Fleuves', at: '' });
  await page.getByRole('button', { name: 'Carte à trou', exact: true }).click();
  await editor.waitFor();
  assert.equal(await editor.locator('textarea').inputValue(), 'Lyon est sur le Rhône.');
  await editor.getByRole('button', { name: 'Annuler' }).click(); await editor.waitFor({ state: 'detached' });

  // 2. A word, with the selection spilling over the heading start: only the sentence
  await selectBetween(page, { block: 'Le Rhône', at: 'mer' }, { block: 'Montagnes', at: 'Mont' });
  await page.getByRole('button', { name: 'Carte à trou', exact: true }).click();
  await editor.waitFor();
  const t2 = await editor.locator('textarea').inputValue();
  assert.ok(!/Montagnes|Fleuves|Géographie/.test(t2), 'no heading: ' + t2);
  await editor.getByRole('button', { name: 'Annuler' }).click(); await editor.waitFor({ state: 'detached' });

  // 3. A single word: the editor opens with it hidden; saving creates the card
  await selectBetween(page, { block: 'Le Rhône', at: 'mer' }, { block: 'Le Rhône', at: 'mer' });
  await page.getByRole('button', { name: 'Carte à trou', exact: true }).click();
  assert.equal(await editor.locator('textarea').inputValue(), 'Le Rhône se jette dans la {{c1::mer}}.');
  await editor.getByRole('button', { name: 'Créer la carte' }).click();
  await page.getByText('Carte à trou créée').first().waitFor();
  assert.equal(read('clozes').length, 2);

  // 4. The panel: counter, a card highlights its sentence, view and edit it
  const btn = page.getByRole('button', { name: 'Cartes (2)' });
  await btn.click();
  await page.getByRole('heading', { name: 'Cartes de ce texte' }).waitFor();
  await page.getByTitle('Relire cette carte et retrouver sa phrase dans le texte').filter({ hasText: 'Mont Blanc' }).click();
  await page.getByText('Surlignée dans le texte').waitFor();
  await page.waitForTimeout(200);
  const active = await page.evaluate(() => [...CSS.highlights.get('saudade-extract-active')].map((r) => r.toString()));
  assert.deepEqual(active, ['Le Mont Blanc est haut.']);
  await page.screenshot({ path: path.join(OUT, 'reader-cards-panel.png') });
  await page.getByRole('button', { name: 'Voir la carte' }).click();
  const viewer = page.getByRole('dialog', { name: 'Carte à trou' });
  await viewer.waitFor(); await page.keyboard.press('Escape'); await viewer.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Modifier', exact: true }).last().click();
  const cardEditor = page.getByRole('dialog', { name: 'Modifier la carte à trou' });
  await cardEditor.locator('textarea').fill('Le {{c1::Mont Blanc}} est haut.');
  await cardEditor.getByRole('button', { name: 'Enregistrer' }).click(); await cardEditor.waitFor({ state: 'detached' });
  assert.equal(read('clozes').find((c) => c.id === 'k').text, 'Le {{c1::Mont Blanc}} est haut.');

  // 5. A card reworded after creation is still found by its original sentence
  const mer = read('clozes').find((c) => c.text.includes('{{c1::mer}}'));
  assert.equal(mer.sourceText, 'Le Rhône se jette dans la mer.');
  await page.getByTitle('Relire cette carte et retrouver sa phrase dans le texte').filter({ hasText: 'Rhône' }).click();
  await page.getByRole('button', { name: 'Modifier', exact: true }).last().click();
  await cardEditor.locator('textarea').fill('Le Rhône finit dans la {{c1::mer}}.');
  await cardEditor.getByRole('button', { name: 'Enregistrer' }).click(); await cardEditor.waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  const card = page.locator(`[data-panel-item="${mer.id}"]`);
  if (!(await card.getByText('Surlignée dans le texte').count())) await card.getByRole('button').first().click();
  await card.getByText('Surlignée dans le texte').waitFor();
  await page.waitForTimeout(200);
  const active2 = await page.evaluate(() => [...CSS.highlights.get('saudade-extract-active')].map((r) => r.toString()));
  assert.deepEqual(active2, ['Le Rhône se jette dans la mer.']);
  const green = await page.evaluate(() => [...CSS.highlights.get('saudade-cards')].map((r) => r.toString()).sort());
  assert.deepEqual(green, ['Le Mont Blanc est haut.', 'Le Rhône se jette dans la mer.']);

  assert.deepEqual(errors, []);
  await app.close();
  console.log('READER CARDS E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
