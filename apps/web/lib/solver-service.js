// The solvers, loaded and warmed: cubejs (the independent oracle and facelet parser), the two-phase
// worker pool, the stage engine's worker door (`stageAsk`), and the pre-built cross table.
//
// Lifted out of app.js on 2026-09-13, when that file was split into modules.

import { createParallelSolveClient, createSolveClient, spawnSolveWorker } from './solve-client.js';
import { LOOSEST_BOUND, VIEW_COUNT } from './solver-engine.js';
import { loadIndex, NO_CHALLENGES } from './optimal-challenges.js';
import { warmCross } from './method-solver.js';
import { toMethodFrame } from './solving-hold.js';

import { SOLVED } from './app-state.js';
import { settings } from './app-settings.js';

// ---- solver pipeline (cubejs oracle + the two-phase engine in a worker), lazy-loaded ----------
export let Cube = null, solverReady = false;
/** States whose minimum is already PROVED, by facelets. Empty until the solver loads, and empty
 *  forever if the library did not validate — both of which a lookup answers with a miss. */
export let challenges = NO_CHALLENGES;
const invMove = (m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : m + "'");
/** An alg undone: the same turns, backwards, each reversed. The ONE place that rule is written.
 *  It is an involution on every move form (R->R'->R, R2->R2, R'->R->R'), which is what lets the
 *  same function turn a solution into a setup alg and a setup alg back into a solution. */
export const invertAlg = (a) => (String(a).trim() ? String(a).trim().split(/\s+/).reverse().map(invMove).join(' ') : '');

// Single-flight: boot and an async screen mount both call this, and two callers racing on `Cube`
// would each import and each publish. The in-flight promise is shared; a failure clears it so a
// later call can retry rather than being stuck with a rejected one.
//
// `Cube.initSolver()` USED TO BE HERE, right after first paint, and it was the largest block the
// app took at boot — two to four times that on a phone (dev-docs/deferred-plans-2026-09-05.md §1).
// Measured in WebKit on 2026-09-05, ten boots each, as the longest gap between two consecutive
// 4 ms timer callbacks installed before any page script (the main thread cannot run one while it
// is blocked, so the gap IS the block): median 723 ms and worst 793 ms with it, median 40 ms and
// worst 59 ms without. What remains is the renderer's first WebGL build, which is present in both
// and is a different item.
//
// It built cubejs's Kociemba tables, and the ONLY thing on this thread that ever needed them was
// `cube.solve()` in deriveCube — a search for an answer the worker pool produces anyway, and
// whose inverse IS the setup alg (takeSetupAlg). Nothing else cubejs does here needs a table:
// parsing a facelet string, applying moves, asking whether a state is solved and judging a state
// legal are all arithmetic. So the tables are gone from this thread entirely, and the engine's
// own live in the pool's workers, where a user is not waiting behind them (removed 2026-09-05).
let solverLoading = null;
export async function loadSolver() {
  if (solverReady) return true;
  solverLoading ??= (async () => {
    try {
      Cube = (await import('../vendor/cubejs.js')).default;
      solverReady = true;
      // The proven library rides ALONGSIDE, never in front. It needs the same oracle and it is
      // what lets a known state answer with no search at all — but it is an optimisation, and
      // awaiting it here made it a dependency: a fetch that never settles would have left
      // solverReady false forever and every solve waiting on it, which is the exact opposite
      // of the "costs performance, never correctness" this comment used to claim. Un-awaited,
      // a slow library only means the first few solves search as they always did.
      //
      // Its failure is loud but never fatal, and a library that will not validate must yield
      // NO claim rather than a plausible one — which is what dropping the whole index achieves.
      // loadIndex, not a promise chain assembled here: both failure kinds — a library that will
      // not load and one that will not validate — leave through its single door, so there is no
      // arrangement of .then/.catch for this call site to get subtly wrong.
      void loadIndex({
        Cube,
        onError: (err) => console.error(
          'optimal-challenges: the proven library did not load; every state will be searched', err,
        ),
      }).then((index) => { challenges = index; });
      return true;
    } catch (err) {
      // Loud. This was an empty catch, and its silence was the whole defect: the die became a
      // no-op, `loadWalk` blamed the CUBE ("could not work it out") for a failure of the APP, and
      // the Timer sat on "solver loading…" forever behind a retry that could never fire. A
      // console line is the least a developer needs; the screens now say the other half in words
      // a user can act on (found by audit, 2026-09-04).
      console.error('the solver did not load — solving, scrambles and the die are unavailable', err);
      solverLoading = null;
      return false;
    }
  })();
  return solverLoading;
}

