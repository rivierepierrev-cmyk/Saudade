// Undo, theme persistence, reader shortcuts, accent-insensitive search.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-polish-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const { readCollection } = require('./data.cjs');
const read = (n) => readCollection(dataDir, n);
const launch = async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  return { app, page };
};
(async () => {
  let { app, page } = await launch();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForTimeout(300);

  // Undo: delete a document with its extracts and cards from the queue, then undo.
  const before = { d: read('documents'), e: read('extracts'), c: read('clozes') };
  const doc = before.d.find((d) => before.e.some((e) => e.documentId === d.id));
  const card = page.getByText(doc.title, { exact: true }).first()
    .locator('xpath=ancestor::div[.//*[@title="Supprimer définitivement"]][1]');
  await card.getByTitle('Supprimer définitivement').click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await page.getByText(/supprimé avec \d+ extrait/).waitFor();
  await page.waitForTimeout(300);
  assert.ok(!read('documents').some((d) => d.id === doc.id), 'deleted');
  assert.ok(read('extracts').length < before.e.length, 'extracts deleted with it');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  assert.deepEqual(read('documents').map((d) => d.id), before.d.map((d) => d.id), 'document back at its place');
  assert.equal(read('extracts').length, before.e.length); assert.equal(read('clozes').length, before.c.length);

  // Search ignores accents
  await page.getByPlaceholder(/Rechercher/).fill('repetition espacee');
  await page.waitForTimeout(200);
  const shown = await page.locator('h3, h2, .font-semibold').allInnerTexts();
  assert.ok(shown.some((t) => /Répétition Espacée/i.test(t)), 'accent-insensitive match');
  await page.getByPlaceholder(/Rechercher/).fill('');

  // Reader shortcuts: → next text, L reschedules
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  const t1 = await page.locator('h1').first().innerText();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
  const t2 = await page.locator('h1').first().innerText();
  assert.notEqual(t1, t2, '→ opens the next text');
  // L reschedules a document due today, never one already scheduled for later.
  const doc2 = read('documents').find((d) => d.title === t2);
  const due = new Date(doc2.fsrs.nextReviewDate) <= new Date(new Date().setHours(23, 59, 59, 999));
  await page.keyboard.press('l'); await page.waitForTimeout(400);
  const after = read('documents').find((d) => d.title === t2);
  if (due) assert.equal(after.fsrs.reps, doc2.fsrs.reps + 1, 'L = Lu on a due document');
  else assert.deepEqual(after.fsrs, doc2.fsrs, 'L on a document scheduled for later changes nothing');

  // Theme: toggle to dark, persists across restarts, applied before first paint
  await page.getByRole('button', { name: /Thème/ }).click(); // system -> light
  await page.getByRole('button', { name: /Thème/ }).click(); // light -> dark
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(read('settings').theme, 'dark');
  assert.deepEqual(errors, []);
  await app.close();
  ({ app, page } = await launch());
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(24, 23, 20)', 'dark canvas: ' + bg);
  await app.close();
  console.log('POLISH E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
