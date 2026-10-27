const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createStore, withRetry } = require('../electron/store.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fol-'));
let s = createStore(dir);
let r = s.loadAll(); assert.equal(r.isNew, true); assert.deepEqual(r.files, {});
assert.equal(s.dailySnapshot(), null, 'no snapshot when empty');
s.write('documents', JSON.stringify([{id:'a'}]));
s.write('documents', JSON.stringify([{id:'a'},{id:'b'}]));
assert.ok(fs.existsSync(path.join(dir,'documents.json.bak')));
assert.throws(() => s.write('documents', '{bad'), 'rejects invalid JSON');
assert.throws(() => s.write('../evil', '[]'), 'rejects unknown names');
assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'documents.json'))).length, 2);
// corrupt main file -> restored from .bak, original quarantined
fs.writeFileSync(path.join(dir,'documents.json'), '{"truncated');
r = createStore(dir).loadAll();
assert.equal(JSON.parse(r.files.documents).length, 1, 'bak used');
assert.equal(r.isNew, false); assert.equal(r.warnings.length, 2);
assert.equal(fs.readdirSync(path.join(dir,'corrupt')).length, 1);
// daily snapshot once per day, contains folders key
const snap = s.dailySnapshot(); assert.ok(snap); assert.equal(s.dailySnapshot(), null);
const b = JSON.parse(fs.readFileSync(snap)); assert.equal(b.app,'saudade'); assert.ok(Array.isArray(b.folders));
for (let i=0;i<12;i++) s.eventSnapshot('test');
assert.equal(fs.readdirSync(s.backupDir).filter(f=>f.startsWith('event-')).length, 10);
// prune daily to 7
for (let d=1; d<=9; d++) fs.writeFileSync(path.join(s.backupDir,`daily-2020-01-0${d}.json`),'{}');
fs.unlinkSync(snap); s.dailySnapshot();
const daily = fs.readdirSync(s.backupDir).filter(f=>f.startsWith('daily-')).sort();
assert.equal(daily.length, 7); assert.ok(!daily.includes('daily-2020-01-01.json'));
// transient Windows-style lock errors are retried, others are not
let calls = 0;
assert.equal(withRetry(() => { if (++calls < 3) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return 'ok'; }), 'ok');
assert.equal(calls, 3);
assert.throws(() => withRetry(() => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; }), /nope/);
console.log('store tests OK');
