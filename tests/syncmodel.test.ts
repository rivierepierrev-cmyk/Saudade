// Two simulated computers exchanging events (src/lib/sync/model.ts).
import assert from 'assert';
import {
  Library, LibraryKey, SyncEvent, SyncMeta, emptyMeta, diffCollection, eventsFromChanges, noteLocal, snapshotEvents, applyRemote,
} from '../src/lib/sync/model';
import { applyCardReview, createInitialFSRSRecord } from '../src/lib/fsrs';
import { ClozeItem, DocumentItem, ExtractItem, ReviewLog, ReviewRating } from '../src/types/saudade';

const T0 = Date.parse('2026-03-01T08:00:00Z');
const at = (h: number) => new Date(T0 + h * 3600_000);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

class Device {
  lib: Library;
  meta: SyncMeta = emptyMeta();
  out: SyncEvent[] = [];
  constructor(public name: string, lib: Library) {
    this.lib = clone(lib);
  }
  /** One user action: like storage.save of each collection, then the batch. */
  act(now: Date, change: (lib: Library) => void) {
    const before = clone(this.lib);
    change(this.lib);
    const changes = (Object.keys(before) as LibraryKey[]).flatMap((k) => diffCollection(k, before[k], this.lib[k]));
    const events = eventsFromChanges(changes, now, this.name, this.meta);
    noteLocal(this.meta, events);
    this.out.push(...events);
  }
  start(now: Date) {
    const events = snapshotEvents(this.lib, now, this.name, this.meta);
    noteLocal(this.meta, events);
    this.out.push(...events);
  }
  receive(events: SyncEvent[]) {
    this.lib = applyRemote(this.lib, this.meta, events, 0.9).lib;
  }
  review(id: string, rating: ReviewRating, now: Date) {
    this.act(now, (lib) => {
      const card = lib.clozes.find((c) => c.id === id)!;
      const fsrs = applyCardReview(card.fsrs, rating, now, 0.9);
      card.fsrs = fsrs;
      card.state = fsrs.phase === 'review' ? 'review' : 'learning';
      lib.reviewLogs.push({ id: `log-${this.name}-${now.getTime()}`, itemId: id, itemType: 'cloze', rating, scheduledInterval: fsrs.interval, actualInterval: 0, reviewDate: now.toISOString(), state: card.state, retention: 0.9 });
    });
  }
}
const exchange = (a: Device, b: Device) => {
  const fromA = a.out.splice(0), fromB = b.out.splice(0);
  b.receive(fromA);
  a.receive(fromB);
};
const norm = (lib: Library) => ({
  documents: [...lib.documents].sort((x, y) => x.id.localeCompare(y.id)),
  extracts: [...lib.extracts].sort((x, y) => x.id.localeCompare(y.id)),
  clozes: [...lib.clozes].sort((x, y) => x.id.localeCompare(y.id)),
  reviewLogs: [...lib.reviewLogs].sort((x, y) => x.id.localeCompare(y.id)),
  folders: lib.folders,
  settings: lib.settings,
});

const base = { tags: [], createdAt: '', updatedAt: '', state: 'new' as const };
const doc: DocumentItem = { ...base, id: 'd1', title: 'Doc', content: '# Texte', format: 'note', priority: 50, readingProgress: 0, lastReadOffset: 0, folder: 'Général', fsrs: createInitialFSRSRecord(0) };
const ext: ExtractItem = { ...base, id: 'e1', documentId: 'd1', documentTitle: 'Doc', text: 'Un passage', priority: 50, fsrs: createInitialFSRSRecord(0) };
const card = (id: string): ClozeItem => ({ ...base, id, documentId: 'd1', text: `Le {{c1::${id}}}`, priority: 50, fsrs: { ...createInitialFSRSRecord(0), nextReviewDate: at(0).toISOString() } });
const oldLog: ReviewLog = { id: 'old', itemId: 'c1', itemType: 'cloze', rating: 3, scheduledInterval: 1, actualInterval: 0, reviewDate: '2025-12-01T00:00:00.000Z', state: 'review' };
const initial: Library = { documents: [doc], extracts: [ext], clozes: [card('c1'), card('c2')], reviewLogs: [oldLog], folders: ['Général'], settings: { dailyReviewLimit: 50, targetRetention: 0.9, theme: 'system' } };

