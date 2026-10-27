// LaTeX formulas: rendering, clozes on formulas, extracts keep LaTeX, imports.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..'); const FX = path.join(__dirname, 'fixtures');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-math-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-math-')); const dataDir = path.join(cfg, 'Saudade', 'data');
const read = (n) => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
const write = (n, v) => fs.writeFileSync(path.join(dataDir, n + '.json'), JSON.stringify(v));
const site = http.createServer((req, res) => {
  if (req.url === '/math.html') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(path.join(FX, 'math.html'))); }
  res.statusCode = 404; res.end();
}).listen(8768, '127.0.0.1');
const launch = async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForSelector('nav');
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  return { app, page, errors };
};
// Selects from the start of `fromText` (a text node) to the end of the formula containing `formulaTex`.
async function selectRange(page, root, startNeedle, endFormulaTex) {
  return page.evaluate(([root, startNeedle, tex]) => {
    const r = document.querySelector(root);
    const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    let start; let n;
    while ((n = walker.nextNode())) { const i = n.textContent.indexOf(startNeedle); if (i >= 0 && !n.parentElement.closest('.katex')) { start = [n, i]; break; } }
    const ann = [...r.querySelectorAll('annotation')].find((a) => a.textContent === tex);
    const formula = ann.closest('.katex');
    const inner = formula.querySelector('.katex-html');
    const range = document.createRange();
    if (start) range.setStart(...start); else range.setStart(inner.firstChild, 0);
    range.setEnd(inner, inner.childNodes.length); // ends inside the formula: widened to all of it
    getSelection().removeAllRanges(); getSelection().addRange(range);
    r.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, [root, startNeedle, endFormulaTex]);
}
(async () => {
  let { app, page, errors } = await launch();
  // 1. pasted Markdown with formulas
  await page.getByRole('button', { name: /Ajouter une source/ }).click();
  await page.getByRole('button', { name: 'Coller du texte' }).click();
  await page.getByPlaceholder(/Charge Cognitive/).fill('Formules');
  await page.locator('textarea').fill('Selon Einstein, l\'énergie vaut $E=mc^2$ pour une masse au repos.\n\nLa somme $a_1 + a_2$ reste en *italique* normal.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\nPrix : 5 $ et 10 $.\n\nErreur : $\\frac{1}{$ ici.');
  await page.locator('form button[type=submit]').click();
  await page.waitForSelector('article .katex');
  const info = await page.evaluate(() => ({
    inline: document.querySelectorAll('article .katex').length,
    display: document.querySelectorAll('article .katex-display').length,
    em: [...document.querySelectorAll('article em')].map((e) => e.textContent),
    prices: [...document.querySelectorAll('article p')].some((p) => p.textContent === 'Prix : 5 $ et 10 $.'),
    errors: document.querySelectorAll('article .katex-error').length,
  }));
  assert.equal(info.display, 1); assert.equal(info.inline, 3, JSON.stringify(info)); // 2 inline + 1 display (errors are not .katex)
  assert.deepEqual(info.em, ['italique'], 'underscores in formulas are not emphasis');
  assert.ok(info.prices, 'prices are not formulas');
  assert.equal(info.errors, 1, 'invalid formula shown as an error, page still works');
  await page.screenshot({ path: path.join(OUT, 'reader-math.png') });

  // 2. cloze on a formula: keeps the LaTeX, hides it whole, sentence as context
  await selectRange(page, 'article', null, 'E=mc^2');
  await page.getByRole('button', { name: 'Carte à trou' }).click();
  await page.getByText('Carte à trou créée').waitFor(); await page.waitForTimeout(300);
  const cz = read('clozes')[0].text;
  assert.equal(cz, "Selon Einstein, l'énergie vaut {{c1::$E=mc^2$}} pour une masse au repos.");

  // 3. extract across text and a formula keeps the LaTeX
  await selectRange(page, 'article', 'Selon', 'E=mc^2');
  await page.keyboard.press('Alt+x'); await page.waitForTimeout(400);
  assert.equal(read('extracts')[0].text, "Selon Einstein, l'énergie vaut $E=mc^2$");

  // 4. web import (Wikipedia markup): formulas come back as LaTeX
  await page.getByRole('button', { name: /Ajouter une source/ }).click();
  await page.getByRole('button', { name: 'Capture Web' }).click();
  await page.getByPlaceholder(/wikipedia/).fill('http://127.0.0.1:8768/math.html');
  await page.getByRole('button', { name: /Capturer/ }).click();
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Relativité'), null, { timeout: 20000 });
  const wiki = read('documents')[0].content;
  console.log('--- imported ---\n' + wiki + '\n---');
  assert.ok(wiki.includes('$E=mc^{2}$'), 'inline formula');
  assert.ok(wiki.includes('$$\\gamma ={\\frac {1}{\\sqrt {1-v^{2}/c^{2}}}}$$'), 'display formula');
  assert.ok(!/wikimedia|displaystyle|MENU/.test(wiki));
  assert.equal(await page.locator('article .katex-display').count(), 1);
  assert.deepEqual(errors, []);
  await app.close();

  // 5. card hiding part of a formula, in review
  const cards = read('clozes');
  const now = new Date().toISOString();
  write('clozes', [{ ...cards[0], id: 'partial', text: 'Équivalence : $E={{c1::mc^2}}$ (au repos).', fsrs: { stability: 0, difficulty: 0, reps: 0, lapses: 0, interval: 0, nextReviewDate: now, phase: 'new' }, priority: 100 }, ...cards]);
  ({ app, page, errors } = await launch());
  await page.getByRole('button', { name: /Révision du jour/ }).first().click();
  const card = page.locator('.font-serif-reading').first();
  await card.locator('.katex').first().waitFor();
  assert.match(await card.innerText(), /Équivalence/);
  const hidden = await card.innerHTML();
  assert.ok(!hidden.includes('mc^2') && !/<mi>m<\/mi>/.test(hidden), 'answer hidden, also in the LaTeX source');
  await page.screenshot({ path: path.join(OUT, 'review-hidden.png') });
  await page.keyboard.press('Space');
  await card.locator('.cloze-answer').first().waitFor();
  await page.screenshot({ path: path.join(OUT, 'review-revealed.png') });
  // the whole-formula card from step 2
  await page.keyboard.press('3');
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
  await app.close(); site.close();
  console.log('MATH E2E OK', OUT);
})().catch((e) => { console.error(e); site.close(); process.exit(1); });
