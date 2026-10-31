import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_MS, LIMIT, record, redo, startHistory, undo } from '../src/history.ts';

test('undo and redo', () => {
  let h = startHistory('a');
  h = record(h, 'b', 1000);
  h = record(h, 'c', 5000);
  assert.equal(record(h, h.present, 6000), h, 'same value: nothing recorded');
  h = undo(h);
  assert.equal(h.present, 'b');
  h = undo(h);
  assert.equal(h.present, 'a');
  assert.equal(undo(h), h, 'nothing left to undo');
  h = redo(h);
  assert.equal(h.present, 'b');
  h = record(h, 'x', 9000);
  assert.deepEqual([h.past, h.present, h.future], [['a', 'b'], 'x', []], 'a new change drops what could be redone');
  assert.equal(redo(h), h);
});

test('keystrokes in the same field close together are one step', () => {
  let h = startHistory('');
  h = record(h, 'P', 1000, 'title');
  h = record(h, 'Py', 1300, 'title');
  h = record(h, 'Pyt', 1600, 'title');
  assert.deepEqual(h.past, ['']);
  h = record(h, 'Pyth', 1600 + GROUP_MS + 1, 'title');
  assert.deepEqual(h.past, ['', 'Pyt'], 'a pause starts a new step');
  h = record(h, 'Pytha', 3200, 'subject');
  assert.deepEqual(h.past, ['', 'Pyt', 'Pyth'], 'another field starts a new step');
  h = record(h, 'Pythag', 3300);
  assert.equal(h.past.length, 4, 'no field: always a step');
  assert.equal(undo(undo(h)).present, 'Pyth');
});

test('history is limited', () => {
  let h = startHistory(0);
  for (let i = 1; i <= LIMIT + 20; i++) h = record(h, i, i * 10_000);
  assert.equal(h.past.length, LIMIT);
  assert.equal(h.past[0], 20);
});