// 1. A starts syncing; B joins with an empty library ("replace") and gets everything
const A = new Device('aaaa', initial);
const B = new Device('bbbb', { documents: [], extracts: [], clozes: [], reviewLogs: [], folders: [], settings: { dailyReviewLimit: 20, targetRetention: 0.85, theme: 'dark' } });
A.start(at(0));
exchange(A, B);
assert.deepEqual(norm(B.lib), norm(A.lib), 'B has A’s library');
assert.equal(B.lib.reviewLogs.length, 1, 'history comes along, not replayed');
assert.deepEqual(B.lib.clozes.find((c) => c.id === 'c1')!.fsrs, A.lib.clozes.find((c) => c.id === 'c1')!.fsrs);

// 2. Reviews of different cards on each computer: both kept
A.review('c1', 3, at(1));
B.review('c2', 1, at(1.5));
exchange(A, B);
assert.deepEqual(norm(B.lib), norm(A.lib), 'same library after reviews of different cards');
assert.equal(A.lib.clozes.find((c) => c.id === 'c2')!.fsrs.reps, 1);

// 3. The same card reviewed on both before syncing: both reviews count, same schedule
A.review('c1', 3, at(30));
B.review('c1', 4, at(31));
exchange(A, B);
assert.deepEqual(norm(B.lib), norm(A.lib), 'same schedule after concurrent reviews');
assert.equal(A.lib.clozes.find((c) => c.id === 'c1')!.fsrs.reps, 3, 'three reviews of c1 in all');
let expected = initial.clozes[0].fsrs;
for (const [r, h] of [[3, 1], [3, 30], [4, 31]] as const) expected = applyCardReview(expected, r, at(h), 0.9);
assert.deepEqual(A.lib.clozes.find((c) => c.id === 'c1')!.fsrs, expected, 'replayed in time order');

// 4. Field by field: text on A, priority on B, both kept; same field: the latest wins
A.act(at(40), (lib) => { lib.extracts[0].text = 'Un passage corrigé'; });
B.act(at(41), (lib) => { lib.extracts[0].priority = 90; });
exchange(A, B);
assert.equal(A.lib.extracts[0].text, 'Un passage corrigé'); assert.equal(A.lib.extracts[0].priority, 90);
assert.deepEqual(norm(B.lib), norm(A.lib));
B.act(at(50), (lib) => { lib.documents[0].title = 'Titre B'; });
A.act(at(51), (lib) => { lib.documents[0].title = 'Titre A'; });
exchange(A, B);
assert.equal(B.lib.documents[0].title, 'Titre A', 'latest change wins');
assert.deepEqual(norm(B.lib), norm(A.lib));

// 5. Reading position and a text edit travel without touching other fields
A.act(at(52), (lib) => { lib.documents[0].lastReadOffset = 1200; });
exchange(A, B);
assert.equal(B.lib.documents[0].lastReadOffset, 1200); assert.equal(B.lib.documents[0].content, '# Texte');

// 6. Deleted on A after an edit on B: deleted everywhere, and never comes back
B.act(at(60), (lib) => { lib.extracts[0].priority = 10; });
A.act(at(61), (lib) => { lib.extracts = []; });
exchange(A, B);
assert.equal(A.lib.extracts.length, 0); assert.equal(B.lib.extracts.length, 0);
A.receive([{ c: '2026-03-03T00:00:00.000Z|bbbb|0000000001', t: 'put', coll: 'extracts', id: 'e1', f: { text: 'vieux', priority: 1 } }]);
assert.equal(A.lib.extracts.length, 0, 'an older change does not bring it back');
// …nor does an edit made after the deletion on the other computer: deletion is final
B.act(at(70), (lib) => { lib.clozes.find((c) => c.id === 'c2')!.priority = 77; });
A.act(at(69), (lib) => { lib.clozes = lib.clozes.filter((c) => c.id !== 'c2'); });
exchange(A, B);
assert.ok(!B.lib.clozes.some((c) => c.id === 'c2') && !A.lib.clozes.some((c) => c.id === 'c2'), 'c2 deleted on both');
assert.deepEqual(norm(B.lib), norm(A.lib));

