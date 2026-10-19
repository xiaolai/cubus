// HOW FAST A TURN IS DRAWN, and the rule that it is drawn that way on every cube.
//
// `tempo-scale` was defined in the cube screen's speed menu (now `lib/speed-menu.js`) and written to that screen's cube
// alone, so every other cube the app draws animated at the renderer's own 190ms base: measured
// 2026-09-30 on the Drill page at 200ms per quarter turn against 1620ms for the same turn at
// Normal. A fifth of a second reads as a snap, which is what "the drills have no animation" meant.
//
// THE SHAPE HAD ALREADY SHIPPED ONCE. Ghost faces and the camera were the cube screen's alone too —
// "which is why both drill screens came out with no ghost faces at all" (`lib/screens/cube.js`) —
// and `applyCubeView` was written to end exactly that. The tempo was left out of it. So the cases
// below are about the RELATION (one table, applied by the one function that draws them all) rather
// than about any single screen, because a list of screens is what goes stale next time.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { APP_SOURCES, LIBRARY_SOURCES } from './app-source.mjs';

const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { WALK_SPEEDS, DEFAULT_WALK_SPEED, WALK_SPEED_KEY, tempoFor } = await import('../lib/cube-view.js');
const { applyCubeView } = await import('../lib/cube-drawing.js');

/** Just enough element to record what was written to it. */
const fakeCube = () => {
  const attrs = new Map();
  return { attrs, setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null };
};

const RENDERER_BASE_MS = 190;
/** What a quarter turn takes at a tempo — the renderer divides its base by the scale. */
const turnMs = (tempo) => RENDERER_BASE_MS / tempo;

test('every shipped speed is slower than the renderer\'s bare default', () => {
  // The default is 1, which is 190ms. The complaint that produced the menu was about 760ms being
  // too FAST, so a speed at or above the bare default is not a speed anybody asked for.
  assert.ok(WALK_SPEEDS.length >= 3, 'the speed table is empty or nearly so, so this checks nothing');
  for (const { id, tempo } of WALK_SPEEDS) {
    assert.ok(tempo < 1, `${id}: tempo ${tempo} is at or above the renderer's bare default`);
    assert.ok(turnMs(tempo) >= 760, `${id}: ${Math.round(turnMs(tempo))}ms is faster than the 760ms that was the complaint`);
  }
  assert.ok(WALK_SPEEDS.some((o) => o.id === DEFAULT_WALK_SPEED), 'the default names no shipped speed');
});

test('applyCubeView puts a tempo on the cube, because it is the one place every cube passes through', () => {
  store.clear();
  const el = fakeCube();
  applyCubeView(el);
  const written = el.getAttribute('tempo-scale');
  assert.ok(written !== null, 'a cube was drawn with no tempo, so the renderer uses its own 190ms');
  assert.equal(Number(written), tempoFor(DEFAULT_WALK_SPEED), 'the tempo is not the saved default');
  // The number matters, not just its presence: this is the assertion that fails if someone writes
  // the renderer's bare default and calls the job done.
  assert.ok(turnMs(Number(written)) >= 760, `a turn would take ${Math.round(turnMs(Number(written)))}ms`);
});

test('a chosen speed reaches a cube on a screen with no speed menu', () => {
  // The Drill and Pieces screens have no gauge. The choice still has to reach their cubes, which
  // is the whole of this fix: the menu CHOOSES, `applyCubeView` APPLIES.
  for (const { id, tempo } of WALK_SPEEDS) {
    store.clear();
    store.set(WALK_SPEED_KEY, JSON.stringify({ id }));
    const el = fakeCube();
    applyCubeView(el);
    assert.equal(Number(el.getAttribute('tempo-scale')), tempo, `${id} did not reach a cube`);
  }
});

test('a stored speed nobody ships falls back to the default, never to the renderer\'s', () => {
  // localStorage is untrusted input, and the failure here is invisible: an unknown id reaching
  // `setAttribute` makes the renderer fall back to 190ms, which is the bug this file is about.
  for (const hostile of ['turbo', '', null, 7, {}, [], 'NORMAL']) {
    store.clear();
    store.set(WALK_SPEED_KEY, JSON.stringify({ id: hostile }));
    const el = fakeCube();
    applyCubeView(el);
    const got = Number(el.getAttribute('tempo-scale'));
    assert.equal(got, tempoFor(DEFAULT_WALK_SPEED), `id ${JSON.stringify(hostile)} did not take the default`);
    assert.ok(turnMs(got) >= 760, `id ${JSON.stringify(hostile)} produced a ${Math.round(turnMs(got))}ms turn`);
  }
  // And a record that is not an object at all.
  store.clear();
  store.set(WALK_SPEED_KEY, 'null');
  const el = fakeCube();
  applyCubeView(el);
  assert.equal(Number(el.getAttribute('tempo-scale')), tempoFor(DEFAULT_WALK_SPEED), 'a corrupt record lost the tempo');
});

