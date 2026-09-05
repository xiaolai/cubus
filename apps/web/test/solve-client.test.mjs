// The thread boundary is where a search can be lost without anyone noticing: a worker that dies
// leaves every promise pending, and a screen waiting on a promise that will never settle looks
// exactly like a search that is still going. So most of this is about the ways a worker fails
// rather than the way it succeeds.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CANCELLED_MESSAGE, STOP_NOW, createParallelSolveClient, createSolveClient, isWorkerFailure,
  pickWinner, publishBest, shareBudget, sliceViews, stopDescriptor, stopWord,
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
    /** A reply that could not be deserialised. It carries no data at all — that is the whole
     *  difficulty, and why the client cannot know which search it belonged to. */
    garble: () => listeners.get('messageerror')?.({}),
  };
  return w;
}

/** The reply a worker sends for a search that was stopped: null, exactly as an exhausted one. */
const stoppedReply = (msg) => ({ id: msg.id, ok: true, alg: null, depth: -1, view: -1 });

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
  // `views: null`, `shared: null` and `resume: null` ride on EVERY request, not only a pooled or
  // an escalating one: the fields are the protocol's, and a single-worker client sending a
  // different shape from a pooled one is how the two drift apart. Null views means all of them;
  // null shared means nothing can call this search off, which is exactly a lone worker's
  // situation; null resume means this search is not one anybody intends to continue — which is
  // NOT the same as `{state: null}`, a continuable search that has not started yet.
  assert.deepEqual(w.sent[0], {
    id: 1, facelets: 'F'.repeat(54), solLen: 21, probeMax: 100, views: null, shared: null, resume: null,
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

test('a reply that could not be read fails the searches rather than hanging them', async () => {
  // `messageerror` had no listener at all. A reply that fails to deserialise arrives with no
  // data — so there is no id, and no way to know whose answer was lost — and the promise it
  // belonged to would simply never settle: on screen, indistinguishable from a search still
  // going. Everything in flight is failed instead, tagged as a WORKER failure so the pool
  // retries on fewer threads rather than telling anyone their cube cannot be solved.
  const w = fakeWorker({ autoReply: false });
  const client = createSolveClient({ spawn: () => w });
  const first = client.solve('F'.repeat(54));
  const second = client.solve('F'.repeat(54));
  w.garble();
  for (const [name, promise] of [['first', first], ['second', second]]) {
    await assert.rejects(async () => {
      try {
        await promise;
      } catch (err) {
        assert.ok(isWorkerFailure(err), `the ${name} rejection must be retryable on fewer threads`);
        throw err;
      }
    }, /could not be read/);
  }
  assert.equal(client.idle, true, 'nothing may be left waiting on a reply that will not come');
  assert.equal(w.terminated, 0,
    'one message failed to cross, which says nothing about the thread or its 10 MB of tables');
});

test('an aborted search publishes the stop word and keeps the thread', async () => {
  // The whole point of the stop word over `cancel()`: the search really stops — the engine sees
  // STOP_NOW at its next poll, ~1 ms — and the worker keeps its tables, so the cube the person
  // actually wants pays nothing for the one they abandoned. Ending the thread would cost the
  // 0.5-2.6 s table build on the very next press.
  let spawns = 0;
  const w = fakeWorker({ autoReply: false });
  const client = createSolveClient({ spawn: () => { spawns += 1; return w; } });
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.store(word, 0, 0x7fffffff);
  const controller = new AbortController();
  const abandoned = client.solve('F'.repeat(54), {
    solLen: 21, probeMax: 100, shared: word, signal: controller.signal,
  });
  controller.abort();
  assert.equal(Atomics.load(word, 0), STOP_NOW, 'the running search was never told to stop');
  assert.equal(w.terminated, 0, 'the thread must survive a stopped search');
  // The worker still answers, with the null a stopped search returns.
  w.emit(stoppedReply(w.sent[0]));
  assert.equal(await abandoned, null, 'a stopped search answers null, like an exhausted one');

  const next = client.solve('F'.repeat(54));
  w.emit({ id: w.sent[1].id, ok: true, alg: 'R U', depth: 9, view: 0 });
  assert.equal(await next, 'R U', 'and the kept worker answers the next cube');
  assert.equal(spawns, 1, 'a second spawn means the tables were rebuilt after all');
});

test('a search aborted before it starts costs nothing at all', async () => {
  let spawns = 0;
  const client = createSolveClient({ spawn: () => { spawns += 1; return fakeWorker(); } });
  const controller = new AbortController();
  controller.abort();
  assert.equal(await client.solve('F'.repeat(54), { signal: controller.signal }), null);
  assert.equal(spawns, 0, 'an abandoned solve must not be the thing that pays for a table build');
});

test('with no stop word the thread is ended — but only when nothing else is on it', async () => {
  // Without a shared word there is no channel into a synchronous search, so the only stop is
  // ending the thread. That takes every OTHER search on it too, which is why it is done only
  // when this one is the last: stealing a sibling's answer to hurry this one is the same bug
  // one level down.
  const w = fakeWorker({ autoReply: false });
  const client = createSolveClient({ spawn: () => w });
  const first = new AbortController();
  const abandoned = client.solve('F'.repeat(54), { signal: first.signal });
  const bystander = client.solve('U'.repeat(54));
  first.abort();
  assert.equal(await abandoned, null, 'the abandoned search settles rather than hanging');
  assert.equal(w.terminated, 0, 'a sibling was still searching on that thread');
  w.emit({ id: w.sent[1].id, ok: true, alg: 'R U', depth: 9, view: 0 });
  assert.equal(await bystander, 'R U', 'and it answered, untouched');

  const second = new AbortController();
  const alone = client.solve('F'.repeat(54), { signal: second.signal });
  second.abort();
  assert.equal(await alone, null);
  assert.equal(w.terminated, 1, 'the last search on a thread may end it — nothing else is lost');
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

test('one solve failing abandons ITS OWN siblings, not an overlapping solve', async () => {
  // The scoping bug. `abandonAll` called `c.cancel()` on every sibling CLIENT, and cancel()
  // rejects every entry on a client — including a second, overlapping solve's, which the app
  // allows (a die press while a reconnect is still solving, or the other way round). That solve
  // then failed with "could not work it out" about a cube nothing was wrong with, caused by a
  // failure that was not its own.
  //
  // The failure here is an ENGINE refusal, not a dead thread, because that is the case where
  // the bystander has no failure of its own to fall back on: a malformed cube is refused
  // identically on one worker, so it propagates untouched and the pool stays a pool.
  const made = [];
  const spawn = () => { const w = fakeWorker({ autoReply: false }); made.push(w); return w; };
  const client = createParallelSolveClient({ spawn, workers: 3, viewCount: 6 });
  const doomed = client.solve('nope', { solLen: 21, probeMax: 300 });
  const bystander = client.solve('F'.repeat(54), { solLen: 21, probeMax: 300 });
  await Promise.resolve();
  assert.deepEqual(made.map((w) => w.sent.length), [2, 2, 2], 'both solves must be in flight together');

  // The refusal, on one worker, for the malformed cube only.
  const bad = made[0].sent.find((m) => m.facelets === 'nope');
  made[0].emit({ id: bad.id, ok: false, error: 'facelets must be a 54-character string' });
  await assert.rejects(() => doomed, /54-character/);
  assert.equal(made.length, 3, 'an engine refusal must not be retried on a fourth thread');
  assert.equal(client.workers, 3, 'nor collapse the pool');
  assert.ok(made.every((w) => w.terminated === 0),
    'the bystander was still searching on every one of those threads');

  // And the bystander answers, from the workers that were never touched.
  for (const w of made) {
    const mine = w.sent.find((m) => m.facelets !== 'nope');
    w.emit({ id: mine.id, ok: true, alg: 'R U', depth: 9, view: mine.views[0] });
  }
  assert.equal(await bystander, 'R U', 'an overlapping solve was cancelled by someone else\'s failure');
  assert.equal(client.idle, true);
});

test('the FALLBACK does not cancel an overlapping solve either', async () => {
  // The same defect as above, one level out, and the half the fix missed (2026-09-05 audit). The
  // per-request controller stopped `abandonAll` from touching a bystander — and then the fallback
  // path, reached when a WORKER failure collapses the pool, called `c.cancel()` on every client
  // anyway. cancel() rejects every entry on a client, so the bystander was rejected with "solve
  // cancelled" by a failure that was not its own and that its own workers never saw.
  //
  // The shape that isolates it: a one-node budget uses exactly one client, so the bystander
  // occupies worker 0 and nothing else, and the spawn of worker 1 — which only the second solve
  // ever asks for — throws. The bystander's own worker is untouched throughout.
  const made = [];
  let spawns = 0;
  const spawn = () => {
    spawns += 1;
    if (spawns === 2) throw new Error('Worker refused to start');
    // The bystander's worker stays silent, so it is still searching when the fallback happens;
    // the fallback's own worker answers, so the failing solve completes.
    const w = fakeWorker({ autoReply: spawns > 2 }); made.push(w); return w;
  };
  const client = createParallelSolveClient({ spawn, workers: 3, viewCount: 6 });
  let bystanderFailed = null;
  const bystander = client.solve('F'.repeat(54), { solLen: 21, probeMax: 1 })
    .catch((err) => { bystanderFailed = err; });
  await Promise.resolve();
  assert.equal(made.length, 1, 'a one-node budget must use exactly one client');

  const { value } = await withWarnings(() => client.solve('U'.repeat(54), { solLen: 21, probeMax: 300 }));
  assert.equal(value, 'R U', 'the fallback still answers the solve that failed');
  // A turn of the event loop, so a rejection that IS coming has arrived before it is denied.
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(bystanderFailed, null, 'the bystander was rejected by someone else\'s failure');
  assert.equal(made[0].terminated, 0, 'and its worker — which never failed — was ended under it');

  // It is still in flight, on the thread it started on, and answers from there.
  made[0].emit({ id: made[0].sent[0].id, ok: true, alg: 'R U', depth: 9, view: 0 });
  assert.equal(await bystander, 'R U');
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

test('a worker that dies and a CANCEL in the same turn does not fall back — nobody is waiting', async () => {
  // The fallback's own era check (2026-09-05 audit), and the second place a teardown can be
  // crossed. `pooled` asks whether the pool is still the one it started on; the catch below it
  // did not, so a worker failure arriving in the same turn as `cancel()` sent the solve down the
  // fallback path: it spawned a REPLACEMENT worker, searched on it and RESOLVED — an answer for a
  // cube nobody was waiting for, and a session-long downgrade announced over a button press.
  //
  // Reproduced exactly as the audit did, and asserted on the thing that must NOT exist: a
  // seventh worker. A rejection alone would not pin it — the fallback could still have run.
  //
  // The would-be fallback worker ANSWERS, deliberately: against the old code this test must fail
  // by resolving, not by hanging, and a hanging test reports nothing at all.
  const made = [];
  const spawn = () => { const w = fakeWorker({ autoReply: made.length >= 6 }); made.push(w); return w; };
  const client = createParallelSolveClient({ spawn, workers: 6, viewCount: 6 });
  const { value, said } = await withWarnings(async () => {
    const inFlight = client.solve('F'.repeat(54), { solLen: 21, probeMax: 600 })
      .then((v) => ({ resolved: v }), (e) => ({ rejected: e.message }));
    await Promise.resolve();
    await Promise.resolve();
    made[0].fail('out of memory');
    client.cancel();
    return inFlight;
  });
  assert.deepEqual(value, { rejected: CANCELLED_MESSAGE }, 'a cancelled solve must not answer');
  assert.equal(made.length, 6, 'a seventh worker is a replacement spawned for a solve nobody wanted');
  assert.deepEqual(said, [], 'a teardown is not evidence that this page cannot staff a pool');
});

test('the stop word is published only by a shallower ANSWER, and atomically', () => {
  // `shouldStop`'s mirror, extracted from `pooled` and exported for the same reason (2026-09-05
  // audit, refactoring debt): a wrong comparison here is invisible from outside, because every
  // answer is still a valid solution — just not deterministically the same one.
  const word = new Int32Array(1);
  const NO_BEST = 0x7fffffff;
  word[0] = NO_BEST;
  assert.equal(publishBest(word, 11), true);
  assert.equal(word[0], 11);
  assert.equal(publishBest(word, 12), false, 'a deeper answer must not be published');
  assert.equal(word[0], 11);
  assert.equal(publishBest(word, 11), false, 'nor an equal one — at the same depth a lower view still wins');
  assert.equal(word[0], 11);
  assert.equal(publishBest(word, 9), true);
  assert.equal(word[0], 9);
  // A cancelled solve's word, which every later reply must leave alone.
  word[0] = STOP_NOW;
  assert.equal(publishBest(word, 0), false, 'a late reply cannot quietly un-cancel a solve');
  assert.equal(word[0], STOP_NOW);
  // "No depth applies" is not a depth: a null reply carries -1, and publishing it would read as
  // the shallowest possible and stop every sibling.
  word[0] = NO_BEST;
  assert.equal(publishBest(word, -1), false);
  assert.equal(publishBest(word, 1.5), false);
  assert.equal(publishBest(null, 3), false, 'a pool with no shared word simply never stops early');
  assert.equal(word[0], NO_BEST);
});

test('a pool of main-thread workers COLLAPSES to one, and still answers', async () => {
  // Two defects, one test, because the second was hidden behind the first.
  //
  // The inline worker did not report depth/view, and pickWinner REJECTS a reply without them —
  // so a pooled solve on inline workers found answers, discarded every one, exhausted all eight
  // budget escalations and threw. That is fixed and still pinned here: the answer must come
  // back, and must solve.
  //
  // But a pool of them was never a pool. `spawnSolveWorker` answers with a main-thread worker
  // where it cannot build a real one — no `Worker`, a CSP forbidding worker-src, a blocked
  // module URL — and app.js gated the pool on `typeof Worker` alone, so under a CSP it built
  // three of them and ran three sequential searches on this thread with a THIRD of the budget
  // each. That is strictly worse than one of them searching every view with all of it, and the
  // stop word buys nothing because nothing runs concurrently to be stopped. The pool now looks
  // at what it got before it divides anything, and says so out loud.
  const { spawnSolveWorker } = await import('../lib/solve-client.js');
  const realWorker = globalThis.Worker;
  const realWarn = console.warn;
  const said = [];
  console.warn = (m) => said.push(String(m));
  try {
    Object.defineProperty(globalThis, 'Worker', { value: undefined, configurable: true });
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
    Cube.initSolver();
    const facelets = new Cube().move("R U R' U' F2 L D L' B2 R").asString();
    const made = [];
    const client = createParallelSolveClient({
      spawn: () => { const w = spawnSolveWorker(); made.push(w); return w; },
      workers: 3,
      viewCount: 6,
      makeShared: () => new Int32Array(new SharedArrayBuffer(4)),
    });
    const alg = await client.solve(facelets, { solLen: 21, probeMax: 20_000_000 });
    client.cancel();
    assert.ok(alg, 'the pool discarded every inline answer — the sort key is missing again');
    const oracle = Cube.fromString(facelets);
    oracle.move(alg);
    assert.ok(oracle.isSolved(), 'and what it did return must actually solve the cube');
    assert.equal(client.workers, 1,
      'three main-thread searches with a third of the budget each is not a pool');
    assert.ok(made.every((w) => w.inline === true), 'every worker here should be a main-thread one');
    assert.ok(said.some((m) => /falling back to a single worker/.test(m)),
      'a silent collapse hides a page that can never staff a pool');
  } finally {
    console.warn = realWarn;
    if (realWorker === undefined) delete globalThis.Worker;
    else Object.defineProperty(globalThis, 'Worker', { value: realWorker, configurable: true });
  }
});
