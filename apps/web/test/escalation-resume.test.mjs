// Continuing a search instead of starting it again, and the one thing that makes it safe.
//
// When a promised target refuses, `solveWithinGodsNumber` doubles the budget and asks again. Until
// 2026-09-05 the new ask began at phase-1 depth 0 and re-walked every node the last one had
// already walked; the work BELOW the depth the search died in — exactly the part a resume skips —
// was measured at 32/48/50/52/88 % of the budget across five exhausted runs
// (dev-docs/solver-move-count.md §7).
//
// It was deferred for one reason and one only, and this file is that reason turned into gates:
// a resumed search whose key mismatched would SKIP DEPTHS and miss a solution while reporting a
// search that ran out. Two properties make that unreachable, and both are asserted below:
//
//   1. **The key is checked on every continuation** — facelets, `solLen`, `maxPhase2`, the view
//      filter, and a format tag naming both the search's shape and the table set it walks. A
//      mismatch THROWS. Never a quiet fresh search, because a caller that asked to continue and
//      got a restart has been told nothing, and never a quiet continuation of the wrong tree.
//   2. **A continuation to `probeMax: P` visits exactly the first P nodes of the enumeration** —
//      the same nodes, in the same order, that a from-scratch search at `probeMax: P` visits. So
//      its answer is that search's answer, character for character. That is what "provably
//      equivalent" means here, and the plan said the resume was worth shipping only if it held.
//
// Everything runs against the real engine and the FROZEN states in fixtures/solver-cubes.mjs. The
// rule that file states applies with full force: node budgets are deterministic per cube, so a
// fixed budget against a random draw would assert a probabilistic property as if it were a
// deterministic one. Every assertion below names the cube it is about.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  STOP_NOW, createParallelSolveClient, createSolveClient, handleSolveRequest, shouldStop, stopWord,
} from '../lib/solve-client.js';
import { GODS_NUMBER, MAX_PROMISE_ESCALATIONS, solveWithinGodsNumber } from '../lib/solve-target.js';
import { createSolver } from '../lib/solver-engine.js';
import * as engine from '../lib/two-phase.js';
import Cube from '../vendor/cubejs.js';
import { CONTRACT_CUBES, ENGINE_CONTRACT_CUBES, WORKER_CUBES } from './fixtures/solver-cubes.mjs';

/** The bound every escalation in the app asks for: `solveWithinGodsNumber`'s FIRST_BOUND, which is
 *  God's number plus one because the bound is EXCLUSIVE. Fixed here so the searches this file runs
 *  are the searches the app runs. */
const FLOOR = GODS_NUMBER + 1;

/** Put the engine back the way solve-worker.js leaves it. Bounds and the stop signal are module
 *  state, so a test that walked away from either would quietly change every test after it. */
const restore = () => {
  engine.setStopSignal(null);
  engine.setBounds({ solLen: 23, probeMax: 100_000_000, maxPhase2: 12 });
};

const spent = () => engine.searchStats.p1Nodes + engine.searchStats.p2Nodes;

/** The doubling `solveWithinGodsNumber` does, as a list of frontiers. */
const ladder = (base, rungs) => Array.from({ length: rungs }, (_, i) => base * 2 ** i);

/** Every frozen state this file measures against, each with the name its failures must carry. */
const FROZEN = Object.freeze([
  ...CONTRACT_CUBES.map((facelets, i) => ({ name: `CONTRACT_CUBES[${i}]`, facelets })),
  ...ENGINE_CONTRACT_CUBES.map((facelets, i) => ({ name: `ENGINE_CONTRACT_CUBES[${i}]`, facelets })),
  ...Object.entries(WORKER_CUBES).map(([key, facelets]) => ({ name: `WORKER_CUBES.${key}`, facelets })),
]);

/** The frozen state with the highest recorded cost — 10.8M nodes at solLen 21 on one worker, where
 *  every other entry is under 4.2M. The worst case is the one a resume is FOR, so it carries the
 *  measurement and the heavier gates. */
const WORST = { name: 'WORKER_CUBES.tighter', facelets: WORKER_CUBES.tighter };

// ---- the key -----------------------------------------------------------------------------------

