// The repair on the wire — the request kind, the reply, and every way a worker can answer wrongly.
//
// An audit's sharpest finding about this feature was that NOTHING tested this boundary. Everything
// on either side of it was covered: the engine against oracles, the wording against its vocabulary,
// the wiring against the source. The wire itself was not, and that is where the worst defect the
// feature has had was living.
//
// WHAT IT WAS, because every case here is a descendant of it. `stageRoute` rode the control channel,
// which validates the envelope (`ok === true`) and nothing inside it. A worker that did not know
// this request kind answered anyway — the inline fallback treated a repair as an ordinary two-phase
// solve — and a WHOLE-CUBE ALGORITHM came back. Every downstream check then passed: the algorithm is
// real, it replays, and it reaches the target, because a solved cube is inside every target. So it
// was accepted as an EXACT answer and the screen would have said "the shortest way back — 18 moves"
// about a whole-cube solution. A false minimality claim, out of a reply nobody checked the shape of.
//
// The lesson generalises past this feature: `ok` is a tag on the envelope. A protocol that carries
// more than one kind of question has to check which one came back.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOLVED, applyAlg, movesOf } from '../lib/cube-pieces.js';
import { toFacelets, parseFacelets } from '../lib/two-phase.js';
import { OFFERED_TARGETS } from '../lib/stage-targets.js';
import { lowerBounds, solveToState } from '../lib/stage-distance.js';
import {
  SOLVE_TO_STATE, STOP_NOW, createParallelSolveClient, createSolveClient, handleStageRequest,
  stopDescriptor, stopWord,
} from '../lib/solve-client.js';

/** A well-formed bounds payload: EVERY offered target, which is what the validator now demands. */
const EVERY_BOUND = Object.fromEntries(OFFERED_TARGETS.map((t) => [t.id, 1]));

/** The worker's side of the boundary, with the real engine behind it. */
const engine = { parseFacelets, solveToState, lowerBounds };
const SCRAMBLED = toFacelets(applyAlg(SOLVED, "F R' U' F2 B2 L2 F U' L2 B D2 B2"));

/** A worker that answers every request with `reply`, merged over the request's own id. */
function workerSaying(reply) {
  return () => {
    const listeners = new Map();
    return {
      addEventListener: (type, fn) => listeners.set(type, fn),
      postMessage(request) {
        queueMicrotask(() => listeners.get('message')?.({ data: { id: request.id, ok: true, ...reply } }));
      },
      terminate() {},
    };
  };
}

/** A worker that records what it was sent and then answers properly. */
function recordingWorker(sent) {
  return () => {
    const listeners = new Map();
    return {
      addEventListener: (type, fn) => listeners.set(type, fn),
      postMessage(request) {
        sent.push(request);
        queueMicrotask(() => listeners.get('message')?.({ data: handleStageRequest(engine, request) }));
      },
      terminate() {},
    };
  };
}

/**
 * A worker that answers with the real handler only when the case releases the reply — so a request
 * can be called off while it is out — and that counts every time it is ended.
 */
function heldWorker({ sent, held, ended }) {
  return () => {
    const listeners = new Map();
    return {
      addEventListener: (type, fn) => listeners.set(type, fn),
      postMessage(request) {
        sent.push(request);
        held.push(() => listeners.get('message')?.({ data: handleStageRequest(engine, request) }));
      },
      terminate() { ended.count += 1; },
    };
  };
}
const heldRig = () => ({ sent: [], held: [], ended: { count: 0 } });

// ---- the worker's side ---------------------------------------------------------------------------

