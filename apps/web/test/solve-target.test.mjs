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
  // Something must be on screen before any waiting — but never a count above God's number, so
  // the first search asks for the FLOOR rather than the engine's ceiling. That is what makes
  // steps[0] already met at the <= 20 tier: the first thing shown is also an answer that
  // cannot be longer than 20.
  const solve = scripted([20, 19, 18]);
  const steps = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.equal(steps[0].moves, 20, 'the first thing shown is an answer, and it is under the floor');
  assert.equal(steps[0].met, true, 'at <= 20 the first answer already meets the target');
  assert.equal(steps[0].stopped, null, 'and it is marked as still improving');
  assert.equal(solve.asked[0].solLen, GODS_NUMBER + 1, 'the first search asks for the floor');
});

test('every improvement is strictly shorter than the last', async () => {
  const solve = scripted([20, 19, 18, 17]);
  const steps = await collect(refine('F', { solve, tier: 'nineteen' }));
  assert.deepEqual(steps.map((s) => s.moves), [20, 19, 18, 17, 17],
    'the final step repeats the answer to carry the stop reason');
  for (let i = 1; i < steps.length - 1; i++) {
    assert.ok(steps[i].moves < steps[i - 1].moves, `step ${i} did not improve`);
  }
  assert.deepEqual(solve.asked.map((a) => a.solLen), [21, 20, 19, 18, 17],
    'each search asks for strictly shorter than what is already in hand');
  assert.equal(steps.at(-1).stopped, STOPPED.MET);
});

test('a target that cannot be met is reported as missed, not dressed up', async () => {
  // The <= 18 tier on a cube whose optimal is 19: no budget reaches it, because 18 does not
  // exist for that cube. The answer still stands; the claim does not.
  const solve = scripted([20, 19, null]);
  const steps = await collect(refine('F', { solve, tier: 'eighteen' }));
  const last = steps.at(-1);
  assert.equal(last.moves, 19, 'the best answer found is kept');
  assert.equal(last.met, false, 'and is NOT reported as meeting the target');
  assert.equal(last.stopped, STOPPED.EXHAUSTED);
  assert.equal(last.target, 18);
});

test('the untargeted rung keeps going until nothing shorter is found', async () => {
  const solve = scripted([20, 19, 18, 17, 16, null]);
  const steps = await collect(refine('F', { solve, tier: 'shortest' }));
  assert.deepEqual(steps.map((s) => s.moves), [20, 19, 18, 17, 16, 16]);
  const last = steps.at(-1);
  assert.equal(last.target, null);
  assert.equal(last.met, false, 'there is no target, so nothing was met');
  assert.equal(last.stopped, STOPPED.EXHAUSTED);
});

test('cancelling keeps the best answer so far and says it was cancelled', async () => {
  const controller = new AbortController();
  const solve = scripted([20, 19, 18, 17, 16]);
  const steps = [];
  for await (const step of refine('F', { solve, tier: 'shortest', signal: controller.signal })) {
    steps.push(step);
    if (step.moves === 19) controller.abort();
  }
  const last = steps.at(-1);
  assert.equal(last.moves, 19, 'the answer on screen when it was stopped is the answer kept');
  assert.equal(last.stopped, STOPPED.CANCELLED);
  assert.equal(last.met, false);
});

test('the signal rides ALONG WITH the bounds, into every search', async () => {
  // The contract with lib/solve-client.js, and the half that makes cancellation work at all.
  // Checking `signal.aborted` between asks stops the NEXT search; it does nothing about the one
  // already running, and a search is synchronous — on a worker it does not return to its event
  // loop, so nothing can reach it except the stop word its client publishes into. The client can
  // only do that if the signal arrives WITH the request. It used not to: `refine` had a signal
  // it checked and never forwarded, so STOPPED.CANCELLED was unreachable from a real search.
  const controller = new AbortController();
  const solve = scripted([20, 19, 18]);
  await collect(refine('F', { solve, tier: 'shortest', signal: controller.signal }));
  assert.ok(solve.asked.length >= 2, 'the fixture must have made several searches');
  for (const [i, bounds] of solve.asked.entries()) {
    assert.equal(bounds.signal, controller.signal, `search ${i} was sent without the signal`);
  }
});

