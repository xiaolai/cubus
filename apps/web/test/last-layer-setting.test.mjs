// Which order the last layer is taught in, as a setting: `course` or `app` (ADR 0009), and what an install
// from before the setting existed is moved to.
//
// The course's order is the default (decision I, 2026-10-14), and a stored record outranks a changed
// default — so a default alone would never reach an existing install, and a migration that reached every
// one would take the app's own last layer away from a learner who has been climbing it. The rule is in
// `repairLastLayer`; these cases hold it, including the ones that must NOT move.
//
// The last case is the other record the course plan added to the same store: where a lesson rested.
//
// The settings module reads storage AT IMPORT, so each case prepares a store and imports a fresh copy
// with a cache-busting query, as `sound-mode.test.mjs` does.

import assert from 'node:assert/strict';
import { test } from 'node:test';

let stamp = 0;
/** Load a fresh `lib/app-settings.js` over `stored`, and report what it settled on and what it wrote. */
async function loadWith(stored) {
  const store = new Map();
  if (stored !== undefined) store.set('cubusSettings', JSON.stringify(stored));
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const mod = await import(`../lib/app-settings.js?last-layer=${++stamp}`);
  const written = store.get('cubusSettings');
  return { settings: mod.settings, written: written ? JSON.parse(written) : null };
}

const ZERO = { cross: 0, pairs: 0, oll: 0, pll: 0 };

test('a first launch walks the course\'s last layer, and says so in storage', async () => {
  const fresh = await loadWith(undefined);
  assert.equal(fresh.settings.lastLayer, 'course');
  assert.equal(fresh.written?.lastLayer, 'course', 'a first launch did not record its route');
});

test('an install from before the route existed moves to the course only if it never climbed the last layer', async () => {
  const beginner = await loadWith({ rungs: { ...ZERO, cross: 1, pairs: 2 } });
  assert.equal(beginner.settings.lastLayer, 'course', 'a learner with no last-layer rung up did not reach the new default');
  // The cases that must NOT move: either last-layer dial raised is a learner on the app's algorithms.
  for (const rungs of [{ ...ZERO, oll: 1 }, { ...ZERO, pll: 1 }, { ...ZERO, oll: 1, pll: 1 }]) {
    const climbed = await loadWith({ rungs });
    assert.equal(climbed.settings.lastLayer, 'app',
      `a learner at ${JSON.stringify(rungs)} was moved off the last layer they have been learning`);
    // Written, so the decision is made once: read again next launch it is a stored CHOICE, which a later
    // change to the rungs must not re-decide.
    assert.equal(climbed.written?.lastLayer, 'app', 'the migration was not written down');
  }
});

test('a stored route is a choice, and outranks the rungs either way', async () => {
  const keptApp = await loadWith({ rungs: ZERO, lastLayer: 'app' });
  assert.equal(keptApp.settings.lastLayer, 'app', 'a learner who chose the app\'s order at rung 0 was moved to the course');
  const keptCourse = await loadWith({ rungs: { ...ZERO, oll: 1 }, lastLayer: 'course' });
  assert.equal(keptCourse.settings.lastLayer, 'course', 'a learner who chose the course was moved because a dial is up');
});

test('a route that is not one is repaired, never believed — and a rung that is not one does not count as climbing', async () => {
  for (const bad of ['', 'cfop', 7, null, { course: true }, 'constructor', '__proto__']) {
    const r = await loadWith({ rungs: ZERO, lastLayer: bad });
    assert.equal(r.settings.lastLayer, 'course', `a stored lastLayer of ${JSON.stringify(bad)} was believed`);
  }
  // `oll: 99` is not a rung; repaired to 0 it is not evidence of a learner on the app's ladder.
  const hostile = await loadWith({ rungs: { ...ZERO, oll: 99 } });
  assert.equal(hostile.settings.lastLayer, 'course', 'a corrupted rung decided the route');
});

// ---- where a lesson rested (plan Phase 6) — the same store, the same rule: repaired, never believed ----

test('a lesson\'s resting place survives a reload as a record, and anything else is dropped', async () => {
  const kept = { course: 'course/', id: '13-a-cross-on-top', progress: { step: 4 } };
  assert.deepEqual((await loadWith({ courseRested: kept })).settings.courseRested, kept);
  assert.equal((await loadWith(undefined)).settings.courseRested, null, 'a first launch rests nowhere');
  // Whether `progress` fits the lesson is asked when the lesson opens; here only the SHAPE is held.
  for (const bad of [7, 'course/', [], { course: 'course/', id: 'x' }, { course: '', id: 'x', progress: {} },
    { course: 'course/', id: 9, progress: {} }, { course: 'course/', id: 'x', progress: [] }]) {
    assert.equal((await loadWith({ courseRested: bad })).settings.courseRested, null,
      `a stored resting place of ${JSON.stringify(bad)} was believed`);
  }
});
