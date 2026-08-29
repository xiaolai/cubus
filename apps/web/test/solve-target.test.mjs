// The tiers make two different promises and the difference is the point: <= 20 always exists
// (God's number), <= 18 sometimes does not. So most of what follows is about what happens when
// a target is NOT met — a search that quietly hands back a longer solution as if it had
// succeeded is the failure this module exists to prevent.
//
// The solver is injected, so these run against a scripted fake. That is deliberate: a fake can
// produce the awkward answers a real solver only produces rarely, including ones that break its
// own contract.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_PROBE_BUDGET, STOPPED, TIERS, describe, refine, tierByName,
} from '../lib/solve-target.js';

/** An alg of `n` moves. Content is irrelevant here; only its length is ever read. */
const algOf = (n) => Array.from({ length: n }, () => 'R').join(' ');

/** A solver that returns the scripted lengths in order; `null` means "not within budget".
 *  Records the bounds it was asked for, so the test can check what was requested. */
function scripted(lengths) {
  const asked = [];
  let call = 0;
  const solve = async (_facelets, options) => {
    asked.push(options);
    const n = lengths[call++];
    return n === null || n === undefined ? null : algOf(n);
  };
  solve.asked = asked;
  return solve;
}

const collect = async (gen) => { const out = []; for await (const s of gen) out.push(s); return out; };

test('the rungs are the four we decided on, in order', () => {
  assert.deepEqual(TIERS.map((t) => t.target), [20, 19, 18, null]);
  assert.equal(tierByName('twenty').target, 20);
  assert.equal(tierByName('shortest').target, null);
  assert.throws(() => tierByName('twenty-one'), /unknown tier/);
});

test('a free first answer that already meets the target ends there', async () => {
  // The common case at the <= 20 tier: the loose search returns 20 or fewer and nothing else
  // is searched at all.
  const solve = scripted([20]);
  const steps = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0], { alg: algOf(20), moves: 20, target: 20, met: true, stopped: STOPPED.MET });
  assert.equal(solve.asked.length, 1, 'no further search once the target is met');
});

test('there is always an answer before any waiting', async () => {
  // The first yield must come from the loose search, not the targeted one — at the <= 20 tier
  // the worst of 200 cubes took 1.1 s, and nobody should be shown nothing during it.
  const solve = scripted([22, 21, 20]);
  const steps = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.equal(steps[0].moves, 22, 'the first thing shown is the cheapest answer');
  assert.equal(steps[0].met, false);
  assert.equal(steps[0].stopped, null, 'and it is marked as still improving');
  assert.equal(solve.asked[0].solLen, 23, 'which means the first search is the loose one');
});

test('every improvement is strictly shorter than the last', async () => {
  const solve = scripted([22, 21, 20, 19]);
  const steps = await collect(refine('F', { solve, tier: 'nineteen' }));
  assert.deepEqual(steps.map((s) => s.moves), [22, 21, 20, 19]);
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i].moves < steps[i - 1].moves, `step ${i} did not improve`);
  }
  assert.deepEqual(solve.asked.map((a) => a.solLen), [23, 22, 21, 20],
    'each search asks for strictly shorter than what is already in hand');
  assert.equal(steps.at(-1).stopped, STOPPED.MET);
});

test('a target that cannot be met is reported as missed, not dressed up', async () => {
  // The <= 18 tier on a cube whose optimal is 19: no budget reaches it, because 18 does not
  // exist for that cube. The answer still stands; the claim does not.
  const solve = scripted([21, 20, 19, null]);
  const steps = await collect(refine('F', { solve, tier: 'eighteen' }));
  const last = steps.at(-1);
  assert.equal(last.moves, 19, 'the best answer found is kept');
  assert.equal(last.met, false, 'and is NOT reported as meeting the target');
  assert.equal(last.stopped, STOPPED.EXHAUSTED);
  assert.equal(last.target, 18);
});

