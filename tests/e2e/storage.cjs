const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const net = require('net'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'folcfg-'));
const dataDir = path.join(cfg, 'Saudade', 'data');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-shots-'));
async function launch() {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg }, cwd: APP });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  await page.waitForSelector('nav');
  return { app, page, errors };
}
const read = n => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
(async () => {
  // 1. fresh install: samples seeded into files; then plant legacy localStorage data
  let { app, page, errors } = await launch();
  assert.ok(page.url().includes(':47653/'), 'preferred port');
  await page.waitForTimeout(500);
  assert.ok(read('documents').length > 0, 'samples written to file');
  assert.ok(fs.existsSync(path.join(dataDir, 'backups')));
  await page.evaluate(() => {
    const doc = { id: 'legacy-1', title: 'Mon vieux document', content: 'Texte', tags: [], priority: 50, readingProgress: 0, lastReadOffset: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: 'new', format: 'note', fsrs: { stability: 2, difficulty: 5, reps: 0, lapses: 0, interval: 0, nextReviewDate: new Date().toISOString() } };
    localStorage.setItem('gemma_documents_fr_v2', JSON.stringify([doc]));
    localStorage.setItem('gemma_extracts_fr_v2', '[]');
    localStorage.setItem('gemma_clozes_fr_v2', '[]');
  });
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });

  // 2. migration from legacy localStorage
  ({ app, page, errors } = await launch());
  await page.waitForTimeout(500);
  const docs = read('documents');
  assert.deepEqual(docs.map(d => d.id), ['legacy-1'], 'legacy data migrated');
  assert.deepEqual(read('extracts'), []);
  // 3. restore through the UI
  const backup = { app: 'saudade', version: 2, documents: [docs[0], { ...docs[0], id: 'r2', title: 'Restauré' }], extracts: [], clozes: [], logs: [], folders: ['Général', 'Livres'] };
  const bfile = path.join(cfg, 'backup.json'); fs.writeFileSync(bfile, JSON.stringify(backup));
  await page.getByRole('button', { name: /Analytique/i }).first().click();
  await page.getByText('Ouvrir le dossier des données').waitFor();
  await page.locator('input[type=file][accept*=json]').setInputFiles(bfile);
  await page.getByRole('button', { name: 'Oui, restaurer' }).click();
  await page.getByText(/Sauvegarde restaurée : 2 documents/).waitFor();
  await page.waitForTimeout(300);
  assert.equal(read('documents').length, 2); assert.ok(read('folders').includes('Livres'));
  const events = fs.readdirSync(path.join(dataDir, 'backups')).filter(f => f.startsWith('event-'));
  assert.equal(events.length, 1, 'pre-restore snapshot'); 
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', events[0]))).documents.length, 1, 'snapshot holds pre-restore data');
  // invalid backup is rejected and changes nothing
  fs.writeFileSync(bfile, '{"documents": 3}');
  await page.locator('input[type=file][accept*=json]').setInputFiles(bfile);
  await page.getByRole('button', { name: 'Oui, restaurer' }).click();
  await page.getByText(/Restauration impossible/).waitFor();
  assert.equal(read('documents').length, 2);
  await page.screenshot({ path: OUT + '/stats.png', fullPage: true });
  // 4. reset demo creates a snapshot
  await page.getByRole('button', { name: /Réinitialiser les données de démo/ }).click();
  await page.getByRole('button', { name: 'Oui, écraser' }).click();
  await page.waitForTimeout(500);
  assert.ok(read('documents').length > 2);
  assert.ok(fs.readdirSync(path.join(dataDir, 'backups')).some(f => f.includes('avant-reinitialisation')));
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join('\n'));
  await app.close();

  // 5. port busy -> fallback; corrupted file -> recovered from .bak with a banner
  fs.writeFileSync(path.join(dataDir, 'documents.json'), '{"oops');
  const blocker = net.createServer().listen(47653, '127.0.0.1');
  await new Promise(r => blocker.on('listening', r));
  ({ app, page, errors } = await launch());
  assert.ok(!page.url().includes(':47653/'), 'fallback port used: ' + page.url());
  console.log('initial', JSON.stringify(await page.evaluate(() => ({w: window.saudadeDesktop?.initial?.warnings, keys: Object.keys(window.saudadeDesktop?.initial?.files||{})}))), fs.readdirSync(dataDir));
  await page.getByRole('alert').first().waitFor();
  const banner = await page.getByRole('alert').first().innerText();
  assert.match(banner, /mis de côté/);
  assert.equal(read('documents').length, 2, 'recovered previous version from .bak');
  await page.screenshot({ path: OUT + '/banner.png' });
  await app.close(); blocker.close();

  // 6. upgrade from the app's former name: the Foliole profile is taken over
  const cfg2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gemcfg-'));
  const oldData = path.join(cfg2, 'Foliole', 'data');
  fs.mkdirSync(path.join(oldData, 'backups'), { recursive: true });
  const oldDoc = { id: 'from-foliole', title: 'Venu de Foliole', content: 'x', tags: [], priority: 50, readingProgress: 0, lastReadOffset: 0, createdAt: '', updatedAt: '', state: 'new', format: 'note', fsrs: { stability: 0, difficulty: 0, reps: 0, lapses: 0, interval: 0, nextReviewDate: new Date().toISOString() } };
  for (const [n, v] of Object.entries({ documents: [oldDoc], extracts: [], clozes: [], reviewLogs: [], settings: {}, folders: ['Général'] })) fs.writeFileSync(path.join(oldData, n + '.json'), JSON.stringify(v));
  fs.writeFileSync(path.join(cfg2, 'Foliole', 'SingletonLock'), 'stale');
  const app2 = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg2 }, cwd: APP });
  const page2 = await app2.firstWindow(); await page2.waitForSelector('nav');
  const migrated = JSON.parse(fs.readFileSync(path.join(cfg2, 'Saudade', 'data', 'documents.json'), 'utf8'));
  assert.deepEqual(migrated.map((d) => d.id), ['from-foliole'], 'Foliole library taken over');
  assert.ok(fs.existsSync(path.join(oldData, 'documents.json')), 'old folder left untouched');
  assert.ok(!fs.existsSync(path.join(cfg2, 'Saudade.migrating')));
  await app2.close();

  // 7. the very first versions (named Foliole) kept the library in browser storage:
  // it must survive both the rename and the move to files.
  const cfg3 = fs.mkdtempSync(path.join(os.tmpdir(), 'gemcfg-'));
  let app3 = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg3 }, cwd: APP });
  let page3 = await app3.firstWindow(); await page3.waitForSelector('nav');
  await page3.evaluate((doc) => {
    localStorage.setItem('foliole_documents_fr_v2', JSON.stringify([{ ...doc, id: 'original-v1', title: 'Bibliothèque originale' }]));
    localStorage.setItem('foliole_extracts_fr_v2', '[]');
    localStorage.setItem('foliole_clozes_fr_v2', '[]');
  }, oldDoc);
  await app3.close();
  // Make it look like an original install: a Foliole profile without data files.
  fs.renameSync(path.join(cfg3, 'Saudade'), path.join(cfg3, 'Foliole'));
  fs.rmSync(path.join(cfg3, 'Foliole', 'data'), { recursive: true, force: true });
  app3 = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg3 }, cwd: APP });
  page3 = await app3.firstWindow(); await page3.waitForSelector('nav'); await page3.waitForTimeout(500);
  const fromV1 = JSON.parse(fs.readFileSync(path.join(cfg3, 'Saudade', 'data', 'documents.json'), 'utf8'));
  assert.deepEqual(fromV1.map((d) => d.id), ['original-v1'], 'original browser-storage library migrated');
  await app3.close();

  // 8. Former names: Gemma (most recent) is preferred over Foliole when both exist
  const cfg4 = fs.mkdtempSync(path.join(os.tmpdir(), 'saucfg-'));
  for (const [name, title] of [['Gemma', 'Bibliothèque Gemma'], ['Foliole', 'Bibliothèque Foliole']]) {
    const dir = path.join(cfg4, name, 'data'); fs.mkdirSync(dir, { recursive: true });
    for (const [n, v] of Object.entries({ documents: [{ ...oldDoc, id: name, title }], extracts: [], clozes: [], reviewLogs: [], settings: {}, folders: ['Général'] })) fs.writeFileSync(path.join(dir, n + '.json'), JSON.stringify(v));
  }
  const app4 = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg4 }, cwd: APP });
  await (await app4.firstWindow()).waitForSelector('nav');
  const taken = JSON.parse(fs.readFileSync(path.join(cfg4, 'Saudade', 'data', 'documents.json'), 'utf8'));
  assert.deepEqual(taken.map((d) => d.id), ['Gemma'], 'Gemma profile taken over');
  assert.ok(fs.existsSync(path.join(cfg4, 'Gemma', 'data', 'documents.json')), 'Gemma folder left untouched');
  await app4.close();
  console.log('E2E OK');
})().catch(e => { console.error(e); process.exit(1); });
