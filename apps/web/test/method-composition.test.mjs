// Every rung combination solves — the §2 claim, checked rather than asserted.
//
// dev-docs/method-solver-return-plan.md §2 says the four stages are independent dials because
// each stage's contract is a STATE, not a procedure: rung 0 and rung 1 of Pairs both end at
// "first two layers solved", so whichever ran, the next stage begins from the same cube. That is
// a claim about composition, and a per-method test cannot see it — the old code had two methods
// and would have passed its own suite with the stage contracts subtly wrong.
//
// So this file solves the SAME cubes with EVERY combination. Four today; twenty-four when the
// Phase C case tables land, and this file will not need editing to cover them — it reads the
// ladder rather than listing the methods.
//
// cubejs is the oracle, as everywhere else: a different implementation confirming the alg.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CORNER, CORNERS, EDGE, EDGES, SOLVED, allSolved, applyAlg, cornerSolved, edgeSolved } from '../lib/cube-pieces.js';
import { identityFace } from '../lib/cube-moves.js';
import {
  LADDER, MethodSolverError, STAGE_IDS, allRungCombinations, methodFor, rungKey, solveByMethod,
} from '../lib/method-solver.js';
import { seededScrambles } from './fixtures/seeded-scrambles.mjs';
import { turnsOf } from './fixtures/method-replay.mjs';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;

/** The plan's number: 4 combinations x n=120. */
const N = 120;
const SEED = 20260908;

const CROSS = [EDGE.DF, EDGE.DR, EDGE.DB, EDGE.DL];
const F1L = [CORNER.DFR, CORNER.DRB, CORNER.DBL, CORNER.DLF];
const MIDDLE = [EDGE.FR, EDGE.BR, EDGE.BL, EDGE.FL];

/** The corner each pair is named after, in slot order — a pair step's `target`. */
const PAIR_CORNERS = F1L;

// Deterministic scrambles, from the one generator. This file had its own byte-identical copy until
// 2026-09-11, which is the fourth one `fixtures/seeded-scrambles.mjs` was consolidated to prevent:
// its header says a change to any copy makes the comparison quietly meaningless rather than loudly
// wrong, and a copy that has drifted is indistinguishable from one that has not until it matters.
const SCRAMBLES = seededScrambles(N, SEED);
const STATES = SCRAMBLES.map((s) => applyAlg(SOLVED, s));

/** The state each stage must have reached by the time its last step has been applied. */
const CONTRACT = {
  cross: (s) => allSolved(s, { edges: CROSS }),
  pairs: (s) => allSolved(s, { edges: [...CROSS, ...MIDDLE], corners: F1L }),
  oll: (s) => allSolved(s, { edges: [...CROSS, ...MIDDLE], corners: F1L }) &&
    [EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB].every((e) => s.eo[e] === 0) &&
    [CORNER.URF, CORNER.UFL, CORNER.ULB, CORNER.UBR].every((c) => s.co[c] === 0),
  pll: (s) => allSolved(s, { edges: [...Array(12).keys()], corners: [...Array(8).keys()] }),
};

/** Which of the four dials a step's fine-grained stage name belongs to. */
const DIAL_OF = {
  cross: 'cross',
  'first-layer': 'pairs',
  'middle-layer': 'pairs',
  f2l: 'pairs',
  'top-cross': 'oll',
  'top-face': 'oll',
  'top-corners': 'pll',
  'top-edges': 'pll',
};

