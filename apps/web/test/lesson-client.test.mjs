// The lesson worker's protocol, on this thread: the handler the worker runs, and the client the app asks
// through (lib/lesson-client.js). The worker itself is held to the UI thread's absence of searches by
// test/browser/lesson-off-main-thread.test.mjs, and to the frozen beginner baseline there and in
// beginner-lesson.test.mjs. That `lessonFor` asks about the METHOD frame (the white cross) is held by
// stage-wiring.test.mjs, "the engine is asked about the WHITE cross", which fails without `toMethodFrame`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Cube from 'cubejs';

import { METHOD_SOLVE, createLessonClient, handleMethodSolve } from '../lib/lesson-client.js';
import { STOP_NOW, stopDescriptor, stopWord } from '../lib/solve-client.js';
import { solveByMethod } from '../lib/method-solver.js';
import { methodById } from '../lib/methods/registry.js';
import { methodOf } from '../lib/methods/method-of.js';
import { SOLVED, applyAlg, fromCube, toFacelets } from '../lib/cube-pieces.js';

const engine = { solveByMethod, methodById, methodOf };
// A question nobody settles never resolves; a cap turns that defect into a failure rather than a hang.
const NEVER_HANGS = { timeout: 10_000 };
const SCRAMBLED = applyAlg(SOLVED, "R U F' D2 L B U' R2 F D' L2 B2 U");

test('the handler answers what solving on this thread answers, and it survives the structured clone', () => {
  for (const method of ['beginner', 'cfop-4lll', 'cfop']) {
    const reply = structuredClone(handleMethodSolve(engine, structuredClone({ kind: METHOD_SOLVE, id: 7, state: SCRAMBLED, method })));
    const here = solveByMethod(SCRAMBLED, methodOf(methodById(method)));
    assert.equal(reply.kind, METHOD_SOLVE);
    assert.equal(reply.id, 7);
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.result, JSON.parse(JSON.stringify({ steps: here.steps, rungs: here.rungs, alg: here.alg })), `${method}: the answer changed crossing the thread`);
    // And it solves: cubejs, sharing nothing with the solver, agrees.
    const c = Cube.fromString(toFacelets(SCRAMBLED));
    c.move(reply.result.alg);
    assert.ok(c.isSolved(), `${method}: the worker's answer does not solve the cube`);
  }
});

test('a question called off before it starts is not solved, and says so', () => {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.store(word, 0, STOP_NOW);
  let solved = 0;
  const counting = { ...engine, solveByMethod: (...a) => { solved += 1; return solveByMethod(...a); } };
  const reply = handleMethodSolve(counting, { id: 1, state: SCRAMBLED, method: 'cfop', stop: stopDescriptor(word) });
  assert.deepEqual(reply, { kind: METHOD_SOLVE, id: 1, ok: true, calledOff: true });
  assert.equal(solved, 0, 'a called-off question was solved anyway');
});

test('a cube the method cannot finish, or a method with no stages, is an answer — never a throw', () => {
  const impossible = { ...SOLVED, co: [1, 0, 0, 0, 0, 0, 0, 0] };
  const reply = handleMethodSolve(engine, { id: 2, state: impossible, method: 'beginner' });
  assert.equal(reply.ok, false);
  assert.equal(typeof reply.error.message, 'string');
  const quick = handleMethodSolve(engine, { id: 3, state: SCRAMBLED, method: 'quick' });
  assert.equal(quick.ok, false);
  assert.match(quick.error.message, /not a method with stages/);
});

/** A fake worker: answers each message through the real handler, a tick later, cloned both ways. */
function fakeWorker({ answer = (m) => structuredClone(handleMethodSolve(engine, structuredClone(m))) } = {}) {
  const listeners = { message: [], error: [], messageerror: [] };
  const sent = [];
  return {
    sent,
    addEventListener: (type, fn) => listeners[type].push(fn),
    postMessage: (m) => { sent.push(m); setTimeout(() => { const data = answer(m); if (data) for (const fn of listeners.message) fn({ data }); }, 0); },
    terminate() {},
    die: (message) => { for (const fn of listeners.error) fn({ message, preventDefault() {} }); },
    emit: (type, event) => { for (const fn of listeners[type]) fn(event); },
  };
}

test('the client resolves the solver\'s answer, by method id, with a piece state and a stop word', async () => {
  const worker = fakeWorker();
  const client = createLessonClient({ spawn: () => worker, makeShared: () => new Int32Array(new SharedArrayBuffer(4)) });
  const got = await client.solve(SCRAMBLED, 'beginner');
  assert.equal(got.alg, solveByMethod(SCRAMBLED, methodOf(methodById('beginner'))).alg);
  assert.equal(worker.sent[0].method, 'beginner', 'a method crossed as something other than its id');
  assert.ok(worker.sent[0].stop, 'the question went with no stop word');
});

