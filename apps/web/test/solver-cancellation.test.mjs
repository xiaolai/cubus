// Stopping a search that nobody is waiting for any more.
//
// A search is SYNCHRONOUS: a worker in the middle of one never returns to its event loop, so a
// message asking it to stop is not read until the search it was meant to stop has finished. One
// shared word is the only channel that reaches inside a running search, and until 2026-09-04
// nothing used it for that — `app.js` passed no signal, `refine` had a `signal` whose
// STOPPED.CANCELLED path could not be reached from the app, and `solve-client.js` had no way to
// stop ONE search short of ending the thread. A die press or a reconnect answered during a hard
// search queued behind it on every pool worker.
//
// What is tested here is the mechanism rather than the wiring: the predicate the worker polls,
// how often it is polled, and what an abort actually does to a running engine. The predicate in
// particular runs only on a thread no test process has, and both ways it can be wrong are
// invisible from outside — a search that stops early still returns a valid answer, just not the
// same one — so it is a pure function in solve-client.js precisely so it can be asserted at all.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import {
  STOP_NOW, createSolveClient, handleSolveRequest, shouldStop, stopWord,
} from '../lib/solve-client.js';
import { createSolver } from '../lib/solver-engine.js';
import * as twoPhase from '../lib/two-phase.js';

/** Every piece home, every edge flipped: proven to be exactly 20 moves from solved, so a search
 *  bounded at 16 CANNOT succeed and must spend its whole budget — which is what makes it the
 *  right probe for "how much did the search do before it gave up". */
const SUPERFLIP = "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2";
const superflip = twoPhase.toFacelets(applyAlg(SOLVED, SUPERFLIP));
const spent = () => twoPhase.searchStats.p1Nodes + twoPhase.searchStats.p2Nodes;
const NO_BEST = 0x7fffffff;
const freshWord = () => {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.store(word, 0, NO_BEST);
  return word;
};
/** Put the engine back the way solve-worker.js leaves it. Bounds and the stop signal are module
 *  state, so a test that walked away from either would quietly change every test after it. */
const restore = () => {
  twoPhase.setStopSignal(null);
  twoPhase.setBounds({ solLen: 23, probeMax: 100_000_000, maxPhase2: 12 });
};

test('the stop rule is strict, and a depth that means nothing decides nothing', () => {
  const word = freshWord();
  Atomics.store(word, 0, 11);
  // The strictness IS the determinism argument. A sibling that has answered at depth 11 makes
  // depth 12 pointless — nothing found deeper can win. Depth 11 is NOT pointless: at the same
  // depth a lower view index still wins, so a worker that gave up there would change which
  // answer comes back, and the pooled result would stop matching the sequential one.
  assert.equal(shouldStop(word, 12), true, 'a deeper search cannot win and must stop');
  assert.equal(shouldStop(word, 11), false, 'at the SAME depth a lower view index still wins');
  assert.equal(shouldStop(word, 10), false, 'a shallower search can still win');
  // -1 is "no depth applies" — solveIntoG1, or a loop that has finished. A stop decision about
  // no depth is a decision about nothing, and it was a real bug: a stale depth left over from a
  // previous solvePattern once made a stop decision about a search that had already ended.
  assert.equal(shouldStop(word, -1), false, 'a stop must not be decided about no depth at all');
  // No word at all is the ordinary case: one lone worker, or a page without SharedArrayBuffer.
  assert.equal(shouldStop(null, 5), false);
  assert.equal(shouldStop(undefined, 5), false);
  // STOP_NOW is shallower than every real depth, which is the whole of how cancellation works —
  // no second channel, and no value a late winner could publish over it.
  Atomics.store(word, 0, STOP_NOW);
  for (const depth of [0, 1, 11, 20]) {
    assert.equal(shouldStop(word, depth), true, `STOP_NOW must stop a search at depth ${depth}`);
  }
  assert.equal(shouldStop(word, -1), false, 'even STOP_NOW decides nothing about no depth');
  // And nothing a winner publishes can undo it: the pool's compare-exchange only ever lowers
  // the word, and there is nothing below -1 to lower it to.
  assert.ok(STOP_NOW < 0, 'STOP_NOW must be below every phase-1 depth a winner can publish');
});

