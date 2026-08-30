// The thread boundary is where a search can be lost without anyone noticing: a worker that dies
// leaves every promise pending, and a screen waiting on a promise that will never settle looks
// exactly like a search that is still going. So most of this is about the ways a worker fails
// rather than the way it succeeds.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CANCELLED_MESSAGE, createParallelSolveClient, createSolveClient, pickWinner, shareBudget,
  sliceViews, stopDescriptor, stopWord,
} from '../lib/solve-client.js';
import { DEFAULT_NODE_BUDGET } from '../lib/solver-engine.js';

/** A worker that answers however the test tells it to, in the tagged reply protocol. */
function fakeWorker({ reply = (msg) => ({ id: msg.id, ok: true, alg: 'R U', depth: 9, view: (msg.views?.[0] ?? 0) }), autoReply = true } = {}) {
  const listeners = new Map();
  const w = {
    sent: [],
    terminated: 0,
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    postMessage(msg) {
      w.sent.push(msg);
      if (autoReply) queueMicrotask(() => listeners.get('message')?.({ data: reply(msg) }));
    },
    terminate() { w.terminated++; },
    fail: (message) => listeners.get('error')?.({ message }),
    emit: (data) => listeners.get('message')?.({ data }),
  };
  return w;
}

test('a client needs a way to make a worker', () => {
  assert.throws(() => createSolveClient(), TypeError);
  assert.throws(() => createSolveClient({ spawn: 'nope' }), TypeError);
});

test('a search is forwarded with its bounds and answered', async () => {
  const w = fakeWorker();
  const client = createSolveClient({ spawn: () => w });
  const alg = await client.solve('F'.repeat(54), { solLen: 21, probeMax: 100 });
  assert.equal(alg, 'R U');
  // `views: null` is on every request, not only a parallel one: the field is the protocol's,
  // and a single-worker client sending a DIFFERENT shape from a pooled one is how the two
  // drift apart. Null means "all six views", which is what one worker always searches.
  // `views: null` and `shared: null` ride on EVERY request, not only a pooled one: the fields
  // are the protocol's, and a single-worker client sending a different shape from a pooled one
  // is how the two drift apart. Null views means all of them; null shared means nothing can
  // call this search off, which is exactly a lone worker's situation.
  assert.deepEqual(w.sent[0], {
    id: 1, facelets: 'F'.repeat(54), solLen: 21, probeMax: 100, views: null, shared: null,
  });
});

test('the worker is made once and reused across searches', async () => {
  let spawns = 0;
  const w = fakeWorker();
  const client = createSolveClient({ spawn: () => { spawns++; return w; } });
  await client.solve('F'.repeat(54));
  await client.solve('F'.repeat(54));
  assert.equal(spawns, 1, 'rebuilding the pruning tables per search would cost ~260 ms each time');
  assert.deepEqual(w.sent.map((m) => m.id), [1, 2], 'and each search is told apart by id');
});

test('null comes back as null — "nothing that short" is an answer, not a failure', async () => {
  const w = fakeWorker({ reply: (msg) => ({ id: msg.id, ok: true, alg: null }) });
  const client = createSolveClient({ spawn: () => w });
  assert.equal(await client.solve('F'.repeat(54)), null);
});

test('an error from the worker rejects rather than resolving with junk', async () => {
  const w = fakeWorker({ reply: (msg) => ({ id: msg.id, ok: false, error: 'bounds patch did not apply' }) });
  const client = createSolveClient({ spawn: () => w });
  await assert.rejects(() => client.solve('F'.repeat(54)), /bounds patch did not apply/);
});

test('a worker that dies rejects everything in flight instead of hanging', async () => {
  // The failure this test exists for: a pending promise that never settles is indistinguishable
  // from a search still running, so the screen would wait forever with nothing red anywhere.
  const w = fakeWorker({ autoReply: false });
  const client = createSolveClient({ spawn: () => w });
  const first = client.solve('F'.repeat(54));
  const second = client.solve('F'.repeat(54));
  w.fail('out of memory');
  await assert.rejects(() => first, /solver worker failed: out of memory/);
  await assert.rejects(() => second, /solver worker failed: out of memory/);
  assert.equal(client.idle, true, 'and nothing is left waiting');
});

