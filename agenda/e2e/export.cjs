const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agenda = {
  classes: [{ id: '6B', name: '6e B', level: '6e', color: '#4f7cff' }, { id: '4A', name: '4e A', level: '4e', color: '#e8833a' }],
  timetable: [
    { id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '08:55', room: 'B12' },
    { id: 'tue', classId: '4A', weekday: 2, start: '14:00', end: '15:00' },
  ],
  sequences: [{ id: 'f', title: 'Fractions', level: '6e', color: '#2fa36b', seances: [{ id: 'f1', title: 'Découverte', objectives: 'Comparer des fractions' }, { id: 'f2', title: 'Exercices' }] }],
  placements: [{ id: 'p', sequenceId: 'f', classId: '6B', start: '2025-09-29' }],
  calendar: { start: '2025-09-01', end: '2025-10-17', closures: [] },
};

module.exports = async (page, { shot }) => {
  await page.evaluate((a) => localStorage.setItem('agenda.v1', JSON.stringify(a)), agenda);
  await page.reload();
  const menu = () => page.getByRole('button', { name: 'Fichier ▾' }).click();
  const save = async (item) => {
    await menu();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click()]);
    return { name: download.suggestedFilename(), text: fs.readFileSync(await download.path(), 'utf8') };
  };

  // Calendar file: every lesson, with its séance.
  const ics = await save('Exporter vers un calendrier');
  assert.equal(ics.name, 'agenda.ics');
  const unfolded = ics.text.replace(/\r\n /g, '');
  assert.equal(unfolded.split('BEGIN:VEVENT').length - 1, 14, '7 weeks × 2 lessons');
  assert.match(unfolded, /DTSTART;TZID=Europe\/Paris:20250929T080000\r\nDTEND;TZID=Europe\/Paris:20250929T085500\r\nSUMMARY:6e B · Fractions 1\/2 : Découverte\r\nDESCRIPTION:Objectifs : Comparer des fractions\r\nLOCATION:Salle B12/);

  // Backup, a change, then restore (undoable).
  const backup = await save('Sauvegarder dans un fichier');
  assert.equal(backup.name, 'agenda-2025-10-01.json');
  assert.deepEqual(JSON.parse(backup.text).agenda.classes.map((c) => c.name), ['6e B', '4e A']);
  assert.equal(await page.locator('.toast').textContent(), 'Sauvegarde enregistrée');

  await page.getByRole('button', { name: 'Emploi du temps', exact: true }).click();
  await page.getByRole('button', { name: 'Supprimer 4e A' }).click();
  assert.equal(await page.locator('.class-pick').count(), 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-'));
  const file = path.join(dir, backup.name);
  fs.writeFileSync(file, backup.text);
  await menu();
  await page.getByLabel('Fichier de sauvegarde').setInputFiles(file); // confirm() accepted by the runner
  await page.locator('.toast', { hasText: 'Sauvegarde restaurée' }).waitFor(); // the file is read asynchronously
  assert.equal(await page.locator('.class-pick').count(), 2);
  await page.getByRole('button', { name: 'Annuler la dernière modification' }).click();
  assert.equal(await page.locator('.class-pick').count(), 1, 'the restore can be undone');
  await page.getByRole('button', { name: 'Rétablir la modification' }).click();
  assert.equal(await page.locator('.class-pick').count(), 2);

  // A file that is not a backup is refused, nothing changes.
  const messages = [];
  page.on('dialog', (d) => messages.push(d.message()));
  const bad = path.join(dir, 'notes.json');
  fs.writeFileSync(bad, '{"hello": 1}');
  await page.getByLabel('Fichier de sauvegarde').setInputFiles(bad);
  for (let i = 0; i < 100 && !messages.length; i++) await new Promise((r) => setTimeout(r, 20)); // read asynchronously
  assert.deepEqual(messages, ['Cette sauvegarde est incomplète ou abîmée.']);
  assert.equal(await page.locator('.class-pick').count(), 2);

  // Printing shows the agenda alone.
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.agenda-side').isVisible(), false);
  assert.equal(await page.locator('.head-actions').isVisible(), false);
  assert.equal(await page.locator('.agenda-main').isVisible(), true);
  await shot('print.png');
  await page.emulateMedia({ media: 'screen' });
  fs.rmSync(dir, { recursive: true });
};