test('every rung combination solves the same cubes, and cubejs agrees', () => {
  const combinations = allRungCombinations();
  assert.equal(combinations.length, STAGE_IDS.reduce((n, id) => n * LADDER[id].length, 1));
  assert.ok(combinations.length >= 4, `only ${combinations.length} combinations — the ladder is not a ladder`);

  const failures = [];
  const report = [];

  for (const rungs of combinations) {
    const method = methodFor(rungs);
    let fallbacks = 0;
    let pairSteps = 0;
    let steps = 0;

    for (const [i, state] of STATES.entries()) {
      const where = `${rungKey(rungs)} on ${SCRAMBLES[i]}`;
      let result;
      try {
        result = solveByMethod(state, method);
      } catch (err) {
        failures.push(`${where}: threw ${err.name} at ${err.stage}/${err.target}`);
        continue;
      }
      steps += result.steps.length;

      // 1. The alg solves it, per a different implementation.
      const oracle = Cube.fromString(faceletsOf(state));
      oracle.move(result.alg);
      if (!oracle.isSolved()) { failures.push(`${where}: cubejs says the alg does not solve it`); continue; }

      // 2. Each dial's contract holds at the boundary where its last step lands, and nothing a
      //    later dial does breaks it. This is the composition claim itself.
      const problem = walkContracts(state, result.steps, where);
      if (problem) { failures.push(problem); continue; }

      // 3. Every pair is accounted for: either the pairing rung reached it (a step carrying
      //    `parts`) or it fell back to the rung below — and a fallback still has to place the
      //    pair. A pair that appears as neither would be a stage silently skipping a slot.
      const accounting = accountForPairs(state, result.steps, where);
      if (accounting.problem) { failures.push(accounting.problem); continue; }
      fallbacks += accounting.fallbacks;
      pairSteps += accounting.paired;
    }

    report.push({
      key: rungKey(rungs),
      steps: (steps / N).toFixed(1),
      fallback: pairSteps + fallbacks ? `${((fallbacks / (pairSteps + fallbacks)) * 100).toFixed(0)}%` : '—',
    });
  }

  assert.deepEqual(failures, [],
    `${failures.length} of ${combinations.length * N} solves failed:\n  ${failures.slice(0, 10).join('\n  ')}`);

  // Printed, not asserted: the rate is a fact this suite is the right place to observe, and
  // §7a finding F1 says a non-zero pair fallback is structural rather than a defect.
  console.log(`    composition: ${combinations.length} combinations x n=${N}, 0 failures`);
  for (const row of report) console.log(`      ${row.key}  ${row.steps} steps  fallback ${row.fallback}`);
});

/** cubejs needs a facelet string; the solver speaks cubies. Rebuild one from the state. */
function faceletsOf(state) {
  const cube = new Cube();
  cube.cp = [...state.cp];
  cube.co = [...state.co];
  cube.ep = [...state.ep];
  cube.eo = [...state.eo];
  return cube.asString();
}

/**
 * Apply the steps in order; at each dial boundary, check that dial's contract, and from then on
 * check it never breaks again.
 *
 * Returns a message, or null when everything held.
 */
function walkContracts(start, steps, where) {
  let state = start;
  const held = [];
  let current = steps.length ? DIAL_OF[steps[0].stage] : null;
  for (const [i, step] of steps.entries()) {
    const dial = DIAL_OF[step.stage];
    if (dial === undefined) return `${where}: step ${i} has an unknown stage "${step.stage}"`;
    if (dial !== current) {
      if (!CONTRACT[current](state)) return `${where}: the ${current} stage ended without meeting its contract`;
      held.push(current);
      current = dial;
    }
    state = applyAlg(state, turnsOf(step));
    for (const done of held) {
      if (!CONTRACT[done](state)) return `${where}: step ${i} (${step.stage}) broke the ${done} contract`;
    }
  }
  if (current && !CONTRACT[current](state)) return `${where}: the ${current} stage ended without meeting its contract`;
  return null;
}

/** A piece a step names as seen in the hold it is made in, as the cube's own piece — a pair's turn to the
 *  front renames every piece after it (plan item 6.3). */
const lettersOf = (names) => new Map(names.map((n, i) => [[...n].sort().join(''), i]));
const CORNER_OF = lettersOf(CORNERS);
const EDGE_OF = lettersOf(EDGES);
const ownCorner = (i, hold) => CORNER_OF.get([...CORNERS[Number(i)]].map((c) => identityFace(c, hold)).sort().join(''));
const ownEdge = (i, hold) => EDGE_OF.get([...EDGES[Number(i)]].map((c) => identityFace(c, hold)).sort().join(''));