// The solver worker, made once and kept. Building the engine's pruning tables costs ~0.5-2.6 s
// (dev-docs/solver-move-count.md §7), so a client per solve would pay it every time.
let solveClient = null;
/**
 * The solver, on as many threads as this page is allowed and can use.
 *
 * Parallel needs SharedArrayBuffer, and not for the answer — for the STOP. A search is
 * synchronous, so a worker that cannot possibly win still runs to its budget unless something
 * reaches inside it, and waiting for those would cost more than the parallelism wins. Without
 * isolation this is one worker searching every view, which is exactly what it was before.
 *
 * ONE WORKER PER VIEW, and that was measured rather than guessed. Three workers with two views
 * each barely moved the tail — p95 302 ms to 313 ms, which is nothing — because the hard cubes
 * are hard in ONE view, so a slice holding the expensive view is still doing all the work. One
 * view each is the finest split this design allows and it is the one that pays: on 90 random
 * cubes, p95 665 ms to 325 ms and worst 960 ms to 339 ms. The plan warned about exactly this,
 * quoting the Rust prover's note that two-move roots collapsed to 3 of 20 cores.
 *
 * Capped by the cores actually present, less two for the camera and the renderer — the same
 * reasoning as the scanner's thread count, and what keeps a four-core phone from starting a
 * worker per view when there are no cores to run them on. Until 2026-09-05 the cap was also
 * about memory, because every worker built its own 9.82 MiB of tables; that half is gone — one
 * worker builds and the rest adopt views of the same bytes (`shareTables` below) — and the cap
 * stands on the cores alone.
 */
const SOLVER_WORKERS = Math.max(1, Math.min(VIEW_COUNT, (globalThis.navigator?.hardwareConcurrency ?? 4) - 2));
export const solverWorker = () => (solveClient ??= (() => {
  const isolated = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
  // `Worker` absent means every "worker" is this thread. Six of those is six sequential searches
  // blocking the page with a sixth of the budget each — strictly worse than one searching every
  // view, and the pool's stop cannot help because nothing runs concurrently to be stopped.
  const threaded = typeof Worker === 'function';
  if (!isolated || !threaded || SOLVER_WORKERS < 2) return createSolveClient({ spawn: spawnSolveWorker });
  return createParallelSolveClient({
    spawn: spawnSolveWorker,
    workers: SOLVER_WORKERS,
    viewCount: VIEW_COUNT,
    // A fresh word per solve, not one for the client's lifetime: overlapping solves would
    // otherwise publish each other's depths into the same channel.
    makeShared: () => new Int32Array(new SharedArrayBuffer(4)),
    // Build once and publish (2026-09-05, dev-docs/deferred-plans-2026-09-05.md §2). Every worker
    // used to build the engine's eleven tables itself — 9.82 MiB and 0.4-2.6 s each — so a cold
    // session paid six builds and then carried six identical copies. One worker builds into a
    // SharedArrayBuffer now and the rest adopt views of it; the pool owns the handshake, and this
    // thread only says that this page is allowed to have one. It is passed HERE and not to
    // `createSolveClient` above because it needs the same isolation the stop word does, and this
    // is the branch that already established the page has it.
    shareTables: true,
  });
})());

/**
 * The repair, asked of the solver pool — never of this thread.
 *
 * §8 is not negotiable and was measured: zero searches on the UI thread, and a table build of a
 * few hundred milliseconds is exactly the 723 ms block that was removed from `loadSolver`. The
 * seven distance tables cost 460 ms cold and about 18 MiB steady, so they live on one worker of
 * the pool and this function is the only door to them.
 *
 * Returns null rather than throwing on every way the pool can be unavailable — no worker, a
 * cancelled client, an inline fallback that has no `stageRoute`. A screen that cannot get a
 * number shows a dash, which is a state it already has; a screen that gets an exception shows
 * nothing at all.
 */
export async function stageAsk(payload) {
  try {
    const client = solverWorker();
    if (typeof client?.stageRoute !== 'function') return null;
    // THE ENGINE'S CROSS IS ON D, AND THE METHOD'S CROSS IS WHITE (ADR 0003). Every caller hands
    // over the cube as the app holds it — the scan frame, where D is yellow — and this door turns
    // it, so no caller can ask about the yellow cross by forgetting to. A reply's `alg` is therefore
    // in the METHOD frame; `lastRoute` is its one reader and renames it back. A move COUNT is the
    // same in every frame, which is all the chips and the live line read.
    const reply = await client.stageRoute({ ...payload, facelets: toMethodFrame(payload.facelets) });
    return reply?.ok === true ? reply : null;
  } catch (err) {
    // A repair nobody can compute is not an error worth a banner: the chip says so in its own
    // words. Logged, because a pool that cannot answer at all is worth knowing about.
    console.warn('stage route unavailable', err);
    return null;
  }
}

