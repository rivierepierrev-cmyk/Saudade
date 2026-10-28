// Today's queue, editing extracts (applied to the document) and cards, and the
// guard against rescheduling an item twice.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-workflow-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-workflow-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const { readCollection } = require('./data.cjs');
const read = (n) => readCollection(dataDir, n);
const DAY = 86400000; const now = Date.now();
const rec = (days, reps = 1) => ({ stability: 3, difficulty: 5, reps, lapses: 0, interval: 2, lastReview: new Date(now - 2 * DAY).toISOString(), nextReviewDate: new Date(now + days * DAY).toISOString(), phase: 'review' });
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article' };
const DOC_A = "# Lecture\n\nLa **lecture incrémentale** permet de lire des [centaines d'articles](https://example.org) sans se perdre.\n\nAutre paragraphe.";
const data = {
  documents: [
    { ...base, id: 'docA', title: 'Document du jour', content: DOC_A, priority: 60, state: 'review', fsrs: rec(-1) },
    { ...base, id: 'docB', title: 'Document de la semaine prochaine', content: 'Plus tard.', priority: 90, state: 'review', fsrs: rec(5) },
  ],
  extracts: [
    { ...base, id: 'e1', documentId: 'docA', documentTitle: 'Document du jour', text: "La lecture incrémentale permet de lire des centaines d'articles sans se perdre.", priority: 80, state: 'review', fsrs: rec(0) },
    { ...base, id: 'e2', documentId: 'docA', documentTitle: 'Document du jour', text: 'Extrait programmé plus tard.', priority: 99, state: 'review', fsrs: rec(3) },
  ],
  clozes: [
    { ...base, id: 'c1', documentId: 'docA', documentTitle: 'Document du jour', text: 'La capitale de la France est {{c1::Paris}}.', priority: 70, state: 'review', fsrs: rec(-1, 3) },
    { ...base, id: 'c2', documentId: 'docA', documentTitle: 'Document du jour', text: 'Carte de dans dix jours {{c1::x}}.', priority: 95, state: 'review', fsrs: rec(10) },
  ],
  reviewLogs: [], settings: {}, folders: ['Général'],
};
fs.mkdirSync(dataDir, { recursive: true });
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));

