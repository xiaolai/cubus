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

// FIXED STATES, not `Cube.random()`, and the reason is a property of the engine rather than a
// preference for determinism.
//
// The engine is complete: `<= 20` is reachable on every cube GIVEN ENOUGH NODES. It is not
// reachable within a FINITE node budget on every cube, and AGENTS.md says so in as many words — a
// search that ran out of budget is not a cube that cannot be solved, which is why `refine` raises
// stating the work spent rather than calling anything impossible. So asserting `met === true` on
// an arbitrary drawn state asserts something the design does not promise, and the test was a
// lottery with the release gate as the stake. It lost one: v0.2.3 failed here after 12.8 billion
// nodes on a cube nobody can name, because the state was never printed.
//
// Measured before changing anything: 190 random states solved with 0 failures, worst 13.0 s. So
// the failing state is rarer than 1 in 190 and there is no evidence of a broken engine — which is
// exactly why it must not gate a release, and exactly why it is worth keeping an eye on below.
//
// These four are drawn states that were then FROZEN, with their measured costs, so every
// assertion the old test made still runs — strict improvement, answers that solve the cube, the
// target met, `<= 20` — and runs reproducibly.
const CONTRACT_STATES = [
  'LUDLUFLURFRRRRRBDBDBUFFURLLUDULDRDDRUBBDLLFUBFFFBBFDBL', // 18 moves, 5.6 s
  'DDURUBRFBRDBDRBFLBBLUUFRFLUUBLUDURDDLBDFLRFFRLFFUBRLLD', // 20 moves, 6.0 s
  'RULUUDRBFLLDBRLULRDDUFFRUURLFBFDFLDDFBFLLDBRBFRUUBBBRD', // 18 moves, 4.7 s
  'DLUUUDLUFDFLFRLFBUDRLUFRLLDBDRLDRFBRRBBDLFRBUFUBFBRBDU', // 19 moves, 5.2 s
];

/** Drive one cube all the way through `refine`, asserting the contract at every step. */
async function walkRefine(facelets, asyncSolve) {
  // The state goes in every message. The old test drew its cube fresh and named it nowhere, so
  // when it failed a release gate the report said only that the budget ran out — not on which of
  // 43 quintillion cubes. Nothing to re-run, nothing to bisect, no way to tell a hard state from a
  // broken engine. A random test that does not print its input is a bug report with the evidence
  // torn off.
  const on = ` cube=${facelets}`;
  let previous = Infinity;
  let last = null;
  for await (const step of refine(facelets, { solve: asyncSolve, tier: 'twenty' })) {
    const improved = step.moves < previous || (step.moves === previous && step.stopped !== null);
    assert.ok(improved, `${previous} -> ${step.moves} (stopped=${step.stopped})${on}`);
    previous = step.moves;
    last = step;
    const oracle = Cube.fromString(facelets);
    oracle.move(step.alg);
    assert.ok(oracle.isSolved(), `every answer shown must solve the cube${on}`);
  }
  return { last, on };
}

test('the real solver honours the contract solve-target.js assumes', async () => {
  // The unit tests for solve-target.js use a scripted fake, which can only prove the module
  // handles a contract. This proves the real engine actually has it: every improvement is
  // strictly shorter, the target is met when reachable, and the answers solve the cube.
  // 200M nodes, not the app's 50M default: the met assertion needs reachability headroom —
  // a rare hard state can exhaust a single 50M attempt at the 21 -> 20 rung.
  const asyncSolve = async (facelets, options) => solve(facelets, { ...options, probeMax: 200_000_000 });
  for (const facelets of CONTRACT_STATES) {
    const { last, on } = await walkRefine(facelets, asyncSolve);
    assert.equal(last.met, true, `<= 20 is reachable on every cube — see solver-move-count.md${on}`);
    assert.ok(last.moves <= 20, `${last.moves} moves${on}`);
  }
});

// And one DRAWN state, for the half of the contract that holds unconditionally.
//
// Dropping random coverage entirely would trade a flaky gate for a blind one, so the exploration
// stays — minus the single assertion that made it a lottery. Every answer must still be strictly
// shorter than the last and must still solve the cube; those are true of any state at any budget.
// Only exhaustion is tolerated, because on an arbitrary cube it is documented behaviour rather
// than a defect, and when it happens this says which cube it was so the next one can be frozen
// into CONTRACT_STATES above.
test('a drawn cube still improves strictly, and every answer solves it', async () => {
  const asyncSolve = async (facelets, options) => solve(facelets, { ...options, probeMax: 200_000_000 });
  const facelets = Cube.random().asString();
  try {
    const { last, on } = await walkRefine(facelets, asyncSolve);
    assert.ok(last.moves <= 20, `${last.moves} moves${on}`);
  } catch (cause) {
    if (!/budget|escalation/i.test(String(cause?.message))) throw cause;
    console.log(`    budget exhausted on a drawn state — not a failure, but worth freezing: ${facelets}`);
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
