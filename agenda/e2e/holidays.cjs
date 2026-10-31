const assert = require('node:assert/strict');

/** Text with non-breaking spaces turned into plain ones. */
const norm = (t) => (t ?? '').replace(/\u00a0/g, ' ');

module.exports = async (page, { shot }) => {
  const dialog = page.getByRole('dialog');
  const rows = dialog.locator('.row');

  await page.getByRole('button', { name: 'Vacances' }).click();
  await dialog.waitFor();
  assert.equal(await rows.count(), 0);
  assert.equal(await dialog.getByLabel('Premier jour de cours').inputValue(), '2025-09-01', 'current school year');
  assert.equal(await dialog.getByLabel('Dernier jour de cours').inputValue(), '2026-07-10');

  // A range: Toussaint.
  await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
  const first = rows.nth(0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Nom', 'new line is focused');
  await first.getByLabel('Nom').fill('Toussaint');
  await first.getByLabel('Date de début').fill('2025-10-18');
  assert.equal(await first.getByLabel('Date de fin').inputValue(), '2025-10-18', 'end follows start');
  await first.getByLabel('Date de fin').fill('2025-11-02');
  assert.equal(norm(await first.locator('.note').textContent()), '16 jours');

  // A single day: 11 November.
  await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
  const second = rows.nth(1);
  await second.getByLabel('Nom').fill('Armistice');
  await second.getByRole('radio', { name: 'Un jour' }).click();
  assert.equal(await second.getByLabel('Date de fin').count(), 0, 'no end date for a single day');
  await second.getByLabel('Date', { exact: true }).fill('2025-11-11');
  assert.equal(norm(await second.locator('.note').textContent()), '1 jour');

  // A line to delete, and an incomplete line that blocks saving.
  await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
  await rows.nth(2).getByLabel('Nom').fill('Erreur');
  await rows.nth(2).getByRole('button', { name: 'Supprimer Erreur' }).click();
  assert.equal(await rows.count(), 2);
  await dialog.getByRole('button', { name: '+ Ajouter une ligne' }).click();
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  assert.ok(await dialog.isVisible(), 'stays open');
  assert.equal(norm(await rows.nth(2).locator('.note').textContent()), 'Choisissez une date.');
  assert.equal(norm(await dialog.locator('.window-foot .error').textContent()), 'Une ligne est incomplète.');
  await shot('holidays-error.png');
  await rows.nth(2).getByRole('button', { name: 'Supprimer la ligne' }).click();

  // Public holidays of the school year, without duplicating 11 November.
  await dialog.getByRole('button', { name: 'Ajouter les jours fériés' }).click();
  const labels = await rows.locator('.label').evaluateAll((els) => els.map((e) => e.value));
  assert.equal(labels.filter((l) => l === 'Armistice 1918' || l === 'Armistice').length, 1);
  await shot('holidays-window.png');

  // Cancel discards; Save keeps, across reloads.
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Vacances', exact: true }).click();
  assert.equal(await rows.count(), 0, 'cancelled');
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

  // Reopening shows the saved lines, sorted; Escape closes without saving.
  await page.getByRole('button', { name: 'Vacances (2)' }).click();
  assert.equal(await rows.count(), 2);
  assert.deepEqual(await rows.locator('.label').evaluateAll((els) => els.map((e) => e.value)), ['Jour sans cours', 'Noël']);
  assert.equal(await rows.nth(1).getByRole('radio', { name: 'Période' }).getAttribute('aria-checked'), 'true');
  assert.equal(await rows.nth(1).getByLabel('Date de fin').inputValue(), '2026-01-04');
  await rows.nth(0).getByRole('button', { name: /^Supprimer/ }).click();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Vacances (2)' }).count(), 1);

  // The school year can change; the end must come after the start.
  await page.getByRole('button', { name: 'Vacances (2)' }).click();
  await dialog.getByLabel('Dernier jour de cours').fill('2025-08-01');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  assert.ok(await dialog.isVisible());
  await dialog.getByLabel('Dernier jour de cours').fill('2026-07-03');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Phone width: no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: 'Vacances (2)' }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot('holidays-phone.png');
};
