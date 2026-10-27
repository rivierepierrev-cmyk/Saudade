import assert from 'node:assert';
import { splitMath, parseClozes, renderClozeCard, renderTextWithMath } from '../src/lib/math';

const kinds = (t: string) => splitMath(t).map((s) => (s.type === 'math' ? `[${s.display ? 'D' : 'I'}:${s.tex}]` : s.value)).join('');
assert.equal(kinds('Soit $x^2$ et $$\\int_0^1 f$$.'), 'Soit [I:x^2] et [D:\\int_0^1 f].');
assert.equal(kinds('Prix : 5 $ et 10 $.'), 'Prix : 5 $ et 10 $.', 'prices are not formulas');
assert.equal(kinds('entre $5 et $10'), 'entre $5 et $10', 'closing $ followed by digit');
assert.equal(kinds('\\(a\\) puis \\[b\\]'), '[I:a] puis [D:b]');
assert.equal(kinds('un \\$ seul'), 'un $ seul');
assert.equal(kinds('$a$\n\n$b'), '[I:a]\n\n$b', 'unclosed $ stays text');

assert.deepEqual(parseClozes('A {{c1::$\\frac{1}{x^{2}}$}} B'), [
  { type: 'text', value: 'A ' }, { type: 'cloze', value: '$\\frac{1}{x^{2}}$' }, { type: 'text', value: ' B' }]);
assert.deepEqual(parseClozes('{{c2::Paris::capitale}}'), [{ type: 'cloze', value: 'Paris', hint: 'capitale' }]);
assert.deepEqual(parseClozes('cassé {{c1::x'), [{ type: 'text', value: 'cassé {{c1::x' }]);

// whole formula hidden
let h = renderClozeCard("L'énergie vaut {{c1::$E=mc^2$}}.", false);
assert.ok(h.includes('cloze-blank') && !h.includes('katex'), h);
h = renderClozeCard("L'énergie vaut {{c1::$E=mc^2$}}.", true);
assert.ok(h.includes('cloze-answer') && h.includes('katex'));
// part of a formula hidden
h = renderClozeCard('Relation : $E={{c1::mc^2}}$', false);
assert.ok(h.includes('katex') && h.includes('boxed') && !h.includes('mc^2'), 'answer not leaked');
assert.ok(!/<mi>m<\/mi>/.test(h));
h = renderClozeCard('Relation : $E={{c1::mc^2}}$', true);
assert.ok(h.includes('cloze-answer') && /<mi>m<\/mi>/.test(h));
// no HTML injection through text
assert.ok(!renderTextWithMath('<img src=x onerror=alert(1)>').includes('<img'));
assert.ok(renderClozeCard('{{c1::<b>x</b>}}', true).includes('&lt;b&gt;'));
console.log('math tests OK');
