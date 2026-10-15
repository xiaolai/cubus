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

// ---- by NAME, not by the list ---------------------------------------------------------------------
//
// The case above — "the shipped migration hides every default tab on a fresh install" — loops over
// `DEFAULT_HIDDEN`. Remove an id from that list and it drops out of the loop too, so the check goes green
// whether or not the tab is actually visible. So the row a fresh install sees is asserted WHOLE.

test('a fresh install shows exactly Home, Restore and Scramble', async () => {
  // The owner's decision, 2026-10-14: the default row is solve, scan and scramble.
  const { NAV } = await import('../lib/app-state.js');
  for (const stored of [undefined, DEFAULT_HIDDEN]) {
    const { navHidden } = migrateNavDefaults(undefined, stored ?? []);
    const row = NAV.map(([id]) => id).filter((id) => !navHidden.includes(id));
    assert.deepEqual(row, ['home', 'scan', 'scramble'], `a fresh install shows ${row.join(', ')}`);
  }
});

test('a deliberate hide survives, whatever the stored version says', () => {
  // The record cannot tell an inherited default from a choice, which is why no delta removes an id
  // (decision D5). Someone who hid the Timer keeps it hidden and turns it back on in Settings.
  for (const from of [3, 2, 0, undefined, -1e100, 2.5, 'x', NAV_DEFAULTS_VERSION, NAV_DEFAULTS_VERSION + 1]) {
    const out = migrateNavDefaults(from, ['timer']);
    assert.ok(out.navHidden.includes('timer'), `version ${JSON.stringify(from)} un-hid a deliberate hide`);
  }
});

test('a tab brought back is not hidden again by a later bump', () => {
  // Somebody at version 2 who turned Timer and Stats back on: version 3 is about the Course tab alone.
  const out = migrateNavDefaults(2, []);
  assert.ok(!out.navHidden.includes('timer') && !out.navHidden.includes('stats'),
    'a bump re-hid a tab the user had turned on');
  // And at the current version nothing moves at all.
  assert.deepEqual(migrateNavDefaults(NAV_DEFAULTS_VERSION, []).navHidden, [],
    'a record already at the current version was migrated again');
});

test('no migration writes the id of a screen that was removed', async () => {
  // Alg trainer, Drill, Pieces, Lessons and One turn were removed (ADR 0010), and their entries in the
  // migration tables with them. An entry left behind would write a dead id into every record it reached,
  // which the load filter then throws away — a write that changes nothing, on every launch it runs.
  const { NAV } = await import('../lib/app-state.js');
  const REMOVED = ['trainer', 'drill', 'pieces', 'lessons', 'loop'];
  const tabs = new Set(NAV.map(([id]) => id));
  const hideable = new Set(HIDEABLE.map(([id]) => id));
  for (const id of REMOVED) {
    assert.ok(!tabs.has(id) && !hideable.has(id), `${id} is still a tab`);
    for (let from = 0; from <= NAV_DEFAULTS_VERSION; from++) {
      assert.ok(!migrateNavDefaults(from, []).navHidden.includes(id), `version ${from} writes the removed id ${id}`);
    }
  }
});

test('the walk honours its UPPER bound, not only its lower one', () => {
  // It skipped `v <= from` and applied everything above, including versions past the requested
  // target: (3, [], undefined, 4) ran version 5's removal and then stamped the record as 4, a state
  // no shipped version ever produced. Production always asks for the latest, which is exactly why
  // no caller noticed (audit, 2026-09-29). Its own tables, because the shipped ones no longer show
  // anything back.
  const added = { 4: ['p'] };
  const shown = { 5: ['p'] };
  const toFour = migrateNavDefaults(3, [], added, 4, shown);
  assert.equal(toFour.navDefaults, 4, 'it stamped a version it was not asked for');
  assert.ok(toFour.navHidden.includes('p'), 'version 5 ran while migrating only as far as 4');
  // The lower bound still holds, and the two together bracket exactly one step.
  assert.deepEqual(migrateNavDefaults(4, ['p'], added, 5, shown).navHidden, [], 'the one step in range did not run');
  // And asking for less than the record already has changes nothing at all.
  assert.deepEqual(migrateNavDefaults(5, ['p'], added, 4, shown).navHidden, ['p'],
    'migrating backwards altered the record');
});

test('within one version, a show outranks a hide', () => {
  // Fixed in the walk so that nothing has to guess: adds first, then removals.
  assert.deepEqual(migrateNavDefaults(0, [], { 1: ['p'] }, 1, { 1: ['p'] }).navHidden, []);
});

test('no migration ships above the version anyone will ever migrate to', () => {
  // THE SILENT NO-OP. `NAV_ADDED` and `NAV_SHOWN` are keyed by version and the walk honours
  // `NAV_DEFAULTS_VERSION` as its upper bound, so an entry added without bumping that constant is
  // dead code that reads exactly like a shipped default: every case in this file passes, and the tab
  // it was written for is visible to everybody for ever. Nothing can catch that from the inside —
  // the tables are module-private, and the walk cannot report a step it is forbidden to take.
  //
  // So it is asked from the outside: walking far past the shipped version must reach the same place
  // as walking to it. Anything beyond is a migration no install will ever run.
  const shipped = [...migrateNavDefaults(0, []).navHidden].sort();
  const beyond = [...migrateNavDefaults(0, [], undefined, NAV_DEFAULTS_VERSION + 50).navHidden].sort();
  assert.deepEqual(beyond, shipped,
    'a migration is keyed above NAV_DEFAULTS_VERSION, so no install will ever run it');
  // And walking every migration lands exactly on the shipped defaults — AS A SET, because visibility
  // depends on membership and reordering `DEFAULT_HIDDEN` changes no behaviour (audit, 2026-10-06).
  assert.deepEqual(shipped, [...DEFAULT_HIDDEN].sort(),
    'walking every migration does not land on the shipped default hidden set');
});
