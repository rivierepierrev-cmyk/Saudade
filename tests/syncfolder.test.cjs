// Shared-folder transport (electron/sync.cjs): two computers, one folder.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createSync } = require('../electron/sync.cjs');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const plain = { protect: (b) => b.toString('hex'), unprotect: (s) => Buffer.from(s, 'hex') };
const shared = tmp('sync-shared-');
const dataA = tmp('sync-a-'); const dataB = tmp('sync-b-');
const A = createSync(dataA, plain); const B = createSync(dataB, plain);
assert.notEqual(A.status().deviceId, B.status().deviceId);

// Turning it on: A creates the folder's header, B joins with the same passphrase only
assert.equal(A.enable(shared, 'court').ok, false, 'passphrase too short');
assert.deepEqual(A.inspect(shared), { ok: true, used: false, others: 0 });
assert.deepEqual(A.enable(shared, 'phrase de passe A'), { ok: true, joined: false });
assert.equal(B.enable(shared, 'mauvaise phrase').error, 'Phrase de passe incorrecte pour ce dossier.');
assert.equal(B.status().enabled, false);
A.append([{ c: '1', t: 'folders', list: ['Général'] }]);
assert.deepEqual(B.inspect(shared), { ok: true, used: true, others: 1 });
assert.deepEqual(B.enable(shared, 'phrase de passe A'), { ok: true, joined: true });

// Events go through encrypted, and are read once
A.append([{ c: '2', t: 'del', coll: 'extracts', id: 'e1' }]);
const logA = fs.readFileSync(path.join(shared, `${A.status().deviceId}.log`), 'utf8');
assert.ok(!logA.includes('extracts') && !logA.includes('Général'), 'nothing readable in the folder');
let r = B.pull();
assert.deepEqual(r.events.map((e) => e.c), ['1', '2']);
assert.deepEqual(B.pull().events.map((e) => e.c), ['1', '2'], 'read again until acknowledged');
B.ack(r.token);
assert.deepEqual(B.pull().events, [], 'nothing new');
assert.ok(B.status().lastSync);

// A line being written (no end of line yet) waits for the next time
fs.appendFileSync(path.join(shared, `${A.status().deviceId}.log`), 'ZZZ-incomplet');
assert.deepEqual(B.pull().events, []);
A.append([{ c: '3', t: 'unlog', id: 'l1' }]); // A starts on a new line after the broken one
r = B.pull(); B.ack(r.token);
assert.deepEqual(r.events.map((e) => e.c), ['3']);
assert.match(B.status().error, /1 ligne\(s\) illisible/);

// Folder unreachable: events wait in the outbox, then go when it is back
const moved = shared + '-ailleurs';
fs.renameSync(shared, moved);
A.append([{ c: '4', t: 'unlog', id: 'l2' }]);
assert.equal(A.status().pending, 1); assert.match(A.status().error, /inaccessible/);
fs.renameSync(moved, shared);
A.pull();
assert.equal(A.status().pending, 0); assert.equal(A.status().error, null);
r = B.pull(); B.ack(r.token);
assert.deepEqual(r.events.map((e) => e.c), ['4']);

// Images: sent encrypted, fetched by the other computer
fs.mkdirSync(path.join(dataA, 'media'), { recursive: true });
const img = 'a'.repeat(32) + '.png';
fs.writeFileSync(path.join(dataA, 'media', img), Buffer.from([1, 2, 3, 4]));
A.pull(); B.pull();
assert.deepEqual([...fs.readFileSync(path.join(dataB, 'media', img))], [1, 2, 3, 4]);
assert.ok(fs.existsSync(path.join(shared, 'media', img + '.enc')));

// Key kept across restarts; turning it off forgets the folder and the key
const A2 = createSync(dataA, plain);
assert.equal(A2.status().enabled, true); assert.equal(A2.status().deviceId, A.status().deviceId);
A2.writeMeta('{"seq":3}'); assert.equal(A2.readMeta(), '{"seq":3}');
A2.disable();
assert.equal(createSync(dataA, plain).status().enabled, false);
assert.equal(A2.readMeta(), '');
console.log('sync folder tests OK');