test('cancelling ends the thread, because a running search cannot be interrupted', async () => {
  // the engine is a synchronous search loop. Ignoring its result would leave a core
  // burning for up to half a minute at the tightest tier, so cancel really does terminate.
  const w = fakeWorker({ autoReply: false });
  const client = createSolveClient({ spawn: () => w });
  const inFlight = client.solve('F'.repeat(54));
  client.cancel();
  await assert.rejects(() => inFlight, new RegExp(CANCELLED_MESSAGE));
  assert.equal(w.terminated, 1);
});

test('a fresh worker is made after a cancel', async () => {
  let spawns = 0;
  const client = createSolveClient({ spawn: () => { spawns++; return fakeWorker(); } });
  await client.solve('F'.repeat(54));
  client.cancel();
  await client.solve('F'.repeat(54));
  assert.equal(spawns, 2, 'the terminated worker must not be reused');
});

test('a reply to an abandoned search is ignored, not mistaken for the current one', async () => {
  // After a cancel the old worker may still deliver. Resolving the new search with the old
  // answer would show a solution for a cube that is no longer on screen.
  const w = fakeWorker({ autoReply: false });
  const client = createSolveClient({ spawn: () => w });
  const abandoned = client.solve('F'.repeat(54));
  await assert.rejects(() => { client.cancel(); return abandoned; }, new RegExp(CANCELLED_MESSAGE));
  assert.doesNotThrow(() => w.emit({ id: 1, alg: 'R U R\'' }), 'a late reply must be harmless');
});

test('with no Worker at all, solving still happens — loudly, on this thread', async () => {
  // Every browser and webview the app ships in has Worker. This is for the ones that do not,
  // and it is what lets the DOM tests drive the real solver rather than a stub. It must warn:
  // a search that silently blocks the page for half a minute is the worse failure.
  const { spawnSolveWorker } = await import('../lib/solve-client.js');
  const realWorker = globalThis.Worker;
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    Object.defineProperty(globalThis, 'Worker', { value: undefined, configurable: true });
    const client = createSolveClient({ spawn: spawnSolveWorker });
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
    Cube.initSolver();
    const facelets = new Cube().move("R U R' U' F2 L D L' B2").asString();

    const alg = await client.solve(facelets, { solLen: 23, probeMax: 2_000_000 });
    assert.ok(alg && alg.trim().length > 0, 'the fallback produced no solution');
    const oracle = Cube.fromString(facelets);
    oracle.move(alg);
    assert.ok(oracle.isSolved(), 'the fallback must produce a solution that actually solves');
    assert.ok(warnings.some((w) => /no Worker/.test(w)), 'the fallback must say it is blocking');
  } finally {
    console.warn = realWarn;
    if (realWorker === undefined) delete globalThis.Worker;
    else Object.defineProperty(globalThis, 'Worker', { value: realWorker, configurable: true });
  }
});

test('the fallback honours a length bound too', async () => {
  const { spawnSolveWorker } = await import('../lib/solve-client.js');
  const realWorker = globalThis.Worker;
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    Object.defineProperty(globalThis, 'Worker', { value: undefined, configurable: true });
    const client = createSolveClient({ spawn: spawnSolveWorker });
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
    Cube.initSolver();
    const facelets = new Cube().move("R U R' U' F2 L D L' B2").asString();
    const alg = await client.solve(facelets, { solLen: 15, probeMax: 2_000_000 });
    assert.ok(alg, 'no solution under 15 for a nine-move scramble');
    assert.ok(alg.trim().split(/\s+/).length < 15, 'the bound must hold on the fallback path too');
  } finally {
    console.warn = realWarn;
    if (realWorker === undefined) delete globalThis.Worker;
    else Object.defineProperty(globalThis, 'Worker', { value: realWorker, configurable: true });
  }
});

test('a stale event from a replaced worker cannot touch its replacement', async () => {
  // The regression: both listeners closed over the mutable `worker`, so a delayed error from a
  // dead worker rejected the NEW worker's requests and nulled it out.
  const first = fakeWorker({ autoReply: false });
  const second = fakeWorker();
  const workers = [first, second];
  const client = createSolveClient({ spawn: () => workers.shift() });

  const doomed = client.solve('F'.repeat(54));
  first.fail('gpu process died');
  await assert.rejects(() => doomed, /solver worker failed/);
  assert.equal(first.terminated, 1, 'the failed worker is really terminated, not leaked');

  const answered = client.solve('F'.repeat(54));
  first.fail('a late death rattle from the corpse');
  first.emit({ id: 2, ok: false, error: 'stale reply' });
  assert.equal(await answered, 'R U', 'the replacement answered; the corpse changed nothing');
});