test('the untargeted rung keeps going until nothing shorter is found', async () => {
  const solve = scripted([21, 20, 19, 18, 17, null]);
  const steps = await collect(refine('F', { solve, tier: 'shortest' }));
  assert.deepEqual(steps.map((s) => s.moves), [21, 20, 19, 18, 17, 17]);
  const last = steps.at(-1);
  assert.equal(last.target, null);
  assert.equal(last.met, false, 'there is no target, so nothing was met');
  assert.equal(last.stopped, STOPPED.EXHAUSTED);
});

test('cancelling keeps the best answer so far and says it was cancelled', async () => {
  const controller = new AbortController();
  const solve = scripted([22, 21, 20, 19, 18]);
  const steps = [];
  for await (const step of refine('F', { solve, tier: 'shortest', signal: controller.signal })) {
    steps.push(step);
    if (step.moves === 21) controller.abort();
  }
  const last = steps.at(-1);
  assert.equal(last.moves, 21, 'the answer on screen when it was stopped is the answer kept');
  assert.equal(last.stopped, STOPPED.CANCELLED);
  assert.equal(last.met, false);
});

test('a signal aborted before anything ran yields nothing at all', async () => {
  // Cancelled before the first search: there is no answer to show, so starting work anyway
  // would be acting on a request the caller already withdrew.
  const controller = new AbortController();
  controller.abort();
  const solve = scripted([20]);
  const steps = await collect(refine('F', { solve, tier: 'twenty', signal: controller.signal }));
  assert.deepEqual(steps, [], 'no search ran, so nothing was yielded');
  assert.equal(solve.asked.length, 0, 'and the solver was never called');
});

test('an abort racing a met answer does not undo the met', async () => {
  // The abort lands while the first search is in flight; the answer it returns meets the
  // target. What was achieved is reported as achieved — cancellation stops FURTHER work.
  const controller = new AbortController();
  const solve = async (facelets, bounds) => {
    controller.abort();
    return scripted([20])(facelets, bounds);
  };
  const steps = await collect(refine('F', { solve, tier: 'twenty', signal: controller.signal }));
  assert.equal(steps.at(-1).stopped, STOPPED.MET, 'an already-met target is not undone by an abort');
  assert.equal(steps.at(-1).met, true);
});

test('no solution at all is an error, not an empty result', async () => {
  // Distinct from "out of budget": the loosest possible search failing means the state is
  // unsolvable or the solver is broken, and returning null would let a screen render nothing.
  const solve = scripted([null]);
  await assert.rejects(() => collect(refine('F', { solve })), /no solution at all/);
});

test('a solver that breaks its own contract is refused, not passed through', async () => {
  // Asked for fewer than 21, answered with 21. Yielding it would break the one guarantee this
  // module makes, and the move list would go backwards in front of the learner.
  const solve = scripted([21, 21]);
  await assert.rejects(() => collect(refine('F', { solve, tier: 'shortest' })),
    /returned 21 moves when asked for fewer than 21/);
});

test('the probe budget is passed to every search, and defaults', async () => {
  const solve = scripted([22, 21, 20]);
  await collect(refine('F', { solve, tier: 'twenty' }));
  assert.ok(solve.asked.every((a) => a.probeMax === DEFAULT_PROBE_BUDGET));

  const custom = scripted([22, 21, 20]);
  await collect(refine('F', { solve: custom, tier: 'twenty', probeBudget: 5000 }));
  assert.ok(custom.asked.every((a) => a.probeMax === 5000), 'a budget is in probes, not milliseconds');
});


test('refine refuses to run without a solver', async () => {
  await assert.rejects(() => collect(refine('F', {})), TypeError);
});