test('a walk that is called off is answered null at once, and its stop word says STOP_NOW', async () => {
  const words = [];
  const worker = fakeWorker({ answer: () => null }); // never answers: the abort must settle it
  const client = createLessonClient({ spawn: () => worker, makeShared: () => { const w = new Int32Array(new SharedArrayBuffer(4)); words.push(w); return w; } });
  const walk = new AbortController();
  const asking = client.solve(SCRAMBLED, 'cfop', { signal: walk.signal });
  walk.abort();
  assert.equal(await asking, null);
  assert.equal(Atomics.load(words[0], 0), STOP_NOW, 'the worker was not told the question was called off');
  // What the WORKER reads is the posted descriptor, not this thread's array: decoded, it says STOP_NOW,
  // and the handler given the posted message solves nothing.
  const posted = stopWord(structuredClone(worker.sent[0]).stop);
  assert.equal(Atomics.load(posted, 0), STOP_NOW, 'the posted stop word is not the one the abort wrote');
  let solved = 0;
  const counting = { ...engine, solveByMethod: (...a) => { solved += 1; return solveByMethod(...a); } };
  assert.equal(handleMethodSolve(counting, structuredClone(worker.sent[0])).calledOff, true);
  assert.equal(solved, 0, 'the worker solved a question the walk had called off');
  assert.equal(await client.solve(SCRAMBLED, 'cfop', { signal: AbortSignal.abort() }), null, 'an already-gone walk was asked');
  assert.equal(worker.sent.length, 1, 'a question was posted for a walk that had already gone');
});

test('a refusal rejects with the solver\'s message; a malformed or foreign reply is refused, never read as a lesson', async () => {
  const impossible = { ...SOLVED, co: [1, 0, 0, 0, 0, 0, 0, 0] };
  const client = createLessonClient({ spawn: () => fakeWorker() });
  await assert.rejects(client.solve(impossible, 'beginner'));
  for (const bad of [{ ok: true }, { kind: 'solve-to-state', ok: true, result: { steps: [], alg: '' } }, { kind: METHOD_SOLVE, ok: true, result: { steps: 'x', alg: '' } }]) {
    const c = createLessonClient({ spawn: () => fakeWorker({ answer: (m) => ({ ...bad, id: m.id }) }) });
    await assert.rejects(c.solve(SCRAMBLED, 'beginner'), /malformed|answered with/);
  }
});

test('a worker that dies fails every question in flight, and the next question gets a new worker', async () => {
  let spawned = 0;
  let current;
  const client = createLessonClient({ spawn: () => { spawned += 1; current = fakeWorker({ answer: () => null }); return current; } });
  const a = client.solve(SCRAMBLED, 'beginner');
  const b = client.solve(SCRAMBLED, 'cfop');
  current.die('out of memory');
  await assert.rejects(a, /lesson worker failed/);
  await assert.rejects(b, /lesson worker failed/);
  void client.solve(SCRAMBLED, 'beginner');
  assert.equal(spawned, 2, 'the dead worker was asked again');
});

test('an inline engine that fails to load fails every question loudly — none is left hanging', async () => {
  const { inlineLessonWorker } = await import('../lib/lesson-client.js');
  const client = createLessonClient({ spawn: () => inlineLessonWorker(() => Promise.reject(new Error('import failed (test)'))) });
  await assert.rejects(client.solve(SCRAMBLED, 'beginner'), /lesson worker failed: import failed/);
});

