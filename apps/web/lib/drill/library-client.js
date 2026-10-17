// The algorithm library, asked from the UI thread and answered on a worker the page owns
// (lib/drill/library-worker.js). AGENTS.md §2's rule for the method solver, applied to the ledger.
//
// WHY. `lib/alg-library.js` is cheap to IMPORT by design and expensive to READ: its method sources build
// their repertoires as they load, and every row's columns — the effect, the case, the sentence — are
// computed when the row is first asked for. Measured in Node, 2026-10-17: importing it 511 ms, the ids
// (which load the method modules) 750 ms more, and all 309 rows 1.9 s. The practice library shows every
// row, so on the page's thread that is seconds with the screen frozen. A row is plain data, so a worker
// computes them and the page receives them structured-cloned.
//
// WHAT CROSSES. A question names what it wants — `catalogue` (every row, grouped as the library shows them)
// or `ids` (the row ids alone, which the lesson's "practise this" asks and which costs no row) — and the
// answer is plain data. Nothing here imports `alg-library.js`: the worker does, and node's tests (which have
// no `Worker`) load it through `inlineLibraryWorker`.
//
// ONE WORKER, SPAWNED ON THE FIRST QUESTION AND KEPT WHILE IT ANSWERS. Both answers are cached for the page's
// lifetime, so a second visit to the library costs nothing; the worker stays because a lesson may still ask
// for the ids. A worker that FAILS ONCE is never asked again: an error event, a reply it could not send or the
// client cannot read, a refusal (`ok: false` — its library did not load, and a worker keeps that failure in
// its module map and the library's own state), or no answer within `LIBRARY_TIMEOUT_MS`. Each terminates it,
// rejects every question waiting on it, and forgets it, so the next question spawns a fresh one. A failure is
// never cached, so "Reading the algorithms…" becomes an error the screen shows, and a later visit asks again.

/** The message kind, so a reply can never be read as another worker protocol's. */
export const LIBRARY_ASK = 'alg-library';

/** The questions the worker answers. */
export const ASKS = Object.freeze(['catalogue', 'ids']);

/** Whether a result has the shape its question's answer has: the ids are a list of strings, the catalogue a
 *  record. A reply that is not is malformed — refused rather than cached, where it would stay for the page's
 *  lifetime. */
const ANSWER_SHAPE = Object.freeze({
  ids: (result) => Array.isArray(result) && result.every((id) => typeof id === 'string'),
  catalogue: (result) => Boolean(result) && typeof result === 'object' && !Array.isArray(result),
});

/** "mehta-algs" → "Mehta", "corners-first-algs" → "Corners first": a pending source's name, derived from its
 *  id rather than typed beside it. */
