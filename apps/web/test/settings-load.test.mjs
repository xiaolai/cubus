// Loading settings from a record nobody sane wrote — one fresh settings module per stored record.
//
// lib/app-settings.js repairs and migrates what localStorage holds at IMPORT time, so each case
// imports its own copy (a `?case=` query makes a distinct module) over its own stand-in storage.
// Node only: the module and everything it imports load without a DOM.
//
// What these pin (the 2026-09-13 audit's findings on this file):
//   * a theme that is not a string cannot stop the app loading — an object with `toString: null`
//     threw out of the legacy-name lookup at import, so the app never booted;
//   * an inherited property name is not a theme — "__proto__" found Object.prototype and kept it;
//   * every stored preference flag is a real boolean — the string "false" is truthy;
//   * a repair is written back once, whichever repair it was, and a clean record is not rewritten;
//   * a repaired theme falls back to the one defaults table, as every other repair does.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { blockAt } from './app-source.mjs';

const MODULE = new URL('../lib/app-settings.js', import.meta.url).href;
const FLAGS = ['autosolve', 'dragRotate', 'devRandCube', 'proveMinimum'];

/** A localStorage stand-in holding `record` (or nothing), counting writes. */
function storage(record) {
  const held = new Map(record === undefined
    ? []
    : [['cubusSettings', typeof record === 'string' ? record : JSON.stringify(record)]]);
  const store = {
    writes: 0,
    getItem: (k) => (held.has(k) ? held.get(k) : null),
    setItem: (k, v) => { store.writes += 1; held.set(k, String(v)); },
    removeItem: (k) => { held.delete(k); },
    raw: () => held.get('cubusSettings') ?? null,
    stored: () => JSON.parse(held.get('cubusSettings') ?? 'null'),
  };
  return store;
}

let loads = 0;
/** Import a fresh copy of the settings module over `record`. */
async function loadOver(record) {
  const store = storage(record);
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  loads += 1;
  const mod = await import(`${MODULE}?case=${loads}`);
  return { mod, store };
}

test('a theme that is not a string cannot stop the app loading', async () => {
  // JSON carries an object with an own `toString: null`, and turning that into a property key
  // throws.
  let loaded = null;
  await assert.doesNotReject(async () => { loaded = await loadOver({ theme: { toString: null } }); },
    'a stored theme object stopped the settings module loading');
  assert.equal(loaded.mod.settings.theme, 'auto', 'a theme that is not a string falls back to auto');
  assert.equal(loaded.store.stored().theme, 'auto', 'and the repair is written back');
});

test('an inherited property name is not a theme', async () => {
  for (const name of ['__proto__', 'constructor', 'toString']) {
    const { mod, store } = await loadOver({ theme: name });
    assert.equal(mod.settings.theme, 'auto', `the stored theme "${name}" was taken for a theme`);
    assert.equal(store.stored().theme, 'auto', `the stored theme "${name}" was not written back as auto`);
  }
});

test('a repaired theme falls back to the one defaults table, as every other repair does', async () => {
  // DEFAULT_SETTINGS is "what every repair below falls back to", and the theme repair restated
  // 'auto' by hand, so the two could drift (found by audit, 2026-09-13; still there at
  // verification, 2026-09-14). No load can tell them apart while both say 'auto', so the repair's
  // source is read.
  const src = readFileSync(new URL('../lib/app-settings.js', import.meta.url), 'utf8');
  const repair = blockAt(src, '{\n  const LEGACY_THEMES');
  assert.match(repair, /DEFAULT_SETTINGS\.theme/, 'the theme repair does not fall back to DEFAULT_SETTINGS.theme');
  assert.doesNotMatch(repair, /:\s*'auto'\s*\)/, 'the theme repair restates its default by hand');
  const { mod } = await loadOver({ theme: 'no such theme' });
  assert.equal(mod.settings.theme, mod.DEFAULT_SETTINGS.theme, 'an unknown theme did not fall back to the default');
});

test('the two legacy theme names still map to the themes they became', async () => {
  for (const [old, now] of [['light', 'cream'], ['dark', 'night']]) {
    const { mod, store } = await loadOver({ theme: old });
    assert.equal(mod.settings.theme, now, `a stored "${old}" did not become "${now}"`);
    assert.equal(store.stored().theme, now, `a stored "${old}" was not written back as "${now}"`);
  }
});

test('every stored preference flag is a real boolean', async () => {
  const hostile = await loadOver({ autosolve: 'false', dragRotate: 'no', devRandCube: 1, proveMinimum: 'yes' });
  for (const k of FLAGS) {
    assert.equal(hostile.mod.settings[k], false, `a stored non-boolean ${k} stayed truthy`);
    assert.equal(hostile.store.stored()[k], false, `the stored non-boolean ${k} was not written back as false`);
  }
  // And a real `true` is a choice the user made, kept exactly.
  const chosen = await loadOver({ autosolve: true, dragRotate: true, devRandCube: true, proveMinimum: true });
  for (const k of FLAGS) assert.equal(chosen.mod.settings[k], true, `a stored true ${k} was not kept`);
});

test('a repair made only in memory is still written back', async () => {
  // Nothing the repair table checks is wrong here, and the nav migration has already run — so
  // before, nothing was saved, and the out-of-range rung and the leftover key stayed in storage.
  const { mod, store } = await loadOver({ navDefaults: 2, navHidden: [], rungs: { cross: 99 }, inspection: true });
  assert.equal(mod.settings.rungs.cross, 0, 'precondition: the rung is repaired in memory');
  assert.deepEqual(store.stored().rungs, mod.settings.rungs, 'the repaired rungs were not written back');
  assert.ok(!('inspection' in store.stored()), 'a dropped leftover key was left in storage');
});

test('a clean record is not rewritten on every launch', async () => {
  const first = await loadOver(undefined);
  const clean = first.store.raw();
  assert.ok(clean, 'precondition: a first launch writes the settings it settled on');
  const again = await loadOver(clean);
  assert.equal(again.store.writes, 0, 'an unchanged record was written again');
  assert.equal(again.store.raw(), clean, 'and what storage holds is exactly what it held');
});
