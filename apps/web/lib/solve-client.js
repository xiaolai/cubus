// Talking to the solver worker.
//
// The shape it exposes is exactly the `solve(facelets, { solLen, probeMax })` that
// solve-target.js drives, so the tiered search does not know or care that there is a thread
// boundary in the middle.
//
// The worker is created lazily and injected, which is what makes the protocol testable: a fake
// worker in a test can answer, stay silent, or die, and this file has to behave in all three.

/** How a search is abandoned. min2phase cannot be interrupted mid-call — it is a synchronous
 *  loop in compiled code — so the only way to stop one already running is to end the thread it
 *  is on. That costs the table build (~260 ms) on the next search, which is the right trade for
 *  a deliberate "stop": nothing else would actually stop it. */
const CANCELLED = 'solve cancelled';

/**
 * @param {() => Worker} spawn  makes a fresh worker. Injected so tests can supply a fake.
 */
export function createSolveClient({ spawn } = {}) {
  if (typeof spawn !== 'function') throw new TypeError('createSolveClient needs a spawn function');

  let worker = null;
  let nextId = 1;
  const pending = new Map();

  const attach = () => {
    if (worker) return worker;
    worker = spawn();
    worker.addEventListener('message', (event) => {
      const { id, alg, error } = event.data ?? {};
      const waiting = pending.get(id);
      if (!waiting) return; // a reply to a search that was already abandoned
      pending.delete(id);
      if (error) waiting.reject(new Error(error));
      else waiting.resolve(alg);
    });
    // A worker that dies takes every search in flight with it. Rejecting them is the only way
    // the caller finds out; leaving them pending would hang the screen with no error anywhere.
    worker.addEventListener('error', (event) => {
      const reason = new Error(`solver worker failed: ${event?.message ?? 'unknown'}`);
      for (const [, waiting] of pending) waiting.reject(reason);
      pending.clear();
      worker = null;
    });
    return worker;
  };

  function solve(facelets, { solLen, probeMax } = {}) {
    const active = attach();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      active.postMessage({ id, facelets, solLen, probeMax });
    });
  }

  /** Abandon everything in flight. The next `solve` starts a fresh worker. */
  function cancel() {
    for (const [, waiting] of pending) waiting.reject(new Error(CANCELLED));
    pending.clear();
    worker?.terminate();
    worker = null;
  }

  return { solve, cancel, dispose: cancel, get idle() { return pending.size === 0; } };
}

/**
 * A worker-shaped object that runs min2phase on the calling thread.
 *
 * For environments with no `Worker` at all. Solving still works; it just blocks, and at the
 * tightest tier that could be half a minute of frozen page — so it says so once, loudly, rather
 * than degrading quietly. Every browser and every webview the app ships in has `Worker`; this is
 * for the ones that do not, and it is what lets the DOM tests drive the real solver instead of a
 * stub.
 */
function inlineWorker() {
  console.warn(
    'solve-client: this environment has no Worker, so the solver runs on the main thread. ' +
      'Searches will block the page for as long as they take.',
  );
  const listeners = new Map();
  let solve = null;
  const ready = (async () => {
    const [{ createSolver }, min2phase] = await Promise.all([
      import('./min2phase-engine.js'),
      import('../vendor/min2phase.js'),
    ]);
    solve = createSolver(min2phase);
  })();
  return {
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    postMessage(request) {
      const { id, facelets, solLen, probeMax } = request ?? {};
      void ready.then(
        () => {
          try {
            listeners.get('message')?.({ data: { id, alg: solve(facelets, { solLen, probeMax }) } });
          } catch (err) {
            listeners.get('message')?.({ data: { id, error: err?.message ?? String(err) } });
          }
        },
        (err) => listeners.get('message')?.({ data: { id, error: err?.message ?? String(err) } }),
      );
    },
    // Nothing to terminate — a synchronous search cannot be interrupted, so a cancel here only
    // stops the NEXT one. The client's own bookkeeping already abandons the answer.
    terminate() {},
  };
}

/** The real worker, for the app. Kept out of `createSolveClient` so nothing in a test ever
 *  needs a DOM or a thread. */
export const spawnSolveWorker = () =>
  (typeof Worker === 'undefined'
    ? inlineWorker()
    : new Worker(new URL('./solve-worker.js', import.meta.url), { type: 'module' }));

export const CANCELLED_MESSAGE = CANCELLED;
