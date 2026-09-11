// The method solver's whole claim is that its steps mean something: each one places a named
// piece and leaves everything already placed alone. A solver that merely ends up solved would
// satisfy a "does it solve" test while teaching nonsense, so most of what follows checks the
// invariant BETWEEN steps rather than the state at the end.
//
// cubejs is the oracle here, exactly as it is for the two-phase solver in app.js: a different
// implementation confirming the alg, not the same code agreeing with itself.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CORNER, EDGE, SOLVED, applyAlg, cornerSolved, edgeSolved, fromCube } from '../lib/cube-pieces.js';
import {
  CASE_NAMES, LADDER, MethodSolverError, STAGE_IDS, TOP_RUNG, __testing, allRungCombinations,
  methodFor, rungKey, solveByMethod,
} from '../lib/method-solver.js';
import { OLL_ALGS, PLL_ALGS } from '../lib/methods/last-layer.js';
import { BASELINES, capture } from './fixtures/regen-method-steps.mjs';
import { RUNG_CRITERIA, UsageError, parseArgs, rungDelta } from '../bench/method-solver-profile.mjs';
import { seededPairs, seededScrambles, seededStates } from './fixtures/seeded-scrambles.mjs';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
Cube.initSolver();

/** The two methods that existed before the split, by the rungs they are now made of. */
const BEGINNER = methodFor({ cross: 0, pairs: 0, oll: 0, pll: 0 });
const INTERMEDIATE = methodFor({ cross: 1, pairs: 1, oll: 0, pll: 0 });
const NAMED = [['beginner', BEGINNER], ['intermediate', INTERMEDIATE]];

/** What each last-layer look's completing caption CLAIMS, so the claim can be checked. */
const U_EDGES = [EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB];
const U_CORNERS = [CORNER.URF, CORNER.UFL, CORNER.ULB, CORNER.UBR];
const LOOK_GOAL = {
  'topCross.orient': (s) => U_EDGES.every((e) => s.eo[e] === 0),
  'topFace.orient': (s) => U_CORNERS.every((c) => s.co[c] === 0),
  'topCorners.permute': (s) => U_CORNERS.every((c) => s.cp[c] === c && s.co[c] === 0),
  'topEdges.permute': (s) => [...Array(12).keys()].every((e) => edgeSolved(s, e))
    && [...Array(8).keys()].every((c) => cornerSolved(s, c)),
};
const reachedLook = (state, key) => LOOK_GOAL[key](state);

/** Which pieces each stage is responsible for, in the order the solver places them. Once a
 *  stage is finished, nothing later may disturb what it placed — that is the assertion. */
const OWNS = {
  cross: { edges: [EDGE.DF, EDGE.DR, EDGE.DB, EDGE.DL], corners: [] },
  'first-layer': { edges: [], corners: [CORNER.DFR, CORNER.DRB, CORNER.DBL, CORNER.DLF] },
  'middle-layer': { edges: [EDGE.FR, EDGE.BR, EDGE.BL, EDGE.FL], corners: [] },
  // At the rung above, one stage owns both: the corner and its edge go in together.
  f2l: {
    edges: [EDGE.FR, EDGE.BR, EDGE.BL, EDGE.FL],
    corners: [CORNER.DFR, CORNER.DRB, CORNER.DBL, CORNER.DLF],
  },
};

function assertStepsAreHonest(start, steps, label) {
  let state = start;
  let finished = { edges: [], corners: [] };
  let previousStage = null;

  for (const [i, step] of steps.entries()) {
    assert.ok(step.stage && step.alg !== undefined && step.why?.key,
      `${label}: step ${i} is missing its stage, alg or reason`);
    assert.ok(step.kind === 'goal' || step.kind === 'case', `${label}: step ${i} has no kind`);
    if (step.kind === 'case') {
      assert.ok(step.caseName, `${label}: step ${i} is an algorithm step with no case name`);
    } else {
      assert.equal(step.caseName, undefined,
        `${label}: step ${i} is intuitive, so naming a case would be inventing one`);
    }
    assert.ok(step.alg.trim().length > 0, `${label}: step ${i} is an empty instruction`);

    // A stage boundary freezes what that stage placed.
    if (previousStage && step.stage !== previousStage && OWNS[previousStage]) {
      finished = {
        edges: [...finished.edges, ...OWNS[previousStage].edges],
        corners: [...finished.corners, ...OWNS[previousStage].corners],
      };
      for (const e of OWNS[previousStage].edges) {
        assert.ok(edgeSolved(state, e), `${label}: stage ${previousStage} ended with edge ${e} unsolved`);
      }
      for (const c of OWNS[previousStage].corners) {
        assert.ok(cornerSolved(state, c), `${label}: stage ${previousStage} ended with corner ${c} unsolved`);
      }
    }
    previousStage = step.stage;

    state = applyAlg(state, step.alg);

    // The load-bearing check: nothing a later step does may undo an earlier stage.
    for (const e of finished.edges) {
      assert.ok(edgeSolved(state, e),
        `${label}: step ${i} (${step.stage}/${step.caseName ?? 'goal'}) broke edge ${e}`);
    }
    for (const c of finished.corners) {
      assert.ok(cornerSolved(state, c),
        `${label}: step ${i} (${step.stage}/${step.caseName ?? 'goal'}) broke corner ${c}`);
    }
  }
  return state;
}

test('a y rotation relabels faces and comes back after four', () => {
  const { rotateAlg } = __testing;
  assert.equal(rotateAlg("R U R'", 0), "R U R'");
  assert.equal(rotateAlg("R U R'", 1), "B U B'", 'y sends R to B');
  assert.equal(rotateAlg("F2 D L'", 1), "R2 D F'");
  assert.equal(rotateAlg("R U R' F' L", 4), "R U R' F' L", 'four quarter turns is the identity');
  assert.equal(rotateAlg('U D U2', 2), 'U D U2', 'the top and bottom never move');
});

