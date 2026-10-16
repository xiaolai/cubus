// The course's last-layer route (ADR 0009), walked: where it stops, that its stops nest, that it solves,
// and that each of its captions says what its step did.
//
// The route's completeness over all 62,208 last-layer states is the bench's to prove
// (`method-solver-profile.mjs exhaustive course course`, a nightly CI shard). This file holds what a
// sample CAN hold — the relation between the walk and the Restore row — on cubes cubejs grades.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CORNER, EDGE, SOLVED, allSolved, applyAlg } from '../lib/cube-pieces.js';
import * as eng from '../lib/methods/engine.js';
import { __testing, allMethods, methodFor, solveByMethod } from '../lib/method-solver.js';
import { NESTING, targetById } from '../lib/stage-targets.js';
import { BEGINNER_ENTRY } from '../lib/methods/registry.js';

/**
 * Which chips each last-layer route's walk STOPS at. The course's are the Beginner entry's declared stops
 * (ADR 0011). The app's route orients the whole top before it permutes anything, so it passes neither
 * `top-edges` nor `corners-home`: written here as what this file holds that library route to, until a
 * CFOP entry declares it as its own stops.
 */
const ROUTE_STOPS = Object.freeze({
  course: BEGINNER_ENTRY.stops,
  app: Object.freeze(['cross', 'first-layer', 'two-layers', 'top-cross', 'solved']),
});
import { seededStates } from './fixtures/seeded-scrambles.mjs';
import { turnsOf } from './fixtures/method-replay.mjs';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;

const COURSE = methodFor(undefined, { lastLayer: 'course' });
const APP = methodFor();

/**
 * Which chip each fine stage ENDS at, per route, written from the stage names and not from the targets.
 * The course reaches lesson 14's end after `edges-home` and lesson 15's after `top-corners`; the app's
 * `top-corners` places its corners over a top whose edges are still anywhere, so on that route it ends at
 * no chip, and nor does `top-face`, the top made one colour.
 */
const FIRST_TWO = { cross: 'cross', 'first-layer': 'first-layer', 'middle-layer': 'two-layers', 'top-cross': 'top-cross' };
const CHIP_AT_END_OF = {
  course: { ...FIRST_TWO, 'edges-home': 'top-edges', 'top-corners': 'corners-home', 'corners-turned': 'solved' },
  app: { ...FIRST_TWO, 'top-face': null, 'top-corners': null, 'top-edges': 'solved' },
};

/** Each run of one fine stage in a solve, and the cube when it ends. */
function stageEnds(state, steps) {
  const ends = [];
  let s = state;
  for (const [i, step] of steps.entries()) {
    s = applyAlg(s, turnsOf(step));
    if (steps[i + 1]?.stage !== step.stage) ends.push({ stage: step.stage, cube: s });
  }
  return ends;
}

/** cubejs grades the alg, a different implementation from the one that wrote it. */
function cubejsSolves(state, alg) {
  const c = new Cube();
  Object.assign(c, { cp: [...state.cp], co: [...state.co], ep: [...state.ep], eo: [...state.eo] });
  c.move(alg);
  return c.isSolved();
}

const SAMPLE = seededStates(40, 0xc0_75e);

