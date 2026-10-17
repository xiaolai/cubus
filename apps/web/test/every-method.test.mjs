// The "every method" a sweep walks is every method the registry offers — by relation, not by a list.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { METHODS } from '../lib/methods/registry.js';
import { methodOf } from '../lib/methods/method-of.js';
import { EVERY_METHOD, FAMILY_ENTRIES } from './fixtures/every-method.mjs';

test('every registry entry the method engine runs is in the sweep, by the method it builds', () => {
  const swept = new Set(EVERY_METHOD.map((m) => m.id));
  const entries = METHODS.filter((e) => e.engine === 'method');
  assert.ok(entries.length >= 4, `precondition: the registry offers ${entries.length} methods with stages`);
  for (const entry of entries) {
    assert.ok(swept.has(methodOf(entry).id), `${entry.id} builds ${methodOf(entry).id}, which no sweep walks`);
  }
  assert.ok(FAMILY_ENTRIES.some((e) => e.id === 'roux'), 'Roux is not among the families the sweep builds');
});
