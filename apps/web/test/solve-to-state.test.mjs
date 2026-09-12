// Stage-target distances: the projections, the predicates, the frozen answers, and the one check
// that makes a wrong route undisplayable.
//
// The engine under test is `lib/stage-targets.js` and `lib/stage-distance.js` — Phase C of
// dev-docs/solve-to-state-plan.md. Through Phase 0 it was a bench spike, since deleted, which was
// the only engine there was; the swap was an import and nothing else, because the fixture this
// file grades against is FROZEN and every assertion below had to hold across it.
//
// Four things are checked, in the order they can go wrong, and the ORDER is the argument:
//
//   1. The projection steps with the cube. Everything else rests on it, and oracle B in
//      `bench/solve-to-state-oracle.mjs` shares exactly this much with the engine — so this test is
//      what that sharing costs. Modelled on f2l.rs's `the_projection_and_the_cube_step_together`.
//   2. Each target's conjunction of projected goals agrees with the app's own predicate in
//      `methods/engine.js`, which is a second and independently written definition. This is the
//      plan's §2 Claim C as a cross-check between two definitions rather than a proof about one.
//   3. Every table is a true distance function: zero at the goal, one more than its cheapest
//      neighbour everywhere reachable, sentinel everywhere else. Three clauses and not one — the
//      single-clause version is false AT the goal, because a U turn maps the cross projection to
//      itself and would demand 0 = 1 + 0.
//   4. The frozen distances are reproduced exactly.
//
// And then the one that matters most, last because it is about what happens when 1 to 4 have failed:
// a route is replayed against the app's predicate before it is believed, so a corrupted goal set
// produces NO answer rather than a wrong one.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { MOVE_NAMES, SOLVED, applyAlg, applyMove } from '../lib/cube-pieces.js';
import { PROJECTIONS, TARGETS } from '../lib/stage-targets.js';
import { lowerBound, projectionTable, solveToState } from '../lib/stage-distance.js';
import { fullCubeDistance, goalBall, meetInTheMiddle } from '../bench/solve-to-state-oracle.mjs';

import { STAGE_TARGET_CASES, TARGET_IDS } from './fixtures/stage-targets.mjs';
import { seededStates } from './fixtures/seeded-scrambles.mjs';

/** Each target's INDEPENDENT predicate — `methods/engine.js`'s, not the conjunction of projected
 *  goals. `lib/stage-targets.js` explains why it ships rather than living in a test fixture. */
const PREDICATE = Object.fromEntries(TARGETS.map((t) => [t.id, t.verify]));
/** The engine, at the budget the frozen fixture was established against. */
const searchExact = (target, state, opts = { nodeBudget: 4_000_000, maxDepth: 14 }) =>
  solveToState(target, state, opts);
/** The tables, as copies. Built once here so the whole file reads one set. */
const TABLE = Object.fromEntries(Object.keys(PROJECTIONS).map((id) => [id, projectionTable(id)]));

/** Seeded, never drawn: a projection claim that moved with the shuffle would not be a claim. */
const SAMPLE = seededStates(40, 0x5747);
const FROZEN = STAGE_TARGET_CASES.map((row) => ({ ...row, state: applyAlg(SOLVED, row.scramble) }));
const ALL = [...SAMPLE, ...FROZEN.map((r) => r.state), SOLVED];

// ---- 1. the projection steps with the cube -----------------------------------------------------

test('every projection steps with the cube, on all 18 moves', () => {
  for (const [id, proj] of Object.entries(PROJECTIONS)) {
    for (const state of ALL) {
      const code = proj.codeOf(state);
      for (let m = 0; m < MOVE_NAMES.length; m++) {
        const stepped = proj.stepCode(code, m);
        const projected = proj.codeOf(applyMove(state, MOVE_NAMES[m]));
        assert.equal(
          stepped, projected,
          `${id}: stepping the code disagrees with projecting the stepped cube, on ${MOVE_NAMES[m]}`,
        );
      }
    }
  }
});

