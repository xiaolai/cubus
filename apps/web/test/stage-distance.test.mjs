// The engine, and the guarantee that a wrong route cannot reach a screen.
//
// Phase C of dev-docs/solve-to-state-plan.md. `test/solve-to-state.test.mjs` grades the engine
// against the frozen oracle fixture and owns the projection pinning, the three-clause Bellman
// condition and the admissibility contract. This file owns what is left, and the split is by what
// each one can catch:
//
//   * MINIMALITY AGAINST THINGS THAT SHARE NO CODE. A plain breadth-first search over real cubes at
//     depths up to six, on a sample from every target; and the Rust crate's 42 F2L cases, whose
//     minima `bin/f2l-cross-check.rs` refutes by brute force with no heuristic, no ball and no
//     pruning. That binary's header is the clearest statement of the risk in this whole feature: a
//     heuristic that is wrong high does not crash, it returns a length that is not the minimum, and
//     every check that consults the same heuristic agrees with it.
//   * THE BUDGET, which must produce a refusal and never an error string and never a long answer.
//   * THE REPLAY AS A SHIPPED GUARANTEE. Not "a corrupted table is caught by a test" — a corrupted
//     table is caught in production, by `solveToState` itself, before its caller ever sees a route.
//     Asserted by handing the engine a deliberately wrong target and requiring nothing back.
//   * THE THREE-SOURCE RACE of §4, which is where a route can be wrong in ways the search cannot:
//     a prefix scan off by one, a method throw taking the pool's answer with it, a fallback allowed
//     to call itself the shortest.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MOVE_NAMES, SOLVED, applyAlg, applyMove, invert, movesOf } from '../lib/cube-pieces.js';
import { solveByMethod } from '../lib/method-solver.js';
import { PROJECTIONS, TARGETS, TARGET_BY_ID, targetById } from '../lib/stage-targets.js';
import {
  MAX_DEPTH, NODE_BUDGET, RADIUS, lowerBound, lowerBounds, projectionTable, solveToState, warmTables,
} from '../lib/stage-distance.js';
import {
  ROUTE_EXACT, ROUTE_FALLBACK, ROUTE_NONE, prefixReaching, routeToTarget, routesToTarget,
} from '../lib/stage-route.js';
import { pairsSolvedConfiguration } from './fixtures/f2l-positions.mjs';
import { seededScrambles, seededStates } from './fixtures/seeded-scrambles.mjs';

// Seeded and frozen. TWO per length, and it is a real trade rather than tidiness: the brute-force
// reference below is a breadth-first walk over real cubes to depth 5, about 430,000 cubes per
// query, and this file runs one per target per state. Six per length put the suite at two minutes
// on its own — longer than every other node suite here — and a heavy neighbour is not a private
// cost: at the tier's concurrency of six it starved `prove-controller.test.mjs`, whose timers then
// failed on a machine that was merely busy. `run-tests.mjs` records the same lesson from the
// browser tier, and its conclusion is the one followed here: the cause is contention, so the fix
// is to stop contending rather than to raise a timeout.
//
// What the smaller sample does not lose: the failure being guarded against — a table wrong at some
// code, a heuristic wrong high — is not rare in this population, and depth six is carried by the
// case above and by two oracles outside this file entirely.
const SHALLOW = [1, 2, 3, 4, 5].flatMap((len) => seededStates(2, 0x9d21 + len, len));

// ---- minimality against a search that shares nothing -------------------------------------------------

/**
 * A cube as twenty characters — one per piece, carrying its slot AND its orientation.
 *
 * The visited set below holds hundreds of thousands of these, so how a key is BUILT is most of
 * what this reference costs: the obvious `cp.join('')|co.join('')|…` form is four array joins and
 * three concatenations per cube, and measured it is twice as slow as packing each piece into one
 * code point. 2,236 ms against 1,100 ms for a single depth-5 query, which over a hundred queries
 * is the difference between a suite that fits in the tier and one that starves its neighbours.
 */
const cubeKey = (s) => {
  let k = '';
  for (let i = 0; i < 8; i++) k += String.fromCharCode(s.cp[i] * 3 + s.co[i]);
  for (let i = 0; i < 12; i++) k += String.fromCharCode(s.ep[i] * 2 + s.eo[i]);
  return k;
};

