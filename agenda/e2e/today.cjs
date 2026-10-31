const assert = require('node:assert/strict');

/** Text with non-breaking spaces turned into plain ones. */
const norm = (t) => (t ?? '').replace(/ /g, ' ');

/** 6e B on Monday, Wednesday and Thursday; « Fractions » from 22 September. Today is Wednesday 1 October. */
const agenda = {
  classes: [{ id: '6B', name: '6e B', level: '6e', color: '#4f7cff' }],
  timetable: [
    { id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '08:55' },
    { id: 'wed', classId: '6B', weekday: 3, start: '10:00', end: '10:55' },
    { id: 'thu', classId: '6B', weekday: 4, start: '10:00', end: '10:55' },
  ],
  sequences: [{
    id: 'frac', title: 'Fractions', level: '6e', color: '#2fa36b',
    seances: Array.from({ length: 6 }, (_, i) => ({ id: `f${i + 1}`, title: `Fractions ${i + 1}`, objectives: `Objectif ${i + 1}`, homework: i === 4 ? 'Exercice 5 p. 40' : undefined })),
  }],
  placements: [{ id: 'p', sequenceId: 'frac', classId: '6B', start: '2025-09-22' }],
  calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] },
};

module.exports = async (page, { shot }) => {
  await page.evaluate((a) => localStorage.setItem('agenda.v1', JSON.stringify(a)), agenda);
  await page.reload();
  const card = page.locator('.today-card').first();
  const undoBtn = page.getByRole('button', { name: 'Annuler la dernière modification' });
  const redoBtn = page.getByRole('button', { name: 'Rétablir la modification' });

  // Today: the lesson of the day with everything to do in it, and past lessons to confirm.
  await page.getByRole('tab', { name: "Aujourd'hui" }).click();
  assert.equal(norm(await page.locator('.agenda-title').textContent()), "Aujourd'hui, mercredi 1 octobre");
  assert.equal(await page.locator('.today-title').count(), 0);
  assert.match(norm(await card.textContent()), /10:00–10:55 6e B · Fractions 5\/6Fractions 5Objectifs\. Objectif 5Devoirs\. Exercice 5 p\. 40/);
  assert.equal(norm(await page.locator('.to-confirm h4').textContent()), 'À confirmer : 4 cours passés');
  assert.equal(await undoBtn.isDisabled(), true);

  // Confirm two past lessons; one was not done: its séance and the rest move on.
  await page.getByRole('button', { name: 'Faite : 6e B, lun. 22 sept.', exact: true }).click();
  await page.getByRole('button', { name: 'Faite : 6e B, mer. 24 sept.', exact: true }).click();
  await page.getByRole('button', { name: 'Pas faite : 6e B, lun. 29 sept.' }).click();
  assert.equal(norm(await page.locator('.to-confirm h4').textContent()), 'À confirmer : un cours passé');
  assert.match(norm(await card.textContent()), /Fractions 4\/6/, 'the séance not done comes back today');
  await shot('today.png');

  // Done today; undo and redo, with the buttons and the keyboard.
  await card.getByRole('button', { name: '✓ Marquer comme faite' }).click();
  assert.equal(await card.getAttribute('class'), 'today-card is-done');
  await undoBtn.click();
  assert.equal(await card.getAttribute('class'), 'today-card');
  assert.equal(norm(await page.locator('.toast').textContent()), 'Modification annulée');
  await redoBtn.click();
  assert.equal(await card.getAttribute('class'), 'today-card is-done');
  await page.locator('.agenda-title').click();
  await page.keyboard.press('Control+z');
  assert.equal(await card.getAttribute('class'), 'today-card');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await card.getAttribute('class'), 'today-card is-done');
  await card.getByRole('button', { name: '✓ Faite' }).click();

  // Not finished today: postponed to tomorrow; then the postponement is undone.
  await card.getByRole('button', { name: 'Pas faite : reporter…' }).click();
  await card.getByLabel('Note').fill('Pas fini');
  await card.getByRole('button', { name: 'Reporter la séance' }).click();
  assert.match(norm(await page.locator('.today-card.muted-card').textContent()), /6e B · Séance reportée \(Pas fini\)/);
  await page.getByRole('button', { name: 'Annuler le report' }).click();
  assert.match(norm(await card.textContent()), /Fractions 4\/6/);

  // The week shows what was done and what was postponed.
  await page.getByRole('tab', { name: 'Semaine' }).click();
  await page.getByRole('button', { name: 'Précédent' }).click();
  assert.match(await page.getByRole('button', { name: /^6e B, lundi 22 septembre 2025/ }).getAttribute('aria-label'), /Fractions 1, faite$/);
  await page.getByRole('button', { name: 'Suivant' }).click();
  assert.match(await page.getByRole('button', { name: /^6e B, lundi 29 septembre 2025/ }).getAttribute('aria-label'), /séance reportée$/);

  // From a lesson window: mark done, and postpone.
  await page.getByRole('button', { name: /^6e B, jeudi 2 octobre 2025/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '✓ Marquer comme faite' }).click();
  assert.equal(norm(await dialog.locator('.done-pill').textContent()), 'Faite');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  assert.match(await page.getByRole('button', { name: /^6e B, jeudi 2 octobre 2025/ }).getAttribute('aria-label'), /, faite$/);

  // Typing in a field: one undo step for the whole word.
  await page.getByRole('button', { name: 'Séquences', exact: true }).click();
  const title = page.getByLabel('Titre de la séquence');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' et décimaux', { delay: 30 });
  assert.equal(await title.inputValue(), 'Fractions et décimaux');
  await undoBtn.click();
  assert.equal(await title.inputValue(), 'Fractions');
  await redoBtn.click();
  assert.equal(await title.inputValue(), 'Fractions et décimaux');

  // Saved.
  await page.reload();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByRole('tab', { name: "Aujourd'hui" }).click();
  assert.equal(norm(await page.locator('.to-confirm h4').textContent()), 'À confirmer : un cours passé');
};
