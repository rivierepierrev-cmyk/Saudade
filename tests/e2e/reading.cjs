const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..'); const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gemma-shots-'));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'folir-')); const dataDir = path.join(cfg, 'Gemma', 'data');
const read = n => JSON.parse(fs.readFileSync(path.join(dataDir, n + '.json'), 'utf8'));
const settle = p => p.waitForTimeout(400);
// Select `needle` (or the whole text of the first matching element) inside `root`, then fire mouseup.
async function select(page, rootSel, needleOrNull, blockSel = 'p') {
  return page.evaluate(([rootSel, needle, blockSel]) => {
    const root = document.querySelector(rootSel);
    const blocks = blockSel ? [...root.querySelectorAll(blockSel)] : [root];
    for (const b of blocks) {
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        let start, end;
        if (needle === null) { if (n.textContent.trim().length < 40) continue; start = 0; end = n.textContent.length; }
        else if (typeof needle === 'string') { start = n.textContent.indexOf(needle); if (start < 0) continue; end = start + needle.length; }
        else { // pick a long word in the middle of a long text node
          if (n.textContent.length < 80) continue;
          const words = [...n.textContent.matchAll(/[\p{L}]{7,}/gu)];
          if (words.length < 3) continue;
          const w = words[Math.floor(words.length / 2)]; start = w.index; end = start + w[0].length;
        }
        const r = document.createRange(); r.setStart(n, start); r.setEnd(n, end);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return { text: r.toString(), block: b.textContent };
      }
    }
    return null;
  }, [rootSel, needleOrNull, blockSel]);
}
(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForSelector('nav');
  await page.getByRole('button', { name: /^Lecteur/ }).first().click();
  await page.waitForSelector('article p');
  const docId = await page.evaluate(() => null);
  const docsBefore = read('documents');

  // 1. cloze from a word: context sentence kept, only the word hidden
  const w = await select(page, 'article', 0);
  assert.ok(w, 'found a word to select');
  await page.getByRole('button', { name: 'Carte à trou' }).click();
  await page.getByText('Carte à trou créée').waitFor(); await settle(page);
  let clozes = read('clozes'); const c = clozes[0];
  assert.ok(c.text.includes(`{{c1::${w.text}}}`), c.text);
  assert.ok(c.text.length > w.text.length + 20, 'context kept: ' + c.text);
  assert.equal(c.fsrs.phase, 'new'); assert.ok(new Date(c.fsrs.nextReviewDate) <= new Date());
  assert.ok(c.documentId, 'linked to document');
  console.log('cloze:', c.text);

  // 2. whole sentence selected -> the card editor opens to choose the hidden words
  const before = clozes.length;
  await select(page, 'article', null);
  await page.getByRole('button', { name: 'Carte à trou' }).click();
  const editor = page.getByRole('dialog', { name: 'Nouvelle carte à trou' });
  await editor.waitFor();
  assert.equal(read('clozes').length, before, 'nothing created yet');
  await editor.getByRole('button', { name: 'Créer la carte' }).click();
  await editor.getByText(/Ajoutez au moins un trou/).waitFor(); // a card needs a hole
  const word = await editor.locator('textarea').evaluate((t) => {
    const m = /[\p{L}]{7,}/u.exec(t.value); t.focus(); t.setSelectionRange(m.index, m.index + m[0].length); return m[0];
  });
  await editor.getByRole('button', { name: 'Masquer la sélection' }).click();
  await page.screenshot({ path: OUT + '/reader-cloze-editor.png' });
  await editor.getByRole('button', { name: 'Créer la carte' }).click();
  await editor.waitFor({ state: 'detached' }); await settle(page);
  assert.equal(read('clozes').length, before + 1);
  assert.ok(read('clozes')[0].text.includes(`{{c1::${word}}}`), read('clozes')[0].text);

  // 3. extract a passage via Alt+X
  const ex = await select(page, 'article', null);
  await page.keyboard.press('Alt+x');
  await page.getByText('Passage extrait dans la file').waitFor(); await settle(page);
  const extract = read('extracts')[0];
  assert.equal(extract.text, ex.text.trim()); assert.ok(new Date(extract.fsrs.nextReviewDate) > new Date(), 'extract scheduled in the future');

  // 4. scroll -> progress saved after a pause, not per event
  await page.mouse.wheel(0, 1500); await page.waitForTimeout(1300);
  const title = await page.locator('h1').first().innerText();
  const curDoc = read('documents').find(d => d.title === title);
  assert.ok(curDoc.readingProgress > 0, 'progress saved: ' + curDoc.readingProgress);

  // 5. "Lu" reschedules and moves on
  const lu = page.getByRole('button', { name: /^Il reste à extraire · dans/ });
  const luLabel = await lu.innerText();
  await lu.click(); await settle(page);
  const after = read('documents').find(d => d.id === curDoc.id);
  assert.equal(after.fsrs.reps, curDoc.fsrs.reps + 1);
  assert.ok(new Date(after.fsrs.nextReviewDate) > new Date(Date.now() + 0.9 * 86400000), 'rescheduled ≥ 1 day');
  const title2 = await page.locator('h1').first().innerText().catch(() => '(queue)');
  assert.notEqual(title2, title, 'moved to another document');
  console.log('lu:', luLabel, '->', after.fsrs.interval, 'j; next:', title2);

  // 6. review session: new cloze (Space, then 1) comes back in the same session
  await page.getByRole('button', { name: /Révision du jour/ }).first().click();
  await page.waitForTimeout(300);
  const header = await page.getByText(/Élément 1 sur \d+/).innerText();
  const total = Number(header.match(/sur (\d+)/)[1]);
  // go through items until our cloze appears
  let sawCloze = false, sawExtract = false, guard = 0;
  while (guard++ < 40) {
    const isExtract = await page.getByText('Extrait à relire').count();
    if (isExtract) {
      if (!sawExtract) {
        sawExtract = true;
        const sel = await select(page, 'div.select-text', 0, null);
        await page.getByRole('button', { name: 'Carte à trou', exact: true }).click();
        await page.getByText('Carte à trou créée').first().waitFor();
        const sub = await select(page, 'div.select-text', null, null);
        await page.getByRole('button', { name: 'Extraire la sélection' }).click();
        await page.getByText('Sous-extrait créé').waitFor(); await settle(page);
        const exts = read('extracts'); assert.ok(exts[0].parentExtractId, 'sub-extract has parent');
        const cz = read('clozes')[0]; assert.ok(cz.extractId && cz.text.includes('{{c1::' + sel.text + '}}'), 'cloze from extract: ' + cz.text);
        await page.screenshot({ path: OUT + '/review-extract.png' });
      }
      await page.keyboard.press('Enter'); await settle(page); continue;
    }
    if (!(await page.locator('.font-serif-reading').count())) break;
    await page.keyboard.press('Space'); await page.waitForTimeout(100);
    const text = await page.locator('.font-serif-reading').first().innerText();
    if (!sawCloze && read('clozes').some(z => z.id === c.id && z.fsrs.reps === 0) && text.includes(w.text)) {
      sawCloze = true;
      await page.screenshot({ path: OUT + '/review-card.png' });
      await page.keyboard.press('1'); await settle(page);
      const z = read('clozes').find(z => z.id === c.id);
      assert.equal(z.fsrs.phase, 'learning'); assert.ok(z.fsrs.interval < 0.05);
      continue;
    }
    await page.keyboard.press('3'); await settle(page);
  }
  assert.ok(sawCloze && sawExtract, `saw cloze ${sawCloze} extract ${sawExtract}`);
  const zc = read('clozes').find(z => z.id === c.id);
  assert.ok(zc.fsrs.reps >= 2, 'new card shown again in the same session (reps ' + zc.fsrs.reps + ')');

  // 7. stats: real retention + daily limit setting
  await page.getByRole('button', { name: /Analytique/ }).first().click();
  const ret = await page.getByText(/Rétention réelle/).locator('..').innerText();
  assert.match(ret, /\d+(\.\d)?%/); assert.match(ret, /1 j d'affilée/);
  await page.locator('input[type=number]').first().fill('20'); await settle(page);
  assert.equal(read('settings').dailyReviewLimit, 20);
  assert.deepEqual(errors, []);
  await app.close();
  console.log('IR E2E OK; review session had', total, 'items');
})().catch(e => { console.error(e); process.exit(1); });