test('a continuation of a DIFFERENT search throws, and searches nothing', () => {
  // The hazard the plan named, in one test. Each of these is a resume point that is well-formed,
  // internally consistent, and belongs to another enumeration; continuing any of them would start
  // at a depth that means something else and report the depths it skipped as a search that ran out.
  try {
    engine.setBounds({ solLen: FLOOR, probeMax: 200_000, maxPhase2: 12 });
    const opened = engine.openSearch(WORST.facelets, {});
    assert.equal(opened.continueTo(), null, `${WORST.name}: 200k nodes should not be enough`);
    const point = opened.state;
    assert.ok(point.depth > 0, `${WORST.name}: the search must have got past depth 0, or this proves nothing`);

    // A different cube, under the same bounds.
    assert.throws(
      () => engine.openSearch(CONTRACT_CUBES[0], { resume: point }).continueTo(),
      /resume point is for facelets/,
      'a resume point from another cube must never be continued',
    );
    // The same cube under a different LENGTH bound: a different maximum phase-1 depth, so the
    // depth this point names is not the depth it would mean.
    engine.setBounds({ solLen: 20 });
    assert.throws(
      () => engine.openSearch(WORST.facelets, { resume: point }).continueTo(),
      /resume point is for solLen 21, not 20/,
    );
    // The same cube under a different phase-2 cap, which changes which probes succeed and so which
    // nodes the enumeration visits at all. It is a settable knob, which is exactly why it is keyed.
    engine.setBounds({ solLen: FLOOR, maxPhase2: 11 });
    assert.throws(
      () => engine.openSearch(WORST.facelets, { resume: point }).continueTo(),
      /resume point is for maxPhase2 12, not 11/,
    );
    // A slice of the views, where the point came from all six.
    engine.setBounds({ maxPhase2: 12 });
    assert.throws(
      () => engine.openSearch(WORST.facelets, { viewFilter: [0, 1, 2], resume: point }).continueTo(),
      /resume point is for views null/,
    );
    // A point from an older build of the engine or of the tables.
    assert.throws(
      () => engine.openSearch(WORST.facelets, {
        resume: { ...point, key: { ...point.key, format: 'cubus-two-phase-search/0 over nothing' } },
      }).continueTo(),
      /resume point is for format/,
    );
    // And a point carrying no key at all, which is what a hand-built object would be.
    assert.throws(
      () => engine.openSearch(WORST.facelets, { resume: { depth: 9, cursor: 0, covered: 0, frontier: 1 } }),
      /carries no key/,
    );
  } finally {
    restore();
  }
});

test('a continuation is asserted against the bounds as they are NOW, not as they were', () => {
  // The subtle half, and a real defect in the first draft of this code: the key is built when the
  // search is OPENED, and the bounds are module state and a partial update. An object opened under
  // solLen 21 and continued under solLen 23 kept searching to the first bound while its caller
  // believed the second — it answered a 21-bounded ask with 22 moves, quietly. So the check is at
  // every continuation, not only where a point arrives from another thread.
  try {
    engine.setBounds({ solLen: FLOOR, probeMax: 100_000, maxPhase2: 12 });
    const search = engine.openSearch(WORST.facelets, {});
    engine.setBounds({ solLen: 23 });
    assert.throws(() => search.continueTo(), /resume point is for solLen 21, not 23/,
      `${WORST.name}: a search must not keep its old bound while its caller sets a new one`);
  } finally {
    restore();
  }
});

test('a continuation that buys no more nodes is refused, not reported as exhausted', () => {
  // A frontier that did not grow would search nothing and answer null — indistinguishable, from
  // outside, from a search that spent a budget and found nothing. That is the shape of the failure
  // this whole mechanism exists to prevent, so it is a throw.
  try {
    engine.setBounds({ solLen: FLOOR, probeMax: 200_000, maxPhase2: 12 });
    const search = engine.openSearch(WORST.facelets, {});
    assert.equal(search.continueTo(), null, `${WORST.name}: 200k nodes should not be enough`);
    assert.throws(() => search.continueTo(), /must ask for more nodes than the 200000/);
    engine.setBounds({ probeMax: 199_999 });
    assert.throws(() => search.continueTo(), /must ask for more nodes than the 200000/);
  } finally {
    restore();
  }
});

