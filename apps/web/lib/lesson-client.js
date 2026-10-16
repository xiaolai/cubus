// The method solver, asked from the UI thread and answered on a worker the page owns
// (lib/lesson-worker.js). AGENTS.md §2's rule for the two-phase search, applied to the method solver.
//
// WHY. Measured 2026-10-16 in WebKit (bench/lesson-main-thread.mjs, five fresh sessions): choosing
// CFOP (full) blocked the page for a median 836 ms — its 119-algorithm repertoires and the cross table
// are built on first use — and a Beginner walk for 149 ms. A lesson is pure work on a piece state and
// returns plain data, which is exactly what a worker is for.
//
// WHY A WORKER OF ITS OWN and not a slot in the solver pool. The pool's workers run two-phase searches
// that are synchronous and can last seconds at a tight tier; a lesson posted behind one waits the whole
// search out, because a worker answers one message at a time. The repair engine shares worker 0 and
// pays that queueing; a lesson is the walk a learner chose and must not. The cost is one more thread
// and the repertoires' memory, which a session that never chooses a method never pays: the worker is
// spawned on the first lesson.
//
// WHAT CROSSES. The question is a piece state already in the method frame and a method's registry id —
// never a method object, whose stages are functions. The answer is the solver's steps, rungs and alg,
// plain data, structured-cloned; `lessonFrom` in lib/cube-subject.js turns them into a lesson on this
// thread, cheaply, because that half needs the translator and the subject.
//
// A SUPERSEDED QUESTION is called off through a stop word, as the solver pool's are (`STOP_NOW`): the
// walk's signal writes it, and the worker reads it before it starts. A lesson cannot be stopped midway —
// the method solver takes no stop — but the first one's cost is the repertoire build, which the next
// question needs anyway, and a warm lesson is tens of milliseconds. The caller is answered `null` at
// once either way.

import { STOP_NOW, stopDescriptor, stopWord } from './solve-client.js';

/** The message kind, so a reply can never be read as another worker protocol's. */
export const METHOD_SOLVE = 'method-solve';

/** Whether a request's stop word says it was called off. */
export const isCalledOff = (word) => word !== null && word !== undefined && Atomics.load(word, 0) === STOP_NOW;

/**
 * The worker's whole job, as a pure function so node can test it: solve `request.state` with the method
 * the registry names, or say why not. `engine` is `{ solveByMethod, methodById, methodOf }`.
 *
 * Never throws: a method that cannot finish a cube is an ANSWER (`ok: false`, the stage it stopped at),
 * and a worker that threw would take every other question in flight down with it.
 */
export function handleMethodSolve(engine, request) {
  const { id, state, method } = request ?? {};
  if (isCalledOff(stopWord(request?.stop))) return { kind: METHOD_SOLVE, id, ok: true, calledOff: true };
  try {
    const entry = engine.methodById(method);
    const r = engine.solveByMethod(state, engine.methodOf(entry));
    return { kind: METHOD_SOLVE, id, ok: true, result: { steps: r.steps, rungs: r.rungs, alg: r.alg } };
  } catch (err) {
    return {
      kind: METHOD_SOLVE, id, ok: false,
      error: { name: String(err?.name ?? 'Error'), message: String(err?.message ?? err), stage: err?.stage ?? null },
    };
  }
}

/**
 * A client of one lesson worker.
 *
 * @param {object} deps `spawn()`, which makes the worker (injected so tests can supply a fake), and
 *   `makeShared()`, which makes a stop word, or null where the page cannot share memory.
 * @returns {{ solve: (state: object, method: string, opts?: { signal?: AbortSignal }) => Promise<object|null> }}
 *   `solve` resolves the solver's `{ steps, rungs, alg }`, or null when the question was called off; it
 *   rejects with the solver's own error when the method cannot finish the cube, and with a worker
 *   failure when the thread died.
 */
