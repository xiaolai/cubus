// The point of owning the solver is to be able to ask for a solution LENGTH. If that knob
// ever stops working, the app keeps running on the engine's stock bounds and every target is
// silently ignored — the solver still returns solutions, they are just never the ones that
// were asked for. So these run against the real engine (lib/two-phase.js), not a fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

import {
  LOOSEST_BOUND, VIEW_COUNT, createSolver,
} from '../lib/solver-engine.js';
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

/**
 * Ask, and escalate on a refusal — the same rule solve-target applies to a promised target, and
 * for the same reason: God's number is 20, so a solution under either bound tested here always
 * EXISTS, and null can only ever mean the budget was too small. Asserting non-null at one fixed
 * budget was therefore a coin toss with good odds, and it came up tails on 2026-08-30 (`no
 * solution under 21 for LBFFUDBLL…`) after passing for as long as it had existed. A rare
 * failure is still a wrong claim about the engine, and raising the budget until it stops
 * happening would only lengthen the odds.
 */
function solveOrEscalate(facelets, solLen) {
  let probeMax = 50_000_000;
  for (let attempt = 0; attempt <= 8; attempt++) {
    const alg = solve(facelets, { solLen, probeMax });
    if (alg !== null) return { alg, attempt };
    probeMax *= 2;
  }
  return { alg: null, attempt: 9 };
}