test('a malformed resume point is refused rather than believed', () => {
  // It crosses a structured clone, so it is untrusted input. Each of these would SKIP nodes: a
  // cursor past the last view steps to the next depth without searching this one, a `covered`
  // larger than the budget that produced it shrinks the next attempt's allowance below what it
  // owes, and a depth past the bound is not a position in this enumeration at all.
  try {
    engine.setBounds({ solLen: FLOOR, probeMax: 100_000, maxPhase2: 12 });
    const search = engine.openSearch(WORST.facelets, {});
    search.continueTo();
    const point = search.state;
    engine.setBounds({ probeMax: 400_000 });
    const bad = (patch, pattern) => assert.throws(
      () => engine.openSearch(WORST.facelets, { resume: { ...point, ...patch } }).continueTo(),
      pattern, JSON.stringify(patch),
    );
    bad({ cursor: 6 }, /outside the search it claims to continue/);
    bad({ cursor: 99 }, /outside the search it claims to continue/);
    bad({ depth: 21 }, /outside the search it claims to continue/);
    bad({ covered: point.frontier + 1 }, /banks 100001 nodes out of the 100000/);
    bad({ depth: -1 }, /is not a count/);
    bad({ covered: 1.5 }, /is not a count/);
    bad({ frontier: Number.NaN }, /is not a count/);
  } finally {
    restore();
  }
});

test('a COMPLETED resume point is checked too, rather than believed because it says it finished', () => {
  // The branch every other check missed (2026-09-05 audit). A finished point is a CACHED ANSWER:
  // `runSearch` hands back its alg and its (depth, view) without searching, so those four fields
  // are the only ones nothing downstream re-derives — and nothing checked them either. The audit
  // got "U U U" out of a search bounded at solLen 2, from view 999: the bound, the metric, the
  // cube and the sort key a pooled caller relies on, all broken at once by one forged record.
  //
  // It crosses a structured clone from a worker, so "forged" and "corrupted" are the same input.
  try {
    engine.setBounds({ solLen: FLOOR, probeMax: 50_000_000, maxPhase2: 12 });
    const search = engine.openSearch(WORKER_CUBES.pooled, {});
    const answer = search.continueTo();
    assert.ok(answer, 'WORKER_CUBES.pooled: 50M nodes must be enough — it is a 108k-node cube');
    const point = search.state;
    assert.equal(point.done, true);
    const moves = answer.trim() ? answer.trim().split(/\s+/) : [];

    // The auditor's record, exactly: three moves under a bound of two, won by a view that does
    // not exist. Every field is internally plausible and the key matches, which is the point.
    engine.setBounds({ solLen: 2 });
    assert.throws(
      () => engine.openSearch(WORKER_CUBES.pooled, {
        resume: { ...point, key: { ...point.key, solLen: 2 }, cursor: 999, done: true, alg: 'U U U', foundDepth: 3, foundView: 999 },
      }).continueTo(),
      /3-move answer under a bound of 2/,
      'a cached answer must be held to the bound its own key names',
    );

    engine.setBounds({ solLen: FLOOR });
    const bad = (patch, pattern) => assert.throws(
      () => engine.openSearch(WORKER_CUBES.pooled, { resume: { ...point, ...patch } }).continueTo(),
      pattern, JSON.stringify(patch),
    );
    // An answer of the right length, in the right metric, for the wrong cube. Only the arithmetic
    // catches this one — every structural check passes it.
    const last = moves[moves.length - 1];
    const wrong = [...moves.slice(0, -1), (last[0] === 'L' ? 'R' : 'L') + last.slice(1)].join(' ');
    const oracle = Cube.fromString(WORKER_CUBES.pooled);
    oracle.move(wrong);
    assert.equal(oracle.isSolved(), false, 'the fixture must really fail to solve');
    bad({ alg: wrong }, /does not solve the cube its key names/);
    bad({ alg: 'x y z' }, /"x", which is not a move/);
    // The sort key a pooled caller picks its winner by: a view outside the six, or a phase-1 depth
    // deeper than the whole solution, would win a race it was never in.
    bad({ foundView: 999 }, /found by view 999/);
    bad({ foundView: -1 }, /found by view -1/);
    bad({ foundDepth: moves.length + 1 }, /phase-1 depth/);
    // And the two shapes no search ever leaves: an outcome on an unfinished point, and a winner
    // named by a point that found nothing.
    bad({ done: false }, /unfinished and yet carries an answer/);
    bad({ alg: null }, /found nothing and yet names depth/);
    // The POSITION a finished point claims to have finished from — round 2 of the same audit.
    // `runSearch` returns a done point's answer before it reads `depth` or `cursor`, so the bounds
    // check that guards every unfinished point is unreachable here: the round-1 record above
    // carried `cursor: 999` and was refused for its ANSWER, and with a legal answer it rode in.
    // A search that finds one leaves by `break` and never writes the position back, so both fields
    // are still inside the enumeration.
    bad({ cursor: 999 }, /outside the search it claims to have finished/);
    bad({ cursor: 6 }, /view 6 of 6/);
    bad({ depth: 21 }, /outside the search it claims to have finished/);

    // The real record still passes, and still costs nothing.
    const kept = engine.openSearch(WORKER_CUBES.pooled, { resume: point });
    assert.equal(kept.continueTo(), answer, 'a sound finished point must still answer from cache');
    assert.equal(spent(), 0, 'and must not search to do it');
    assert.deepEqual([engine.searchStats.depth, engine.searchStats.view], [point.foundDepth, point.foundView]);
  } finally {
    restore();
  }
});

