// The i18n groundwork (lib/i18n.js). The property the whole wiring rests on: with no catalog
// registered, t() is the identity — which is why threading it through the app changed nothing
// and why every other test in this suite can keep asserting English.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { t, registerLocale, setLocale, initLocale, availableLocales, plural, locale } from '../lib/i18n.js';

// `<html lang>` is what a screen reader picks its voice and pronunciation rules from, what a
// browser offers to translate against, and what CSS `:lang()` and hyphenation read. A page that
// says `lang="en"` while speaking Chinese is lying in the one place assistive software looks.
// i18n.js is used from plain Node too, so it writes only when there is a document — this test
// supplies one.
const documentStub = { documentElement: { lang: 'en' } };
globalThis.document = documentStub;

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

test('setLocale moves the document\'s own language with the catalog', () => {
  registerLocale('zz', { 'Solve this cube': 'ZZ-solve' });
  setLocale('zz');
  assert.equal(documentStub.documentElement.lang, 'zz', 'the page must declare the language it is speaking');
  setLocale('en');
  assert.equal(documentStub.documentElement.lang, 'en', 'and go back when translation is off');
  // An unregistered tag deactivates translation, so the page is speaking English again — saying
  // otherwise would be worse than saying nothing.
  setLocale('nope');
  assert.equal(documentStub.documentElement.lang, 'en');
});

test('plurals are the language\'s business, not an n === 1 at the call site', () => {
  setLocale('en');
  assert.equal(locale(), 'en');
  const forms = { one: '%1 move from solved', other: '%1 moves from solved' };
  assert.equal(plural(1, forms), '1 move from solved');
  assert.equal(plural(2, forms), '2 moves from solved');
  assert.equal(plural(0, forms), '0 moves from solved', 'English puts zero in `other`');
  // The forms go through t(), so a catalog translates them as ordinary sentences rather than
  // through a second, parallel mechanism.
  // A REAL tag, because the rule comes from Intl rather than from this file: Chinese has no
  // plural inflection, so every count selects `other`. That is exactly why a hard-coded
  // `n === 1 ? '' : 's'` at a call site cannot be translated at all — the call site would have
  // had to know which categories the language even has.
  registerLocale('zh', { '%1 moves from solved': '距离还原 %1 步' });
  setLocale('zh');
  assert.equal(locale(), 'zh');
  assert.equal(plural(3, forms), '距离还原 3 步');
  assert.equal(plural(1, forms), '距离还原 1 步', 'Chinese selects `other` at one');
  setLocale('en');
});

test('a stored language that is not a string cannot take boot down', () => {
  // `settings.language` is untrusted input. A truthy non-string sailed past the `||` and reached
  // `.toLowerCase()`, and because that happened inside boot() before the first route was applied,
  // the app came up with a blank stage rather than with English.
  for (const junk of [7, {}, [], true]) {
    assert.equal(initLocale(junk), 'en', `initLocale(${JSON.stringify(junk)}) must fall back, not throw`);
  }
  assert.equal(t('Solve this cube'), 'Solve this cube');
});