/**
 * The budget a Restore chip is allowed, as against the cube screen's.
 *
 * SIX CHIPS AT THE FULL BUDGET IS TWELVE SECONDS OF WORKER TIME on a scrambled cube, arriving
 * exactly when the user is about to press "Solve this cube" and needs that same pool. So the chips
 * get a tenth of it: measured over plan §7.2's corpus, 400,000 nodes answers 99% of "a stage was
 * finished and then broken by a few turns" and 98% of "a real algorithm with the wrong AUF" —
 * which is the population a child hands over. Anything deeper stays a labelled bound, and pressing
 * the chip runs the full search on the cube screen.
 */
export const CHIP_NODE_BUDGET = 400_000;

let solverWarmed = false;
/**
 * Build the pool's pruning tables before a user is waiting on them.
 *
 * They are built lazily — 0.5-2.6 s (dev-docs/solver-move-count.md §7) — so without this the
 * FIRST solve of a session is the thing that pays, on screens that had seconds of warning.
 * Since 2026-09-05 the first request through the pool also runs the table handshake: one worker
 * builds into a SharedArrayBuffer and the other five adopt views of it, so a session pays for
 * ONE build here instead of six concurrent ones. Measured in WebKit on this machine, this call:
 * 720 ms before, 425 ms after — and the gap is contention rather than five sixths of the work,
 * because six builds on six threads never cost six times one.
 *
 * The warm request is a SOLVED cube: every view answers it at depth 0, so the table build is
 * the whole of what it costs. Measured on this engine: 652 ms cold, 0 ms warm, 1 ms for six
 * slices warm. The budget is 1,000 nodes per slice rather than a token amount because
 * `shareBudget` drops a zero share — a budget under the worker count would warm only some of
 * them, which is the quiet half-fix this exists to avoid.
 *
 * Fire-and-forget by design, and never awaited: nothing the user asked for is waiting on it,
 * and the real solve behind it surfaces its own failures. Same shape as `warmRoller`, and
 * called from the same kind of place — a screen that knows a solve is coming, never a session
 * that opens neither.
 */
export function warmSolver() {
  // BEFORE the early return, and that is the whole point. `solverWarmed` is about the two-phase
  // worker, which only ever needs warming once; the cross table is about a RUNG, and a learner who
  // was on rung 0 the first time this ran and has since been offered rung 1 would otherwise never
  // warm it — the early return swallowed the call, and the first lesson at the new rung paid the
  // 804 ms this function exists to move. Found in verification, 2026-09-09.
  warmCrossTable();
  if (solverWarmed) return;
  solverWarmed = true;
  try {
    void solverWorker()
      .solve(SOLVED, { solLen: LOOSEST_BOUND, probeMax: 1000 * VIEW_COUNT })
      .catch(() => {});
  } catch {
    // A client that cannot even be constructed is the real solve's problem to report, loudly,
    // where a user is actually waiting. Warming must never be the thing that breaks a screen.
  }
}

/**
 * Build the whole-cross distance table off the critical path, if this learner will need it.
 *
 * Cross rung 1 solves the cross by descending an exact BFS distance table over 24^4 = 331,776
 * codes, built lazily on first use. **Measured 2026-09-09: the first lesson at that rung costs
 * 804 ms against 97 ms warm** — the table is nearly the whole of it. That happens on the main
 * thread, inside `lessonFor`, during the "working…" a learner is already watching, so it is a
 * slower wait rather than a frozen screen; it is still most of a second nobody needs to spend.
 *
 * Only when the rung is actually in play: a learner on rung 0 never touches the table, and
 * building it for them would be paying the cost to avoid it.
 *
 * **It is still main-thread work, and now it is main-thread work IN SLICES.** `setTimeout(0)`
 * deferred the build to a later turn of the event loop and left it a single 114 ms task there —
 * so the turn that triggered the warm completed and the next one froze instead. `warmCross` now
 * expands a bounded number of positions per slice and yields between them, so the browser gets its
 * turn back regularly and the build competes with rendering rather than blocking it.
 *
 * Moving it off the thread entirely still means a worker, and the solver is synchronous by design
 * (`stage.run` has nowhere to await), so that is a larger change than this warm-up is. What is
 * bought here is that no single task is long. The cost is still paid once per session, and only by
 * a learner on the rung that needs it. A failure here is never allowed to break a screen, same as
 * above.
 */
function warmCrossTable() {
  if (crossTableWarmed || (settings.rungs?.cross ?? 0) < 1) return;
  crossTableWarmed = true;
  // `setTimeout`, not a microtask: a microtask runs before the browser gets its turn at all, so
  // the first slice would land inside the turn that triggered the warm. The slices after it yield
  // on their own.
  setTimeout(() => {
    void Promise.resolve()
      .then(() => warmCross())
      .catch((err) => {
        console.warn('cross table warm-up failed; the first lesson will build it', err);
      });
  }, 0);
}
let crossTableWarmed = false;