test('a point that says it finished with NOTHING must show where it ran out', () => {
  // The cheapest forgery in the protocol, and until 2026-09-05 the only completed shape with no
  // check at all: `{...a fresh point, done: true}`. `runSearch` returns `point.alg` — null — after
  // zero nodes, and a null from an exhausted enumeration is the same value as a null from a search
  // that ran out of budget. So `solveWithinGodsNumber` reads it as a budget too small, doubles
  // eight times over a cube it never looks at again, and RAISES about a state that is one turn
  // from solved. Reproduced on exactly that cube: a fresh search answers `U'`.
  //
  // There are exactly two ways to finish empty and both are checkable here, which is why this is
  // a check and not a comment: a state that is not a cube, and an enumeration walked out of
  // DEPTHS — which lands in one place only, because the loop increments past `solLen - 1` and
  // resets the cursor as it goes.
  try {
    const oneTurn = new Cube();
    oneTurn.move('U');
    const facelets = oneTurn.asString();
    engine.setBounds({ solLen: FLOOR, probeMax: 50_000_000, maxPhase2: 12 });
    assert.equal(engine.openSearch(facelets, {}).continueTo(), "U'", 'the cube must really be one turn from solved');

    const unstarted = engine.openSearch(facelets, {}).state;
    assert.deepEqual([unstarted.done, unstarted.alg, unstarted.frontier], [false, null, 0]);
    assert.throws(
      () => engine.openSearch(facelets, { resume: { ...unstarted, done: true } }).continueTo(),
      /claims a finished search of a real cube with no answer/,
      'an unstarted search that merely says it finished must not answer null',
    );
    // A position past the bound is not enough either — the cursor is part of the shape.
    assert.throws(
      () => engine.openSearch(facelets, { resume: { ...unstarted, done: true, depth: FLOOR, cursor: 3 } }).continueTo(),
      /claims a finished search of a real cube with no answer/,
    );

    // And the two REAL answerless finishes still adopt, because this must refuse forgeries and
    // not the mechanism. First: an enumeration that genuinely walked out of depths — a hard cube
    // under a bound of 2 has no solution of one move or fewer.
    engine.setBounds({ solLen: 2, probeMax: 50_000_000 });
    const walked = engine.openSearch(WORKER_CUBES.pooled, {});
    assert.equal(walked.continueTo(), null);
    const out = walked.state;
    assert.deepEqual([out.done, out.depth, out.cursor], [true, 2, 0], 'the shape the check is derived from');
    engine.setBounds({ probeMax: 60_000_000 });
    assert.equal(engine.openSearch(WORKER_CUBES.pooled, { resume: out }).continueTo(), null);
    assert.equal(spent(), 0, 'a finished enumeration must not be walked again');

    // Second: a state that is not a cube at all, which finishes at depth 0 and is right to.
    engine.setBounds({ solLen: FLOOR, probeMax: 1000 });
    const notACube = engine.openSearch('U'.repeat(54), {});
    assert.equal(notACube.continueTo(), null);
    assert.deepEqual([notACube.state.done, notACube.state.depth], [true, 0]);
    engine.setBounds({ probeMax: 2000 });
    assert.equal(engine.openSearch('U'.repeat(54), { resume: notACube.state }).continueTo(), null,
      'no budget makes a non-cube solvable, so its finish is honest wherever it sits');
  } finally {
    restore();
  }
});

// ---- the equality the resume rests on ------------------------------------------------------------

