// The point of owning the solver is to be able to ask for a solution LENGTH. If that knob
// ever stops working, the app keeps running on the engine's stock bounds and every target is
// silently ignored — the solver still returns solutions, they are just never the ones that
// were asked for. So these run against the real engine (lib/two-phase.js), not a fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

import { LOOSEST_BOUND, createSolver } from '../lib/solver-engine.js';
import { refine } from '../lib/solve-target.js';
import * as engine from '../lib/two-phase.js';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
Cube.initSolver();

const solve = createSolver(engine);
const movesIn = (alg) => alg.trim().split(/\s+/).length;

test('the engine exposes the bounds surface the wrapper drives', () => {
  for (const fn of ['initialize', 'solvePattern', 'setBounds']) {
    assert.equal(typeof engine[fn], 'function', `lib/two-phase.js has no ${fn}()`);
  }
});

test('a module without setBounds is refused rather than silently unbounded', () => {
  // This is the failure the whole file exists to catch: an engine module with no way to bound
  // it. Accepting it would mean every target is ignored.
  assert.throws(() => createSolver({ initialize() {}, solvePattern() {} }),
    /has no setBounds\(\).*would be ignored/s);
  assert.throws(() => createSolver(null), TypeError);
});

test('asking for a length actually bounds the answer', () => {
  for (let i = 0; i < 8; i++) {
    const facelets = Cube.random().asString();
    for (const solLen of [LOOSEST_BOUND, 21]) {
      const alg = solve(facelets, { solLen, probeMax: 50_000_000 });
      assert.ok(alg, `no solution under ${solLen} for ${facelets}`);
      assert.ok(movesIn(alg) < solLen, `asked for < ${solLen}, got ${movesIn(alg)}`);
      // cubejs is the oracle, exactly as it is for the two-phase path in app.js.
      const oracle = Cube.fromString(facelets);
      oracle.move(alg);
      assert.ok(oracle.isSolved(), 'the bounded solution must still solve the cube');
    }
  }
});

test('a budget it cannot meet returns null, not an error string and not junk', () => {
  // Sixteen moves inside one search node: unreachable. The engine says null, and the adapter
  // guarantees no caller ever sees anything else — not an error string, not junk.
  const facelets = Cube.random().asString();
  const answer = solve(facelets, { solLen: 16, probeMax: 1 });
  assert.equal(answer, null);
});

test('a facelet string that is not one is refused at the boundary', () => {
  assert.throws(() => solve('too short'), TypeError);
  assert.throws(() => solve(null), TypeError);
  assert.throws(() => solve(new Cube().asString(), { solLen: 99 }), RangeError);
  assert.throws(() => solve(new Cube().asString(), { solLen: 0 }), RangeError);
});

test('a budget that is not a positive integer is refused, never searched with', () => {
  // NaN survives every < comparison, so an unvalidated NaN budget would defeat the engine's
  // decrement-based termination check and search forever. Refused at the boundary instead.
  const facelets = new Cube().asString();
  for (const probeMax of [Number.NaN, Number.POSITIVE_INFINITY, -5, 1.5, 0, '1000']) {
    assert.throws(() => solve(facelets, { solLen: 21, probeMax }), RangeError, String(probeMax));
  }
});

test('an omitted budget is the named default, never a previous call leftover', () => {
  // The engine's setBounds is a partial update whose values persist — this is the regression
  // that once made an omitted-budget solve inherit a one-node budget and return null.
  const facelets = Cube.random().asString();
  assert.equal(solve(facelets, { solLen: 16, probeMax: 1 }), null, 'one node cannot find 15 moves');
  const answer = solve(facelets, { solLen: LOOSEST_BOUND });
  assert.ok(answer, 'the default budget must solve at the loosest bound');
});

test('solLen 1 asks for a zero-move solution and gets exactly that or null', () => {
  assert.equal(solve(new Cube().asString(), { solLen: 1, probeMax: 1000 }), '',
    'a solved cube has the zero-move solution');
  const oneAway = new Cube();
  oneAway.move('R');
  assert.equal(solve(oneAway.asString(), { solLen: 1, probeMax: 1000 }), null,
    'an unsolved cube has no zero-move solution');
});

test('the shortest tier survives a state one move from solved', async () => {
  // The regression: refine at the shortest tier descends to solLen 1 after finding a one-move
  // solution, and the boundary used to reject 1 with a RangeError — a crash for a learner one
  // turn from done.
  const oneAway = new Cube();
  oneAway.move("F'");
  const asyncSolve = async (facelets, options) => solve(facelets, { ...options, probeMax: 1_000_000 });
  let last = null;
  for await (const step of refine(oneAway.asString(), { solve: asyncSolve, tier: 'shortest' })) last = step;
  assert.equal(last.moves, 1, 'the one-move solution stands');
  assert.equal(last.alg, 'F');
});

test('an engine that returns something other than a string or null is refused loudly', () => {
  const fake = (answer) =>
    createSolver({ initialize() {}, setBounds() {}, solvePattern: () => answer });
  const facelets = new Cube().asString();
  for (const bad of [42, undefined, {}, Promise.resolve('R U')]) {
    assert.throws(() => fake(bad)(facelets), TypeError, String(bad));
  }
  assert.equal(fake(null)(facelets), null, 'null stays the no-answer answer');
});

test('an answer that is not made of face turns is refused, not passed to a screen', () => {
  // The boundary validates the GRAMMAR; whether the moves solve the cube stays with the cubejs
  // oracle at the display boundary — the worker must not carry a second cube implementation.
  const fake = (answer) =>
    createSolver({ initialize() {}, setBounds() {}, solvePattern: () => answer });
  const facelets = new Cube().asString();
  for (const bad of ['NOT_A_MOVE', "R U x", 'R2 U3', "M'"]) {
    assert.throws(() => fake(bad)(facelets), /not a face turn/, bad);
  }
  assert.equal(fake("R U2 F'")(facelets), "R U2 F'", 'real face turns pass through');
});

test('the real solver honours the contract solve-target.js assumes', async () => {
  // The unit tests for solve-target.js use a scripted fake, which can only prove the module
  // handles a contract. This proves the real engine actually has it: every improvement is
  // strictly shorter, the target is met when reachable, and the answers solve the cube.
  // 200M nodes, not the app's 50M default: the met assertion needs reachability headroom —
  // a rare hard state can exhaust a single 50M attempt at the 21 -> 20 rung.
  const asyncSolve = async (facelets, options) => solve(facelets, { ...options, probeMax: 200_000_000 });
  for (let i = 0; i < 4; i++) {
    const facelets = Cube.random().asString();
    let previous = Infinity;
    let last = null;
    for await (const step of refine(facelets, { solve: asyncSolve, tier: 'twenty' })) {
      const improved = step.moves < previous || (step.moves === previous && step.stopped !== null);
      assert.ok(improved, `${previous} -> ${step.moves} (stopped=${step.stopped})`);
      previous = step.moves;
      last = step;
      const oracle = Cube.fromString(facelets);
      oracle.move(step.alg);
      assert.ok(oracle.isSolved(), 'every answer shown must solve the cube');
    }
    assert.equal(last.met, true, '<= 20 is reachable on every cube — see solver-move-count.md');
    assert.ok(last.moves <= 20);
  }
});

test('a solved cube needs no moves and does not confuse the bound check', () => {
  const alg = solve(new Cube().asString(), { solLen: LOOSEST_BOUND, probeMax: 100_000 });
  assert.equal(alg, '', 'a solved cube has an empty solution, not a null one');
});