test('a null that arrives with an abort is CANCELLED, never EXHAUSTED', async () => {
  // A stopped search answers null, exactly as an exhausted one does — the engine gives up, it
  // does not report why. So the null alone cannot say which happened, and reading it as
  // exhaustion would tell someone who pressed a button that the solver had run out of ideas.
  // That is the same class of wrong answer as calling a missed target an impossibility.
  const controller = new AbortController();
  const solve = async (facelets, bounds) => {
    if (bounds.solLen === 20) { // the 20 -> 19 ask: stopped, not exhausted
      controller.abort();
      return null;
    }
    return algOf(20);
  };
  const steps = await collect(refine('F', { solve, tier: 'twenty', signal: controller.signal }));
  const last = steps.at(-1);
  assert.equal(last.moves, 20, 'the answer in hand is kept');
  assert.equal(last.stopped, STOPPED.MET, 'a kept promise stays kept whatever ended the extras');

  // And below the promise, where there is nothing to report as met, it says cancelled.
  const other = new AbortController();
  const tight = async (facelets, bounds) => {
    if (bounds.solLen === 19) { other.abort(); return null; }
    return algOf(bounds.solLen === 21 ? 20 : 19);
  };
  const tightSteps = await collect(refine('F', { solve: tight, tier: 'eighteen', signal: other.signal }));
  assert.equal(tightSteps.at(-1).stopped, STOPPED.CANCELLED,
    'a search stopped by a person is not a search that ran out');
  assert.equal(tightSteps.at(-1).met, false);
});

test('the escalating first search reports each attempt, and what it has spent', async () => {
  // The wait nothing could see. Only the FIRST search escalates, and it can spend 511x the base
  // budget before anything at all is yielded — several minutes with an empty screen and no way
  // to say how much of it has gone. `onProgress` is that window, and it is called BEFORE each
  // attempt so the number on screen is the work about to be done rather than a report after
  // the fact.
  const seen = [];
  const solve = scripted([null, null, 20]);
  await collect(refine('F', {
    solve, tier: 'twenty', probeBudget: 1000, onProgress: (p) => seen.push(p),
  }));
  assert.deepEqual(seen, [
    { attempt: 0, budget: 1000, spent: 0 },
    { attempt: 1, budget: 2000, spent: 1000 },
    { attempt: 2, budget: 4000, spent: 3000 },
  ], 'each attempt, the budget it is about to spend, and everything spent before it');
  // The descent below the floor does NOT report: it is bounded, every rung yields, and a caller
  // watching it would be told about work it can already see.
  assert.equal(seen.length, 3, 'the free descent must not masquerade as escalation');
});

test('the raise says what the whole run cost, not what its last attempt asked for', async () => {
  // The message used to name `budget` — the last doubled figure — which reads as the size of
  // the search rather than as its cost. A run that reported "12.8 billion nodes" had spent
  // 25.5 billion getting there, and the number nobody had was the one that answers "how long
  // was I waiting".
  const solve = scripted(Array(MAX_PROMISE_ESCALATIONS + 2).fill(null));
  await assert.rejects(
    () => collect(refine('F', { solve, tier: 'twenty', probeBudget: 1000 })),
    (err) => {
      // 1000 * (2^9 - 1) = 511,000 over nine attempts; the last of them asked for 256,000.
      assert.match(err.message, /spending up to 511000 nodes in all/, err.message);
      assert.match(err.message, /the last attempt asked for 256000/, err.message);
      return true;
    },
  );
});

test('an onProgress that is not a function is refused, not ignored', async () => {
  // Silently not calling it looks exactly like a search that never escalated.
  const solve = scripted([20]);
  await assert.rejects(() => collect(refine('F', { solve, onProgress: 'tell me' })), TypeError);
  assert.equal(solve.asked.length, 0, 'and nothing was searched first');

  // And refused BEFORE the abort check, which is the rule this module states for every other
  // input and was the one place it did not keep (2026-09-05): `refine` returned quietly on an
  // aborted signal and the watcher was validated afterwards, inside `solveWithinGodsNumber`, so
  // a caller that had made this mistake could go a whole session without being told.
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => collect(refine('F', { solve, onProgress: 'tell me', signal: controller.signal })),
    TypeError,
    'a malformed call is malformed whether or not anyone is still waiting for the answer',
  );
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
  // Not "out of budget": the first ask escalates through every sanctioned budget, so a solver
  // that refuses all of them means the state is unsolvable or the engine is broken. Returning
  // null would let a screen render nothing at all.
  const solve = scripted(Array(MAX_PROMISE_ESCALATIONS + 2).fill(null));
  await assert.rejects(() => collect(refine('F', { solve })),
    /found no solution of 20 moves or fewer/);
});

test('a solver that breaks its own contract is refused, not passed through', async () => {
  // Asked for fewer than 20, answered with 20. Yielding it would break the one guarantee this
  // module makes, and the move list would go backwards in front of the learner.
  const solve = scripted([20, 20]);
  await assert.rejects(() => collect(refine('F', { solve, tier: 'shortest' })),
    /returned 20 moves when asked for fewer than 20/);
});