test('escalate-then-resume gives the from-scratch answer at every frontier, on every frozen state', () => {
  // THE gate. For each frozen cube, walk the same doubling ladder twice — once continuing one
  // search, once starting a fresh one at each rung — and require the two to agree at EVERY rung,
  // including the rungs where the honest answer is null. Agreeing only at the end would leave
  // room for a resume that skipped a depth holding a shorter solution and then found a different
  // one later.
  try {
    for (const { name, facelets } of FROZEN) {
      engine.setBounds({ solLen: FLOOR, probeMax: 100_000, maxPhase2: 12 });
      const search = engine.openSearch(facelets, {});
      let answered = false;
      for (const frontier of ladder(100_000, 9)) {
        engine.setBounds({ solLen: FLOOR, probeMax: frontier, maxPhase2: 12 });
        const resumed = search.continueTo();
        engine.setBounds({ solLen: FLOOR, probeMax: frontier, maxPhase2: 12 });
        const scratch = engine.solvePattern(facelets);
        assert.equal(resumed, scratch,
          `${name}: at ${frontier} nodes the resumed search and the from-scratch one disagree`);
        if (resumed !== null) {
          // And it is a real solution under the bound, not merely the same string twice.
          const oracle = Cube.fromString(facelets);
          oracle.move(resumed);
          assert.ok(oracle.isSolved(), `${name}: the resumed answer does not solve the cube`);
          assert.ok(resumed.split(' ').length <= GODS_NUMBER, `${name}: the resumed answer is above the floor`);
          answered = true;
          break;
        }
      }
      assert.ok(answered, `${name}: neither search answered within 25.6M nodes — the fixture has moved`);
    }
  } finally {
    restore();
  }
});

test('a continuation spends the frontier MINUS what earlier attempts banked', () => {
  // The saving, stated as an identity rather than as a percentage: a continuation that exhausts
  // its frontier walks exactly `frontier - covered` nodes, where `covered` is what the (depth,
  // view) pairs that ran to their END cost. If this ever stopped holding, the resume would either
  // be re-walking banked work (no saving) or skipping unbanked work (the hazard).
  try {
    engine.setBounds({ solLen: FLOOR, probeMax: 100_000, maxPhase2: 12 });
    const search = engine.openSearch(WORST.facelets, {});
    let midDepth = 0;
    for (const frontier of ladder(100_000, 7)) {
      const before = search.state;
      engine.setBounds({ solLen: FLOOR, probeMax: frontier, maxPhase2: 12 });
      const answer = search.continueTo();
      assert.equal(answer, null, `${WORST.name}: it should still be searching at ${frontier} nodes`);
      assert.equal(spent(), frontier - before.covered,
        `${WORST.name}: the continuation at ${frontier} did not spend exactly what it was owed`);
      const after = search.state;
      assert.ok(after.covered <= frontier,
        `${WORST.name}: more nodes are banked than the search has ever been given`);
      // A resume point is a position in the (depth, view) enumeration, not a depth: at a cursor
      // above zero the views that already finished at that depth are not walked again either.
      if (after.cursor > 0) midDepth += 1;
    }
    assert.ok(midDepth > 0,
      `${WORST.name}: no continuation resumed part-way through a depth, so the per-view resume point is untested`);
  } finally {
    restore();
  }
});

test('the resume really does cost less than the restart it replaces', () => {
  // The measurement, as a gate. Both arms walk the same ladder to the same answer; the resumed one
  // must get there for fewer nodes, because that is the only reason any of this exists. Measured
  // 2026-09-05 on WORKER_CUBES.tighter over a 100k ladder: 15,137,696 nodes resumed against
  // 23,455,718 from scratch — 35.5% saved. The gate is loose because the engine may be retuned;
  // what must never happen is the resume costing what the restart cost.
  try {
    let resumed = 0;
    let scratch = 0;
    let answer = null;
    engine.setBounds({ solLen: FLOOR, probeMax: 100_000, maxPhase2: 12 });
    const search = engine.openSearch(WORST.facelets, {});
    for (const frontier of ladder(100_000, 9)) {
      engine.setBounds({ solLen: FLOOR, probeMax: frontier, maxPhase2: 12 });
      answer = search.continueTo();
      resumed += spent();
      engine.setBounds({ solLen: FLOOR, probeMax: frontier, maxPhase2: 12 });
      engine.solvePattern(WORST.facelets);
      scratch += spent();
      if (answer !== null) break;
    }
    assert.ok(answer !== null, `${WORST.name}: the ladder never reached an answer`);
    assert.ok(resumed < scratch * 0.9,
      `${WORST.name}: ${resumed} nodes resumed against ${scratch} from scratch — the resume saved nothing`);
  } finally {
    restore();
  }
});

