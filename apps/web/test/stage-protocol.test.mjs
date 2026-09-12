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
import { SOLVE_TO_STATE, createSolveClient, handleStageRequest } from '../lib/solve-client.js';

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
