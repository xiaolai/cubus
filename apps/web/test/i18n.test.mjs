// The i18n groundwork (lib/i18n.js). The property the whole wiring rests on: with no catalog
// registered, t() is the identity — which is why threading it through the app changed nothing
// and why every other test in this suite can keep asserting English.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { t, registerLocale, setLocale, initLocale, availableLocales } from '../lib/i18n.js';

test('with no active locale, t() is the identity — parameters still substitute', () => {
  assert.equal(t('Solve this cube'), 'Solve this cube');
  assert.equal(t('Got the %1 side — %2/6', 'Front', 3), 'Got the Front side — 3/6');
});

test('a registered locale translates, falls back per-sentence, and can reorder parameters', () => {
  registerLocale('xx', {
    'Solve this cube': 'XX-solve',
    'Got the %1 side — %2/6': '%2/6 — XX side %1',
  });
  assert.ok(setLocale('xx'));
  assert.equal(t('Solve this cube'), 'XX-solve');
  assert.equal(t('Got the %1 side — %2/6', 'Front', 3), '3/6 — XX side Front');
  // A sentence the catalog lacks degrades to correct English, never to a bare id.
  assert.equal(t('Untranslated sentence'), 'Untranslated sentence');
  assert.deepEqual(availableLocales(), ['en', 'xx']);
});

test("setLocale('en') deactivates translation — English is source text, not a catalog", () => {
  assert.ok(setLocale('en'));
  assert.equal(t('Solve this cube'), 'Solve this cube');
  // An unknown tag also lands on English, but says so.
  assert.equal(setLocale('nope'), false);
  assert.equal(t('Solve this cube'), 'Solve this cube');
});

test('initLocale: explicit wins, region tags match their base, absence lands on English', () => {
  assert.equal(initLocale('xx'), 'xx');
  assert.equal(initLocale('xx-Latn-XX'), 'xx', 'loose match: region/script tags find the base');
  assert.equal(initLocale('fr'), 'en', 'no catalog, no pretending');
  assert.equal(t('Solve this cube'), 'Solve this cube');
});
