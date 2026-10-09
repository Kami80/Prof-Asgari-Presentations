import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotebook, storageKey, findStrokeAt } from '../assets/annotations.js';

test('annotation storage separates different PDFs and replacements of the same PDF', () => {
  assert.notEqual(storageKey({ id: 'first', revision: 'a' }), storageKey({ id: 'second', revision: 'a' }));
  assert.notEqual(storageKey({ id: 'first', revision: 'a' }), storageKey({ id: 'first', revision: 'b' }));
});

test('restores valid slide notes and skips invalid coordinates or nonexistent slides', () => {
  const valid = { type: 'pen', color: '#3267df', width: .004, points: [[.2, .3], [.4, .5]] };
  const restored = parseNotebook(JSON.stringify({ version: 1, lastPage: 12, pages: {
    1: { notes: 'A thought in فارسی', strokes: [valid, { ...valid, points: [[Infinity, 4]] }, { ...valid, color: 'invalid' }] },
    99: { notes: 'Wrong slide', strokes: [] }
  } }), 3);
  assert.equal(restored.lastPage, 3);
  assert.equal(restored.pages[1].notes, 'A thought in فارسی');
  assert.deepEqual(restored.pages[1].strokes, [valid]);
  assert.equal(restored.pages[99], undefined);
  assert.throws(() => parseNotebook('{broken', 3));
});

test('eraser uses pixel distance on rectangular slides and selects the top mark', () => {
  const strokes = [
    { type: 'pen', color: '#3267df', width: .004, points: [[.1, .5], [.9, .5]] },
    { type: 'highlight', color: '#f6ce45', width: .004, points: [[.4, .3], [.6, .7]] }
  ];
  assert.equal(findStrokeAt(strokes, [.5, .5], 1000, 500), 1);
  assert.equal(findStrokeAt(strokes, [.2, .52], 1000, 500), 0);
  assert.equal(findStrokeAt(strokes, [.2, .6], 1000, 500), -1);
});