test('the course\'s stops are its chips, in the Restore row\'s order, and each is where a stage ends', () => {
  assert.deepEqual(ROUTE_STOPS.course, NESTING, 'the course passes through every chip in the row');
  let ended = 0;
  for (const [n, state] of SAMPLE.entries()) {
    const { steps } = solveByMethod(state, COURSE);
    const ends = stageEnds(state, steps);
    let reached = -1;
    for (const { stage, cube } of ends) {
      const chip = CHIP_AT_END_OF.course[stage];
      assert.ok(chip, `cube ${n}: the course ended a stage "${stage}" that is no chip`);
      assert.ok(ROUTE_STOPS.course.includes(chip), `cube ${n}: ${stage} ends at ${chip}, which is not a course stop`);
      // The stop is REAL: the chip's own independent predicate holds on the cube the stage left.
      assert.ok(targetById(chip).verify(cube), `cube ${n}: ${stage} ended short of the "${chip}" chip`);
      const at = ROUTE_STOPS.course.indexOf(chip);
      assert.ok(at > reached, `cube ${n}: the walk stopped at ${chip} after a later chip`);
      // A chip passed over with no stage of its own must have held already — never be skipped unreached.
      for (const skipped of ROUTE_STOPS.course.slice(reached + 1, at)) {
        assert.ok(targetById(skipped).verify(cube), `cube ${n}: the walk passed ${skipped} without reaching it`);
      }
      reached = at;
      ended += 1;
    }
    // A last stage with nothing to do has no steps: the chips after the final stop must hold already.
    const last = ends.at(-1).cube;
    for (const after of ROUTE_STOPS.course.slice(reached + 1)) {
      assert.ok(targetById(after).verify(last), `cube ${n}: the walk ended short of ${after}`);
    }
  }
  assert.ok(ended >= SAMPLE.length * 6, `only ${ended} stage ends in ${SAMPLE.length} solves — the sample is not walking the route`);
});

test('the app\'s route stops at no course-only chip, and still walks its own stops in order', () => {
  for (const [n, state] of SAMPLE.slice(0, 15).entries()) {
    const ends = stageEnds(state, solveByMethod(state, APP).steps);
    const chips = ends.map((e) => {
      assert.ok(Object.hasOwn(CHIP_AT_END_OF.app, e.stage), `cube ${n}: the app's route ended an unknown stage "${e.stage}"`);
      return CHIP_AT_END_OF.app[e.stage];
    }).filter((c) => c !== null);
    for (const chip of chips) {
      assert.ok(ROUTE_STOPS.app.includes(chip), `cube ${n}: the app's route stopped at "${chip}", which it claims not to`);
    }
    const order = chips.map((c) => ROUTE_STOPS.app.indexOf(c));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `cube ${n}: the app's stops are out of order`);
  }
});

test('along the course\'s walk, a stop once reached holds at every later stage end', () => {
  // Monotonic per route, at the moments a stop is SHOWN — stage ends. Inside the corner twists the first
  // two layers come apart and come back, and the next case holds that; between stages nothing may undo.
  for (const [n, state] of SAMPLE.entries()) {
    const ends = stageEnds(state, solveByMethod(state, COURSE).steps);
    const held = new Set();
    for (const { stage, cube } of ends) {
      for (const chip of held) {
        assert.ok(targetById(chip).verify(cube), `cube ${n}: ${stage} undid the "${chip}" chip`);
      }
      for (const chip of ROUTE_STOPS.course) if (targetById(chip).verify(cube)) held.add(chip);
    }
  }
});

test('the corner twists take the first two layers apart, and give them back by the stage\'s end', () => {
  // The ONE allowance `method-composition` and `method-solver` make, shown to be needed and to close: a
  // sample in which it never fired would leave both tests carrying an exemption for nothing.
  let torn = 0;
  for (const state of SAMPLE) {
    const { steps } = solveByMethod(state, COURSE);
    let s = state;
    for (const [i, step] of steps.entries()) {
      s = applyAlg(s, turnsOf(step));
      if (step.stage !== 'corners-turned') continue;
      if (!eng.firstTwoLayers(s)) {
        torn += 1;
        assert.equal(steps[i + 1]?.stage, 'corners-turned', 'a twist left the layers apart with no twist after it to mend them');
      }
    }
    assert.ok(eng.wholeCubeSolved(s));
  }
  assert.ok(torn > 0, 'no twist in the sample took the layers apart — the allowance is untested');
});

