// End of a reading session ("Pas fini", "Il reste à extraire", "Tout est extrait"),
// summary card, priority, resuming the reading position, and extract highlights
// (SuperMemo style) that follow edits.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.GEMMA_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-finish-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-finish-')); const dataDir = path.join(cfg, 'Gemma', 'data');
const read = (n) => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
const DAY = 86400000; const now = Date.now();
const rec = (days) => ({ stability: 3, difficulty: 5, reps: 1, lapses: 0, interval: 2, lastReview: new Date(now - DAY).toISOString(), nextReviewDate: new Date(now + days * DAY).toISOString(), phase: 'review' });
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const long = (t) => Array.from({ length: 25 }, (_, i) => `${t} : paragraphe ${i + 1} assez long pour remplir la page et pouvoir faire défiler le texte.`).join('\n\n');
const data = {
  documents: [
    { ...base, id: 'a', title: 'Texte A avec extraits', content: `${long('A')}\n\nLe **passage choisi** contient une idée importante à retenir.\n\nFin de A.`, priority: 90, fsrs: rec(-1) },
    { ...base, id: 'b', title: 'Texte B sans rien', content: long('B'), priority: 80, fsrs: rec(-1) },
    { ...base, id: 'c', title: 'Texte C pas fini', content: long('C'), priority: 70, fsrs: rec(-1) },
  ],
  extracts: [
    { ...base, id: 'e1', documentId: 'a', documentTitle: 'Texte A avec extraits', text: 'Le passage choisi contient une idée importante à retenir.', priority: 95, fsrs: rec(-1) },
    { ...base, id: 'e2', documentId: 'a', parentExtractId: 'e1', documentTitle: 'Texte A avec extraits', text: 'une idée importante', priority: 96, fsrs: rec(5) },
  ],
  clozes: [], reviewLogs: [], settings: {}, folders: ['Général'],
};
fs.mkdirSync(dataDir, { recursive: true });
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));
const hl = (page, name) => page.evaluate((n) => { const h = CSS.highlights.get(n); return h ? [...h].map((r) => r.toString().replace(/\s+/g, ' ').trim()) : []; }, name);
const h1 = (page) => page.locator('h1').first().innerText();

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Texte A avec extraits');

  // 1. Extracted passages highlighted in the text (both extracts), toggle off/on
  assert.deepEqual((await hl(page, 'gemma-extracts')).sort(), ['Le passage choisi contient une idée importante à retenir.', 'une idée importante'].sort());
  await page.getByRole('button', { name: /Surlignage|Surligner|Masquer le surlignage/ }).first().click();
  assert.deepEqual(await hl(page, 'gemma-extracts'), []); assert.equal(read('settings').showExtractHighlights, false);
  await page.getByRole('button', { name: /Surlignage|Surligner/ }).first().click();
  assert.equal((await hl(page, 'gemma-extracts')).length, 2);

  // 2. Editing an extract: the document changes and the highlight follows
  await page.getByRole('button', { name: /Extraits \(/ }).first().click();
  await page.getByRole('button', { name: /^Passage #/ }).first().click();
  await page.getByRole('button', { name: 'Modifier' }).last().click();
  await page.getByRole('dialog').locator('textarea').fill('Le passage choisi contient une idée importante à bien retenir.');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(500);
  assert.ok(read('documents')[0].content.includes('Le **passage choisi** contient une idée importante à bien retenir.'));
  assert.ok((await hl(page, 'gemma-extracts')).includes('Le passage choisi contient une idée importante à bien retenir.'), 'highlight follows the edit');
  await page.screenshot({ path: path.join(OUT, 'reader-highlights.png') });

  // 3. Resume where the reading stopped
  await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(1200);
  const saved = read('documents').find((d) => d.id === 'a').lastReadOffset;
  assert.ok(saved > 800, 'position saved: ' + saved);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(500);
  assert.equal(await h1(page), 'Texte A avec extraits');
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - saved) < 30, 'resumed at the saved position');

  // 4. "Il reste à extraire" (L) on A -> next due text (B)
  await page.keyboard.press('l'); await page.waitForTimeout(400);
  assert.equal(read('documents').find((d) => d.id === 'a').fsrs.reps, 2);
  assert.equal(await h1(page), 'Texte B sans rien');

  // 5. B: lower priority, then "Tout est extrait" with nothing extracted -> summary card
  await page.getByRole('button', { name: /Moins important \(80 %\)/ }).click(); await page.waitForTimeout(200);
  assert.equal(read('documents').find((d) => d.id === 'b').priority, 60);
  await page.keyboard.press('t');
  await page.getByText("Rien n'a été extrait de ce texte.").waitFor();
  await page.screenshot({ path: path.join(OUT, 'finish-warning.png') });
  await page.getByRole('button', { name: 'Écrire une carte de résumé' }).click();
  const editor = page.getByRole('dialog', { name: 'Nouvelle carte à trou' });
  const textarea = editor.locator('textarea');
  assert.match(await textarea.inputValue(), /^L'idée principale de « Texte B sans rien » : $/);
  await textarea.fill("L'idée principale de « Texte B sans rien » : {{c1::remplir la page}} sert à tester le défilement.");
  await editor.getByRole('button', { name: 'Créer la carte' }).click(); await page.waitForTimeout(400);
  assert.equal(read('documents').find((d) => d.id === 'b').state, 'dismissed', 'text finished after the summary card');
  assert.equal(read('clozes')[0].documentId, 'b');
  assert.equal(await h1(page), 'Texte C pas fini');

  // 6. C: "Pas fini" (P) -> tomorrow, not counted as a reading; the queue is then empty
  await page.keyboard.press('p'); await page.waitForTimeout(400);
  const c = read('documents').find((d) => d.id === 'c');
  const tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
  assert.equal(c.fsrs.nextReviewDate, tomorrow.toISOString()); assert.equal(c.fsrs.reps, 1);
  await page.getByText(/Prochain élément :/).waitFor().catch(() => {});

  // 7. Inside an extract (review), its sub-extract is highlighted, not the extract itself
  await page.getByRole('button', { name: /Révision du jour/ }).first().click();
  await page.getByText('Extrait à relire').waitFor();
  assert.deepEqual(await hl(page, 'gemma-subextracts'), ['une idée importante']);
  await page.screenshot({ path: path.join(OUT, 'review-subextract.png') });
  assert.deepEqual(errors, []);
  await app.close();
  console.log('FINISH E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
