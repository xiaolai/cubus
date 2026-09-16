// The targets, as definitions — before any table is built and before anything is searched.
//
// Phase A of dev-docs/solve-to-state-plan.md. `lib/stage-targets.js` defines each named state as a
// CONJUNCTION of projected goals, which makes the plan's §2 Claim C true by construction. This file
// is the set of things that construction does NOT give you for free, and there are six of them.
//
// The order below is the order they can go wrong:
//
//   1. The conjunction is the same target the app already believes in. `methods/engine.js` has
//      independently written predicates for four of these stages; if the two disagree, one of them
//      is wrong and no amount of internal consistency will say which.
//   2. §1's nesting, as SET CONTAINMENT and not as an inequality between distances. The inequality
//      is a consequence; asserting a consequence without its cause is how a wrong table passes a
//      monotonicity check (plan §1's own counterexample).
//   3. §2 Claim A, `π(T) ⊆ G`, per table and per target it serves. This is the admissibility
//      obligation and it is what most of the feature rests on.
//   4. §2 Claim C for `cross` alone, as an EQUIVALENCE against the goal actually used — never as
//      fibre-agreement, which passes for a correct predicate and an empty goal set. The second
//      draft's test failed to test anything for exactly that reason, so the vacuous version is
//      built here and shown to pass, beside the real one failing it.
//   5. `top-cross`'s flip equivalence, in both directions: it holds under its precondition and does
//      not hold without it.
//   6. The two gaps §0 spent three drafts getting right — `solved` being invisible to the stage
//      projections, and `corners-home` being strictly weaker than the app's `topCornersHome`.
//
// Nothing here builds a distance table. `test/solve-to-state.test.mjs` does that, grades against the
// frozen oracle fixture, and owns the projection-steps pinning that every claim in this file
// silently depends on.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { parseFacelets } from '../lib/two-phase.js';
import * as eng from '../lib/methods/engine.js';
import { solveByMethod } from '../lib/method-solver.js';
import { NESTING, OFFERED_TARGETS, PROJECTIONS, TARGETS, TARGET_BY_ID, targetById } from '../lib/stage-targets.js';
import { CONTRACT_CUBES, ENGINE_CONTRACT_CUBES, WORKER_CUBES } from './fixtures/solver-cubes.mjs';
import { seededScrambles, seededStates } from './fixtures/seeded-scrambles.mjs';
import { turnsOf } from './fixtures/method-replay.mjs';
import { STAGE_TARGET_CASES } from './fixtures/stage-targets.mjs';
import { INDEPENDENT_PREDICATE } from './fixtures/independent-predicates.mjs';

// ---- the second definition ------------------------------------------------------------------------
//
// `target.verify`, not `target.predicate`. The first is `methods/engine.js`'s composition, written
// for the method solver long before this feature existed and reading `cp`/`co`/`ep`/`eo` directly;
// the second is the conjunction of projected goals. Two independently authored definitions of the
// same set, which is the only kind of check that can notice a target describing the wrong cube.
//
// THEY LIVE IN THE SAME MODULE, and that does not weaken the check: independence is a property of
// authorship, not of file paths. `verify` ships because plan §9a's runtime replay is worth exactly
// as much as the predicate it asks, and asking the conjunction would make it circular.

const INDEPENDENT = INDEPENDENT_PREDICATE;

// ---- the samples ---------------------------------------------------------------------------------
//
// Seeded and frozen, never drawn: a claim about a projection that moved with the shuffle would not
// be a claim. Three populations, because they fail differently — deep scrambles (nothing holds),
// shallow ones (some targets hold), and the app's own release fixtures (real solver states).

const DEEP = seededStates(60, 0x51a6);
const SHALLOW = [1, 2, 3, 4, 5, 6].flatMap((len) => seededStates(12, 0x51a6 + len, len));
const RELEASE = [...CONTRACT_CUBES, ...ENGINE_CONTRACT_CUBES, ...Object.values(WORKER_CUBES)]
  .map((facelets) => {
    const state = parseFacelets(facelets);
    assert.ok(state, `fixtures/solver-cubes.mjs holds an unparseable cube: ${facelets}`);
    return state;
  });
const FROZEN = STAGE_TARGET_CASES.map((row) => applyAlg(SOLVED, row.scramble));

