// Overload: 6 documents due, 3 a day. The 3 least important are postponed on the
// morning's start (lower priority further), with undo; "Reporter maintenant"; once a day.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { readCollection } = require('./data.cjs');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-overload-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-overload-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const read = (n) => readCollection(dataDir, n);
const DAY = 86400000; const now = Date.now();
const base = { tags: [], createdAt: '', updatedAt: '', folder: 'Général', readingProgress: 0, lastReadOffset: 0, format: 'article', state: 'review' };
const due = { stability: 0, difficulty: 0, reps: 2, lapses: 0, interval: 10, lastReview: new Date(now - 10 * DAY).toISOString(), nextReviewDate: new Date(now - DAY).toISOString() };
const PRIORITIES = { haut: 90, fort: 80, moyen: 70, bas: 40, faible: 20, minime: 10 };
fs.mkdirSync(dataDir, { recursive: true });
const data = {
  documents: Object.entries(PRIORITIES).map(([id, priority]) => ({ ...base, id, title: `Texte ${id}`, content: `# Texte ${id}\n\nUn paragraphe.`, priority, fsrs: due })),
  extracts: [], clozes: [], reviewLogs: [], folders: ['Général'],
  settings: { dailyTopicLimit: 3 },
};
for (const [n, v] of Object.entries(data)) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));
const launch = async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  return { app, page, errors };
};
const isDue = (d) => new Date(d.fsrs.nextReviewDate).getTime() <= now;
const daysAhead = (d) => Math.round((new Date(d.fsrs.nextReviewDate).getTime() - new Date(new Date().toDateString()).getTime()) / DAY);

(async () => {
  let { app, page, errors } = await launch();

  // 1. First start of the day: the 3 least important are postponed, lower priority further
  await page.getByText('3 éléments en trop reportés (les moins prioritaires)').waitFor();
  await page.waitForTimeout(300);
  let docs = Object.fromEntries(read('documents').map((d) => [d.id, d]));
  assert.ok(isDue(docs.haut) && isDue(docs.fort) && isDue(docs.moyen), 'the 3 most important stay');
  assert.deepEqual([daysAhead(docs.bas), daysAhead(docs.faible), daysAhead(docs.minime)], [4, 5, 6]);
  assert.equal(read('settings').lastAutoPostpone, new Date().toLocaleDateString('sv-SE'), 'done for today');
  await page.getByText('3 éléments à traiter aujourd’hui : 3 à lire, 0 à réviser. Chacun quitte la file une fois fait.').waitFor();
  assert.equal(await page.getByTestId('overload').count(), 0, 'nothing beyond the limit now');
  await page.screenshot({ path: path.join(OUT, 'postponed.png') });

  // 2. Undo: all due again; the queue still shows 3, and says what waits beyond
  await page.getByRole('button', { name: 'Annuler', exact: true }).click(); await page.waitForTimeout(300);
  assert.ok(read('documents').every(isDue), 'undone');
  await page.getByText(/6 éléments à traiter|3 éléments à traiter/).waitFor();
  const line = page.getByTestId('overload');
  assert.match(await line.innerText(), /3 documents ou extraits reportés demain matin/);
  assert.equal(await page.getByRole('button', { name: 'Lire', exact: true }).count(), 3, 'only 3 in the queue');
  await page.screenshot({ path: path.join(OUT, 'overload-line.png') });

  // 3. "Reporter maintenant" does it on demand
  await line.getByRole('button', { name: 'Reporter maintenant' }).click(); await page.waitForTimeout(300);
  assert.equal(read('documents').filter(isDue).length, 3);
  assert.equal(await page.getByTestId('overload').count(), 0);
  assert.deepEqual(errors, []);
  await app.close();

  // 4. Started again the same day: nothing more is postponed (once a morning)
  const before = JSON.stringify(read('documents'));
  ({ app, page, errors } = await launch());
  await page.waitForTimeout(1200);
  assert.equal(await page.getByText(/en trop reporté/).count(), 0);
  assert.equal(JSON.stringify(read('documents')), before);

  // 5. Settings: the limit and the switch
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByLabel('Documents et extraits par jour').fill('8'); await page.waitForTimeout(200);
  await page.getByLabel(/Reporter automatiquement le surplus chaque matin/).uncheck(); await page.waitForTimeout(200);
  const settings = read('settings');
  assert.equal(settings.dailyTopicLimit, 8); assert.equal(settings.autoPostpone, false);
  assert.deepEqual(errors, []);
  await app.close();
  console.log('OVERLOAD E2E OK', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
