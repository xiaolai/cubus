// The nav-default migrations, over records nobody sane wrote.
//
// This exists because the loop it replaced was module-scope statements nothing could call, and it
// went wrong in two ways that only a hostile record would show. `localStorage` is untrusted input:
// anything on the origin can write it, a person can edit it by hand, and a half-finished migration
// can leave a field in a state no code path produces.
//
// The failure that matters most is not a wrong answer — it is that THE APP NEVER STARTS. A stored
// `-1e100` counted upward forever, because `-1e100 + 1 === -1e100` in floating point, and settings
// are read at module scope during boot.
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_HIDDEN, HIDEABLE, migrateNavDefaults, NAV_DEFAULTS_VERSION } from '../lib/app-settings.js';

const ADDED = Object.freeze({ 2: ['timer', 'stats'], 3: ['course'] });
const run = (version, hidden = []) => migrateNavDefaults(version, hidden, ADDED, 3);

test('a fresh record gets every default', () => {
  assert.deepEqual(run(0), { navDefaults: 3, navHidden: ['timer', 'stats', 'course'] });
});

test('a bump applies only what is new, and never re-hides what was brought back', () => {
  // THE DELTA PROPERTY. Applying the whole set again would take Timer away from someone who had
  // deliberately turned it on — which is what the comment in app-settings.js promises it will not do.
  assert.deepEqual(run(2, []), { navDefaults: 3, navHidden: ['course'] });
  assert.deepEqual(run(2, ['stats']), { navDefaults: 3, navHidden: ['stats', 'course'] });
});

test('a record already at the current version is left alone', () => {
  assert.deepEqual(run(3, ['course']), { navDefaults: 3, navHidden: ['course'] });
  assert.deepEqual(run(9, []), { navDefaults: 9, navHidden: [] }, 'a version from the future is not rolled back');
});

test('a version that is not a whole number cannot skip a migration', () => {
  // 2.5 counted from 3.5, ran nothing, and was stamped 3 — so the Course tab never got its default
  // and nothing would ever apply it again.
  assert.deepEqual(run(2.5), { navDefaults: 3, navHidden: ['timer', 'stats', 'course'] });
});

test('a hostile version terminates instead of hanging the boot', () => {
  // Each of these is a value `-1e100 + 1` style counting never escapes. The assertion is simply
  // that this RETURNS: a test that hangs here is the defect.
  for (const bad of [-1e100, -1, Number.NaN, Infinity, -Infinity, '3', null, undefined, {}]) {
    const out = migrateNavDefaults(bad, [], ADDED, 3);
    assert.equal(out.navDefaults, 3, `version ${String(bad)} was not migrated`);
    assert.deepEqual(out.navHidden, ['timer', 'stats', 'course']);
  }
});

test('a later version cannot be applied before an earlier one', () => {
  const seen = migrateNavDefaults(0, [], { 3: ['c'], 2: ['a', 'b'] }, 3);
  assert.deepEqual(seen.navHidden, ['a', 'b', 'c'], 'the migrations ran out of order');
});

// ---- THE PRODUCTION TABLE, not a substitute -----------------------------------------------------
//
// Every case above supplies its own table and version, which tests the MECHANISM and says nothing
// about what the app actually ships. An audit removed Course from the real migration list and all
// six passed: the mechanism was perfect and the app would have shipped the Course tab visible to
// every existing installation. These call `migrateNavDefaults` with its real defaults.

test('the shipped migration hides the Course tab for someone already at version 2', () => {
  const out = migrateNavDefaults(2, ['timer']);
  assert.ok(out.navHidden.includes('course'), 'an existing install would see the Course tab');
  assert.ok(out.navHidden.includes('timer'), 'and it took away a tab they had turned on');
  assert.equal(out.navDefaults, NAV_DEFAULTS_VERSION);
});

test('the shipped migration hides every default tab on a fresh install', () => {
  const out = migrateNavDefaults(0, []);
  for (const id of DEFAULT_HIDDEN) {
    assert.ok(out.navHidden.includes(id), `${id} is not hidden on a fresh install`);
  }
  assert.equal(out.navDefaults, NAV_DEFAULTS_VERSION);
});

test('every hideable tab the app ships is one the nav knows how to hide', () => {
  // The table and the toolbar have to agree: a migration hiding a name that is not hideable would
  // silently do nothing, and `navHidden` filters unknown ids out on load.
  const hideable = new Set(HIDEABLE.map(([id]) => id));
  for (const id of DEFAULT_HIDDEN) {
    assert.ok(hideable.has(id), `${id} is hidden by default but is not in HIDEABLE`);
  }
});
