// The library client (`lib/drill/library-client.js`): how the page asks the algorithm library's worker, and
// what happens when the worker does not answer as it should.
//
// What must NOT happen is most of this file: a question left waiting forever; a failed answer kept and handed
// out again; a worker that failed once asked again; a late answer from a worker already given up on resolving
// anything. Each is driven through an injected worker and injected timers, so a stuck worker is a worker that
// never replies and the deadline is a timer the test fires — no wall clock is waited on.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIBRARY_ASK, LIBRARY_TIMEOUT_MS, catalogueOf, catalogueProblem, createLibraryClient, inlineLibraryWorker,
} from '../lib/drill/library-client.js';

/** The smallest catalogue the library screens can draw: one method, one stage, one set, one row. */
const CATALOGUE = Object.freeze({
  groups: [{ method: 'cfop-4lll', label: 'CFOP (easy)', phases: [{ stage: 'oll', phase: 'Top face', sets: ['ocll'] }] }],
  sets: { ocll: { id: 'ocll', name: 'Two-look OLL, second look', kind: 'hand-written', purpose: 'Turns the top corners up.', ids: ['sune'] } },
  rows: { sune: { id: 'sune', set: 'ocll', alg: "R U R' U R U2 R'", chunks: [] } },
  triggers: { 'sexy-move': { name: 'Sexy move' } },
  pending: [],
});
const copy = (v) => structuredClone(v);

// ---- fakes: workers and timers ------------------------------------------------------------------------------

/**
 * A worker that does what `behave(message, worker)` says with each message — reply, fail, or nothing at all.
 * `worker.say(type, event)` delivers an event to the client's listeners as the platform would.
 */
function fakeWorker(behave) {
  const listeners = { message: [], error: [], messageerror: [] };
  const w = {
    asked: [],
    terminated: false,
    addEventListener: (type, fn) => { listeners[type].push(fn); },
    postMessage(message) {
      if (w.terminated) throw new Error('InvalidStateError: the worker was terminated');
      w.asked.push(message);
      behave(message, w);
    },
    terminate() { w.terminated = true; },
    say(type, event) { for (const fn of listeners[type]) fn(event); },
    answer(message, result) { w.say('message', { data: { kind: LIBRARY_ASK, id: message.id, ok: true, result } }); },
  };
  return w;
}

/** A worker that answers every question at once, with a result named after the question. */
const answering = (m, w) => w.answer(m, m.ask === 'ids' ? ['sune', 'pll-T'] : copy(CATALOGUE));
/** A worker whose library could not load: `answerLibrary`'s refusal, for every question. */
const refusing = (m, w) => w.say('message', { data: { kind: LIBRARY_ASK, id: m.id, ok: false, error: { name: 'Error', message: 'cross.js could not be fetched' } } });
/** A worker that has stopped: it takes the question and never says anything. */
const silent = () => {};

/** Timers the test fires by hand, and a spawn that hands out the scripted workers in order. */
function harness(...behaviours) {
  const timers = new Map();
  let handle = 0;
  const workers = [];
  const client = createLibraryClient({
    spawn: () => {
      const behave = behaviours[workers.length];
      if (!behave) throw new Error(`the test scripted ${behaviours.length} workers and a ${workers.length + 1}th was spawned`);
      const w = fakeWorker(behave);
      workers.push(w);
      return w;
    },
    setTimer: (fn, ms) => { handle += 1; timers.set(handle, { fn, ms }); return handle; },
    clearTimer: (h) => { timers.delete(h); },
  });
  /** Run every timer due within `ms` of now — all of them have the same bound. */
  const elapse = (ms) => {
    for (const [h, t] of [...timers]) if (t.ms <= ms) { timers.delete(h); t.fn(); }
  };
  return { client, workers, timers, elapse };
}

/** Settle microtasks: a promise's reactions run before this resolves. */
const settled = () => new Promise((r) => setImmediate(r));

/** Whether `p` has settled yet, without waiting on it. */
async function stateOf(p) {
  let state = 'pending';
  p.then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
  await settled();
  return state;
}

// ---- a library that failed is asked again, of a NEW worker ------------------------------------------------

test('a library that could not load is not asked again: the next question goes to a fresh worker', async () => {
  // A worker whose library failed once keeps that failure (its module map, its library's cache), so asking it
  // again replays the failure. The client retires it and spawns another.
  const h = harness(refusing, answering);
  await assert.rejects(h.client.catalogue(), /cross\.js could not be fetched/);
  assert.equal(h.workers[0].terminated, true, 'the worker that failed was kept');
  const again = h.client.catalogue();
  assert.equal(h.workers.length, 2, 'the retry was asked of the worker that had failed');
  assert.equal(h.workers[0].asked.length, 1, 'the failed worker was asked a second question');
  assert.deepEqual(await again, CATALOGUE);
});