test('the tempo numbers live in ONE module, and no screen keeps a copy', () => {
  // THE RELATION, not a list of screens. A second copy is how this defect returns: the menu had
  // the only copy, and the only cube it was written to was the menu's own.
  const owner = 'lib/cube-view.js';
  const shipped = WALK_SPEEDS.map((o) => o.tempo);
  // EVERY module, not a list of the ones that drew a cube when this was written: a hand list named three
  // files that no longer exist, and would have said nothing about a fourth that started drawing one.
  // A number is matched whole, so `0.12` is not `0.1`. `sound.js` is the one exemption — `0.1` is a note's
  // start in seconds there — and it holds only while the module touches no cube at all.
  const EXEMPT = {
    'lib/sound.js': 'a note starts 0.1 s in; nothing in it reaches a cube',
    'lib/contrast.js': 'its 0.05 is WCAG\'s flare term in a contrast ratio; nothing in it reaches a cube',
  };
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const spelled = (src, tempo) => new RegExp(`(?<![\\d.])${String(tempo).replace('.', '\\.')}(?!\\d)`).test(src);
  const suspects = [...APP_SOURCES, ...LIBRARY_SOURCES].filter((rel) => rel !== owner);
  assert.ok(suspects.length > 50, `the sweep read ${suspects.length} modules — the list it is built from is empty`);
  for (const rel of suspects) {
    const raw = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    if (EXEMPT[rel]) {
      assert.doesNotMatch(raw, /tempo|cubus-cube|applyCubeView/, `${rel} is exempt because it draws no cube (${EXEMPT[rel]}), and it now touches one`);
      continue;
    }
    const src = strip(raw);
    for (const tempo of shipped) {
      assert.ok(!spelled(src, tempo), `${rel} spells the tempo ${tempo} itself; the numbers belong to ${owner} alone`);
    }
  }
  // And the owner really does hold them, so the sweep above is not passing on an empty set.
  const own = readFileSync(new URL(`../${owner}`, import.meta.url), 'utf8');
  for (const tempo of shipped) assert.ok(own.includes(String(tempo)), `${owner} does not hold ${tempo}`);
});

// A WHOLE-CUBE TURN AT THE WALK'S PACE (dev-docs/lesson-holds-plan.md item 1.1). `turnTo` defaulted to a
// flat 400ms whatever the speed, so at Normal — 1,900ms a face quarter turn — the tumble, the biggest turn
// in the solve and the one ADR 0003 exists to show, was the fastest thing on the screen. The DURATION is the
// renderer's (`pace: 'tempo'`, one rule with its face turns, from the pose it actually starts at) and is
// measured in `test/browser/hold-turn.test.mjs`; what is pinned here is that the app ASKS for it.
const { createHoldCube } = await import('../lib/hold-presenter.js');

test('the hold presenter asks the renderer to turn at the walk\'s pace', () => {
  const asked = [];
  const el = fakeCube();
  el.dataset = {};
  el.turnTo = (up, front, opts) => { asked.push({ to: `${up} ${front}`, opts }); return Promise.resolve(true); };
  const holdCube = createHoldCube({ cube: el, isStale: () => false });
  holdCube(['U', 'F']);
  holdCube(['D', 'B']);
  assert.equal(asked.at(-1).to, 'D B');
  assert.deepEqual(asked.at(-1).opts, { pace: 'tempo' }, 'the tumble did not ask for the walk\'s pace');
});

test('nothing in the app turns a whole cube without saying how long it takes', () => {
  // THE RELATION, not a list of callers: every `.turnTo(` in the app's sources passes a duration or the
  // walk's pace, so a new caller cannot quietly fall back to the renderer's 400ms.
  let calls = 0;
  for (const rel of [...APP_SOURCES, ...LIBRARY_SOURCES]) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\.turnTo\(([^;]*?)\)\s*[;.]/g)) {
      calls++;
      assert.match(m[1], /\bms\b|\bpace\b/, `${rel}: \`.turnTo(${m[1]})\` names no duration, so it turns at the renderer's flat 400ms`);
    }
  }
  assert.ok(calls >= 3, `found ${calls} turnTo calls; the sweep is reading nothing`);
});
