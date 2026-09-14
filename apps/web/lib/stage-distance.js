// How far a cube is from a named state, and the shortest way back — with a guarantee that a wrong
// route cannot reach a screen.
//
// Phase C of dev-docs/solve-to-state-plan.md. `lib/stage-targets.js` says what the targets ARE;
// this module says how far away they are. Three things live here and nothing else:
//
//   the tables    one exact distance table per projection, breadth-first from its goal set, built
//                 lazily and shared between every target that reads the same projection.
//   the search    iterative-deepening A* over the projected codes, with the maximum of those tables
//                 as an admissible heuristic. The search never carries a cube: a node is between
//                 one and five integers.
//   the replay    every route is applied to the cube that was asked about and checked against the
//                 target's INDEPENDENT predicate before it is returned. Unconditional, inside the
//                 module, so no caller can skip it.
//
// A LOOKUP IS A LOWER BOUND. AN ANSWER IS A SEARCH. That distinction governs the whole file and the
// screens above it. Of the six offered targets exactly one — `cross` — is answered by a table read,
// because its whole projected space is stored and the target is exactly the preimage of its goal.
// The other five are searches, and the tables hold only lower bounds on them. Measured: for
// `SOLVED·D' L D U'` the cross is 3 out and the D corners are 1 out, so the heuristic says 3, and
// the true `first-layer` distance is 4 (`U D' L' D`). `lowerBound()` and `solveToState()` are two
// different questions and the caller must not confuse them; the screens label the difference.
//
// WHY THE REPLAY IS THE LOAD-BEARING PART, and why it is here rather than in a test. Plan §9a ranks
// the failure modes: a route that does not reach its target is severe, and a route one move longer
// than necessary is harmless. So the property that must never be wrong is checked on every single
// answer, in production, and the property that is expensive to check — minimality — is verified
// offline against oracles whose failure mode is the harmless one. Every bug in the search, the
// tables, the heuristic or the contour therefore becomes "no answer", never "wrong answer".
//
// The replay asks `target.verify`, NOT `target.predicate`. Asking the conjunction of projected goals
// would be circular: a corrupted goal set produces a route that reaches the corrupted goal, and the
// conjunction agrees, instantly and with total confidence. `test/solve-to-state.test.mjs` builds
// exactly that corruption and shows nothing inside the mechanism notices.

import { MOVE_NAMES, applyAlg } from './cube-pieces.js';
import { PROJECTIONS, TARGETS, targetById } from './stage-targets.js';

/** No distance is this. The sentinel every unreachable code holds. */
const UNREACHABLE = 255;

// ---- the tables ------------------------------------------------------------------------------------

const tables = new Map();

/**
 * The exact distance table for one projection, breadth-first from its goal set.
 *
 * Lazy and memoised, and the laziness is not an optimisation detail: `cross` needs one table where
 * `solved` needs five, and a Restore screen that only ever answers the cross should not pay for the
 * other six. Measured on an M5 (bench/solve-to-state-measure.mjs): all seven cost 285–370 ms cold
 * and about 35 MiB of peak resident — the resident figure being some twenty times the 1.9 MiB the
 * arrays themselves occupy, because it is the breadth-first FRONTIER that peaks and not the result.
 */
function tableFor(projection) {
  const held = tables.get(projection.id);
  if (held) return held;

  const dist = new Uint8Array(projection.codeSpace).fill(UNREACHABLE);
  let frontier = [];
  for (const goal of projection.goals) {
    if (dist[goal] === UNREACHABLE) {
      dist[goal] = 0;
      frontier.push(goal);
    }
  }
  let depth = 0;
  let reachable = frontier.length;
  const layers = [frontier.length];
  // One scratch row of eighteen successors, reused. `expand` decodes the packed code ONCE for all
  // eighteen moves; asking `stepCode` per move decodes it eighteen times, and measured that was
  // three times this build's cost with the whole difference in an inner loop.
  const successors = new Int32Array(MOVE_NAMES.length);
  while (frontier.length > 0) {
    const next = [];
    for (const code of frontier) {
      projection.expand(code, successors);
      for (let m = 0; m < MOVE_NAMES.length; m++) {
        const to = successors[m];
        if (dist[to] !== UNREACHABLE) continue;
        dist[to] = depth + 1;
        next.push(to);
        reachable++;
      }
    }
    depth++;
    if (next.length > 0) layers.push(next.length);
    frontier = next;
  }
  const built = Object.freeze({ dist, reachable, diameter: depth - 1, layers: Object.freeze(layers) });
  tables.set(projection.id, built);
  return built;
}

