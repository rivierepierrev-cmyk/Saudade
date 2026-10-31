// End-to-end check of the holidays window: npm run build, then node e2e/holidays.cjs [screenshot dir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

const shots = process.argv[2];
const port = 4179;

(async () => {
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'fr-FR' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2025-10-01T10:00:00')); // school year 2025-2026
    await page.goto(url);
    const dialog = page.getByRole('dialog');
    const rows = dialog.locator('.row');

    await page.getByRole('button', { name: 'Vacances' }).click();
    await assert.doesNotReject(dialog.waitFor());
    assert.equal(await rows.count(), 0);

    // A range: Toussaint.
    await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
    const first = rows.nth(0);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Nom', 'new line is focused');
    await first.getByLabel('Nom').fill('Toussaint');
    await first.getByLabel('Date de début').fill('2025-10-18');
    assert.equal(await first.getByLabel('Date de fin').inputValue(), '2025-10-18', 'end follows start');
    await first.getByLabel('Date de fin').fill('2025-11-02');
    assert.equal(await first.locator('.note').textContent(), '16 jours');

    // A single day: 11 November.
    await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
    const second = rows.nth(1);
    await second.getByLabel('Nom').fill('Armistice');
    await second.getByRole('radio', { name: 'Un jour' }).click();
    assert.equal(await second.getByLabel('Date de fin').count(), 0, 'no end date for a single day');
    await second.getByLabel('Date', { exact: true }).fill('2025-11-11');
    assert.equal(await second.locator('.note').textContent(), '1 jour');

    // A line to delete, and an incomplete line that blocks saving.
    await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
    await rows.nth(2).getByLabel('Nom').fill('Erreur');
    await rows.nth(2).getByRole('button', { name: 'Supprimer Erreur' }).click();
    assert.equal(await rows.count(), 2);
    await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    assert.ok(await dialog.isVisible(), 'stays open');
    assert.equal(await rows.nth(2).locator('.note').textContent(), 'Choisissez une date.');
    assert.equal(await dialog.locator('.window-foot .error').textContent(), 'Une ligne est incomplète.');
    if (shots) await page.screenshot({ path: path.join(shots, 'holidays-error.png') });
    await rows.nth(2).getByRole('button', { name: 'Supprimer la ligne' }).click();

    // Public holidays of the school year, without duplicating 11 November.
    await dialog.getByRole('button', { name: 'Ajouter les jours fériés' }).click();
    const labels = await rows.locator('.label').evaluateAll((els) => els.map((e) => e.value));
    assert.equal(labels.filter((l) => l === 'Armistice 1918' || l === 'Armistice').length, 1);
    if (shots) await page.screenshot({ path: path.join(shots, 'holidays-window.png') });

    // Cancel discards; Save keeps, across reloads.
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    assert.equal(await page.locator('.closures li').count(), 0);
    await page.getByRole('button', { name: 'Vacances' }).click();
    await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
    await rows.nth(0).getByLabel('Nom').fill('Noël');
    await rows.nth(0).getByLabel('Date de début').fill('2025-12-20');
    await rows.nth(0).getByLabel('Date de fin').fill('2026-01-04');
    await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
    await rows.nth(1).getByRole('radio', { name: 'Un jour' }).click();
    await rows.nth(1).getByLabel('Date', { exact: true }).fill('2025-11-11');
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.reload();
    const saved = await page.locator('.closures li').allTextContents();
    assert.equal(saved.length, 2);
    assert.match(saved[0], /^Jour sans cours.*11 nov/);
    assert.match(saved[1], /^Noël.*20 déc.*→.*4 janv/);
    assert.equal(await page.getByRole('button', { name: 'Vacances (2)' }).count(), 1);

    // Reopening shows the saved lines; Escape closes without saving.
    await page.getByRole('button', { name: 'Vacances (2)' }).click();
    assert.equal(await rows.count(), 2);
    assert.equal(await rows.nth(1).getByRole('radio', { name: 'Période' }).getAttribute('aria-checked'), 'true');
    await rows.nth(0).getByRole('button', { name: /^Supprimer/ }).click();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.closures li').count(), 2);

    // Phone width: no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole('button', { name: 'Vacances (2)' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (shots) await page.screenshot({ path: path.join(shots, 'holidays-phone.png') });

    assert.deepEqual(errors, []);
    console.log('holidays window: ok');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
