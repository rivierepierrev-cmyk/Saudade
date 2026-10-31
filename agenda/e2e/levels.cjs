const assert = require('node:assert/strict');

/** Text with non-breaking spaces turned into plain ones. */
const norm = (t) => (t ?? '').replace(/ /g, ' ');

const seances = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, title: `${prefix} ${i + 1}` }));

/** Three levels taught on Monday. Classes saved without a level: it is guessed from their names. */
const agenda = {
  classes: [{ id: '6B', name: '6e B', color: '#4f7cff' }, { id: '4A', name: '4e A', color: '#e8833a' }, { id: 'T1', name: 'Tle 1', color: '#c94f7c' }],
  timetable: [
    { id: 'a', classId: '6B', weekday: 1, start: '08:00', end: '09:00' },
    { id: 'b', classId: '4A', weekday: 1, start: '09:00', end: '10:00' },
    { id: 'c', classId: 'T1', weekday: 1, start: '14:00', end: '16:00' },
  ],
  sequences: [
    { id: 'frac', title: 'Fractions', level: '6e', color: '#2fa36b', seances: seances('Fractions', 4) },
    { id: 'pyth', title: 'Pythagore', level: '4e', color: '#8a63d2', seances: seances('Pythagore', 3) },
    { id: 'deriv', title: 'Dérivation', level: 'Tle', color: '#d1a516', seances: seances('Dérivation', 3) },
    { id: 'meth', title: 'Méthodologie', color: '#2aa1b3', seances: seances('Méthode', 2) },
  ],
  placements: [],
  calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] },
};

module.exports = async (page, { shot }) => {
  await page.evaluate((a) => localStorage.setItem('agenda.v1', JSON.stringify(a)), agenda);
  await page.reload();
  const dialog = page.getByRole('dialog');
  const lesson = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) });
  const palette = () => page.locator('.palette .seq-title').allTextContents();

  // Levels guessed from the class names.
  await page.getByRole('button', { name: 'Emploi du temps', exact: true }).click();
  await page.locator('.class-pick', { hasText: '4e A' }).click();
  assert.equal(await page.getByLabel('Niveau de la classe').inputValue(), '4e');
  await page.locator('.class-pick', { hasText: 'Tle 1' }).click();
  assert.equal(await page.getByLabel('Niveau de la classe').inputValue(), 'Tle');

  // Agenda: séquences filtered by level.
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  assert.deepEqual(await page.locator('.agenda-side .level-filter button').allTextContents(), ['Tous', '6e', '4e', 'Tle']);
  await page.locator('.agenda-side .level-filter').getByRole('radio', { name: '6e' }).click();
  assert.deepEqual(await palette(), ['Fractions']);
  await page.locator('.agenda-side .level-filter').getByRole('radio', { name: 'Tous' }).click();
  assert.deepEqual(await palette(), ['Fractions', 'Pythagore', 'Dérivation', 'Méthodologie']);
  assert.deepEqual(await page.locator('.class-plan .class-plan-head b').allTextContents(), ['6e B', '4e A', 'Tle 1'], 'classes in school order');

  // Placing « Fractions »: the 6e first; a 4e is allowed, with a warning.
  await page.locator('.palette li', { hasText: 'Fractions' }).getByRole('button', { name: 'Placer…' }).click();
  assert.deepEqual((await dialog.locator('.target-level-name').allTextContents()).map(norm), ['6e · niveau de la séquence', '4e', 'Tle']);
  await dialog.getByLabel('6e B').check();
  await dialog.getByLabel('4e A').check();
  assert.equal(norm(await dialog.locator('.level-warning').textContent()), '« Fractions » est prévue pour la 6e ; 4e A est en 4e.');
  await shot('levels-placement.png');
  await dialog.getByLabel('4e A').uncheck();
  assert.equal(await dialog.locator('.level-warning').count(), 0);
  await dialog.getByLabel('Date de début').fill('2025-10-06');
  await dialog.getByRole('button', { name: 'Placer' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Dragging « Pythagore » over the 6e: the label says it is another level.
  const from = await page.locator('.palette-card', { hasText: 'Pythagore' }).boundingBox();
  const to = await lesson('6e B, lundi 29 septembre 2025').boundingBox();
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  assert.equal(norm(await page.locator('.ghost-warning').textContent()), 'Autre niveau : 6e');
  const to4 = await lesson('4e A, lundi 29 septembre 2025').boundingBox();
  await page.mouse.move(to4.x + to4.width / 2, to4.y + to4.height / 2, { steps: 4 });
  assert.equal(await page.locator('.ghost-warning').count(), 0, 'right level: no warning');
  await page.mouse.up();
  await dialog.waitFor();
  assert.equal(await dialog.locator('.level-warning').count(), 0);
  await dialog.getByLabel('Date de début').fill('2025-10-06');
  await dialog.getByRole('button', { name: 'Placer' }).click();
  await dialog.waitFor({ state: 'hidden' });

  await page.locator('.palette li', { hasText: 'Dérivation' }).getByRole('button', { name: 'Placer…' }).click();
  await dialog.getByLabel('Tle 1').check();
  await dialog.getByLabel('Date de début').fill('2025-10-06');
  await dialog.getByRole('button', { name: 'Placer' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Monday 6 October: three levels, each with its own séance.
  await page.getByRole('button', { name: 'Suivant' }).click();
  assert.match(await lesson('6e B, lundi 6 octobre 2025').getAttribute('aria-label'), /Fractions, séance 1\/4/);
  assert.match(await lesson('4e A, lundi 6 octobre 2025').getAttribute('aria-label'), /Pythagore, séance 1\/3/);
  assert.match(await lesson('Tle 1, lundi 6 octobre 2025').getAttribute('aria-label'), /Dérivation, séance 1\/3/);
  await shot('levels-week.png');
  await page.getByRole('button', { name: 'Voir le lundi 6 octobre 2025' }).click();
  assert.deepEqual((await page.locator('.day-card-head').allTextContents()).map(norm), [
    '08:00–09:00 6e B · Fractions 1/4',
    '09:00–10:00 4e A · Pythagore 1/3',
    '14:00–16:00 Tle 1 · Dérivation 1/3',
  ]);

  // Séquences tab: the same filter; a séquence created under « 4e » is for the 4e; durations for its level only.
  await page.getByRole('button', { name: 'Séquences', exact: true }).click();
  await page.locator('.library .level-filter').getByRole('radio', { name: '4e' }).click();
  assert.deepEqual(await page.locator('.seq-pick .seq-title').allTextContents(), ['Pythagore']);
  await page.getByLabel('Nouvelle séquence').fill('Calcul littéral');
  await page.getByRole('button', { name: 'Créer' }).click();
  assert.equal(await page.getByLabel('Niveau de la séquence').inputValue(), '4e');
  assert.deepEqual(await page.locator('.seq-pick .seq-title').allTextContents(), ['Pythagore', 'Calcul littéral']);
  await page.locator('.library .level-filter').getByRole('radio', { name: 'Tous' }).click();
  await page.locator('.seq-pick', { hasText: 'Fractions' }).click();
  assert.match(norm(await page.locator('.builder-head p').textContent()), /— 6e B : ≈ 4 semaines \(1 cours\/sem\.\)$/);
};