test('a projection is blind to exactly what it does not track', () => {
  // Two cubes agreeing on a projection's tracked pieces must get the same code. Built by hand
  // rather than sampled: SOLVED with two top corners twisted is legal (1 + 2 = 3, a multiple of 3)
  // and is the fixture round 3 of the plan's review used, so it stays named.
  const twisted = {
    cp: [...SOLVED.cp], co: [1, 2, 0, 0, 0, 0, 0, 0],
    ep: [...SOLVED.ep], eo: [...SOLVED.eo],
  };
  assert.equal(PROJECTIONS.crossEdges.codeOf(twisted), PROJECTIONS.crossEdges.codeOf(SOLVED), 'a cross table cannot see a top corner');
  assert.equal(PROJECTIONS.dCorners.codeOf(twisted), PROJECTIONS.dCorners.codeOf(SOLVED), 'a D-corner table cannot see a U corner');
  assert.notEqual(PROJECTIONS.uCorners.codeOf(twisted), PROJECTIONS.uCorners.codeOf(SOLVED), 'the U-corner table is what makes `solved` expressible');
  // And the slot-only table is deliberately blind to the same twist, which is why `corners-home` is
  // one projected goal rather than 81 — see CORNER_SLOT_STEP in lib/stage-targets.js.
  assert.equal(PROJECTIONS.uCornerSlots.codeOf(twisted), PROJECTIONS.uCornerSlots.codeOf(SOLVED), 'the slot-only table must not see a twist');
});

// ---- 2. the conjunction is the app's predicate --------------------------------------------------

test('each target\'s projected goals agree with the app\'s own predicate', () => {
  for (const target of TARGETS) {
    const independent = PREDICATE[target.id];
    assert.ok(independent, `${target.id} has no independently written predicate to check against`);
    for (const state of ALL) {
      assert.equal(
        target.predicate(state), independent(state),
        `${target.id}: the conjunction of projected goals disagrees with methods/engine.js`,
      );
    }
  }
});

test('the targets nest, so the distances cannot decrease', () => {
  // Set containment first: it is the reason the distance inequality holds, so asserting the
  // inequality alone would be asserting a consequence without its cause.
  const ORDER = ['cross', 'first-layer', 'two-layers', 'top-cross', 'corners-home', 'solved'];
  for (const state of ALL) {
    let previousHeld = true;
    for (const id of ORDER) {
      const holds = PREDICATE[id](state);
      if (holds) assert.ok(previousHeld, `${id} holds on a cube where the target below it does not`);
      previousHeld = holds;
    }
  }
  for (const row of FROZEN) {
    let last = -1;
    for (const id of ORDER) {
      const d = row.d[id];
      if (d === null) { last = Infinity; continue; }
      assert.ok(d >= last, `${row.scramble}: ${id} is ${d}, below the target beneath it`);
      last = d;
    }
  }
});

// ---- 3. every table is a true distance function -------------------------------------------------

test('every table is zero at its goal, one above its cheapest neighbour, and sentinel elsewhere', () => {
  for (const [id, proj] of Object.entries(PROJECTIONS)) {
    const { dist } = TABLE[id];
    let reachable = 0, sentinels = 0;
    for (let code = 0; code < dist.length; code++) {
      const d = dist[code];
      if (d === 255) { sentinels++; continue; }
      reachable++;
      if (proj.isGoal(code)) {
        assert.equal(d, 0, `${id}: code ${code} is a goal and must be 0`);
        continue;
      }
      assert.notEqual(d, 0, `${id}: code ${code} is zero and is NOT a goal — a table entry that is`
        + ' wrongly zero returns an empty route for an unsolved cube, for the life of the process');
      let cheapest = 255;
      for (let m = 0; m < MOVE_NAMES.length; m++) {
        const n = dist[proj.stepCode(code, m)];
        if (n < cheapest) cheapest = n;
      }
      assert.equal(d, cheapest + 1, `${id}: code ${code} is ${d} with a cheapest neighbour of ${cheapest}`);
    }
    assert.equal(reachable, TABLE[id].reachable, `${id}: reachable count drifted`);
    assert.equal(reachable + sentinels, dist.length, `${id}: every code is reachable or sentinel`);
  }
});