test('the probe budget is passed to every search above the target, and defaults', async () => {
  // At <= 20 the FIRST answer already meets the target, so the free-descent rate starts right
  // after it — which is the point of asking for the floor first rather than the ceiling.
  const solve = scripted([20, 19, 18]);
  await collect(refine('F', { solve, tier: 'twenty' }));
  assert.deepEqual(solve.asked.map((a) => a.probeMax),
    [DEFAULT_PROBE_BUDGET, BONUS_BUDGET, BONUS_BUDGET, BONUS_BUDGET]);

  // A tier below the floor keeps spending the full budget until its own target is met.
  const tight = scripted([20, 19, 18]);
  await collect(refine('F', { solve: tight, tier: 'eighteen' }));
  assert.deepEqual(tight.asked.map((a) => a.probeMax),
    [DEFAULT_PROBE_BUDGET, DEFAULT_PROBE_BUDGET, DEFAULT_PROBE_BUDGET, BONUS_BUDGET]);

  const custom = scripted([20, 19, 18]);
  await collect(refine('F', { solve: custom, tier: 'eighteen', probeBudget: 5000, bonusBudget: 7 }));
  assert.deepEqual(custom.asked.map((a) => a.probeMax), [5000, 5000, 5000, 7],
    'a budget is in the engine unit, not milliseconds, and the bonus rate is its own knob');
});


test('the first answer is the floor, and a refusal there buys more budget', async () => {
  // The floor is kept at the FIRST search now, because that is the only place it can be missed:
  // the first ask is for <= 20, and every later ask only shortens. A null there cannot mean "no
  // such solution exists" — God's number says one always does — so it can only mean the budget
  // was too small, and the ask repeats with twice as much.
  const solve = scripted([null, null, 20, 19]);
  const steps = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.equal(steps[0].moves, 20, 'the first answer shown is at or below the floor');
  assert.deepEqual(solve.asked.slice(0, 3).map((a) => a.probeMax),
    [DEFAULT_PROBE_BUDGET, DEFAULT_PROBE_BUDGET * 2, DEFAULT_PROBE_BUDGET * 4],
    'each refusal doubles the budget');
  assert.deepEqual(solve.asked.slice(0, 3).map((a) => a.solLen),
    [GODS_NUMBER + 1, GODS_NUMBER + 1, GODS_NUMBER + 1],
    'and every one asks for the floor, never a looser bound');
});

test('the floor is under EVERY tier, because it is a fact about the cube', async () => {
  // The bug this closes: the guarantee once keyed on `target >= 20`, true of exactly one rung.
  // Measured on the real engine at a reduced budget, <= 19, <= 18 and "shortest" each finished
  // at 21 — and "shortest" is the worst, because someone who asked for the shortest solution
  // there is was handed one LONGER than the <= 20 rung would have given them.
  for (const tier of ['twenty', 'nineteen', 'eighteen', 'shortest']) {
    const solve = scripted([null, 20]);
    const steps = await collect(refine('F', { solve, tier }));
    assert.ok(steps[0].moves <= GODS_NUMBER, `${tier}: the first answer is above the floor`);
    assert.equal(solve.asked[0].solLen, GODS_NUMBER + 1, `${tier}: asked for something else`);
    assert.equal(solve.asked[1].probeMax, DEFAULT_PROBE_BUDGET * 2, `${tier}: did not escalate`);
  }
});

test('a floor that cannot be reached at all fails loudly, never quietly', async () => {
  // There is deliberately no "give up and show something longer" branch: that is the outcome
  // the floor exists to make unreachable. The message names both causes rather than accusing
  // the engine, because a caller may pass any budget it likes.
  const solve = scripted(Array(MAX_PROMISE_ESCALATIONS + 2).fill(null));
  // The message names the unsolvable case FIRST: the engine returns null both for "out of
  // budget" and for "not a solvable state", and this module never establishes legality — so
  // leading with "a solution always exists" would state a guarantee that only holds for a
  // legal cube, about a state that may not be one.
  await assert.rejects(() => collect(refine('F', { solve, tier: 'twenty' })),
    /Either this is not a solvable cube/);
  assert.equal(solve.asked.length, MAX_PROMISE_ESCALATIONS + 1,
    'it escalates exactly the sanctioned number of times before refusing');
});

test('below the floor, exhaustion is an honest end for every tier', async () => {
  // Why the floor is a floor and not a promise to reach the target: 18 genuinely does not exist
  // for roughly 3.5% of positions, so a search that stops at 19 must be free to stop and say so.
  const solve = scripted([20, 19, null]);
  const steps = await collect(refine('F', { solve, tier: 'eighteen' }));
  assert.equal(steps.at(-1).moves, 19);
  assert.equal(steps.at(-1).met, false, 'it says plainly that 18 was not reached');
  assert.equal(steps.at(-1).stopped, STOPPED.EXHAUSTED);
  assert.equal(solve.asked.length, 3, 'and it did NOT escalate below the floor');
});