/** Build every table now, for a warm-up that knows a question is coming. */
export function warmTables() {
  for (const projection of Object.values(PROJECTIONS)) tableFor(projection);
}

/**
 * What a table looks like, for a test or a bench — a COPY, and its shape rather than the array
 * alone.
 *
 * The live array is private for the reason `methods/cross.js` keeps `crossDistance` private: a
 * caller holding it can descend it, and descending a table is only a valid way to get an ANSWER
 * where the target is exactly the preimage of the projected goal. That is true for `cross` and for
 * nothing else here, so the operation is not offered.
 */
export function projectionTable(id) {
  const projection = PROJECTIONS[id];
  if (!projection) throw new Error(`stage-distance: no projection named "${id}"`);
  const built = tableFor(projection);
  return {
    dist: built.dist.slice(),
    reachable: built.reachable,
    diameter: built.diameter,
    layers: [...built.layers],
    goals: [...projection.goals],
  };
}

// ---- the heuristic ------------------------------------------------------------------------------

/**
 * A lower bound on the distance from `state` to `target`, instantly.
 *
 * The maximum of the target's tables. Admissible for the reason plan §2 Claim A gives and for no
 * other: each table is breadth-first searched from a goal set containing the projection of the whole
 * target, so a maneuver into the target maps to a walk of the same length into the goal and the
 * table's value can never exceed the true distance. Equality is not claimed and is not needed.
 *
 * **This is a bound, not an answer**, everywhere except `cross`. A screen that prints it must say so.
 */
/**
 * The maximum of `dists[i][codes[at + i]]` — THE heuristic, in one place.
 *
 * `lowerBound` and the search's contour test both need this, and they had it twice: one over an
 * array of codes, one over a frame of the search's flat buffer. Two spellings of the combining
 * function is the exact hazard plan §9a records — "the first version of that check read the tables
 * and still passed, because the break was in the combination and nothing read the combination" —
 * because the admissibility test grades `lowerBound` while the search prunes with the other one.
 *
 * `at` is the offset into `codes`, so a plain array (at 0) and a frame of the buffer (at
 * `frame * width`) go through the same arithmetic.
 */
function maxDistance(dists, codes, at, width, whose) {
  let best = 0;
  for (let i = 0; i < width; i++) {
    const d = dists[i][codes[at + i]];
    // An unreachable code cannot occur for a legal cube — every projection is surjective onto its
    // reachable set — so this is a corrupted table or an illegal state, and either way a bound of
    // 255 would silently disable the search. Loud, at the source.
    if (d === UNREACHABLE) {
      throw new Error(`stage-distance: ${whose[i]} has no distance for this cube — the table is`
        + ' corrupt, or the state is not one a cube can be turned into');
    }
    if (d > best) best = d;
  }
  return best;
}

export function lowerBound(targetOrId, state) {
  const target = typeof targetOrId === 'string' ? targetById(targetOrId) : targetOrId;
  const projections = target.projections;
  return maxDistance(
    projections.map((p) => tableFor(p).dist),
    projections.map((p) => p.codeOf(state)),
    0,
    projections.length,
    projections.map((p) => p.id),
  );
}

/** Every offered target's lower bound at once, by id — the Restore chip row's instant half. */
export function lowerBounds(state, targets = TARGETS.filter((t) => t.offered)) {
  return Object.fromEntries(targets.map((t) => [t.id, lowerBound(t, state)]));
}

// ---- the search ------------------------------------------------------------------------------------

/** Which face each move turns, and which axis that face is on — the two pruning rules. */
const FACE = MOVE_NAMES.map((m) => m[0]);
const AXIS_OF = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const AXIS = FACE.map((f) => AXIS_OF[f]);