/**
 * Every one of the four slots is placed, and by a route the step stream names.
 *
 * A pairing step carries `parts`. A fallback does not, and instead emits the rung below's steps
 * under the `f2l` stage name — so a fallback is visible, countable, and still has to leave the
 * slot solved. Silence for a slot is the failure this is looking for.
 */
function accountForPairs(start, steps, where) {
  const pairSteps = steps.filter((s) => s.stage === 'f2l');
  if (pairSteps.length === 0) {
    // The rung below (`first-layer` / `middle-layer`) placed them, or they were already home.
    const end = steps.reduce((s, step) => applyAlg(s, turnsOf(step)), start);
    if (!CONTRACT.pairs(end)) return { problem: `${where}: no pair steps and the first two layers are not solved` };
    return { problem: null, fallbacks: 0, paired: 0 };
  }
  let paired = 0;
  let fallbacks = 0;
  const covered = new Set();
  for (const step of pairSteps) {
    if (step.parts) {
      paired++;
      covered.add(ownCorner(step.target, step.hold));
      continue;
    }
    fallbacks++;
    // A fallback step names either the corner (a lift or an insert) or the edge.
    if (step.why?.key === 'firstLayer.lift' || step.why?.key === 'firstLayer.insert') {
      covered.add(ownCorner(step.why.corner, step.hold));
    } else if (step.why?.key === 'middleLayer.insert' || step.why?.key === 'middleLayer.eject') {
      // Both halves of the middle-layer algorithm belong to the same pair: it EJECTS a wrong edge
      // and INSERTS the right one, and the two carry different reasons so their captions can say
      // which is happening. Accounting for only one of them read the other as an unclaimed step.
      // The edge's slot, mapped back to the corner its pair is named after.
      const slot = MIDDLE.indexOf(ownEdge(step.why.edge, step.hold));
      if (slot < 0) return { problem: `${where}: a fallback named edge ${step.why.edge}, which is in no pair` };
      covered.add(PAIR_CORNERS[slot]);
    } else {
      return { problem: `${where}: an f2l step with no parts and reason "${step.why?.key}" is unaccounted for` };
    }
  }
  const missing = PAIR_CORNERS.filter((c) => !covered.has(c));
  const end = steps.reduce((s, step) => applyAlg(s, turnsOf(step)), start);
  // A slot already solved by the cross rung's leftovers needs no step; that is the only way a
  // slot may be missing, and it must be solved for that excuse to hold.
  for (const corner of missing) {
    if (!cornerSolved(end, corner)) {
      return { problem: `${where}: pair ${corner} was never placed by any step` };
    }
  }
  for (const edge of MIDDLE) {
    if (!edgeSolved(end, edge)) return { problem: `${where}: middle edge ${edge} was never placed` };
  }
  return { problem: null, fallbacks, paired };
}

/** `assert.throws` does not hand back the error, and these tests are about what the error SAYS —
 *  which stage refused, and why. So the throw is caught here instead. */
function thrown(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return assert.fail('expected a MethodSolverError, and nothing was thrown');
}

test('a stage whose contract fails is refused at the seam, naming the stage', () => {
  // The engine's own check, exercised. §2's composition claim only means something if a rung that
  // narrowed its contract is CAUGHT — and caught where it broke, not forty moves later where the
  // assembly guard would notice. Delete a stage's evidence and the checker must reject.
  const cross = LADDER.cross[0];
  const broken = { ...cross, contract: () => false };
  const method = { id: 'broken', rungs: {}, stages: [broken] };
  const err = thrown(() => solveByMethod(STATES[0], method));
  assert.ok(err instanceof MethodSolverError, `expected a MethodSolverError, got ${err}`);
  assert.equal(err.stage, 'cross');
  assert.equal(err.target, 'contract');
});

test('a stage handed a cube its keep set does not cover is refused before it runs', () => {
  // The other half of the seam. Running Pairs on an unsolved cross would produce steps that
  // cannot mean what they say, so the engine refuses rather than searching.
  const pairs = LADDER.pairs[0];
  const method = { id: 'pairs-alone', rungs: {}, stages: [pairs] };
  const err = thrown(() => solveByMethod(STATES[0], method));
  assert.ok(err instanceof MethodSolverError, `expected a MethodSolverError, got ${err}`);
  assert.equal(err.stage, 'pairs');
  assert.equal(err.target, 'keep');
});

