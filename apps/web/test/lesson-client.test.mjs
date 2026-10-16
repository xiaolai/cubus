// The lesson worker's protocol, on this thread: the handler the worker runs, and the client the app asks
// through (lib/lesson-client.js). The worker itself is held to the UI thread's absence of searches by
// test/browser/lesson-off-main-thread.test.mjs, and to the frozen beginner baseline there and in
// beginner-lesson.test.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Cube from 'cubejs';

import { METHOD_SOLVE, createLessonClient, handleMethodSolve } from '../lib/lesson-client.js';
import { STOP_NOW, stopDescriptor } from '../lib/solve-client.js';
import { solveByMethod } from '../lib/method-solver.js';
import { methodById } from '../lib/methods/registry.js';
import { methodOf } from '../lib/methods/method-of.js';
import { SOLVED, applyAlg, fromCube, toFacelets } from '../lib/cube-pieces.js';

const engine = { solveByMethod, methodById, methodOf };
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

test('the piece state the app sends is the method frame\'s, read by cubejs', () => {
  // `lessonFor` turns the subject's facelets into a piece state with cubejs before it asks — the worker
  // never sees a facelet string, so it never needs cubejs at all.
  const state = fromCube(Cube.fromString(new Cube().asString()));
  assert.deepEqual(state, { ...SOLVED, cp: [...SOLVED.cp], co: [...SOLVED.co], ep: [...SOLVED.ep], eo: [...SOLVED.eo] });
});
