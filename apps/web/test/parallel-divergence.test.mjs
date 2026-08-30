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
// budgets. This file pins the boundary in both directions so nobody has to rediscover it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as engine from '../lib/two-phase.js';
import { randomCube } from '../lib/random-state.js';
import Cube from '../vendor/cubejs.js';

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

test('at the shipped budget the pooled answer is the single-worker answer', async () => {
  // The case that matters in the app: 50M nodes, split six ways, is enough for every slice to
  // reach what the shared budget reached. Twelve cubes rather than forty — the point here is
  // that the equality is real at ship settings, and forty of them proved that already.
  for (let i = 0; i < 12; i++) {
    const facelets = randomCube(Cube).asString();
    engine.setBounds({ solLen: 21, probeMax: 50_000_000 });
    const sequential = engine.solvePattern(facelets);
    const parallel = pooled(facelets, ONE_PER_VIEW, 50_000_000);
    assert.equal(parallel?.alg ?? null, sequential, `cube ${i} diverged at the shipped budget`);
  }
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