test('the tables are the sizes and diameters they were measured at', () => {
  // Named numbers, because a table that quietly changed shape is a different projection and every
  // distance taken from it is about a different question. dev-docs/solve-to-state-plan.md §3a.
  const EXPECTED = {
    crossEdges: [190080, 8], midEdges: [190080, 8], topEdges: [190080, 8],
    dCorners: [136080, 7], uCorners: [136080, 7], uCornerSlots: [1680, 4], flip: [2048, 7],
  };
  assert.deepEqual(Object.keys(PROJECTIONS).sort(), Object.keys(EXPECTED).sort(), 'a projection was added or removed');
  for (const [id, [reachable, diameter]] of Object.entries(EXPECTED)) {
    assert.equal(TABLE[id].reachable, reachable, `${id}: reachable states`);
    assert.equal(TABLE[id].diameter, diameter, `${id}: diameter`);
  }
  // The middle-edge group's first shell is 12 where the other two edge groups are 15, because six
  // moves leave the E slice in place against three. A transcription slip could not produce that.
  assert.equal(TABLE.midEdges.layers[1], 12, 'the E-slice first shell is what proves the projection');
  assert.equal(TABLE.crossEdges.layers[1], 15);
  assert.equal(TABLE.topEdges.layers[1], 15);
});

// ---- 4. the frozen answers --------------------------------------------------------------------

test('the frozen fixture covers every target and is not an empty promise', () => {
  assert.deepEqual(TARGET_IDS, TARGETS.map((t) => t.id), 'the fixture was frozen against a different target list');
  assert.ok(FROZEN.length >= 40, `only ${FROZEN.length} frozen cases`);
  // A fixture of nothing but refusals would pass every grading assertion below while checking
  // nothing, so the spread is asserted too.
  const answered = FROZEN.filter((r) => r.d['corners-home'] !== null).length;
  assert.ok(answered >= 30, `only ${answered} frozen cases have a real answer for corners-home`);
  const deepest = Math.max(...FROZEN.flatMap((r) => Object.values(r.d).filter((d) => d !== null)));
  assert.ok(deepest >= 8, `the deepest frozen answer is only ${deepest} — the corpus is too shallow to grade`);
});

test('the engine reproduces every frozen distance, and refuses where the oracle could not reach', () => {
  for (const row of FROZEN) {
    for (const target of TARGETS) {
      const want = row.d[target.id];
      if (want === null) {
        // The oracle found nothing within 10. The engine must not contradict it, and is bounded so
        // that saying so is cheap. A refusal here is a statement about the search, never the cube.
        const got = searchExact(target, row.state, { maxDepth: 10, nodeBudget: 1_500_000 });
        assert.equal(got.moves, null,
          `${target.id} / ${row.scramble}: engine claims ${got.moves} where the oracle found nothing within 10`);
        continue;
      }
      const got = searchExact(target, row.state);
      assert.equal(got.moves, want,
        `${target.id} / ${row.scramble}: frozen ${want}, engine ${got.moves}`);
    }
  }
});

test('every table is a LOWER bound on the frozen distance, and the cross table is exactly it', () => {
  // Added 2026-09-11 after the suite failed to fail. The engine's heuristic was deliberately made
  // wrong high by one and every assertion above stayed green, because a wrong-high heuristic changes
  // the ANSWER only when move ordering happens to surface a longer path first — so grading answers
  // catches it by luck, and luck is not a gate. This checks admissibility itself, against numbers an
  // oracle established, which is deterministic.
  //
  // §2 Claim A is the property: each table is BFS'd from a goal set containing the projection of the
  // whole target, so its value can never exceed the true distance.
  for (const row of FROZEN) {
    for (const target of TARGETS) {
      const want = row.d[target.id];
      if (want === null) continue;
      const codes = target.codesOf(row.state);
      target.parts.forEach((part, i) => {
        const bound = TABLE[part].dist[codes[i]];
        assert.ok(bound <= want,
          `${target.id} / ${row.scramble}: ${part} bounds the distance at ${bound}, above the true ${want}`
          + ' — an inadmissible heuristic makes a search return something that is not the minimum, and'
          + ' every check that consults the same table agrees with it');
      });
      // And the FUNCTION the search actually calls, not only the tables it reads. The first version
      // of this test checked the tables alone and stayed green against a heuristic deliberately made
      // wrong high, because the break was in the combination and nothing looked at the combination.
      assert.ok(lowerBound(target, row.state) <= want,
        `${target.id} / ${row.scramble}: the heuristic returns ${lowerBound(target, row.state)} for a true`
        + ` distance of ${want} — it is the function the search prunes with, so this is the claim`);
    }
  }
  // The cross projection is not merely a bound: the target is exactly the preimage of its goal, so
  // the table IS the distance. That makes this the tightest available admissibility check, and the
  // one a wrong-high heuristic cannot survive.
  for (const row of FROZEN) {
    const want = row.d.cross;
    if (want === null) continue;
    assert.equal(TABLE.crossEdges.dist[PROJECTIONS.crossEdges.codeOf(row.state)], want,
      `${row.scramble}: the cross table must equal the cross distance, not merely bound it`);
  }
});