/**
 * Every state along the app's own method route, for a seeded set of scrambles.
 *
 * THE POPULATION THIS FILE NEEDED AND THE FIRST DRAFT DID NOT HAVE. Scrambled cubes satisfy none of
 * these targets, so a sample made only of scrambles tests every equivalence in one direction and
 * declares victory: the first run of this file had three cross-solved cubes in 200 and two of its
 * cases said so rather than passing hollow. Walking the method route is where in-target cubes come
 * from — one solve yields a state at every stage boundary — and it costs one `solveByMethod` per
 * scramble rather than one per scramble per target.
 *
 * Independent of every projection, which is the property that makes it admissible evidence: the
 * route is built by the method solver against `methods/engine.js`'s predicates, and no goal code
 * takes part.
 */
function methodRouteStates(scrambles) {
  const out = [];
  const seen = new Set();
  const key = (s) => `${s.cp.join('')}|${s.co.join('')}|${s.ep.join(',')}|${s.eo.join('')}`;
  for (const scramble of scrambles) {
    let s = applyAlg(SOLVED, scramble);
    let lesson;
    try { lesson = solveByMethod(s); } catch { continue; }
    for (const step of lesson.steps) {
      s = applyAlg(s, turnsOf(step));
      const k = key(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

/** Built once: every case below that needs cubes INSIDE a target reads this. */
const ROUTE = methodRouteStates(seededScrambles(24, 0x4a11, 12));
const ALL = [...DEEP, ...SHALLOW, ...RELEASE, ...FROZEN, ...ROUTE, SOLVED];

/** SOLVED with two U corners twisted against each other. Legal (1 + 2 = 3) and the fixture §0's
 *  third correction turns on: it is identical to solved in every projection but `uCorners`. */
const TWISTED = Object.freeze({
  cp: [...SOLVED.cp], co: [1, 2, 0, 0, 0, 0, 0, 0],
  ep: [...SOLVED.ep], eo: [...SOLVED.eo],
});

/**
 * The cubes in `ROUTE` that satisfy `pred` — plan §7.2's generator, read off the shared pool.
 *
 * Every one of them was reached by the app's own solver and judged by the app's own predicate, so
 * nothing in the pipeline that put a cube in this list consulted a goal code.
 */
const statesSatisfying = (pred) => ROUTE.filter((s) => pred(s));

/**
 * States in the six-sided cross: every edge home and oriented, every corner free.
 *
 * The method route reaches this target only at the very end, so §7.2's generator cannot produce it
 * and §3a's construction is used instead. `R' D' R U R' D R U'` is a corner-only commutator, and
 * conjugating it by ANY maneuver leaves the edges untouched — the conjugator's effect on them is
 * undone by its own inverse — so `X C X'` is in the target for every X, and products of those are
 * too. Asserted below rather than trusted.
 */
function sixCrossStates(scrambles) {
  const C = "R' D' R U R' D R U'";
  const invert = (alg) => alg.trim().split(/\s+/).reverse()
    .map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`)).join(' ');
  return scrambles.map((x) => applyAlg(SOLVED, `${x} ${C} ${invert(x)}`));
}

// ---- 1. the conjunction is the app's own target ---------------------------------------------------

test("every target's conjunction of projected goals is the app's own predicate", () => {
  for (const target of TARGETS) {
    const independent = INDEPENDENT[target.id];
    assert.ok(independent, `${target.id} has no independently written predicate to check against`);
    let held = 0;
    for (const state of ALL) {
      const mine = target.predicate(state);
      assert.equal(mine, independent(state),
        `${target.id}: the conjunction of projected goals disagrees with the app's own predicate`);
      if (mine) held++;
    }
    // A sample on which the predicate is never true would agree with anything, including a
    // predicate that is constantly false. Every target must be exercised in both directions.
    assert.ok(held > 0, `${target.id} never held anywhere in a ${ALL.length}-cube sample`);
    assert.ok(held < ALL.length, `${target.id} held on every cube in the sample`);
  }
});

test('the offered chips are the five stages and solved, in nesting order', () => {
  // Plan §6: six chips. `six-cross` is a PATTERN and §9.6 says patterns are a separate product
  // decision that must not drift in because the mechanism allows them — so it is a target the
  // engine can answer and not a chip the screen offers, and that distinction is asserted rather
  // than left to whoever next reads the list.
  assert.deepEqual(OFFERED_TARGETS.map((t) => t.id), NESTING);
  assert.equal(TARGET_BY_ID['six-cross'].offered, false);
  assert.throws(() => targetById('no-such-target'), /no target named/);
});

// ---- 2. the nesting, as set containment ------------------------------------------------------------

test('the targets nest: a target holding forces every target above it to hold', () => {
  // Containment, not the distance inequality. §1's counterexample is the reason: for `SOLVED·R`
  // every true distance is 1, so corrupting the cross answer to 0 leaves `0 1 1 1 1` — monotone and
  // wrong. Monotonicity is worth having because it is free; it is not what proves the nesting.
  let sawEachHold = new Map(NESTING.map((id) => [id, 0]));
  for (const state of ALL) {
    let previousHeld = true;
    for (const id of NESTING) {
      const holds = TARGET_BY_ID[id].predicate(state);
      if (holds) {
        assert.ok(previousHeld,
          `${id} holds on a cube where the target that contains it does not — the nesting is broken`);
        sawEachHold.set(id, sawEachHold.get(id) + 1);
      }
      previousHeld = holds;
    }
  }
  for (const [id, n] of sawEachHold) {
    assert.ok(n > 0, `${id} never held, so the containment above it was never exercised`);
  }
});

test('the six-sided cross is deliberately NOT in the nesting', () => {
  // It constrains all twelve edges and no corners, so it is neither above nor below `two-layers`.
  // Both directions are exhibited, because "not nested" is a claim and not an omission.
  const inSix = sixCrossStates(seededScrambles(6, 0x2c05, 6));
  assert.ok(inSix.some((s) => !TARGET_BY_ID['two-layers'].predicate(s)),
    'a six-sided cross that is not two-layers must exist, or six-cross would be contained in it');
  assert.ok(!TARGET_BY_ID['six-cross'].predicate(applyAlg(SOLVED, 'U')),
    'SOLVED·U is two-layers-free of edges? it is not a six-sided cross, which is the other direction');
  assert.equal(NESTING.includes('six-cross'), false);
});

// ---- 3. Claim A: π(T) ⊆ G, per table and per target it serves --------------------------------------

test('every table a target uses has a goal set containing that target’s projection', () => {
  // §2 Claim A, and it is ALL a heuristic owes: a table BFS'd from a goal set G is admissible for
  // target T exactly when π(T) ⊆ G. Equality is not required and is not claimed anywhere.
  //
  // The sample is generated by the method solver against the app's own predicates, so no goal code
  // took part in deciding which cubes are in the target.
  // How many independently generated in-target cubes each target owes. NAMED per target rather than
  // written as one inequality, because `solved` is a SINGLE cube: a floor of eight for it would be
  // satisfied only by eight copies of the same state, which is not more evidence, and a pool that
  // deduplicates correctly can never meet it. Every other target is a set of millions.
  const MIN_IN_TARGET = {
    cross: 8, 'first-layer': 8, 'two-layers': 8, 'top-cross': 8, 'corners-home': 8,
    'six-cross': 8, solved: 1,
  };
  let totalChecked = 0;
  for (const target of TARGETS) {
    const inTarget = target.id === 'six-cross'
      ? sixCrossStates(seededScrambles(12, 0x4a11, 8))
      : statesSatisfying(INDEPENDENT[target.id]);
    assert.ok(inTarget.length >= MIN_IN_TARGET[target.id],
      `${target.id}: only ${inTarget.length} independently generated target states — too few to mean anything`);
    for (const state of inTarget) {
      assert.ok(INDEPENDENT[target.id](state), `${target.id}: the generator produced a cube outside the target`);
      for (const part of target.parts) {
        const proj = PROJECTIONS[part];
        assert.ok(proj.isGoal(proj.codeOf(state)),
          `${target.id}: a cube in the target projects outside ${part}'s goal set — its table is`
          + ' inadmissible, and an inadmissible heuristic returns a length that is not the minimum'
          + ' while every check that consults the same table agrees with it');
        totalChecked++;
      }
    }
  }
  assert.ok(totalChecked > 200, `only ${totalChecked} containment checks ran`);
  // And the exemption above is a fact rather than a licence: `solved` really is one cube, so a
  // future pool that starts yielding several of them means something else has gone wrong.
  assert.deepEqual(statesSatisfying(INDEPENDENT.solved), [SOLVED].map((s) => ({ ...s })),
    '`solved` must be exactly one state, which is why its floor is one');
});

test('the containment check has teeth: a table borrowed from another target fails it', () => {
  // The plan's break table, row "one table swapped for another target's". Without this the case
  // above could be a tautology, and a tautology that reads as coverage is worse than no test.
  const cross = targetById('cross');
  const states = statesSatisfying(INDEPENDENT.cross);
  assert.ok(states.length >= 6, 'not enough cross states to make the negative control mean anything');
  const borrowed = PROJECTIONS.dCorners;
  assert.ok(states.some((s) => !borrowed.isGoal(borrowed.codeOf(s))),
    'a cube with a solved cross and unsolved D corners must exist, or `first-layer` would be `cross`');
  // And the target's OWN parts still pass on the same cubes, so the control isolates the swap.
  for (const state of states) {
    for (const part of cross.parts) {
      assert.ok(PROJECTIONS[part].isGoal(PROJECTIONS[part].codeOf(state)));
    }
  }
});

// ---- 4. Claim C for `cross` alone, as an equivalence -------------------------------------------------

test('cross is exactly the preimage of its projected goal — asserted as an equivalence', () => {
  // §2 Claim C, needed only where an answer is read off a table by descending it, which is `cross`
  // alone (`methods/cross.js` rung 1 already does this). Every other target's answer comes from a
  // search over the real target predicate, so containment is all those tables owe.
  const proj = PROJECTIONS.crossEdges;
  const goal = (s) => proj.isGoal(proj.codeOf(s));
  let inside = 0, outside = 0;
  for (const state of ALL) {
    const held = eng.crossSolved(state);
    assert.equal(held, goal(state),
      'crossSolved and "the cross projection is at its goal" must be the same statement, in both'
      + ' directions, against the goal set actually used');
    if (held) inside++; else outside++;
  }
  assert.ok(inside >= 5, `only ${inside} cubes in the sample have a solved cross`);
  assert.ok(outside >= 50, `only ${outside} cubes in the sample do not — the equivalence needs both`);
});

test('fibre-agreement is NOT the check, and an empty goal set is how you can tell', () => {
  // This is the defect that killed the second draft's Phase A test, reproduced so the replacement
  // can be shown to catch what it did not. `π(a) = π(b) ⇒ P(a) = P(b)` proves a predicate factors
  // through a projection. It does not prove the FACTORED predicate is the goal the table was built
  // from — pick the right predicate and an empty goal set and fibre-agreement still passes.
  const vacuous = { isGoal: () => false, codeOf: PROJECTIONS.crossEdges.codeOf };

  // Fibre-agreement holds against the empty goal set, because it never mentions the goal set.
  const byCode = new Map();
  for (const state of ALL) {
    const code = vacuous.codeOf(state);
    const held = eng.crossSolved(state);
    if (byCode.has(code)) {
      assert.equal(byCode.get(code), held,
        'the app predicate must factor through the projection, which is all fibre-agreement says');
    } else {
      byCode.set(code, held);
    }
  }
  assert.ok(byCode.size > 50, 'the fibre-agreement sample must actually contain distinct codes');

  // And the equivalence — the check the case above runs — refuses it immediately.
  assert.ok(ALL.some((s) => eng.crossSolved(s) !== vacuous.isGoal(vacuous.codeOf(s))),
    'the equivalence must fail against an empty goal set, or it is the vacuous test wearing a name');
});

// ---- 5. the flip equivalence, in both directions -------------------------------------------------

test('under its precondition the flip coordinate IS "the top edges are oriented"', () => {
  // Plan §3. Edge flip cannot be tracked for four edges only — a move's effect on a slot's flip
  // depends on which slot fed it — so `top-cross` carries all twelve flips, which is two-phase's
  // FLIP coordinate. Under the cumulative precondition that the bottom eight edges are home, the
  // two statements coincide. The precondition is doing real work and this proves it.
  const flip = PROJECTIONS.flip;
  const bottomHome = (s) => [...eng.CROSS, ...eng.MIDDLE].every((e) => s.ep[e] === e && s.eo[e] === 0);
  let withPrecondition = 0;
  for (const state of ALL) {
    if (!bottomHome(state)) continue;
    withPrecondition++;
    assert.equal(flip.codeOf(state) === 0, eng.topEdgesOriented(state),
      'with the bottom eight edges home, flip === 0 and "the top edges are oriented" are one statement');
  }
  assert.ok(withPrecondition >= 5,
    `only ${withPrecondition} cubes in the sample satisfy the precondition — the equivalence was barely tested`);
});

test('without its precondition the flip equivalence is false, and here is a cube that shows it', () => {
  // The other direction, which is the one that makes the precondition load-bearing rather than
  // decorative. A cube whose four U edges are all oriented while some other edge is flipped
  // satisfies `topEdgesOriented` and has a non-zero flip coordinate.
  const flip = PROJECTIONS.flip;
  const witness = ALL.find((s) => eng.topEdgesOriented(s) && flip.codeOf(s) !== 0);
  assert.ok(witness,
    'no cube in the sample has oriented top edges and a non-zero flip coordinate, so this case proves nothing');
  assert.equal(eng.topEdgesOriented(witness), true);
  assert.notEqual(flip.codeOf(witness), 0);
  // The reverse implication does hold unconditionally and is asserted so the asymmetry is on record:
  // flip === 0 means every edge is unflipped, the top four included.
  for (const state of ALL) {
    if (flip.codeOf(state) === 0) assert.equal(eng.topEdgesOriented(state), true);
  }
});

// ---- 6. the two gaps §0 spent three drafts on -----------------------------------------------------

test('the stage projections cannot see a U-corner twist, so they may never be asked about `solved`', () => {
  // §0's third correction. A cube that is solved except for two twisted U corners is IDENTICAL to
  // solved in every stage projection, so a distance read off them would be ZERO for an unsolved
  // cube — the worst kind of wrong answer, because it is instant, certain and self-consistent.
  const STAGE_PROJECTIONS = ['crossEdges', 'midEdges', 'topEdges', 'dCorners', 'uCornerSlots', 'flip'];
  for (const id of STAGE_PROJECTIONS) {
    assert.equal(PROJECTIONS[id].codeOf(TWISTED), PROJECTIONS[id].codeOf(SOLVED),
      `${id} can see the difference between a twisted cube and a solved one, which no stage projection can`);
  }
  assert.equal(eng.wholeCubeSolved(TWISTED), false, 'and the cube is emphatically not solved');

  // The seventh projection is exactly what makes `solved` expressible, which is why §3a reversed
  // the exclusion the first three drafts wrote in.
  assert.notEqual(PROJECTIONS.uCorners.codeOf(TWISTED), PROJECTIONS.uCorners.codeOf(SOLVED));
  assert.equal(targetById('solved').predicate(TWISTED), false);
  assert.equal(targetById('solved').parts.includes('uCorners'), true,
    '`solved` must be built on the projection that can see a U-corner twist');
  // And no stage target reads it, so no stage target can be confused for `solved`.
  for (const id of ['cross', 'first-layer', 'two-layers', 'top-cross', 'corners-home']) {
    assert.equal(TARGET_BY_ID[id].parts.includes('uCorners'), false, `${id} must not read the U-corner twist`);
  }
});

test('`corners-home` is strictly weaker than the app\'s `topCornersHome`, and the twisted cube is the gap', () => {
  // §0, and the finding that reversed both earlier drafts: `last-layer.js` has `keep:
  // topFaceOriented`, so the app ORIENTS the top corners and only then permutes them. The owner's
  // stage 5 is the other order — corners home, possibly still twisted — which is what most
  // beginner books teach. The consequence is §9.4's product question, and it starts here.
  assert.equal(targetById('corners-home').predicate(TWISTED), true);
  assert.equal(eng.topCornersPlaced(TWISTED), true);
  assert.equal(eng.topCornersHome(TWISTED), false,
    'the gap is real: all four top corners in their own slots, two of them twisted');

  // Strict, not "up to a U turn". The bottom two layers are solved by then, so the side colours are
  // fixed and a corner is home or it is not — which is how a child is taught to check it.
  const rotated = applyAlg(SOLVED, 'U');
  assert.equal(eng.topCornersPlaced(rotated), false,
    'a whole top layer turned one quarter must NOT count as corners-home');
  assert.equal(targetById('corners-home').predicate(rotated), false);

  // And `topCornersHome` implies `topCornersPlaced` everywhere, so the weaker one really is weaker
  // rather than merely different.
  for (const state of ALL) {
    if (eng.topCornersHome(state)) assert.equal(eng.topCornersPlaced(state), true);
  }
});
