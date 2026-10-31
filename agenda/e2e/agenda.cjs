const assert = require('node:assert/strict');

/** Text with non-breaking spaces turned into plain ones. */
const norm = (t) => (t ?? '').replace(/ /g, ' ');

const seances = (prefix, list) => list.map(([title, extra], i) => ({ id: `${prefix}${i + 1}`, title, ...extra }));

/** A teacher's year, 2025-2026, zone A: two classes, two séquences, Toussaint and 11 November. */
const agenda = {
  classes: [{ id: '6B', name: '6e B', color: '#4f7cff' }, { id: '4A', name: '4e A', color: '#e8833a' }],
  timetable: [
    { id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '08:55', room: 'B12' },
    { id: 'thu', classId: '6B', weekday: 4, start: '10:00', end: '10:55' },
    { id: 'tue', classId: '4A', weekday: 2, start: '14:00', end: '15:00' },
  ],
  sequences: [
    {
      id: 'frac', title: 'Fractions', color: '#2fa36b', seances: seances('f', [
        ['Découverte', { objectives: 'Comparer des fractions simples', activities: '10 min : rappel\n30 min : activité' }],
        ['Exercices'],
        ['Évaluation', { slots: 2 }],
        ['Correction'],
      ]),
    },
    { id: 'geo', title: 'Géométrie', color: '#8a63d2', seances: seances('g', [['Symétrie'], ['Figures']]) },
  ],
  placements: [],
  calendar: {
    start: '2025-09-01', end: '2026-07-03', closures: [
      { start: '2025-10-18', end: '2025-11-02', label: 'Toussaint', kind: 'holiday' },
      { start: '2025-11-11', end: '2025-11-11', label: 'Armistice', kind: 'public-holiday' },
    ],
  },
};