test('every route the engine returns actually reaches its target', () => {
  for (const row of FROZEN) {
    for (const target of TARGETS) {
      if (row.d[target.id] === null) continue;
      const got = searchExact(target, row.state);
      assert.ok(PREDICATE[target.id](applyAlg(row.state, got.alg)),
        `${target.id} / ${row.scramble}: route "${got.alg}" does not satisfy the app's own predicate`);
    }
  }
});

// ---- the check that makes a wrong route undisplayable -------------------------------------------

test('a corrupted goal set returns a route that does not reach the target, and only the replay notices', () => {
  // One row of the plan's break table, and the most valuable one, because it is the failure no
  // amount of internal consistency can catch: every check that consults the same tables agrees with
  // them. The break is the one the plan keeps naming — a goal code the cube is not actually at —
  // and its consequence is the one `methods/cross.js` keeps its distance table private to prevent:
  // an EMPTY route for an unsolved cube, returned confidently, for the life of the process.
  //
  // BUILT AS A WRONG TARGET RATHER THAN BY MUTATING THE RIGHT ONE. The first version of this case
  // reached into the shipped projection and added a goal code to it. That is no longer possible —
  // `lib/stage-targets.js` keeps the goal set private behind `isGoal`, because a projection is
  // shared between up to five targets and a stray `add` would change all of them at once — and the
  // construction here is the better model anyway: a real corruption would SHIP that way, not be
  // applied at runtime and taken back.
  //
  // `cross` is used because it has exactly one projection, so one wrong code is the whole break.
  const real = PROJECTIONS.crossEdges;
  const state = applyAlg(SOLVED, "F2 R D'");
  assert.equal(PREDICATE.cross(state), false, 'the fixture state must NOT have a solved cross');

  const honest = searchExact(TARGETS.find((t) => t.id === 'cross'), state);
  assert.ok(honest.moves > 0, 'the honest search must have work to do, or this proves nothing');
  assert.ok(PREDICATE.cross(applyAlg(state, honest.alg)), 'and its route must be real');

  const here = real.codeOf(state);
  assert.equal(real.isGoal(here), false, 'the state must not already project onto a goal');
  const corruptedProjection = {
    ...real,
    id: 'crossEdges-corrupted', // its own id, so it builds its own table rather than borrowing
    goals: [...real.goals, here],
    isGoal: (code) => real.isGoal(code) || code === here,
  };
  const wrongTarget = {
    id: 'cross-corrupted',
    parts: ['crossEdges-corrupted'],
    projections: [corruptedProjection],
    predicate: (s) => corruptedProjection.isGoal(corruptedProjection.codeOf(s)),
    verify: PREDICATE.cross,
    codesOf: (s) => [corruptedProjection.codeOf(s)],
    atGoal: (codes) => corruptedProjection.isGoal(codes[0]),
  };

  // The mechanism is now wrong, and wrong in the worst available way: it is certain, instant, and
  // internally consistent. Nothing that reads the projections can tell.
  assert.equal(wrongTarget.predicate(state), true,
    'the corrupted conjunction says the cube is already there — the projections agree with'
    + ' themselves, which is exactly why they cannot be the check');
  assert.equal(wrongTarget.atGoal(wrongTarget.codesOf(state)), true);

  // And the engine returns NOTHING, because the replay asks a predicate the corruption never
  // touched. This is the guarantee that makes every other bug in this feature harmless: a route is
  // replayed or it is not returned, so a wrong route cannot exist to be displayed.
  const corrupted = solveToState(wrongTarget, state, { nodeBudget: 400_000, maxDepth: 8 });
  assert.equal(corrupted.alg, null, 'a corrupted goal set must produce NO answer, never an empty one');
  assert.equal(corrupted.moves, null);
  assert.match(corrupted.why, /replay/, 'and it must say the replay is what refused it');

  // The shipped projection is untouched: the corruption was never able to reach it.
  const after = searchExact(TARGETS.find((t) => t.id === 'cross'), state);
  assert.equal(after.moves, honest.moves, 'the shipped target answered exactly as it did before');
  assert.equal(real.isGoal(here), false);
});

