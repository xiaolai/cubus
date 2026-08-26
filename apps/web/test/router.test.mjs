// Unit tests for the hash router (apps/web/lib/router.js).
//
// Hash-based rather than History API: the app is served as plain static files, off a
// server, and neither rewrites unknown paths back to index.html. A hash needs no server help.
//
// The factory takes location and history by argument, so these run with plain objects — no jsdom,
// no globals, matching cube-transport.test.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeRouter } from '../lib/router.js';

// Only these ids are routable. Mirrors the real SCREENS registry shape.
const screens = { home: 1, timer: 1, viewer: 1, settings: 1 };

function mockHost(hash = '') {
  const calls = [];
  const location = { hash };
  const history = {
    replaceState: (_s, _t, url) => {
      calls.push(url);
      location.hash = String(url);
    },
  };
  return { location, history, calls };
}
const router = (h) => {
  const host = mockHost(h);
  return { r: makeRouter({ screens, defaultScreen: 'home', ...host }), ...host };
};

test('parses a valid hash to its screen id', () => {
  assert.equal(router('#/timer').r.current(), 'timer');
});

test('tolerates a missing slash', () => {
  assert.equal(router('#timer').r.current(), 'timer');
});

test('falls back to the default for an empty hash', () => {
  assert.equal(router('').r.current(), 'home');
  assert.equal(router('#').r.current(), 'home');
});

test('falls back to the default for an unknown screen', () => {
  assert.equal(router('#/nope').r.current(), 'home');
});

test('decodes percent-encoding and trims whitespace', () => {
  assert.equal(router('#/%74imer').r.current(), 'timer');
  assert.equal(router('#/  timer  ').r.current(), 'timer');
});

// A hash is attacker-supplied in the sense that anyone can type one. Inherited Object keys must
// not read as routable, or `screens[id]` would resolve to a function and renderScreen would call it.
test('inherited Object properties are not routable', () => {
  for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(router(`#/${evil}`).r.current(), 'home', `${evil} must not route`);
  }
});

test('go() to a different screen sets the hash and reports the change', () => {
  const { r, location } = router('#/home');
  assert.equal(r.go('timer'), true, 'should report that the hash changed');
  assert.equal(location.hash, '#/timer');
});

// The old go() always re-rendered, including onto the current screen — the scan flow relies on
// go('viewer') refreshing while already on viewer. Setting an identical hash fires no hashchange,
// so go() must report false and let the caller render directly.
test('go() to the current screen reports no change, so the caller re-renders', () => {
  const { r, location } = router('#/timer');
  assert.equal(r.go('timer'), false, 'no hashchange will fire; caller must render');
  assert.equal(location.hash, '#/timer', 'hash is left untouched');
});

test('go() with an unknown id falls back to the default screen', () => {
  const { r, location } = router('#/home');
  assert.equal(r.go('nope'), false, 'resolves to home, which is already current');
  assert.equal(location.hash, '#/home');
});

test('normalize() rewrites an invalid hash without adding a history entry', () => {
  const { r, location, calls } = router('#/bogus');
  assert.equal(r.normalize(), 'home');
  assert.equal(location.hash, '#/home');
  assert.deepEqual(calls, ['#/home'], 'must use replaceState, not push');
});

test('normalize() leaves an already-canonical hash alone', () => {
  const { r, calls } = router('#/viewer');
  assert.equal(r.normalize(), 'viewer');
  assert.deepEqual(calls, [], 'no rewrite needed');
});

// Some engines reject replaceState on a file:// document. Normalising the URL is cosmetic, so it
// must degrade to assigning the hash rather than throwing during boot.
test('normalize() survives a history that rejects replaceState', () => {
  const location = { hash: '#/bogus' };
  const history = { replaceState: () => { throw new Error('SecurityError'); } };
  const r = makeRouter({ screens, defaultScreen: 'home', location, history });
  assert.equal(r.normalize(), 'home');
  assert.equal(location.hash, '#/home', 'falls back to assigning the hash');
});

test('href() builds the canonical form', () => {
  assert.equal(router('').r.href('timer'), '#/timer');
});
