// The route back to a named state, from whichever source can give one — and what each source is
// allowed to CLAIM about its answer.
//
// Plan §4 of dev-docs/solve-to-state-plan.md. Three sources, three different claims, and running
// them together is the whole of this file:
//
//   | source            | length          | may claim               | available when                |
//   |-------------------|-----------------|-------------------------|-------------------------------|
//   | the exact search  | minimal         | the shortest way back   | inside the radius and budget  |
//   | a truncated solve | <= 20, usually  | a way back              | whenever the pool answers     |
//   |                   | far less        |                         |                               |
//   | the method route  | its own prefix  | a way back              | whenever the method solves    |
//
// THE FALLBACK IS A RACE BETWEEN TWO PREFIXES, NOT A SEQUENCE. The first draft of the plan took the
// app's <= 20 solution, walked its prefixes to the first one satisfying the target, and rejected the
// method route because three targets are not stage boundaries. Both halves were wrong: truncating
// on the PREDICATE needs no boundary, so the method route can be walked the same way. Measured over
// 24 pairs with work to do, one source was strictly shorter in 23 and which one split 15 to 8 — so
// neither dominates and both run.
//
// THE METHOD HALF MUST NEVER DELAY OR DISCARD THE POOL'S ANSWER. `solveByMethod` takes no budget and
// no signal, runs every stage, and throws rather than returning a partial solution. So it races: the
// pool's answer is yielded the moment it exists, the method's replaces it only if it arrives AND is
// shorter, and a method throw is absorbed exactly as `app.js` already absorbs one to keep a solution.
//
// EVERY YIELDED ROUTE IS REPLAYED FIRST. §9a's guarantee is not the exact search's alone — a prefix
// scan off by one is as wrong as a corrupted table, and it fails the same way. `verified()` below is
// the only door a route leaves by, and it asks the target's independent predicate.
//
// AND THE ONE SENTENCE THAT IS FORBIDDEN. A source that found nothing is a statement about the
// SEARCH, never about the cube. Nothing here may report that no short repair exists, because budget
// exhaustion does not establish it. `kind: 'none'` means "nothing was worked out", and the screens
// are held to that wording by their own tests.

import { applyAlg, movesOf } from './cube-pieces.js';
import { targetById } from './stage-targets.js';

/**
 * What a route is allowed to say about itself.
 *
 * `exact` is the only one that may call itself the shortest. `fallback` is an upper bound by
 * construction — measured, the pool at `solLen: 21` with no refinement returns 13 moves for a cube
 * whose six-move inverse solves it — so presenting one as a distance would be a minimality claim the
 * engine cannot make. `none` is the honest empty answer.
 */
export const ROUTE_EXACT = 'exact';
export const ROUTE_FALLBACK = 'fallback';
export const ROUTE_NONE = 'none';

/**
 * The first move-prefix of `alg` after which the target holds, or null.
 *
 * Returns the prefix ITSELF rather than an index, so the caller cannot re-derive it differently. An
 * off-by-one here would hand a child a route one move short of the target, which is exactly the
 * failure the replay exists to catch — and it does, because a short prefix does not verify.
 */
export function prefixReaching(state, alg, verify) {
  if (verify(state)) return { alg: '', moves: 0, whole: movesOf(alg).length === 0 };
  const moves = movesOf(alg);
  let cube = state;
  for (let i = 0; i < moves.length; i++) {
    cube = applyAlg(cube, moves[i]);
    if (verify(cube)) {
      return { alg: moves.slice(0, i + 1).join(' '), moves: i + 1, whole: i + 1 === moves.length };
    }
  }
  return null;
}

/** A route, or null when the replay refuses it. The ONLY constructor — see the header. */
function verified(target, state, kind, alg, extra = {}) {
  if (alg === null || alg === undefined) return null;
  if (!target.verify(applyAlg(state, alg))) return null;
  return Object.freeze({
    kind,
    alg,
    moves: movesOf(alg).length,
    /** May this length be called the shortest there is? Only the exact search's may. */
    minimal: kind === ROUTE_EXACT,
    /** Did the answer run all the way to a solved cube rather than stopping at the target?
     *  §6 requires that to be SAID — "couldn't find a short way back to the top cross; the whole
     *  cube in 18" — rather than presented as reaching the target. Overridden by `extra` below,
     *  which is where a fallback that ran to the end says so. */
    overshoot: false,
    ...extra,
  });
}

/** The empty answer. Carries WHY for a log, and nothing a screen may read as a claim. */
const nothing = (why) => Object.freeze({
  kind: ROUTE_NONE, alg: null, moves: null, minimal: false, overshoot: false, why,
});