test('a stage that returns a state its own steps do not reach is refused at that stage', () => {
  // A stage's boundary is a claim the LEARNER is shown — "the cross is done here". Checking the
  // contract against the state the stage HANDED BACK tests that claim against the stage's own word
  // for it; checking it against a replay of the moves it emitted tests it against the cube.
  //
  // The two differ, and the audit of 2026-09-09 found the case: a cross stage that emits `R` and
  // returns solved, followed by a stage that emits `R'`. The concatenation solves, so the assembly
  // guard passes, and the cross boundary is false the whole way through. Caught at the stage now,
  // by name, rather than not at all.
  const liar = {
    id: 'cross', rung: 0, label: 'liar', blurb: '',
    targets: { edges: [], corners: [] },
    keep: () => true,
    contract: () => true,
    why: 'stage.cross',
    run: (state, steps) => { steps.push({ stage: 'cross', kind: 'goal', target: 'cross', alg: 'R', why: { key: 'x' } }); return SOLVED; },
  };
  const undo = {
    id: 'pairs', rung: 0, label: 'undo', blurb: '',
    targets: { edges: [], corners: [] },
    keep: () => true,
    contract: () => true,
    why: 'stage.pairs',
    run: (state, steps) => { steps.push({ stage: 'f2l', kind: 'goal', target: 0, alg: "R'", why: { key: 'x' } }); return applyAlg(state, "R'"); },
  };
  const err = thrown(() => solveByMethod(SOLVED, { id: 'liar', rungs: {}, stages: [liar, undo] }));
  assert.ok(err instanceof MethodSolverError, `expected a MethodSolverError, got ${err}`);
  assert.equal(err.stage, 'cross');
  assert.equal(err.target, 'replay');
});

test('and the assembly guard still catches what no stage boundary can', () => {
  // The last line of defence, unchanged: every stage may be internally honest and the whole still
  // not solve, if a contract was too weak. Here both stages replay faithfully and both contracts
  // pass — and the cube is not solved.
  const lax = (id, alg) => ({
    id, rung: 0, label: 'lax', blurb: '',
    targets: { edges: [], corners: [] },
    keep: () => true,
    contract: () => true,
    why: `stage.${id}`,
    run: (state, steps) => {
      steps.push({ stage: id === 'cross' ? 'cross' : 'f2l', kind: 'goal', target: 0, alg, why: { key: 'x' } });
      return applyAlg(state, alg);
    },
  });
  const err = thrown(() => solveByMethod(SOLVED, {
    id: 'lax', rungs: {}, stages: [lax('cross', 'R'), lax('pairs', 'U')],
  }));
  assert.ok(err instanceof MethodSolverError, `expected a MethodSolverError, got ${err}`);
  assert.equal(err.stage, 'assembly');
});

