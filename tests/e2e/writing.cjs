// Incremental writing: a text started from "Ajouter une source › Écrire", written in
// the reader (saved as you type), fed with an extract, back in the queue later.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { readCollection } = require('./data.cjs');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-writing-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-writing-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const read = (n) => readCollection(dataDir, n);
const DAY = 86400000; const now = Date.now();
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const later = { stability: 0, difficulty: 0, reps: 1, lapses: 0, interval: 4, nextReviewDate: new Date(now + 4 * DAY).toISOString() };
const due = { ...later, nextReviewDate: new Date(now - 1000).toISOString() };
fs.mkdirSync(dataDir, { recursive: true });
const data = {
  documents: [{ ...base, id: 'src', title: 'Baddeley 1974', content: '# Baddeley 1974\n\nLa mémoire de travail a plusieurs composantes.', priority: 60, fsrs: later }],
  extracts: [{ ...base, id: 'e', documentId: 'src', documentTitle: 'Baddeley 1974', text: 'La mémoire de travail a plusieurs composantes.', priority: 60, fsrs: due }],
  clozes: [], reviewLogs: [], settings: {}, folders: ['Général'],
};
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));

(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

  // 1. Start a text to write: it opens in the reader, ready to type
  await page.getByRole('button', { name: /Ajouter une source/ }).click();
  await page.getByRole('button', { name: 'Écrire', exact: true }).click();
  await page.getByPlaceholder(/Synthèse : la mémoire de travail/).fill('Synthèse mémoire');
  await page.getByRole('button', { name: 'Commencer à écrire' }).click();
  const editor = page.getByLabel("Texte en cours d'écriture");
  await editor.waitFor();
  assert.equal(await editor.inputValue(), '# Synthèse mémoire\n\n');
  const doc = () => read('documents').find((d) => d.format === 'writing');
  assert.equal(doc().title, 'Synthèse mémoire'); assert.deepEqual(doc().tags, ['Écriture']);

  // 2. Typing is saved (no button), words counted; the preview shows the text
  await editor.click(); await page.keyboard.press('Control+End');
  await page.keyboard.type('La mémoire de travail est limitée à quelques éléments.');
  await page.getByText('Enregistré', { exact: true }).waitFor(); await page.waitForTimeout(300);
  assert.ok(doc().content.includes('La mémoire de travail est limitée à quelques éléments.'), doc().content);
  assert.equal(await page.getByTestId('word-count').innerText(), '11 mots');
  await page.screenshot({ path: path.join(OUT, 'writing.png') });
  await page.getByRole('tab', { name: 'Aperçu' }).click();
  await page.locator('article h1', { hasText: 'Synthèse mémoire' }).waitFor();
  await page.locator('article p', { hasText: 'limitée à quelques éléments' }).waitFor();

  // 3. In the queue: "Écriture" with "Écrire"
  await page.getByRole('button', { name: /File de lecture/ }).first().click();
  await page.getByText('Écriture', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Écrire', exact: true }).waitFor();

  // 4. Reviewing an extract: "Ajouter à un texte…" pours it into the text, as a quote with its source
  await page.getByRole('button', { name: /Révision du jour/ }).first().click();
  await page.getByText('Extrait à relire').waitFor();
  await page.getByRole('button', { name: 'Ajouter à un texte…' }).click();
  assert.equal(await page.getByLabel("Texte en cours d'écriture").locator('option:checked').innerText(), 'Synthèse mémoire');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByText('Ajouté à « Synthèse mémoire »').waitFor(); await page.waitForTimeout(300);
  assert.ok(doc().content.endsWith('> La mémoire de travail a plusieurs composantes.\n>\n> — *Baddeley 1974*\n\n'), JSON.stringify(doc().content));

  // 5. Back to the text: the extract is there; "Continuer" puts it off by its priority
  await page.getByRole('button', { name: /File de lecture/ }).first().click();
  await page.getByRole('button', { name: 'Écrire', exact: true }).click();
  await page.getByLabel("Texte en cours d'écriture").waitFor();
  assert.ok((await page.getByLabel("Texte en cours d'écriture").inputValue()).includes('— *Baddeley 1974*'));
  await page.getByText('Où en est ce texte ?').waitFor();
  await page.getByRole('button', { name: /^Continuer · dans/ }).click(); await page.waitForTimeout(400);
  assert.equal(doc().fsrs.reps, 1); assert.ok(new Date(doc().fsrs.nextReviewDate).getTime() > now + DAY / 2);

  assert.deepEqual(errors, []);
  await app.close();
  console.log('WRITING E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
