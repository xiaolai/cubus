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
// The one tokenizer. A stage reply carries an algorithm AND its length, and they are checked
// against each other with the same function the walk will count with — `cube-pieces.js` exists so
// that "what counts as a move" has one answer.
import { movesOf } from './cube-pieces.js';
import { OFFERED_TARGETS } from './stage-targets.js';

/** How a whole client is abandoned. The solver cannot be interrupted between messages — it is a
 *  synchronous search loop — so the only way to stop one already running with nothing shared is
 *  to end the thread it is on. That costs the table build (~0.5-2.6 s) on the next search, which
 *  is the right trade for a deliberate teardown.
 *
 *  A single SEARCH is stopped by STOP_NOW below instead, which costs nothing at all. */
const CANCELLED = 'solve cancelled';

/**
 * The stop word's "give up, whatever you are doing" value.
 *
 * Word 0 normally holds the shallowest phase-1 depth a sibling has already answered at, and a
 * worker stops when that is STRICTLY shallower than the depth it is exploring. -1 is shallower
 * than every real depth, so it needs no second channel, no message the worker cannot read
 * mid-search, and no terminate: the next poll — ~1 ms of search — sees it, the search returns
 * null, and the thread keeps its tables for the next cube.
 *
 * It is also lower than any depth a winner can publish, so a late compare-exchange from a
 * sibling's reply cannot overwrite it and quietly un-cancel the solve.
 */
export const STOP_NOW = -1;

/**
 * The worker's stop rule, as a function rather than as a closure inside solve-worker.js.
 *
 * Strictness is the whole of it: `<` and not `<=`. At the SAME depth a lower view index still
 * wins, so a worker that gave up there would change which answer comes back and the pooled
 * result would stop being deterministic. `depth >= 0` is the other half — -1 means "no depth
 * applies" (solveIntoG1, or a finished loop), and a stop decision about no depth is a decision
 * about nothing.
 *
 * Exported so it can be unit-tested at all: inside the worker it runs only on a thread no test
 * process has, and the two ways it can be wrong — the wrong comparison, and reading a depth that
 * means nothing — are both invisible from outside (a search that stops early still returns a
 * valid answer, just not the same one).
 */
export const shouldStop = (word, depth) =>
  word !== null && word !== undefined && depth >= 0 && Atomics.load(word, 0) < depth;

/**
 * The WRITER half of the same word, and `shouldStop`'s mirror: publish `depth` if — and only if —
 * it is strictly shallower than what is already there.
 *
 * The compare-exchange loop is what makes it atomic under six writers: a plain read-then-write
 * could interleave with a shallower publication and put the deeper depth back, which would let a
 * sibling that could still win stop searching. The retry re-reads the value the exchange saw
 * rather than starting again, so the loop terminates after at most one turn per competing writer.
 *
 * Strictly shallower, never `<=`, for exactly `shouldStop`'s reason: at the same depth a lower
 * view index still wins, and stopping those siblings would change which answer comes back.
 * STOP_NOW is -1 and so is shallower than every real depth — a late publication cannot overwrite
 * it and quietly un-cancel a solve.
 *
 * Extracted from `pooled` and exported for the same reason `shouldStop` is (2026-09-05 audit,
 * refactoring debt): a wrong comparison here is invisible from outside — every answer is still a
 * valid solution, just not deterministically the same one.
 */
export function publishBest(word, depth) {
  if (word === null || word === undefined || !Number.isInteger(depth) || depth < 0) return false;
  let seen = Atomics.load(word, 0);
  while (depth < seen) {
    const prev = Atomics.compareExchange(word, 0, seen, depth);
    if (prev === seen) return true;
    seen = prev;
  }
  return false;
}

/**
 * Relay one solve's abort onto a controller of its own, and hand back the way to unsubscribe.
 *
 * A pool cancels its siblings for two different reasons — the caller stopped caring, and one
 * slice failed — and both go through ONE controller so a stop is scoped to this solve's request
 * ids rather than to a client (which is shared with overlapping solves). The release is not
 * optional bookkeeping: a long-lived signal outliving its solve would otherwise accumulate one
 * listener per search, each holding that search's closure.
 */
function relayAbort(signal) {
  const controller = new AbortController();
  const relay = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', relay, { once: true });
  }
  return { controller, release: () => signal?.removeEventListener('abort', relay) };
}

/**
 * A resume point as this side will treat it: an object, or nothing at all.
 *
 * Everything that arrives from the other thread is untrusted, and this is the cheap half of that —
 * anything that is not an object cannot be a resume point, so it becomes null and the next attempt
 * simply starts over, which is always correct. The expensive half, the key check, is the engine's:
 * a point that LOOKS right and belongs to another search must throw, not restart.
 */
const plainState = (value) => (value !== null && typeof value === 'object' ? value : null);

/**
 * One request, one reply — shared by the real worker and the inline fallback so the two
 * protocols cannot drift. Tagged with `ok` so an empty error message cannot read as success,
 * which is exactly what `if (error)` once made of it.
 *
 * `request.resume` is null for an ordinary search and `{ state }` for a resumable one — the
 * CARRIER shape rather than the bare state, because a fresh resumable search and a search that is
 * not resumable at all would otherwise both be `null` on the wire and this side could not tell
 * them apart. With no carrier the engine is driven exactly as it always was.
 */
export function handleSolveRequest(solve, request, readStats = () => ({})) {
  const { id, facelets, solLen, probeMax, views = null, resume = null } = request ?? {};
  try {
    const carrier = resume ? { state: plainState(resume.state) } : null;
    const alg = solve(facelets, { solLen, probeMax, views, resume: carrier });
    // `depth` and `view` are the sort key a parallel caller needs and a single-worker caller
    // ignores. They are the engine's own: the phase-1 depth the answer was found at and the
    // index of the view that found it — which is exactly the order the sequential search
    // explores in, so the minimum across slices IS the sequential answer.
    const { depth = -1, view = -1 } = readStats() ?? {};
    return { id, ok: true, alg, depth, view, resume: carrier ? carrier.state : null };
  } catch (err) {
    return { id, ok: false, error: errorText(err) };
  }
}

/**
 * The other half of the worker protocol: build the engine's tables, or take another thread's.
 *
 * Here rather than in solve-worker.js for the same reason `handleSolveRequest` is — that file runs
 * only on a thread no test process has, so anything with a decision in it lives on this side of
 * the boundary where `node --test` can drive it against the real engine.
 *
 * `PREPARE_TABLES` builds once into a SharedArrayBuffer and returns descriptors; `ADOPT_TABLES`
 * takes them. Both answer in the same tagged `{ok}` shape as a solve, so one listener and one
 * error rule cover every reply the worker can send.
 */
