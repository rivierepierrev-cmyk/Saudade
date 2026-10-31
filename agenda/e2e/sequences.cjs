const assert = require('node:assert/strict');

/** Text with non-breaking spaces turned into plain ones. */
const norm = (t) => (t ?? '').replace(/\u00a0/g, ' ');

module.exports = async (page, { shot }) => {
  const dialog = page.getByRole('dialog');
  const blocks = page.locator('.blocks > li');
  const titles = () => page.locator('.block-title').evaluateAll((els) => els.map((e) => e.firstChild.textContent));

  // A class with 1.5 lessons a week (one every week, one on A weeks), for the duration estimate.
  const newClass = page.getByLabel('Nouvelle classe');
  await newClass.fill('6e B');
  await newClass.press('Enter');
  await page.getByLabel('Semaines A/B').check();
  for (const [day, start, end, week] of [['Lundi', '08:00', '08:55', ''], ['Jeudi', '10:00', '10:55', 'A']]) {
    await page.getByRole('button', { name: '+ Ajouter un cours' }).click();
    await dialog.getByLabel('Jour').selectOption({ label: day });
    await dialog.getByLabel('Début').fill(start);
    await dialog.getByLabel('Fin').fill(end);
    if (week) await dialog.getByLabel('Semaines').selectOption(week);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'hidden' });
  }

  await page.getByRole('button', { name: 'Séquences' }).click();
  assert.match(norm(await page.locator('.empty-builder').textContent()), /Aucune séquence/);

  // Two séquences.
  const newSeq = page.getByLabel('Nouvelle séquence');
  await newSeq.fill('Géométrie');
  await newSeq.press('Enter');
  await newSeq.fill('Fractions');
  await page.getByRole('button', { name: 'Créer' }).click();
  assert.equal(await page.getByLabel('Titre de la séquence').inputValue(), 'Fractions');
  await page.getByLabel('Matière ou niveau').fill('Maths 6e');

  // Séance blocks, each through the séance window.
  const add = async (title, fields = {}) => {
    await page.getByRole('button', { name: '+ Ajouter une séance' }).click();
    await dialog.waitFor();
    assert.match(norm(await dialog.locator('h2').textContent()), /^Nouvelle séance · Fractions/);
    await dialog.getByLabel('Titre').fill(title);
    if (fields.duration) await dialog.getByLabel('Durée').selectOption(fields.duration);
    if (fields.objectives) await dialog.getByLabel('Objectifs').fill(fields.objectives);
    if (fields.activities) await dialog.getByLabel('Déroulé').fill(fields.activities);
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  await add('Découverte', { objectives: 'Comparer des fractions simples', activities: '10 min : rappel\n30 min : activité de découverte\n15 min : trace écrite' });
  await add('Exercices', { objectives: "S'entraîner sur la droite graduée" });
  await add('Évaluation', { duration: '2' });
  await add('Correction');
  assert.deepEqual(await titles(), ['Découverte', 'Exercices', 'Évaluation', 'Correction']);
  assert.match(norm(await page.locator('.builder-head p').textContent()), /4 séances · 5 cours — 6e B : ≈ 3,5 semaines \(1,5 cours\/sem\.\)/);
  assert.match(norm(await page.locator('.library').textContent()), /FractionsMaths 6e · 4 séances · 5 cours/);
  await shot('sequence-builder.png');

  // Drag « Correction » to the top with its handle.
  const handle = (i) => blocks.nth(i).locator('.handle');
  const from = await handle(3).boundingBox();
  const to = await blocks.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 8 });
  assert.equal(await page.locator('.block.lifted').count(), 1);
  await page.mouse.up();
  assert.deepEqual(await titles(), ['Correction', 'Découverte', 'Exercices', 'Évaluation']);

  // Keyboard: arrows on the handle; buttons.
  await handle(0).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await titles(), ['Découverte', 'Exercices', 'Évaluation', 'Correction']);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Déplacer la séance 4 (flèches haut et bas)', 'focus follows the block');
  await page.getByRole('button', { name: 'Monter la séance 2' }).click();
  assert.deepEqual(await titles(), ['Exercices', 'Découverte', 'Évaluation', 'Correction']);
  await page.getByRole('button', { name: 'Monter la séance 2' }).click();

  // Duplicate and delete blocks (an empty one goes without asking).
  await page.getByRole('button', { name: 'Dupliquer la séance 4' }).click();
  assert.deepEqual(await titles(), ['Découverte', 'Exercices', 'Évaluation', 'Correction', 'Correction']);
  await page.getByRole('button', { name: 'Supprimer la séance 5' }).click();
  assert.equal(await blocks.count(), 4);

  // Open a block: its content; reuse it in « Géométrie »; edit it.
  await page.locator('.block-body').first().click();
  await dialog.waitFor();
  assert.equal(norm(await dialog.locator('h2').textContent()), 'Séance 1 · Fractions');
  assert.equal(await dialog.getByLabel('Objectifs').inputValue(), 'Comparer des fractions simples');
  await dialog.getByLabel('Devoirs').fill('Exercice 3 p. 42');
  await shot('seance-window.png');
  await dialog.getByRole('button', { name: 'Copier' }).click();
  assert.equal(norm(await dialog.getByRole('status').textContent()), 'Copiée à la fin de « Géométrie ».');
  await dialog.getByLabel('Titre').fill('Découverte des fractions');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await titles())[0], 'Découverte des fractions');

  // Cancel leaves the séance as it was.
  await page.locator('.block-body').first().click();
  await dialog.getByLabel('Titre').fill('Autre chose');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  assert.equal((await titles())[0], 'Découverte des fractions');

  await page.getByRole('button', { name: /^Géométrie/ }).click();
  assert.deepEqual(await titles(), ['Découverte']);
  await page.locator('.block-body').first().click();
  assert.equal(await dialog.getByLabel('Devoirs').inputValue(), 'Exercice 3 p. 42');
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  // Duplicate and delete séquences.
  await page.getByRole('button', { name: /^Fractions/ }).click();
  await page.getByRole('button', { name: 'Dupliquer', exact: true }).click();
  assert.equal(await page.getByLabel('Titre de la séquence').inputValue(), 'Fractions (copie)');
  assert.equal(await blocks.count(), 4);
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click(); // confirm() accepted by the runner
  assert.equal(await page.locator('.seq-pick').count(), 2);

  // Everything is saved, including the tab.
  await page.reload();
  assert.equal(await page.getByRole('button', { name: 'Séquences' }).getAttribute('aria-current'), 'page');
  await page.getByRole('button', { name: /^Fractions/ }).click();
  assert.deepEqual(await titles(), ['Découverte des fractions', 'Exercices', 'Évaluation', 'Correction']);
  assert.equal(norm(await page.locator('.block-title .pill').textContent()), '2 cours');

  // Phone: blocks still reorder with a finger on the handle.
  await page.setViewportSize({ width: 390, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot('sequence-phone.png');
};