test('asking for a length actually bounds the answer', () => {
  for (let i = 0; i < 8; i++) {
    const facelets = Cube.random().asString();
    for (const solLen of [LOOSEST_BOUND, 21]) {
      const { alg } = solveOrEscalate(facelets, solLen);
      assert.ok(alg, `no solution under ${solLen} for ${facelets}, even at 256x the budget`);
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

/**
 * FIXED cubes, not `Cube.random()`, because this runs in a release gate.
 *
 * It drew four fresh states per run, and on 2026-09-03 one of them exhausted eight escalations —
 * 12.8 BILLION nodes, 285 s — and failed the v0.2.3 release. The same commit had passed the push
 * CI minutes earlier on a different draw. A gate that is a lottery is not a gate: it fails
 * releases for reasons unrelated to the release, and the failure it reported could not be
 * reproduced because the state was never printed.
 *
 * Measured here first, so the cost of the gate is known rather than hoped: 4.9-6.8 s each on a
 * developer Mac, 18-19 moves. Two-phase is deterministic on a fixed state, so those numbers hold
 * on any machine (the budget is counted in search NODES, not seconds).
 *
 * WHAT THIS NO LONGER COVERS, said plainly rather than left to be assumed: the engine's TAIL. A
 * state needing more than 12.8e9 nodes demonstrably exists — CI found one — and a fixed set of
 * four will never meet it again. Establishing how rare that is, and whether it is a pathological
 * state or an engine defect, is soak work on a machine nobody is waiting for; 190 random states
 * were run by hand while investigating and none exceeded 13 s, so it is rarer than 1 in 190 and
 * that is the whole of what is currently known. It is NOT known to be harmless.
 */
const CONTRACT_CUBES = Object.freeze([
  // 18 moves, 5799 ms
  'RFBDULDFURBLURUBDFLUFDFBRBRDDDBDLLUUUFFFLRBRFURBRBLLLD',
  // 19 moves, 5897 ms
  'UUBFUFLRBDUULRBBRUBDRDFUFDDRBLUDBFRLRDULLLLRDRBFLBFFFD',
  // 18 moves, 6845 ms
  'DFBBUFUUFLULFRDDBRRBULFDLULFRBFDRRLFRDFULBBLDURBRBLDDU',
  // 18 moves, 4918 ms
  'RUDRULLFFDBLDRBUDUBLLDFLDULFLFDDBBUFBUURLFURRBFDRBFRBR',
]);

test('the real solver honours the contract solve-target.js assumes', async () => {
  // The unit tests for solve-target.js use a scripted fake, which can only prove the module
  // handles a contract. This proves the real engine actually has it: every improvement is
  // strictly shorter, the target is met when reachable, and the answers solve the cube.
  // 200M nodes, not the app's 50M default: the met assertion needs reachability headroom —
  // a rare hard state can exhaust a single 50M attempt at the 21 -> 20 rung.
  const asyncSolve = async (facelets, options) => solve(facelets, { ...options, probeMax: 200_000_000 });
  for (const facelets of CONTRACT_CUBES) {
    // THE STATE GOES IN EVERY MESSAGE. It is fixed now, so this is belt rather than brace — but
    // when this failed a release gate the report said only that the budget ran out, not on which
    // of 43 quintillion cubes, and there was nothing to re-run and nothing to bisect. Any future
    // failure names its cube, whether the set stays fixed or someone widens it again.
    const on = ` cube=${facelets}`;
    let previous = Infinity;
    let last = null;
    try {
      for await (const step of refine(facelets, { solve: asyncSolve, tier: 'twenty' })) {
        const improved = step.moves < previous || (step.moves === previous && step.stopped !== null);
        assert.ok(improved, `${previous} -> ${step.moves} (stopped=${step.stopped})${on}`);
        previous = step.moves;
        last = step;
        const oracle = Cube.fromString(facelets);
        oracle.move(step.alg);
        assert.ok(oracle.isSolved(), `every answer shown must solve the cube${on}`);
      }
    } catch (cause) {
      // `refine` RAISES when it runs out of budget rather than returning unmet, so the state has
      // to be attached here too or an exhausted search is the one failure that stays anonymous.
      throw new Error(`refine failed on a contract fixture.${on}`, { cause });
    }
    assert.equal(last.met, true, `<= 20 is reachable on every cube — see solver-move-count.md${on}`);
    assert.ok(last.moves <= 20, `${last.moves} moves${on}`);
  }
});

test('a solved cube needs no moves and does not confuse the bound check', () => {
  const alg = solve(new Cube().asString(), { solLen: LOOSEST_BOUND, probeMax: 100_000 });
  assert.equal(alg, '', 'a solved cube has an empty solution, not a null one');
});

test('an easy cube gets its real answer, not the tier ceiling', async () => {
  // The complaint that forced the free descent: a cube seven turns from solved was answered
  // with a target-length solution because the search stopped at the target. The engine is
  // deterministic on a fixed state, so this is exact: seven turns in, at most seven out.
  const easy = new Cube();
  easy.move('R U F D L B R');
  const asyncSolve = async (facelets, options) => solve(facelets, { ...options });
  let last = null;
  for await (const step of refine(easy.asString(), { solve: asyncSolve, tier: 'twenty' })) last = step;
  assert.ok(last.moves <= 7, `seven turns from solved, answered with ${last.moves} moves`);
  assert.equal(last.met, true);
  const oracle = Cube.fromString(easy.asString());
  oracle.move(last.alg);
  assert.ok(oracle.isSolved());
});

test('the view count the callers read is the one the engine actually has', async () => {
  // solver-engine declares VIEW_COUNT so app.js and solve-client.js can size and slice a worker
  // pool without importing the engine into the main bundle. That makes it a second copy, and a
  // second copy is only safe while it cannot drift — this is what stops it. A mismatch would
  // leave views unsearched (too low) or produce filters the engine rejects (too high).
  const engine = await import('../lib/two-phase.js');
  assert.equal(VIEW_COUNT, engine.VIEW_COUNT);
});

test('a view filter is checked BEFORE the bounds are committed', async () => {
  // setBounds mutates persistent engine state, and this wrapper's rule is validate-first,
  // commit-together. A filter validated after it would leave the bounds moved behind a throw.
  let boundsSet = 0;
  const solve = createSolver({
    initialize() {},
    setBounds() { boundsSet += 1; },
    solvePattern: () => '',
    VIEW_COUNT: 6,
  });
  const facelets = new Cube().asString();
  for (const bad of [[], [6], [-1], [1.5], [0, 0], 'nope', 3]) {
    assert.throws(() => solve(facelets, { views: bad }), RangeError, JSON.stringify(bad));
  }
  assert.equal(boundsSet, 0, 'a rejected filter must not have moved the bounds');
  assert.doesNotThrow(() => solve(facelets, { views: [0, 5] }));
  assert.equal(boundsSet, 1);
});

test('the slice reaches the engine, exactly as given', async () => {
  // Dropping this argument would leave every other test green while every pooled worker
  // searched all six views with a fraction of the budget — slower than one worker, and silent.
  const seen = [];
  const solve = createSolver({
    initialize() {},
    setBounds() {},
    solvePattern: (_f, views) => { seen.push(views); return ''; },
    VIEW_COUNT: 6,
  });
  const facelets = new Cube().asString();
  solve(facelets, { views: [1, 4] });
  solve(facelets);
  assert.deepEqual(seen, [[1, 4], null], 'the second call must pass null, not undefined');
});