// 7. Reset on A: wins over B's older review, B's later review counts on top
B.review('c1', 1, at(80));
A.act(at(81), (lib) => {
  const c = lib.clozes.find((x) => x.id === 'c1')!;
  c.fsrs = createInitialFSRSRecord(0); c.state = 'new';
  lib.reviewLogs = lib.reviewLogs.filter((l) => l.itemId !== 'c1');
});
exchange(A, B);
assert.equal(B.lib.clozes.find((c) => c.id === 'c1')!.fsrs.reps, 0, 'reset reaches B');
assert.equal(B.lib.reviewLogs.filter((l) => l.itemId === 'c1').length, 1, 'only B’s review from before the reset… still listed');
B.review('c1', 3, at(82));
exchange(A, B);
assert.equal(A.lib.clozes.find((c) => c.id === 'c1')!.fsrs.reps, 1, 'review after the reset counts');

// 8. Undoing a review on A: the card is back as before on B
const beforeReview = clone(A.lib.clozes.find((c) => c.id === 'c1')!);
A.review('c1', 2, at(90));
exchange(A, B);
A.act(at(90.1), (lib) => {
  lib.clozes = lib.clozes.map((c) => (c.id === 'c1' ? clone(beforeReview) : c));
  lib.reviewLogs = lib.reviewLogs.filter((l) => l.id !== `log-aaaa-${at(90).getTime()}`);
});
exchange(A, B);
assert.deepEqual(B.lib.clozes.find((c) => c.id === 'c1')!.fsrs, beforeReview.fsrs, 'undone review undone on B');

// 8b. Restoring a backup on A brings back an item deleted earlier, on B too
const restored = clone(initial.extracts[0]);
A.act(at(95), (lib) => { lib.extracts = [restored]; });
exchange(A, B);
assert.equal(B.lib.extracts.length, 1, 'restored on B'); assert.deepEqual(norm(B.lib), norm(A.lib));
B.act(at(96), (lib) => { lib.extracts = []; });
exchange(A, B);
assert.equal(A.lib.extracts.length, 0, 'and deleted again');

// 9. New items and folders
A.act(at(100), (lib) => { lib.clozes.unshift(card('c3')); lib.folders = ['Général', 'Livres']; });
exchange(A, B);
assert.equal(B.lib.clozes[0].id, 'c3', 'new card listed first'); assert.deepEqual(B.lib.folders, ['Général', 'Livres']);
assert.deepEqual(norm(B.lib), norm(A.lib), 'still the same library');

// 9b. Settings: field by field, the latest wins
assert.deepEqual(B.lib.settings, initial.settings, 'B took A’s settings when joining');
A.act(at(101), (lib) => { lib.settings = { ...lib.settings, dailyReviewLimit: 30 }; });
B.act(at(102), (lib) => { lib.settings = { ...lib.settings, theme: 'dark' }; });
B.act(at(103), (lib) => { lib.settings = { ...lib.settings, dailyReviewLimit: 40 }; });
exchange(A, B);
assert.deepEqual(A.lib.settings, { dailyReviewLimit: 40, targetRetention: 0.9, theme: 'dark' });
assert.deepEqual(B.lib.settings, A.lib.settings);

// 9c. A question/answer card travels with its answer
A.act(at(104), (lib) => { lib.clozes.unshift({ ...card('q1'), kind: 'qa', text: 'Que produit la mitochondrie ?', answer: "L'ATP" }); });
exchange(A, B);
const q1 = B.lib.clozes.find((c) => c.id === 'q1')!;
assert.equal(q1.kind, 'qa'); assert.equal(q1.answer, "L'ATP");
B.review('q1', 3, at(105));
exchange(A, B);
assert.equal(A.lib.clozes.find((c) => c.id === 'q1')!.fsrs.reps, 1, 'its review reaches A');

// 10. Applying the same events twice changes nothing
const replayAll = [...A.out];
A.act(at(110), (lib) => { lib.documents[0].priority = 61; });
const batch = A.out.splice(0);
B.receive(batch);
const once = clone(B.lib);
B.receive(batch);
assert.deepEqual(clone(B.lib), once, 'idempotent');
void replayAll;

console.log('sync model tests OK');
