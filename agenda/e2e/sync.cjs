const assert = require('node:assert/strict');
const { startWebdav } = require('./webdav-server.cjs');

/** Text with non-breaking spaces turned into plain ones. */
const norm = (t) => (t ?? '').replace(/ /g, ' ');

const FOLDER = 'http://127.0.0.1:4191/remote.php/dav/files/prof/Agenda-sync';
const PASS = 'mon agenda de prof';

const agenda = {
  classes: [{ id: '6B', name: '6e B', level: '6e', color: '#4f7cff' }],
  timetable: [{ id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '08:55' }],
  sequences: [{ id: 'frac', title: 'Fractions', level: '6e', color: '#2fa36b', seances: [{ id: 'f1', title: 'Découverte' }] }],
  placements: [{ id: 'p', sequenceId: 'frac', classId: '6B', start: '2025-09-01' }],
  calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] },
};

/**
 * Two devices (two separate browsers, real clocks: « most recent wins » needs them) and a WebDAV
 * server standing for Nextcloud.
 */
module.exports = async (_page, { shot, browser, url }) => {
  const server = await startWebdav(4191);
  const [ctxA, ctxB] = await Promise.all([browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 } }), browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 860 } })]);
  try {
    const pc = await ctxA.newPage();
    const phone = await ctxB.newPage();
    for (const p of [pc, phone]) p.on('dialog', (d) => d.accept());
    await pc.goto(url);
    await pc.evaluate((a) => localStorage.setItem('agenda.v1', JSON.stringify(a)), agenda);
    await pc.reload();
    await phone.goto(url);

    const open = async (p) => {
      await p.getByRole('button', { name: 'Synchro' }).click();
      return p.getByRole('dialog');
    };
    const fill = async (d, password = 'app-pass') => {
      await d.getByLabel('Adresse WebDAV du dossier').fill(FOLDER);
      await d.getByLabel('Identifiant').fill('prof');
      await d.getByLabel("Mot de passe d'application").fill(password);
    };

    // The computer starts the folder.
    assert.match(await pc.getByRole('button', { name: 'Synchro' }).getAttribute('class'), /off/);
    let d = await open(pc);
    await fill(d, 'wrong');
    await d.getByRole('button', { name: 'Vérifier le dossier' }).click();
    assert.equal(norm(await d.getByRole('alert').textContent()), 'Connexion impossible : identifiant ou mot de passe refusé');
    await d.getByLabel("Mot de passe d'application").fill('app-pass');
    await d.getByRole('button', { name: 'Vérifier le dossier' }).click();
    assert.match(norm(await d.locator('.sync-checked').textContent()), /^Nouveau dossier/);
    await d.getByLabel('Phrase de passe', { exact: true }).fill(PASS);
    await d.getByLabel('Phrase de passe (encore)').fill(`${PASS}!`);
    await d.getByRole('button', { name: 'Activer' }).click();
    assert.equal(norm(await d.getByRole('alert').textContent()), 'Les deux phrases de passe sont différentes.');
    await d.getByLabel('Phrase de passe (encore)').fill(PASS);
    await shot('sync-setup.png', pc);
    await d.getByRole('button', { name: 'Activer' }).click();
    await d.waitFor({ state: 'hidden' });
    assert.equal(await pc.locator('.toast').textContent(), 'Synchronisation activée');
    assert.match(await pc.getByRole('button', { name: 'Synchro' }).getAttribute('class'), /ok/);

    // In the folder: the header and one encrypted log, nothing readable.
    const names = [...server.files.keys()].map((p) => p.split('/').pop());
    assert.ok(names.includes('agenda-sync.json'));
    assert.equal(names.filter((n) => /^[0-9a-f]{16}\.log$/.test(n)).length, 1);
    const content = [...server.files.values()].map((b) => b.toString()).join('');
    assert.ok(!content.includes('Fractions') && !content.includes('6e B'));

    // The phone joins: wrong passphrase refused, then it takes the folder's agenda.
    d = await open(phone);
    await fill(d);
    await d.getByRole('button', { name: 'Vérifier le dossier' }).click();
    assert.match(norm(await d.locator('.sync-checked').textContent()), /^Dossier déjà utilisé par un autre appareil/);
    assert.equal(await d.getByLabel('Phrase de passe (encore)').count(), 0);
    await d.getByLabel('Phrase de passe', { exact: true }).fill('pas la bonne phrase');
    await d.getByRole('button', { name: 'Activer' }).click();
    assert.equal(norm(await d.getByRole('alert').textContent()), 'Phrase de passe incorrecte pour ce dossier.');
    await d.getByLabel('Phrase de passe', { exact: true }).fill(PASS);
    assert.equal(await d.getByLabel("Prendre l'agenda du dossier (celui de cet appareil est gardé en copie)").isChecked(), true);
    await d.getByRole('button', { name: 'Activer' }).click();
    await d.waitFor({ state: 'hidden' });
    await phone.getByRole('button', { name: 'Emploi du temps', exact: true }).click();
    assert.deepEqual(await phone.locator('.class-pick .class-name').allTextContents(), ['6e B']);
    assert.ok(await phone.evaluate(() => localStorage.getItem('agenda.beforeSync')), "the phone's own agenda is kept");

    // A séquence created on the phone reaches the computer.
    await phone.getByRole('button', { name: 'Séquences', exact: true }).click();
    await phone.getByLabel('Nouvelle séquence').fill('Pythagore');
    await phone.getByRole('button', { name: 'Créer' }).click();
    d = await open(pc);
    assert.equal(norm(await d.locator('.sync-status').textContent()), "Dossier127.0.0.1:4191 › Agenda-syncDernière synchronisationà l'instantAutres appareilsaucun pour l'instant");
    await d.getByRole('button', { name: 'Synchroniser maintenant' }).click();
    await d.getByRole('button', { name: 'Synchroniser maintenant' }).waitFor();
    assert.match(norm(await d.locator('.sync-status').textContent()), /Dernière synchronisationà l'instantAutres appareils1$/);
    await shot('sync-status.png', pc);
    await d.getByRole('button', { name: 'Fermer' }).click();
    await pc.getByRole('button', { name: 'Séquences', exact: true }).click();
    assert.deepEqual(await pc.locator('.seq-pick .seq-title').allTextContents(), ['Fractions', 'Pythagore']);

    // Holidays added on the computer reach the phone when it comes back to the front.
    await pc.getByRole('button', { name: 'Vacances' }).click();
    const h = pc.getByRole('dialog');
    await h.getByRole('button', { name: '+ Ajouter une ligne' }).click();
    await h.getByLabel('Nom').fill('Toussaint');
    await h.getByLabel('Date de début').fill('2025-10-18');
    await h.getByLabel('Date de fin').fill('2025-11-02');
    await h.getByRole('button', { name: 'Enregistrer' }).click();
    await h.waitFor({ state: 'hidden' });
    await phone.evaluate(() => window.dispatchEvent(new Event('focus')));
    await phone.getByRole('button', { name: 'Vacances (1)' }).waitFor({ timeout: 5000 });

    // Both changed at once, different things: both kept.
    await pc.getByRole('button', { name: 'Emploi du temps', exact: true }).click();
    await pc.getByLabel('Nouvelle classe').fill('4e A');
    await pc.getByLabel('Nouvelle classe').press('Enter');
    await phone.getByRole('button', { name: 'Séquences', exact: true }).click();
    await phone.locator('.seq-pick', { hasText: 'Fractions' }).click();
    await phone.getByLabel('Matière', { exact: true }).fill('Maths');
    for (const p of [pc, phone, pc]) await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await pc.getByRole('button', { name: 'Séquences', exact: true }).click();
    await pc.locator('.seq-pick', { hasText: 'Fractions' }).click();
    await pc.waitForFunction(() => document.querySelector('[aria-label="Matière"]')?.value === 'Maths', null, { timeout: 5000 });
    await phone.getByRole('button', { name: 'Emploi du temps', exact: true }).click();
    await phone.locator('.class-pick', { hasText: '4e A' }).waitFor({ timeout: 5000 });

    // Turning it off on the phone.
    d = await open(phone);
    await d.getByRole('button', { name: 'Désactiver' }).click();
    await d.waitFor({ state: 'hidden' });
    assert.match(await phone.getByRole('button', { name: 'Synchro' }).getAttribute('class'), /off/);
  } finally {
    await ctxA.close();
    await ctxB.close();
    server.close();
  }
};