test('a synchronous send failure rejects and leaves no pending entry behind', async () => {
  const w = fakeWorker();
  w.postMessage = () => {
    throw new Error('DataCloneError, say');
  };
  const client = createSolveClient({ spawn: () => w });
  await assert.rejects(() => client.solve('F'.repeat(54)), /DataCloneError/);
  assert.equal(client.idle, true, 'the failed request must not haunt the bookkeeping');
});

test('a malformed reply rejects the search instead of resolving junk', async () => {
  // ok is the tag: absent ok, or a success carrying a non-string non-null alg, is a protocol
  // violation — resolving it would hand the screen junk with nothing red anywhere.
  for (const bad of [{ alg: 'R U' }, { ok: true, alg: 42 }, { ok: true, alg: undefined }]) {
    const w = fakeWorker({ reply: (msg) => ({ id: msg.id, ...bad }) });
    const client = createSolveClient({ spawn: () => w });
    await assert.rejects(() => client.solve('F'.repeat(54)), /malformed reply/, JSON.stringify(bad));
  }
});

test('an empty error message still rejects — ok is the tag, not truthiness', async () => {
  const w = fakeWorker({ reply: (msg) => ({ id: msg.id, ok: false, error: '' }) });
  const client = createSolveClient({ spawn: () => w });
  await assert.rejects(() => client.solve('F'.repeat(54)));
});

test('a spawn that throws rejects the promise instead of escaping solve()', async () => {
  const client = createSolveClient({ spawn: () => { throw new Error('Worker refused to start'); } });
  await assert.rejects(() => client.solve('F'.repeat(54)), /Worker refused to start/);
  assert.equal(client.idle, true);
});

test('a failure reply whose error is not a string is a malformed reply', async () => {
  // new Error(Symbol()) throws — after the pending entry was deleted, which would have left
  // the caller's promise unsettled forever. Non-string reasons are malformed, full stop.
  const w = fakeWorker({ reply: (msg) => ({ id: msg.id, ok: false, error: Symbol('boom') }) });
  const client = createSolveClient({ spawn: () => w });
  await assert.rejects(() => client.solve('F'.repeat(54)), /malformed reply/);
});

// ---- the parallel client ----------------------------------------------------------------------
//
// The property that makes this safe is DETERMINISM, not "identical to the single worker". The
// pool sorts replies by (depth, view) — the order the sequential engine searches in — so arrival
// order cannot change the result. It equals the single-worker answer whenever each slice can
// afford what the shared budget would have reached, which held 40/40 offline and 90/90 in a
// browser at the shipped budget; under budget pressure it diverges, and the boundary is pinned
// below rather than left to be rediscovered.

test('the views are dealt round-robin, so no worker gets all the slow ones', () => {
  assert.deepEqual(sliceViews(3, 6), [[0, 3], [1, 4], [2, 5]]);
  assert.deepEqual(sliceViews(2, 6), [[0, 2, 4], [1, 3, 5]]);
  assert.deepEqual(sliceViews(6, 6), [[0], [1], [2], [3], [4], [5]]);
  assert.deepEqual(sliceViews(10, 6), [[0], [1], [2], [3], [4], [5]], 'more workers than views is fewer workers');
  assert.deepEqual(sliceViews(1, 6), [[0, 1, 2, 3, 4, 5]]);
  // Refused rather than coerced: NaN once produced "Cannot read properties of undefined".
  for (const bad of [0, -1, 1.5, Number.NaN, '3', undefined]) {
    assert.throws(() => sliceViews(bad, 6), RangeError, String(bad));
    assert.throws(() => sliceViews(3, bad), RangeError, String(bad));
  }
});