test('the handler answers both shapes, and tags which one it answered', () => {
  const bounds = handleStageRequest(engine, { id: 1, want: 'bounds', facelets: SCRAMBLED });
  assert.equal(bounds.ok, true);
  assert.equal(bounds.kind, 'stage');
  assert.equal(bounds.want, 'bounds');
  assert.deepEqual(Object.keys(bounds.bounds), OFFERED_TARGETS.map((t) => t.id));
  for (const d of Object.values(bounds.bounds)) assert.ok(Number.isInteger(d) && d >= 0);

  const route = handleStageRequest(engine, {
    id: 2, want: 'route', target: 'cross', facelets: SCRAMBLED, nodeBudget: 400_000, maxDepth: 10,
  });
  assert.equal(route.kind, 'stage');
  assert.equal(route.want, 'route');
  assert.equal(route.target, 'cross');
  assert.equal(route.moves, movesOf(route.alg).length, 'the count and the algorithm are one answer');
});

test('a cube the app cannot read is an ERROR, never a search that found nothing', () => {
  // The two must not be the same reply. A null answer means "the search found nothing", which is a
  // statement about the search; an unreadable cube is a question that cannot be asked at all.
  const bad = handleStageRequest(engine, { id: 3, want: 'route', target: 'cross', facelets: 'not a cube' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not a cube this app can read/);
  const unknown = handleStageRequest(engine, { id: 4, want: 'route', target: 'no-such', facelets: SCRAMBLED });
  assert.equal(unknown.ok, false, 'an unknown target is a caller error, not an empty answer');
});

test('a search asks whether it was called off every STOP_POLL nodes, and says so', async () => {
  const { STOP_POLL } = await import('../lib/stage-distance.js');
  assert.ok(Number.isInteger(STOP_POLL) && STOP_POLL > 0,
    'the engine must name how often it asks');
  const state = parseFacelets(SCRAMBLED);
  const opts = { nodeBudget: 400_000, maxDepth: 12 };
  const free = solveToState('first-layer', state, opts);
  assert.ok(free.nodes > 3 * STOP_POLL,
    `precondition: the search spends more than three polls (${free.nodes} nodes)`);
  assert.deepEqual(solveToState('first-layer', state, { ...opts, stop: () => false }), free,
    'a stop never raised changed the answer, or what it cost');
  // Raised before the search began: the first poll is at node zero, so nothing is spent.
  assert.deepEqual(solveToState('first-layer', state, { ...opts, stop: () => true }),
    { alg: null, moves: null, nodes: 0, exact: false, why: 'stopped' },
    'a search called off before it began spent nodes, or blamed its budget');
  // Raised at the third poll: two intervals in, and not a node later.
  let polls = 0;
  const stopAtThird = () => { polls += 1; return polls === 3; };
  const late = solveToState('first-layer', state, { ...opts, stop: stopAtThird });
  assert.equal(late.why, 'stopped', 'a stop was reported as the budget running out');
  assert.equal(late.nodes, 2 * STOP_POLL, 'the search did not ask once every STOP_POLL nodes');
});

test('the worker reads a request\'s stop word at every poll, and no word means no poll', () => {
  // Not at offset 0, on purpose: the word crosses as a descriptor so that its offset survives.
  const word = new Int32Array(new SharedArrayBuffer(12), 8, 1);
  const polled = [];
  const refusal = { alg: null, moves: null, nodes: 0, exact: false, why: 'stopped' };
  const raising = {
    ...engine,
    solveToState: (_target, _state, { stop }) => {
      polled.push(stop());
      // Written by the thread that asked, while this search runs.
      Atomics.store(word, 0, STOP_NOW);
      polled.push(stop());
      return refusal;
    },
  };
  const question = {
    id: 5, want: 'route', target: 'cross', facelets: SCRAMBLED, nodeBudget: 400_000, maxDepth: 12,
  };
  const reply = handleStageRequest(raising, { ...question, shared: stopDescriptor(word) });
  assert.deepEqual(polled, [false, true],
    'the word was read once when the search began, or never');
  assert.equal(reply.why, 'stopped');
  let handed = null;
  const recording = {
    ...engine,
    solveToState: (_target, _state, opts) => { handed = opts; return refusal; },
  };
  handleStageRequest(recording, question);
  assert.equal(handed.stop ?? null, null,
    'a request with no word was handed a stop that could never fire');
});

// ---- the client's side: every wrong reply, refused ------------------------------------------------

test('a reply that is not a stage reply is refused, however well-formed it looks', () => {
  // THE DEFECT THIS FILE EXISTS FOR. `{ ok: true, alg: '<20 moves>' }` is exactly what a worker
  // without this request kind produces, and it is exactly what must not be believed.
  const client = createSolveClient({ spawn: workerSaying({ alg: "R U R' U'", depth: 3, view: 0 }) });
  return assert.rejects(
    () => client.stageRoute({ want: 'route', target: 'cross', facelets: SCRAMBLED }),
    /answered with "undefined" rather than a repair/,
  );
});

test('every malformed stage reply is refused, and each for its own reason', async () => {
  const route = (extra) => ({ kind: 'stage', want: 'route', target: 'cross', exact: true, ...extra });
  const cases = [
    ['a reply about another question', { kind: 'stage', want: 'bounds', bounds: EVERY_BOUND }, /asked for "route"/],
    ['a reply about another target', route({ target: 'solved', alg: 'R', moves: 1 }), /asked about "cross"/],
    ['a count that is not the algorithm', route({ alg: 'R U', moves: 7 }), /says 7 moves and carries 2/],
    ['a negative count', route({ alg: 'R U', moves: -1 }), /neither an answer nor a refusal/],
    ['half an answer', route({ alg: 'R U', moves: null }), /neither an answer nor a refusal/],
    // EXACTNESS, and it is the one that would have put a false claim on a screen. `stage-route.js`
    // labels anything from the exact source `minimal: true`, so a reply that does NOT claim
    // exactness must not be usable as one — a three-move route to a one-move target would have
    // been called the shortest there is. Reproduced by an audit.
    ['an answer that does not claim exactness', route({ alg: 'R R R', moves: 3, exact: false }), /does not claim exactness/],
    ['an answer with no exactness at all', { kind: 'stage', want: 'route', target: 'cross', alg: 'R R R', moves: 3 }, /does not claim exactness/],
    ['a refusal that claims exactness', route({ alg: null, moves: null }), /a refusal must say it is not exact/],
    // AND THE ALGORITHM MUST BE ONE. `movesOf` counts whitespace-separated tokens and validates
    // nothing, so `?` agreed with its own count perfectly — and the Restore chip prints that count
    // with no replay behind it, which is the one path where a bogus answer is not caught later.
    ['an algorithm that is not moves', route({ alg: '?', moves: 1 }), /is not a sequence of face turns/],
    ['a plausible-looking non-move', route({ alg: 'R X2', moves: 2 }), /is not a sequence of face turns/],
  ];
  for (const [why, reply, expected] of cases) {
    const client = createSolveClient({ spawn: workerSaying(reply) });
    await assert.rejects(
      () => client.stageRoute({ want: 'route', target: 'cross', facelets: SCRAMBLED }),
      expected,
      why,
    );
  }
  // …and a refusal, which is a legitimate answer and must NOT be refused.
  const refusing = createSolveClient({
    spawn: workerSaying({ kind: 'stage', want: 'route', target: 'cross', alg: null, moves: null, exact: false }),
  });
  const refused = await refusing.stageRoute({ want: 'route', target: 'cross', facelets: SCRAMBLED });
  assert.equal(refused.moves, null, 'out of budget is an answer this side understands');
});

test('a tagged reply cannot be read as an ordinary search\'s answer either', () => {
  // The isolation was ONE-WAY: `stageReply` refuses a solve's answer, and nothing stopped a stage
  // reply carrying a pending solve's id from being read as that solve's algorithm. Unique ids make
  // the collision unlikely rather than impossible, and the two are different questions.
  const client = createSolveClient({
    spawn: workerSaying({ kind: 'stage', want: 'route', target: 'cross', alg: 'R U', moves: 2, exact: true }),
  });
  return assert.rejects(
    () => client.solve(SCRAMBLED, { solLen: 20 }),
    /answered a search with a "stage" reply/,
  );
});

test('a bounds reply must carry EVERY target, and every one of them must be a distance', async () => {
  // Checking only the values that happen to be present let an empty object, an unknown key, an
  // array and an impossible distance all through. The missing-key case is the quiet one: that chip
  // silently loses its search and sits on its waiting state for ever.
  for (const [why, bounds, expected] of [
    ['no targets at all', {}, /expected /],
    ['one target of six', { cross: 1 }, /expected /],
    ['a target nobody asked about', { ...EVERY_BOUND, banana: 2 }, /expected /],
    ['an array', [1], /carries no bounds/],
    ['a negative distance', { ...EVERY_BOUND, cross: -3 }, /came back as -3/],
    ['a distance no cube can be at', { ...EVERY_BOUND, cross: 999 }, /came back as 999/],
    ['a distance that is not one', { ...EVERY_BOUND, cross: 'soon' }, /came back as soon/],
  ]) {
    const client = createSolveClient({ spawn: workerSaying({ kind: 'stage', want: 'bounds', bounds }) });
    await assert.rejects(() => client.stageRoute({ want: 'bounds', facelets: SCRAMBLED }), expected, why);
  }
  // …and the shape the real handler produces is accepted, or the checks above are just strict.
  const good = createSolveClient({ spawn: workerSaying({ kind: 'stage', want: 'bounds', bounds: EVERY_BOUND }) });
  assert.deepEqual((await good.stageRoute({ want: 'bounds', facelets: SCRAMBLED })).bounds, EVERY_BOUND);
});

// ---- the client's side: what it sends ---------------------------------------------------------------

test('the protocol owns the id and the kind — a payload cannot take either', async () => {
  // Reproduced by an audit: passing `id: 77` posted 77 while the pending map held 1, so the reply
  // was discarded and the promise never settled. A hung promise on a screen is a chip that stays
  // on `…` for ever, which is the one chip state §6 does not have.
  const sent = [];
  const client = createSolveClient({ spawn: recordingWorker(sent) });
  const reply = await client.stageRoute({
    want: 'bounds', facelets: SCRAMBLED, id: 77, kind: 'something-else', extra: 'ignored',
  });
  assert.equal(reply.kind, 'stage', 'the request went out as a stage request whatever the payload said');
  assert.equal(sent.length, 1);
  assert.notEqual(sent[0].id, 77, 'the id is the protocol\'s, not the caller\'s');
  assert.equal(sent[0].kind, SOLVE_TO_STATE);
  assert.equal(sent[0].extra, undefined, 'and nothing else crosses — the payload is a whitelist');
});

test('a main-thread worker is refused before a repair is posted to it', async () => {
  // §8 IS NOT NEGOTIABLE: no search and no distance table on the UI thread. `spawnSolveWorker`
  // answers with a main-thread worker where it cannot build a real one, and a repair on one of
  // those was measured at 2.3 seconds of frozen page for a request that should be a table read.
  const sent = [];
  const client = createSolveClient({
    spawn: () => ({
      inline: true,
      addEventListener() {},
      postMessage(request) { sent.push(request); },
      terminate() {},
    }),
  });
  await assert.rejects(
    () => client.stageRoute({ want: 'bounds', facelets: SCRAMBLED }),
    /no worker, and a repair may not run on the UI thread/,
  );
  assert.deepEqual(sent, [], 'and nothing was posted — refused before, not after');
});

// ---- calling a repair off ------------------------------------------------------------------
//
// A superseded repair used to run out its budget on the worker that every stage question and a
// pooled solve's first slice share. It is called off now the way a superseded solve is: STOP_NOW
// in a word the running search polls, never a terminate — and nothing at all where there is no
// word to write.

const FIRST_LAYER = {
  want: 'route', target: 'first-layer', facelets: SCRAMBLED, nodeBudget: 400_000, maxDepth: 12,
};
const CROSS_ROUTE = { ...FIRST_LAYER, target: 'cross', maxDepth: 10 };

test('a repair called off writes STOP_NOW into its own word, and its worker lives', async () => {
  const rig = heldRig();
  const client = createSolveClient({ spawn: heldWorker(rig) });
  const word = new Int32Array(new SharedArrayBuffer(4));
  const walk = new AbortController();
  const asked = client.stageRoute({ ...FIRST_LAYER, signal: walk.signal }, word);
  assert.equal(rig.sent.length, 1, 'precondition: the request is out');
  assert.ok(rig.sent[0].shared, 'the request went out with no word to call it off by');
  assert.equal(rig.sent[0].signal, undefined, 'a signal cannot be cloned onto another thread');
  walk.abort();
  assert.equal(Atomics.load(stopWord(rig.sent[0].shared), 0), STOP_NOW,
    'the abort did not reach the word the worker reads');
  rig.held.shift()();
  const reply = await asked;
  assert.equal(reply.why, 'stopped', 'the worker ran the whole search anyway');
  assert.equal(reply.moves, null);
  assert.equal(rig.ended.count, 0,
    'a repair was called off by ending the thread a pooled solve slice shares');
});

test('a repair asked for by a caller already gone goes out already called off', async () => {
  const rig = heldRig();
  const client = createSolveClient({ spawn: heldWorker(rig) });
  const word = new Int32Array(new SharedArrayBuffer(4));
  const asked = client.stageRoute({ ...FIRST_LAYER, signal: AbortSignal.abort() }, word);
  assert.equal(Atomics.load(word, 0), STOP_NOW,
    'the word was not raised before the request went out');
  rig.held.shift()();
  assert.equal((await asked).why, 'stopped');
});

test('a request lets go of its caller\'s signal however it settles', async () => {
  // A screen's signal outlives every request it makes: a listener left on it holds each request's
  // word, and writes into it long after anything could read it.
  const screen = new AbortController();
  const rig = heldRig();
  const client = createSolveClient({ spawn: heldWorker(rig) });
  const answered = new Int32Array(new SharedArrayBuffer(4));
  const done = client.stageRoute({ ...CROSS_ROUTE, signal: screen.signal }, answered);
  rig.held.shift()();
  assert.notEqual((await done).moves, null, 'precondition: the repair answered');
  const refused = new Int32Array(new SharedArrayBuffer(4));
  const saying = workerSaying({ alg: "R U R' U'", depth: 3, view: 0 });
  const wrong = createSolveClient({ spawn: saying });
  await assert.rejects(() => wrong.stageRoute({ ...CROSS_ROUTE, signal: screen.signal }, refused),
    /rather than a repair/, 'precondition: the reply was refused');
  screen.abort();
  assert.deepEqual([Atomics.load(answered, 0), Atomics.load(refused, 0)], [0, 0],
    'a settled request was still listening to the signal it was asked with');
});

test('with no word to write, calling a repair off changes nothing and ends no thread', async () => {
  const rig = heldRig();
  const client = createSolveClient({ spawn: heldWorker(rig) });
  const walk = new AbortController();
  // A word in the PAYLOAD is not the client's to use: only a word handed to the client crosses.
  const forged = stopDescriptor(new Int32Array(new SharedArrayBuffer(4)));
  const asked = client.stageRoute({ ...CROSS_ROUTE, signal: walk.signal, shared: forged });
  walk.abort();
  assert.equal(rig.sent[0].shared ?? null, null,
    'a word read off the payload went out with the request');
  rig.held.shift()();
  const direct = solveToState('cross', parseFacelets(SCRAMBLED), CROSS_ROUTE);
  assert.equal((await asked).alg, direct.alg, 'the search did not run as it always has');
  assert.equal(rig.ended.count, 0,
    'a repair nothing could stop was stopped by ending its thread');
});

test('the pool gives each repair that can be called off a word of its own', async () => {
  const rig = heldRig();
  let made = 0;
  const pool = createParallelSolveClient({
    spawn: heldWorker(rig),
    workers: 2,
    viewCount: 6,
    makeShared: () => { made += 1; return new Int32Array(new SharedArrayBuffer(4)); },
  });
  const first = new AbortController();
  const second = new AbortController();
  const asked = [
    pool.stageRoute({ ...FIRST_LAYER, signal: first.signal }),
    pool.stageRoute({ ...FIRST_LAYER, signal: second.signal }),
    pool.stageRoute({ want: 'bounds', facelets: SCRAMBLED }),
  ];
  assert.equal(rig.sent.length, 3,
    'precondition: all three are out, on the one worker repairs go to');
  assert.equal(made, 2,
    'each repair that can be called off needs a word of its own, and only those');
  assert.equal(rig.sent[2].shared ?? null, null,
    'a request nothing can call off went out with a word');
  first.abort();
  const raised = (r) => (r.shared ? Atomics.load(stopWord(r.shared), 0) : 'no word');
  assert.deepEqual(rig.sent.slice(0, 2).map(raised), [STOP_NOW, 0],
    'calling off one repair did not stop it, or stopped the other with it');
  for (const release of rig.held.splice(0)) release();
  const [one, two] = await Promise.all(asked);
  assert.deepEqual([one.why, two.why], ['stopped', null]);
  assert.equal(rig.ended.count, 0);
});

test('a lone client that can make words gives each repair that can be called off one of its own', async () => {
  const rig = heldRig();
  let made = 0;
  const client = createSolveClient({
    spawn: heldWorker(rig),
    makeShared: () => { made += 1; return new Int32Array(new SharedArrayBuffer(4)); },
  });
  const first = new AbortController();
  const second = new AbortController();
  const asked = [
    client.stageRoute({ ...FIRST_LAYER, signal: first.signal }),
    client.stageRoute({ ...FIRST_LAYER, signal: second.signal }),
    client.stageRoute({ want: 'bounds', facelets: SCRAMBLED }),
  ];
  assert.equal(rig.sent.length, 3, 'precondition: all three are out');
  assert.equal(made, 2, 'each repair that can be called off needs a word of its own, and only those');
  assert.equal(rig.sent[2].shared ?? null, null, 'a request nothing can call off went out with a word');
  first.abort();
  const raised = (r) => (r.shared ? Atomics.load(stopWord(r.shared), 0) : 'no word');
  assert.deepEqual(rig.sent.slice(0, 2).map(raised), [STOP_NOW, 0],
    'calling off one repair did not stop it, or stopped the other with it');
  for (const release of rig.held.splice(0)) release();
  const [one, two] = await Promise.all(asked);
  assert.deepEqual([one.why, two.why], ['stopped', null]);
  assert.equal(rig.ended.count, 0, 'a repair was called off by ending the thread');
});

test('with one solver worker, a repair called off reaches its search wherever the page can share memory', async () => {
  // Too few cores for a pool leaves the service one worker, and the pool was the only thing that
  // made a repair's word. Each case imports its own copy of the service, because the worker count
  // and the client are settled when it loads and when it is first asked.
  const saved = Object.fromEntries(['Worker', 'crossOriginIsolated', 'navigator', 'localStorage']
    .map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const define = (k, value) => Object.defineProperty(globalThis, k, { value, writable: true, configurable: true });
  const store = new Map();
  try {
    for (const isolated of [true, false]) {
      const posts = [];
      define('Worker', class extends EventTarget {
        postMessage(data) { posts.push(data); }
        terminate() {}
      });
      define('crossOriginIsolated', isolated);
      define('navigator', { hardwareConcurrency: 3 });
      define('localStorage', {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
      });
      const { stageAsk } = await import(`../lib/solver-service.js?one-worker-isolated=${isolated}`);
      const walk = new AbortController();
      void stageAsk({ ...FIRST_LAYER, signal: walk.signal });
      assert.equal(posts.length, 1, `isolated ${isolated}: precondition: the repair went to the one worker`);
      if (!isolated) {
        assert.equal(posts[0].shared ?? null, null, 'a page that cannot share memory was handed a word anyway');
        continue;
      }
      assert.ok(posts[0].shared, 'the repair went out with no word to call it off by');
      walk.abort();
      assert.equal(Atomics.load(stopWord(posts[0].shared), 0), STOP_NOW,
        'the abort did not reach the word the worker reads');
    }
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
});

// ---- end to end over the boundary -------------------------------------------------------------------

test('a real request over a real handler answers the same thing the engine does', async () => {
  const sent = [];
  const client = createSolveClient({ spawn: recordingWorker(sent) });
  const state = parseFacelets(SCRAMBLED);

  const bounds = await client.stageRoute({ want: 'bounds', facelets: SCRAMBLED });
  assert.deepEqual(bounds.bounds, lowerBounds(state), 'the wire must not change the numbers');

  const route = await client.stageRoute({
    want: 'route', target: 'cross', facelets: SCRAMBLED, nodeBudget: 400_000, maxDepth: 10,
  });
  const direct = solveToState('cross', state, { nodeBudget: 400_000, maxDepth: 10 });
  assert.equal(route.moves, direct.moves);
  assert.equal(route.alg, direct.alg);
  assert.equal(sent.length, 2, 'one message per question, and no retries hiding a failure');
});

// ---- the two mutations this suite could not feel ---------------------------------------------------

test('the REAL inline worker refuses a repair — not a fake wearing an `inline` flag', async () => {
  // AN AUDIT MUTATED THE REAL INLINE GUARD AWAY AND ALL EIGHT TESTS STILL PASSED. The case above
  // supplies its own object with `inline: true`, which tests `stageRequest`'s reading of the flag
  // and nothing about the worker that actually sets it. This one uses `spawnSolveWorker` with
  // `Worker` removed, which is the situation the guard exists for: a page that has no threads.
  const realWorker = globalThis.Worker;
  delete globalThis.Worker;
  try {
    const { spawnSolveWorker } = await import('../lib/solve-client.js');
    const client = createSolveClient({ spawn: spawnSolveWorker });
    assert.equal(client.ensureWorker().inline, true, 'precondition: with no Worker this is the inline one');
    await assert.rejects(
      () => client.stageRoute({ want: 'bounds', facelets: SCRAMBLED }),
      /no worker, and a repair may not run on the UI thread/,
      'a repair on the calling thread is §8 broken, and §8 is not negotiable',
    );
    // AND THE GUARD MUST NOT HAVE BROKEN ORDINARY SOLVES, which have no `kind` and must still run.
    // The inline worker refuses every kind it does not serve, and "no kind" is the solve.
    const solved = await client.solve(toFacelets(SOLVED), { solLen: 20, probeMax: 100_000 });
    assert.equal(typeof solved, 'string', 'an ordinary solve still answers on the inline worker');
    client.cancel();
  } finally {
    if (realWorker === undefined) delete globalThis.Worker; else globalThis.Worker = realWorker;
  }
});

test('the inline worker refuses a control request rather than answering it as a solve', async () => {
  // The root cause, at its own level: `postMessage` used to hand EVERY request to
  // `handleSolveRequest`, so a table handshake or a repair came back as a two-phase answer.
  const realWorker = globalThis.Worker;
  delete globalThis.Worker;
  try {
    const { spawnSolveWorker, PREPARE_TABLES } = await import('../lib/solve-client.js');
    const worker = spawnSolveWorker();
    const replies = [];
    worker.addEventListener('message', (e) => replies.push(e.data));
    worker.postMessage({ id: 1, kind: PREPARE_TABLES });
    worker.postMessage({ id: 2, kind: SOLVE_TO_STATE, want: 'bounds', facelets: SCRAMBLED });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(replies.length, 2, 'both were answered rather than swallowed');
    for (const reply of replies) {
      assert.equal(reply.ok, false, `a kind it cannot serve must be refused: ${JSON.stringify(reply)}`);
      assert.match(reply.error, /cannot be served off the main thread/);
      assert.equal(reply.alg, undefined, 'and never handed back an algorithm');
    }
    worker.terminate();
  } finally {
    if (realWorker === undefined) delete globalThis.Worker; else globalThis.Worker = realWorker;
  }
});