test('an abort while escalating for the floor yields nothing at all', async () => {
  // Nothing has been shown yet, so there is no answer to keep — the same rule as an abort
  // before any search ran. Inventing a first frame from a withdrawn run would be worse.
  const controller = new AbortController();
  let calls = 0;
  const solve = async () => { calls += 1; controller.abort(); return null; };
  const steps = await collect(refine('F', { solve, tier: 'twenty', signal: controller.signal }));
  assert.deepEqual(steps, [], 'an abort before the first answer shows nothing');
  assert.equal(calls, 1, 'and it stopped asking immediately');
});

test('an abort on the LAST permitted attempt is a person leaving, not a broken engine', async () => {
  // The ordering the cap depends on. The abort check sits BEFORE the cap throw, so a run
  // cancelled on its final permitted attempt reports as cancelled — reversing those two lines
  // would accuse the engine of being broken over a cube nobody is waiting for any more.
  // This test was lost when the escalation moved from the descent loop to the first search;
  // it is restored here because the ordering is what makes the cap safe.
  const controller = new AbortController();
  let calls = 0;
  const solve = async () => {
    calls += 1;
    if (calls === MAX_PROMISE_ESCALATIONS + 1) controller.abort(); // the last one allowed
    return null;
  };
  const steps = await collect(refine('F', { solve, tier: 'twenty', signal: controller.signal }));
  assert.deepEqual(steps, [], 'nothing was ever shown, so nothing is yielded');
  assert.equal(calls, MAX_PROMISE_ESCALATIONS + 1, 'and no further attempt was started');
});

test('a budget that cannot double fails loudly rather than downstream', async () => {
  // Doubling past the safe-integer range would hand the engine boundary a malformed budget and
  // fail as "probeMax is not a positive integer" — a confusing answer for a caller whose only
  // sin was asking for a very large budget.
  const solve = scripted([null, null]);
  await assert.rejects(
    () => collect(refine('F', { solve, tier: 'twenty', probeBudget: Number.MAX_SAFE_INTEGER - 1 })),
    /cannot be doubled past/,
  );
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
  // A broken solver answering the first ask with more than the floor allows used to slip
  // through unchecked. The bound it is held to is the floor, like every later ask.
  const solve = scripted([25]);
  await assert.rejects(() => collect(refine('F', { solve })),
    /returned 25 moves when asked for fewer than 21/);
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
  const base = scripted([20, 19, 18]);
  const solve = async (facelets, bounds) => {
    const answer = await base(facelets, bounds);
    if (bounds.solLen === 20) controller.abort(); // mid-flight, during the 20 -> 19 attempt
    return answer;
  };
  const steps = await collect(refine('F', { solve, tier: 'shortest', signal: controller.signal }));
  const last = steps.at(-1);
  assert.equal(last.stopped, STOPPED.CANCELLED);
  assert.equal(last.moves, 19, 'the improvement that arrived with the abort is kept');
  assert.equal(base.asked.length, 2, 'and no further search was started');
});

test('a cube solved by an IMPROVEMENT ends the descent, rather than asking for shorter than nothing', async () => {
  // The zero-move terminal handling applied to the first answer only, so a descent that actually
  // reached a solved cube yielded it as still improving and then asked for `solLen: 0`. The engine
  // boundary refuses that as out of range — so the last rung of an easy solve was a RangeError
  // rather than an answer (2026-09-05 audit; reproduced with "R R'" followed by "").
  //
  // The fake refuses solLen < 1 exactly as lib/solver-engine.js does: a fake looser than the real
  // boundary would have made the invalid ask invisible, which is how this survived.
  const bounded = (lengths) => {
    const inner = scripted(lengths);
    const solve = async (facelets, options) => {
      if (!Number.isInteger(options.solLen) || options.solLen < 1) {
        throw new RangeError(`solver-engine: solLen ${options.solLen} is outside 1..23`);
      }
      return inner(facelets, options);
    };
    solve.asked = inner.asked;
    return solve;
  };

  const solve = bounded([2, 0]);
  const steps = await collect(refine('F', { solve, tier: 'twenty' }));
  assert.deepEqual(steps.map((s) => s.moves), [2, 0], 'the solved cube is the last thing shown');
  assert.equal(steps.at(-1).stopped, STOPPED.MET, 'zero moves meets any numeric target');
  assert.equal(steps.at(-1).alg, '');
  assert.deepEqual(solve.asked.map((a) => a.solLen), [GODS_NUMBER + 1, 2],
    'nothing may ask for a solution shorter than nothing');

  // And on the untargeted rung, where there is no target to meet: nothing improves on zero.
  const shortest = bounded([2, 0]);
  const descent = await collect(refine('F', { solve: shortest, tier: 'shortest' }));
  assert.deepEqual(descent.map((s) => s.moves), [2, 0]);
  assert.equal(descent.at(-1).stopped, STOPPED.EXHAUSTED);
  assert.equal(shortest.asked.length, 2, 'and the search stopped rather than asking again');
});
