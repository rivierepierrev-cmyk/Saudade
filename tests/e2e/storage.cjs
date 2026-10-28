const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const net = require('net'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saucfg-'));
const dataDir = path.join(cfg, 'Saudade', 'data');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-shots-'));
async function launch() {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg }, cwd: APP });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  await page.waitForSelector('nav');
  return { app, page, errors };
}
const { readCollection } = require('./data.cjs');
const read = (n) => readCollection(dataDir, n);
(async () => {
  // 1. fresh install: samples seeded into files
  let { app, page, errors } = await launch();
  assert.ok(page.url().includes(':47653/'), 'preferred port');
  await page.waitForTimeout(500);
  assert.ok(read('documents').length > 0, 'samples written to file');
  assert.ok(fs.existsSync(path.join(dataDir, 'backups')));
  await app.close();
  // an existing library on disk
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const doc = { id: 'existing-1', title: 'Mon document', content: 'Texte', tags: [], priority: 50, readingProgress: 0, lastReadOffset: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: 'new', format: 'note', fsrs: { stability: 2, difficulty: 5, reps: 0, lapses: 0, interval: 0, nextReviewDate: new Date().toISOString() } };
  for (const [n, v] of Object.entries({ documents: [doc], extracts: [], clozes: [], reviewLogs: [], settings: {}, folders: ['Général'] })) fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));

  // 2. the library on disk is loaded
  ({ app, page, errors } = await launch());
  await page.waitForTimeout(500);
  const docs = read('documents');
  assert.deepEqual(docs.map(d => d.id), ['existing-1'], 'library loaded');
  assert.deepEqual(read('extracts'), []);
  // 3. restore through the UI
  const backup = { app: 'saudade', version: 2, documents: [docs[0], { ...docs[0], id: 'r2', title: 'Restauré' }], extracts: [], clozes: [], logs: [], folders: ['Général', 'Livres'] };
  const bfile = path.join(cfg, 'backup.json'); fs.writeFileSync(bfile, JSON.stringify(backup));
  await page.getByRole('button', { name: 'Réglages' }).click();
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

  console.log('E2E OK');
})().catch(e => { console.error(e); process.exit(1); });
