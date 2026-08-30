// Talking to the solver worker.
//
// The shape it exposes is exactly the `solve(facelets, { solLen, probeMax })` that
// solve-target.js drives, so the tiered search does not know or care that there is a thread
// boundary in the middle.
//
// The worker is created lazily and injected, which is what makes the protocol testable: a fake
// worker in a test can answer, stay silent, or die, and this file has to behave in all three.

// The one constant this file needs from the engine wrapper: the budget an omitted `probeMax`
// means. The pool divides the budget, so it has to know the default rather than divide
// `undefined` — which is how an omitted budget became 1 node per worker in an earlier draft.
// A constant, not the engine: the solver itself is still injected.
import { DEFAULT_NODE_BUDGET } from './solver-engine.js';

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
export function handleSolveRequest(solve, request, readStats = () => ({})) {
  const { id, facelets, solLen, probeMax, views = null } = request ?? {};
  try {
    const alg = solve(facelets, { solLen, probeMax, views });
    // `depth` and `view` are the sort key a parallel caller needs and a single-worker caller
    // ignores. They are the engine's own: the phase-1 depth the answer was found at and the
    // index of the view that found it — which is exactly the order the sequential search
    // explores in, so the minimum across slices IS the sequential answer.
    const { depth = -1, view = -1 } = readStats() ?? {};
    return { id, ok: true, alg, depth, view };
  } catch (err) {
    return { id, ok: false, error: errorText(err) };
  }
}

/** A reply's sort-key field, or -1. Not trusted: a malformed or missing value must not become
 *  a key that sorts ahead of a real one. */
const key = (v) => (Number.isInteger(v) && v >= 0 ? v : -1);

/** One error-to-string rule for every reply path — the worker's and the inline loader's had
 *  already drifted apart once. Never empty: `ok` is the tag, but a blank reason helps nobody. */
const errorText = (err) => String(err?.message ?? err) || 'solver failed';

/**
 * The stop word, across the thread boundary.
 *
 * Only a buffer can be shared between threads; a VIEW of one is a buffer PLUS an offset and a
 * length, and posting `word.buffer` alone silently drops the other two. The receiver then
 * rebuilds at offset 0 and polls a different word than the sender writes — quietly, because a
 * stop that never fires looks exactly like a search that had nothing to stop for.
 *
 * Both sides go through this pair, so the word is the same word wherever the view starts. The
 * app happens to allocate at offset 0 today; that is not something the protocol should depend on.
 */
export function stopDescriptor(word) {
  if (word === null || word === undefined) return null;
  if (!(word instanceof Int32Array)) throw new TypeError('the stop word must be an Int32Array');
  return { buffer: word.buffer, byteOffset: word.byteOffset, length: word.length };
}

/** The other half of `stopDescriptor`: the receiver's view of the sender's word. */
export function stopWord(descriptor) {
  if (!descriptor) return null;
  return new Int32Array(descriptor.buffer, descriptor.byteOffset, descriptor.length);
}

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
        // The sort key rides with THIS reply. It used to be stashed on the client and read
        // after the await, which a concurrent reply could overwrite first — reproduced by the
        // audit: slice A1 won although A0 held the lower key. A per-request value cannot race.
        waiting.resolve(waiting.detailed ? { alg: data.alg, depth: key(data.depth), view: key(data.view) } : data.alg);
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

  /**
   * @param {string} facelets
   * @param {object} [bounds]
   * @param {number} [bounds.solLen]   the length bound handed to the engine
   * @param {number} [bounds.probeMax] this request's node budget
   * @param {number[]|null} [bounds.views]  which of the six views to search, or null for all
   * @param {Int32Array|null} [bounds.shared]  this solve's stop word — an Int32Array, not a bare
   *   buffer, so its offset can cross with it. Rejected with a TypeError if it is anything else.
   * @param {boolean} [bounds.detailed]  resolve `{alg, depth, view}` instead of the algorithm
   */
  function solve(facelets, { solLen, probeMax, views = null, shared = null, detailed = false } = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      // attach() lives INSIDE the executor: a spawn() that throws must reject this promise,
      // not escape solve() synchronously — the function's contract is asynchronous either way.
      const active = attach();
      pending.set(id, { resolve, reject, detailed });
      try {
        // `shared` travels WITH the request, not as a one-off init message. One word per solve
        // is what keeps overlapping solves — which the app allows — from publishing each other's
        // depths into one channel and stopping the wrong cube's search. It goes as a descriptor
        // rather than a bare buffer so the offset survives the crossing; see stopDescriptor.
        active.postMessage({ id, facelets, solLen, probeMax, views, shared: stopDescriptor(shared) });
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

/** Deal the views round-robin, so every slice gets a spread rather than a block. Views differ in
 *  how quickly they find an answer, and a block hands one worker all the slow ones.
 *
 *  `viewCount` is the ENGINE's number, passed in rather than duplicated here — a second copy is
 *  how a slice ends up searching nothing, or a filter ends up out of range. */
export function sliceViews(workers, viewCount) {
  if (!Number.isInteger(viewCount) || viewCount < 1) {
    throw new RangeError(`sliceViews: viewCount ${viewCount} is not a positive integer`);
  }
  if (!Number.isInteger(workers) || workers < 1) {
    throw new RangeError(`sliceViews: workers ${workers} is not a positive integer`);
  }
  const n = Math.min(workers, viewCount);
  const slices = Array.from({ length: n }, () => []);
  for (let v = 0; v < viewCount; v++) slices[v % n].push(v);
  return slices;
}

/** Split a node budget into `n` parts that add up to exactly the original. The remainder is
 *  dealt to the first slices rather than dropped: a budget is a promise about total work, and
 *  `Math.floor(b / n) * n` quietly spends less than asked while `Math.max(1, ...)` on a tiny
 *  budget quietly spends more. */
export function shareBudget(probeMax, n) {
  if (!Number.isSafeInteger(probeMax) || probeMax < 1) {
    throw new RangeError(`shareBudget: probeMax ${probeMax} is not a positive integer`);
  }
  const base = Math.floor(probeMax / n);
  const extra = probeMax - base * n;
  // A budget smaller than the worker count cannot be split without inventing nodes, so the
  // slices that would get zero are simply not given work.
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0)).filter((b) => b > 0);
}

