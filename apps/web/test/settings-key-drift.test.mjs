// A setting that was renamed, and a caller that was not (2026-09-20).
//
// THE FAILURE THIS EXISTS FOR, because it stayed green the whole time it was happening. `sounds`
// became `soundMode` on 2026-09-20. The fast tier's callers were updated; three others were not —
// `test/browser/sound.test.mjs` waited for a control that no longer existed, and `spoken.test.mjs`'s
// rig went on saving and restoring `settings.sounds`, a property production had stopped reading. The
// rig's own comment promised isolation it no longer provided, and every test in that file ran at
// whatever mode the previous one left behind. Nothing went red: reading a property that does not
// exist is `undefined`, and writing one nobody reads is silent.
//
// It survived a full `pnpm check:fast` because the browser suites are not in that tier, and it was
// found by an audit rather than by the gate. So the gate gets this: a key is REAL when
// `lib/app-settings.js` either defaults it or repairs it, DEAD when that file deletes it, and every
// other reference in the app or the tests must name a real one.
//
// Deriving both lists from app-settings.js is what keeps this from becoming another hand-kept
// inventory that drifts — the thing it is here to catch.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { APP_SOURCES, LIBRARY_SOURCES, blockAt } from './app-source.mjs';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${WEB}${p}`, 'utf8');
const SETTINGS_FILE = 'lib/app-settings.js';
const settingsSource = read(SETTINGS_FILE);

/** The two files allowed to name a dead key: the migration itself, and the test that drives it. */
const MIGRATION_SITES = new Set([SETTINGS_FILE, 'test/sound-mode.test.mjs']);

/** Keys `lib/app-settings.js` gives a default. */
const defaulted = () => {
  const block = blockAt(settingsSource, 'export const DEFAULT_SETTINGS = Object.freeze(');
  return [...block.matchAll(/(\w+):/g)].map((m) => m[1]);
};
/** Keys it repairs in place — real settings that carry no literal default (`rungs`, `rungProgress`). */
const repaired = () => [...settingsSource.matchAll(/^settings\.(\w+)\s*=/gm)].map((m) => m[1]);
/** Keys it deliberately drops. A stored leftover nothing reads, kept impossible rather than unlikely. */
const deleted = () => [...settingsSource.matchAll(/^delete settings\.(\w+);/gm)].map((m) => m[1]);

/**
 * `text` with its comments removed.
 *
 * THE GUARD IS ABOUT CODE, NOT PROSE. This repository explains its migrations in comments — the
 * sentence "it set `settings.sounds` until 2026-09-20" is exactly the kind of record it keeps — and
 * a guard that counted those would make writing the explanation an error. `solve-tier-wiring.test.mjs`
 * sweeps comment-stripped source for the same reason.
 */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * Every `settings.<key>` in `text`.
 *
 * The lookbehind is load-bearing: without it `app-settings.js` in an import path reads as the key
 * `js`, and `hostile-settings.test.mjs` as the key `test`. A guard whose own matcher invents
 * findings is one nobody will keep.
 */
const keysIn = (text) => [...code(text).matchAll(/(?<![\w/-])settings\.(\w+)/g)].map((m) => m[1]);

/** Every file this guard reads: the app's own modules, its libraries, and every test. */
function sources() {
  const tests = [];
  for (const dir of ['test', 'test/browser']) {
    for (const name of readdirSync(`${WEB}${dir}`)) {
      if (name.endsWith('.mjs')) tests.push(`${dir}/${name}`);
    }
  }
  return [...APP_SOURCES, ...LIBRARY_SOURCES, ...tests];
}

test('every settings key a caller names is one app-settings.js actually keeps', () => {
  const real = new Set([...defaulted(), ...repaired()]);
  assert.ok(real.has('theme') && real.has('soundMode'), 'the real-key list was not derived');
  const strays = [];
  for (const file of sources()) {
    if (file === SETTINGS_FILE) continue;
    for (const key of new Set(keysIn(read(file)))) {
      if (!real.has(key)) strays.push(`${file} → settings.${key}`);
    }
  }
  assert.deepEqual(strays, [], `these name a setting app-settings.js does not keep:\n  ${strays.join('\n  ')}`);
});

test('a key the migration deletes is named only where the migration lives', () => {
  // A dead key outside the migration is the exact shape of the 2026-09-20 miss: a caller left behind
  // by a rename, reading undefined and writing into the void, with nothing going red.
  const dead = deleted();
  assert.ok(dead.includes('sounds'), 'the deleted-key list was not derived from the migration');
  const strays = [];
  for (const file of sources()) {
    if (MIGRATION_SITES.has(file)) continue;
    for (const key of new Set(keysIn(read(file)))) {
      if (dead.includes(key)) strays.push(`${file} → settings.${key}`);
    }
  }
  assert.deepEqual(strays, [], `these read a setting that was migrated away:\n  ${strays.join('\n  ')}`);
});

test('a toggle a test looks up is a toggle the app still draws', () => {
  // THE MEMBER THE OTHER TWO CASES MISS. The rename broke `test/browser/sound.test.mjs` through a DOM
  // SELECTOR — `[data-toggle="sounds"]` — not through a property read, so a guard that only knows
  // about `settings.X` passes over the one failure that actually stopped a test. Found by mutating
  // the defect back in and watching this file stay green.
  //
  // `data-toggle` is written as `data-toggle="${settings key}"` in lib/screens/settings.js, so a
  // BRACKETED lookup naming a key the app no longer keeps is a control that can never be found. The
  // brackets are the distinction that makes this precise: a bracketed selector is a LOOKUP and
  // asserts the control exists, while a bare `attrs: 'data-toggle="x"'` is a CONSTRUCTION — one of
  // which is an inert placeholder in a switchRow case that throws.
  const real = new Set([...defaulted(), ...repaired()]);
  const strays = [];
  for (const file of sources()) {
    for (const [, key] of code(read(file)).matchAll(/\[data-toggle="(\w+)"\]/g)) {
      if (!real.has(key)) strays.push(`${file} → [data-toggle="${key}"]`);
    }
  }
  assert.deepEqual(strays, [], `these look up a toggle the app no longer draws:\n  ${strays.join('\n  ')}`);
});

test('the guard reads the browser tier too, which is how the miss escaped', () => {
  // `pnpm check:fast` does not run test/browser/, so a rename that broke a browser suite passed the
  // gate anyone runs before pushing. This guard lives in the FAST tier and reads the browser suites
  // as TEXT, so the next such rename fails in the tier that actually gets run.
  const files = sources();
  assert.ok(files.some((f) => f.startsWith('test/browser/')), 'the browser suites are not being read');
  assert.ok(files.includes('test/browser/sound.test.mjs'), 'the suite that carried the miss is not read');
});