const badge = (page) => page.getByRole('button', { name: /File de lecture/ }).first().innerText();

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

  // 1. The queue lists only what is due today
  await page.getByText('3 éléments à traiter').waitFor();
  assert.match(await badge(page), /3/);
  for (const later of ['Document de la semaine prochaine', 'Extrait programmé plus tard.']) assert.equal(await page.getByText(later).count(), 0, later);
  assert.equal(await page.getByText('Carte de dans dix jours').count(), 0);
  await page.screenshot({ path: path.join(OUT, 'queue-today.png') });

  // 2. Editing an extract edits the passage in the document (formatting kept), undoable
  await page.getByTitle(/Modifier l'extrait/).first().click();
  const editor = page.getByRole('dialog', { name: "Modifier l'extrait" });
  await editor.getByText(/sera aussi modifié dans le document « Document du jour »/).waitFor();
  const textarea = editor.locator('textarea');
  await textarea.fill("La lecture incrémentale permet de lire des milliers d'articles sans se perdre.");
  await page.screenshot({ path: path.join(OUT, 'edit-extract.png') });
  await editor.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText(/Extrait modifié, ainsi que le passage/).waitFor(); await page.waitForTimeout(300);
  const docA = () => read('documents').find((d) => d.id === 'docA').content;
  assert.ok(docA().includes("La **lecture incrémentale** permet de lire des [milliers d'articles](https://example.org) sans se perdre."), docA());
  assert.equal(read('extracts').find((e) => e.id === 'e1').text, "La lecture incrémentale permet de lire des milliers d'articles sans se perdre.");
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  assert.equal(docA(), DOC_A, 'undo restores the document');
  assert.ok(read('extracts').find((e) => e.id === 'e1').text.includes('centaines'));
  // edit again for real (keyboard: Ctrl+Enter saves)
  await page.getByTitle(/Modifier l'extrait/).first().click();
  await textarea.fill("La lecture incrémentale permet de lire des milliers d'articles sans se perdre.");
  await textarea.press('Control+Enter'); await page.waitForTimeout(300);
  assert.ok(docA().includes('[milliers'));

  // 3. Editing a card
  await page.getByTitle('Modifier la carte').first().click();
  const cardEditor = page.getByRole('dialog', { name: 'Modifier la carte à trou' });
  await cardEditor.locator('textarea').fill('La capitale de la France est {{c1::Paris::une ville}} depuis 508.');
  await cardEditor.getByRole('button', { name: 'Voir la réponse' }).click();
  await cardEditor.locator('.cloze-answer').waitFor();
  await cardEditor.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(300);
  assert.equal(read('clozes').find((c) => c.id === 'c1').text, 'La capitale de la France est {{c1::Paris::une ville}} depuis 508.');

  // 4. Review: the extract and the card leave the queue once done
  await page.getByRole('button', { name: /Réviser \(2\)/ }).click();
  for (let i = 0; i < 2; i++) {
    if (await page.getByText('Extrait à relire').count()) {
      assert.match(await page.locator('.font-serif-reading').first().innerText(), /milliers/);
      await page.keyboard.press('Enter');
    } else {
      assert.match(await page.locator('.font-serif-reading').first().innerText(), /une ville/, 'hint shown');
      await page.keyboard.press('Space'); await page.keyboard.press('3');
    }
    await page.waitForTimeout(300);
  }
  const e1 = read('extracts').find((e) => e.id === 'e1');
  assert.equal(e1.fsrs.reps, 2, 'extract rescheduled once');
  await page.getByRole('button', { name: /File de lecture/ }).first().click();
  await page.getByText('1 élément à traiter').waitFor();

  // 5. The last document: "Lu" empties the queue
  await page.getByRole('button', { name: 'Lire' }).first().click();
  await page.getByRole('button', { name: /^Il reste à extraire · dans/ }).click();
  await page.getByText(/File vide/).waitFor();
  await page.getByText(/Prochain élément :/).waitFor();
  assert.doesNotMatch(await badge(page), /\d/);
  await page.screenshot({ path: path.join(OUT, 'queue-empty.png') });

  // 6. Opening it again can't push it further away
  const before = read('documents').find((d) => d.id === 'docA').fsrs;
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await page.getByText(/^Déjà programmé : revient dans/).waitFor();
  await page.getByRole('button', { name: 'Texte suivant de la file' }).waitFor();
  await page.keyboard.press('l'); await page.waitForTimeout(300);
  assert.deepEqual(read('documents').find((d) => d.id === 'docA').fsrs, before, 'L on a scheduled document');
  // nor in "Réviser en avance": extracts scheduled for later keep their date
  await page.getByRole('button', { name: /Révision du jour/ }).first().click();
  await page.getByRole('button', { name: /Réviser en avance/ }).click();
  let checked = 0;
  for (let i = 0; i < 6 && checked < 2; i++) {
    if (await page.getByText('Extrait à relire').count()) {
      const label = await page.getByRole('button', { name: /^Suivant ·/ }).innerText();
      assert.match(label, /déjà prévu/);
      const snapshot = JSON.stringify(read('extracts').map((e) => e.fsrs));
      await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      assert.equal(JSON.stringify(read('extracts').map((e) => e.fsrs)), snapshot, 'not rescheduled again');
      checked++;
    } else if (await page.locator('.font-serif-reading').count()) {
      await page.keyboard.press('Space'); await page.keyboard.press('3'); await page.waitForTimeout(300);
    } else break;
  }
  assert.equal(checked, 2, 'both extracts checked in review-ahead');
  assert.deepEqual(errors, []);
  await app.close();
  console.log('WORKFLOW E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