test('the budget is divided into parts that add up to the whole', () => {
  // A budget is a promise about TOTAL work. Flooring quietly spends less than asked; a
  // max(1, ...) floor on a tiny budget quietly spends more.
  assert.deepEqual(shareBudget(900, 3), [300, 300, 300]);
  assert.deepEqual(shareBudget(10, 3), [4, 3, 3], 'the remainder is dealt, not dropped');
  assert.equal(shareBudget(10, 3).reduce((a, b) => a + b, 0), 10);
  assert.deepEqual(shareBudget(2, 5), [1, 1], 'slices that would get zero get no work at all');
  assert.equal(shareBudget(2, 5).reduce((a, b) => a + b, 0), 2, 'and the total is still not exceeded');
  for (const bad of [0, -1, 1.5, Number.NaN, undefined]) {
    assert.throws(() => shareBudget(bad, 3), RangeError, String(bad));
  }
});

test('the winner is the lowest depth, then the lowest view — never the fastest reply', () => {
  // The determinism argument in one assertion. Sorting by arrival would make the same cube
  // answer differently on a busy machine than on an idle one.
  assert.equal(pickWinner([
    { alg: 'late but shallow', depth: 3, view: 5 },
    { alg: 'first but deeper', depth: 4, view: 0 },
  ]), 'late but shallow');
  assert.equal(pickWinner([
    { alg: 'view 4', depth: 3, view: 4 },
    { alg: 'view 1', depth: 3, view: 1 },
  ]), 'view 1');
  assert.equal(pickWinner([{ alg: null, depth: -1, view: -1 }, { alg: 'found', depth: 9, view: 2 }]), 'found');
  assert.equal(pickWinner([{ alg: null, depth: -1, view: -1 }]), null);
  assert.equal(pickWinner([]), null);
  // A reply whose key is missing or malformed must not sort ahead of a real one — -1 would win
  // every comparison, which is precisely backwards.
  assert.equal(pickWinner([
    { alg: 'no key', depth: -1, view: -1 },
    { alg: 'real', depth: 12, view: 3 },
  ]), 'real');
  assert.equal(pickWinner([{ alg: 'garbage key', depth: 'x', view: null }]), null);
});

test('two solves IN FLIGHT AT ONCE each keep their own stop word', async () => {
  // The race this closes: the app allows overlapping loadWalk(), and a client-lifetime buffer
  // let one cube's answer publish a depth that made another cube's workers give up.
  //
  // Nobody auto-replies, so both solves are genuinely outstanding when the assertions run. An
  // earlier draft awaited them one after the other, which is the arrangement the bug could not
  // occur in — it proved the words differed between solves and nothing about overlap.
  const words = [];
  const made = [];
  const spawn = () => { const w = fakeWorker({ autoReply: false }); made.push(w); return w; };
  const client = createParallelSolveClient({
    spawn, workers: 2, viewCount: 6,
    makeShared: () => { const b = new Int32Array(new SharedArrayBuffer(4)); words.push(b); return b; },
  });
  const first = client.solve('F'.repeat(54), { solLen: 21, probeMax: 100 });
  const second = client.solve('U'.repeat(54), { solLen: 21, probeMax: 100 });
  await Promise.resolve();

  assert.deepEqual(made.map((w) => w.sent.length), [2, 2], 'both solves must be in flight together');
  assert.equal(words.length, 2, 'a word per solve, not one for the client');
  for (const w of made) {
    assert.notEqual(w.sent[0].shared.buffer, w.sent[1].shared.buffer,
      'this worker got the same word twice — the second solve inherited the first solve\'s channel');
  }
  assert.equal(made[0].sent[0].shared.buffer, made[1].sent[0].shared.buffer,
    'siblings of ONE solve must share one word, or nothing can stop early');

  // The first solve finds a shallow answer while the second is still searching. Its depth must
  // be invisible to the second — that is the whole point of a word per solve.
  Atomics.store(words[0], 0, 9);
  assert.equal(Atomics.load(words[1], 0), 0x7fffffff,
    'the first solve\'s depth reached the second solve\'s workers');

  for (const w of made) for (const m of w.sent) w.emit({ id: m.id, ok: true, alg: 'R U', depth: 9, view: m.views[0] });
  assert.equal(await first, 'R U');
  assert.equal(await second, 'R U');
});