test('a finished search stays finished, and still says which view won', () => {
  // Two ways to be finished, and neither is "out of nodes": an answer found, and an enumeration
  // walked to its end. A continuation of either must not search — and must still report the
  // (depth, view) key, because a pooled caller sorts on it and a -1 there is a reply that cannot
  // win. The bug this forbids is a re-asked winner silently losing its own race.
  try {
    engine.setBounds({ solLen: FLOOR, probeMax: 50_000_000, maxPhase2: 12 });
    const search = engine.openSearch(WORKER_CUBES.pooled, {});
    const answer = search.continueTo();
    assert.ok(answer, 'WORKER_CUBES.pooled: 50M nodes must be enough — it is a 108k-node cube');
    const won = [engine.searchStats.depth, engine.searchStats.view];
    assert.ok(won[0] >= 0 && won[1] >= 0, 'WORKER_CUBES.pooled: the winner published no sort key');
    assert.equal(search.done, true);

    engine.setBounds({ probeMax: 100_000_000 });
    assert.equal(search.continueTo(), answer, 'WORKER_CUBES.pooled: a finished search changed its answer');
    assert.equal(spent(), 0, 'WORKER_CUBES.pooled: a finished search searched again');
    assert.deepEqual([engine.searchStats.depth, engine.searchStats.view], won,
      'WORKER_CUBES.pooled: a re-asked winner lost its sort key');
  } finally {
    restore();
  }
});

// ---- cancellation ---------------------------------------------------------------------------------

test('the stop word still reaches inside a CONTINUED search, and leaves it resumable', () => {
  // Cancellation is not a property of the first attempt. A continuation is the same synchronous
  // walk, so the same shared word has to reach into it — and a search stopped part-way must leave
  // a resume point that is still a position in the enumeration, not a corrupted one. The proof
  // that it does is the equality: a later continuation still lands on the from-scratch answer.
  try {
    const word = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(word, 0, 0x7fffffff);
    engine.setBounds({ solLen: FLOOR, probeMax: 200_000, maxPhase2: 12 });
    const search = engine.openSearch(WORST.facelets, {});
    assert.equal(search.continueTo(), null, `${WORST.name}: 200k nodes should not be enough`);

    // Stop the CONTINUATION, from inside it, at its twentieth poll — the only way to do this on
    // one thread, since the search never yields.
    let polls = 0;
    engine.setStopSignal((depth) => {
      polls += 1;
      if (polls === 20) Atomics.store(word, 0, STOP_NOW);
      return shouldStop(word, depth);
    });
    engine.setBounds({ probeMax: 50_000_000 });
    assert.equal(search.continueTo(), null, `${WORST.name}: a stopped search answers null`);
    assert.ok(spent() < 2_000_000,
      `${WORST.name}: ${spent()} nodes spent after a stop — the abort did not reach the continuation`);
    assert.equal(search.done, false, `${WORST.name}: a stopped search is not a finished one`);

    // And the point it left is sound: continued with the stop lifted, it reaches exactly what a
    // from-scratch search of the same frontier reaches.
    engine.setStopSignal(null);
    Atomics.store(word, 0, 0x7fffffff);
    engine.setBounds({ probeMax: 100_000_000 });
    const resumed = search.continueTo();
    engine.setBounds({ solLen: FLOOR, probeMax: 100_000_000, maxPhase2: 12 });
    assert.equal(resumed, engine.solvePattern(WORST.facelets),
      `${WORST.name}: a stop left the resume point somewhere the from-scratch search does not go`);
  } finally {
    restore();
  }
});

// ---- the pool -------------------------------------------------------------------------------------

