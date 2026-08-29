// Talking to the solver worker.
//
// The shape it exposes is exactly the `solve(facelets, { solLen, probeMax })` that
// solve-target.js drives, so the tiered search does not know or care that there is a thread
// boundary in the middle.
//
// The worker is created lazily and injected, which is what makes the protocol testable: a fake
// worker in a test can answer, stay silent, or die, and this file has to behave in all three.

/** How a search is abandoned. The solver cannot be interrupted mid-call — it is a synchronous
 *  search loop — so the only way to stop one already running is to end the thread it is on.
 *  That costs the table build (~0.5-2.6 s) on the next search, which is the right trade for a
 *  deliberate "stop": nothing else would actually stop it. */
const CANCELLED = 'solve cancelled';

/**
 * One request, one reply — shared by the real worker and the inline fallback so the two
 * protocols cannot drift. Tagged with `ok` so an empty error message cannot read as success,
 * which is exactly what `if (error)` once made of it.
 */
export function handleSolveRequest(solve, request) {
  const { id, facelets, solLen, probeMax } = request ?? {};
  try {
    return { id, ok: true, alg: solve(facelets, { solLen, probeMax }) };
  } catch (err) {
    return { id, ok: false, error: errorText(err) };
  }
}

/** One error-to-string rule for every reply path — the worker's and the inline loader's had
 *  already drifted apart once. Never empty: `ok` is the tag, but a blank reason helps nobody. */
const errorText = (err) => String(err?.message ?? err) || 'solver failed';

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
    // Both listeners close over THIS worker and check it is still current before acting: a
    // delayed event from a replaced worker once had the power to kill its replacement's
    // requests. Stale events are dropped instead.
    const spawned = spawn();
    worker = spawned;
    spawned.addEventListener('message', (event) => {
      if (worker !== spawned) return; // a reply from a worker that was already replaced
      const data = event.data ?? {};
      const waiting = pending.get(data.id);
      if (!waiting) return; // a reply to a search that was already abandoned
      pending.delete(data.id);
      // The reply is validated, not trusted: `ok` is the tag (an empty error string must not
      // read as success), and a success carries an algorithm string or null, nothing else.
      if (data.ok === true && (typeof data.alg === 'string' || data.alg === null)) {
        waiting.resolve(data.alg);
      } else if (data.ok === false && typeof data.error === 'string') {
        waiting.reject(new Error(data.error));
      } else {
        waiting.reject(new Error('solver worker sent a malformed reply'));
      }
    });
    // A worker that dies takes every search in flight with it. Rejecting them is the only way
    // the caller finds out; leaving them pending would hang the screen with no error anywhere.
    spawned.addEventListener('error', (event) => {
      if (worker !== spawned) return; // a stale corpse must not take down its replacement
      event.preventDefault?.(); // handled here — it must not double as an uncaught page error
      spawned.terminate(); // dead to us either way; make it dead to the OS too
      const reason = new Error(`solver worker failed: ${event?.message ?? 'unknown'}`);
      for (const [, waiting] of pending) waiting.reject(reason);
      pending.clear();
      worker = null;
    });
    return spawned;
  };

  function solve(facelets, { solLen, probeMax } = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      // attach() lives INSIDE the executor: a spawn() that throws must reject this promise,
      // not escape solve() synchronously — the function's contract is asynchronous either way.
      const active = attach();
      pending.set(id, { resolve, reject });
      try {
        active.postMessage({ id, facelets, solLen, probeMax });
      } catch (err) {
        // A synchronous send failure would otherwise leave this entry pending forever — the
        // promise would reject, but `idle` would lie and cancel() would re-reject a corpse.
        pending.delete(id);
        reject(err);
      }
    });
  }

  /** Abandon everything in flight. The next `solve` starts a fresh worker. */
  function cancel() {
    for (const [, waiting] of pending) waiting.reject(new Error(CANCELLED));
    pending.clear();
    worker?.terminate();
    worker = null;
  }

  return { solve, cancel, get idle() { return pending.size === 0; } };
}

/**
 * A worker-shaped object that runs the solver on the calling thread.
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
  let closed = false;
  const ready = (async () => {
    const [{ createSolver }, twoPhase] = await Promise.all([
      import('./solver-engine.js'),
      import('./two-phase.js'),
    ]);
    solve = createSolver(twoPhase);
  })();
  return {
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    postMessage(request) {
      void ready.then(
        () => {
          // A terminate() that landed while the engine was still loading stops the queued
          // search from ever starting — a synchronous search cannot be interrupted, so not
          // starting it is the only cancellation this thread-less worker can honour.
          if (closed) return;
          listeners.get('message')?.({ data: handleSolveRequest(solve, request) });
        },
        (err) => {
          if (closed) return;
          const { id } = request ?? {};
          listeners.get('message')?.({ data: { id, ok: false, error: errorText(err) } });
        },
      );
    },
    terminate() {
      closed = true;
    },
  };
}

/** The real worker, for the app. Kept out of `createSolveClient` so nothing in a test ever
 *  needs a DOM or a thread. */
export const spawnSolveWorker = () =>
  (typeof Worker === 'undefined'
    ? inlineWorker()
    : new Worker(new URL('./solve-worker.js', import.meta.url), { type: 'module' }));

export const CANCELLED_MESSAGE = CANCELLED;