test('the search asks whether to stop about once every 65,536 nodes', () => {
  // The cadence is a trade with two failure modes and no test until now: ask every node and the
  // question costs more than the search, ask every million and a stop arrives too late to be
  // worth having. At ~20 ns a node, 65,536 nodes is ~1.3 ms of latency on a stop and well under
  // a thousandth of the work between asks.
  //
  // Measured: 28 polls for a 1,000,000-node budget and 89 for 5,000,000 — in each case
  // floor(budget / 65536) from inside the DFS, plus one per phase-1 depth the outer loop starts
  // (13 of them here). The bounds below are that identity with room for the outer loop to change
  // its shape, and they still catch either failure mode by a wide margin.
  try {
    for (const budget of [1_000_000, 5_000_000]) {
      let polls = 0;
      twoPhase.setStopSignal(() => { polls += 1; return false; });
      twoPhase.setBounds({ solLen: 16, probeMax: budget });
      assert.equal(twoPhase.solvePattern(superflip), null, 'the superflip has no 15-move solution');
      assert.equal(spent(), budget, 'and the search must have spent its whole budget');
      const inDfs = Math.floor(budget / 65536);
      assert.ok(polls >= inDfs, `${polls} polls for ${budget} nodes — the search is not asking`);
      assert.ok(polls <= inDfs + 24, `${polls} polls for ${budget} nodes — it is asking far too often`);
    }
  } finally {
    restore();
  }
});

test('a stop published mid-search is seen at the next poll, not at the end of the budget', () => {
  // The claim the whole cancellation design rests on, on the real engine: writing STOP_NOW into
  // the word ends a running search almost at once. The publish happens INSIDE the twentieth poll
  // — which is the only way to do this on one thread, since the search never yields — and the
  // decision is made by the real `shouldStop`, not by the test.
  try {
    const word = freshWord();
    let polls = 0;
    twoPhase.setStopSignal((depth) => {
      polls += 1;
      if (polls === 20) Atomics.store(word, 0, STOP_NOW);
      return shouldStop(word, depth);
    });
    twoPhase.setBounds({ solLen: 16, probeMax: 50_000_000 });
    assert.equal(twoPhase.solvePattern(superflip), null);
    assert.equal(polls, 20, 'the search asked again after being told to stop');
    assert.ok(spent() < 1_000_000,
      `${spent()} nodes spent after a stop at ~586k — the abort did not reach both phases`);
    assert.ok(spent() > 0, 'and it really was searching, or this proves nothing');
  } finally {
    restore();
  }
});

/** A worker-shaped object that runs the REAL engine, one message at a time, on a macrotask.
 *
 *  The delay is the point: it is what lets an abort land while the request is queued, which is
 *  the only way to reproduce a superseded search on a single thread. Everything else is exactly
 *  what solve-worker.js does — the same handleSolveRequest, the same per-request stop word, the
 *  same predicate. */
function engineWorker() {
  const solve = createSolver(twoPhase);
  const readStats = () => twoPhase.searchStats;
  const listeners = new Map();
  let best = null;
  twoPhase.setStopSignal((depth) => shouldStop(best, depth));
  const w = {
    sent: [],
    terminated: 0,
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    postMessage(request) {
      w.sent.push(request);
      setTimeout(() => {
        if (w.terminated > 0) return;
        best = stopWord(request.shared);
        try {
          listeners.get('message')?.({ data: handleSolveRequest(solve, request, readStats) });
        } finally {
          best = null;
        }
      }, 0);
    },
    terminate() { w.terminated += 1; },
  };
  return w;
}

