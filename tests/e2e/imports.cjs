const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..'); const S = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-shots-')); const FX = path.join(__dirname, 'fixtures');
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'folimp-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const read = n => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
const site = http.createServer((req, res) => {
  if (req.url === '/article.html') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(FX + '/article.html')); }
  const m = req.url.match(/^\/img\/(\w+\.png)$/); if (m) { res.setHeader('content-type', 'image/png'); return res.end(fs.readFileSync(FX + '/' + m[1])); }
  res.statusCode = 404; res.end();
}).listen(8765, '127.0.0.1');
(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); const errors = [];
  // Diagnostics (CI): timestamped steps, Electron main-process output (local server),
  // page console, and the page state if a step never ends.
  const T0 = Date.now();
  const step = (label) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)} s] ${label}`);
  const relay = (prefix) => (chunk) => String(chunk).split('\n').filter((l) => l.trim() && !/ERROR:.*(dbus|bus\.cc|gpu|viz)/.test(l)).forEach((l) => console.log(`${prefix} ${l}`));
  app.process().stdout?.on('data', relay('[electron]'));
  app.process().stderr?.on('data', relay('[electron:err]'));
  page.on('console', (m) => console.log(`[page ${m.type()}] ${m.text()}`));
  page.on('crash', () => console.log('[page] CRASHED'));
  setTimeout(async () => {
    step('WATCHDOG: no progress, page state:');
    const state = await Promise.race([
      page.evaluate(() => ({
        h1: document.querySelector('h1')?.textContent,
        overlay: document.querySelector('.fixed.inset-0')?.innerText?.slice(0, 600),
        alerts: [...document.querySelectorAll('[role=alert]')].map((a) => a.innerText),
      })),
      new Promise((r) => setTimeout(() => r('evaluate timed out: renderer blocked'), 5000)),
    ]);
    console.log('STATE', JSON.stringify(state));
    process.exit(1);
  }, 5 * 60 * 1000).unref();
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForSelector('nav');
  const origin = new URL(page.url()).origin;
  const openImport = async (mode) => { await page.getByRole('button', { name: /Ajouter une source/ }).click(); if (mode) await page.getByRole('button', { name: mode }).click(); };

  // 0. API refuses requests without the Saudade header (other websites)
  step('API guard');
  const denied = await fetch(origin + '/api/fetch-page', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"http://127.0.0.1:8765/article.html"}' });
  assert.equal(denied.status, 403);

  // 1. web page: Readability + local images + sanitizing
  step('web page');
  await openImport();
  await page.getByPlaceholder(/wikipedia/).fill('http://127.0.0.1:8765/article.html');
  await page.getByRole('button', { name: /Capturer/ }).click();
  await page.waitForSelector('article img');
  let doc = read('documents')[0];
  console.log('--- web markdown ---\n' + doc.content + '\n---');
  assert.equal(doc.title, 'Le cerveau qui apprend'); assert.equal(doc.author, 'Jeanne Test');
  assert.ok(!/PARASITE/.test(doc.content), 'nav/header/footer removed');
  assert.equal((doc.content.match(/\]\(\/media\/[0-9a-f]{32}\.png\)/g) || []).length, 2, 'both images stored locally (incl. lazy)');
  assert.ok(!/8765\/x/.test(doc.content), 'missing image dropped');
  assert.ok(/\*Figure 1 : un schéma rouge\*/.test(doc.content), 'caption kept');
  assert.ok(/^-\s+Premier point/m.test(doc.content), 'list kept');
  assert.equal(fs.readdirSync(path.join(dataDir, 'media')).length, 2);
  const imgs = await page.$$eval('article img', els => els.map(e => ({ src: e.getAttribute('src'), w: e.naturalWidth, onerror: e.getAttribute('onerror') })));
  assert.ok(imgs.filter(i => i.src.startsWith('/media/')).every(i => i.w === 4), 'local images display: ' + JSON.stringify(imgs));
  assert.ok(imgs.every(i => !i.onerror));
  const link = await page.$eval('article a[href^="https://example.org"]', a => a.target);
  assert.equal(link, '_blank');
  // Opening the system browser is replaced by a recorder: a test must never launch a
  // real browser (on CI machines one is installed, and it takes over the screen).
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => { globalThis.__opened.push(url); };
  });
  await page.click('article a[href^="https://example.org"]'); await page.waitForTimeout(300);
  assert.ok(page.url().startsWith(origin), 'app did not navigate away');
  assert.deepEqual(await app.evaluate(() => globalThis.__opened), ['https://example.org/source'], 'link opened in the system browser');
  await page.screenshot({ path: S + '/import-web.png' });

  // 2. pasted markdown with scripts is neutralized when displayed
  step('pasted markdown');
  await openImport('Coller du texte');
  await page.getByPlaceholder(/Charge Cognitive/).fill('Test XSS');
  await page.locator('textarea').fill('Texte normal.\n\n<script>window.__pwned="s"</script><img src="nope" onerror="window.__pwned=\'i\'"><a href="javascript:window.__pwned=1">lien</a>');
  await page.locator('form button[type=submit]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'no script ran');
  assert.equal(await page.$$eval('article a', as => as.filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length), 0);

  // 3. PDF
  step('PDF');
  await openImport('Fichier local');
  await page.locator('input[type=file][accept*=epub]').setInputFiles(FX + '/rapport.pdf');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Rapport PDF'), null, { timeout: 30000 });
  doc = read('documents')[0];
  console.log('--- pdf markdown ---\n' + doc.content.slice(0, 600) + '\n---');
  assert.equal(doc.format, 'pdf');
  assert.ok(/apprentissage/.test(doc.content) && !/apprentis- ?sage/.test(doc.content), 'hyphen re-joined');
  assert.ok((doc.content.match(/Paragraphe \d/g) || []).length === 3);
  assert.ok(doc.content.split('\n\n').length >= 4, 'paragraphs kept');
  assert.ok(/\\1\. Ceci/.test(doc.content), 'numbered line escaped');

  // 4. EPUB: one document per chapter, cover/toc skipped, image stored, chapters staggered
  step('EPUB');
  await openImport('Fichier local');
  await page.locator('input[type=file][accept*=epub]').setInputFiles(FX + '/livre.epub');
  step('EPUB file chosen');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Les origines'), null, { timeout: 30000 });
  const docs = read('documents'); const book = docs.filter(d => d.folder === 'Livres/Mon Livre de Test');
  assert.deepEqual(book.map(d => d.title), ['01 · Les origines', '02 · La méthode']);
  assert.equal(book[0].author, 'Auteur Exemple');
  assert.ok(/!\[Illustration\]\(\/media\/[0-9a-f]{32}\.png\)/.test(book[0].content), book[0].content);
  assert.ok(new Date(book[1].fsrs.nextReviewDate) > new Date(Date.now() + 0.9 * 86400000), 'chapter 2 scheduled tomorrow');
  assert.ok(read('folders').includes('Livres/Mon Livre de Test'));
  await page.screenshot({ path: S + '/import-epub.png' });
  assert.deepEqual(errors, []);
  await app.close(); site.close();
  console.log('IMPORTS E2E OK');
})().catch(e => { console.error(e); site.close(); process.exit(1); });