test('the ORACLES are exercised, not just the answers they once produced', () => {
  // The audit's sharpest finding about this file: every case here graded the ENGINE against frozen
  // numbers, so both oracles could be replaced with `return 0` and the suite stayed green. The frozen
  // fixture is only as good as the oracles that made it, and nothing was checking them.
  //
  // WHAT THIS CASE STILL CANNOT DO, and where it is done instead. Oracle A runs out at five moves, so
  // this case grades oracle B's claimed range only as far as five. `test/pattern-ledger.test.mjs`
  // covers six and seven: the pattern ledger's distances come from an exhaustive enumeration of every
  // canonical maneuver to depth 7, which shares no search, no table and no projection with either
  // oracle, and 60 of its 73 rows sit past oracle A's ceiling.
  //
  // Oracle A is full-cube breadth-first search asked of the app's own predicates; oracle B is meet in
  // the middle over a radius-5 goal ball. Where A reaches, the two must agree, and both must agree
  // with the frozen answer. Three things that share no search, on the same cubes.
  const target = TARGETS.find((t) => t.id === 'two-layers');
  const ball = goalBall(target, 5);
  let agreed = 0, reached = 0;
  for (const row of FROZEN.slice(0, 18)) {
    const want = row.d['two-layers'];
    const b = meetInTheMiddle(row.state, target, ball, 5);
    assert.equal(b, want, `${row.scramble}: oracle B says ${b}, the frozen fixture says ${want}`);
    const a = fullCubeDistance(row.state, PREDICATE['two-layers'], 5);
    // A REFUSAL IS A CLAIM TOO. Oracle A searches to depth 5, so on a case the frozen fixture puts at
    // 5 or fewer it MUST reach — treating null as "nothing to compare" let a crippled A (capped at 3)
    // pass the whole case. Found by audit.
    if (want !== null && want <= 5) {
      assert.notEqual(a, null,
        `${row.scramble}: oracle A refused a cube the fixture puts ${want} moves out, inside its own depth of 5`);
    }
    if (a !== null) {
      reached++;
      assert.equal(a, b, `${row.scramble}: oracle A says ${a} and oracle B says ${b}`);
      assert.ok(want === null || a === want, `${row.scramble}: oracle A says ${a}, the fixture says ${want}`);
    }
    agreed++;
  }
  assert.ok(agreed >= 18, 'too few rows checked for this to mean anything');
  assert.ok(reached >= 5, `oracle A only reached ${reached} of them — it is capped at 5 and needs shallow cases`);

  // And the ball must be a ball: zero at the goal, and every entry no further than its radius.
  const solvedCodes = target.codesOf(SOLVED);
  assert.equal(meetInTheMiddle(SOLVED, target, ball, 5), 0, 'a solved cube is zero moves from two-layers');
  assert.ok(target.atGoal(solvedCodes), 'and it is at the goal by the projections too');
  const depths = new Set([...ball.ball.values()]);
  assert.deepEqual([...depths].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], 'the ball must hold exactly depths 0..5');
  // And a ball built for one target must refuse another's question rather than answer it quietly.
  const other = TARGETS.find((t2) => t2.id === 'solved');
  assert.throws(() => meetInTheMiddle(SOLVED, other, ball, 5), /built for/,
    'a mismatched ball must be refused, not silently used');
});