/** Lowest phase-1 depth first, then lowest view index — the order the sequential engine searches
 *  in. A reply with no answer, or without a usable key, cannot win. */
export function pickWinner(replies) {
  const found = replies.filter(
    (r) => r && typeof r.alg === 'string' && Number.isInteger(r.depth) && r.depth >= 0 && Number.isInteger(r.view) && r.view >= 0,
  );
  if (found.length === 0) return null;
  found.sort((a, b) => (a.depth - b.depth) || (a.view - b.view));
  return found[0].alg;
}

/**
 * The same `solve(facelets, { solLen, probeMax })` contract, answered by several workers at once.
 *
 * Each worker searches a slice of the engine's views with its share of the node budget, and the
 * answer is picked by (depth, view) — the order the sequential engine searches in. The pick is
 * what makes the result DETERMINISTIC: which worker finishes first cannot change it, because
 * arrival order is not part of the key, and the stop below can only ever cut work that could not
 * have won.
 *
 * What it is NOT is identical to a single-worker answer at every budget, and an earlier draft of
 * this comment claimed it was. It is identical when each slice can afford what the shared budget
 * would have reached — which held for 40 of 40 cubes offline and 90 of 90 in a browser at the
 * shipped 50M budget. Under budget PRESSURE it diverges, because a slice can exhaust its quota
 * where the sequential search would have spent another view's unused nodes: at 3,000,000 nodes
 * sequential answers (11,1) on `RBBFUDDBBLL…` while six 500,000-node slices answer (11,2), and at
 * 10,002 nodes sequential finds an answer that every slice misses. Both are valid solutions
 * inside the bound and the same length; they are not the same algorithm. `parallel-divergence`
 * in solve-client.test.mjs pins that boundary so nobody re-derives it.
 *
 * Requires SharedArrayBuffer — not for the answer, but for the stop. A search is synchronous, so
 * a worker that cannot possibly win still runs to its budget unless something reaches inside it,
 * and waiting for those costs more than the parallelism wins. One buffer PER SOLVE: the app
 * allows overlapping solves, and a single shared word let one cube's answer stop another cube's
 * search.
 */
export function createParallelSolveClient({ spawn, workers, viewCount, makeShared = null } = {}) {
  if (typeof spawn !== 'function') throw new TypeError('createParallelSolveClient needs a spawn function');
  const slices = sliceViews(workers ?? 1, viewCount);
  const clients = slices.map(() => createSolveClient({ spawn }));
  const NO_BEST = 0x7fffffff;

  async function solve(facelets, { solLen, probeMax = DEFAULT_NODE_BUDGET } = {}) {
    const shares = shareBudget(probeMax, clients.length);
    const used = clients.slice(0, shares.length);
    // A fresh word per solve. `makeShared` is injected so a page without SharedArrayBuffer — or
    // a test — gets a correct client that simply never stops early.
    const stop = makeShared?.() ?? null;
    if (stop) Atomics.store(stop, 0, NO_BEST);

    // The first failure cancels the siblings IMMEDIATELY, not after everyone has settled.
    // Waiting first deadlocks: a worker that died takes its promise with it, and the others are
    // still searching a cube whose answer nobody will use — `allSettled` would wait for replies
    // that are never coming. Cancelling is what makes them settle, so the order matters.
    let firstError = null;
    const abandonAll = (err) => {
      if (firstError !== null) return;
      firstError = err;
      for (const c of used) c.cancel();
    };
    const settled = await Promise.allSettled(used.map((client, i) =>
      client.solve(facelets, {
        solLen,
        probeMax: shares[i],
        views: slices[i],
        shared: stop,
        detailed: true,
      }).catch((err) => { abandonAll(err); throw err; }).then((reply) => {
        // Publish only a real answer, and only when it is SHALLOWER than what is published. A
        // sibling exploring deeper can stop; one at the same depth cannot, because a lower view
        // index there still wins — which is exactly why the pick stays deterministic.
        if (stop && typeof reply.alg === 'string' && reply.depth >= 0) {
          let seen = Atomics.load(stop, 0);
          while (reply.depth < seen) {
            const prev = Atomics.compareExchange(stop, 0, seen, reply.depth);
            if (prev === seen) break;
            seen = prev;
          }
        }
        return reply;
      })));

    // allSettled, not all: `all` would resolve the caller's promise while siblings were still
    // running and pending. Everyone is waited for, and the FIRST failure propagates — not a
    // cancellation caused by it, which is why abandonAll keeps the original.
    if (firstError !== null) throw firstError;
    return pickWinner(settled.map((r) => r.value));
  }

  function cancel() {
    for (const c of clients) c.cancel();
  }

  return { solve, cancel, get idle() { return clients.every((c) => c.idle); }, workers: clients.length };
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
