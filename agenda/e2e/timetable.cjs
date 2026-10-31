const assert = require('node:assert/strict');

/** Text with non-breaking spaces turned into plain ones. */
const norm = (t) => (t ?? '').replace(/\u00a0/g, ' ');

/** Grid geometry, as in TimetableView: 1.1 px per minute, from 8:00. */
const PX = 1.1;
const FIRST = 8 * 60;

module.exports = async (page, { shot }) => {
  const dialog = page.getByRole('dialog');
  const column = (day) => page.locator(`.day-col[data-day="${day}"]`);
  const yOf = async (day, time) => {
    const box = await column(day).boundingBox();
    const [h, m] = time.split(':').map(Number);
    return { x: box.x + box.width / 2, y: box.y + (h * 60 + m - FIRST) * PX + 1 };
  };
  const slots = page.locator('.slot:not(.drawing)');
  const pick = (name) => page.locator('.class-pick', { hasText: name });
  const slotTexts = () => slots.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));

  // Without a class, drawing explains what to do.
  await page.mouse.click((await yOf(1, '08:00')).x, (await yOf(1, '08:00')).y);
  assert.match(norm(await page.locator('.hint').textContent()), /Ajoutez d'abord une classe/);
  assert.equal(await page.getByRole('button', { name: '+ Ajouter un cours' }).isDisabled(), true);

  // Classes.
  const newClass = page.getByLabel('Nouvelle classe');
  await newClass.fill('6e B');
  await newClass.press('Enter');
  await newClass.fill('4e A');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  assert.equal(await pick('4e A').getAttribute('aria-pressed'), 'true', 'new class is selected');
  await pick('6e B').click();
  assert.match(norm(await page.locator('.hint').textContent()), /cours de 6e B/);

  // Draw Monday 8:00–9:00 by dragging; a simple click on Thursday 10:00 gives a 55 min lesson.
  const a = await yOf(1, '08:00');
  const b = await yOf(1, '09:00');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y - 10, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 2 });
  assert.equal(await page.locator('.slot.drawing').count(), 1, 'preview while drawing');
  await page.mouse.up();
  const c = await yOf(4, '10:00');
  await page.mouse.click(c.x, c.y);
  assert.deepEqual(await slotTexts(), ['6e B, lundi 08:00–09:00', '6e B, jeudi 10:00–10:55']);
  assert.match(norm(await pick('6e B').textContent()), /2 cours \/ sem\. · 1 h 55/);

  // Edit a lesson.
  await slots.first().click();
  await dialog.waitFor();
  assert.equal(norm(await dialog.locator('h2').textContent()), 'Modifier le cours');
  await dialog.getByLabel('Fin').fill('08:55');
  await dialog.getByLabel('Salle').fill('B12');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await slotTexts())[0], '6e B, lundi 08:00–08:55, salle B12');

  // A lesson of another class at the same time: warned, shown side by side.
  await pick('4e A').click();
  await page.getByRole('button', { name: '+ Ajouter un cours' }).click();
  await dialog.getByLabel('Début').fill('08:30');
  await dialog.getByLabel('Fin').fill('09:30');
  assert.match(norm(await dialog.locator('.warning').textContent()), /Même heure que : 6e B \(lundi 08:00–08:55\)/);
  await dialog.getByLabel('Fin').fill('08:00');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  assert.equal(norm(await dialog.getByRole('alert').textContent()), 'La fin est avant le début.');
  await dialog.getByLabel('Fin').fill('09:30');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.slot.clash').count(), 2);
  const [w1, w2, col] = await Promise.all([slots.nth(0).boundingBox(), slots.nth(1).boundingBox(), column(1).boundingBox()]);
  assert.ok(w1.width < col.width / 2 && w2.width < col.width / 2 && w2.x >= w1.x + w1.width, 'side by side');
  await shot('timetable-clash.png');
  await page.getByRole('button', { name: /^4e A, lundi 08:30/ }).click();
  await dialog.getByRole('button', { name: 'Supprimer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.slot.clash').count(), 0);

  // A/B weeks: the Thursday lesson only on A weeks counts for half.
  await page.getByLabel('Semaines A/B').check();
  assert.equal(norm(await page.locator('.ab-bar .pill').textContent()), 'Cette semaine : A');
  await page.getByRole('button', { name: /^6e B, jeudi/ }).click();
  await dialog.getByLabel('Semaines').selectOption('A');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await slotTexts())[1], '6e B, jeudi 10:00–10:55, semaine A');
  assert.match(norm(await pick('6e B').textContent()), /1,5 cours \/ sem\./);

  // More lessons for the screenshots, then rename and delete classes.
  await pick('4e A').click();
  for (const [day, from, to] of [[2, '14:00', '15:00'], [5, '09:00', '10:00']]) {
    const p = await yOf(day, from);
    const q = await yOf(day, to);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up();
  }
  await page.getByLabel('Nom de la classe sélectionnée').fill('4e A Latin');
  assert.equal(await pick('4e A Latin').count(), 1);
  await shot('timetable.png');

  await page.reload();
  assert.equal(await slots.count(), 4, 'saved');
  assert.equal(await page.getByLabel('Semaines A/B').isChecked(), true);
  await page.getByRole('button', { name: 'Supprimer 4e A Latin' }).click(); // confirm() accepted by the runner
  assert.deepEqual(await slotTexts(), ['6e B, lundi 08:00–08:55, salle B12', '6e B, jeudi 10:00–10:55, semaine A']);

  // Phone: the grid scrolls inside its card, not the page.
  await page.setViewportSize({ width: 390, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
};