test('what it tells the user never claims a minimum', async () => {
  // Two-phase cannot prove optimality (solver-move-count.md section 4), so no message may say
  // it has. The untargeted rung says "shortest found", which is a different claim.
  assert.deepEqual(describe({ moves: 20, target: 20, met: true, stopped: STOPPED.MET }),
    { key: 'solve.targetMet', moves: 20, target: 20, stopped: STOPPED.MET });
  assert.deepEqual(describe({ moves: 19, target: 18, met: false, stopped: STOPPED.EXHAUSTED }),
    { key: 'solve.targetMissed', moves: 19, target: 18, stopped: STOPPED.EXHAUSTED });
  // `stopped` rides along so a cancelled search and an exhausted one can be told apart.
  assert.deepEqual(describe({ moves: 19, target: 18, met: false, stopped: STOPPED.CANCELLED }),
    { key: 'solve.targetMissed', moves: 19, target: 18, stopped: STOPPED.CANCELLED });
  assert.deepEqual(describe({ moves: 17, target: null, met: false, stopped: STOPPED.EXHAUSTED }),
    { key: 'solve.shortestFound', moves: 17, final: true, stopped: STOPPED.EXHAUSTED });
  assert.equal(describe(null), null);

  const keys = [
    describe({ moves: 20, target: 20, met: true, stopped: STOPPED.MET }).key,
    describe({ moves: 19, target: 18, met: false, stopped: STOPPED.EXHAUSTED }).key,
    describe({ moves: 17, target: null, met: false, stopped: null }).key,
  ];
  for (const key of keys) {
    assert.doesNotMatch(key, /minimum|optimal/i, `"${key}" claims something two-phase cannot know`);
  }
});

test('a solved cube is a zero-move answer, not a solver failure', async () => {
  // The regression: `if (!first)` once treated the empty-string algorithm — the solved cube's
  // real answer — as "no solution at all" and threw.
  const solve = scripted(['']);
  const twenty = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.deepEqual(twenty, [{ alg: '', moves: 0, target: 20, met: true, stopped: STOPPED.MET }]);
  const shortest = await collect(refine('F', { solve: scripted(['']), tier: 'shortest' }));
  assert.equal(shortest.at(-1).stopped, STOPPED.EXHAUSTED, 'nothing improves on zero moves');
  assert.equal(shortest.at(-1).moves, 0);
});

test('the first answer is held to the same bound as every later one', async () => {
  // A broken solver answering the loose ask with 23+ moves used to slip through unchecked.
  const solve = scripted([25]);
  await assert.rejects(() => collect(refine('F', { solve })),
    /returned 25 moves when asked for fewer than 23/);
});

test('a malformed tier or budget is refused before any search runs', async () => {
  const solve = scripted([20]);
  for (const tier of [{}, { target: Number.NaN }, { target: -1 }, { target: 2.5 }]) {
    await assert.rejects(() => collect(refine('F', { solve, tier })), TypeError, JSON.stringify(tier));
  }
  for (const probeBudget of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5]) {
    await assert.rejects(() => collect(refine('F', { solve, probeBudget })), TypeError, String(probeBudget));
  }
  assert.equal(solve.asked.length, 0, 'validation happens before the solver is touched');
});

test('the tier rungs themselves are immutable', () => {
  assert.throws(() => {
    TIERS[0].target = 5;
  }, TypeError, 'a mutated rung would move every search’s goalposts');
  assert.equal(TIERS[0].target, 20);
});

test('an abort during a search ends the progression with the answer in hand', async () => {
  // The abort lands while the second search is in flight and that search returns an
  // improvement. The improvement is real and kept — but the progression ends as CANCELLED,
  // never yielding one more in-progress step as if the search were continuing.
  const controller = new AbortController();
  const base = scripted([22, 21, 20]);
  const solve = async (facelets, bounds) => {
    const answer = await base(facelets, bounds);
    if (bounds.solLen === 22) controller.abort(); // mid-flight, during the 22 -> 21 attempt
    return answer;
  };
  const steps = await collect(refine('F', { solve, tier: 'shortest', signal: controller.signal }));
  const last = steps.at(-1);
  assert.equal(last.stopped, STOPPED.CANCELLED);
  assert.equal(last.moves, 21, 'the improvement that arrived with the abort is kept');
  assert.equal(base.asked.length, 2, 'and no further search was started');
});