test('every slice keeps its own resume point, and the pooled winner is unchanged', () => {
  // The six views die at different depths, so a pool has six resume points and there is nothing to
  // merge. Each slice's continuation must equal that slice's from-scratch search at the same
  // frontier — and therefore the (depth, view) minimum across them, which is what the pool answers
  // with, must be the same algorithm it was before any of this existed.
  try {
    const slices = [[0], [1], [2], [3], [4], [5]];
    for (const { name, facelets } of [WORST, { name: 'CONTRACT_CUBES[1]', facelets: CONTRACT_CUBES[1] }]) {
      engine.setBounds({ solLen: FLOOR, probeMax: 100_000, maxPhase2: 12 });
      const searches = slices.map((views) => engine.openSearch(facelets, { viewFilter: views }));
      let answered = false;
      for (const total of ladder(600_000, 8)) {
        const share = total / slices.length;
        const resumedReplies = [];
        const scratchReplies = [];
        for (const [i, views] of slices.entries()) {
          engine.setBounds({ solLen: FLOOR, probeMax: share, maxPhase2: 12 });
          const alg = searches[i].continueTo();
          if (alg !== null) resumedReplies.push({ alg, depth: engine.searchStats.depth, view: engine.searchStats.view });
          engine.setBounds({ solLen: FLOOR, probeMax: share, maxPhase2: 12 });
          const fresh = engine.solvePattern(facelets, views);
          if (fresh !== null) scratchReplies.push({ alg: fresh, depth: engine.searchStats.depth, view: engine.searchStats.view });
          assert.equal(alg, fresh, `${name}: slice ${views} diverged at ${share} nodes each`);
        }
        const pick = (replies) => {
          replies.sort((a, b) => (a.depth - b.depth) || (a.view - b.view));
          return replies[0]?.alg ?? null;
        };
        assert.equal(pick(resumedReplies), pick(scratchReplies),
          `${name}: the pooled winner changed at ${total} nodes`);
        if (resumedReplies.length > 0) { answered = true; break; }
      }
      assert.ok(answered, `${name}: no slice answered — the fixture has moved`);
    }
  } finally {
    restore();
  }
});

// ---- the escalation, through the real boundary -------------------------------------------------

/** A worker-shaped object running the REAL engine on a macrotask, exactly as solve-worker.js does:
 *  the same handleSolveRequest, the same per-request stop word, the same predicate. */
function engineWorker() {
  const solve = createSolver(engine);
  const readStats = () => engine.searchStats;
  const listeners = new Map();
  let best = null;
  engine.setStopSignal((depth) => shouldStop(best, depth));
  const w = {
    sent: [],
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    postMessage(request) {
      w.sent.push(request);
      setTimeout(() => {
        best = stopWord(request.shared);
        try {
          listeners.get('message')?.({ data: handleSolveRequest(solve, request, readStats) });
        } finally {
          best = null;
        }
      }, 0);
    },
    terminate() {},
  };
  return w;
}

test('solveWithinGodsNumber continues one search across its escalations', async () => {
  // End to end over the client and the engine boundary, with a first budget small enough that the
  // hardest frozen state has to escalate. Two things are asserted, and the second is the one that
  // matters: every attempt after the first carried the point the one before it left, AND the answer
  // is the answer the old restart-from-zero escalation produced — which, by the equality above, is
  // the from-scratch answer at the last frontier.
  try {
    const w = engineWorker();
    const client = createSolveClient({ spawn: () => w });
    const answer = await solveWithinGodsNumber(WORST.facelets, {
      solve: (facelets, bounds) => client.solve(facelets, bounds),
      probeBudget: 400_000,
    });

    const budgets = w.sent.map((m) => m.probeMax);
    assert.ok(budgets.length > 1, `${WORST.name}: it did not escalate, so nothing was continued`);
    assert.ok(budgets.length <= MAX_PROMISE_ESCALATIONS + 1, `${WORST.name}: too many attempts`);
    assert.deepEqual(budgets, ladder(400_000, budgets.length), 'the budget must still double');
    assert.equal(w.sent[0].resume.state, null, 'the first attempt continues nothing');
    for (const [i, msg] of w.sent.slice(1).entries()) {
      assert.ok(msg.resume?.state, `attempt ${i + 1} started from scratch instead of continuing`);
      assert.equal(msg.resume.state.key.facelets, WORST.facelets, `attempt ${i + 1} carried another cube's point`);
      assert.ok(msg.resume.state.frontier === budgets[i],
        `attempt ${i + 1} carried a point from a frontier of ${msg.resume.state.frontier}, not ${budgets[i]}`);
    }

    // The answer, against a from-scratch search at the frontier the escalation ended on.
    engine.setBounds({ solLen: FLOOR, probeMax: budgets.at(-1), maxPhase2: 12 });
    assert.equal(answer, engine.solvePattern(WORST.facelets),
      `${WORST.name}: the escalated answer is not the from-scratch answer at ${budgets.at(-1)} nodes`);
  } finally {
    restore();
  }
});

