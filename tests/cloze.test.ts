import assert from 'node:assert';
import { buildCloze } from '../src/lib/cloze';
import { applyTopicReview, applyCardReview, createInitialFSRSRecord, firstTopicInterval } from '../src/lib/fsrs';

const ctx = "La mémoire dépend de l'hippocampe. Le cortex stocke les souvenirs à long terme. Fin.";
const sel = (s: string) => { const i = ctx.indexOf(s); return buildCloze(ctx, i, i + s.length); };

let r = sel('hippocampe');
assert.deepEqual(r, { ok: true, text: "La mémoire dépend de l'{{c1::hippocampe}}." });
r = sel(' cortex ');
assert.deepEqual(r, { ok: true, text: 'Le {{c1::cortex}} stocke les souvenirs à long terme.' });
r = sel('Le cortex stocke les souvenirs à long terme.');
assert.equal(r.ok, false, 'whole sentence refused');
r = sel("l'hippocampe. Le cortex"); // spans two sentences -> both kept as context
assert.deepEqual(r, { ok: true, text: "La mémoire dépend de {{c1::l'hippocampe. Le cortex}} stocke les souvenirs à long terme." });
const abbr = 'Selon M. Dupont, la mémoire est sélective. Autre phrase.';
const i = abbr.indexOf('sélective');
assert.deepEqual(buildCloze(abbr, i, i + 9), { ok: true, text: 'Selon M. Dupont, la mémoire est {{c1::sélective}}.' });
assert.equal(buildCloze('{{c1::x}} y z', 10, 11).ok, false);
// A heading (block end = line break, no final period) never joins the next sentence
const blocks = 'Règle 1 : Comprendre avant de mémoriser\nApprendre par cœur sans comprendre est inutile.';
const w = blocks.indexOf('cœur');
assert.deepEqual(buildCloze(blocks, w, w + 4), { ok: true, text: 'Apprendre par {{c1::cœur}} sans comprendre est inutile.' });

// Topics: interval grows, faster for low priority
const now = new Date('2026-10-25T10:00:00Z');
let rec = createInitialFSRSRecord(0);
assert.equal(firstTopicInterval(100), 1); assert.equal(firstTopicInterval(0), 7);
const hi: number[] = [], lo: number[] = [];
let a = rec, b = rec;
for (let k = 0; k < 5; k++) { a = applyTopicReview(a, 90, now); b = applyTopicReview(b, 20, now); hi.push(a.interval); lo.push(b.interval); }
assert.ok(hi.every((v, k) => k === 0 || v > hi[k - 1]), 'grows: ' + hi);
assert.ok(lo[4] > hi[4] * 3, `low priority drifts away: ${hi} vs ${lo}`);

// Cards: new card, Again -> minutes; Good from review -> days
let c = applyCardReview(createInitialFSRSRecord(0), 1, now, 0.9);
assert.equal(c.phase, 'learning'); assert.ok(c.interval < 0.01, 'again = minutes');
assert.equal(c.lapses, 0, 'first Again on a new card is not a lapse');
const legacy = { stability: 5, difficulty: 5, reps: 3, lapses: 0, interval: 5, lastReview: '2026-10-20T10:00:00Z', nextReviewDate: '2026-10-25T10:00:00Z' };
c = applyCardReview(legacy, 3, now, 0.9);
assert.equal(c.phase, 'review'); assert.ok(c.interval >= 10, 'good on legacy review card: ' + c.interval);
c = applyCardReview(legacy, 1, now, 0.9);
assert.equal(c.phase, 'relearning'); assert.equal(c.lapses, 1);
console.log('cloze/scheduling tests OK', hi, lo);
