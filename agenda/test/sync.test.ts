import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, memoryRemote, memoryStore, HEADER, type Remote } from '../src/sync/engine.ts';
import { createSyncClient } from '../src/sync/client.ts';
import type { Agenda } from '../src/model.ts';

const where = { kind: 'memory', label: 'Dossier de test' };
const PASS = 'correct horse battery';

const base = (): Agenda => ({
  classes: [{ id: '6B', name: '6e B' }],
  timetable: [{ id: 'mon', classId: '6B', weekday: 1, start: '08:00', end: '08:55' }],
  sequences: [{ id: 'frac', title: 'Fractions', seances: [{ id: 'f1', title: 'Découverte', objectives: 'Comparer des fractions' }] }],
  placements: [{ id: 'p1', sequenceId: 'frac', classId: '6B', start: '2025-09-01' }],
  calendar: { start: '2025-09-01', end: '2026-07-03', closures: [] },
});
const blank = (): Agenda => ({ classes: [], timetable: [], sequences: [], placements: [], calendar: { start: '2024-09-01', end: '2025-07-04', closures: [] } });

/** A device: its store, its client, its agenda. */
function device(remote: Remote, agenda: Agenda, compactBytes?: number) {
  const store = memoryStore();
  const d = {
    store,
    agenda,
    client: createSyncClient(createEngine(store, () => remote), store, { compactBytes }),
    async change(f: (a: Agenda) => Agenda) {
      d.agenda = f(d.agenda);
      await d.client.recordLocal(d.agenda);
    },
    async sync() {
      const merged = await d.client.syncNow(() => d.agenda);
      if (merged) d.agenda = merged;
    },
  };
  return d;
}

test('a computer starts the folder, the phone joins and takes its agenda; changes go both ways', async () => {
  const remote = memoryRemote();
  const pc = device(remote, base());
  const r = await pc.client.start(pc.agenda, where, PASS);
  assert.deepEqual([r.ok, r.ok && r.joined], [true, false]);
  assert.ok(remote.files.has(HEADER));
  assert.deepEqual(await pc.client.inspect(where), { ok: true, used: true, others: 0 });

  const phone = device(remote, blank());
  const joined = await phone.client.start(phone.agenda, where, PASS, 'take');
  assert.ok(joined.ok && joined.joined);
  phone.agenda = joined.ok ? joined.agenda : phone.agenda;
  assert.deepEqual(phone.agenda, pc.agenda);
  assert.equal(phone.client.status().others, 1);

  await phone.change((a) => ({ ...a, done: [{ slotId: 'mon', date: '2025-09-01', seanceId: 'f1' }] }));
  await pc.change((a) => ({ ...a, classes: [...a.classes, { id: '4A', name: '4e A' }] }));
  await pc.sync();
  await phone.sync();
  assert.deepEqual(pc.agenda, phone.agenda);
  assert.equal(pc.agenda.done?.length, 1);
  assert.equal(phone.agenda.classes.length, 2);
  assert.ok(pc.client.status().lastSync);
  assert.equal(pc.client.status().pending, 0);
});

test('the folder is encrypted, and a wrong passphrase is refused', async () => {
  const remote = memoryRemote();
  const pc = device(remote, base());
  await pc.client.start(pc.agenda, where, PASS);
  const all = [...remote.files.values()].map((b) => new TextDecoder().decode(b)).join('\n');
  assert.ok(!all.includes('Fractions') && !all.includes('6e B'), 'nothing readable');
  const other = device(remote, blank());
  assert.deepEqual(await other.client.start(other.agenda, where, 'wrong passphrase'), { ok: false, error: 'Phrase de passe incorrecte pour ce dossier.' });
  assert.deepEqual(await other.client.start(other.agenda, where, 'short'), { ok: false, error: 'La phrase de passe doit faire au moins 8 caractères.' });
});

test('changes made while the folder is unreachable are sent later', async () => {
  const remote = memoryRemote();
  let down = false;
  const flaky: Remote = {
    list: () => (down ? Promise.reject(new Error('hors ligne')) : remote.list()),
    read: (n, f) => (down ? Promise.reject(new Error('hors ligne')) : remote.read(n, f)),
    write: (n, t) => (down ? Promise.reject(new Error('hors ligne')) : remote.write(n, t)),
    remove: (n) => remote.remove(n),
    create: () => remote.create(),
  };
  const pc = device(flaky, base());
  await pc.client.start(pc.agenda, where, PASS);
  const phone = device(remote, blank());
  const j = await phone.client.start(phone.agenda, where, PASS);
  if (j.ok) phone.agenda = j.agenda;

  down = true;
  await pc.change((a) => ({ ...a, sequences: a.sequences.map((s) => ({ ...s, title: 'Les fractions' })) }));
  assert.equal(pc.client.status().pending, 1);
  assert.match(pc.client.status().error ?? '', /inaccessible : hors ligne/);
  await pc.sync();
  down = false;
  await pc.sync();
  assert.equal(pc.client.status().pending, 0);
  await phone.sync();
  assert.equal(phone.agenda.sequences[0].title, 'Les fractions');
});

test('a big log is compacted; the other device still reads everything', async () => {
  const remote = memoryRemote();
  const pc = device(remote, base(), 3000);
  await pc.client.start(pc.agenda, where, PASS);
  const phone = device(remote, blank());
  const j = await phone.client.start(phone.agenda, where, PASS);
  if (j.ok) phone.agenda = j.agenda;
  for (let i = 0; i < 12; i++) await pc.change((a) => ({ ...a, classes: a.classes.map((c) => ({ ...c, name: `6e B v${i}` })) }));
  await pc.sync();
  const logs = [...remote.files.keys()].filter((n) => n.endsWith('.log'));
  assert.ok(logs.some((n) => /-g1\.log$/.test(n)), `compacted: ${logs}`);
  assert.equal(logs.filter((n) => n.startsWith(pc.client.status().deviceId)).length, 1, 'the old log is removed');
  await phone.sync();
  assert.equal(phone.agenda.classes[0].name, '6e B v11');
});

test('joining with « merge » keeps both agendas', async () => {
  const remote = memoryRemote();
  const pc = device(remote, base());
  await pc.client.start(pc.agenda, where, PASS);
  const own: Agenda = { ...blank(), classes: [{ id: '2nde', name: '2nde 3' }] };
  const phone = device(remote, own);
  const j = await phone.client.start(phone.agenda, where, PASS, 'merge');
  assert.ok(j.ok);
  phone.agenda = j.ok ? j.agenda : phone.agenda;
  assert.deepEqual(phone.agenda.classes.map((c) => c.id).sort(), ['2nde', '6B']);
  await pc.sync();
  assert.deepEqual(pc.agenda.classes.map((c) => c.id).sort(), ['2nde', '6B']);
});

test('turning synchronisation off forgets the folder', async () => {
  const remote = memoryRemote();
  const pc = device(remote, base());
  await pc.client.start(pc.agenda, where, PASS);
  await pc.client.stop();
  assert.equal(pc.client.status().enabled, false);
  assert.equal(pc.store.data.has('sync:meta'), false);
  await pc.change((a) => ({ ...a, classes: [] }));
  assert.equal(await pc.client.syncNow(() => pc.agenda), undefined);
});