export function createLessonClient({ spawn, makeShared = null } = {}) {
  if (typeof spawn !== 'function') throw new TypeError('createLessonClient needs a spawn function');
  let worker = null;
  let nextId = 1;
  const pending = new Map();

  const failAll = (reason) => {
    for (const [, waiting] of pending) waiting.reject(reason);
    pending.clear();
  };

  const attach = () => {
    if (worker) return worker;
    const spawned = spawn();
    worker = spawned;
    spawned.addEventListener('message', (event) => {
      if (worker !== spawned) return;
      const data = event.data ?? {};
      const waiting = pending.get(data.id);
      if (!waiting) return; // a reply to a question already called off
      pending.delete(data.id);
      if (data.kind !== METHOD_SOLVE) { waiting.reject(new Error(`lesson worker answered with a "${String(data.kind)}" reply`)); return; }
      if (data.ok === true && data.calledOff === true) { waiting.resolve(null); return; }
      if (data.ok === true && data.result && Array.isArray(data.result.steps) && typeof data.result.alg === 'string') {
        waiting.resolve(data.result);
        return;
      }
      if (data.ok === false && data.error && typeof data.error.message === 'string') {
        waiting.reject(Object.assign(new Error(data.error.message), { name: data.error.name, stage: data.error.stage }));
        return;
      }
      waiting.reject(new Error('lesson worker sent a malformed reply'));
    });
    spawned.addEventListener('messageerror', () => {
      if (worker !== spawned) return;
      failAll(Object.assign(new Error('lesson worker sent a reply that could not be read'), { workerFailure: true }));
    });
    // A dead worker takes every question in flight with it, and the next question builds a new one.
    spawned.addEventListener('error', (event) => {
      if (worker !== spawned) return;
      event.preventDefault?.();
      spawned.terminate?.();
      worker = null;
      failAll(Object.assign(new Error(`lesson worker failed: ${event?.message ?? 'unknown'}`), { workerFailure: true }));
    });
    return spawned;
  };

  function solve(state, method, { signal } = {}) {
    if (signal?.aborted) return Promise.resolve(null);
    const id = nextId++;
    const word = makeShared ? makeShared() : null;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (word) Atomics.store(word, 0, STOP_NOW);
        if (pending.delete(id)) resolve(null);
      };
      const settle = (fn) => (value) => { signal?.removeEventListener('abort', onAbort); fn(value); };
      pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        attach().postMessage({ kind: METHOD_SOLVE, id, state, method, stop: stopDescriptor(word) });
      } catch (cause) {
        pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
        reject(Object.assign(new Error(`lesson worker could not be reached: ${cause?.message ?? cause}`), { workerFailure: true, cause }));
      }
    });
  }

  return Object.freeze({ solve });
}

/**
 * This thread, standing in for a worker where the platform has none — node's tests, a page that
 * refused the worker. Loud, because every lesson then blocks the page; and every message is
 * structured-cloned both ways, so what a lesson built here receives is exactly what a worker would
 * have sent, and nothing the clone drops can pass a test here and fail in a browser.
 */
function inlineLessonWorker() {
  console.warn('lesson-client: no worker for the method solver, so lessons are worked out on this thread');
  const listeners = { message: [], error: [], messageerror: [] };
  const engine = (async () => {
    const [{ solveByMethod }, { methodById }, { methodOf }] = await Promise.all([
      import('./method-solver.js'), import('./methods/registry.js'), import('./methods/method-of.js'),
    ]);
    return { solveByMethod, methodById, methodOf };
  })();
  return {
    addEventListener: (type, fn) => listeners[type]?.push(fn),
    postMessage(message) {
      const request = structuredClone(message);
      void engine.then((e) => setTimeout(() => {
        const data = structuredClone(handleMethodSolve(e, request));
        for (const fn of listeners.message) fn({ data });
      }, 0));
    },
    terminate() {},
  };
}

let workerBroken = false;

/** A real module worker where one can be had, and this thread where one cannot. A worker that fails to
 *  LOAD (it never speaks) is remembered, so the next lesson does not build another one just as doomed. */
export const spawnLessonWorker = () => {
  if (workerBroken || typeof Worker === 'undefined') return inlineLessonWorker();
  try {
    const spawned = new Worker(new URL('./lesson-worker.js', import.meta.url), { type: 'module' });
    let spoke = false;
    spawned.addEventListener('message', () => { spoke = true; }, { once: true });
    spawned.addEventListener('error', () => { if (!spoke) workerBroken = true; }, { once: true });
    return spawned;
  } catch (cause) {
    console.warn('lesson-client: the lesson worker could not be built, so lessons run on this thread', cause);
    workerBroken = true;
    return inlineLessonWorker();
  }
};

let client = null;

/**
 * The method solver's door for the app: `methodSolve(state, methodId, { signal })`, answered off this
 * thread. One client, and so one worker and one set of repertoires, for the page.
 */
export function methodSolve(state, method, opts) {
  client ??= createLessonClient({
    spawn: spawnLessonWorker,
    makeShared: typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true
      ? () => new Int32Array(new SharedArrayBuffer(4))
      : null,
  });
  return client.solve(state, method, opts);
}