test('the stop word survives the crossing with its offset, not just its buffer', () => {
  // What this catches: posting `word.buffer` and rebuilding with `new Int32Array(buffer)`. Both
  // sides then hold a valid Int32Array over the same memory and poll DIFFERENT words, so the
  // stop simply never fires — and a stop that never fires is indistinguishable from a search
  // that had nothing to stop for. The app allocates at offset 0 today; the protocol must not
  // depend on that, because the day it stops being true nothing will say so.
  const backing = new Int32Array(new SharedArrayBuffer(12));
  const word = backing.subarray(2); // byteOffset 8, length 1
  assert.equal(word.byteOffset, 8);

  const rebuilt = stopWord(stopDescriptor(word));
  Atomics.store(rebuilt, 0, 11);
  assert.equal(Atomics.load(word, 0), 11, 'the two sides must address the same word');
  assert.equal(backing[0], 0, 'and it is not word 0 — which is what the buffer-only rule read');
  assert.equal(new Int32Array(word.buffer)[0], 0, 'the discarded-offset reconstruction, still wrong');

  assert.equal(stopDescriptor(null), null, 'no word is a legitimate request shape');
  assert.equal(stopWord(null), null);
  assert.throws(() => stopDescriptor(new ArrayBuffer(4)), TypeError,
    'a bare buffer must be refused at the boundary, not silently rebuilt at offset 0');
});

test('one worker failing cancels its siblings instead of leaving them running', async () => {
  // Promise.all rejected on the first failure and left the others searching, pending, and able
  // to publish into the next solve's word. Every sibling is waited for and ended now.
  //
  // The three pool workers never answer on their own, so the only thing that moves this solve
  // is the failure; the fourth is the fallback and does answer.
  const made = [];
  const spawn = () => { const w = fakeWorker({ autoReply: made.length >= 3 }); made.push(w); return w; };
  const client = createParallelSolveClient({ spawn, workers: 3, viewCount: 6 });
  const inFlight = client.solve('F'.repeat(54), { solLen: 21, probeMax: 300 });
  await Promise.resolve();
  made[0].fail('boom');
  const real = console.warn;
  console.warn = () => {};
  try { assert.equal(await inFlight, 'R U'); } finally { console.warn = real; }
  assert.equal(client.idle, true, 'no sibling is left pending');
  assert.ok(made.slice(1, 3).every((w) => w.terminated > 0), 'the siblings were ended, not abandoned');
});

test('an omitted budget is the engine default, divided — not one node each', async () => {
  const made = [];
  const client = createParallelSolveClient({ spawn: () => { const w = fakeWorker(); made.push(w); return w; }, workers: 3, viewCount: 6 });
  await client.solve('F'.repeat(54), { solLen: 21 });
  const total = made.map((w) => w.sent[0].probeMax).reduce((a, b) => a + b, 0);
  assert.equal(total, DEFAULT_NODE_BUDGET, 'the parts add up to the default, not to 3');
});

test('without a shared word it still answers — it just never stops early', async () => {
  const client = createParallelSolveClient({ spawn: () => fakeWorker(), workers: 2, viewCount: 6 });
  assert.equal(await client.solve('F'.repeat(54), { solLen: 21, probeMax: 100 }), 'R U');
  assert.equal(client.workers, 2);
});

// --- the pool that could not be staffed -------------------------------------------------------
//
// A thread that will not start says nothing about the cube. Rejecting the solve would tell a
// user one thread short of a pool that their cube cannot be solved, which is false — one worker
// searching all six views is not a degraded answer, it is the answer this app shipped before the
// pool existed.

/** Capture console.warn for the duration of one call. The fallback must be LOUD. */
async function withWarnings(fn) {
  const said = [];
  const real = console.warn;
  console.warn = (m) => said.push(String(m));
  try { return { value: await fn(), said }; } finally { console.warn = real; }
}

test('a pool that cannot be staffed falls back to one worker instead of refusing', async () => {
  let spawns = 0;
  const made = [];
  const spawn = () => {
    spawns += 1;
    if (spawns === 1) throw new Error('Worker refused to start');
    const w = fakeWorker(); made.push(w); return w;
  };
  const client = createParallelSolveClient({ spawn, workers: 3, viewCount: 6 });
  const { value, said } = await withWarnings(() => client.solve('F'.repeat(54), { solLen: 21, probeMax: 300 }));

  assert.equal(value, 'R U', 'the solve must still be answered');
  assert.equal(client.workers, 1, 'it reports the one worker it has, not the three it wanted');
  assert.match(said[0] ?? '', /falling back to a single worker/,
    'a silent downgrade would hide a machine that can never staff the pool');
  const fallback = made.at(-1).sent[0];
  assert.equal(fallback.probeMax, 300, 'the whole budget — there are no siblings to leave nodes for');
  assert.equal(fallback.views, null, 'and it searches every view, which is what makes it correct');
});