/** Exact distance to `pred` by breadth-first search over REAL cubes, or null beyond `cap`.
 *  No projection, no table, no heuristic — the only thing it shares with the engine is the cube. */
function bruteForce(state, pred, cap) {
  if (pred(state)) return 0;
  const key = cubeKey;
  let frontier = [state];
  const seen = new Set([key(state)]);
  for (let d = 1; d <= cap; d++) {
    const next = [];
    for (const s of frontier) {
      for (const m of MOVE_NAMES) {
        const t = applyMove(s, m);
        const k = key(t);
        if (seen.has(k)) continue;
        if (pred(t)) return d;
        seen.add(k);
        next.push(t);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The same question at depth SIX, by unguided iterative deepening — plan §9a's oracle 1 shape.
 *
 * TWO REFERENCES, AND EACH IS THE RIGHT SHAPE FOR ITS DEPTH. The breadth-first one above keeps a
 * visited set, which is what makes it efficient at four and five and what makes it impossible at
 * six: about 5.7 million real cubes, each a four-array object plus a forty-character key, is
 * roughly 1.8 GB — measured, as a heap abort, not estimated. This one keeps O(depth) memory and no
 * visited set at all, so it reaches six in about 3.8 million node visits.
 *
 * Pruning: no two consecutive turns on the same face, and nothing else. That is strictly weaker
 * than the engine's — which also fixes an order for commuting faces — and weaker on purpose: the
 * fewer rules a reference shares with the thing it grades, the more a disagreement means.
 */
function unguided(state, pred, cap) {
  if (pred(state)) return 0;
  const descend = (s, left, lastFace) => {
    for (const m of MOVE_NAMES) {
      if (m[0] === lastFace) continue;
      const t = applyMove(s, m);
      if (left === 1) {
        if (pred(t)) return true;
        continue;
      }
      if (descend(t, left - 1, m[0])) return true;
    }
    return false;
  };
  for (let d = 1; d <= cap; d++) if (descend(state, d, '')) return d;
  return null;
}

test('unguided iterative deepening agrees at depth SIX, where the visited-set reference cannot go', () => {
  // ONE PAIR, and the cost is why. A depth-six query is 3.8 million node visits and 5 to 19
  // seconds depending on what else the machine is doing; the case above runs 105 queries and this
  // one runs one, deliberately. `corners-home` is the pair, because it reads FIVE projections and
  // the heuristic is a maximum over all of them — the most places for a wrong-high value to hide.
  //
  // Depth six is not resting on this alone. The frozen fixture is established by meet in the
  // middle, exact to ten and cross-checked against a full-cube search wherever that reaches; and
  // `test/pattern-ledger.test.mjs` grades 73 distances at depths up to seven against an exhaustive
  // enumeration of every canonical maneuver, which shares no search, no table and no projection
  // with either. This case is the belt: one number at six, from a reference with a visited set
  // nowhere in it.
  const state = seededStates(1, 0x9d31, 6)[0];
  const target = targetById('corners-home');
  const truth = unguided(state, target.verify, 6);
  assert.equal(truth, 6, 'the seeded fixture must actually be six moves out, or this proves nothing at six');
  const got = solveToState(target, state, { nodeBudget: 4_000_000, maxDepth: 10 });
  assert.equal(got.moves, truth,
    `unguided iterative deepening says ${truth} and the engine says ${got.moves}`);
});

test('brute force over real cubes agrees exactly, on a sample from every target', () => {
  // Depth 5 for the BROAD pass, and the case above is why: a visited-set search cannot reach six
  // without exhausting the heap, and 105 queries of the shape that can would be minutes.
  const CAP = 5;
  let compared = 0;
  let nonTrivial = 0;
  for (const target of TARGETS) {
    for (const state of SHALLOW) {
      const truth = bruteForce(state, target.verify, CAP);
      if (truth === null) continue; // further than the reference can see; the fixture grades those
      const got = solveToState(target, state, { nodeBudget: 4_000_000, maxDepth: 10 });
      assert.equal(got.moves, truth,
        `${target.id}: brute force says ${truth} and the engine says ${got.moves}`);
      compared++;
      if (truth > 0) nonTrivial++;
    }
  }
  assert.ok(compared >= 30, `only ${compared} comparisons ran`);
  // A sample where every answer is zero would agree with an engine that always returns zero, which
  // is precisely the failure a wrongly-zero table produces.
  assert.ok(nonTrivial >= 15, `only ${nonTrivial} of the comparisons had any work in them`);
});

test("the crate's 42 proven F2L minima are the engine's `two-layers` answers", () => {
  // `crates/optimal-solver/tables/f2l.json`, refuted by brute force in Rust with no heuristic at
  // all. The comparison needs the OTHER three pairs solved, or the two questions are different
  // ones — the crate's number is about a single pair and `two-layers` is about four.
  const TABLE = new URL('../../../crates/optimal-solver/tables/f2l.json', import.meta.url);
  assert.ok(existsSync(TABLE), `the crate's F2L table is missing: ${TABLE.pathname}`);
  const { cases } = JSON.parse(readFileSync(TABLE, 'utf8'));
  assert.equal(cases.length, 42, 'the crate no longer has 42 cases — this comparison names that number');
  const target = targetById('two-layers');
  let worked = 0;
  for (const c of cases) {
    const state = pairsSolvedConfiguration(c.cornerSlot, c.cornerTwist, c.edgeSlot, c.edgeFlip);
    const got = solveToState(target, state, { nodeBudget: 8_000_000, maxDepth: 12 });
    assert.equal(got.moves, c.length,
      `${c.case} (${c.name}): the crate proves ${c.length} and the engine says ${got.moves}`);
    if (c.length > 0) worked++;
  }
  assert.ok(worked >= 40, `only ${worked} of the 42 cases had any work in them`);
});

// ---- the budget ----------------------------------------------------------------------------------

test('out of budget is a refusal — never an error, never a long answer', () => {
  const target = targetById('solved');
  const state = seededStates(1, 0x1234, 30)[0];
  const got = solveToState(target, state, { nodeBudget: 20_000, maxDepth: 14 });
  assert.equal(got.moves, null, 'a 20,000-node budget cannot solve a 30-turn scramble');
  assert.equal(got.alg, null, 'alg and moves are null together, or a caller can render one without the other');
  assert.equal(got.exact, false);
  assert.equal(typeof got.why, 'string', 'the reason is for a log, and it exists');
  // EXACTLY, not approximately. The check used to run once per sibling loop, so eighteen children
  // could be expanded between two of them and a goal found among those was accepted while already
  // over budget: `SOLVED·R` at `nodeBudget: 1` returned an exact answer after six nodes. Reproduced
  // by an audit, fixed by moving the check to immediately before the node is spent.
  assert.ok(got.nodes <= 20_000, `the search spent ${got.nodes} nodes against a 20,000 budget`);
  const tiny = solveToState('cross', applyAlg(SOLVED, 'R'), { nodeBudget: 1, maxDepth: 8 });
  assert.equal(tiny.moves, null, 'one node cannot buy an answer that costs six');
  assert.equal(tiny.nodes, 1, 'and it spends exactly the one node it was given');
  // …and the same cube with exactly enough budget does answer, so the refusal above is the budget
  // biting rather than the search being broken.
  const enough = solveToState('cross', applyAlg(SOLVED, 'R'), { nodeBudget: 6, maxDepth: 8 });
  assert.equal(enough.moves, 1);
  // A refusal is a statement about the SEARCH, never about the cube. The same cube, given room,
  // must be answerable — otherwise "no answer" would be describing the cube after all.
  const roomy = solveToState(targetById('cross'), state, { nodeBudget: 4_000_000, maxDepth: 10 });
  assert.notEqual(roomy.moves, null, 'the cross is always reachable inside the radius');
});

test('the shipped budget and radius are the numbers Phase B measured', () => {
  // Named, because a constant that drifts silently makes every claim about coverage stale. The
  // budget is what completes depth 10 — worst observed 3,271,621 nodes — and the radius is where
  // the corpus stops being answered. Both from `bench/solve-to-state-measure.mjs radius`.
  assert.equal(NODE_BUDGET, 4_000_000);
  assert.equal(RADIUS, 10);
  assert.ok(NODE_BUDGET > 3_271_621,
    'the budget must cover the worst depth-10 answer the corpus produced, or the radius is really 9');
  assert.ok(MAX_DEPTH > RADIUS, 'the depth cap must leave room past the radius, or R is the cap');
});

// ---- the heuristic, as an API rather than as a contract ---------------------------------------------

test('a lower bound is a bound, and for the cross it is the answer', () => {
  // The deep half is deliberately small and deliberately budgeted low: a 12-turn scramble costs
  // millions of nodes per target, and what this case is checking — that the bound never exceeds the
  // answer — is a property of every state, not of hard ones. The frozen fixture in
  // `solve-to-state.test.mjs` is where admissibility is graded against oracle-established numbers.
  const states = [...SHALLOW, ...seededStates(3, 0x77aa, 12)];
  for (const state of states) {
    for (const target of TARGETS) {
      const bound = lowerBound(target, state);
      const got = solveToState(target, state, { nodeBudget: 400_000, maxDepth: 10 });
      if (got.moves === null) continue;
      assert.ok(bound <= got.moves, `${target.id}: bound ${bound} exceeds the answer ${got.moves}`);
    }
    // `cross` is the one target whose table IS the distance, because the target is exactly the
    // preimage of its projected goal. That makes it the tightest admissibility check available.
    const cross = solveToState('cross', state, { nodeBudget: 400_000, maxDepth: 10 });
    assert.equal(lowerBound('cross', state), cross.moves,
      'the cross bound must equal the cross answer, not merely bound it');
  }
  const all = lowerBounds(SHALLOW[0]);
  assert.deepEqual(Object.keys(all), TARGETS.filter((t) => t.offered).map((t) => t.id));
});

test('a table is handed out as a COPY, and the engine keeps its own', () => {
  warmTables();
  const table = projectionTable('crossEdges');
  const at = PROJECTIONS.crossEdges.codeOf(applyAlg(SOLVED, "F2 R D'"));
  const was = table.dist[at];
  assert.notEqual(was, 0, 'the fixture state must not already be at the goal');
  table.dist[at] = 0; // the corruption `methods/cross.js` keeps `crossDistance` private to prevent
  assert.equal(projectionTable('crossEdges').dist[at], was, 'the engine handed out its own array');
  assert.equal(lowerBound('cross', applyAlg(SOLVED, "F2 R D'")), was);
  assert.throws(() => projectionTable('nope'), /no projection named/);
});

// ---- the replay, as a shipped guarantee -------------------------------------------------------------

test('a target with a corrupted goal set gets NO answer, and only the replay can tell', () => {
  // The plan's break table, row "a goal code the cube is not actually at" — the failure no amount
  // of internal consistency can catch, because every check that consults the same goal set agrees
  // with it. Built as a WRONG TARGET rather than by mutating the shipped one: the projections are
  // shared between five targets and their goal sets are deliberately untamperable, so the only way
  // to express this break is to construct an engine input that is wrong from the start — which is
  // also a truer model of the bug, since a real one would ship that way.
  const state = applyAlg(SOLVED, "F2 R D'");
  const honest = solveToState('cross', state, { nodeBudget: 400_000, maxDepth: 8 });
  assert.ok(honest.moves > 0, 'the honest search must have work to do, or this proves nothing');

  const real = PROJECTIONS.crossEdges;
  const here = real.codeOf(state);
  assert.equal(real.isGoal(here), false, 'the state must not already project onto a goal');
  // A projection identical to the real one except that it calls THIS cube a goal, and with an id of
  // its own so it builds its own table rather than borrowing the shipped one.
  const corrupted = { ...real, id: 'crossEdges-corrupted', goals: [...real.goals, here],
    isGoal: (code) => real.isGoal(code) || code === here };
  const wrongTarget = {
    id: 'cross-corrupted',
    projections: [corrupted],
    verify: TARGET_BY_ID.cross.verify,
    predicate: (s) => corrupted.isGoal(corrupted.codeOf(s)),
  };

  // Everything inside the mechanism now agrees the cube is already there. That is the assertion
  // that earns the replay: the projections are self-consistent, which is exactly why they cannot be
  // the check.
  assert.equal(wrongTarget.predicate(state), true,
    'the corrupted conjunction believes the cube is at the target — instantly, and with no doubt');

  // And the engine returns nothing, because the replay asks a predicate the corruption never
  // touched. A route is never merely "probably right" here: it is replayed or it is not shown.
  const got = solveToState(wrongTarget, state, { nodeBudget: 400_000, maxDepth: 8 });
  assert.equal(got.alg, null, 'a corrupted goal set must produce NO answer, never an empty one');
  assert.equal(got.moves, null);
  assert.match(got.why, /replay/, 'and it must say the replay is what refused it');

  // The shipped target is untouched by any of this — the corruption was never able to reach it.
  assert.equal(solveToState('cross', state, { nodeBudget: 400_000, maxDepth: 8 }).moves, honest.moves);
});

// ---- the three-source race -----------------------------------------------------------------------

/**
 * A cube well away from `two-layers`, and away from every other target — the population the
 * fallback exists for.
 *
 * THE FIRST VERSION OF THIS FIXTURE WAS A LAST-LAYER ALGORITHM, and three cases failed on it for a
 * reason worth keeping: every OLL and PLL algorithm preserves the first two layers by construction,
 * so a cube built from them is ALREADY at `two-layers` and the race yields "you are there" instead
 * of racing anything. A fixture that looks like a mess and is not one is the quietest way to make a
 * test assert nothing.
 */
const BROKEN = applyAlg(SOLVED, seededScrambles(1, 0x3f1c, 14)[0]);

test('the prefix scan stops at the FIRST move that reaches the target, and never one short', () => {
  const target = targetById('cross');
  // A scramble whose inverse solves it. Walking that inverse, the cross is reached somewhere in
  // the middle — the prefix scan must find that point and not the end.
  const scramble = "D2 R2 F2 U2";
  const state = applyAlg(SOLVED, scramble);
  const whole = invert(scramble);
  const found = prefixReaching(state, whole, target.verify);
  assert.ok(found, 'the inverse of a scramble certainly reaches the cross somewhere along it');
  assert.ok(target.verify(applyAlg(state, found.alg)), 'the prefix must actually land in the target');
  assert.equal(found.moves, movesOf(found.alg).length, 'the count and the algorithm are one answer');
  // ONE SHORT MUST NOT VERIFY — that is the whole of the off-by-one guard, and it is what makes the
  // replay in `stage-route.js` able to refuse a prefix scan that drifted.
  const oneShort = movesOf(found.alg).slice(0, -1).join(' ');
  assert.equal(target.verify(applyAlg(state, oneShort)), false,
    'a prefix one move short of the answer must fail the predicate, or the scan stopped late');

  assert.equal(prefixReaching(SOLVED, 'R U', target.verify).moves, 0, 'already there is zero moves');
  assert.equal(prefixReaching(applyAlg(SOLVED, 'D'), 'R U', target.verify), null,
    'a route that never reaches the target is null, not a best effort');
});

test("the pool's answer is presented as soon as it exists", async () => {
  const target = targetById('two-layers');
  assert.equal(target.verify(BROKEN), false, 'the fixture must have work to do, or nothing is raced');
  const seen = [];
  // No exact source and no method source: the pool alone must produce a usable route.
  for await (const route of routesToTarget(target, BROKEN, { pool: () => wholeSolve(BROKEN) })) {
    seen.push(route);
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, ROUTE_FALLBACK);
  assert.equal(seen[0].minimal, false, 'a truncated solve is an upper bound and may never claim minimality');
  assert.ok(target.verify(applyAlg(BROKEN, seen[0].alg)), 'and it must actually reach the target');
});

test('the method prefix replaces the pool only when it is shorter', async () => {
  const target = targetById('cross');
  const state = applyAlg(SOLVED, "R U R' F2 D");
  const long = `${'U '.repeat(4)}${wholeSolve(state)}`.trim();
  const short = wholeSolve(state);
  const shorterFirst = await collect(routesToTarget(target, state, {
    pool: () => long, method: () => short,
  }));
  assert.equal(shorterFirst.at(-1).moves, Math.min(...shorterFirst.map((r) => r.moves)),
    'the last route yielded must be the best one seen');
  // …and the other way round: a LONGER method answer must not replace the pool's.
  const poolWins = await collect(routesToTarget(target, state, {
    pool: () => short, method: () => long,
  }));
  assert.equal(poolWins.length, 1, 'a longer method prefix must not be yielded at all');
  assert.equal(poolWins[0].source, 'pool');
});

test('a method throw is absorbed, with the pool answer intact', async () => {
  const target = targetById('two-layers');
  const routes = await collect(routesToTarget(target, BROKEN, {
    pool: () => wholeSolve(BROKEN),
    method: () => { throw new Error('method solver: no step reaches oll/corners'); },
  }));
  assert.equal(routes.length, 1, 'the throw must not end the race');
  assert.equal(routes[0].kind, ROUTE_FALLBACK);
  assert.ok(target.verify(applyAlg(BROKEN, routes[0].alg)));
  // And a throw with no other source is a refusal, not an exception escaping to a screen.
  const alone = await routeToTarget(target, BROKEN, { method: () => { throw new Error('nope'); } });
  assert.equal(alone.kind, ROUTE_NONE);
  assert.equal(alone.alg, null);
});

test('an exact answer supersedes a fallback of the SAME length, because the claim differs', async () => {
  const target = targetById('cross');
  const state = applyAlg(SOLVED, "F2 R D'");
  const exact = solveToState(target, state, { nodeBudget: 400_000, maxDepth: 8 });
  assert.ok(exact.moves > 0);

  // THE EXACT SOURCE IS HELD, so the fallback genuinely lands first. Without the hold the exact
  // answer settles at once, wins the race, and the fallback is never yielded — which is correct
  // behaviour and tests nothing about supersession. The first version of this case did not hold it
  // and was asserting the ordering of a race it had already won.
  const held = deferred();
  const seen = [];
  const walk = (async () => {
    for await (const route of routesToTarget(target, state, {
      pool: () => exact.alg, // a fallback that happens to be exactly as short
      exact: () => held.promise,
    })) seen.push(route);
  })();
  await Promise.resolve(); // let the fallback settle and be yielded
  held.resolve({ alg: exact.alg, moves: exact.moves });
  await walk;

  assert.equal(seen.length, 2, 'both were yielded: the fallback first, then the stronger claim');
  assert.equal(seen[0].kind, ROUTE_FALLBACK);
  assert.equal(seen[0].minimal, false);
  assert.equal(seen[1].kind, ROUTE_EXACT);
  assert.equal(seen[1].minimal, true);
  assert.equal(seen[1].moves, seen[0].moves, 'same length, different claim');
});

test('an overshooting fallback is flagged — and reaching `solved` is arriving, not overshooting', async () => {
  // §6: "couldn't find a short way back to the top cross; the whole cube in 18". The wording is the
  // screen's; knowing it happened is this module's.
  //
  // AND THE CASE THAT WAS WRONG. This asserted `overshoot === true` for `solved`, on the reasoning
  // that reaching solved IS the whole solve — which inverts what the word means. A whole-cube
  // solution ENDS at the solved cube, so running to the end overshoots every target except that
  // one, and the screen read "couldn't find a short way back to the solved; the whole cube in 1".
  // Found by an audit; the flag is fixed rather than the sentence, because the flag was the wrong
  // fact.
  const state = applyAlg(SOLVED, "R U R' U'");
  const whole = wholeSolve(state);

  const solved = await routeToTarget('solved', state, { pool: () => whole });
  assert.equal(solved.kind, ROUTE_FALLBACK);
  assert.equal(solved.overshoot, false, 'the whole cube is where a whole-cube solution was going');
  assert.equal(solved.moves, movesOf(whole).length, 'and it is the whole answer, by construction');

  // A target the solution passes THROUGH stops early and overshoots nothing.
  const cross = await routeToTarget(targetById('cross'), state, { pool: () => whole });
  assert.equal(cross.moves, 0, 'the cross already holds, so nothing overshoots anything');

  // And a real overshoot: a target the whole solution never satisfies until its last move. `R U R'
  // U'` leaves the top corners permuted but twisted, so `corners-home` is reached only at the end.
  const twisted = applyAlg(SOLVED, "R U R' U' R U R' U'");
  const wholeTwisted = wholeSolve(twisted);
  const corners = await routeToTarget('corners-home', twisted, { pool: () => wholeTwisted });
  if (corners.moves === movesOf(wholeTwisted).length) {
    assert.equal(corners.overshoot, true, 'a prefix that IS the whole solution overshot the target');
  }
});

test('a route that fails the replay never escapes, whichever source produced it', async () => {
  const target = targetById('two-layers');
  // A source that hands back a plausible algorithm which does not reach the target. This is the
  // prefix-scan-off-by-one failure and the corrupted-search failure wearing the same clothes.
  const routes = await collect(routesToTarget(target, BROKEN, {
    pool: () => 'R U',
    exact: () => ({ alg: 'R U R', moves: 3 }),
  }));
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, ROUTE_NONE, 'nothing verified, so nothing is offered');
  assert.equal(routes[0].alg, null);
  assert.equal(routes[0].minimal, false);
});

/** A promise you settle by hand, so a completion ORDER can be asserted rather than hoped for. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('the sources are consumed in the order they FINISH, not the order they were started', async () => {
  // An audit found this: the first version awaited the sources in a fixed order, so a finished
  // exact answer sat behind a pending pool answer. That is the wrong way round — an exact answer
  // is minimal, and nothing that arrives later can improve on it.
  const target = targetById('cross');
  const state = applyAlg(SOLVED, "F2 R D'");
  const exact = solveToState(target, state, { nodeBudget: 400_000, maxDepth: 8 });
  assert.ok(exact.moves > 0);
  const slowPool = deferred();

  const seen = [];
  const walk = (async () => {
    for await (const route of routesToTarget(target, state, {
      exact: () => exact,
      pool: () => slowPool.promise,
    })) seen.push(route);
  })();
  // The exact answer settles at once; the pool has not answered and may never. If the loop waited
  // in start order this would hang until the timeout rather than finish.
  await walk;
  assert.equal(seen.length, 1, 'the exact answer is the only one worth yielding');
  assert.equal(seen[0].kind, ROUTE_EXACT);
  assert.equal(seen[0].minimal, true);
  slowPool.resolve(null); // nobody is waiting for it, and resolving must not throw
});

test('a source that rejects loses only its own answer', async () => {
  // Reproduced by an audit: an exact source that rejected made `routeToTarget` throw and discarded
  // a pool answer that had already verified — and, before that, raised an unhandled rejection,
  // because nothing handled the promise until the fallbacks had settled.
  const target = targetById('cross');
  const state = applyAlg(SOLVED, 'R');
  const route = await routeToTarget(target, state, {
    pool: () => "R'",
    exact: () => Promise.reject(new Error('the worker died')),
  });
  assert.equal(route.kind, ROUTE_FALLBACK, 'the pool answered, and a dead worker cannot take it away');
  assert.equal(route.moves, 1);
  // …and with no other source, a rejection is a refusal rather than an exception on a screen.
  const alone = await routeToTarget(target, state, { exact: () => Promise.reject(new Error('nope')) });
  assert.equal(alone.kind, ROUTE_NONE);
});

test('a source returning something that is not an algorithm loses only its own answer', async () => {
  // The prefix scan used to run OUTSIDE each source's failure boundary, so one unparseable token
  // threw out of `applyAlg` and took every other source's answer with it. `?` is enough.
  const target = targetById('cross');
  const state = applyAlg(SOLVED, 'R');
  const route = await routeToTarget(target, state, { pool: () => '? ? ?', method: () => "R'" });
  assert.equal(route.kind, ROUTE_FALLBACK);
  assert.equal(route.source, 'method', 'the good source answered; the bad one merely had nothing');
  assert.equal(route.moves, 1);
});

test('a cube already at the target answers zero and offers no walk', async () => {
  const route = await routeToTarget('cross', SOLVED, { pool: () => 'R U R\'' });
  assert.equal(route.moves, 0);
  assert.equal(route.alg, '');
  assert.equal(route.kind, ROUTE_EXACT, 'being there IS the shortest way there');
  assert.equal(movesOf(route.alg).length, 0, 'and an empty route must never render as a walk');
});

// ---- helpers -----------------------------------------------------------------------------------

async function collect(gen) {
  const out = [];
  for await (const route of gen) out.push(route);
  return out;
}

/**
 * A whole-cube solution, from the engine this file is NOT testing.
 *
 * The method solver rather than the two-phase pool: it is synchronous, deterministic and needs no
 * table build, so the fallback race can be tested without a worker or a five-second warm-up. What
 * the race does with the string is the same either way — it truncates it on the predicate.
 */
const wholeSolve = (state) => solveByMethod(state).alg;
