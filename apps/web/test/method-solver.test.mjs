// The method solver's whole claim is that its steps mean something: each one places a named
// piece and leaves everything already placed alone. A solver that merely ends up solved would
// satisfy a "does it solve" test while teaching nonsense, so most of what follows checks the
// invariant BETWEEN steps rather than the state at the end.
//
// cubejs is the oracle here, exactly as it is for the two-phase solver in app.js: a different
// implementation confirming the alg, not the same code agreeing with itself.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CORNER, EDGE, SOLVED, applyAlg, cornerSolved, edgeSolved, fromCube } from '../lib/cube-pieces.js';
import { CASE_NAMES, LEVELS, MethodSolverError, __testing, solveByMethod } from '../lib/method-solver.js';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
Cube.initSolver();

/** Which pieces each stage is responsible for, in the order the solver places them. Once a
 *  stage is finished, nothing later may disturb what it placed — that is the assertion. */
const OWNS = {
  cross: { edges: [EDGE.DF, EDGE.DR, EDGE.DB, EDGE.DL], corners: [] },
  'first-layer': { edges: [], corners: [CORNER.DFR, CORNER.DRB, CORNER.DBL, CORNER.DLF] },
  'middle-layer': { edges: [EDGE.FR, EDGE.BR, EDGE.BL, EDGE.FL], corners: [] },
  // At the layer above, one stage owns both: the corner and its edge go in together.
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

/** Deterministic states, so the coverage claim below is a fact about this file and not a
 *  probability. Random-state scrambles cannot be seeded through cubejs. */
function seededStates(count, seed) {
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
  const suffix = ['', "'", '2'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const alg = [];
    let prev = -1;
    while (alg.length < 30) {
      const f = Math.floor(rnd() * 6);
      if (f === prev) continue;
      prev = f;
      alg.push(faces[f] + suffix[Math.floor(rnd() * 3)]);
    }
    out.push(applyAlg(SOLVED, alg.join(' ')));
  }
  return out;
}

test('every algorithm in the repertoire is one some cube actually needs', () => {
  // A table entry nothing reaches is a case we would claim to teach and never show. Four
  // entries failed this check when it was first written and were deleted; the exhaustive
  // last-layer sweep in bench/method-solver-profile.mjs is what proved deleting them safe.
  const seen = new Set();
  for (const state of seededStates(45, 20260828)) {
    for (const level of LEVELS) {
      for (const step of solveByMethod(state, { level }).steps) {
        // A pair step is named after the POSITION it is in, and carries the algorithms that
        // get out of it in `parts`. Everywhere else the case name is the algorithm.
        if (step.parts) for (const part of step.parts) seen.add(part.name);
        else if (step.caseName) seen.add(step.caseName);
      }
    }
  }
  const unused = CASE_NAMES.filter((name) => !seen.has(name));
  assert.deepEqual(unused, [], `repertoire entries no state needed: ${unused.join(', ')}`);
  const unknown = [...seen].filter((name) => !CASE_NAMES.includes(name));
  assert.deepEqual(unknown, [], 'a step named a case that is not in the repertoire');
});

test('every level solves, and cubejs agrees on all of them', () => {
  for (const state of seededStates(20, 424242)) {
    for (const level of LEVELS) {
      const { steps, alg } = solveByMethod(state, { level });
      const end = assertStepsAreHonest(state, steps, level);
      assert.deepEqual(end.cp, SOLVED.cp, `${level}: corners not home`);
      assert.deepEqual(end.co, SOLVED.co, `${level}: corners twisted`);
      assert.deepEqual(end.ep, SOLVED.ep, `${level}: edges not home`);
      assert.deepEqual(end.eo, SOLVED.eo, `${level}: edges flipped`);
      assert.equal(alg, steps.map((s) => s.alg).join(' ').trim());
    }
  }
});

test('the ladder goes down: a higher layer describes the same solve in fewer steps', () => {
  // This is the whole point of having layers, so it is asserted rather than described. Per cube
  // rather than on average, because a layer that is only better on average is one a learner
  // would sometimes experience as going backwards.
  let regressions = 0;
  for (const state of seededStates(15, 99)) {
    const beginner = solveByMethod(state, { level: 'beginner' });
    const intermediate = solveByMethod(state, { level: 'intermediate' });
    if (intermediate.steps.length >= beginner.steps.length) regressions++;
  }
  assert.equal(regressions, 0, 'a cube took at least as many steps at the higher layer');
});

test('the cross is solved whole and optimally at the layer above', () => {
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
    let probe = state;
    let steps = 0;
    while (steps < moves) { probe = applyAlg(probe, alg.trim().split(/\s+/)[steps]); steps++; }
    assert.ok(moves <= 8, `a cross needs at most eight moves, this took ${moves}`);
  }
});

test('an unknown level is refused rather than quietly treated as beginner', () => {
  assert.throws(() => solveByMethod(SOLVED, { level: 'expert' }), /unknown level/);
});
