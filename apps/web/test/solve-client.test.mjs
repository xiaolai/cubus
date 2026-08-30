// The thread boundary is where a search can be lost without anyone noticing: a worker that dies
// leaves every promise pending, and a screen waiting on a promise that will never settle looks
// exactly like a search that is still going. So most of this is about the ways a worker fails
// rather than the way it succeeds.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CANCELLED_MESSAGE, createSolveClient } from '../lib/solve-client.js';

/** A worker that answers however the test tells it to, in the tagged reply protocol. */
function fakeWorker({ reply = (msg) => ({ id: msg.id, ok: true, alg: 'R U' }), autoReply = true } = {}) {
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
  assert.deepEqual(w.sent[0], { id: 1, facelets: 'F'.repeat(54), solLen: 21, probeMax: 100 });
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