// ---- the pooled client's plumbing ----------------------------------------------------------------

/** A worker that answers with a scripted reply and records what it was sent. No engine: what is
 *  under test here is which resume point goes to which slice, which is a fact about the client. */
function scriptedWorker(reply) {
  const listeners = new Map();
  const w = {
    sent: [],
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    postMessage(msg) {
      w.sent.push(msg);
      queueMicrotask(() => listeners.get('message')?.({ data: reply(msg) }));
    },
    terminate() {},
  };
  return w;
}

test('a pooled resume point is six points, and each goes back to the slice that made it', async () => {
  // Slice i searches views the other five do not, so its resume point is meaningless to them.
  // Handing one to the wrong slice would be a key mismatch — loud, but over a cube the user is
  // waiting on — so the alignment is by the slice index, which is fixed for the pool's life.
  const made = [];
  const client = createParallelSolveClient({
    spawn: () => {
      const w = scriptedWorker((msg) => ({
        id: msg.id,
        ok: true,
        alg: null,
        depth: -1,
        view: -1,
        // A point that names the views it came from, so a misdelivery is visible.
        resume: { key: { views: msg.views }, frontier: msg.probeMax },
      }));
      made.push(w);
      return w;
    },
    workers: 6,
    viewCount: 6,
  });
  const carry = { state: null };
  assert.equal(await client.solve('F'.repeat(54), { solLen: 21, probeMax: 600_000, resume: carry }), null);
  assert.equal(carry.state.length, 6, 'a pool of six leaves six resume points');
  for (const [i, point] of carry.state.entries()) {
    assert.deepEqual(point.key.views, made[i].sent[0].views, `slice ${i}'s point came from another slice`);
  }

  await client.solve('F'.repeat(54), { solLen: 21, probeMax: 1_200_000, resume: carry });
  for (const [i, w] of made.entries()) {
    assert.deepEqual(w.sent[1].resume.state.key.views, w.sent[0].views,
      `slice ${i} was handed another slice's resume point on the second attempt`);
    assert.equal(w.sent[1].probeMax, 200_000, `slice ${i}: the frontier must double with the budget`);
  }
});

test('falling back to one worker empties the pooled resume point rather than misapplying it', async () => {
  // The lone client searches ALL six views, which is a different search with a different key, so a
  // slice's point would be REFUSED by the engine — loudly, over a cube nobody could then solve.
  // Emptying it costs the re-walk and is the only correct thing to do with a point for another
  // search. The trap is that the array is truthy and would otherwise be posted as a state object.
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    let spawns = 0;
    const made = [];
    const client = createParallelSolveClient({
      spawn: () => {
        spawns += 1;
        if (spawns === 1) throw new Error('Worker refused to start');
        const w = scriptedWorker((msg) => ({ id: msg.id, ok: true, alg: 'R U', depth: 9, view: 0, resume: null }));
        made.push(w);
        return w;
      },
      workers: 6,
      viewCount: 6,
    });
    // A carrier holding what a previous POOLED attempt left: one point per slice, each for a
    // different set of views. The array is truthy, which is exactly the trap — posted as-is it
    // would reach the lone worker as a state object for a search that does not exist.
    const carry = { state: [0, 1, 2, 3, 4, 5].map((v) => ({ key: { views: [v] }, frontier: 100_000 })) };
    assert.equal(
      await client.solve('F'.repeat(54), { solLen: 21, probeMax: 600_000, resume: carry }),
      'R U', 'a pool that cannot be staffed still answers',
    );
    assert.equal(carry.state, null, 'the pooled points must be dropped, never posted to a lone worker');
    assert.equal(made.at(-1).sent[0].views, null, 'the fallback searches every view — a different search');
    assert.equal(made.at(-1).sent[0].resume.state, null, 'the lone worker was handed a point for another search');

    // And on every solve after it, because the pool stays fallen back for the session.
    carry.state = [{ key: { views: [0] }, frontier: 100_000 }];
    await client.solve('F'.repeat(54), { solLen: 21, probeMax: 600_000, resume: carry });
    assert.equal(carry.state, null, 'a later solve on the fallback must drop a pooled point too');
    assert.equal(made.at(-1).sent[1].resume.state, null);
  } finally {
    console.warn = realWarn;
  }
});
