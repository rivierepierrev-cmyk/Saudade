import assert from 'node:assert';
import { locatePassage, replacePassage, projectMarkdown } from '../src/lib/sourceSync';
import { buildTodayQueue } from '../src/lib/queue';

const md = `# Titre principal

La **lecture incrémentale** permet de lire des [centaines d'articles](https://x.org) sans se perdre.
Elle a été *inventée* par P. Woźniak.

- Premier point : la formule $E=mc^2$ reste.
- Second point ![image](/media/a.png) ici.

> Une citation importante.`;

assert.equal(projectMarkdown('**gras** et _ital_ snake_case').text, 'gras et ital snake_case');
// passage with markup inside, across a line break
let r = locatePassage(md, "lecture incrémentale permet de lire des centaines d'articles sans se perdre. Elle a été inventée");
assert.ok(r); assert.equal(md.slice(r!.start, r!.end), "lecture incrémentale** permet de lire des [centaines d'articles](https://x.org) sans se perdre.\nElle a été *inventée");
// formula, list item, quote
assert.equal(md.slice(...Object.values(locatePassage(md, 'la formule $E=mc^2$ reste')!) as [number, number]), 'la formule $E=mc^2$ reste');
assert.ok(locatePassage(md, 'Une citation importante.'));
assert.equal(locatePassage(md, 'absent du texte'), null);
// replace keeps the surrounding formatting
const out = replacePassage(md, 'sans se perdre', 'sans jamais se perdre')!;
assert.ok(out.source.includes('(https://x.org) sans jamais se perdre.'));
// only the changed words are replaced: bold and link inside the passage survive
const whole = "La lecture incrémentale permet de lire des centaines d'articles sans se perdre.";
const edited = replacePassage(md, whole, "La lecture incrémentale permet de lire des milliers d'articles sans se perdre.")!;
assert.ok(edited.source.includes("La **lecture incrémentale** permet de lire des [milliers d'articles](https://x.org) sans se perdre."), edited.source);
// insertion and deletion
assert.equal(replacePassage('Un **chat** noir.', 'Un chat noir.', 'Un chat très noir.')!.source, 'Un **chat** très noir.');
assert.equal(replacePassage('Un **chat** très noir.', 'Un chat très noir.', 'Un chat noir.')!.source, 'Un **chat** noir.');
assert.equal(replacePassage('Avant. Texte.', 'Texte.', 'Texte.')!.source, 'Avant. Texte.', 'unchanged');
// several occurrences: the hint picks the right one
const twice = 'Un mot. Puis encore Un mot. Fin.';
assert.equal(locatePassage(twice, 'Un mot', 15)!.start, 20);
// multi-line extract text becomes paragraphs
assert.equal(replacePassage('A.\n\nB.', 'A.\nB.', 'A2.\nB2.')!.source, 'A2.\n\nB2.');
// a new line break in the extract becomes a paragraph break in the document
assert.equal(replacePassage('Un deux trois.', 'Un deux trois.', 'Un deux.\nTrois.')!.source, 'Un deux.\n\nTrois.');

// queue: only what is due today, daily card limit, dismissed excluded
const day = 86400000; const now = new Date('2026-10-27T10:00:00');
const rec = (offsetDays: number) => ({ stability: 1, difficulty: 5, reps: 1, lapses: 0, interval: 1, nextReviewDate: new Date(now.getTime() + offsetDays * day).toISOString() });
const base = { title: 't', tags: [], createdAt: '', updatedAt: '' };
const docs: any[] = [{ ...base, id: 'd1', priority: 50, state: 'review', fsrs: rec(-1) }, { ...base, id: 'd2', priority: 90, state: 'review', fsrs: rec(3) }, { ...base, id: 'd3', priority: 99, state: 'dismissed', fsrs: rec(-1) }];
const exts: any[] = [{ ...base, id: 'e1', priority: 70, state: 'review', fsrs: rec(0) }];
const cards: any[] = [1, 2, 3].map((n) => ({ ...base, id: 'c' + n, priority: 60 + n, state: 'review', fsrs: rec(-n) }));
const q = buildTodayQueue({ documents: docs, extracts: exts, clozes: cards, dailyLimit: 2, reviewedTodayIds: new Set(['c1']), now });
assert.deepEqual(q.map((e) => e.item.id), ['e1', 'c3', 'c1', 'd1'], 'due only, by priority; limit 2 with c1 already reviewed today');
console.log('sync/queue tests OK');
