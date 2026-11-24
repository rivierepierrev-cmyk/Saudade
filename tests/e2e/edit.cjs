// The Markdown editor: Ctrl+F (search, replace), and editing only the passage selected in the reader.
// An extract opened like a document (double click): sub-extracts and cards from it.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-edit-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-edit-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const { readCollection } = require('./data.cjs');
const read = (n) => readCollection(dataDir, n);

const CONTENT = '# Cellule\n\nLe premier paragraphe parle du **noyau** et de la membrane.\n\nLe second paragraphe parle de la mitochondrie, centrale énergétique.\n\n- une liste\n- deux éléments\n';
const fsrs = { stability: 0, difficulty: 0, reps: 0, lapses: 0, interval: 0, nextReviewDate: new Date().toISOString() };
fs.mkdirSync(dataDir, { recursive: true });
const doc = { id: 'd', title: 'Cellule', content: CONTENT, tags: [], priority: 50, readingProgress: 0, lastReadOffset: 0, createdAt: '', updatedAt: '', state: 'new', format: 'markdown', folder: 'Général', fsrs };
const EXTRACT = 'Le second paragraphe parle de la mitochondrie, centrale énergétique de la cellule.';
const ext = { id: 'e1', documentId: 'd', documentTitle: 'Cellule', text: EXTRACT, tags: [], priority: 60, createdAt: '', updatedAt: '', state: 'new', folder: 'Général', fsrs };
for (const [n, v] of Object.entries({ documents: [doc], extracts: [ext], clozes: [], reviewLogs: [], settings: {}, folders: ['Général'] })) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));

