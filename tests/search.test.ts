import assert from 'node:assert';
import { matchesQuery, normalizeForSearch } from '../src/lib/search';

assert.equal(normalizeForSearch('Répétition ÉLÈVE çà'), 'repetition eleve ca');
assert.ok(matchesQuery('repetition', ['La Répétition espacée']));
assert.ok(matchesQuery('ESPACÉE répét', ['La répétition espacée']), 'all words, any order');
assert.ok(matchesQuery('hippocampe memoire', ['Titre : hippocampe', 'Texte sur la mémoire']), 'words across fields');
assert.ok(!matchesQuery('hippocampe cortex', ['hippocampe seulement']), 'every word required');
assert.ok(matchesQuery('   ', ['x']), 'empty query matches');
assert.ok(matchesQuery('abc', [undefined, null, 'xabcx']));
console.log('search tests OK');
