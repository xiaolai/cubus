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
  BONUS_BUDGET, DEFAULT_PROBE_BUDGET, GODS_NUMBER, MAX_PROMISE_ESCALATIONS, STOPPED, TIERS,
  describe, refine, tierByName,
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

test('a met target stops the spending, not the improving', async () => {
  // The common case at the <= 20 tier: the loose search returns 20 or fewer. The target is met
  // — and the search still asks for shorter, at the bonus budget, because a cube that happens
  // to be easy deserves its real answer, not the ceiling. Here nothing shorter exists, so one
  // cheap ask fails and the target is reported met.
  const solve = scripted([20]);
  const steps = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.deepEqual(steps, [
    { alg: algOf(20), moves: 20, target: 20, met: true, stopped: null },
    { alg: algOf(20), moves: 20, target: 20, met: true, stopped: STOPPED.MET },
  ]);
  assert.deepEqual(solve.asked.map((a) => a.probeMax), [DEFAULT_PROBE_BUDGET, BONUS_BUDGET],
    'below the target only the bonus budget is ever spent');
});

test('an easy cube descends past the target to its real answer', async () => {
  // The complaint that forced this: a cube seven turns from solved was answered with twenty
  // moves, because twenty was the promise and the search stopped there. Now the met target
  // only drops the budget — the descent continues while cheap improvements keep coming.
  const solve = scripted([14, 9, 7]);
  const steps = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.deepEqual(steps.map((st) => st.moves), [14, 9, 7, 7]);
  assert.deepEqual(steps.map((st) => st.met), [true, true, true, true]);
  assert.equal(steps.at(-1).stopped, STOPPED.MET);
  assert.deepEqual(solve.asked.map((a) => a.probeMax),
    [DEFAULT_PROBE_BUDGET, BONUS_BUDGET, BONUS_BUDGET, BONUS_BUDGET],
    'everything below the target is free-descent work at the bonus budget');
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
  assert.deepEqual(steps.map((s) => s.moves), [22, 21, 20, 19, 19],
    'the final step repeats the answer to carry the stop reason');
  for (let i = 1; i < steps.length - 1; i++) {
    assert.ok(steps[i].moves < steps[i - 1].moves, `step ${i} did not improve`);
  }
  assert.deepEqual(solve.asked.map((a) => a.solLen), [23, 22, 21, 20, 19],
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

test('the probe budget is passed to every search above the target, and defaults', async () => {
  const solve = scripted([22, 21, 20]);
  await collect(refine('F', { solve, tier: 'twenty' }));
  assert.deepEqual(solve.asked.map((a) => a.probeMax),
    [DEFAULT_PROBE_BUDGET, DEFAULT_PROBE_BUDGET, DEFAULT_PROBE_BUDGET, BONUS_BUDGET]);

  const custom = scripted([22, 21, 20]);
  await collect(refine('F', { solve: custom, tier: 'twenty', probeBudget: 5000, bonusBudget: 7 }));
  assert.deepEqual(custom.asked.map((a) => a.probeMax), [5000, 5000, 5000, 7],
    'a budget is in the engine unit, not milliseconds, and the bonus rate is its own knob');
});


test('a target at or above God\'s number is a promise, so a null answer buys more budget', async () => {
  // The defect this closes: at the <= 20 tier the search could run out of nodes above 20 and
  // report the target missed, which the screen then rendered as "20 was not possible here" —
  // flatly false, God's number being 20. The engine is complete (solvePattern deepens phase-1
  // to solLen - 1), so a null there means the budget was too small and nothing else. Here the
  // fake refuses twice and then answers, and the run must reach 20 rather than stop at 21.
  const solve = scripted([22, 21, null, null, 20]);
  const steps = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.deepEqual(steps.map((st) => st.moves), [22, 21, 20, 20]);
  assert.equal(steps.at(-1).met, true, 'the promise is kept, not merely aimed at');
  assert.equal(steps.at(-1).stopped, STOPPED.MET);
  assert.deepEqual(solve.asked.map((a) => a.probeMax), [
    DEFAULT_PROBE_BUDGET,     // the loose first answer, so there is something on screen
    DEFAULT_PROBE_BUDGET,     // 22 -> 21, still above the target
    DEFAULT_PROBE_BUDGET,     // 21 -> refused
    DEFAULT_PROBE_BUDGET * 2, // ... so ask again with more
    DEFAULT_PROBE_BUDGET * 4, // ... and again
    BONUS_BUDGET,             // 20 reached; the free descent resumes at the bonus rate
  ], 'each refusal doubles the budget; below the target the bonus rate resumes');
});

test('a promised target that cannot be reached at all fails loudly, never quietly', async () => {
  // There is deliberately no "give up and call it impossible" branch: that is the false claim
  // the escalation exists to make unreachable. An engine that refuses every budget is broken,
  // and a broken engine must say so rather than hand the screen a sentence it cannot support.
  const solve = scripted([22, ...Array(MAX_PROMISE_ESCALATIONS + 1).fill(null)]);
  await assert.rejects(() => collect(refine('F', { solve, tier: 'twenty' })),
    /the engine is broken/);
  assert.equal(solve.asked.length, MAX_PROMISE_ESCALATIONS + 2,
    'it escalates exactly the sanctioned number of times before refusing');
});

test('a target BELOW God\'s number still ends honestly when the search falls short', async () => {
  // <= 18 is a different kind of promise: for ~3.5% of positions it genuinely does not exist,
  // and for the rest the search may simply not find it. Either way the run ends rather than
  // escalating forever — and `met: false` says only that this search did not get there.
  assert.ok(GODS_NUMBER === 20, 'the boundary these two tests sit either side of');
  const solve = scripted([22, 20, 19, null]);
  const steps = await collect(refine('F', { solve, tier: 'eighteen' }));
  assert.equal(steps.at(-1).moves, 19);
  assert.equal(steps.at(-1).met, false);
  assert.equal(steps.at(-1).stopped, STOPPED.EXHAUSTED);
  assert.equal(solve.asked.length, 4, 'no escalation below the promise');
});

test('an abort during escalation still ends the run', async () => {
  // The escalation loop must not become a way to ignore a person leaving the screen.
  const controller = new AbortController();
  let calls = 0;
  const solve = async (_f, options) => {
    calls++;
    if (calls === 1) return algOf(22);
    controller.abort();
    return null; // a refusal that would otherwise escalate
  };
  const steps = await collect(refine('F', { solve, tier: 'twenty', signal: controller.signal }));
  assert.equal(steps.at(-1).stopped, STOPPED.CANCELLED);
  assert.ok(calls <= 2, 'it stopped asking once the abort landed');
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
