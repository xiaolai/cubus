// The Restore row is the CHOSEN method's stops (owner's call Q8, ADR 0011 Phase 7): one function turns an
// entry's stop ids into target descriptors, and every row — the cube screen's and the scan's — reads it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stopTargets } from '../lib/method-stops.js';
import { METHODS } from '../lib/methods/registry.js';
import { NESTING, OFFERED_TARGETS, TARGET_BY_ID } from '../lib/stage-targets.js';

test('every method\'s row is real target descriptors, in the entry\'s order, each one offered', () => {
  for (const m of METHODS) {
    const row = stopTargets(m.id);
    assert.ok(row.length > 0, `${m.id} has an empty row`);
    for (const tg of row) {
      assert.equal(tg, TARGET_BY_ID[tg.id], `${m.id}: ${tg.id} is not the table's own descriptor`);
      assert.ok(OFFERED_TARGETS.includes(tg), `${m.id}: ${tg.id} is a stop the worker does not bound`);
      assert.equal(typeof tg.verify, 'function');
    }
    if (m.stops.length) assert.deepEqual(row.map((tg) => tg.id), [...m.stops]);
  }
});

test('Beginner\'s row is the nesting, and Quick — which stops nowhere of its own — shows the same row', () => {
  assert.deepEqual(stopTargets('beginner').map((tg) => tg.id), NESTING);
  assert.deepEqual(stopTargets('quick').map((tg) => tg.id), NESTING);
});

test('no row offers a chip outside its method — `top-oriented` is never on the beginner\'s row', () => {
  assert.equal(stopTargets('beginner').some((tg) => tg.id === 'top-oriented'), false);
  assert.equal(stopTargets('quick').some((tg) => tg.id === 'top-oriented'), false);
});

test('an unknown method is refused, never answered with some other row', () => {
  assert.throws(() => stopTargets('nope'), /no method named/);
  assert.throws(() => stopTargets('toString'), /no method named/);
});