test('a stage cannot edit the cube it was handed, or the steps that came before it', () => {
  // The audit's High, and it defeated BOTH guards at once. `before`, `s` and `start` were the same
  // object, so a stage that overwrote the arrays it was given made the replay's starting point
  // equal to the state it wanted to claim — and could then emit nothing at all. An `R` scramble
  // came back with an empty "solution" and every check passed, because every check was reading the
  // object the stage had just edited.
  const vandal = {
    id: 'cross', rung: 0, label: 'vandal', blurb: '',
    targets: { edges: [], corners: [] },
    keep: () => true,
    contract: () => true,
    why: 'stage.cross',
    run: (state) => {
      // Overwrite the input in place and emit nothing.
      state.cp = [...SOLVED.cp]; state.co = [...SOLVED.co];
      state.ep = [...SOLVED.ep]; state.eo = [...SOLVED.eo];
      return state;
    },
  };
  const scrambled = applyAlg(SOLVED, 'R');
  const err = thrown(() => solveByMethod(scrambled, { id: 'vandal', rungs: {}, stages: [vandal] }));
  assert.ok(err instanceof MethodSolverError, `an emitted-nothing lesson was accepted: ${err}`);

  // And the step history: a stage was handed the whole array and could rewrite an earlier stage's
  // algorithm AFTER that stage had been verified. A lesson came back as `R R'` with the cross
  // contract false behind it.
  const honest = {
    id: 'cross', rung: 0, label: 'honest', blurb: '',
    targets: { edges: [], corners: [] },
    keep: () => true,
    contract: () => true,
    why: 'stage.cross',
    run: (state, steps) => {
      steps.push({ stage: 'cross', kind: 'goal', target: 'cross', alg: 'R', why: { key: 'x' } });
      return applyAlg(state, 'R');
    },
  };
  const rewriter = {
    id: 'pairs', rung: 0, label: 'rewriter', blurb: '',
    targets: { edges: [], corners: [] },
    keep: () => true,
    contract: () => true,
    why: 'stage.pairs',
    run: (state, steps) => {
      // Reach back and change what the verified stage said it did.
      if (steps[0]) steps[0].alg = 'U';
      steps.push({ stage: 'f2l', kind: 'goal', target: 0, alg: "R'", why: { key: 'x' } });
      return applyAlg(state, "R'");
    },
  };
  const result = solveByMethod(SOLVED, { id: 'rw', rungs: {}, stages: [honest, rewriter] });
  assert.equal(result.steps[0].alg, 'R', 'a later stage rewrote a verified stage\'s algorithm');
});

test('a stage that returns something which is not a cube is named, not a TypeError', () => {
  // Reporting it from inside the comparison throws away the stage name and the replay this driver
  // exists to give.
  for (const returns of [undefined, null, 42, {}, { cp: [], co: [], ep: [], eo: [] }]) {
    const broken = {
      id: 'cross', rung: 0, label: 'broken', blurb: '',
      targets: { edges: [], corners: [] },
      keep: () => true,
      contract: () => true,
      why: 'stage.cross',
      run: () => returns,
    };
    const err = thrown(() => solveByMethod(SOLVED, { id: 'b', rungs: {}, stages: [broken] }));
    assert.ok(err instanceof MethodSolverError, `returning ${JSON.stringify(returns)} gave ${err}`);
    assert.equal(err.stage, 'cross');
    assert.equal(err.target, 'replay');
  }
});

test('a malformed cube is refused at the boundary, by name', () => {
  // An UNSOLVABLE cube is refused by the search — that is `MethodSolverError` doing its job, and
  // it is a real answer about a real cube. A malformed OBJECT is a different thing, and it used to
  // surface as an incidental TypeError from three modules down, or as a twist of 3 silently
  // normalised by the first move.
  const good = () => ({ cp: [...SOLVED.cp], co: [...SOLVED.co], ep: [...SOLVED.ep], eo: [...SOLVED.eo] });
  const cases = [
    [null, /cp must be an array/],
    [{}, /cp must be an array/],
    [{ ...good(), cp: [0, 1, 2, 3, 4, 5, 6] }, /cp must be an array of 8/],
    [{ ...good(), co: [3, 0, 0, 0, 0, 0, 0, 0] }, /co holds 3/],
    [{ ...good(), eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2] }, /eo holds 2/],
    [{ ...good(), cp: [0, 0, 2, 3, 4, 5, 6, 7] }, /cp is not a permutation/],
    [{ ...good(), ep: [0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, /ep is not a permutation/],
    [{ ...good(), co: [0, 0, 0, 0, 0, 0, 0, 1.5] }, /co holds 1.5/],
  ];
  for (const [bad, message] of cases) {
    assert.throws(() => solveByMethod(bad), message, `${JSON.stringify(bad)} was accepted`);
  }
  // And a well-formed but unsolvable cube is still the SEARCH's refusal, not the boundary's.
  const parity = good();
  [parity.ep[0], parity.ep[1]] = [parity.ep[1], parity.ep[0]];
  const err = thrown(() => solveByMethod(parity));
  assert.ok(err instanceof MethodSolverError, 'an unsolvable cube is a solver refusal, not a shape error');
});