/**
 * The node budget a repair is allowed, in SEARCH NODES.
 *
 * Nodes rather than milliseconds, for the reason `probeMax` is: a node count is deterministic
 * across machines and proportional to time, so a budget is the same gate on a phone and on a
 * laptop, and a test that asserts a refusal asserts something reproducible.
 *
 * SET FROM MEASUREMENT, not chosen — `bench/solve-to-state-measure.mjs radius`, over the five-kind
 * corpus of plan §7.2. **The number that decided it is the per-DEPTH table, not the budget curve.**
 * Answered-per-budget rises only from 69% to 71% between two million nodes and four, which reads as
 * "two million is enough" and is the wrong reading: the extra two million is what completes DEPTH
 * TEN, whose worst observed cost is 3,271,621 nodes and whose 95th percentile is 3,089,071. Ten is
 * the measured radius, so a budget that answers most of depth ten and not all of it moves the
 * radius to nine while leaving the number in the plan saying ten.
 *
 * What it costs in time, on an Apple M5: the engine runs 1.8 to 5.3 million nodes a second
 * depending on how many projections a target reads, so a refusal is about two seconds at worst. It
 * is a worker's two seconds — never the UI thread's — and the screen has the instant lower bounds
 * to show meanwhile.
 */
export const NODE_BUDGET = 4_000_000;

/**
 * How far out the exact answer is expected to reach, measured.
 *
 * The heuristic's largest possible value is 8 — a maximum of six values each bounded by its own
 * diameter cannot exceed the largest diameter — but that is a ceiling on the GUIDANCE and not on
 * searchable depth. Past it the search still works and merely loses direction, so the node count
 * climbs. Where exactness stops is therefore a measurement and not an arithmetic consequence.
 *
 * §3a measured 10 on random perturbations of solved; `bench/solve-to-state-measure.mjs radius`
 * re-measured it on the five-kind corpus and got 10 at this budget, with a single case at 11. This
 * constant is DOCUMENTATION of that measurement and is not read by the search — nothing here
 * refuses to look past it, because a search that can answer at 11 should.
 */
export const RADIUS = 10;

/** Depth past which the contour is not opened at all, however much budget is left. */
export const MAX_DEPTH = 14;

/**
 * How often a search asks whether it has been called off, in SEARCH NODES.
 *
 * A search is synchronous, so a stop can reach it only through something it reads while it runs:
 * the stop word a worker's request carries (lib/solve-client.js). A power of two, so the poll is a
 * mask. At the rates `NODE_BUDGET` records, 4,096 nodes is 0.8 to 2.3 ms of search, which is how
 * long a called-off search goes on holding its worker.
 */
export const STOP_POLL = 4096;

/**
 * The shortest maneuver from `state` into `target`, or a refusal.
 *
 * Returns `{ alg, moves, nodes, exact, why }`. `alg` is null exactly when `moves` is null, and a
 * null answer is ALWAYS a statement about the search and never about the cube — no caller may turn
 * one into "there is no short way back". `why` says which limit was reached, for a log rather than
 * for a screen.
 *
 * Minimality is the standard iterative-deepening A\* guarantee: an admissible heuristic plus an
 * exhausted contour. It holds only when the search finished a contour, so a budget refusal returns
 * nothing rather than the best route found so far — an upper bound presented as a distance is the
 * minimality claim the engine cannot make (plan §6, `AGENTS.md`).
 *
 * `stop`, when given, is asked before a node is spent, once every `STOP_POLL` nodes from the
 * first. Once it answers true the search refuses with `why: 'stopped'` — a statement about whoever
 * asked, never about the cube, and never dressed as the budget running out.
 */