export const pendingName = (id) => {
  const words = String(id).replace(/-algs$/, '').split('-').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Every row, grouped the way the library shows them: by offered method, then by its stage, then by set — a
 * set taught by several methods appears under each — and LAST, the sets no method teaches (the proved tables),
 * so that "every row" is true of the library and not only of the methods. Pure over the library module's
 * namespace, so node tests it with the real module.
 *
 * @param {typeof import('../alg-library.js')} lib
 * @returns {Promise<{ groups: object[], sets: Record<string, object>, rows: Record<string, object>,
 *   triggers: Record<string, { name: string }>, pending: object[] }>}
 */
export async function catalogueOf(lib) {
  const { METHOD_SETS, ALG_SETS, PENDING_SOURCES, TRIGGERS, setRows } = lib;
  const rowSets = ALG_SETS.filter((s) => s.kind !== 'not an algorithm');
  const sets = {};
  const rows = {};
  for (const s of rowSets) {
    const list = await setRows(s.id);
    for (const row of list) rows[row.id] = row;
    sets[s.id] = {
      id: s.id, name: s.name, kind: s.kind,
      // A set's purpose, where the library states one; a row's own, where it has one, wins on the row.
      purpose: typeof s.purpose === 'string' ? s.purpose : null,
      ids: list.map((r) => r.id),
    };
  }
  const taught = new Set();
  const groups = METHOD_SETS.map((m) => ({
    method: m.id,
    label: m.method,
    phases: m.phases.filter((p) => (p.held ?? []).length).map((p) => {
      for (const id of p.held) taught.add(id);
      return { stage: p.stage ?? null, phase: p.phase, sets: [...p.held] };
    }),
  })).filter((g) => g.phases.length);
  const untaught = rowSets.map((s) => s.id).filter((id) => !taught.has(id));
  if (untaught.length) groups.push({ method: null, label: null, phases: [{ stage: null, phase: null, sets: untaught }] });
  return {
    groups,
    sets,
    rows,
    triggers: Object.fromEntries(TRIGGERS.map((tr) => [tr.id, { name: tr.name }])),
    pending: PENDING_SOURCES.map((p) => ({ id: p.id, module: p.module, why: p.why, name: pendingName(p.id) })),
  };
}

/**
 * The worker's answer to one request. Never rejects: a library that cannot answer is an answer (`ok: false`)
 * like any other, so no question is left waiting.
 *
 * @param {() => Promise<typeof import('../alg-library.js')>} load
 */
export async function answerLibrary(load, request) {
  const { id, ask } = request ?? {};
  try {
    if (!ASKS.includes(ask)) throw new Error(`the algorithm library answers ${ASKS.join(' or ')}, not "${String(ask)}"`);
    const lib = await load();
    const result = ask === 'ids' ? [...await lib.algIds()] : await catalogueOf(lib);
    return { kind: LIBRARY_ASK, id, ok: true, result };
  } catch (err) {
    return { kind: LIBRARY_ASK, id, ok: false, error: { name: String(err?.name ?? 'Error'), message: String(err?.message ?? err) } };
  }
}

/**
 * How long one question may wait for the worker before the worker is given up. The worker's whole job — the
 * library's import, every row id and every row — measured 3.2 s in Node on 2026-10-17 (this file's header);
 * on 2026-10-18, 0.5 s in Node and 0.6 s in a real WebKit worker, both on a heavily loaded machine. The bound
 * is for a worker that has STOPPED, so it sits far above that: a slow device that reached it would time out
 * on every retry and never see the library, which is worse than a long wait.
 */
export const LIBRARY_TIMEOUT_MS = 60_000;

/**
 * A client of one library worker at a time. `catalogue()` and `ids()` each resolve once and are cached; a
 * failure is NOT cached, and the worker that failed is retired, so the next question asks a fresh one.
 *
 * @param {object} deps
 * @param {() => { addEventListener: Function, postMessage: Function, terminate?: Function }} deps.spawn
 * @param {number} [deps.timeoutMs]  how long a question may wait (`LIBRARY_TIMEOUT_MS`)
 * @param {(fn: Function, ms: number) => unknown} [deps.setTimer]
 * @param {(handle: unknown) => void} [deps.clearTimer]
 */
export function createLibraryClient({
  spawn, timeoutMs = LIBRARY_TIMEOUT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  if (typeof spawn !== 'function') throw new TypeError('createLibraryClient needs a spawn function');
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new TypeError(`createLibraryClient: timeoutMs must be a positive number of ms, not ${timeoutMs}`);
  let worker = null;
  let nextId = 1;
  /** Every question waiting on the current worker: id -> { what, resolve, reject, timer }. */
  const pending = new Map();
  const cached = new Map();

  /** Settle one waiting question, its deadline cleared. */
  const settle = (id, how, value) => {
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    clearTimer(waiting.timer);
    waiting[how](value);
  };

  /** Give the current worker up: terminate it, forget it, and reject every question waiting on it. */
  const retire = (reason) => {
    const gone = worker;
    worker = null;
    try { gone?.terminate?.(); } catch { /* a worker that cannot even be terminated is gone either way */ }
    for (const id of [...pending.keys()]) settle(id, 'reject', reason);
  };

  const attach = () => {
    if (worker) return worker;
    const spawned = spawn();
    worker = spawned;
    spawned.addEventListener('message', (event) => {
      if (worker !== spawned) return;
      const data = event.data ?? {};
      const waiting = pending.get(data.id);
      if (!waiting) return;
      if (data.kind !== LIBRARY_ASK) { retire(new Error(`library worker answered with a "${String(data.kind)}" reply`)); return; }
      if (data.ok === true && ANSWER_SHAPE[waiting.what](data.result)) { settle(data.id, 'resolve', data.result); return; }
      if (data.ok === false && typeof data.error?.message === 'string') {
        retire(Object.assign(new Error(data.error.message), { name: data.error.name }));
        return;
      }
      retire(new Error('library worker sent a malformed reply'));
    });
    spawned.addEventListener('messageerror', () => {
      if (worker !== spawned) return;
      retire(new Error('library worker sent a reply that could not be read'));
    });
    spawned.addEventListener('error', (event) => {
      if (worker !== spawned) return;
      event?.preventDefault?.();
      retire(new Error(`library worker failed: ${event?.message ?? 'unknown'}`));
    });
    return spawned;
  };

  const ask = (what) => {
    if (cached.has(what)) return cached.get(what);
    const id = nextId++;
    const answer = new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        if (pending.has(id)) retire(new Error(`the algorithm library did not answer within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      pending.set(id, { what, resolve, reject, timer });
      try {
        attach().postMessage({ kind: LIBRARY_ASK, id, ask: what });
      } catch (cause) {
        retire(new Error(`library worker could not be reached: ${cause?.message ?? cause}`, { cause }));
      }
    });
    cached.set(what, answer);
    // A failure is said to the caller and forgotten here, so the next question asks again.
    answer.catch(() => { if (cached.get(what) === answer) cached.delete(what); });
    return answer;
  };

  return Object.freeze({
    /** Every row, grouped for the library (`catalogueOf`). */
    catalogue: () => ask('catalogue'),
    /** The row ids, as a Set. */
    ids: () => ask('ids').then((list) => new Set(list)),
  });
}

/**
 * This thread, standing in for a worker where the PLATFORM HAS NONE — node's tests. Never a browser's
 * fallback: a page whose worker failed gets the failure, because reading the library here is the block this
 * module exists to remove. Messages are structured-cloned both ways, as a worker's are.
 */
export function inlineLibraryWorker(load = () => import('../alg-library.js')) {
  const listeners = { message: [], error: [], messageerror: [] };
  return {
    addEventListener: (type, fn) => listeners[type]?.push(fn),
    postMessage(message) {
      const request = structuredClone(message);
      setTimeout(async () => {
        const data = structuredClone(await answerLibrary(load, request));
        for (const fn of listeners.message) fn({ data });
      }, 0);
    },
    terminate() {},
  };
}

/** A real module worker where the platform has workers; this thread only where it has none at all. */
export const spawnLibraryWorker = () => {
  if (typeof Worker === 'undefined') return inlineLibraryWorker();
  return new Worker(new URL('./library-worker.js', import.meta.url), { type: 'module' });
};

/** The page's one library client. Nothing is spawned until the first question. */
export const library = createLibraryClient({ spawn: () => spawnLibraryWorker() });