test('the real library through the inline worker, after a load that failed once, answers', async () => {
  // A load function that fails the first time — what a module fetch that did not arrive looks like to
  // `answerLibrary` — then the real library. The second question succeeds and reads every row id.
  let loads = 0;
  const load = () => {
    loads += 1;
    return loads === 1 ? Promise.reject(new Error('alg-library.js could not be fetched')) : import('../lib/alg-library.js');
  };
  const spawned = [];
  const client = createLibraryClient({ spawn: () => { const w = inlineLibraryWorker(load); spawned.push(w); return w; } });
  await assert.rejects(client.ids(), /alg-library\.js could not be fetched/);
  const ids = await client.ids();
  assert.ok(ids instanceof Set && ids.has('sune') && ids.size > 100, `read ${ids.size} ids`);
  assert.equal(spawned.length, 2);
});

// ---- a question has a deadline ------------------------------------------------------------------------------

test('a worker that never answers is given up at the deadline: the question fails, and the next one is asked anew', async () => {
  const h = harness(silent, answering);
  const first = h.client.catalogue();
  assert.equal(h.timers.size, 1, 'the question was sent with no deadline');
  assert.equal([...h.timers.values()][0].ms, LIBRARY_TIMEOUT_MS);
  assert.equal(await stateOf(first), 'pending');
  // A second visit before the deadline asks nothing new: the question is the same one.
  assert.equal(h.client.catalogue(), first);
  assert.equal(h.workers[0].asked.length, 1);
  h.elapse(LIBRARY_TIMEOUT_MS);
  await assert.rejects(first, new RegExp(`did not answer within ${LIBRARY_TIMEOUT_MS / 1000} s`));
  assert.equal(h.workers[0].terminated, true, 'the stuck worker was kept');
  // A late answer from the retired worker resolves nothing and throws nothing.
  h.workers[0].terminated = false;
  h.workers[0].answer(h.workers[0].asked[0], copy(CATALOGUE));
  // The next visit asks again, of a new worker, and is answered.
  const again = h.client.catalogue();
  assert.notEqual(again, first, 'the failed question was handed out again');
  assert.equal(h.workers.length, 2, 'the next question was asked of the stuck worker');
  assert.deepEqual(await again, CATALOGUE);
  assert.equal(h.timers.size, 0, 'an answered question left its deadline running');
});

