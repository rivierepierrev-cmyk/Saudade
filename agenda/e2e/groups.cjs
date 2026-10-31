const assert = require('node:assert/strict');

/** Text with non-breaking spaces turned into plain ones. */
const norm = (t) => (t ?? '').replace(/ /g, ' ');

const seances = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, title: `${prefix} ${i + 1}` }));

/** Two classes of the same level, one lesson each on Monday morning; no group yet. */
const agenda = {
  classes: [{ id: 'c3', name: '2nde 3', color: '#4f7cff' }, { id: 'c4', name: '2nde 4', color: '#e8833a' }],
  timetable: [
    { id: 'c3-mon', classId: 'c3', weekday: 1, start: '08:00', end: '09:00' },
    { id: 'c4-mon', classId: 'c4', weekday: 1, start: '09:00', end: '10:00' },
  ],
  sequences: [
    { id: 'cin', title: 'Cinématique', color: '#2fa36b', seances: seances('Cinématique', 3) },
    { id: 'tp', title: 'TP mesures', color: '#8a63d2', seances: seances('TP', 2) },
  ],
  placements: [],
  calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] },
};

/** Grid geometry of the timetable: 1.1 px per minute, from 8:00. */
const PX = 1.1;

module.exports = async (page, { shot }) => {
  await page.evaluate((a) => localStorage.setItem('agenda.v1', JSON.stringify(a)), agenda);
  await page.reload();
  const dialog = page.getByRole('dialog');
  const lesson = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) });

  // Timetable: split 2nde 3 into half-groups, draw a practical for each group.
  await page.getByRole('button', { name: 'Emploi du temps', exact: true }).click();
  await page.locator('.class-pick', { hasText: '2nde 3' }).click();
  await page.getByRole('button', { name: 'Diviser en demi-groupes' }).click();
  assert.deepEqual(await page.locator('.groups li input').evaluateAll((els) => els.map((e) => e.value)), ['Groupe 1', 'Groupe 2']);

  await page.getByRole('radio', { name: 'Groupe 1' }).click();
  assert.match(await page.locator('.hint').textContent(), /cours de 2nde 3 · Groupe 1/);
  const col = await page.locator('.day-col[data-day="2"]').boundingBox();
  const y = (h, m) => col.y + (h * 60 + m - 480) * PX + 1;
  await page.mouse.move(col.x + col.width / 2, y(10, 0));
  await page.mouse.down();
  await page.mouse.move(col.x + col.width / 2, y(11, 30), { steps: 5 });
  await page.mouse.up();
  assert.equal(await lesson('2nde 3 · Groupe 1, mardi 10:00–11:30').count(), 1);

  await page.getByRole('button', { name: '+ Ajouter un cours' }).click();
  assert.equal(await dialog.getByLabel('Groupe').inputValue() !== '', true, 'the group being drawn is preselected');
  await dialog.getByLabel('Groupe').selectOption({ label: 'Groupe 2' });
  await dialog.getByLabel('Jour').selectOption({ label: 'Jeudi' });
  await dialog.getByLabel('Début').fill('14:00');
  await dialog.getByLabel('Fin').fill('15:30');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await lesson('2nde 3 · Groupe 2, jeudi 14:00–15:30').count(), 1);
  assert.match(norm(await page.locator('.class-pick', { hasText: '2nde 3' }).textContent()), /3 cours \/ sem\./);
  assert.match(norm(await page.locator('.groups li').first().textContent()), /1 cours \/ sem\./);
  await shot('groups-timetable.png');

  // Séquences: assign « Cinématique » to the whole 2nde 3 and to 2nde 4 at once.
  await page.getByRole('button', { name: 'Séquences', exact: true }).click();
  await page.locator('.seq-pick', { hasText: 'Cinématique' }).click();
  assert.match(norm(await page.locator('.builder-head p').textContent()), /2nde 3 : ≈ 3 semaines.*2nde 3 · Groupe 1 : ≈ 3 semaines.*2nde 4 : ≈ 3 semaines/);
  await page.getByRole('button', { name: 'Assigner à des classes…' }).click();
  await dialog.getByLabel('2nde 3 · classe entière').check();
  await dialog.getByLabel('2nde 4').check();
  await dialog.getByLabel('Date de début').fill('2025-10-06');
  assert.equal(await dialog.locator('.target-summaries li').count(), 2);
  await dialog.locator('.target-summaries button', { hasText: '2nde 4' }).click();
  assert.match(norm(await dialog.locator('.big').textContent()), /3 séances pour 2nde 4, du lun\. 6 oct\. au lun\. 20 oct\./);
  await shot('groups-assign.png');
  await dialog.getByRole('button', { name: 'Placer sur 2 classes ou groupes' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual((await page.locator('.assigned-chip').allTextContents()).map(norm), ['2nde 3 6 oct. → 20 oct.', '2nde 4 6 oct. → 20 oct.']);

  // « TP mesures » on both half-groups, each following its own lessons.
  await page.locator('.seq-pick', { hasText: 'TP mesures' }).click();
  await page.getByRole('button', { name: 'Assigner à des classes…' }).click();
  await dialog.getByLabel('2nde 3 · Groupe 1').check();
  await dialog.getByLabel('2nde 3 · Groupe 2').check();
  await dialog.getByLabel('À la suite de la séquence précédente').check();
  await dialog.getByRole('button', { name: 'Placer sur 2 classes ou groupes' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual((await page.locator('.assigned-chip').allTextContents()).map(norm), ['2nde 3 · Groupe 1 7 oct. → 14 oct.', '2nde 3 · Groupe 2 2 oct. → 9 oct.']);

  // Same level, different progress: 2nde 4 starts a week later.
  await page.locator('.seq-pick', { hasText: 'Cinématique' }).click();
  await page.locator('.assigned-chip', { hasText: '2nde 4' }).getByRole('button').click();
  assert.equal(norm(await dialog.locator('h2').textContent()), 'Déplacer « Cinématique »');
  await dialog.getByLabel('Date de début').fill('2025-10-13');
  await dialog.getByRole('button', { name: 'Déplacer' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Agenda: on Monday 13 October, both classes have Cinématique, at different points.
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.getByRole('button', { name: 'Suivant' }).click();
  assert.equal(norm(await page.locator('.agenda-title').textContent()), 'Semaine du 13 oct.');
  assert.match(await lesson('2nde 3, lundi 13 octobre 2025').getAttribute('aria-label'), /Cinématique, séance 2\/3/);
  assert.match(await lesson('2nde 4, lundi 13 octobre 2025').getAttribute('aria-label'), /Cinématique, séance 1\/3/);
  assert.match(await lesson('2nde 3 · Groupe 1, mardi 14 octobre 2025').getAttribute('aria-label'), /TP mesures, séance 2\/2/);
  assert.match(await lesson('2nde 3 · Groupe 2, jeudi 16 octobre 2025').getAttribute('aria-label'), /libre$/);
  await shot('groups-agenda.png');

  // The side panel: the class as a whole and each group, with their own progress.
  const c3 = page.locator('.class-plan', { hasText: '2nde 3' });
  assert.deepEqual((await c3.locator('.class-plan-head b').allTextContents()), ['Classe entière', 'Groupe 1', 'Groupe 2']);

  // Cancelling a lesson of group 1 moves only group 1.
  await lesson('2nde 3 · Groupe 1, mardi 14 octobre 2025').click();
  await dialog.getByRole('button', { name: 'Annuler ce cours' }).click();
  await dialog.getByRole('button', { name: "Confirmer l'annulation" }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.match(norm(await page.getByLabel('2nde 3 · Groupe 1', { exact: true }).locator('.placed').textContent()), /TP mesures7 oct\. → 21 oct\./);
  assert.match(norm(await page.getByLabel('2nde 3 · Groupe 2', { exact: true }).locator('.placed').textContent()), /TP mesures2 oct\. → 9 oct\./);

  // Dropping a séquence on a group: it follows that group's séquence.
  const from = await page.locator('.palette-card', { hasText: 'Cinématique' }).boundingBox();
  const to = await page.getByLabel('2nde 3 · Groupe 2', { exact: true }).boundingBox();
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 12, { steps: 8 });
  assert.equal(await page.locator('.track-plan.drop-over').count(), 1);
  await page.mouse.up();
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('2nde 3 · Groupe 2').isChecked(), true);
  assert.equal(await dialog.getByLabel('2nde 3 · Groupe 1').isChecked(), false);
  assert.match(norm(await dialog.locator('.big').textContent()), /3 séances pour 2nde 3 · Groupe 2, du jeu\. 16 oct\. au jeu\. 30 oct\./);
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  // Saved (the agenda reopens on today's week).
  await page.reload();
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.getByRole('button', { name: 'Suivant' }).click();
  assert.equal(await lesson('2nde 3 · Groupe 1, mardi 14 octobre 2025, 10:00–11:30 : annulé').count(), 1);
};