// ---- the plan's own stamp, checked against this file ---------------------------------------------
//
// Phase 0's stamp in dev-docs/solve-to-state-plan.md says how many cases this suite has, and on
// 2026-09-12 it said eleven when there were twelve. The twelfth was added the same day the stamp was
// written, by the break-test that found a wrong-high heuristic sailing past every graded answer — so
// the number was stale within the hour, and nothing would ever have said so.
//
// Both sides are READ. Neither is typed into this file, which is the difference between a check and a
// second place to be wrong. dev-docs is gitignored (AGENTS.md), so this skips on a clean clone and
// never passes there; the anchor below makes a wrong PATH fail instead of skipping, the distinction
// solving-method-phases-note.test.mjs exists to draw.

const REPO = new URL('../../../', import.meta.url);
const PLAN = fileURLToPath(new URL('dev-docs/solve-to-state-plan.md', REPO));
const DEV_DOCS = fileURLToPath(new URL('dev-docs', REPO));
const ANCHOR = fileURLToPath(new URL('apps/web/lib/cube-pieces.js', REPO));
if (!existsSync(ANCHOR)) {
  throw new Error(`this test's path arithmetic is wrong: ${ANCHOR} does not exist, so ${PLAN} proves nothing`);
}

/**
 * A MISSPELLED FILENAME MUST FAIL, and the repo-root anchor above does not make it.
 *
 * An audit changed `solve-to-state-plan.md` to `solve-to-state-plna.md` and this case SKIPPED, with
 * the skip saying the note was gitignored. That is exactly the confusion the anchor was added to
 * prevent, one level down: the anchor proves the arithmetic reaches the repository, and says nothing
 * about the filename inside it.
 *
 * The discriminator is the directory. `dev-docs/` absent means a clean clone and a legitimate skip;
 * `dev-docs/` present with the named file missing means the name is wrong, or the note was deleted
 * while a test still claimed to check it. Both of those are defects and both now throw.
 */
function planOrSkip(t) {
  if (!existsSync(DEV_DOCS)) {
    t.skip('dev-docs is absent — gitignored, so a clean clone cannot check the plan');
    return null;
  }
  if (!existsSync(PLAN)) {
    throw new Error(`dev-docs exists but ${PLAN} does not: the filename is wrong, or the note this `
      + 'test checks has been deleted. Either way this is not the clean-clone case.');
  }
  return readFileSync(PLAN, 'utf8');
}

test("the plan's Phase 0 stamp states the number of cases this file actually has", (t) => {
  const plan = planOrSkip(t);
  if (plan === null) return;

  // EVERY REGISTRATION, not every line that happens to start with `test(`. An audit appended
  // `test.skip('…')` and this case passed while the stamp still said 13 against 14 registrations.
  const own = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const mine = own.match(/^test(?:\.\w+)?\(/gm)?.length;
  assert.ok(mine > 0, 'this file declares no top-level cases, so the count below would be meaningless');
  // And the stamp records a case count AND a pass count as the same number, which is only true while
  // every case runs and passes. A skipped or todo case makes those two numbers differ, so it has to
  // be a red here rather than a silent divergence between the stamp and the runner.
  assert.equal(own.match(/^test\.(?:skip|todo)\(/gm), null,
    'a skipped or todo case makes the stamp\'s "N cases" and "N pass" different numbers — '
      + 'say both in the plan and teach this case to read them separately');

  const declared = plan.match(/`test\/solve-to-state\.test\.mjs` \((\d+) cases/);
  assert.ok(declared, "the plan no longer states this suite's case count in the form this test reads");
  assert.equal(Number(declared[1]), mine,
    `the plan's Phase 0 stamp says ${declared[1]} cases and this file has ${mine}`);

  const verified = plan.match(/`node --test test\/solve-to-state\.test\.mjs` — (\d+) pass/);
  assert.ok(verified, 'the plan no longer records a run of this suite in the form this test reads');
  assert.equal(Number(verified[1]), mine,
    `the plan's Verified line says ${verified[1]} passed and this file has ${mine} cases`);
});