export const PREPARE_TABLES = 'prepare-tables';
export const ADOPT_TABLES = 'adopt-tables';
/**
 * The repair request: how far is this cube from a named state, and what is the shortest way back.
 *
 * WHY IT IS A REQUEST KIND ON THIS POOL RATHER THAN A WORKER OF ITS OWN, decided by plan §7.6's
 * measurement rather than by argument. The two costs were:
 *
 *   sharing   a repair queues behind a running solve, because `createParallelSolveClient` splits
 *             ONE cube across every worker — the views are slices of the same search, so while a
 *             solve runs there is no idle thread to take. Measured over 13 cubes (the frozen
 *             30-turn rows plus the release-gate fixtures): p50 317 ms, p95 1,573 ms,
 *             single-threaded, which is an UPPER bound on the real wait since the shipped pool
 *             searches one cube on up to six threads.
 *   a worker  ~14 MiB steady and a ~23 MiB peak for the seven distance tables, measured after a
 *             forced collection — plus a thread, and a second cancellation word, and a second
 *             stats channel.
 *
 * A second and a half of waiting, on a screen that already has instant lower bounds to show, is
 * cheaper than 14 MiB and a duplicate of every mechanism this file already has. So it goes here,
 * and it goes to ONE client — `clients[0]` — because the tables are per-thread: routing it round
 * the pool would build them six times over for a question only ever asked once at a time.
 */
export const SOLVE_TO_STATE = 'solve-to-state';

/** The tag every stage reply carries. Checked on arrival — see `stageRequest`. */
const STAGE_REPLY = 'stage';

