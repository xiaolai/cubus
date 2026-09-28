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

// ---- publishing the Drill tab (dev-docs/algorithm-drills-plan.md item 4.2) ------------------------
//
// WHY THESE ASSERT A NAME. The case above — "the shipped migration hides every default tab on a
// fresh install" — loops over `DEFAULT_HIDDEN`. Remove an id from that list and it drops out of the
// loop too, so the check goes green whether or not the tab is actually visible. That is exactly the
// shape of the gap this feature would have shipped through: changing `DEFAULT_HIDDEN` alone leaves
// `NAV_ADDED[2]` to put `drill` straight back, and nothing in the old suite could tell.

test('a fresh install SEES the Drill tab', () => {
  const out = migrateNavDefaults(undefined, DEFAULT_HIDDEN);
  assert.ok(!out.navHidden.includes('drill'), 'a fresh install still hides Drill');
  assert.equal(out.navDefaults, NAV_DEFAULTS_VERSION);
});

test('an install from before any migration sees it too', () => {
  for (const from of [0, 1, 2]) {
    assert.ok(!migrateNavDefaults(from, DEFAULT_HIDDEN).navHidden.includes('drill'), `version ${from} hides Drill`);
  }
});

test('a deliberate hide survives, whatever the stored version says', () => {
  // The record cannot tell an inherited default from a choice, which is why no delta removes an id
  // (decision D5). Someone who hid Drill keeps it hidden and turns it back on in Settings.
  for (const from of [3, 2, 0, undefined, -1e100, 2.5, 'x']) {
    const out = migrateNavDefaults(from, ['drill']);
    assert.ok(out.navHidden.includes('drill'), `version ${JSON.stringify(from)} un-hid a deliberate hide`);
  }
});

test('and an install that had Drill visible keeps it visible', () => {
  for (const from of [3, 2, 0, undefined]) {
    assert.ok(!migrateNavDefaults(from, []).navHidden.includes('drill'), `version ${JSON.stringify(from)} hid Drill`);
  }
});

// ---- Pieces became a tab of its own (2026-09-29, option C) ---------------------------------------
//
// BY NAME, for the reason above: the loop over `DEFAULT_HIDDEN` cannot tell whether a newly listed id
// is actually hidden, because adding it to that list also adds it to the loop's own expectation.

test('a fresh install HIDES the Pieces tab', () => {
  const out = migrateNavDefaults(undefined, DEFAULT_HIDDEN);
  assert.ok(out.navHidden.includes('pieces'), 'a fresh install shows Pieces — the default row is the beginner path');
  assert.equal(out.navDefaults, NAV_DEFAULTS_VERSION);
});

test('an install at any earlier version has Pieces hidden once, and keeps the rest of its choices', () => {
  // The whole point of a DELTA. Somebody at version 3 who had deliberately brought Timer and Stats
  // back must not lose them because a Pieces tab was added — applying `DEFAULT_HIDDEN` wholesale is
  // what that would do, and it is the mistake `NAV_ADDED` exists to prevent.
  for (const from of [0, 1, 2, 3]) {
    const out = migrateNavDefaults(from, []);
    assert.ok(out.navHidden.includes('pieces'), `version ${from} left Pieces visible`);
  }
  const brought = migrateNavDefaults(3, []);
  assert.deepEqual(brought.navHidden, ['pieces'],
    'the bump re-hid something that had been brought back, instead of adding only what is new');
});

test('a deliberate choice about Pieces survives the bump', () => {
  // Nobody can have made one yet — until this version there was no id — but the rule is the rule, and
  // the day somebody shows the tab a later migration must not take it away.
  const shown = migrateNavDefaults(4, []);
  assert.ok(!shown.navHidden.includes('pieces'), 'a record already at 4 was migrated again');
});

test('Drill is in neither hiding table, which is what publishing it means', () => {
  assert.ok(!DEFAULT_HIDDEN.includes('drill'), 'Drill is still a default-hidden tab');
  assert.ok(HIDEABLE.some(([id]) => id === 'drill'), 'Drill must stay hideable — publishing is not forcing');
});
