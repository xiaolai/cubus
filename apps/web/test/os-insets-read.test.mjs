// What the OS inset inputs MEAN: the `?insets=` design-review override and the Android
// shell's bridge.
//
// lib/os-insets.js decides; lib/app.js only writes the CSS properties it is handed. These
// drive both decisions with real inputs. They replaced source-text matches in
// os-insets.test.mjs, which could not tell a check that runs from a check that is merely
// written down (the 2026-09-13 audit).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInsetOverride, readAndroidInsets } from '../lib/os-insets.js';

test('an absent override is nothing, and four non-negative numbers are the four sides', () => {
  assert.equal(parseInsetOverride(null), null);
  assert.deepEqual(parseInsetOverride('59,0,34,0'), { t: 59, r: 0, b: 34, l: 0 });
  assert.deepEqual(parseInsetOverride(' 12.5, 0 ,3,4 '), { t: 12.5, r: 0, b: 3, l: 4 });
});

test('an override that is not four plain numbers is refused, not read as the number it starts with', () => {
  // A run of digits too long for a double is Infinity, and `Infinitypx` is no inset: whole tokens
  // alone let it through once (found by verification, 2026-09-14).
  const tooLong = `${'9'.repeat(400)},0,34,0`;
  for (const raw of ['59oops,0,34,0', '59,0,34,0px', ',0,0,0', '59,0,34', '59,0,34,0,1', '-1,0,0,0', 'NaN,0,0,0', 'Infinity,0,0,0', tooLong]) {
    assert.throws(() => parseInsetOverride(raw), /four non-negative numbers/, `"${raw}" was accepted`);
  }
});

test('the Android bridge — absent, unready, or not answering in text — is nothing, and nothing to warn about', () => {
  const warned = [];
  const warn = (...args) => warned.push(args);
  assert.equal(readAndroidInsets(undefined, warn), null, 'no bridge at all');
  assert.equal(readAndroidInsets({}, warn), null, 'a bridge with no get()');
  assert.equal(readAndroidInsets({ get: () => 'null' }, warn), null, 'the honest answer before the first dispatch');
  assert.equal(readAndroidInsets({ get: () => null }, warn), null, 'an answer that is not text');
  assert.deepEqual(warned, [], 'none of those is a fault worth a warning');
});

test('a bridge that throws, or sends anything but four non-negative numbers, is refused — and says so', () => {
  const warned = [];
  const warn = (...args) => warned.push(args);
  const refused = [
    { get: () => { throw new Error('the JNI call failed'); } },
    { get: () => '{not json' },
    { get: () => JSON.stringify({ t: 1, r: 2, b: 3 }) },
    { get: () => JSON.stringify({ t: 1, r: 2, b: 3, l: -1 }) },
    { get: () => JSON.stringify({ t: '1', r: 2, b: 3, l: 4 }) },
    { get: () => JSON.stringify({ t: 1, r: 2, b: Infinity, l: 4 }) },
    { get: () => '[24, 0, 48, 0]' },
  ];
  for (const bridge of refused) {
    assert.equal(readAndroidInsets(bridge, warn), null, `accepted: ${String(bridge.get).slice(0, 60)}`);
  }
  assert.equal(warned.length, refused.length, 'a refusal went unreported');
});

test('four non-negative numbers from the bridge are the four sides', () => {
  assert.deepEqual(readAndroidInsets({ get: () => '{"t":24,"r":0,"b":48,"l":0}' }), { t: 24, r: 0, b: 48, l: 0 });
});
