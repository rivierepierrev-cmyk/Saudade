const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createStore, withRetry } = require('../electron/store.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fol-'));
let s = createStore(dir);
let r = s.loadAll(); assert.equal(r.isNew, true); assert.deepEqual(r.files, {});
assert.equal(s.dailySnapshot(), null, 'no snapshot when empty');
s.write('documents', JSON.stringify([{id:'a', content:'A'}]));
s.write('documents', JSON.stringify([{id:'a', content:'A'},{id:'b', content:'B'}]));
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
// documents: texts in contents/<id>.md, the list without them in documents.json
{
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fol-docs-'));
  // an older documents.json (texts inside) is moved to the new layout on load
  fs.writeFileSync(path.join(d2, 'documents.json'), JSON.stringify([{ id: 'x', title: 'X', content: '# Texte X' }, { id: 'y/../z', title: 'Y', content: 'Y' }]));
  const st = createStore(d2);
  let docs = JSON.parse(st.loadAll().files.documents);
  assert.deepEqual(docs.map((d) => d.content), ['# Texte X', 'Y']);
  const listed = JSON.parse(fs.readFileSync(path.join(d2, 'documents.json'), 'utf8'));
  assert.ok(listed.every((d) => !('content' in d)), 'no text left in documents.json');
  assert.equal(fs.readFileSync(path.join(d2, 'contents', 'x.md'), 'utf8'), '# Texte X');
  const files = fs.readdirSync(path.join(d2, 'contents')).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, 2); assert.ok(files.some((f) => /^h-[0-9a-f]{32}\.md$/.test(f)), 'odd ids hashed, never a path');
  // saving the position only rewrites the list; a changed text only its own file
  const xFile = path.join(d2, 'contents', 'x.md'); const before = fs.statSync(xFile).mtimeMs;
  st.writeDocuments(JSON.stringify([{ id: 'x', title: 'X', lastReadOffset: 300 }, { id: 'y/../z', title: 'Y' }]), []);
  assert.equal(fs.statSync(xFile).mtimeMs, before);
  st.writeDocuments(JSON.stringify([{ id: 'x', title: 'X' }]), [['x', 'nouveau']]);
  const mdCount = () => fs.readdirSync(path.join(d2, 'contents')).filter((f) => f.endsWith('.md')).length;
  docs = JSON.parse(createStore(d2).loadAll().files.documents);
  assert.deepEqual(docs, [{ id: 'x', title: 'X', content: 'nouveau' }]);
  assert.equal(mdCount(), 2, 'removed text kept while documents.json.bak lists it');
  // .bak restored after a crash: the removed document comes back with its text
  fs.writeFileSync(path.join(d2, 'documents.json'), '{"cut');
  docs = JSON.parse(createStore(d2).loadAll().files.documents);
  assert.deepEqual(docs.map((d) => [d.id, d.content]), [['x', 'nouveau'], ['y/../z', 'Y']]);
  st.writeDocuments(JSON.stringify([{ id: 'x', title: 'X' }]), []);
  st.writeDocuments(JSON.stringify([{ id: 'x', title: 'X' }]), []);
  createStore(d2).loadAll();
  assert.equal(mdCount(), 1, 'orphan text deleted once no list mentions it');
  // backups carry the texts
  const back = JSON.parse(fs.readFileSync(st.eventSnapshot('t'), 'utf8'));
  assert.equal(back.documents[0].content, 'nouveau');
  // a missing text is reported, not invented
  fs.unlinkSync(xFile); fs.unlinkSync(xFile + '.bak');
  const r2 = createStore(d2).loadAll();
  assert.equal(JSON.parse(r2.files.documents)[0].content, '');
  assert.ok(r2.warnings.some((w) => w.includes('« X »')));
  assert.throws(() => st.writeDocuments('[]', [['x', 3]]), /invalide/);
}
console.log('store tests OK');