// Selects `needle` (inside one text node, or from the start of `needle` to the end of `until`) in the reader.
const select = (page, needle, until, rootSelector = 'article') => page.evaluate(([needle, until, rootSelector]) => {
  const root = document.querySelector(rootSelector);
  const find = (s) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.textContent.indexOf(s); if (i >= 0) return [n, i]; } };
  const [a, i] = find(needle); const [b, j] = until ? find(until) : [a, i];
  const range = document.createRange(); range.setStart(a, i); range.setEnd(b, j + (until ?? needle).length);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}, [needle, until, rootSelector]);

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await page.locator('article h1', { hasText: 'Cellule' }).waitFor();

  // 1. A word selected in the reader: only it is editable, the rest of the text is untouched
  await select(page, 'mitochondrie');
  await page.getByRole('button', { name: 'Modifier', exact: true }).last().click();
  const passage = page.getByLabel('Passage sélectionné');
  assert.equal(await passage.inputValue(), 'mitochondrie');
  await page.getByText('Modifier le passage sélectionné').waitFor();
  assert.match(await page.getByTestId('context-before').innerText(), /Le second paragraphe parle de la\s*$/);
  assert.match(await page.getByTestId('context-after').innerText(), /^, centrale énergétique\./);
  assert.equal(await page.getByLabel('Titre du document').count(), 0, 'metadata hidden for a passage');
  await page.screenshot({ path: path.join(OUT, 'passage.png') });
  await passage.fill('mitochondrie (organite)');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await page.getByText('Passage modifié').waitFor(); await page.waitForTimeout(300);
  assert.equal(read('documents')[0].content, CONTENT.replace('mitochondrie', 'mitochondrie (organite)'));

  // 2. A selection across formatting (**noyau**): the whole paragraph, Markdown included
  await select(page, 'premier paragraphe', 'membrane');
  await page.getByRole('button', { name: 'Modifier', exact: true }).last().click();
  assert.equal(await page.getByLabel('Passage sélectionné').inputValue(), 'Le premier paragraphe parle du **noyau** et de la membrane.');
  await page.getByLabel('Passage sélectionné').fill('Le premier paragraphe parle du **noyau**, de la membrane et du cytoplasme.');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await page.waitForTimeout(300);
  const after2 = CONTENT.replace('mitochondrie', 'mitochondrie (organite)').replace('**noyau** et de la membrane.', '**noyau**, de la membrane et du cytoplasme.');
  assert.equal(read('documents')[0].content, after2);
  await page.locator('article strong', { hasText: 'noyau' }).waitFor();

  // 3. "Modifier tout le texte" from a passage
  await select(page, 'deux éléments');
  await page.getByRole('button', { name: 'Modifier', exact: true }).last().click();
  await page.getByRole('button', { name: 'Modifier tout le texte' }).click();
  assert.equal(await page.getByLabel('Texte de l’article').inputValue(), after2);
  await page.getByRole('button', { name: 'Annuler' }).last().click();

  // 4. Ctrl+F in the full editor: count, next, replace all, Escape
  await page.getByRole('button', { name: "Modifier l'article" }).click();
  const area = page.getByLabel('Texte de l’article');
  await area.click();
  await page.keyboard.press('Control+f');
  const find = page.getByLabel('Rechercher dans le texte');
  await find.fill('paragraphe');
  await page.getByText('1 / 2').waitFor();
  assert.equal(await page.locator('mark.find-hit, mark.find-current').count(), 2, 'matches highlighted');
  await find.press('Enter');
  await page.getByText('2 / 2').waitFor();
  await page.screenshot({ path: path.join(OUT, 'find.png') });
  await find.fill('PARAGRAPHE'); await page.getByText('1 / 2').waitFor(); // case ignored
  await page.getByLabel('Remplacer par').fill('passage');
  await page.getByRole('button', { name: 'Tout remplacer' }).click();
  await page.getByText('Aucun résultat').waitFor();
  assert.equal(await area.inputValue(), after2.replaceAll('paragraphe', 'passage'));
  await find.press('Escape');
  assert.equal(await page.getByRole('search').count(), 0, 'Escape closes the search');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await page.waitForTimeout(300);
  assert.equal(read('documents')[0].content, after2.replaceAll('paragraphe', 'passage'));

  // 5. An extract: a click shows it, a double click opens it like in the reader
  await page.getByRole('button', { name: /Bibliothèque/ }).first().click();
  await page.getByRole('tab', { name: 'Par type' }).click();
  await page.getByRole('button', { name: /^Extraits/ }).first().click();
  const extractButton = page.getByTitle(/^Lire l'extrait/).first();
  await extractButton.click();
  await page.getByRole('button', { name: 'Lire et extraire' }).waitFor(); // the viewer, with a way in
  await page.getByRole('button', { name: 'Lire et extraire' }).click();
  const reading = page.getByLabel('Lecture de l’extrait');
  await reading.waitFor();
  await page.keyboard.press('Escape');
  await reading.waitFor({ state: 'detached' });
  await extractButton.dblclick();
  await reading.waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'a double click opens no viewer');
  const textSel = '[aria-label="Lecture de l’extrait"] .font-serif-reading';
  // a sub-extract
  await select(page, 'mitochondrie', null, textSel);
  await reading.getByRole('button', { name: 'Extraire' }).click();
  await page.getByText('Sous-extrait créé').waitFor(); await page.waitForTimeout(300);
  const sub = read('extracts').find((e) => e.id !== 'e1');
  assert.equal(sub.text, 'mitochondrie'); assert.equal(sub.parentExtractId, 'e1'); assert.equal(sub.documentId, 'd');
  assert.equal(await page.evaluate(() => CSS.highlights.get('saudade-subextracts')?.size ?? 0), 1, 'sub-extract highlighted');
  await reading.getByText('1 sous-extrait, 0 carte').waitFor();
  // a cloze card
  await select(page, 'centrale énergétique', null, textSel);
  await reading.getByRole('button', { name: 'Carte à trou' }).click();
  await page.getByRole('dialog', { name: 'Nouvelle carte à trou' }).getByRole('button', { name: 'Créer la carte' }).click();
  await page.getByText('Carte à trou créée').waitFor(); await page.waitForTimeout(300);
  const card = read('clozes')[0];
  assert.equal(card.extractId, 'e1');
  assert.ok(card.text.includes('{{c1::centrale énergétique}}'), card.text);
  await reading.getByText('1 sous-extrait, 1 carte').waitFor();
  await page.screenshot({ path: path.join(OUT, 'extract-reader.png') });
  await reading.getByRole('button', { name: 'Fermer' }).click();
  await reading.waitFor({ state: 'detached' });

  assert.deepEqual(errors, []);
  await app.close();
  console.log('EDIT E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