/** One face turn: a face letter and an optional modifier. The app's whole move vocabulary. */
const MOVE_TOKEN = /^[URFDLB][2']?$/;
/** The largest value a max over the projection tables can take — the largest diameter is 8. */
const MAX_BOUND = 8;
/**
 * The targets a bounds reply must carry, sorted — every one, and nothing else.
 *
 * Read from `stage-targets.js` rather than typed, so adding a chip cannot leave this behind. That
 * module is pure data with no tables and no search, which is what makes it safe to import into the
 * client both threads load.
 */
const BOUNDED_TARGET_IDS = OFFERED_TARGETS.map((t) => t.id).sort();

/**
 * A stage reply, or a throw.
 *
 * WHY A REPLY NEEDS VALIDATING AT ALL, when the control channel already checks `ok`. Because `ok`
 * is a tag on the ENVELOPE and says nothing about what is inside it. A worker that does not know
 * this request kind can answer `{ ok: true, alg: '…' }` — the inline fallback did exactly that,
 * treating a repair as an ordinary two-phase solve and returning a WHOLE-CUBE solution. Every
 * downstream check then passed: the algorithm is real, it replays correctly, and it reaches the
 * target (solved is inside every target), so it was accepted as an EXACT answer and the screen
 * would have said "the shortest way back — 18 moves" about a whole-cube solve. A false minimality
 * claim, from a reply nobody checked the shape of. Found by an audit; reproduced.
 */
function stageReply(reply, want, target) {
  if (reply?.kind !== STAGE_REPLY) {
    throw new Error(`stage route: the worker answered with "${String(reply?.kind)}" rather than a repair`);
  }
  if (reply.want !== want) {
    throw new Error(`stage route: asked for "${want}" and was answered "${String(reply.want)}"`);
  }
  return want === 'bounds' ? boundsReply(reply) : routeReply(reply, target);
}

/**
 * A bounds reply: THE EXACT SET of offered targets, each a distance a cube can actually be at.
 *
 * Checking only the values that happen to be present let an empty object, an unknown key, an array
 * and a distance of 999 all through. The missing key is the quiet one: that chip silently loses its
 * search and sits on its waiting state for ever.
 */
function boundsReply(reply) {
  const bounds = reply.bounds;
  if (bounds === null || typeof bounds !== 'object' || Array.isArray(bounds)) {
    throw new Error('stage route: a bounds reply carries no bounds');
  }
  const expected = BOUNDED_TARGET_IDS;
  const got = Object.keys(bounds).sort();
  if (got.length !== expected.length || got.some((id, i) => id !== expected[i])) {
    throw new Error(`stage route: bounds for ${got.join(', ') || '(nothing)'} — expected ${expected.join(', ')}`);
  }
  for (const [id, d] of Object.entries(bounds)) {
    // The largest projection diameter is 8, so a max over them cannot exceed it. A bound past that
    // is a corrupted table or a worker answering a different question.
    if (!Number.isInteger(d) || d < 0 || d > MAX_BOUND) {
      throw new Error(`stage route: "${id}" came back as ${String(d)}, which is not a distance`);
    }
  }
  return reply;
}

/**
 * A route reply: about the target that was asked, and either an exact answer or a refusal.
 *
 * EXACTNESS IS PART OF THE ANSWER, and leaving it unchecked was the same defect twice.
 * `{ alg: 'R R R', moves: 3, exact: false }` passed, and `stage-route.js` labels anything from the
 * exact source `minimal: true` — so a three-move route to a target one move away would have been
 * called the shortest there is. Reproduced by an audit.
 */
function routeReply(reply, target) {
  if (reply.target !== target) {
    throw new Error(`stage route: asked about "${target}" and was answered about "${String(reply.target)}"`);
  }
  if (reply.alg === null && reply.moves === null) {
    if (reply.exact !== false) throw new Error('stage route: a refusal must say it is not exact');
    return reply;
  }
  if (typeof reply.alg !== 'string' || !Number.isInteger(reply.moves) || reply.moves < 0) {
    throw new Error('stage route: the reply is neither an answer nor a refusal');
  }
  if (reply.exact !== true) {
    throw new Error('stage route: an answer that does not claim exactness cannot be used as one');
  }
  // AND THE ALGORITHM MUST BE ONE. `movesOf` counts whitespace-separated tokens and validates
  // nothing, so `{ alg: '?', moves: 1 }` agreed with itself perfectly — and the Restore chip prints
  // that count with no replay behind it, which is the one path where a bogus answer is not caught
  // downstream.
  const tokens = movesOf(reply.alg);
  if (!tokens.every((m) => MOVE_TOKEN.test(m))) {
    throw new Error(`stage route: "${reply.alg}" is not a sequence of face turns`);
  }
  // AND THE COUNT MUST BE THE ALGORITHM'S. A screen shows the count while a child follows the
  // moves; a mismatch is the two disagreeing in front of them. `movesOf` is the app's one
  // tokenizer, so this cannot drift from what the walk will count.
  if (reply.moves !== tokens.length) {
    throw new Error(`stage route: the reply says ${reply.moves} moves and carries ${tokens.length}`);
  }
  return reply;
}

/**
 * Send one stage request on `client`, and believe the answer only if it is one.
 *
 * PROTOCOL FIELDS ARE ASSIGNED LAST. `{ kind, ...payload }` let a caller's payload overwrite the
 * request kind, and `control`'s `{ id, ...message }` let it overwrite the generated id — passing
 * `id: 77` posted 77 while the pending map held 1, so the reply was discarded and the promise never
 * settled. Reproduced by an audit. The whitelist below is the other half: only these fields cross.
 *
 * A REPAIR IS CALLED OFF THE WAY A SOLVE IS. `shared` is this request's stop word — the client's,
 * handed in by a pool that can make one, and never read off the payload — and `payload.signal`
 * aborting writes STOP_NOW into it. The worker's search sees that at its next poll and refuses with
 * `why: 'stopped'`, keeping its thread and its tables, and the reply settles this request like any
 * other. With no word an abort changes nothing and the search runs out its budget; the thread is
 * never ended for it, because it is also the thread of a pooled solve's first slice.
 */
async function stageRequest(client, payload = {}, shared = null) {
  const worker = client.ensureWorker?.();
  // §8 IS NOT NEGOTIABLE: no search and no distance table on the UI thread. `spawnSolveWorker`
  // answers with a main-thread worker where it cannot build a real one, and a repair on one of
  // those is a two-second block of the page — measured at 2.3 s for a request that should be a
  // table read. Refused here rather than sent, so a page with no `Worker` shows dashes and the
  // offer to solve the whole cube, which is a state the screens already have.
  if (worker?.inline === true) {
    throw new Error('stage route: this page has no worker, and a repair may not run on the UI thread');
  }
  const {
    want = 'route', target = null, facelets = null, nodeBudget, maxDepth, signal = null,
  } = payload;
  // Hung on the caller's signal only while the request is out, and taken off however it settles:
  // a screen's signal outlives every request it makes, and a listener left on it holds a word.
  const stop = () => Atomics.store(shared, 0, STOP_NOW);
  const listening = shared !== null && signal !== null;
  if (listening) {
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  }
  try {
    const reply = await client.control({
      shared: stopDescriptor(shared),
      want, target, facelets, nodeBudget, maxDepth, kind: SOLVE_TO_STATE,
    });
    return stageReply(reply, want, target);
  } finally {
    if (listening) signal.removeEventListener('abort', stop);
  }
}

/**
 * The repair, on the worker's side of the boundary.
 *
 * `engine` is injected for exactly the reason `solve` is in `handleSolveRequest`: this runs only on
 * a thread `node --test` cannot drive, so everything with a decision in it lives on this side where
 * a test can hand in a fake and check what comes back.
 *
 * Two shapes, because plan §3's split runs all the way out to the wire. `bounds` is a table read
 * per offered target and is instant; `route` is a budgeted search and is not. A caller that wants a
 * chip row asks for the first, and a caller that wants a walk asks for the second — never both in
 * one message, so nothing can present a bound as an answer by accident.
 *
 * A route request may carry a stop word (`shared`, see `stageRequest`), and the search is handed a
 * `stop` that READS it at every poll: the thread that asked writes it while this search runs, so a
 * value read once at the start would stop nothing. No word, no stop, and no poll.
 */
export function handleStageRequest(engine, request) {
  const {
    id, target, facelets, nodeBudget, maxDepth, want = 'route', shared = null,
  } = request ?? {};
  try {
    const state = engine.parseFacelets(facelets);
    // A cube the app could not parse is not a search that failed — it is a question that cannot be
    // asked. Said as an error rather than as a null answer, because a null answer means "the
    // search found nothing", and those must never be the same reply.
    if (state === null) return { id, ok: false, error: 'stage route: that is not a cube this app can read' };
    if (want === 'bounds') {
      return { id, ok: true, kind: STAGE_REPLY, want, bounds: engine.lowerBounds(state) };
    }
    const word = stopWord(shared);
    const stop = word === null ? null : () => Atomics.load(word, 0) === STOP_NOW;
    const got = engine.solveToState(target, state, { nodeBudget, maxDepth, stop });
    return { id, ok: true, kind: STAGE_REPLY, want, target, ...got };
  } catch (err) {
    return { id, ok: false, error: errorText(err) };
  }
}

export function handleTableRequest(engine, request) {
  const { id, kind } = request ?? {};
  try {
    if (kind === PREPARE_TABLES) return { id, ok: true, kind: 'tables', tables: engine.shareTables() };
    if (kind === ADOPT_TABLES) {
      engine.initialize({ adopt: request.tables });
      return { id, ok: true, kind: 'adopted' };
    }
    return { id, ok: false, error: `solver worker was sent an unknown control request "${String(kind)}"` };
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
 * A failure of the WORKER, not of the search.
 *
 * The distinction is what makes a retry safe. A thread that could not be created, or that died,
 * says nothing about the cube — the same question asked on fewer threads can still be answered.
 * An engine-level refusal (a malformed cube, a bound out of range) would fail identically the
 * second time and cost the user twice the wait for it, so the pool must never retry one.
 */
const workerFailure = (message, cause) =>
  Object.assign(new Error(message), { workerFailure: true, cause });

export const isWorkerFailure = (err) => err?.workerFailure === true;

/**
 * @param {() => Worker} spawn  makes a fresh worker. Injected so tests can supply a fake.
 * @param {(() => Int32Array)|null} [makeShared]  makes a stop word for a repair that can be called
 *   off and was handed none: a lone client's, on a page that can share memory. Without it such a
 *   repair cannot be called off.
 */
export function createSolveClient({ spawn, makeShared = null } = {}) {
  if (typeof spawn !== 'function') throw new TypeError('createSolveClient needs a spawn function');

  let worker = null;
  let nextId = 1;
  const pending = new Map();

  const attach = () => {
    if (worker) return worker;
    // A spawn that throws is a WORKER failure, tagged so the pool can retry on fewer threads
    // rather than telling the user their cube cannot be solved. The cause is kept verbatim.
    let spawned;
    try {
      spawned = spawn();
    } catch (cause) {
      throw workerFailure(`solver worker could not be created: ${cause?.message ?? cause}`, cause);
    }
    worker = spawned;
    // Both listeners close over THIS worker and check it is still current before acting: a
    // delayed event from a replaced worker once had the power to kill its replacement's
    // requests. Stale events are dropped instead.
    spawned.addEventListener('message', (event) => {
      if (worker !== spawned) return; // a reply from a worker that was already replaced
      const data = event.data ?? {};
      const waiting = pending.get(data.id);
      if (!waiting) return; // a reply to a search that was already abandoned
      pending.delete(data.id);
      // A control reply — table sharing — carries no algorithm, so it is settled on its own tag
      // and never through the search validator below. Same `ok` rule either way: an empty error
      // string must not read as success.
      if (waiting.control) {
        if (data.ok === true) waiting.resolve(data);
        else if (data.ok === false && typeof data.error === 'string') waiting.reject(new Error(data.error));
        else waiting.reject(new Error('solver worker sent a malformed reply'));
        return;
      }
      // The reply is validated, not trusted: `ok` is the tag (an empty error string must not
      // read as success), and a success carries an algorithm string or null, nothing else.
      //
      // AND IT MUST NOT BE A CONTROL REPLY. The isolation was one-way: `stageReply` refuses a
      // solve's answer, but nothing stopped a TAGGED reply carrying a pending solve's id from
      // being read as that solve's algorithm. Unique ids make the collision unlikely rather than
      // impossible, and "unlikely" is not what the two kinds of answer being different questions
      // deserves. A worker that answers the wrong question is refused in both directions now.
      if (data.kind !== undefined) {
        waiting.reject(new Error(`solver worker answered a search with a "${String(data.kind)}" reply`));
        return;
      }
      if (data.ok === true && (typeof data.alg === 'string' || data.alg === null)) {
        // The resume point rides with THIS reply too, and is written before the promise settles —
        // a caller that awaits the answer and then reads its carrier must never see the point the
        // attempt BEFORE this one left. Only a caller that asked for one has somewhere to put it.
        if (waiting.resume) waiting.resume.state = plainState(data.resume);
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
    // A reply that could not be DESERIALISED. It arrives with no data, so there is no id to
    // match it to; the one thing known is that some search's answer was lost, and a lost answer
    // is a promise that never settles — on screen, indistinguishable from a search still going.
    // So everything in flight is failed rather than one guess at which, and it is tagged as a
    // WORKER failure so the pool retries on fewer threads instead of telling anyone their cube
    // cannot be solved. The thread is NOT ended: one message failed to cross, which says nothing
    // about the engine or its tables, and throwing away a 2.6 s table build over it would be a
    // worse answer than re-asking.
    spawned.addEventListener('messageerror', () => {
      if (worker !== spawned) return;
      const reason = workerFailure('solver worker sent a reply that could not be read');
      for (const [, waiting] of pending) waiting.reject(reason);
      pending.clear();
    });
    // A worker that dies takes every search in flight with it. Rejecting them is the only way
    // the caller finds out; leaving them pending would hang the screen with no error anywhere.
    spawned.addEventListener('error', (event) => {
      if (worker !== spawned) return; // a stale corpse must not take down its replacement
      event.preventDefault?.(); // handled here — it must not double as an uncaught page error
      spawned.terminate(); // dead to us either way; make it dead to the OS too
      const reason = workerFailure(`solver worker failed: ${event?.message ?? 'unknown'}`);
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
   * @param {AbortSignal|null} [bounds.signal]  stops THIS search and nothing else. With a stop
   *   word that is a write the running search reads at its next poll; without one, the only
   *   stop is ending the thread, which is done only when this search is the last one on it.
   * @param {{state: object|null}|null} [bounds.resume]  a carrier the CALLER owns and keeps across
   *   attempts. Its `state` goes out with the request and is replaced by whatever the worker's
   *   search left, so the next attempt continues that search instead of walking it again. Null is
   *   every caller but an escalating one; `probeMax` is then a frontier rather than an increment
   *   (dev-docs/deferred-plans-2026-09-05.md §3).
   */
  function solve(facelets, { solLen, probeMax, views = null, shared = null, detailed = false, signal = null, resume = null } = {}) {
    const id = nextId++;
    // Nothing to stop if it never starts. Checked before attach() so an already-abandoned solve
    // cannot be the thing that spawns a worker and pays for a table build.
    if (signal?.aborted) return Promise.resolve(detailed ? { alg: null, depth: -1, view: -1 } : null);
    return new Promise((resolve, reject) => {
      // attach() lives INSIDE the executor: a spawn() that throws must reject this promise,
      // not escape solve() synchronously — the function's contract is asynchronous either way.
      const active = attach();
      /**
       * Stop THIS search, by request id, and leave every other search alone.
       *
       * The scoping is the point. `cancel()` — which is what a failing sibling used to call —
       * rejects every entry on the client, and the app allows overlapping solves: a die press
       * whose thread died took the reconnect's search down with it, and that solve reported
       * "could not work it out" about a cube nothing was wrong with.
       *
       * Two shapes, because there are two situations. With a stop word the search really stops:
       * the worker sees STOP_NOW at its next poll and answers null, keeping its thread and its
       * tables, and this promise settles on that reply like any other. Without one there is no
       * channel into a synchronous search at all, so the request is abandoned here (its reply,
       * if it ever comes, is dropped by the guard in the message listener) and the thread is
       * ended only when nothing else is waiting on it — stealing a sibling's answer to hurry
       * this one would be the same bug one level down.
       */
      const abandon = () => {
        const waiting = pending.get(id);
        if (!waiting) return; // already settled, or already abandoned
        if (shared) {
          Atomics.store(shared, 0, STOP_NOW);
          return;
        }
        pending.delete(id);
        if (pending.size === 0) {
          worker?.terminate();
          worker = null;
        }
        waiting.resolve(detailed ? { alg: null, depth: -1, view: -1 } : null);
      };
      signal?.addEventListener('abort', abandon, { once: true });
      // Every exit removes the listener: a long-lived signal that outlives its solve would
      // otherwise accumulate one handler per search, each holding this promise's closure.
      const done = (settle) => (value) => {
        signal?.removeEventListener('abort', abandon);
        settle(value);
      };
      pending.set(id, { resolve: done(resolve), reject: done(reject), detailed, resume });
      try {
        // `shared` travels WITH the request, not as a one-off init message. One word per solve
        // is what keeps overlapping solves — which the app allows — from publishing each other's
        // depths into one channel and stopping the wrong cube's search. It goes as a descriptor
        // rather than a bare buffer so the offset survives the crossing; see stopDescriptor.
        //
        // The resume point goes as a fresh `{state}` and never as the caller's own carrier: the
        // carrier is a live object this client writes to, and posting it would be sending whatever
        // else is on it as well. Null is a search that is not resumable at all — which is what
        // makes it different from `{state: null}`, a resumable one that has not started yet.
        active.postMessage({
          id,
          facelets,
          solLen,
          probeMax,
          views,
          shared: stopDescriptor(shared),
          resume: resume ? { state: plainState(resume.state) } : null,
        });
      } catch (err) {
        // A synchronous send failure would otherwise leave this entry pending forever — the
        // promise would reject, but `idle` would lie and cancel() would re-reject a corpse.
        pending.delete(id);
        done(reject)(err);
      }
    });
  }

  /**
   * A control request on this client's worker — the table handshake, and the repair.
   *
   * It rides the SAME id space, the same pending map and the same listener as a search, so a
   * control reply cannot be mistaken for a search's and a worker that dies mid-handshake rejects
   * it exactly as it rejects a search. It takes no signal: preparing tables is neither long enough
   * to want stopping nor safe to abandon halfway — the reply is what the other five workers are
   * waiting for — and a repair that can be called off carries its stop word as a field of its
   * message (`stageRequest`).
   */
  function control(message) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const active = attach();
      pending.set(id, { resolve, reject, control: true });
      try {
        active.postMessage({ id, ...message });
      } catch (err) {
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

  return {
    solve,
    cancel,
    control,
    /** A repair, on this client's worker. Rides the control channel because it is not a search of
     *  the two-phase engine and must not be validated as one — `stageRequest` is what validates it
     *  instead, and what refuses to put one on a main-thread worker at all. `shared` is the stop
     *  word a pool hands a repair that can be called off; asked with none, a client that can make
     *  words makes one — fresh per repair, as a pool's is — and a client that cannot has none. */
    stageRoute: (payload, shared = null) => stageRequest(
      { ensureWorker: () => attach(), control }, payload,
      shared ?? (payload?.signal ? (makeShared?.() ?? null) : null),
    ),
    /** Make the worker now, and hand it back, so a caller can see WHAT it got before committing
     *  work to it. The pool needs exactly that: `spawnSolveWorker` answers with a main-thread
     *  worker where it cannot build a real one, and dividing a budget between several of those
     *  is strictly worse than giving one of them all of it. A spawn that throws still throws —
     *  it is the same worker failure the first solve would have raised, only earlier. */
    ensureWorker: () => attach(),
    get idle() { return pending.size === 0; },
  };
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

/**
 * Could this reply WIN — an algorithm, and a complete sort key to place it by?
 *
 * One predicate, because two places ask it and they must not answer differently (2026-09-05 audit).
 * The stop word used to be published on `typeof alg === 'string'` alone, so a reply whose VIEW was
 * malformed — a garbled `-1` where `pickWinner` requires a real index — stopped every sibling at
 * its depth and was then discarded, and the pool answered null for a cube its siblings were about
 * to solve. A reply that cannot win may not cut short the ones that can.
 */
const canWin = (r) =>
  Boolean(r) && typeof r.alg === 'string'
  && Number.isInteger(r.depth) && r.depth >= 0
  && Number.isInteger(r.view) && r.view >= 0;

/** Lowest phase-1 depth first, then lowest view index — the order the sequential engine searches
 *  in. A reply with no answer, or without a usable key, cannot win. */
export function pickWinner(replies) {
  const found = replies.filter(canWin);
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
 * sequential answers (11,1) on `RBBFUDDBBLL…` while six 500,000-node slices answer (11,2) — a
 * different algorithm of the same length — and on `FFLFURUDFUB…` sequential answers from view 0
 * where every slice misses. Even at the shipped budget a difference can be a LENGTH: one worker
 * answers `DIVERGENT_CUBES.longerInThePool` in 19 moves and the pool in 20, because the view that
 * finds 19 starves on a slice. Every answer is still a valid solution inside the bound, and
 * test/parallel-divergence.test.mjs pins each of these so nobody re-derives them.
 *
 * Requires SharedArrayBuffer — not for the answer, but for the stop. A search is synchronous, so
 * a worker that cannot possibly win still runs to its budget unless something reaches inside it,
 * and waiting for those costs more than the parallelism wins. One buffer PER SOLVE: the app
 * allows overlapping solves, and a single shared word let one cube's answer stop another cube's
 * search.
 */
export function createParallelSolveClient({ spawn, workers, viewCount, makeShared = null, shareTables = false } = {}) {
  if (typeof spawn !== 'function') throw new TypeError('createParallelSolveClient needs a spawn function');
  const slices = sliceViews(workers ?? 1, viewCount);
  const clients = slices.map(() => createSolveClient({ spawn }));
  const NO_BEST = 0x7fffffff;
  // Built only if the pool ever fails to be staffed, and kept after that: a machine that could
  // not give us six threads once will not give us six the next time either, and re-learning
  // that on every solve would cost a spawn attempt and a table build each time.
  let lone = null;
  // Off unless the caller asks. The pool is constructed in tests against fake workers that know
  // nothing of tables, and on a page without SharedArrayBuffer there is nothing to share — so the
  // capability is INJECTED like `makeShared`, never inferred here.
  let sharing = shareTables === true;
  let handshake = null;
  /**
   * How many times this pool has been torn down — the only thing a cancel that lands DURING an
   * await leaves behind (2026-09-05 audit).
   *
   * The table handshake is the long await, and a `cancel()` inside it reaches the awaiting code as
   * an ordinary rejected control request. Reading that rejection as "the tables could not be
   * shared" is what it looked like, so the solve carried on: it spawned six replacement workers,
   * searched, and RESOLVED — a cancelled pool answering a question nobody was waiting for, and
   * sharing given up for the session over a teardown that says nothing about it. A counter is
   * enough, because the question is only ever "is this still the pool I started on".
   */
  let era = 0;

  /**
   * A pool's resume point is SIX resume points, one per slice — they search different views and
   * die at different depths, so there is nothing to merge and nothing that would mean anything
   * merged. It rides in the caller's one carrier as an array aligned with the slices.
   *
   * The lone fallback searches ALL views, which is a different search with a different key, so its
   * points would be refused by the engine — loudly, and over a cube nobody could then solve. So the
   * carrier is EMPTIED at the crossing: a fallback starts over, which costs the re-walk this whole
   * mechanism exists to avoid and is the only correct thing to do with a point for another search.
   */
  const dropPooledState = (resume) => {
    if (resume && Array.isArray(resume.state)) resume.state = null;
  };

  async function solve(facelets, { solLen, probeMax = DEFAULT_NODE_BUDGET, signal = null, resume = null } = {}) {
    if (lone) {
      dropPooledState(resume);
      return lone.solve(facelets, { solLen, probeMax, signal, resume });
    }
    // The era THIS solve started in, captured before the await that a teardown lands inside.
    // `pooled` asks the same question about the handshake; the fallback below is the second place
    // a cancel can be crossed, and it was not asking (2026-09-05 audit): a worker dying and a
    // `cancel()` arriving in the same turn made a cancelled solve spawn a REPLACEMENT worker,
    // search on it and resolve — reproduced. A worker failure says nothing about whether anyone
    // is still waiting for the answer, so both have to be asked.
    const mine = era;
    try {
      return await pooled(facelets, { solLen, probeMax, signal, resume });
    } catch (err) {
      // A pool that cannot be staffed still answers. A thread that failed to spawn, or died,
      // says nothing about this cube — and one worker searching all six views under the whole
      // budget is not a degraded answer, it is the answer this app shipped before the pool
      // existed. Rejecting instead would tell a user one thread short that their cube cannot be
      // solved, which is false.
      //
      // Only for a WORKER failure. An engine-level refusal — a malformed cube, a bound out of
      // range — would fail identically on the retry and charge the user twice the wait for the
      // same "no", so it propagates untouched.
      if (!isWorkerFailure(err)) throw err;
      // A pool torn down while it was failing is still torn down. Asked BEFORE the warning as
      // well as before the fallback: a teardown is not evidence that this page cannot staff a
      // pool, and announcing a session-long downgrade over one would be the same mistake the
      // handshake's own era check exists to prevent.
      if (era !== mine) throw new Error(CANCELLED);
      console.warn(
        `solve-client: the ${clients.length}-worker pool could not run (${err.message}) — ` +
        'falling back to a single worker for the rest of this session. Searches will be slower ' +
        'in the tail; answers are unaffected.',
      );
      // Release the pool's threads — and NEVER another solve's request. `cancel()` rejects every
      // entry on a client, and the app allows overlapping solves, so this was the same defect the
      // per-request controller in `pooled` exists to prevent, one level out: the 2026-09-05 audit
      // reproduced one solve failing to spawn worker 1 and an unrelated solve on worker 0 rejecting
      // with "solve cancelled" over a cube nothing was wrong with. This solve's own requests are
      // already settled — `pooled` awaits them all before it throws — so an idle client is one
      // holding nothing, and a busy one is holding somebody else's search. The trade is that a
      // busy client keeps its thread for the session rather than being ended here; a stray thread
      // costs memory, a stolen answer costs the user their solve.
      for (const c of clients) if (c.idle) c.cancel();
      // `??=`: two overlapping solves can fall back at once, and the second assignment would
      // orphan the first one's client — still holding a search, and no longer cancellable
      // through this pool.
      lone ??= createSolveClient({ spawn });
      dropPooledState(resume);
      return lone.solve(facelets, { solLen, probeMax, signal, resume });
    }
  }

  async function pooled(facelets, { solLen, probeMax, signal, resume = null }) {
    // Nothing to staff if nobody is waiting. The single-worker client has always refused this
    // before `attach()` — the pool did not, and an abandoned solve therefore spawned six threads
    // and ran the whole 9.82 MiB table handshake before every one of its requests answered null
    // (2026-09-05 audit). A superseded solve is the ordinary case here, not the exotic one: the app
    // aborts one the moment the cube changes.
    if (signal?.aborted) return null;
    const mine = era;
    const shares = shareBudget(probeMax, clients.length);
    const used = clients.slice(0, shares.length);
    // Look at the threads BEFORE dividing a budget between them. `spawnSolveWorker` answers with
    // a main-thread worker where it cannot build a real one — no `Worker` at all, a CSP
    // forbidding worker-src, a blocked module URL — and N of those is not a pool: they run one
    // after another on this thread with a share of the budget each, which is strictly worse than
    // one of them searching every view with all of it, and the stop word buys nothing because
    // nothing runs concurrently to be stopped. Raised as a worker failure so the collapse goes
    // through the one fallback path that already exists, loudly.
    if (used.some((c) => c.ensureWorker()?.inline === true)) {
      throw workerFailure(
        'there is no real worker here, so a pool would be main-thread searches with a share of the budget each',
      );
    }
    // One build for the whole pool, before anything is asked to search. Awaited, and that is the
    // point: the first solve used to wait for six concurrent table builds anyway, and now it
    // waits for one uncontended build plus a handful of milliseconds of adoption.
    if (sharing) await shareTablesAcrossPool();
    // A cancel that landed while the handshake was in flight terminated these workers. Nothing in
    // the rejection says so — it is the same "solve cancelled" any request gets — so the era is
    // asked instead, and asked HERE, before a single replacement thread is spawned. Reproduced by
    // the 2026-09-05 audit: a cancelled pool spawned six fresh workers, searched, and resolved.
    if (era !== mine) throw new Error(CANCELLED);
    // A fresh word per solve. `makeShared` is injected so a page without SharedArrayBuffer — or
    // a test — gets a correct client that simply never stops early.
    const stop = makeShared?.() ?? null;
    if (stop) Atomics.store(stop, 0, NO_BEST);

    // The first failure cancels the siblings IMMEDIATELY, not after everyone has settled.
    // Waiting first deadlocks: a worker that died takes its promise with it, and the others are
    // still searching a cube whose answer nobody will use — `allSettled` would wait for replies
    // that are never coming. Cancelling is what makes them settle, so the order matters.
    //
    // ONE CONTROLLER FOR THIS SOLVE. It used to be `c.cancel()` per client, which rejects every
    // entry on that client — including a second, overlapping solve's, which the app allows and
    // which had nothing to do with the failure. That solve then failed with "could not work it
    // out" about a cube nothing was wrong with. Aborting is scoped by request id, and where
    // there is a stop word it is also cheaper than cancelling: the siblings stop at their next
    // poll instead of losing their threads and rebuilding their tables.
    const { controller: abandon, release } = relayAbort(signal);
    let firstError = null;
    const abandonAll = (err) => {
      if (firstError !== null) return;
      firstError = err;
      abandon.abort();
    };
    // One carrier per slice, aligned by INDEX with `slices` — which is fixed for the pool's life,
    // so slice i's point always goes back to slice i's views however many slices a budget affords.
    // A carrier that was never filled (a slice whose reply was dropped) simply keeps the point the
    // attempt before it left, which is still a valid position in that slice's enumeration.
    const carried = Array.isArray(resume?.state) ? resume.state : null;
    const carriers = resume === null ? null : used.map((_, i) => ({ state: plainState(carried?.[i]) }));
    const settled = await Promise.allSettled(used.map((client, i) =>
      client.solve(facelets, {
        solLen,
        probeMax: shares[i],
        views: slices[i],
        shared: stop,
        detailed: true,
        signal: abandon.signal,
        resume: carriers?.[i] ?? null,
      }).catch((err) => { abandonAll(err); throw err; }).then((reply) => {
        // Publish only the depth of a reply that could WIN — the same question `pickWinner` asks,
        // through the same predicate. A null reply's -1 means "no depth applies" and would read as
        // the shallowest possible; a reply with a real depth and a malformed view is worse, because
        // it stops the siblings at that depth and is then thrown away by the pick.
        if (canWin(reply)) publishBest(stop, reply.depth);
        return reply;
      }))).finally(release);

    // allSettled, not all: `all` would resolve the caller's promise while siblings were still
    // running and pending. Everyone is waited for, and the FIRST failure propagates — not a
    // cancellation caused by it, which is why abandonAll keeps the original.
    if (firstError !== null) throw firstError;
    // After everyone has settled, never as they arrive: the array IS the pool's resume point, and
    // publishing a half-written one would let a continuation resume some slices and restart others.
    if (carriers) resume.state = carriers.map((c) => c.state);
    return pickWinner(settled.map((r) => r.value));
  }

  /**
   * Build the engine's eleven tables ONCE, on the first worker, and give the rest a view of them.
   *
   * 9.82 MiB and 0.4-2.6 s per worker, six times over, was the pool paying six times for one
   * thing — and then holding six identical copies for the life of the page. The first worker
   * builds into a SharedArrayBuffer and hands back descriptors; this thread relays them and never
   * looks inside, which is what keeps the engine out of the main bundle (app.js imports this file
   * and must not import two-phase.js — the rule the VIEW_COUNT comment in solver-engine.js states
   * for one integer, and the tables are 9.82 MiB of it).
   *
   * Idempotent through `handshake`, because overlapping solves are allowed and two of them
   * arriving cold must not build twice.
   *
   * Three ways it does not happen, and each leaves a pool that still answers:
   *   * every "worker" is this thread — then there is ONE module instance and one set of tables
   *     already, so there is nothing to share and nothing lost by not sharing;
   *   * the worker cannot make a SharedArrayBuffer (no cross-origin isolation) — sharing is given
   *     up for the session, loudly and once, and every worker builds its own exactly as before;
   *   * a worker refuses the bundle — a checksum mismatch is a corrupted table set, so it is said
   *     out loud and that worker simply builds its own on its next search.
   */
  async function shareTablesAcrossPool() {
    const mine = era;
    // A main-thread "worker" is one realm: the module instance, and therefore the tables, are
    // already shared by construction. Checked before the handshake rather than after, or the
    // control message would reach `handleSolveRequest` and come back as a solver error.
    if (clients.some((c) => c.ensureWorker()?.inline === true)) {
      sharing = false;
      return;
    }
    // The attempt THIS call is waiting on, held by identity. `handshake` is module-of-the-pool
    // state that a `cancel()` clears and the next solve refills, so the failing attempt's catch
    // below must be able to tell "mine" from "somebody else's" — see there.
    const attempt = (handshake ??= (async () => {
      // The era THIS attempt opened in, asked again the moment the build comes back (2026-09-05
      // round 3). A cancel that lands while PREPARE_TABLES is in flight rejects it, which the catch
      // below already handles — but a cancel landing in the window between that reply RESOLVING and
      // this continuation running leaves nothing rejected at all: `cancel()` ends the six threads,
      // and the adoption below then asks five clients for a control request each, so `attach()`
      // spawns five REPLACEMENT workers and pushes 9.82 MiB into them for a pool nobody is waiting
      // on. Reproduced by the audit. Checked before a single adoption is issued, for the same reason
      // `pooled` checks before a single search is.
      const opened = era;
      const published = await clients[0].control({ kind: PREPARE_TABLES });
      if (era !== opened) throw new Error(CANCELLED);
      const bundle = published?.tables ?? null;
      if (!bundle) throw new Error('the solver worker published no tables');
      const refusals = await Promise.all(clients.slice(1).map((c) =>
        c.control({ kind: ADOPT_TABLES, tables: bundle }).then(() => null, (err) => err)));
      // Both outcomes are said out loud, and they are not the same thing. A REFUSAL is a table
      // set that failed its checksum — a defect, and the loudest thing here. A thread that DIED
      // says nothing about the tables; what it costs is that its replacement will never be
      // offered them, so it builds its own for the rest of the session — a slower pool, and
      // silent unless it is reported.
      for (const err of refusals) {
        if (!err) continue;
        if (isWorkerFailure(err)) {
          console.warn(
            `solve-client: a solver worker died during the table handshake (${err.message}) — ` +
            'its replacement will build its own tables. Answers are unaffected.',
          );
        } else {
          console.error(
            `solve-client: a solver worker refused the shared tables (${err.message}) — ` +
            'it will build its own. This is a corrupted or mismatched table set, not a slow one.',
          );
        }
      }
      return bundle;
    })());
    try {
      await attempt;
    } catch (err) {
      // Only MY attempt is cleared. A cancel nulls `handshake` and the very next solve puts a new
      // one there, so this catch — which runs a microtask later, when the cancelled control
      // request finally rejects — was clearing a handshake that had nothing to do with the
      // failure. Reproduced by the 2026-09-05 audit as `cancel()` then `solve()`: the replacement
      // builder was sent PREPARE_TABLES twice and every replacement adopter ADOPT_TABLES twice,
      // the whole 9.82 MiB handshake run again for nothing.
      if (handshake === attempt) handshake = null;
      // A thread that died says nothing about tables; it goes down the one fallback path the pool
      // already has, which ends with a single worker searching every view.
      if (isWorkerFailure(err)) throw err;
      // Neither does a TEARDOWN. A cancel during the handshake rejects it like anything else in
      // flight, and treating that as "this page cannot share tables" gave up 9.82 MiB per worker
      // for the session over a button press. The capability is untouched; the caller is told by
      // the era check in `pooled`.
      if (era !== mine) return;
      sharing = false;
      console.warn(
        `solve-client: the solver tables could not be shared (${err.message}) — ` +
        'each worker will build its own for the rest of this session. Answers are unaffected; ' +
        'a cold session costs one table build per worker instead of one in all.',
      );
    }
  }

  function cancel() {
    // The handshake is a fact about THESE workers, and this ends them. Keeping it made the next
    // solve skip prepare/adopt entirely: every replacement worker built its own 9.82 MiB of
    // private tables while `sharingTables` still reported the pool was on one set — a measurement
    // and a diagnostic both quietly wrong, and six table builds nobody could see (2026-09-05).
    era += 1;
    handshake = null;
    for (const c of clients) c.cancel();
    lone?.cancel();
  }

  return {
    solve,
    cancel,
    /**
     * A repair, on ONE worker of the pool.
     *
     * Always `clients[0]` — or the lone fallback where the pool gave up — because the seven
     * distance tables are per-thread and about 14 MiB steady. Dealing this round the pool the way
     * a solve's views are dealt would build them on every thread for a question asked one at a
     * time, which is the arithmetic that killed the scramble worker.
     *
     * A repair that can be called off gets a stop word of its own, fresh for the reason a solve's
     * is: two requests sharing one would stop each other. One with no signal gets none, since
     * nothing could ever write it.
     */
    stageRoute: (payload) => (lone ?? clients[0])
      .stageRoute(payload, payload?.signal ? (makeShared?.() ?? null) : null),
    // The fallback counts for both: a solve running on it is not idle, and a pool that has
    // fallen back reports the one worker it actually has rather than the six it wanted.
    get idle() { return clients.every((c) => c.idle) && (lone?.idle ?? true); },
    get workers() { return lone ? 1 : clients.length; },
    /** Whether the pool is still on one shared table set. False the moment it gave up on one,
     *  so a test — or a measurement — cannot mistake a quiet fallback for the thing it meant to
     *  measure. */
    get sharingTables() { return sharing; },
  };
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
  // The sort key, from the same place the real worker reads it. Omitting it was a silent
  // defect: a reply with depth/view -1 is REJECTED by pickWinner, so a pooled solve running on
  // inline workers could never produce a winner at all — it exhausted every budget escalation
  // and then threw. The single-worker client ignores these fields, which is why it went
  // unnoticed until rolling a scramble started going through the pool.
  let readStats = () => ({});
  let closed = false;
  const ready = (async () => {
    const [{ createSolver }, twoPhase] = await Promise.all([
      import('./solver-engine.js'),
      import('./two-phase.js'),
    ]);
    solve = createSolver(twoPhase);
    readStats = () => twoPhase.searchStats;
  })();
  return {
    /** What this IS, said out loud, because from the outside it is worker-shaped and nothing
     *  else could tell. The pool asks before it divides a budget: several of these are several
     *  main-thread searches with a share each, run one after another. */
    inline: true,
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    postMessage(request) {
      void ready.then(
        () => {
          // A terminate() that landed while the engine was still loading stops the queued
          // search from ever starting — a synchronous search cannot be interrupted, so not
          // starting it is the only cancellation this thread-less worker can honour.
          if (closed) return;
          // ONLY A SOLVE. This worker is the calling thread, and every other request kind this
          // protocol has is one that must not run here: a table handshake has nobody to share
          // with, and a repair is a search plus 18 MiB of tables on the page. Answering them as
          // if they were solves is what it used to do, and it returned a whole-cube algorithm to
          // a caller that believed it was a proved minimum. Refused by name instead.
          const { id, kind } = request ?? {};
          if (kind !== undefined) {
            listeners.get('message')?.({ data: { id, ok: false,
              error: `there is no worker here, so "${String(kind)}" cannot be served off the main thread` } });
            return;
          }
          listeners.get('message')?.({ data: handleSolveRequest(solve, request, readStats) });
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
/** Set once a module worker has proved it cannot LOAD — see below. Module state on purpose: it
 *  is a fact about this page, not about one client, and every client's spawn must learn it. */
let moduleWorkerBroken = false;

/**
 * A real worker where one can be had, and this thread where one cannot.
 *
 * THREE ways to have no worker, and they were treated as one, then as two:
 *
 *   1. `Worker` missing from the platform.
 *   2. `Worker` present but refusing to build THIS script, synchronously — a CSP that forbids
 *      worker-src, a blocked module URL, a test denying it. Only (1) fell back at first, so this
 *      reached the caller as an error and took solving down with it. Since rolling a scramble
 *      became a solve, that took the Random die down too.
 *   3. `Worker` built, and then the module fails to LOAD — a 404, a syntax error, an import the
 *      page cannot resolve. This one is ASYNCHRONOUS: the constructor has already handed back a
 *      Worker object and the failure arrives later as an `error` event, so neither of the fixes
 *      above sees it. Every spawn after it built another thread exactly as doomed, and the pool
 *      fell back to a "single worker" that could not load either.
 *
 * The distinction that makes (3) safe to remember is whether the worker ever SPOKE. A module
 * that will not load never delivers a message; a thread that answered once and then died of
 * memory pressure is not a reason to move every future search onto the main thread, and marking
 * it broken would trade one lost search for a permanently blocked page.
 *
 * Loud either way: the inline worker announces that searches now block the page.
 */
export const spawnSolveWorker = () => {
  if (moduleWorkerBroken || typeof Worker === 'undefined') return inlineWorker();
  try {
    const spawned = new Worker(new URL('./solve-worker.js', import.meta.url), { type: 'module' });
    let spoke = false;
    spawned.addEventListener('message', () => { spoke = true; }, { once: true });
    spawned.addEventListener('error', () => { if (!spoke) moduleWorkerBroken = true; }, { once: true });
    return spawned;
  } catch (cause) {
    console.warn('solve-client: the solver worker could not be built, so it runs on this thread', cause);
    moduleWorkerBroken = true;
    return inlineWorker();
  }
};

export const CANCELLED_MESSAGE = CANCELLED;
