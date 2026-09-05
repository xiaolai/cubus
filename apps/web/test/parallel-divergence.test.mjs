// Where the pooled solver stops matching the single-worker one, and why that is acceptable.
//
// The pool sorts replies by (depth, view) — the order the sequential engine searches in — so the
// result does not depend on which worker finishes first. That is DETERMINISM, and it is the
// property the design actually guarantees.
//
// It is NOT the same as "identical to one worker at every budget", which is what an earlier
// comment claimed. One shared budget spent in sequence is not the same resource as N fixed
// quotas: a slice can exhaust its quota where the sequential search would have spent nodes that
// another view never needed. At the shipped budget that never showed — 40/40 offline and 90/90
// in a browser — which is exactly why the claim survived until an audit went looking at tight
// budgets. Then it showed (2026-09-05): a fresh draw missed in the pool, and WORKER_CUBES.tighter
// — whose winning view costs 10.8M nodes, more than a sixth of 50M — is answered by the pool with
// a DIFFERENT 20-move solution from another view's slice. So the property this file pins is not
// equality. It is: both answers solve the cube in the same number of moves, and every difference
// is the quota — the sequential winner's own view, given only a slice's share, does not reach
// its answer. A difference with any other cause is a correctness defect and fails here.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as engine from '../lib/two-phase.js';
import { randomCube } from '../lib/random-state.js';
import Cube from '../vendor/cubejs.js';
import { CONTRACT_CUBES, ENGINE_CONTRACT_CUBES, WORKER_CUBES } from './fixtures/solver-cubes.mjs';

/** Run one slice and return its answer with the key the pool would sort on. */
function slice(facelets, views, probeMax) {
  engine.setBounds({ solLen: 21, probeMax });
  const alg = engine.solvePattern(facelets, views);
  return alg === null ? null : { alg, depth: engine.searchStats.depth, view: engine.searchStats.view };
}

/** What the pool would answer: the minimum by (depth, view) across the slices. */
function pooled(facelets, slices, probeMax) {
  const found = slices.map((s) => slice(facelets, s, Math.floor(probeMax / slices.length))).filter(Boolean);
  found.sort((a, b) => (a.depth - b.depth) || (a.view - b.view));
  return found[0] ?? null;
}

const ONE_PER_VIEW = [[0], [1], [2], [3], [4], [5]];

/** The frozen states every gate test draws from — ten cubes, each named in its assertion. */
const FROZEN = Object.freeze([
  ...CONTRACT_CUBES.map((f, i) => [`CONTRACT_CUBES[${i}]`, f]),
  ...ENGINE_CONTRACT_CUBES.map((f, i) => [`ENGINE_CONTRACT_CUBES[${i}]`, f]),
  ...Object.entries(WORKER_CUBES).map(([k, f]) => [`WORKER_CUBES.${k}`, f]),
]);

const SHIPPED = 50_000_000;
const QUOTA = Math.floor(SHIPPED / ONE_PER_VIEW.length);

/** Does `alg` actually solve `facelets`? cubejs is the oracle, as everywhere else in this app. */
function solves(facelets, alg) {
  const c = Cube.fromString(facelets);
  c.move(alg);
  return c.isSolved();
}

/**
 * The one property that holds at every budget: an answer from either side solves the cube, both
 * sides answer in the same number of moves, and a difference between them — a different
 * algorithm, or a pool that answered nothing — is explained by the quota and by nothing else.
 * "Explained by the quota" is asserted, not assumed: the sequential winner's own view, run alone
 * with a slice's share, must fail to reach the sequential answer. Returns whether they differed.
 */
function assertAgreeOrQuota(name, facelets, sequential, seqView, parallel) {
  assert.ok(sequential, `${name} must be solvable at the shipped budget`);
  assert.ok(solves(facelets, sequential), `${name}: the sequential answer does not solve the cube`);
  if (parallel !== null) {
    assert.ok(solves(facelets, parallel.alg), `${name}: the pooled answer does not solve the cube`);
    assert.equal(parallel.alg.split(' ').length, sequential.split(' ').length,
      `${name}: the two sides answered with different lengths`);
    if (parallel.alg === sequential) return false;
  }
  const own = slice(facelets, [seqView], QUOTA);
  assert.notEqual(own?.alg ?? null, sequential,
    `${name}: the pool ${parallel ? 'answered differently' : 'missed'}, yet view ${seqView} alone reaches the sequential answer within a slice's quota — that is not the quota, it is a defect`);
  return true;
}