test(`the course solves every cube of ${SAMPLE.length}, at every cross and pairs rung, and cubejs agrees`, () => {
  const courses = allMethods().filter((m) => m.lastLayer === 'course');
  assert.equal(courses.length, 6, 'the course\'s route at every cross and pairs rung');
  for (const method of courses) {
    for (const [n, state] of SAMPLE.entries()) {
      const { alg } = solveByMethod(state, method);
      assert.ok(cubejsSolves(state, alg), `${method.id}, cube ${n}: cubejs says the alg does not solve it`);
    }
  }
});

/** What each of the course's captions CLAIMS, as a predicate on the cube after its step. */
const U_EDGES = [EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB];
const U_CORNERS = [CORNER.URF, CORNER.UFL, CORNER.ULB, CORNER.UBR];
const CLAIM = {
  'topEdges.place': (s) => allSolved(s, { edges: U_EDGES }),
  'topCorners.place': (s) => allSolved(s, { edges: U_EDGES }) && U_CORNERS.every((c) => s.cp[c] === c),
  // Every corner up, so a turn of the top is all that is left — the lesson's own ending.
  'topCorners.twist': (s) => ['', 'U', 'U2', "U'"].some((u) => eng.wholeCubeSolved(applyAlg(s, u))),
};

test('each course caption says what its step did — a finishing one reached its goal, a `.step` did not', () => {
  const seen = new Set();
  for (const state of SAMPLE) {
    let s = state;
    for (const step of solveByMethod(state, COURSE).steps) {
      s = applyAlg(s, turnsOf(step));
      const key = step.why.key;
      const base = key.endsWith('.step') ? key.slice(0, -'.step'.length) : key;
      if (!CLAIM[base]) continue;
      seen.add(key);
      assert.equal(CLAIM[base](s), base === key,
        `${key}: ${base === key ? 'a finishing step did not reach' : 'a step said "not yet" over'} its goal`);
    }
  }
  for (const key of ['topEdges.place', 'topCorners.place', 'topCorners.twist', 'topCorners.twist.step']) {
    assert.ok(seen.has(key), `${key} never occurred in the sample — its check is untested`);
  }
});

test('the route is part of the method\'s id, so a lesson built for one is never served for the other', () => {
  assert.notEqual(COURSE.id, APP.id);
  assert.equal(COURSE.id, `${APP.id},course`);
  assert.throws(() => methodFor(undefined, { lastLayer: 'cfop' }), /unknown last-layer route/);
  // A solved cube needs nothing on either route.
  assert.deepEqual(solveByMethod(SOLVED, COURSE).steps, []);
});

test('each corner twist points at the ONE corner it turns, and says so when it turns the top to get there', () => {
  // Codex refute, 2026-10-14: read before the step's setup, a twist pointed at every twisted corner, and
  // "turn the corner at the front right" was said over a corner already facing up. Checked on the cube.
  let twists = 0;
  let withTurn = 0;
  for (const state of SAMPLE) {
    let s = state;
    for (const step of solveByMethod(state, COURSE).steps) {
      const before = s;
      s = applyAlg(s, turnsOf(step));
      if (!step.why.key.startsWith('topCorners.twist')) continue;
      twists += 1;
      const setup = /^U[2']?(?= )/.exec(step.alg)?.[0] ?? '';
      assert.equal(Boolean(step.why.topTurn), setup !== '', `"${step.alg}": the caption and the moves disagree about turning the top first`);
      if (setup) withTurn += 1;
      // In the HOLD the step is made in — white down — where its letters and its piece names both live.
      const asHeld = __testing.asHeld(before, step.hold);
      const held = setup ? applyAlg(asHeld, setup) : asHeld;
      assert.deepEqual(step.why.corners, [held.cp[CORNER.URF]], `"${step.alg}" points at ${step.why.corners}, not the corner it turns`);
      assert.notEqual(held.co[CORNER.URF], 0, `"${step.alg}" turns a corner that already faced up`);
    }
  }
  assert.ok(twists > 0 && withTurn > 0 && withTurn < twists, `the sample must twist with and without a turn of the top first (${withTurn} of ${twists})`);
});