test('a page whose worker cannot be built gets a DEAD worker, never a solve on its own thread', async () => {
  // A fresh copy of the module, so its "this page's worker is broken" memory starts clean.
  const fresh = await import(`../lib/lesson-client.js?dead=${Date.now()}`);
  const prior = globalThis.Worker;
  globalThis.Worker = class { constructor() { throw new Error('worker-src refused (test)'); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const worker = fresh.spawnLessonWorker();
    const client = fresh.createLessonClient({ spawn: () => worker });
    await assert.rejects(client.solve(SCRAMBLED, 'cfop'), (err) => err.workerFailure === true && /could not be built/.test(err.message));
    // And the next spawn remembers it rather than building another.
    const again = fresh.createLessonClient({ spawn: fresh.spawnLessonWorker });
    await assert.rejects(again.solve(SCRAMBLED, 'cfop'), /could not be loaded/);
  } finally {
    globalThis.Worker = prior;
    console.warn = warn;
  }
});

test('methodOf builds by entry, so a second entry under an id already built is checked and built itself', () => {
  const beginner = methodById('beginner');
  assert.equal(methodOf(beginner).id, '0,0,0,0,course');
  const sameIdOtherSpec = { ...methodById('cfop'), id: 'beginner' };
  assert.equal(methodOf(sameIdOtherSpec).id, '1,2,1,1', 'an entry sharing an id was handed another entry\'s method');
  assert.throws(() => methodOf({ ...beginner, stages: ['cross', 'pairs', 'pll', 'oll'] }), /declares the stages/,
    'an entry sharing an id skipped the stage check');
  assert.equal(methodOf(beginner), methodOf(beginner), 'the same entry is built once');
});

test('each reply settles its own question: out of order, and a called-off one\'s late reply settles nothing', NEVER_HANGS, async () => {
  const worker = fakeWorker({ answer: () => null }); // replies are delivered by hand below
  const client = createLessonClient({ spawn: () => worker });
  const reply = (m) => worker.emit('message', { data: structuredClone(handleMethodSolve(engine, structuredClone(m))) });
  const other = applyAlg(SOLVED, "F R U' L2 D B'");
  const walk = new AbortController();
  const gone = client.solve(SCRAMBLED, 'cfop', { signal: walk.signal });
  const a = client.solve(SCRAMBLED, 'beginner');
  const b = client.solve(other, 'beginner');
  walk.abort();
  assert.equal(await gone, null);
  reply(worker.sent[0]); // the called-off question's late answer: must not settle a or b
  reply(worker.sent[2]);
  reply(worker.sent[1]);
  assert.equal((await a).alg, solveByMethod(SCRAMBLED, methodOf(methodById('beginner'))).alg, 'a got another question\'s answer');
  assert.equal((await b).alg, solveByMethod(other, methodOf(methodById('beginner'))).alg, 'b got another question\'s answer');
});

test('a reply that cannot be read fails every question in flight as a worker failure', NEVER_HANGS, async () => {
  const worker = fakeWorker({ answer: () => null });
  const client = createLessonClient({ spawn: () => worker });
  const a = client.solve(SCRAMBLED, 'beginner');
  const b = client.solve(SCRAMBLED, 'cfop');
  const outcomes = [a, b].map((asking) => asking.then(() => 'resolved', (err) => err));
  worker.emit('messageerror', {});
  // Settled within a tick, not merely "eventually": a question nobody fails would hang the walk forever.
  const settled = await Promise.race([Promise.all(outcomes), new Promise((r) => setTimeout(() => r(null), 0))]);
  assert.ok(settled, 'an unreadable reply left questions pending');
  for (const err of settled) assert.ok(err.workerFailure === true && /could not be read/.test(err.message), String(err));
});

/** A stand-in for the platform's Worker: built, then made to fail or speak by hand. */
function fakePlatformWorker(built) {
  return class {
    constructor() {
      this.listeners = { message: [], error: [], messageerror: [] };
      built.push(this);
    }
    addEventListener(type, fn, opts) {
      const listener = opts?.once ? (e) => { this.listeners[type] = this.listeners[type].filter((f) => f !== listener); fn(e); } : fn;
      this.listeners[type].push(listener);
    }
    postMessage() {}
    terminate() {}
    emit(type, event) { for (const fn of [...this.listeners[type]]) fn(event); }
  };
}

test('a worker that builds but fails to LOAD is remembered: the next lesson gets a dead worker, not another build', NEVER_HANGS, async () => {
  const fresh = await import(`../lib/lesson-client.js?load=${Date.now()}`);
  const prior = globalThis.Worker;
  const built = [];
  globalThis.Worker = fakePlatformWorker(built);
  try {
    const client = fresh.createLessonClient({ spawn: fresh.spawnLessonWorker });
    const asking = client.solve(SCRAMBLED, 'cfop');
    built[0].emit('error', { message: 'module script failed to load (test)', preventDefault() {} });
    await assert.rejects(asking, (err) => err.workerFailure === true);
    const again = client.solve(SCRAMBLED, 'cfop');
    assert.equal(built.length, 1, 'a second worker was built after the first never loaded');
    await assert.rejects(again, /could not be loaded/, 'a page whose worker never loaded built another');
  } finally {
    globalThis.Worker = prior;
  }
});

test('a worker that spoke and then died is not "broken": the next lesson builds a new one', NEVER_HANGS, async () => {
  const fresh = await import(`../lib/lesson-client.js?died=${Date.now()}`);
  const prior = globalThis.Worker;
  const built = [];
  globalThis.Worker = fakePlatformWorker(built);
  try {
    const client = fresh.createLessonClient({ spawn: fresh.spawnLessonWorker });
    const first = client.solve(SCRAMBLED, 'beginner');
    built[0].emit('message', { data: { kind: METHOD_SOLVE, id: 1, ok: true, calledOff: true } });
    assert.equal(await first, null);
    const second = client.solve(SCRAMBLED, 'beginner');
    built[0].emit('error', { message: 'out of memory (test)', preventDefault() {} });
    await assert.rejects(second, /lesson worker failed/);
    void client.solve(SCRAMBLED, 'beginner');
    assert.equal(built.length, 2, 'a worker that had worked was taken for one that never loads');
  } finally {
    globalThis.Worker = prior;
  }
});