module.exports = async (page, { shot }) => {
  await page.evaluate((a) => localStorage.setItem('agenda.v1', JSON.stringify(a)), agenda);
  await page.reload();
  const dialog = page.getByRole('dialog');
  const lesson = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) });
  const center = async (locator) => {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const dragTo = async (from, to, during) => {
    const a = await center(from);
    const b = await center(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 10, a.y + 10, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 10 });
    if (during) await during();
    await page.mouse.up();
  };
  const sidebar = page.locator('.class-plan', { hasText: '6e B' });

  // The week of today (Wednesday 1 October), every lesson free.
  assert.equal(await page.getByRole('button', { name: 'Agenda' }).getAttribute('aria-current'), 'page');
  assert.equal(norm(await page.locator('.agenda-title').textContent()), 'Semaine du 29 sept.');
  assert.equal(await page.locator('.lesson.free').count(), 3);

  // Drag « Fractions » onto the Thursday lesson of 6e B: the agenda shows where it would go, and its end.
  await dragTo(page.locator('.palette-card', { hasText: 'Fractions' }), lesson('6e B, jeudi 2 octobre 2025'), async () => {
    assert.equal(await page.locator('.lesson.incoming').count(), 1);
    assert.match(norm(await page.locator('.drag-ghost').textContent()), /Fractions→ 6e B · fin jeu\. 16 oct\./);
    await shot('agenda-drag.png');
  });

  // On drop: every séance with its date, then a later start that runs into Toussaint.
  await dialog.waitFor();
  assert.equal(norm(await dialog.locator('h2').textContent()), 'Placer « Fractions »');
  assert.match(norm(await dialog.locator('.big').textContent()), /4 séances pour 6e B, du jeu\. 2 oct\. au jeu\. 16 oct\./);
  await dialog.getByLabel('Date de début').fill('2025-10-09');
  assert.match(norm(await dialog.locator('.big').textContent()), /du jeu\. 9 oct\. au jeu\. 6 nov\./);
  assert.equal(norm(await dialog.locator('.end-line').textContent()), 'Fin de la séquence : jeudi 6 novembre 2025');
  assert.equal(norm(await dialog.locator('.skip-line').textContent()), 'Saute : Toussaint (18 oct. → 2 nov.)');
  const rows = await dialog.locator('.placement-list li').allTextContents();
  assert.deepEqual(rows.map(norm), [
    'jeu. 9 oct. · 10:001. DécouverteComparer des fractions simples',
    'lun. 13 oct. · 08:002. Exercices',
    'jeu. 16 oct. · 10:00lun. 3 nov. · 08:003. Évaluationcoupée par des vacances',
    'jeu. 6 nov. · 10:004. Correction',
  ]);
  await shot('placement-window.png');
  await dialog.getByRole('button', { name: 'Placer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.match(norm(await sidebar.locator('.placed').textContent()), /Fractions9 oct\. → 6 nov\./);

  // The week of 13 October shows what is done in each lesson.
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.getByRole('button', { name: 'Suivant' }).click();
  assert.equal(norm(await page.locator('.agenda-title').textContent()), 'Semaine du 13 oct.');
  assert.match(await lesson('6e B, lundi 13 octobre 2025').getAttribute('aria-label'), /Fractions, séance 2\/4, Exercices$/);
  assert.match(await lesson('6e B, jeudi 16 octobre 2025').getAttribute('aria-label'), /séance 3\/4, Évaluation$/);

  // « Géométrie » dropped on the class follows « Fractions ».
  await dragTo(page.locator('.palette-card', { hasText: 'Géométrie' }), sidebar, async () => {
    assert.equal(await page.locator('.track-plan.drop-over').count(), 1);
  });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('À la suite de la séquence précédente').isChecked(), true);
  assert.match(norm(await dialog.locator('.big').textContent()), /2 séances pour 6e B, du lun\. 10 nov\. au jeu\. 13 nov\./);
  await dialog.getByRole('button', { name: 'Placer' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Move « Fractions » by dragging one of its lessons: « Géométrie » is pushed back.
  await dragTo(lesson('6e B, lundi 13 octobre 2025'), lesson('6e B, jeudi 16 octobre 2025'));
  await dialog.waitFor();
  assert.equal(norm(await dialog.locator('h2').textContent()), 'Déplacer « Fractions »');
  assert.equal(norm(await dialog.locator('.shift-line').textContent()), 'Décale : Géométrie (fin 13 nov. → 20 nov.)');
  await dialog.getByRole('button', { name: 'Déplacer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.match(await lesson('6e B, jeudi 16 octobre 2025').getAttribute('aria-label'), /séance 1\/4, Découverte$/);
  assert.match(await lesson('6e B, lundi 13 octobre 2025').getAttribute('aria-label'), /libre$/);
  await shot('agenda-week.png');

  // A lesson: what is done in it. Cancel it: the séances move to the next lesson; restore it.
  await lesson('6e B, jeudi 16 octobre 2025').click();
  await dialog.waitFor();
  assert.match(norm(await dialog.locator('.lesson-seq').textContent()), /Fractions · séance 1\/4/);
  assert.equal(await dialog.locator('h3').textContent(), 'Découverte');
  assert.match(await dialog.locator('.lesson-detail').textContent(), /Objectifs.*Comparer des fractions simples.*Déroulé.*10 min : rappel/s);
  await dialog.getByRole('button', { name: 'Annuler ce cours' }).click();
  await dialog.getByLabel('Raison').fill('Sortie');
  await dialog.getByRole('button', { name: "Confirmer l'annulation" }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await lesson('6e B, jeudi 16 octobre 2025, 10:00–10:55 : annulé \\(Sortie\\)').count(), 1);
  assert.match(norm(await sidebar.locator('.placed').textContent()), /Fractions3 nov\. → 17 nov\./);
  await lesson('6e B, jeudi 16 octobre 2025').click();
  await dialog.getByRole('button', { name: 'Rétablir ce cours' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.match(norm(await sidebar.locator('.placed').textContent()), /Fractions16 oct\. → 13 nov\./);

  // Edit the séance from the agenda.
  await lesson('6e B, jeudi 16 octobre 2025').click();
  await dialog.getByRole('button', { name: 'Modifier la séance' }).click();
  await dialog.getByLabel('Devoirs').fill('Exercice 3 p. 42');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Day view: everything to teach that day.
  await page.getByRole('button', { name: 'Voir le jeudi 16 octobre 2025' }).click();
  assert.equal(await page.getByRole('tab', { name: 'Jour' }).getAttribute('aria-selected'), 'true');
  const card = page.locator('.day-card').first();
  assert.match(await card.textContent(), /10:00–10:55 6e B · Fractions 1\/4.*Découverte.*Objectifs\. Comparer des fractions simples.*10 min : rappel.*Devoirs\. Exercice 3 p\. 42/s);
  await shot('agenda-day.png');
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.getByRole('button', { name: 'Suivant' }).click();
  assert.equal(norm(await page.locator('.closed-banner').textContent()), 'Toussaint');

  // Month view: November, with 11 November closed.
  await page.getByRole('tab', { name: 'Mois' }).click();
  assert.equal(norm(await page.locator('.agenda-title').textContent()), 'Octobre 2025');
  await page.getByRole('button', { name: 'Suivant' }).click();
  assert.equal(norm(await page.locator('.agenda-title').textContent()), 'Novembre 2025');
  assert.equal(norm(await page.locator('.month-cell', { has: page.getByRole('button', { name: 'Voir le mardi 11 novembre 2025' }) }).locator('.closed-label').textContent()), 'Armistice');
  assert.ok((await page.locator('.month-cell:not(.outside) .lesson.planned').count()) >= 6);
  await shot('agenda-month.png');

  // Placing without dragging, then removing from the class.
  await page.locator('.palette li', { hasText: 'Géométrie' }).getByRole('button', { name: 'Placer…' }).click();
  assert.equal(await dialog.getByRole('button', { name: 'Placer' }).isDisabled(), true, 'nothing chosen yet');
  await dialog.getByLabel('4e A').check();
  await dialog.getByLabel('À partir du').check();
  await dialog.getByLabel('Date de début').fill('2025-11-04');
  assert.match(norm(await dialog.locator('.big').textContent()), /2 séances pour 4e A, du mar\. 4 nov\. au mar\. 18 nov\./);
  await dialog.getByRole('button', { name: 'Placer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Retirer Géométrie de 6e B' }).click();
  assert.equal(await sidebar.locator('.placed li').count(), 1);

  // Saved.
  await page.reload();
  assert.equal(await page.getByRole('tab', { name: 'Mois' }).getAttribute('aria-selected'), 'true', 'view remembered');
  assert.match(norm(await page.locator('.class-plan', { hasText: '4e A' }).locator('.placed').textContent()), /Géométrie4 nov\. → 18 nov\./);

  // Phone: no horizontal page scroll.
  await page.setViewportSize({ width: 390, height: 820 });
  await page.getByRole('tab', { name: 'Semaine' }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot('agenda-phone.png');
};