/**
 * Every route the sources can produce, best first, as they arrive.
 *
 * An async generator, the way `solve-target.js`'s `refine` is, because the answer genuinely improves
 * over time and a screen wants to show the first one rather than wait for the best. Each yield is
 * strictly better than the last: shorter, or the same length with a stronger claim.
 *
 * `deps` are injected so this is testable without a worker, an engine or a thread:
 *   - `exact(target, state)`  → `{ alg, moves } | null`, may be async. The searcher.
 *   - `pool(state)`           → an algorithm solving the whole cube, or null. May be async.
 *   - `method(state)`         → an algorithm solving the whole cube. MAY THROW; the throw is absorbed.
 *
 * A source that is absent is simply not raced. That is how the Restore screen asks for lower bounds
 * with no fallback, and how a test isolates one source.
 */
export async function* routesToTarget(targetOrId, state, deps = {}) {
  const target = typeof targetOrId === 'string' ? targetById(targetOrId) : targetOrId;

  // Already there. Nothing to race, and an empty route must never render as a walk — which is the
  // caller's job, but saying zero here is this file's.
  if (target.verify(state)) {
    yield verified(target, state, ROUTE_EXACT, '') ?? nothing('already at the target');
    return;
  }

  // STARTED IN THE ORDER THEY COST, CONSUMED IN THE ORDER THEY FINISH.
  //
  // The exact source goes first because it is the only one that leaves this thread: it is a message
  // to a worker, and the method source below runs `solveByMethod` SYNCHRONOUSLY — 0.45 to 24 ms —
  // so building it last delayed the search request by that much for nothing.
  //
  // And they are consumed by completion, not in the order they were started. An ordered wait made a
  // finished exact answer sit behind a pending pool answer, which is the wrong way round: an exact
  // answer is minimal, so once it is accepted nothing can beat it and the loop stops there.
  const started = [];
  if (deps.exact) started.push(exactCandidate(target, state, deps.exact));
  if (deps.pool) started.push(fallbackCandidate(target, state, deps.pool, 'pool'));
  if (deps.method) started.push(fallbackCandidate(target, state, deps.method, 'method'));

  // Tagged with its index, so the settled entry can be removed without comparing promises by
  // identity — `Promise.race` hands back the value, not the promise that carried it.
  const pending = new Map(started.map((p, i) => [i, p.then((route) => ({ route, i }))]));
  let best = null;
  while (pending.size > 0) {
    const { route, i } = await Promise.race(pending.values());
    pending.delete(i);
    if (route === null || !supersedes(best, route)) continue;
    best = route;
    yield route;
    // An exact answer is minimal by construction, so nothing still running can improve on it.
    if (route.minimal) return;
  }

  if (best === null) yield nothing('no source produced a route that reaches the target');
}

/**
 * Is `route` worth yielding over `best`?
 *
 * Strictly shorter, or the same length with a stronger claim — "4 moves" becoming "4 moves, and
 * that is the shortest there is" is the whole reason the exact search is worth running once a
 * fallback has already answered. Named, so the scheduling loop above is scheduling and nothing
 * else: an audit measured that loop at a cyclomatic complexity of 17 with the ranking inline.
 */
const supersedes = (best, route) => best === null
  || route.moves < best.moves
  || (route.moves === best.moves && route.minimal && !best.minimal);

/**
 * The exact search as a candidate that never rejects.
 *
 * A REJECTION USED TO ESCAPE THE GENERATOR. Starting it with no handler until the fallbacks had
 * settled meant an early rejection was unhandled, and awaiting it afterwards threw out of
 * `routesToTarget` — so a worker that died discarded a pool answer that had already verified.
 * Reproduced. A source that fails is a source with nothing to offer, which is what `null` means.
 */
async function exactCandidate(target, state, exact) {
  try {
    const answer = await exact(target, state);
    if (answer?.alg == null) return null;
    return verified(target, state, ROUTE_EXACT, answer.alg);
  } catch {
    return null;
  }
}

/**
 * One fallback source, truncated on the predicate, as a candidate that never rejects.
 *
 * THE WHOLE BOUNDARY IS INSIDE THE TRY, including the prefix scan. It was outside, so a source
 * returning a string that is not an algorithm — one `?` is enough — threw out of `applyAlg` and
 * took every other source's answer with it. Reproduced. A method throw was already absorbed here;
 * the parse had to be too, and for the same reason.
 */
async function fallbackCandidate(target, state, source, name) {
  try {
    const whole = await source(state);
    if (typeof whole !== 'string' || whole.trim() === '') return null;
    const found = prefixReaching(state, whole, target.verify);
    if (found === null) return null;
    return verified(target, state, ROUTE_FALLBACK, found.alg, {
      // OVERSHOOT MEANS "WENT PAST THE TARGET", and reaching `solved` is arriving rather than
      // overshooting: a whole-cube solution ENDS at the solved cube, so running to the end
      // overshoots every target except that one. Without this the screen read "couldn't find a
      // short way back to the solved; the whole cube in 1", which is both wrong and not English.
      overshoot: found.whole && target.id !== 'solved',
      source: name,
    });
  } catch {
    return null;
  }
}

/** The last route the sources produce — for a caller that wants the answer rather than the story. */
export async function routeToTarget(targetOrId, state, deps = {}) {
  let last = null;
  for await (const route of routesToTarget(targetOrId, state, deps)) last = route;
  return last;
}