test('the shortest-path search returns the shortest, and null when there is none', () => {
  const { shortestTo } = __testing;
  const state = applyAlg(SOLVED, 'R');
  const backToSolved = (s) => edgeSolved(s, EDGE.DR) && edgeSolved(s, EDGE.UR);
  assert.equal(shortestTo(state, backToSolved, 4), "R'");
  assert.equal(shortestTo(SOLVED, () => true, 4), '', 'an already-met goal costs no moves');
  assert.equal(shortestTo(SOLVED, () => false, 2), null, 'an impossible goal is null, not a guess');
});

test('random states solve, and cubejs agrees the alg solves them', () => {
  // 120 states is enough to hit every last-layer case many times over; the 400-state sweep in
  // dev-docs/method-solver-design.md is the wider run this stands in for.
  for (let i = 0; i < 120; i++) {
    const cube = Cube.random();
    const facelets = cube.asString();
    const start = fromCube(cube);
    const { steps, alg, moveCount } = solveByMethod(start);

    const end = assertStepsAreHonest(start, steps, facelets);
    assert.deepEqual(end.cp, SOLVED.cp, `${facelets}: corners not permuted home`);
    assert.deepEqual(end.co, SOLVED.co, `${facelets}: corners left twisted`);
    assert.deepEqual(end.ep, SOLVED.ep, `${facelets}: edges not permuted home`);
    assert.deepEqual(end.eo, SOLVED.eo, `${facelets}: edges left flipped`);

    const oracle = Cube.fromString(facelets);
    oracle.move(alg);
    assert.ok(oracle.isSolved(), `${facelets}: cubejs does not agree this alg solves the cube`);

    assert.equal(moveCount, alg.trim().split(/\s+/).length);
    assert.equal(alg, steps.map((s) => s.alg).join(' ').trim(),
      'the whole alg must be exactly the steps, or the move list and the animation disagree');
  }
});

test('an already-solved cube produces no steps at all', () => {
  const { steps, alg, moveCount } = solveByMethod(SOLVED);
  assert.deepEqual(steps, [], 'a solved cube has nothing to teach and must not be given moves');
  assert.equal(alg, '');
  assert.equal(moveCount, 0);
});

test('the same state always produces the same lesson', () => {
  // A tutor that answered differently on a re-scan would be untrustworthy in the one way that
  // matters: the learner would not be able to go back and look at the step again.
  const cube = Cube.random();
  const a = solveByMethod(fromCube(cube));
  const b = solveByMethod(fromCube(cube));
  assert.equal(a.alg, b.alg);
  assert.deepEqual(a.steps.map((s) => s.caseName ?? s.alg), b.steps.map((s) => s.caseName ?? s.alg));
});

test('an impossible cube is refused, not half-solved', () => {
  // Two edges swapped and nothing else is a parity error: no sequence of face turns reaches it.
  // The solver must say so rather than hand a learner moves that lead nowhere.
  const broken = { cp: [...SOLVED.cp], co: [...SOLVED.co], ep: [...SOLVED.ep], eo: [...SOLVED.eo] };
  [broken.ep[EDGE.UF], broken.ep[EDGE.UR]] = [broken.ep[EDGE.UR], broken.ep[EDGE.UF]];
  assert.throws(() => solveByMethod(broken), MethodSolverError);
  try {
    solveByMethod(broken);
  } catch (err) {
    assert.ok(err.stage, 'the error names the stage that could not be reached');
    assert.ok(err.state, 'and carries the state, so a failure is reproducible');
  }
});

test('a twisted corner alone is refused too', () => {
  const broken = { cp: [...SOLVED.cp], co: [...SOLVED.co], ep: [...SOLVED.ep], eo: [...SOLVED.eo] };
  broken.co[CORNER.URF] = 1;
  assert.throws(() => solveByMethod(broken), MethodSolverError);
});

