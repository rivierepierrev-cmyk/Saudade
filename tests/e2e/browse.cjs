// Viewing extracts and cards from the library, and reading extracts from the
// reader's side panel (passage scrolled to and highlighted in the text).
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-browse-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-browse-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const DAY = 86400000; const now = Date.now();
const rec = (days) => ({ stability: 3, difficulty: 5, reps: 1, lapses: 0, interval: 2, lastReview: new Date(now - DAY).toISOString(), nextReviewDate: new Date(now + days * DAY).toISOString(), phase: 'review' });
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article' };
const filler = Array.from({ length: 30 }, (_, i) => `Paragraphe de remplissage numéro ${i + 1}, pour que le passage extrait soit loin en bas de la page.`).join('\n\n');
const content = `# Relativité\n\n${filler}\n\nLa **relation la plus célèbre** de la physique est $E=mc^2$, publiée en [1905](https://example.org).\n\nFin du texte.`;
const EXTRACT = 'La relation la plus célèbre de la physique est $E=mc^2$, publiée en 1905.';
const data = {
  documents: [{ ...base, id: 'd', title: 'Relativité restreinte', content, priority: 70, state: 'review', fsrs: rec(2) }],
  extracts: [
    { ...base, id: 'e1', documentId: 'd', documentTitle: 'Relativité restreinte', text: EXTRACT, priority: 80, state: 'review', fsrs: rec(4) },
    { ...base, id: 'e2', documentId: 'd', parentExtractId: 'e1', documentTitle: 'Relativité restreinte', text: 'la plus célèbre de la physique', priority: 85, state: 'review', fsrs: rec(6) },
  ],
  clozes: [
    { ...base, id: 'c1', documentId: 'd', extractId: 'e1', documentTitle: 'Relativité restreinte', text: 'La relation la plus célèbre est {{c1::$E=mc^2$}}.', priority: 80, state: 'review', fsrs: rec(3) },
    { ...base, id: 'c2', documentId: 'd', documentTitle: 'Relativité restreinte', text: 'Fin du {{c1::texte}}.', priority: 60, state: 'review', fsrs: rec(9) },
  ],
  reviewLogs: [], settings: {}, folders: ['Général'],
};
fs.mkdirSync(dataDir, { recursive: true });
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));

const highlightState = (page) => page.evaluate(() => {
  const get = (name) => { const h = CSS.highlights.get(name); return h ? [...h].map((r) => r.toString().replace(/\s+/g, ' ').trim()) : []; };
  return { all: get('saudade-extracts'), active: get('saudade-extract-active'), scrollY: window.scrollY };
});

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

  // 1. Library, grid: open an extract
  await page.getByRole('button', { name: /Bibliothèque/ }).first().click();
  await page.getByRole('button', { name: /Vue Fiches/ }).click();
  await page.getByRole('button', { name: /^Extraits/ }).first().click();
  await page.getByTitle("Lire l'extrait").first().click();
  let dialog = page.getByRole('dialog', { name: 'Extrait' });
  await dialog.waitFor();
  assert.ok(await dialog.locator('.katex').count() >= 1, 'formula rendered');
  await dialog.getByText('Cartes tirées de cet extrait (1)').waitFor();
  await dialog.getByText(/Prochaine lecture/).waitFor();
  await page.screenshot({ path: path.join(OUT, 'viewer-extract.png') });
  // its card, from the list of cards
  await dialog.getByText('Sous-extraits (1)').waitFor(); // listed and highlighted in the extract
  assert.deepEqual(await page.evaluate(() => [...(CSS.highlights.get('saudade-subextracts') ?? [])].map((r) => r.toString())), ['la plus célèbre de la physique']);
  await dialog.getByRole('button', { name: /La relation la plus célèbre est/ }).click();
  dialog = page.getByRole('dialog', { name: 'Carte à trou' });
  assert.equal(await dialog.locator('.cloze-answer').count(), 0, 'answer hidden');
  await page.keyboard.press('Space');
  await dialog.locator('.cloze-answer').waitFor();
  await page.screenshot({ path: path.join(OUT, 'viewer-card.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);

  // 2. Library, grid: a card -> "Modifier" opens the editor
  await page.getByRole('button', { name: /^(Cartes|Clozes|Cloze)/ }).first().click();
  await page.getByTitle('Voir la carte').first().click();
  await page.getByRole('dialog', { name: 'Carte à trou' }).getByRole('button', { name: 'Modifier' }).click();
  await page.getByRole('dialog', { name: 'Modifier la carte à trou' }).waitFor();
  await page.keyboard.press('Escape');

  // 3. Library, tree: extract -> "Voir dans le document": reader scrolled to the highlighted passage
  await page.getByRole('button', { name: /Arborescence/ }).click();
  await page.getByText('Relativité restreinte', { exact: true }).first()
    .locator('xpath=ancestor::div[.//button][1]').locator('button').first().click(); // expand the document
  await page.getByTitle("Lire l'extrait").first().waitFor();
  await page.getByTitle("Lire l'extrait").first().click();
  await page.getByRole('dialog', { name: 'Extrait' }).getByRole('button', { name: 'Voir dans le document' }).click();
  await page.waitForTimeout(900);
  let h = await highlightState(page);
  assert.equal(h.active.length, 1, 'one passage strongly highlighted');
  assert.ok(/^La relation la plus célèbre de la physique est .*publiée en 1905\.$/.test(h.active[0]), JSON.stringify(h.active));
  assert.ok(h.scrollY > 600, 'scrolled to the passage: ' + h.scrollY);
  assert.equal(h.all.length, 2, 'both extracts lightly highlighted');
  await page.getByRole('button', { name: /Sous-extrait|Passage/ }).first().waitFor();
  await page.screenshot({ path: path.join(OUT, 'reader-focus.png') });

  // 4. Reader panel: click an extract -> full text, highlighted; click again -> closed
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  const sub = page.getByRole('button', { name: /Sous-extrait #/ });
  await sub.click(); await page.waitForTimeout(700);
  assert.equal(await sub.getAttribute('aria-expanded'), 'true');
  h = await highlightState(page);
  assert.deepEqual(h.active, ['la plus célèbre de la physique']);
  assert.ok(h.scrollY > 600, 'scrolled again: ' + h.scrollY);
  await page.getByText('Surligné dans le texte').waitFor();
  await sub.click(); await page.waitForTimeout(200);
  assert.deepEqual((await highlightState(page)).active, []);

  // 5. A new extract is highlighted too
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('article p')].find((x) => x.textContent.startsWith('Fin du texte'));
    const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.keyboard.press('Alt+x'); await page.waitForTimeout(500);
  assert.equal((await highlightState(page)).all.length, 3);
  assert.deepEqual(errors, []);
  await app.close();
  console.log('BROWSE E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