test('an abandoned search stops inside the engine, and its worker is kept', async () => {
  // End to end over the client: a solve with a signal, aborted, against the real two-phase
  // engine. Three things have to be true at once, and the third is why this is not simply a
  // cancel(): the search stops, the answer comes back as the null a stopped search returns, and
  // the THREAD survives with its ~10 MB of tables — so the next cube pays nothing to rebuild
  // them. Ending the thread would have cost 0.5-2.6 s on the very next press.
  try {
    let spawns = 0;
    const w = engineWorker();
    const client = createSolveClient({ spawn: () => { spawns += 1; return w; } });
    const word = freshWord();
    const controller = new AbortController();
    const abandoned = client.solve(superflip, {
      solLen: 21, probeMax: 100_000_000, shared: word, signal: controller.signal,
    });
    controller.abort();
    assert.equal(Atomics.load(word, 0), STOP_NOW, 'the abort never reached the running search');

    assert.equal(await abandoned, null, 'an abandoned search answers null, never an algorithm');
    assert.ok(spent() < 100_000, `${spent()} nodes spent on a search nobody was waiting for`);
    assert.equal(w.terminated, 0, 'the thread was ended — its tables die with it');

    // And the same worker answers the next cube, which is the point of not ending it.
    const easy = twoPhase.toFacelets(applyAlg(SOLVED, "R U F D L B R"));
    const answer = await client.solve(easy, { solLen: 21, probeMax: 10_000_000 });
    assert.ok(answer && answer.trim().length > 0, 'the kept worker stopped answering');
    assert.equal(spawns, 1, 'a second spawn means the tables were rebuilt after all');
    assert.equal(w.sent.length, 2, 'and both searches went to the one worker');
  } finally {
    restore();
  }
});

test('a worker that never loads falls back to this thread; one that merely died does not', async () => {
  // The third way to have no worker, and the one nothing handled: `new Worker(...)` succeeds and
  // the module then fails to LOAD — a 404, a syntax error, an import the page cannot resolve.
  // The failure is asynchronous, so neither the `typeof Worker` check nor the constructor's
  // try/catch sees it; every later spawn built another thread exactly as doomed, and the pool
  // "fell back" to a single worker that could not load either.
  //
  // Remembering that is only safe because a load failure is distinguishable from a death: a
  // module that will not load never delivers a message. A thread that answered and then ran out
  // of memory must NOT move every future search onto the main thread — that trades one lost
  // search for a permanently blocked page.
  //
  // Each half needs its own module instance: "this page cannot build workers" is deliberately
  // sticky, so a second import with a different query string is the only way to ask twice.
  class FakeWorker {
    constructor() {
      this.handlers = new Map();
      this.terminated = 0;
    }

    addEventListener(type, fn) {
      if (!this.handlers.has(type)) this.handlers.set(type, []);
      this.handlers.get(type).push(fn);
    }

    postMessage() {}
    terminate() { this.terminated += 1; }
    fire(type, event) { for (const fn of [...this.handlers.get(type) ?? []]) fn(event); }
  }

  const realWorker = globalThis.Worker;
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    Object.defineProperty(globalThis, 'Worker', { value: FakeWorker, configurable: true });

    const brokenModule = await import('../lib/solve-client.js?spawn-never-loads');
    const doomed = brokenModule.spawnSolveWorker();
    assert.notEqual(doomed.inline, true, 'a constructed worker is a real one until proved otherwise');
    doomed.fire('error', { message: 'Failed to load module script' });
    assert.equal(brokenModule.spawnSolveWorker().inline, true,
      'a module that will not load must not be built again — the next spawn runs on this thread');

    const diedLater = await import('../lib/solve-client.js?spawn-dies-later');
    const worker = diedLater.spawnSolveWorker();
    worker.fire('message', { data: { id: 1, ok: true, alg: 'R U', depth: 9, view: 0 } });
    worker.fire('error', { message: 'out of memory' });
    assert.notEqual(diedLater.spawnSolveWorker().inline, true,
      'a thread that answered before dying is no reason to block the page for the rest of the session');
  } finally {
    console.warn = realWarn;
    if (realWorker === undefined) delete globalThis.Worker;
    else Object.defineProperty(globalThis, 'Worker', { value: realWorker, configurable: true });
  }
});