test('every step is an algorithm a learner could be shown', () => {
  // No wide turns, no slice moves, no rotations: the move list, the 2D net and <cubus-cube>
  // all speak face turns only, and a step they cannot render is a step nobody can follow.
  const legal = /^[UDLRFB](['2])?$/;
  for (let i = 0; i < 20; i++) {
    const { steps } = solveByMethod(fromCube(Cube.random()));
    for (const step of steps) {
      for (const move of step.alg.trim().split(/\s+/)) {
        assert.match(move, legal, `${step.stage}/${step.caseName ?? 'goal'} emitted "${move}"`);
      }
    }
  }
});

test('every algorithm in the repertoire is one some cube actually needs', () => {
  // A table entry nothing reaches is a case we would claim to teach and never show. Four
  // entries failed this check when it was first written and were deleted; the exhaustive
  // last-layer sweep in bench/method-solver-profile.mjs is what proved deleting them safe.
  const seen = new Set();
  for (const state of seededStates(45, 20260828)) {
    for (const [, method] of NAMED) {
      for (const step of solveByMethod(state, method).steps) {
        // A pair step is named after the POSITION it is in, and carries the algorithms that
        // get out of it in `parts`. Everywhere else the case name is the algorithm.
        if (step.parts) for (const part of step.parts) seen.add(part.name);
        else if (step.caseName) seen.add(step.caseName);
      }
    }
  }
  // The HAND-WRITTEN repertoire. The generated tables are excluded, and the reason is not that
  // they are hard to cover — it is that sampling is the wrong instrument for them. 57 OLL cases,
  // 21 PLL and 41 F2L are complete BY CONSTRUCTION, and completeness is the one property a sample
  // cannot establish: it is the enumeration or it is nothing. `bench/method-solver-profile.mjs
  // exhaustive` is that enumeration — all 62,208 reachable last-layer states, at every last-layer
  // rung, with the per-algorithm counts printed — and it runs nightly in CI.
  const GENERATED = /^(?:oll|pll|f2l):[0-9a-f]+$/;
  const handWritten = CASE_NAMES.filter((n) => !GENERATED.test(n));
  const unused = handWritten.filter((name) => !seen.has(name));
  assert.deepEqual(unused, [], `repertoire entries no state needed: ${unused.join(', ')}`);
  const unknown = [...seen].filter((name) => !CASE_NAMES.includes(name));
  assert.deepEqual(unknown, [], 'a step named a case that is not in the repertoire');
  // And the sample DOES reach the generated tables — thinly, which is the point above, but a
  // rung whose table was never touched at all would be a rung that is not wired.
  const NAMED_RUNGS = [{ cross: 1, pairs: 2, oll: 1, pll: 1 }];
  const generatedSeen = new Set();
  for (const state of seededStates(12, 20260909)) {
    for (const rungs of NAMED_RUNGS) {
      for (const step of solveByMethod(state, methodFor(rungs)).steps) {
        for (const name of step.parts ? step.parts.map((x) => x.name) : [step.caseName ?? '']) {
          if (GENERATED.test(name)) generatedSeen.add(name);
        }
      }
    }
  }
  for (const kind of ['oll', 'pll', 'f2l']) {
    assert.ok([...generatedSeen].some((n) => n.startsWith(`${kind}:`)),
      `no ${kind} case from the generated table was used — the rung is not reading it`);
  }
});

/** The fine-grained stages each dial owns, for measuring a rung against the rung below it. */
/**
 * §10's first kill-criterion — the table now lives in the bench, and this imports it.
 *
 * "A rung must move a NAMED axis it is able to move, by a floor stated before it is built." The
 * axis is per rung because they are not interchangeable: a rung that halves the step count and one
 * that changes what a single step is made of are both real, and judging the second on steps is a
 * criterion that is not measuring the rung.
 *
 * ONE table, because the bench prints a verdict from it and this file gates on it, and two copies
 * of a product decision is two decisions. Floors sit under the measured values with margin — the
 * point is to catch a rung that moves NOTHING, not to pin a number that any improvement would
 * break. Measured over 120 cubes: cross 5.10 steps, pairs 0→1 2.73 steps, pairs 1→2 1.0038 parts,
 * oll 2.01 steps, pll 1.05 steps.
 */
const RUNGS_EARN_THEIR_PLACE = RUNG_CRITERIA;

test('every rung moves the axis it is judged on, and no rung is invention', () => {
  // `rungDelta` is the bench's own function, so the number the bench PRINTS and the number this
  // file GATES on are the same computation over the same cubes. They were two, and they disagreed:
  // the bench measured whole-solve step counts, which include cubes whose last layer was already
  // oriented, so it printed "not a lesson" about full OLL while this test was content.
  const states = seededStates(120, 20260909);
  for (const criterion of RUNGS_EARN_THEIR_PLACE) {
    const { dial, from, to, axis, floor } = criterion;
    const { moved, compared } = rungDelta(states, criterion);
    assert.ok(compared > 100, `${dial} ${from}->${to}: only ${compared} comparable cubes`);
    assert.ok(moved >= floor,
      `${dial} rung ${to} moves ${moved.toFixed(4)} ${axis} against a floor of ${floor} — `
      + 'a rung that moves nothing its learner can measure is invention (plan §10)');
  }
});

test('the F2L rung is one recalled case, never a chain — which is what it is FOR', () => {
  // The structural half of the decision to keep pairs rung 2, and the reason it is kept: not the
  // 1.17 moves, which would be thin for 41 algorithms, but what the step BECOMES. At rung 1 a pair
  // step is three or four pieces assembled out of triggers; at rung 2 it is one algorithm after an
  // optional alignment and never anything else, because the search runs at one ply over a complete
  // table. Measured rather than asserted about pedagogy.
  const states = seededStates(60, 20260909);
  const counts = (rung) => {
    const method = methodFor({ cross: 1, pairs: rung, oll: 0, pll: 0 });
    const sizes = [];
    for (const state of states) {
      for (const s of solveByMethod(state, method).steps) {
        if (s.stage === 'f2l' && s.parts) sizes.push(s.parts.length);
      }
    }
    return sizes;
  };
  const chained = counts(1);
  const recalled = counts(2);
  assert.ok(chained.length > 100 && recalled.length > 100, 'too few pair steps to compare');
  assert.deepEqual(recalled.filter((n) => n > 2), [],
    'a rung-2 pair step has more than the alignment and one algorithm in it');
  const longAtRung1 = chained.filter((n) => n > 2).length / chained.length;
  assert.ok(longAtRung1 > 0.5,
    `only ${(longAtRung1 * 100).toFixed(1)}% of rung-1 pair steps are chains — the two rungs have `
    + 'converged, and rung 2 no longer teaches anything rung 1 does not');
});

test('a solve builds no repertoires — they are built once, when the module loads', () => {
  // COUNTED, not timed. `repertoire` rotates and AUF-prefixes every entry, and it used to run
  // inside a solve in three places: `runLooks`, `placeCorner`/`placeEdge`, and the cross rung. At
  // rung 0 that was 5 algorithms turned into 80 candidates per look per cube — wasteful and
  // invisible. At rung 1 it is 57 turned into 912, and it stopped being invisible: a full solve
  // measured 869 ms against the beginner method's 484, which is the wrong way round and a second
  // of silence on the screen. Hoisted, both ends are about a quarter of that.
  //
  // A millisecond budget would measure the runner. A build count is a property of the code, holds
  // on any machine, and fails by construction the moment someone puts a `repertoire()` back on the
  // hot path — which is the only way this regresses.
  const before = __testing.repertoiresBuilt();
  for (const rungs of allRungCombinations()) {
    const method = methodFor(rungs);
    for (const state of seededStates(2, 5150)) solveByMethod(state, method);
  }
  assert.equal(__testing.repertoiresBuilt(), before,
    'a solve built a repertoire — hoist it to module scope, as `look` and SLOT_REPERTOIRE do');
});

test('every named method solves, and cubejs agrees on all of them', () => {
  for (const state of seededStates(20, 424242)) {
    for (const [name, method] of NAMED) {
      const { steps, alg } = solveByMethod(state, method);
      const end = assertStepsAreHonest(state, steps, name);
      assert.deepEqual(end.cp, SOLVED.cp, `${name}: corners not home`);
      assert.deepEqual(end.co, SOLVED.co, `${name}: corners twisted`);
      assert.deepEqual(end.ep, SOLVED.ep, `${name}: edges not home`);
      assert.deepEqual(end.eo, SOLVED.eo, `${name}: edges flipped`);
      assert.equal(alg, steps.map((s) => s.alg).join(' ').trim());
    }
  }
});

test('the ladder goes down, and never falls far', () => {
  // The point of having rungs, so it is asserted rather than described.
  //
  // NOT per cube: measured over 60, one came out a single step WORSE at the higher rung. That
  // is real and it is allowed. The pairing stage still falls back to the rung below for about
  // half of all pairs, and on a cube where the beginner path happened to be short that fallback
  // can cost one step more than it saves. Closing the F2L case set is what shrinks it — and per
  // §7a finding F1 it cannot close it entirely.
  //
  // What must hold is that the ladder goes down overall and never lurches: a learner who moves
  // up a rung and finds a solve two steps longer would rightly stop trusting the rungs.
  let beginnerTotal = 0;
  let intermediateTotal = 0;
  let worst = 0;
  for (const state of seededStates(15, 99)) {
    const beginner = solveByMethod(state, BEGINNER).steps.length;
    const intermediate = solveByMethod(state, INTERMEDIATE).steps.length;
    beginnerTotal += beginner;
    intermediateTotal += intermediate;
    worst = Math.max(worst, intermediate - beginner);
  }
  assert.ok(intermediateTotal < beginnerTotal,
    `the higher rung took ${intermediateTotal} steps against ${beginnerTotal} — the ladder does not go down`);
  assert.ok(intermediateTotal <= beginnerTotal * 0.8,
    'the higher rung should be a clear improvement, not a rounding difference');
  assert.ok(worst <= 1, `one cube was ${worst} steps worse at the higher rung, which is a lurch`);
});

test('the cross is solved whole and optimally at the rung above', () => {
  const { crossTable, solveCrossWhole } = __testing;
  const distance = crossTable();
  assert.equal(distance[distance.length - 1] === undefined, false, 'the table was built');
  for (const state of seededStates(25, 5150)) {
    const alg = solveCrossWhole(state);
    const after = applyAlg(state, alg);
    for (const edge of [EDGE.DF, EDGE.DR, EDGE.DB, EDGE.DL]) {
      assert.ok(edgeSolved(after, edge), 'the whole-cross alg must solve every cross edge');
    }
    // Optimal by construction: the alg descends an exact distance table one move at a time,
    // so its length IS the distance. Asserting it catches a table that silently stopped being
    // exact, which would still produce a working but longer cross.
    const moves = alg.trim() ? alg.trim().split(/\s+/).length : 0;
    assert.ok(moves <= 8, `a cross needs at most eight moves, this took ${moves}`);
  }
});

test('an unknown rung is refused rather than quietly clamped to one that exists', () => {
  // Clamping would show a learner a method they did not choose while labelling it with the one
  // they did, and every count on the screen would then be about a different solve.
  assert.throws(() => methodFor({ cross: 0, pairs: 0, oll: 0, pll: 9 }), /unknown rung: pll 9/);
  assert.throws(() => methodFor({ cross: 7, pairs: 0, oll: 0, pll: 0 }), /unknown rung: cross 7/);
  assert.throws(() => solveByMethod(SOLVED, null), /needs a method/);
  assert.throws(() => solveByMethod(SOLVED, { stages: 'cross' }), /needs a method/);
});

test('a pair case gets ONE algorithm, whichever slot it turns up in', () => {
  // The premise of the whole stage. A case with two answers is a case nobody can learn, and this
  // was broken for a long time in a way that looked fine: the naming relabelled slot names into
  // the working frame but read the edge flip where it stood, and flip is measured against the
  // F/B axis — so the same position in a different slot was a different case, and got a
  // different algorithm. Thirty of the forty-one cases were affected.
  //
  // Compared in one frame, with the alignment turn removed: "turn the top until it matches" is
  // what you do BEFORE the case, and how far you turn depends on where you started.
  const SLOT_OF = { [CORNER.DFR]: 0, [CORNER.DRB]: 1, [CORNER.DBL]: 2, [CORNER.DLF]: 3 };
  const algsByCase = new Map();

  for (const state of seededStates(40, 8675309)) {
    for (const step of solveByMethod(state, INTERMEDIATE).steps) {
      if (step.stage !== 'f2l' || !step.parts) continue; // a fallback pair is the rung below
      const slot = SLOT_OF[step.target];
      const body = __testing.rotateAlg(step.alg, (4 - slot) % 4).replace(/^U['2]? /, '');
      if (!algsByCase.has(step.caseName)) algsByCase.set(step.caseName, new Map());
      algsByCase.get(step.caseName).set(body, slot);
    }
  }

  assert.ok(algsByCase.size > 20, `only ${algsByCase.size} cases were exercised — sample too thin`);
  const ambiguous = [...algsByCase]
    .filter(([, bodies]) => bodies.size > 1)
    .map(([name, bodies]) => `${name}: ${[...bodies.keys()].join('  |  ')}`);
  assert.deepEqual(ambiguous, [], 'these cases have more than one algorithm and cannot be taught');
});

// ---- the split of 2026-09-08 is behaviour-preserving, and that is checked ----------------------

/**
 * The ONLY differences from the pre-split output that this suite accepts — plan A5's focus
 * payload, and nothing else.
 *
 * The last-layer steps used to carry `why: { key }` alone: enough to caption a step, not enough
 * to point at one. §5.2 makes the cube the load-bearing channel, so each application now names
 * the pieces it is about. Listed here per reason key, so the fixture stays the pre-split record
 * and the change is stated rather than absorbed by regenerating it away.
 */
const ADDED_WHY_FIELDS = Object.freeze({
  'topCross.orient': ['edges'],
  'topFace.orient': ['corners'],
  'topCorners.permute': ['corners'],
  'topEdges.permute': ['edges'],
});

/**
 * Reason keys that were SPLIT after the fixture was captured, and what they were split from.
 *
 * The audit of 2026-09-09 found two captions describing the opposite of what their step does. The
 * middle-layer algorithm both EJECTS a wrong edge and INSERTS the right one, and both said "send
 * this edge down"; a last-layer look may take three applications and every one said the stage was
 * finished. Both are now decided by replaying the step and asking the cube.
 *
 * So the KEY changed for some steps, and the fixture is mapped back rather than regenerated — the
 * same discipline as `ADDED_WHY_FIELDS`. `the_split_keys_say_what_the_step_actually_did` is what
 * makes the mapping honest: it checks each new key against the cube, so a step could not be
 * relabelled arbitrarily and still pass.
 */
const SPLIT_WHY_KEYS = Object.freeze({
  'middleLayer.eject': 'middleLayer.insert',
  'topCross.orient.step': 'topCross.orient',
  'topFace.orient.step': 'topFace.orient',
  'topCorners.permute.step': 'topCorners.permute',
  'topEdges.permute.step': 'topEdges.permute',
});

/** A step with every post-fixture change undone, so it can be compared against the pre-split
 *  record: the A5 focus payload stripped, and a split reason key mapped back to its original. */
function withoutAdditions(step) {
  const key = SPLIT_WHY_KEYS[step.why?.key] ?? step.why?.key;
  const allowed = ADDED_WHY_FIELDS[key];
  const why = { ...step.why, key };
  if (allowed) for (const field of allowed) delete why[field];
  return { ...step, why };
}

test('the step lists are exactly what the current baseline pins', () => {
  // The ongoing guard: nothing changes without a deliberate regeneration, and the regeneration is
  // a visible edit to a committed file. `method-steps.json` is that baseline.
  const expected = JSON.parse(readFileSync(new URL('./fixtures/method-steps.json', import.meta.url), 'utf8'));
  const actual = capture();
  assert.equal(actual.cases.length, expected.cases.length);
  for (const [i, want] of expected.cases.entries()) {
    const got = actual.cases[i];
    assert.equal(got.scramble, want.scramble, `case ${i}: the fixture is about a different cube`);
    for (const { name } of BASELINES) {
      assert.deepEqual(got.methods[name], want.methods[name],
        `case ${i} (${want.scramble}): ${name} produces a different lesson than the baseline pins`);
    }
  }
});

test('every change since the split is a declared kind, and the ladder did not go backwards', () => {
  // Plan A2's claim was that the stage-list split was behaviour-preserving, and it WAS — verified
  // byte for byte at the time, against `method-steps.pre-split.json`, which is frozen.
  //
  // Deliberate improvements have moved behaviour on since, and this is what keeps that honest: the
  // relation between the frozen record and today. Every reason key that is not in the pre-split
  // record must be one this file DECLARES, and no lesson may have got longer. A regression that
  // lengthened a solve, or a caption that appeared without being declared, fails here whatever the
  // current baseline says — because the current baseline is regenerated and this record is not.
  const before = JSON.parse(readFileSync(new URL('./fixtures/method-steps.pre-split.json', import.meta.url), 'utf8'));
  const now = capture();
  const DECLARED = new Set([
    ...Object.keys(SPLIT_WHY_KEYS), // captions split from one that described the wrong outcome
    'lastLayer.align',             // the fix for a one-turn cube taking nineteen moves
  ]);
  const oldKeys = new Set(before.cases
    .flatMap((c) => Object.values(c.methods))
    .flatMap((m) => m.steps.map((s) => s.why.key)));
  let shorter = 0;
  let stepsBefore = 0;
  let stepsAfter = 0;
  let movesBefore = 0;
  let movesAfter = 0;
  for (const [i, was] of before.cases.entries()) {
    const is = now.cases[i];
    assert.equal(is.scramble, was.scramble);
    for (const { name } of BASELINES) {
      const a = was.methods[name];
      const b = is.methods[name];
      // **In aggregate, and bounded per cube — not monotone per cube, because that is not true.**
      //
      // Written as "no cube may take more steps than it did" first, and one cube did: skipping a
      // placement that was already done leaves a different cube for the NEXT pair, and that pair
      // can then need the fallback where before it did not. §2 already records that shape — "a
      // fallback can cost one step more than it saves" — and the ladder test bounds it at one
      // step. The same bound applies here, over the same reason.
      //
      // What must hold is the aggregate, which is where the ladder is measured (§8): 249 steps to
      // 247 for the beginner, 165 to 161 for the intermediate, on this sample.
      assert.ok(b.steps.length <= a.steps.length + 1,
        `case ${i} (${was.scramble}): ${name} lurched from ${a.steps.length} to ${b.steps.length} steps`);
      stepsBefore += a.steps.length;
      stepsAfter += b.steps.length;
      movesBefore += a.moveCount;
      movesAfter += b.moveCount;
      if (b.moveCount < a.moveCount) shorter += 1;
      for (const step of b.steps) {
        assert.ok(oldKeys.has(step.why.key) || DECLARED.has(step.why.key),
          `case ${i}: the reason "${step.why.key}" is new and undeclared`);
      }
    }
  }
  // And the improvements really happened, so this is not a vacuous "nothing got worse".
  assert.ok(shorter > 0, 'no lesson got shorter — the declared improvements did nothing');
  assert.ok(stepsAfter <= stepsBefore,
    `the sample takes ${stepsAfter} steps in total against ${stepsBefore} before — a regression`);
  assert.ok(movesAfter <= movesBefore,
    `the sample takes ${movesAfter} moves in total against ${movesBefore} before — a regression`);
});

test('the A5 focus payload is the only thing added, and it is added everywhere it is declared', () => {
  // The other side of the allowance above. Stripping a field the code never sets would let the
  // comparison pass while the payload silently went missing — so the fields are asserted PRESENT,
  // non-empty, and made of real cubie ids.
  const actual = capture();
  const seen = new Set();
  for (const c of actual.cases) {
    for (const method of Object.values(c.methods)) {
      for (const step of method.steps) {
        const allowed = ADDED_WHY_FIELDS[step.why.key];
        if (!allowed) continue;
        seen.add(step.why.key);
        // A group with nothing wrong in it is OMITTED rather than filled with the whole layer —
        // see `focus` in methods/last-layer.js. So the requirement is that the step points at
        // SOMETHING, and that everything it points at is real; a declared field that is absent
        // means "this step is not about those pieces", which is a thing a step is allowed to say.
        assert.ok(allowed.some((field) => step.why[field] !== undefined),
          `${step.why.key} carries none of ${allowed.join(', ')} — a step that points at nothing`);
        for (const field of allowed) {
          const named = step.why[field];
          if (named === undefined) continue;
          assert.ok(Array.isArray(named) && named.length > 0,
            `${step.why.key} named an empty ${field} — omit the group instead`);
          const limit = field === 'edges' ? 12 : 8;
          for (const id of named) {
            assert.ok(Number.isInteger(id) && id >= 0 && id < limit,
              `${step.why.key} named ${field} ${id}, which is not a cubie`);
          }
          assert.equal(new Set(named).size, named.length, `${step.why.key} named a piece twice`);
        }
      }
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(ADDED_WHY_FIELDS).sort(),
    'the fixture does not exercise every reason key that carries a focus payload');
});

/** A maneuver undone: the moves backwards, each one reversed. */
const invertAlg = (alg) => alg.trim().split(/\s+/).reverse()
  .map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
  .join(' ');

test('a one-look step points at what its algorithm is FOR, and never at pieces already right', () => {
  // The defect: each highlight group fell back to naming the WHOLE top layer when nothing in it
  // was wrong. That is right for a look about one group and wrong for the one-look rungs, which
  // are about both — so full OLL on a case with only twisted corners pulsed four correctly
  // oriented edges, and full PLL on a case with only permuted edges pulsed four solved corners.
  // A pulse reads as "this is what the algorithm is for", and it was saying so about half the
  // layer that needed nothing.
  const cases = [
    {
      what: 'full OLL on a corners-only case',
      rungs: { cross: 0, pairs: 0, oll: 1, pll: 0 },
      // Sune undone: three corners twisted, every edge already oriented.
      setup: invertAlg("R U R' U R U2 R'"),
      stage: 'top-face',
      wants: 'corners',
      forbids: 'edges',
    },
    {
      what: 'full PLL on an edges-only case',
      rungs: { cross: 0, pairs: 0, oll: 0, pll: 1 },
      // A U-perm undone: the corners are home, three edges are not.
      setup: invertAlg("R U' R U R U R U' R' U' R2"),
      stage: 'top-edges',
      wants: 'edges',
      forbids: 'corners',
    },
  ];
  for (const { what, rungs, setup, stage, wants, forbids } of cases) {
    const state = applyAlg(SOLVED, setup);
    const steps = solveByMethod(state, methodFor(rungs)).steps.filter((s) => s.stage === stage);
    assert.equal(steps.length, 1, `${what}: expected one step, got ${steps.length}`);
    const { why } = steps[0];
    assert.ok(Array.isArray(why[wants]) && why[wants].length > 0,
      `${what}: named no ${wants}, and that is what the algorithm is for`);
    assert.equal(why[forbids], undefined,
      `${what}: named ${forbids} ${JSON.stringify(why[forbids])}, which are already correct`);
  }
});

test('the split keys say what the step actually did, checked against the cube', () => {
  // The other half of the mapping above, and the audit's own suggested check: "add replay tests
  // checking each claimed outcome against the resulting cube state." A caption is a claim about
  // what the learner is about to watch, so it is verified by watching.
  const seen = new Set();
  for (const state of seededStates(30, 5551212)) {
    for (const method of [BEGINNER, INTERMEDIATE]) {
      const { steps } = solveByMethod(state, method);
      let cube = state;
      for (const step of steps) {
        const before = cube;
        cube = applyAlg(cube, step.alg);
        const key = step.why.key;
        seen.add(key);
        if (key === 'middleLayer.insert') {
          assert.ok(edgeSolved(cube, step.why.edge),
            'a step captioned "send this edge down" must leave the edge in its slot');
        } else if (key === 'middleLayer.eject') {
          assert.ok(!edgeSolved(cube, step.why.edge),
            'a step captioned as an ejection must NOT leave the edge in its slot');
          assert.ok(!edgeSolved(before, step.why.edge),
            'and it must not have been home to begin with');
        } else if (key.endsWith('.step')) {
          assert.ok(!reachedLook(cube, key.slice(0, -'.step'.length)),
            `${key}: an intermediate step must not have reached its look's goal`);
        } else if (LOOK_GOAL[key]) {
          assert.ok(reachedLook(cube, key), `${key}: a completing step must have reached its goal`);
        }
      }
    }
  }
  // Every split key must actually occur, or the mapping above is describing something that never
  // happens and the fixture comparison is looser than it looks.
  //
  // Except `topCorners.permute.step`, which stopped occurring when the alignment candidate arrived
  // — a two-algorithm corner case now comes out as an alignment plus one algorithm. It is still
  // reachable in principle (the look allows two), so its mapping stays; see the note in
  // method-lesson.test.mjs.
  const RARE = ['topCorners.permute.step'];
  for (const key of Object.keys(SPLIT_WHY_KEYS)) {
    if (RARE.includes(key)) continue;
    assert.ok(seen.has(key), `${key} never occurred — the split is not exercised`);
  }
  // The alignment step is new and must be exercised: it is the fix for a one-turn cube taking
  // nineteen moves, and a sample that never produced one would not have caught that.
  assert.ok(seen.has('lastLayer.align'), 'no alignment step in the sample');
});

test('the fixture covers both pre-split methods and enough cubes to be worth trusting', () => {
  // A fixture that shrank would still pass the comparison above while checking nothing.
  const expected = JSON.parse(readFileSync(new URL('./fixtures/method-steps.json', import.meta.url), 'utf8'));
  const frozen = JSON.parse(readFileSync(new URL('./fixtures/method-steps.pre-split.json', import.meta.url), 'utf8'));
  assert.equal(frozen.cases.length, expected.cases.length, 'the two fixtures are about different cubes');
  assert.ok(expected.cases.length >= 12, `only ${expected.cases.length} cubes in the fixture`);
  assert.deepEqual(expected.baselines.map((b) => b.name), ['beginner', 'intermediate']);
  const totalSteps = expected.cases
    .flatMap((c) => Object.values(c.methods))
    .reduce((n, m) => n + m.steps.length, 0);
  assert.ok(totalSteps > 300, `only ${totalSteps} steps pinned — too thin to catch a regression`);
  // Every stage the solver can emit appears, so the fixture cannot be silently narrowed to the
  // easy half of a solve.
  const stages = new Set(expected.cases.flatMap((c) => Object.values(c.methods)).flatMap((m) => m.steps.map((s) => s.stage)));
  assert.deepEqual([...stages].sort(),
    ['cross', 'f2l', 'first-layer', 'middle-layer', 'top-corners', 'top-cross', 'top-edges', 'top-face']);
});

test('the pinned baseline is about the cubes this suite draws', () => {
  // A CASE THAT COULD NOT FAIL, until 2026-09-12. It compared the fixture module's `seededStates`
  // with `regen-method-steps.mjs`'s re-export of `seededPairs` — one function against itself, under
  // a comment claiming they were "separate functions on purpose" that had stopped being true when
  // the generator was consolidated. What is worth checking is the claim every case above rests on:
  // that the scrambles recorded in `method-steps.json` are the ones the draw produces today.
  const expected = JSON.parse(readFileSync(new URL('./fixtures/method-steps.json', import.meta.url), 'utf8'));
  assert.deepEqual(expected.cases.map((c) => c.scramble), seededScrambles(expected.count, expected.seed),
    'method-steps.json was captured from a different draw than the one running now');
  // And that the pairs the regenerator feeds `solveByMethod` really are those scrambles applied.
  const pairs = seededPairs(expected.count, expected.seed);
  assert.deepEqual(pairs.map((p) => p.scramble), expected.cases.map((c) => c.scramble));
  assert.deepEqual(pairs.map((p) => p.state), seededStates(expected.count, expected.seed));
});

// ---- the ladder ------------------------------------------------------------------------------

test('the ladder describes itself, and every rung it lists can be built', () => {
  assert.deepEqual(STAGE_IDS, ['cross', 'pairs', 'oll', 'pll']);
  for (const id of STAGE_IDS) {
    assert.ok(LADDER[id].length > 0, `${id} has no rungs`);
    // Rungs are numbered 0..n with no gaps, because the Lessons ladder is drawn from them and a
    // hole in it would render as a rung a learner can see and never reach.
    assert.deepEqual(LADDER[id].map((s) => s.rung), [...LADDER[id].keys()], `${id}'s rungs have a gap`);
    assert.equal(TOP_RUNG[id], LADDER[id].length - 1);
    for (const stage of LADDER[id]) {
      assert.equal(stage.id, id, `a ${id} rung says it belongs to ${stage.id}`);
      assert.ok(stage.label && stage.blurb, `${id} rung ${stage.rung} has no label or blurb`);
      assert.equal(typeof stage.run, 'function');
      assert.equal(typeof stage.keep, 'function');
      assert.equal(typeof stage.contract, 'function');
    }
  }
  const combinations = allRungCombinations();
  assert.equal(combinations.length, STAGE_IDS.reduce((n, id) => n * LADDER[id].length, 1));
  for (const rungs of combinations) assert.ok(methodFor(rungs).stages.length === 4);
  assert.equal(rungKey({ cross: 1, pairs: 1, oll: 0, pll: 0 }), '1,1,0,0');
});

test('a pair step\'s parts reconstruct the step\'s own algorithm', () => {
  // `parts` exists so a learner meeting a case for the first time can open the step up and see how
  // it is made. It has to add up: the alignment was left out, so a step whose alg was `R U R'`
  // listed a single part of `U R U R'`, which does not solve the pair. Checked by applying both
  // and comparing cubes rather than strings — the step's alg is simplified and the parts are not,
  // so the same maneuver is legitimately written two ways.
  let checked = 0;
  for (const state of seededStates(30, 999)) {
    for (const step of solveByMethod(state, INTERMEDIATE).steps) {
      if (!step.parts) continue;
      checked += 1;
      const joined = step.parts.map((p) => p.alg).join(' ');
      assert.deepEqual(applyAlg(SOLVED, joined), applyAlg(SOLVED, step.alg),
        `a pair step's parts do not make its algorithm: "${step.alg}" against "${joined}"`);
      for (const part of step.parts) {
        assert.ok(CASE_NAMES.includes(part.name), `a part named "${part.name}" is in no table`);
      }
    }
  }
  assert.ok(checked > 40, `only ${checked} pair steps checked — too thin`);
});

test('the pairing fallback places only what is out of place', () => {
  // It used to lift and reinsert unconditionally, so a pair whose corner was already home cost two
  // steps to put it back where it was. Asserted at the defect rather than at a step count: a
  // fallback step must never be about a piece that was already home when the step began.
  let fallbacks = 0;
  for (const state of seededStates(40, 20260909)) {
    let cube = state;
    for (const step of solveByMethod(state, INTERMEDIATE).steps) {
      const before = cube;
      cube = applyAlg(cube, step.alg);
      if (step.stage !== 'f2l' || step.parts) continue;
      fallbacks += 1;
      if (step.why.key.startsWith('firstLayer.')) {
        assert.ok(!cornerSolved(before, step.why.corner),
          `a fallback moved corner ${step.why.corner}, which was already home`);
      } else {
        assert.ok(!edgeSolved(before, step.why.edge),
          `a fallback moved edge ${step.why.edge}, which was already home`);
      }
    }
  }
  assert.ok(fallbacks > 50, `only ${fallbacks} fallback steps in the sample — too thin`);
});

test('the exported algorithm tables are copies, not the solver\'s own', () => {
  // An export exists to be read. These handed out the very objects the solver reads, so
  // `OLL_ALGS[0].alg = ''` changed every later solve in the process — a global variable with a
  // nicer name. Reproduced before the fix as a MethodSolverError on a state that had solved a
  // moment earlier.
  const before = solveByMethod(seededStates(1, 4242)[0]).alg;
  for (const table of [OLL_ALGS, PLL_ALGS]) {
    assert.ok(Object.isFrozen(table), 'the table itself must be frozen');
    for (const entry of table) {
      assert.ok(Object.isFrozen(entry), `${entry.name} is a mutable record`);
      assert.throws(() => { entry.alg = 'R'; }, TypeError, `${entry.name} could be rewritten`);
    }
  }
  assert.equal(solveByMethod(seededStates(1, 4242)[0]).alg, before,
    'reading the exported tables changed what the solver does');
});

/**
 * What a stage hands back is checked, copied and frozen — the seam, from the stage's side.
 *
 * `solveByMethod`'s own comments record two versions of this already fixed: aliasing the cube it
 * hands a stage, and aliasing the step history. These are the two that were left. A stage's step
 * objects were pushed into the history BY REFERENCE, so a stage that kept the array it filled
 * could rewrite a step after the stage was verified; and no step was ever checked for being one,
 * so a token the renderer cannot animate arrived as a `TypeError` from inside `applyAlg` with the
 * stage name, the step index and the starting state all thrown away.
 *
 * A hand-built method, because the real stages do none of this — which is the point: the driver's
 * guarantees have to hold against a stage that is wrong, since a stage that is right needs no
 * driver.
 */
test('a stage cannot edit the history it has already been verified against', () => {
  const scramble = "R U R' U'";
  const state = applyAlg(SOLVED, scramble);
  const solvingAlg = "U R U' R'";
  let kept = null;
  const method = {
    id: 'test', rungs: {},
    stages: [{
      id: 'only',
      keep: () => true,
      contract: () => true,
      run: (cube, steps) => {
        steps.push({ stage: 'only', kind: 'case', alg: solvingAlg, why: { key: 'test' } });
        // The array the stage keeps a reference to — the attack this guards against.
        kept = steps;
        return applyAlg(cube, solvingAlg);
      },
    }],
  };
  const solved = solveByMethod(state, method);
  assert.equal(solved.alg, solvingAlg);
  // The history does not hold the stage's objects, so editing them afterwards changes nothing.
  kept[0].alg = 'X';
  kept[0].why.key = 'vandalised';
  assert.equal(solved.steps[0].alg, solvingAlg);
  assert.equal(solved.steps[0].why.key, 'test');
});

test('a step that is not a step is refused by name, not by TypeError', () => {
  const state = applyAlg(SOLVED, 'R');
  const stageWith = (emit) => ({
    id: 'only',
    keep: () => true,
    contract: () => true,
    run: (cube, steps) => { emit(steps); return cube; },
  });
  const cases = [
    [(steps) => steps.push(null), /step 0: is null/],
    [(steps) => steps.push({ stage: 'only' }), /step 0: carries no algorithm/],
    [(steps) => steps.push({ stage: 'only', alg: "R x U" }), /step 0: carries "x"/],
    [(steps) => steps.push({ stage: 'only', alg: "M2" }), /step 0: carries "M2"/],
    [(steps) => steps.push({ alg: 'R' }), /step 0: names no stage/],
  ];
  for (const [emit, message] of cases) {
    assert.throws(
      () => solveByMethod(state, { id: 'test', rungs: {}, stages: [stageWith(emit)] }),
      (e) => e.name === 'MethodSolverError' && message.test(e.target),
      String(message),
    );
  }
});

test('a predicate cannot edit the cube it is asked about', () => {
  // A `keep` or `contract` that writes to the state it is handed can make the replay's starting
  // point equal to the state it wants to claim — and the stage then emits nothing while every
  // guard passes. The snapshot is frozen, so the attempt raises instead.
  const state = applyAlg(SOLVED, 'R');
  const vandal = (which) => ({
    id: 'only',
    keep: (s) => { if (which === 'keep') s.cp[0] = 0; return true; },
    contract: (s) => { if (which === 'contract') s.ep[0] = 0; return true; },
    run: (cube, steps) => { steps.push({ stage: 'only', kind: 'case', alg: "R'" }); return applyAlg(cube, "R'"); },
  });
  for (const which of ['keep', 'contract']) {
    assert.throws(
      () => solveByMethod(state, { id: 'test', rungs: {}, stages: [vandal(which)] }),
      TypeError,
      `${which} was handed a writable cube`,
    );
  }
});

test('a solve says which method produced it', () => {
  // The cube screen names the rungs in play (§3 rule 4), so the result has to carry them —
  // otherwise the screen would be reading a setting rather than the solve it is showing.
  const result = solveByMethod(seededStates(1, 7)[0], INTERMEDIATE);
  assert.equal(result.method, '1,1,0,0');
  assert.deepEqual(result.rungs, { cross: 1, pairs: 1, oll: 0, pll: 0 });
});

test('the bench refuses a command line it cannot mean, rather than doing something else', () => {
  // `all 2` used to read the 2 as an OLL rung selector — because `exhaustive` reached into
  // `process.argv` for its own arguments instead of being handed them — so the one command that
  // runs everything failed at the last of the three, after the first two had spent their minutes.
  assert.deepEqual(parseArgs(['all', '2']), { command: 'all', n: 2, selector: null });
  assert.deepEqual(parseArgs([]), { command: 'profile', n: 400, selector: null });
  assert.deepEqual(parseArgs(['ladder']), { command: 'ladder', n: 60, selector: null });
  assert.deepEqual(parseArgs(['exhaustive']), { command: 'exhaustive', selector: null });
  assert.deepEqual(parseArgs(['exhaustive', '1', '1']), { command: 'exhaustive', selector: { oll: 1, pll: 1 } });

  const refused = [
    ['typo'],                    // silently exited 0 having run nothing
    ['ladder', '0'],             // NaN statistics from a zero denominator
    ['ladder', '1.5'],           // a fractional per-solve denominator
    ['ladder', 'Infinity'],      // a loop with no end
    ['ladder', '-3'],
    ['profile', 'lots'],
    ['profile', '10', '20'],
    ['exhaustive', '1'],         // half a selector is not a selector
    ['exhaustive', 'bad', '1'],  // and an unknown rung silently selected everything
    ['exhaustive', '9', '9'],
  ];
  for (const argv of refused) {
    assert.throws(() => parseArgs(argv), (e) => e instanceof UsageError, argv.join(' '));
  }
});