export function solveToState(targetOrId, state, {
  nodeBudget = NODE_BUDGET, maxDepth = MAX_DEPTH, stop = null,
} = {}) {
  const target = typeof targetOrId === 'string' ? targetById(targetOrId) : targetOrId;
  const projections = target.projections;
  const width = projections.length;
  const dists = projections.map((p) => tableFor(p).dist);
  const names = projections.map((p) => p.id);
  const isGoal = projections.map((p) => p.isGoal);

  const start = projections.map((p) => p.codeOf(state));
  if (atGoalCodes(isGoal, start)) return believe(target, state, '', 0, 0);

  // One flat buffer for the whole descent rather than an array per node: `maxDepth + 1` frames of
  // `width` codes each. The spike allocated a fresh array at every node and it is the single
  // cheapest thing to stop doing.
  const codes = new Int32Array((maxDepth + 2) * width);
  codes.set(start, 0);
  const path = new Array(maxDepth + 1);
  let nodes = 0;
  /** Set when `stop` ended the search, so the refusal says so rather than blaming the budget. */
  let stopped = false;

  // The SAME function `lowerBound` returns, over this frame of the buffer. Not a second maximum.
  const heuristicAt = (frame) => maxDistance(dists, codes, frame * width, width, names);

  /** true found, false exhausted, null out of budget. Three outcomes, never two. */
  function descend(frame, g, bound, lastFace, lastAxis) {
    const h = heuristicAt(frame);
    if (g + h > bound) return false;
    if (atGoalFrame(isGoal, codes, frame, width)) return true;
    if (g >= maxDepth) return false;
    for (let m = 0; m < MOVE_NAMES.length; m++) {
      const face = FACE[m];
      if (face === lastFace) continue;                            // never twice on one face
      if (AXIS[m] === lastAxis && face < lastFace) continue;      // one order for commuting faces
      // IMMEDIATELY BEFORE THE NODE IS SPENT. Checked once per sibling LOOP instead, the budget was
      // advisory: `SOLVED·R` at `nodeBudget: 1` returned an exact answer after six nodes, because
      // eighteen children could be expanded between two checks and a goal found among them was
      // accepted before the next one ran. `nodes <= nodeBudget` is an invariant now, and a search
      // that cannot afford the node that would find the answer refuses instead of finding it.
      if (nodes >= nodeBudget) return null;
      // CALLED OFF, asked on the same terms as the budget: before the node is spent. Every
      // STOP_POLL nodes rather than every node — the search runs millions a second, and nothing
      // that calls one off is waiting on the difference.
      if (stop !== null && (nodes & (STOP_POLL - 1)) === 0 && stop()) {
        stopped = true;
        return null;
      }
      nodes++;
      const from = frame * width;
      const to = (frame + 1) * width;
      for (let i = 0; i < width; i++) codes[to + i] = projections[i].stepCode(codes[from + i], m);
      path[frame] = MOVE_NAMES[m];
      const got = descend(frame + 1, g + 1, bound, face, AXIS[m]);
      if (got !== false) return got;
    }
    return false;
  }

  for (let bound = heuristicAt(0); bound <= maxDepth; bound++) {
    const got = descend(0, 0, bound, '', -1);
    if (got === true) return believe(target, state, path.slice(0, bound).join(' '), bound, nodes);
    if (got === null) {
      return { alg: null, moves: null, nodes, exact: false, why: stopped ? 'stopped' : 'budget' };
    }
  }
  return { alg: null, moves: null, nodes, exact: false, why: `nothing within ${maxDepth}` };
}

const atGoalCodes = (isGoal, codes) => isGoal.every((at, i) => at(codes[i]));
function atGoalFrame(isGoal, codes, frame, width) {
  const base = frame * width;
  for (let i = 0; i < width; i++) if (!isGoal[i](codes[base + i])) return false;
  return true;
}

/**
 * The replay, and the only door an answer leaves by.
 *
 * Apply the route to the cube that was asked about, through `cube-pieces.js`, and ask the target's
 * independently written predicate. Three lines, one pass over at most fourteen moves, and it turns
 * every bug in this file into a refusal rather than into a wrong route in a child's hands.
 *
 * It does NOT establish minimality and cannot: proving a route shortest means proving nothing
 * shorter exists, which is exhaustive work rather than a per-answer check. That is the whole trick
 * of plan §9a — the property that must never be wrong is cheap to check every time, and the
 * property that is expensive to check is the one whose failure does no harm.
 */
function believe(target, state, alg, moves, nodes) {
  if (!target.verify(applyAlg(state, alg))) {
    return {
      alg: null, moves: null, nodes, exact: false,
      why: 'the route did not reach the target on replay',
    };
  }
  return { alg, moves, nodes, exact: true, why: null };
}