test('at the shipped budget every difference between the pool and one worker is the quota — frozen states', () => {
  // On FROZEN states, because (2026-09-05) a fresh draw that asserts a non-null answer under a
  // budget is a lottery: twelve draws passed 40/40 offline and 90/90 in a browser, then went red
  // once in ten gate runs. The equality itself is NOT the property (see the header): the
  // WORKER_CUBES.tighter row differs by construction, and the assertion says why.
  const differed = [];
  for (const [name, facelets] of FROZEN) {
    engine.setBounds({ solLen: 21, probeMax: SHIPPED });
    const sequential = engine.solvePattern(facelets);
    const seqView = engine.searchStats.view;
    const parallel = pooled(facelets, ONE_PER_VIEW, SHIPPED);
    if (assertAgreeOrQuota(name, facelets, sequential, seqView, parallel)) differed.push(name);
  }
  // The measured boundary, recorded so a change in it is a finding rather than a surprise: on
  // 2026-09-05 exactly one of the ten differed, and it is the one whose cost the fixture names.
  assert.deepEqual(differed, ['WORKER_CUBES.tighter'],
    `the set of frozen states where the pool differs from one worker moved: ${JSON.stringify(differed)}`);
});

test('on fresh draws the two never DISAGREE — a difference is the quota, and only the quota', () => {
  // The fresh draw keeps its evidential value without becoming a lottery: nothing here asserts
  // that a drawn state is answered by the pool, only that whatever the pool says is a solution of
  // the sequential length and that a miss or a different answer is the quota, proven each time.
  let differed = 0;
  for (let i = 0; i < 6; i++) {
    const facelets = randomCube(Cube).asString();
    engine.setBounds({ solLen: 21, probeMax: SHIPPED });
    const sequential = engine.solvePattern(facelets);
    const seqView = engine.searchStats.view;
    const parallel = pooled(facelets, ONE_PER_VIEW, SHIPPED);
    if (assertAgreeOrQuota(`draw ${i} (${facelets})`, facelets, sequential, seqView, parallel)) differed++;
  }
  if (differed) console.log(`parallel-divergence: ${differed} of 6 fresh draws differed under the per-view quota (the documented mechanism)`);
});

test('under budget pressure it diverges — a valid answer, not the same one', () => {
  // The audit's counterexample, kept verbatim. Sequential at 3,000,000 nodes finds (11,1); six
  // 500,000-node slices find only (11,2), because view 1's slice runs out before reaching its
  // answer. Both are legal 20-move solutions of equal length; they are different algorithms.
  const facelets = 'RBBFUDDBBLLULRLLUDRLDUFFURFLDUDDBDDFFRBULFRFBRRUUBRLBF';
  engine.setBounds({ solLen: 21, probeMax: 3_000_000 });
  const sequential = engine.solvePattern(facelets);
  const seqKey = [engine.searchStats.depth, engine.searchStats.view];
  const parallel = pooled(facelets, ONE_PER_VIEW, 3_000_000);

  assert.ok(sequential, 'the sequential search should still find an answer at this budget');
  assert.ok(parallel, 'and so should at least one slice');
  assert.notEqual(parallel.alg, sequential, 'this is the divergence the test exists to pin');
  assert.deepEqual(seqKey, [11, 1]);
  assert.deepEqual([parallel.depth, parallel.view], [11, 2]);

  // Divergent, but never WRONG: the pooled answer solves the cube and respects the bound. That
  // is the property the app depends on — the oracle in finishSolve checks it either way.
  const oracle = Cube.fromString(facelets);
  oracle.move(parallel.alg);
  assert.ok(oracle.isSolved(), 'the pooled answer must still solve the cube');
  assert.ok(parallel.alg.split(' ').length <= 20, 'and still respect the bound');
});

test('a slice can also miss an answer the shared budget would have reached', () => {
  // The other direction, and the reason the divergence is not simply "parallel finds more":
  // one budget spent in sequence can put ALL of itself into the view that pays, and a slice
  // holding that view gets a sixth of it. Here the sequential search answers from view 0 at
  // 3,000,000 nodes and every one of the six 500,000-node slices exhausts.
  //
  // The cube is measured, not chosen: 300 random states were searched for one with this shape,
  // and this is the one that has it. The first draft of this test asserted the same claim under
  // `if (sequential !== null)` at 100,000 nodes — where the sequential search finds nothing —
  // so it passed by asserting nothing at all. An audit caught that; the guard is gone, and the
  // budget is one where both halves of the claim are actually exercised.
  const facelets = 'FFLFURUDFUBBURUDUDBLRFFRUDRFRFBDBBDBDURFLRLLLDLLLBDRBU';
  engine.setBounds({ solLen: 21, probeMax: 3_000_000 });
  const sequential = engine.solvePattern(facelets);
  const seqKey = [engine.searchStats.depth, engine.searchStats.view];
  const parallel = pooled(facelets, ONE_PER_VIEW, 3_000_000);

  assert.ok(sequential, 'the sequential search must answer here, or the test proves nothing');
  assert.deepEqual(seqKey, [11, 0]);
  assert.equal(parallel, null, 'every slice should have starved at a sixth of that budget');
});
