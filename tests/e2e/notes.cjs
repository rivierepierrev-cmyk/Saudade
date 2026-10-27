// One card per deletion number: {{c1::Paris}} … {{c1::la capitale}} … {{c2::France}}
// gives two cards (two holes, one hole); siblings aren't shown the same day; editing
// a note adds/removes cards; older multi-number cards are split on start.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-notes-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-notes-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const read = (n) => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
const DAY = 86400000; const now = Date.now();
const rec = (days, reps = 1) => ({ stability: 5, difficulty: 5, reps, lapses: 0, interval: 5, lastReview: new Date(now - DAY).toISOString(), nextReviewDate: new Date(now + days * DAY).toISOString(), phase: 'review' });
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const data = {
  documents: [{ ...base, id: 'd', title: 'Géographie', content: '# Géographie\n\nParis est une ville et la capitale de France.', priority: 70, fsrs: rec(4) }],
  extracts: [],
  // A card from an older version with two numbers (and a history): split on start.
  clozes: [{ ...base, id: 'old', documentId: 'd', documentTitle: 'Géographie', text: 'Le {{c1::Rhône}} se jette dans la {{c2::Méditerranée}}.', priority: 10, fsrs: rec(30, 4) }],
  reviewLogs: [], settings: {}, folders: ['Général'],
};
fs.mkdirSync(dataDir, { recursive: true });
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));
// The editor moves the caret on the next frame after hiding: let it happen first.
const selectInTextarea = async (dialog, needle) => {
  await dialog.page().waitForTimeout(100);
  await dialog.locator('textarea').evaluate((t, n) => {
    const i = t.value.indexOf(n); t.focus(); t.setSelectionRange(i, i + n.length);
  }, needle);
};
const strip = (s) => s.replace(/\s+/g, ' ').trim();

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

  // 6 (on start). The older card is split: c1 keeps its history, c2 is new
  await page.waitForTimeout(300);
  const old = read('clozes').filter((c) => c.noteId === 'old').map((c) => [c.id, c.clozeNumber, c.fsrs.reps]);
  assert.deepEqual(old, [['old', 1, 4], ['old-c2', 2, 0]]);

  // 1. Whole sentence -> editor: c1, c1 again (same card), then c2 (new card)
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('article p')].find((x) => x.textContent.startsWith('Paris'));
    const r = document.createRange(); r.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(r);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Carte à trou' }).click();
  const editor = page.getByRole('dialog', { name: 'Nouvelle carte à trou' });
  await selectInTextarea(editor, 'Paris');
  await editor.getByRole('button', { name: 'Masquer la sélection' }).click();
  await selectInTextarea(editor, 'la capitale');
  await editor.getByRole('button', { name: 'Masquer · même carte (c1)' }).click();
  await selectInTextarea(editor, 'France');
  await editor.getByRole('button', { name: 'Masquer · nouvelle carte (c2)' }).click();
  const TEXT = '{{c1::Paris}} est une ville et {{c1::la capitale}} de {{c2::France}}.';
  assert.equal(await editor.locator('textarea').inputValue(), TEXT);
  await editor.getByRole('tab', { name: 'c1' }).click();
  assert.equal(strip(await editor.locator('.font-serif-reading').innerText()), '[…] est une ville et […] de France.');
  await page.screenshot({ path: path.join(OUT, 'editor-two-cards.png') });
  await editor.getByRole('button', { name: 'Créer la carte' }).click(); await page.waitForTimeout(300);
  const note = read('clozes').filter((c) => c.text === TEXT);
  assert.deepEqual(note.map((c) => c.clozeNumber), [1, 2], 'two cards');
  assert.equal(note[0].noteId, note[1].noteId);

  // 2. Today's queue: one card of the note (its sibling waits for another day)
  await page.getByRole('button', { name: /File de lecture/ }).first().click();
  // (the split older card's c2 is a new card, due now: 2 items in all)
  await page.getByText('2 éléments à traiter').waitFor();
  assert.equal(await page.getByText('[Paris] est une ville et [la capitale] de France.').count(), 1, 'c1 today');
  assert.equal(await page.getByText('Paris est une ville et la capitale de [France].').count(), 0, 'c2 another day');

  // 3. Review: card c1 has two holes
  await page.getByRole('button', { name: /Révision du jour/ }).first().click();
  await page.getByText(/c1 \(note de 2 cartes\)/).waitFor();
  assert.equal(strip(await page.locator('.font-serif-reading').first().innerText()), '[…] est une ville et […] de France.');
  await page.keyboard.press('Space'); await page.keyboard.press('3'); await page.waitForTimeout(300);

  // 4. Card c2 in the library: one hole; the note's cards are listed
  await page.getByRole('button', { name: /Bibliothèque/ }).first().click();
  await page.getByRole('button', { name: /Vue Fiches/ }).click();
  await page.getByRole('button', { name: /^(Cartes|Clozes|Cloze)/ }).first().click();
  await page.getByTitle('Voir la carte').filter({ hasText: '[France]' }).click();
  const viewer = page.getByRole('dialog', { name: 'Carte à trou' });
  await viewer.getByText(/c2 · note de 2 cartes/).waitFor();
  await viewer.getByText(/pas dans la file d'aujourd'hui/).waitFor(); // c1 goes first
  assert.equal(strip(await viewer.locator('.font-serif-reading').innerText()), 'Paris est une ville et la capitale de […].');
  await page.screenshot({ path: path.join(OUT, 'viewer-c2.png') });

  // 5. Editing the note: c2 removed, c3 added; undo brings c2 back and removes c3
  await viewer.getByRole('button', { name: 'Modifier' }).click();
  const cardEditor = page.getByRole('dialog', { name: 'Modifier la carte à trou' });
  await cardEditor.getByText(/Cette note donne 2 cartes \(c1, c2\)/).waitFor();
  await cardEditor.locator('textarea').fill('{{c1::Paris}} est la capitale de la {{c3::France}}.');
  await cardEditor.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText(/Note modifiée : 1 carte ajoutée, 1 supprimée/).waitFor();
  const after = read('clozes').filter((c) => c.noteId === note[0].noteId);
  assert.deepEqual(after.map((c) => c.clozeNumber).sort(), [1, 3]);
  assert.ok(after.every((c) => c.text === '{{c1::Paris}} est la capitale de la {{c3::France}}.'));
  assert.equal(after.find((c) => c.clozeNumber === 1).fsrs.reps, 1, 'c1 keeps its schedule');
  await page.getByTitle('Annuler (Ctrl+Z)').click(); await page.waitForTimeout(300);
  const undone = read('clozes').filter((c) => c.noteId === note[0].noteId);
  assert.deepEqual(undone.map((c) => c.clozeNumber).sort(), [1, 2]);
  assert.ok(undone.every((c) => c.text === TEXT));
  assert.deepEqual(errors, []);
  await app.close();
  console.log('NOTES E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