test('the deadline is measured, not tight: it is far above what the whole catalogue costs', () => {
  // The worker's whole job — import, every id, every row — measured 3.2 s in Node (the module header,
  // 2026-10-17); 0.5 s in Node and 0.6 s in a WebKit worker on 2026-10-18. The bound is for a worker that has
  // STOPPED, so it must never be reached by
  // a slow one: a slow device timed out would fail on every retry and never see the library.
  assert.ok(LIBRARY_TIMEOUT_MS >= 10 * 3200, `${LIBRARY_TIMEOUT_MS} ms is within ten times the measured cost`);
  assert.throws(() => createLibraryClient({ spawn: () => fakeWorker(silent), timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => createLibraryClient({ spawn: () => fakeWorker(silent), timeoutMs: Infinity }), /timeoutMs/);
});

// ---- every way a worker can fail rejects what is waiting and retires it ------------------------------------

const FAILURES = [
  ['an error event', (w) => w.say('error', { message: 'SyntaxError in library-worker.js', preventDefault() {} }), /library worker failed: SyntaxError/],
  ['a reply that could not be read', (w) => w.say('messageerror', {}), /could not be read/],
  ['a reply of another protocol', (w) => w.say('message', { data: { kind: 'solver', id: w.asked[0].id, ok: true, result: 1 } }), /"solver" reply/],
  ['a success with no result', (w) => w.say('message', { data: { kind: LIBRARY_ASK, id: w.asked[0].id, ok: true } }), /malformed reply/],
  ['ids that are not a list', (w) => w.say('message', { data: { kind: LIBRARY_ASK, id: w.asked[1].id, ok: true, result: { sune: true } } }), /malformed reply/],
  ['a catalogue that is a list', (w) => w.say('message', { data: { kind: LIBRARY_ASK, id: w.asked[0].id, ok: true, result: [] } }), /malformed reply/],
  ['an empty catalogue', (w) => w.say('message', { data: { kind: LIBRARY_ASK, id: w.asked[0].id, ok: true, result: {} } }), /malformed reply: the catalogue has no groups/],
  ['a refusal with no message', (w) => w.say('message', { data: { kind: LIBRARY_ASK, id: w.asked[0].id, ok: false } }), /malformed reply/],
];

for (const [what, fail, said] of FAILURES) {
  test(`${what}: every question waiting on the worker is rejected, it is retired, and the next question is answered`, async () => {
    const h = harness(silent, answering);
    const catalogue = h.client.catalogue();
    const ids = h.client.ids();
    fail(h.workers[0]);
    await assert.rejects(catalogue, said);
    await assert.rejects(ids, said, 'a question waiting on the same worker was left waiting');
    assert.equal(h.workers[0].terminated, true);
    assert.equal(h.timers.size, 0, 'a rejected question left its deadline running');
    const next = h.client.ids();
    assert.equal(h.workers.length, 2, 'the next question was asked of the worker that failed');
    assert.deepEqual([...await next], ['sune', 'pll-T']);
  });
}

test('a worker that cannot be reached rejects the question at once, and is not asked again', async () => {
  const h = harness((m, w) => { w.terminated = true; throw new Error('DataCloneError'); }, answering);
  await assert.rejects(h.client.catalogue(), /could not be reached: DataCloneError/);
  assert.equal(h.timers.size, 0);
  const next = h.client.catalogue();
  assert.equal(h.workers.length, 2, 'the next question was asked of the worker that could not be reached');
  assert.deepEqual(await next, CATALOGUE);
});

// ---- what is cached, and what is not ------------------------------------------------------------------------

test('questions asked together share one worker; an answer is kept, and an unknown id is ignored', async () => {
  const held = [];
  const h = harness((m) => held.push(m));
  const a = h.client.catalogue();
  const b = h.client.catalogue();
  const ids = h.client.ids();
  assert.equal(a, b, 'two visits asked the catalogue twice');
  assert.deepEqual(held.map((m) => m.ask), ['catalogue', 'ids']);
  const w = h.workers[0];
  // An answer to a question nobody asked changes nothing.
  w.say('message', { data: { kind: LIBRARY_ASK, id: 999, ok: true, result: 'stray' } });
  // Answered out of order: each answer goes to its own question.
  w.answer(held[1], ['sune']);
  w.answer(held[0], copy(CATALOGUE));
  assert.deepEqual([...await ids], ['sune']);
  assert.deepEqual(await a, CATALOGUE);
  // Kept for the page's lifetime: asking again sends nothing.
  assert.equal(await h.client.catalogue(), await a);
  assert.deepEqual([...await h.client.ids()], ['sune']);
  assert.equal(held.length, 2, 'a kept answer was asked again');
  assert.equal(h.workers.length, 1);
  assert.equal(w.terminated, false, 'a worker that answered was retired');
});

test('the client needs a spawn function', () => {
  assert.throws(() => createLibraryClient(), /spawn function/);
  assert.throws(() => createLibraryClient({ spawn: 'worker.js' }), /spawn function/);
});

// ---- a catalogue is checked whole before it is kept --------------------------------------------------------

test('the real catalogue passes the check, and every way of breaking it is named', async () => {
  const real = await catalogueOf(await import('../lib/alg-library.js'));
  assert.equal(catalogueProblem(real), null);
  assert.equal(catalogueProblem(copy(CATALOGUE)), null);
  const broken = (edit) => { const c = copy(CATALOGUE); edit(c); return catalogueProblem(c); };
  const CASES = [
    [() => null, /not a record/, null],
    [(c) => { delete c.groups; }, /has no groups/],
    [(c) => { c.sets = []; }, /sets is not a record/],
    [(c) => { delete c.rows; }, /rows is not a record/],
    [(c) => { c.triggers = { 'sexy-move': {} }; }, /trigger "sexy-move" has no name/],
    [(c) => { c.pending = [{ id: 'mehta-algs' }]; }, /pending source 0/],
    [(c) => { c.groups[0].phases = 'oll'; }, /group 0 has no list of phases/],
    [(c) => { c.groups[0].phases[0].sets.push('pll'); }, /names a set "pll" the catalogue does not hold/],
    [(c) => { c.sets.ocll.id = 'oll'; }, /set "ocll" says it is "oll"/],
    [(c) => { c.sets.ocll.ids.push('antisune'); }, /set "ocll" names a row "antisune" the catalogue does not hold/],
    [(c) => { c.rows.sune.id = 'antisune'; }, /row "sune" says it is "antisune"/],
    [(c) => { c.rows.sune.alg = ''; }, /row "sune" has no moves/],
    [(c) => { c.rows.sune.chunks = null; }, /row "sune" has no list of chunks/],
    [(c) => { c.rows.sune.set = 'eoll'; }, /row "sune" is filed in "eoll", which does not list it/],
    [(c) => { c.rows.antisune = { id: 'antisune', set: 'ocll', alg: "R U2 R' U' R U' R'", chunks: [] }; }, /row "antisune" is in no set/],
    [(c) => { c.sets.cpll = { id: 'cpll', name: 'Two-look PLL', kind: 'hand-written', purpose: null, ids: [] }; }, /set "cpll" is in no group/],
  ];
  for (const [edit, said, whole] of CASES) {
    const problem = whole === null ? catalogueProblem(null) : broken(edit);
    assert.match(String(problem), said);
  }
});

test('a malformed catalogue is not kept: the next visit asks a fresh worker and is answered', async () => {
  const h = harness((m, w) => w.answer(m, {}), answering);
  await assert.rejects(h.client.catalogue(), /malformed reply: the catalogue has no groups/);
  const next = h.client.catalogue();
  assert.equal(h.workers.length, 2, 'the malformed answer was kept, or asked again of the same worker');
  assert.deepEqual(await next, CATALOGUE);
});