test('once it has fallen back it stays fallen back, rather than re-learning it every solve', async () => {
  let spawns = 0;
  const spawn = () => {
    spawns += 1;
    if (spawns === 1) throw new Error('Worker refused to start');
    return fakeWorker();
  };
  const client = createParallelSolveClient({ spawn, workers: 3, viewCount: 6 });
  await withWarnings(() => client.solve('F'.repeat(54), { solLen: 21, probeMax: 300 }));
  const after = spawns;
  await client.solve('F'.repeat(54), { solLen: 21, probeMax: 300 });
  assert.equal(spawns, after, 'a second solve must not re-attempt the pool — that is a spawn and a table build per solve');
});

test('an engine refusal is NOT retried on fewer threads — it would fail the same way', async () => {
  // The other half of the fallback, and the reason it is tagged rather than catch-all: a
  // malformed cube fails identically on one worker, so a retry buys nothing and charges the
  // user twice the wait for the same "no".
  let spawns = 0;
  const spawn = () => {
    spawns += 1;
    return fakeWorker({ reply: (m) => ({ id: m.id, ok: false, error: 'facelets must be a 54-character string' }) });
  };
  const client = createParallelSolveClient({ spawn, workers: 3, viewCount: 6 });
  const { said } = await withWarnings(async () => {
    await assert.rejects(() => client.solve('nope', { solLen: 21, probeMax: 300 }), /54-character/);
  });
  assert.equal(spawns, 3, 'a fourth worker means the engine refusal was mistaken for a broken thread');
  assert.equal(client.workers, 3, 'and the pool is still a pool');
  assert.deepEqual(said, [], 'nothing was downgraded, so nothing should have been announced');
});

test('a worker that DIES mid-solve falls back rather than losing the answer', async () => {
  // Not the same path as a spawn that throws: these workers started fine and one died with a
  // search in flight, which is the shape an out-of-memory phone actually produces.
  const made = [];
  const spawn = () => { const w = fakeWorker({ autoReply: made.length >= 3 }); made.push(w); return w; };
  const client = createParallelSolveClient({ spawn, workers: 3, viewCount: 6 });
  const { value, said } = await withWarnings(async () => {
    const inFlight = client.solve('F'.repeat(54), { solLen: 21, probeMax: 300 });
    await Promise.resolve();
    made[0].fail('out of memory');
    return inFlight;
  });
  assert.equal(value, 'R U', 'the answer must survive one thread dying');
  assert.match(said[0] ?? '', /solver worker failed: out of memory/, 'and say what actually died');
  assert.equal(client.workers, 1);
  assert.equal(client.idle, true, 'no sibling and no fallback is left pending');
});

test('the POOL works through inline workers, not just the single client', async () => {
  // The defect this pins cost a whole fallback path. The inline worker did not report
  // depth/view, and pickWinner REJECTS a reply without them — so a pooled solve running on
  // inline workers found answers, discarded every one, exhausted all eight budget escalations
  // and threw. The single-worker client ignores those fields, so nothing noticed until rolling
  // a scramble started going through the pool.
  const { spawnSolveWorker } = await import('../lib/solve-client.js');
  const realWorker = globalThis.Worker;
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    Object.defineProperty(globalThis, 'Worker', { value: undefined, configurable: true });
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
    Cube.initSolver();
    const facelets = new Cube().move("R U R' U' F2 L D L' B2 R").asString();
    const client = createParallelSolveClient({
      spawn: spawnSolveWorker, workers: 3, viewCount: 6,
      makeShared: () => new Int32Array(new SharedArrayBuffer(4)),
    });
    const alg = await client.solve(facelets, { solLen: 21, probeMax: 20_000_000 });
    client.cancel();
    assert.ok(alg, 'the pool discarded every inline answer — the sort key is missing again');
    const oracle = Cube.fromString(facelets);
    oracle.move(alg);
    assert.ok(oracle.isSolved(), 'and what it did return must actually solve the cube');
  } finally {
    console.warn = realWarn;
    if (realWorker === undefined) delete globalThis.Worker;
    else Object.defineProperty(globalThis, 'Worker', { value: realWorker, configurable: true });
  }
});
