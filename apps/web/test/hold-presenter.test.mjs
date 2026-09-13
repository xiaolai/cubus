// The walk's hold and the renderer's turn — lib/hold-presenter.js, ADR 0003.
//
// Split out of the cube screen's mount after a mini audit of the branch (2026-09-13) found two
// things its position hid: the overshoot rule stated one way in a comment and another in the code,
// and the renderer-upgrade path — holds asked for before `<cubus-cube>` is a renderer — reached by no
// test. Every case here is a way either can go wrong while the screen still looks right.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromCube } from '../lib/cube-pieces.js';
import { createHoldCube, holdAtMove, holdChangeAt, walkHoldFor } from '../lib/hold-presenter.js';
import { moveStepIndex } from '../lib/method-lesson.js';
import { methodFor, solveByMethod } from '../lib/method-solver.js';
import { SCAN_HOLD, TUMBLED, holdSentence, toMethodFrame } from '../lib/solving-hold.js';
import { targetById } from '../lib/stage-targets.js';
import Cube from '../vendor/cubejs.js';
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const spec = (h) => h.join(' ');

test('a walk that is not a lesson is held the way its route says — and an overshoot keeps the target\'s hold', () => {
  const twoLayers = targetById('two-layers');
  const route = (extra = {}) => ({ kind: 'exact', alg: "R U R'", moves: 3, minimal: true, overshoot: false, ...extra });

  assert.equal(spec(walkHoldFor(null, null)), 'U F', 'the whole cube is held as scanned');
  assert.equal(spec(walkHoldFor(route(), null)), 'U F', 'no target, whatever the route');
  assert.equal(spec(walkHoldFor(null, twoLayers)), 'U F', 'a target with no route yet');
  assert.equal(spec(walkHoldFor(route({ kind: 'none', alg: null, moves: null }), twoLayers)), 'U F',
    'a route that found nothing leaves the whole-cube walk on screen, held as scanned');
  assert.equal(spec(walkHoldFor(route(), twoLayers)), 'D B', 'a repair is held the way its target is built');
  // THE CASE THE AUDIT FOUND AMBIGUOUS, decided and pinned: the child aimed at a stage they reach
  // after turning the cube over, so that is how it is in their hands, and a fallback that runs on to
  // the whole cube does not turn it back.
  assert.equal(spec(walkHoldFor(route({ kind: 'fallback', minimal: false, overshoot: true }), twoLayers)), 'D B',
    'an overshoot keeps the target\'s hold');
  assert.equal(spec(walkHoldFor(route({ alg: '', moves: 0 }), twoLayers)), 'D B', 'already there is held for the target too');
  assert.equal(spec(walkHoldFor(route(), targetById('cross'))), 'U F', 'the cross is built white up');
});

test('a lesson is held per move, turns over once after the first layer, and says so on that move alone', () => {
  const scan = Cube.fromString(SOLVED);
  scan.move(randomAlg(lcg(1), 25));
  const { steps } = solveByMethod(fromCube(Cube.fromString(toMethodFrame(scan.asString()))), methodFor());
  const lesson = { steps, moveStep: moveStepIndex(steps) };
  const total = lesson.moveStep.length;
  assert.ok(total > 0, 'precondition: a lesson with moves');

  const held = Array.from({ length: total + 1 }, (_, k) => spec(holdAtMove(lesson, SCAN_HOLD, k)));
  const flip = held.indexOf('D B');
  assert.ok(flip > 0, 'the lesson turns the cube over at some move');
  assert.ok(held.slice(0, flip).every((h) => h === 'U F'), 'every move before it is white up');
  assert.ok(held.slice(flip).every((h) => h === 'D B'), 'and every move from it on, turned over — once, never back');
  assert.equal(steps[lesson.moveStep[flip]].stage, 'middle-layer', 'the default rungs turn over when the first layer is done');
  assert.equal(held[total], 'D B', 'past the last move, the last step\'s hold stays');

  for (let i = 0; i <= total; i++) {
    assert.equal(holdChangeAt(lesson, SCAN_HOLD, i).say, i === flip ? holdSentence(TUMBLED) : '',
      `head ${i}: only the move that begins a hold says how to hold the cube`);
  }
  assert.equal(spec(holdAtMove(null, TUMBLED, 3)), 'D B', 'with no lesson, the walk\'s own hold holds throughout');
  assert.equal(holdChangeAt(null, TUMBLED, 3).say, '', 'and never changes');
});

/** A renderer that records what it was asked to do, and refuses to be given a pose attribute. */
function renderer({ upgraded = true } = {}) {
  const turns = [];
  const el = {
    dataset: {},
    setAttribute(name) { throw new Error(`no attribute may name a pose — got "${name}"`); },
  };
  const upgrade = () => { el.turnTo = (up, front) => { turns.push(`${up} ${front}`); return Promise.resolve(true); }; };
  if (upgraded) upgrade();
  return { el, turns, upgrade };
}

/** A custom-element registry whose definition arrives when the test says so. */
function registry() {
  let define;
  const defined = new Promise((resolve) => { define = resolve; });
  return { whenDefined: () => defined, define: () => define() };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

test('a renderer is turned at once, and asked again only when the hold actually changes', () => {
  const { el, turns } = renderer();
  const holdCube = createHoldCube({ cube: el, isStale: () => false, registry: registry() });
  holdCube(TUMBLED);
  holdCube(TUMBLED);
  holdCube(SCAN_HOLD);
  assert.deepEqual(turns, ['D B', 'U F'], 'the same hold twice is one turn');
  assert.equal(el.dataset.hold, 'U F', 'and data-hold says what was last asked for');
});

test('before the renderer exists, only the LAST hold asked for is applied when it arrives', async () => {
  const { el, turns, upgrade } = renderer({ upgraded: false });
  const reg = registry();
  const holdCube = createHoldCube({ cube: el, isStale: () => false, registry: reg });
  holdCube(TUMBLED);
  holdCube(SCAN_HOLD);
  holdCube(TUMBLED);
  assert.equal(el.dataset.hold, 'D B', 'what was asked for is recorded at once');
  assert.deepEqual(turns, [], 'and nothing is turned while there is nothing to turn');

  upgrade();
  reg.define();
  await flush();
  assert.deepEqual(turns, ['D B'], 'three holds asked for before the upgrade turn the cube ONCE, to the last');

  holdCube(SCAN_HOLD);
  assert.deepEqual(turns, ['D B', 'U F'], 'and once it is a renderer, a hold turns it at once');
});

test('a hold that waited for the renderer does nothing on a screen that has been replaced', async () => {
  const { el, turns, upgrade } = renderer({ upgraded: false });
  const reg = registry();
  let stale = false;
  const holdCube = createHoldCube({ cube: el, isStale: () => stale, registry: reg });
  holdCube(TUMBLED);
  stale = true; // the screen was left before the bundle arrived — the element may be parked for another
  upgrade();
  reg.define();
  await flush();
  assert.deepEqual(turns, [], 'a parked cube belongs to the next screen, and must not be turned for this one');
});
