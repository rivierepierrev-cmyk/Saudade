// Question/answer cards: made from a passage in the reader (the passage is the answer
// to start from), found again in the text, reviewed (Space shows the answer), edited.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { readCollection } = require('./data.cjs');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-qa-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-qa-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const read = (n) => readCollection(dataDir, n);
const DAY = 86400000; const now = Date.now();
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const later = { stability: 0, difficulty: 0, reps: 1, lapses: 0, interval: 4, nextReviewDate: new Date(now + 4 * DAY).toISOString() };
fs.mkdirSync(dataDir, { recursive: true });
const data = {
  documents: [{ ...base, id: 'd', title: 'Biologie', content: "# Biologie\n\nLa mitochondrie produit l'ATP de la cellule. Le noyau garde l'ADN.", priority: 70, fsrs: later }],
  extracts: [], clozes: [], reviewLogs: [], settings: {}, folders: ['Général'],
};
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));
const strip = (s) => s.replace(/\s+/g, ' ').trim();

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

  // 1. Reader: select a passage, "Question": the passage is the answer to start from
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await page.waitForSelector('article p');
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('article p')].find((x) => x.textContent.startsWith('La mitochondrie'));
    const node = p.firstChild; const start = node.textContent.indexOf("produit"); const end = node.textContent.indexOf('cellule') + 'cellule'.length;
    const r = document.createRange(); r.setStart(node, start); r.setEnd(node, end);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    document.querySelector('article').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.keyboard.press('Alt+q');
  const editor = page.getByRole('dialog', { name: 'Nouvelle question' });
  await editor.waitFor();
  assert.equal(await editor.getByLabel('Réponse').inputValue(), "produit l'ATP de la cellule");
  await editor.getByRole('button', { name: 'Créer la carte' }).click();
  await editor.getByText('La question ne peut pas être vide.').waitFor();
  await editor.getByLabel('Question').fill('Que produit la mitochondrie ?');
  await editor.getByLabel('Réponse').fill("L'ATP");
  await editor.getByRole('button', { name: 'Voir la réponse' }).click();
  assert.equal(strip(await editor.locator('.font-serif-reading').innerText()), "Que produit la mitochondrie ? L'ATP");
  await page.screenshot({ path: path.join(OUT, 'qa-editor.png') });
  await editor.getByRole('button', { name: 'Créer la carte' }).click();
  await page.getByText('Question créée').waitFor(); await page.waitForTimeout(300);
  const [card] = read('clozes');
  assert.equal(card.kind, 'qa'); assert.equal(card.text, 'Que produit la mitochondrie ?'); assert.equal(card.answer, "L'ATP");
  assert.equal(card.sourceText, "produit l'ATP de la cellule"); assert.equal(card.documentId, 'd');

  // 2. Found again in the text, from the reader's card panel
  await page.getByRole('button', { name: 'Cartes (1)' }).click();
  await page.getByTitle('Relire cette carte et retrouver sa phrase dans le texte').first().click();
  await page.getByText('Surlignée dans le texte').waitFor(); await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => [...CSS.highlights.get('saudade-extract-active')].map((r) => r.toString())), ["produit l'ATP de la cellule"]);
  await page.screenshot({ path: path.join(OUT, 'qa-reader.png') });

  // 3. In today's queue, the question only; in review, Space shows the answer
  await page.getByRole('button', { name: /File de lecture/ }).first().click();
  await page.getByText('Que produit la mitochondrie ?').waitFor();
  assert.equal(await page.getByText("L'ATP").count(), 0, 'answer hidden in the queue');
  await page.getByRole('button', { name: /Révision du jour/ }).first().click();
  await page.getByText('Question', { exact: true }).first().waitFor();
  const shown = page.locator('.font-serif-reading').first();
  assert.equal(strip(await shown.innerText()), 'Que produit la mitochondrie ?');
  await page.keyboard.press('Space');
  await page.locator('.qa-answer').waitFor();
  assert.equal(strip(await page.locator('.qa-answer').innerText()), "L'ATP");
  await page.screenshot({ path: path.join(OUT, 'qa-review.png') });
  await page.keyboard.press('3'); await page.waitForTimeout(300);
  assert.equal(read('clozes')[0].fsrs.reps, 1); assert.equal(read('reviewLogs').length, 1);

  // 4. Library: listed with its answer; edited in the question editor (undoable)
  await page.getByRole('button', { name: /^Bibliothèque/ }).first().click();
  await page.getByRole('tab', { name: 'Par type' }).click();
  await page.getByRole('button', { name: /^Cartes/ }).first().click();
  await page.getByText("Que produit la mitochondrie ? → L'ATP").waitFor();
  await page.getByTitle('Voir la carte').first().click();
  const viewer = page.getByRole('dialog', { name: 'Question' });
  await viewer.getByRole('button', { name: 'Modifier' }).click();
  const edit = page.getByRole('dialog', { name: 'Modifier la question' });
  assert.equal(await edit.getByLabel('Question').inputValue(), 'Que produit la mitochondrie ?');
  await edit.getByLabel('Réponse').fill("L'ATP (énergie)");
  await edit.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Question modifiée').waitFor(); await page.waitForTimeout(300);
  assert.equal(read('clozes')[0].answer, "L'ATP (énergie)"); assert.equal(read('clozes')[0].fsrs.reps, 1, 'schedule kept');
  await page.getByTitle('Annuler (Ctrl+Z)').click(); await page.waitForTimeout(300);
  assert.equal(read('clozes')[0].answer, "L'ATP");

  assert.deepEqual(errors, []);
  await app.close();
  console.log('QA E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
