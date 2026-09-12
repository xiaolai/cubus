// The invariant half of the method solver: the machinery every rung uses and none of them owns.
//
// The split is dev-docs/method-solver-return-plan.md §1, and the reason for it is that the
// removed version took a `level` and branched on it. A third rung meant a third arm of an `if`,
// which is why `LEVELS` never grew past two. Nothing in this file knows which rung it is serving
// — there is no `rung` here to read — so a new rung is a new file under `methods/`, never an
// edit here.
//
// What lives here is exactly the list the plan calls invariant:
//
//   shortestTo / descend   shortest intuitive sequence to a goal, iterative deepening
//   fromRepertoire         BFS over NAMED algorithms to a goal, deduplicated, ranked in one frame
//   repertoire             one alg -> its rotations x AUF, shortest first
//   slotSafe               is this alg slot-safe AS AN ALGORITHM, asked on a solved cube
//   simplify               merge adjacent same-face turns, per step and never across
//   MethodSolverError      refuse, carrying stage + state. Never a partial solution
//
// The design rule everything else follows from, unchanged from the first version: **a case table
// cannot lie here.** Every step is produced by proposing candidate algs and keeping only one that
// provably reaches its sub-goal with the already-solved pieces intact. A mistyped algorithm
// therefore cannot emit a wrong step — it can only fail to find one, loudly.
//
// Convention: the cross goes on D. Slot index equals cubie index, so `EDGE.DF` is both "the DF
// slot" and "the cubie that belongs there".

import {
  CORNER, EDGE, MOVE_NAMES, SOLVED, allSolved, applyAlg, applyMove, moveCount, rotateAlg,
} from '../cube-pieces.js';

/** U-layer slots. "In the top layer" is the staging area every stage lifts pieces into. */
export const U_EDGES = Object.freeze([EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB]);
export const U_CORNERS = Object.freeze([CORNER.URF, CORNER.UFL, CORNER.ULB, CORNER.UBR]);

/** The cross edges, first-layer corners and middle edges, in the order they are placed. */
export const CROSS = Object.freeze([EDGE.DF, EDGE.DR, EDGE.DB, EDGE.DL]);
export const F1L = Object.freeze([CORNER.DFR, CORNER.DRB, CORNER.DBL, CORNER.DLF]);
export const MIDDLE = Object.freeze([EDGE.FR, EDGE.BR, EDGE.BL, EDGE.FL]);

/** The four pairs, each a corner and the edge that belongs beside it. Same order as the
 *  beginner stages, so slot k is reached by rotating the front-right algorithms k times. */
export const F2L_PAIRS = Object.freeze([
  Object.freeze({ corner: CORNER.DFR, edge: EDGE.FR }),
  Object.freeze({ corner: CORNER.DRB, edge: EDGE.BR }),
  Object.freeze({ corner: CORNER.DBL, edge: EDGE.BL }),
  Object.freeze({ corner: CORNER.DLF, edge: EDGE.FL }),
]);

/** The four U turns, as the "line it up" prefix every algorithmic step may need. */
export const AUF = Object.freeze(['', 'U', 'U2', "U'"]);

/** Every cubie index, for "is the whole cube solved". */
export const ALL_EDGES = Object.freeze([...Array(12).keys()]);
export const ALL_CORNERS = Object.freeze([...Array(8).keys()]);

/**
 * A solved cube, for asking questions about an algorithm rather than about a position.
 *
 * DERIVED from `cube-pieces.js`'s `SOLVED` rather than written out again — it was a second copy of
 * the same literal — and frozen all the way down. `Object.freeze` is shallow, so the arrays inside
 * the old one were writable: `SOLVED_STATE.eo[0] = 1` corrupted every later `slotSafe` answer in
 * the process, which is the same defect `case-tables.test.mjs` pins for the shipped tables.
 */
export const SOLVED_STATE = Object.freeze({
  cp: Object.freeze([...SOLVED.cp]),
  co: Object.freeze([...SOLVED.co]),
  ep: Object.freeze([...SOLVED.ep]),
  eo: Object.freeze([...SOLVED.eo]),
});

export const joinAlg = (...parts) => parts.filter(Boolean).join(' ').trim();
/** How many moves an algorithm is — `cube-pieces.js`'s tokenizer, not a fourth copy of it. */
export const algLength = moveCount;

/**
 * Merge consecutive turns of the same face.
 *
 * Steps are built by stringing triggers together, and where two of them meet the seam shows:
 * `R U R'` followed by `R2 U'` really means `R U R U'`, and `L L` is not a move anybody makes.
 * Only adjacent faces are merged — reordering commuting turns would shorten it further but would
 * also stop the alg being the thing the step said it was doing.
 *
 * (The example this comment used to give was `R U R'` then `R U' R'` becoming `R U R2 U' R'`.
 * That pair cancels COMPLETELY — the seam is `R' R`, then `U U'`, then `R R'` — so it was an
 * example of the opposite of what it was illustrating.)
 */
export function simplify(alg) {
  const runs = [];
  for (const move of String(alg).trim().split(/\s+/).filter(Boolean)) {
    const face = move[0];
    const turns = move.endsWith('2') ? 2 : move.endsWith("'") ? 3 : 1;
    const last = runs[runs.length - 1];
    if (last && last.face === face) {
      last.turns = (last.turns + turns) % 4;
      if (last.turns === 0) runs.pop();
    } else {
      runs.push({ face, turns });
    }
  }
  return runs.map(({ face, turns }) => face + (turns === 1 ? '' : turns === 2 ? '2' : "'")).join(' ');
}

/**
 * Shortest sequence of face turns, up to `maxDepth`, after which `goal` holds.
 *
 * Used only for the intuitive stages, where the honest reason for a move is what it achieves
 * rather than which case it is. Iterative deepening, so the answer is the shortest one; no two
 * consecutive turns of the same face, since those are always expressible as one.
 *
 * Returns null rather than throwing: the caller knows what it was looking for and can say so.
 */
export function shortestTo(state, goal, maxDepth) {
  if (goal(state)) return '';
  for (let depth = 1; depth <= maxDepth; depth++) {
    const found = descend(state, goal, depth, '');
    if (found !== null) return found;
  }
  return null;
}

function descend(state, goal, depth, lastFace) {
  for (const move of MOVE_NAMES) {
    const face = move[0];
    if (face === lastFace) continue;
    const next = applyMove(state, move);
    if (depth === 1) {
      if (goal(next)) return move;
      continue;
    }
    const rest = descend(next, goal, depth - 1, face);
    if (rest !== null) return joinAlg(move, rest);
  }
  return null;
}

/**
 * The first candidate alg that reaches `goal`, searched breadth-first over the repertoire.
 *
 * `plies` lets a stage say "two algorithms from this list, if one will not do" — which is what
 * two-look OLL and two-look PLL actually are. The search is over NAMED algorithms rather than
 * over raw moves, so whatever it finds is still a sequence of things a learner was taught.
 */
export function fromRepertoire(state, candidates, goal, plies = 1, keyOf = stateKey, rank = (alg) => alg) {
  // Shortest first, then by the caller's rank. Compared NUMERICALLY: the length used to be
  // stringified and zero-padded to three digits, so a 1,000-move route sorted ahead of a 104-move
  // one. Nothing here produces four-digit algorithms today, which is what made it a defect worth
  // fixing rather than a bug worth waiting for.
  const precedes = (a, b) => (a.length !== b.length ? a.length < b.length : a.rank < b.rank);
  // The comparison values are computed ONCE per route. They used to be recomputed inside a
  // comparator, so `rank` — which rotates a whole algorithm into a common frame — ran O(n log n)
  // times over a list from which exactly one element was ever read.
  const route = (node, candidate, after, alg) => ({
    state: after,
    alg,
    used: [...node.used, candidate],
    length: algLength(alg),
    rank: rank(alg),
  });

  let frontier = [{ state, alg: '', used: [] }];
  // Different runs of triggers land on the same cube constantly — `R U R'` then `R U' R'` is
  // where it started. Without this the frontier squares every ply and the budget is spent
  // re-examining positions already seen, which is what made the pair search look unreachable
  // when it was merely wasteful.
  const seen = new Set([keyOf(state, '')]);
  for (let ply = 0; ply < plies; ply++) {
    // On the last permitted ply neither collection is read again, so nothing is put in them.
    const lastPly = ply === plies - 1;
    const next = new Map();
    let best = null;
    for (const node of frontier) {
      for (const candidate of candidates) {
        const after = applyAlg(node.state, candidate.alg);
        const alg = joinAlg(node.alg, candidate.alg);
        if (goal(after, alg)) {
          // Finish the ply before choosing, and choose by the algorithm rather than by whichever
          // branch happened to be reached first. Returning the first hit made the answer depend on
          // the order the frontier was built in — which is not the same order in every working
          // slot, so one F2L case came out with a different algorithm depending on which slot it
          // turned up in. `rank` is what lets the caller compare candidates in ONE frame; the
          // default compares them as written.
          const hit = route(node, candidate, after, alg);
          if (best === null || precedes(hit, best)) best = hit;
          continue;
        }
        if (lastPly) continue;
        const key = keyOf(after, alg);
        if (seen.has(key)) continue;
        // THE BEST ROUTE TO A STATE, not the first one found. Deduplicating on arrival kept
        // whichever route the candidate order happened to produce first, so reordering two
        // equally-ranked candidates changed what the NEXT ply was expanded from — `U D` and `D U`
        // reach the same cube, and which one was retained decided between `U D R` and `D U R`
        // under a ranking function that cannot tell them apart.
        const held = next.get(key);
        const successor = route(node, candidate, after, alg);
        if (held === undefined || precedes(successor, held)) next.set(key, successor);
      }
    }
    if (best !== null) return { state: best.state, alg: best.alg, used: best.used };
    for (const key of next.keys()) seen.add(key);
    frontier = [...next.values()];
  }
  return null;
}

/** A cube as one string, for the visited set. Permutation and orientation both matter, so all
 *  four arrays go in — a key that ignored orientation would call two different cubes equal. */
export function stateKey(s) {
  return `${s.cp.join('')}|${s.co.join('')}|${s.ep.join(',')}|${s.eo.join('')}`;
}

/** Every rotation of an algorithm, each with the AUF that lines the case up in front of it. */
/**
 * How many repertoires have been built since this module loaded.
 *
 * An INSTRUMENT, not a statistic. Building one rotates and AUF-prefixes every entry, so it belongs
 * at module scope and nowhere near a solve — and it used to be inside one, in three places, where
 * rung 0 turned 5 algorithms into 80 candidates per look per cube and rung 1 turned 57 into 912.
 * A counter is how that stays fixed: `method-solver.test.mjs` solves at every rung and requires
 * this number not to move. Timing it instead would measure the machine.
 */
let built = 0;
export const repertoiresBuilt = () => built;

export function repertoire(algs, { rotations = [0, 1, 2, 3], auf = AUF, post = [''] } = {}) {
  built += 1;
  const out = [];
  for (const entry of algs) {
    for (const k of rotations) {
      const body = rotateAlg(entry.alg, k);
      for (const pre of auf) {
        for (const tail of post) {
          out.push({ name: entry.name, alg: joinAlg(pre, body, tail), rotation: k, auf: pre });
        }
      }
    }
  }
  // Shortest first, so a step that needs no setup is preferred over one that does.
  return out.sort((a, b) => algLength(a.alg) - algLength(b.alg));
}

/**
 * Does this algorithm leave every slot but one exactly as it found it?
 *
 * Asked of the ALGORITHM, on a solved cube — not of the position it happens to be used in.
 * That distinction is the whole reason the stage is teachable. Asking "did anything already
 * solved break" makes the answer depend on how far through the solve you are: the search found
 * a three-move answer for a position early on and a ten-move answer for the SAME position
 * later, because by then there was more in the way. A learner cannot memorise that. A case has
 * to have one answer, so the constraint has to be a property of the algorithm alone.
 */
const slotSafeCache = new Map();
export function slotSafe(alg, keepCorners, keepEdges, cacheKey) {
  // THE PROTECTED PIECES ARE PART OF THE QUESTION, so they are part of the cache identity. The key
  // used to be `cacheKey|alg`, and `cacheKey` is a caller's label rather than a description of the
  // sets — so asking about `R` with nothing protected and then about `R` with the DR edge
  // protected returned the first answer twice. A cache that answers a question it was not asked is
  // worse than no cache.
  const key = `${cacheKey}|${keepCorners.join(',')}|${keepEdges.join(',')}|${alg}`;
  const cached = slotSafeCache.get(key);
  if (cached !== undefined) return cached;
  // `allSolved` asks exactly this question and is what every other predicate here is built from;
  // the two loops that used to sit here were a third spelling of `edgeSolved` and `cornerSolved`.
  const safe = allSolved(applyAlg(SOLVED_STATE, alg), { corners: keepCorners, edges: keepEdges });
  slotSafeCache.set(key, safe);
  return safe;
}

/** Everything solved so far, as the "do not disturb" set for the next sub-goal. */
export const keeping = (edges, corners) => (state) => allSolved(state, { edges, corners });

/** A last-layer edge is oriented when its top sticker is the top colour, which in this
 *  representation is exactly `eo === 0` for a U slot. */
export const topEdgesOriented = (s) => U_EDGES.every((slot) => s.eo[slot] === 0);
/** Likewise for corners, untwisted in place. */
export const topCornersOriented = (s) => U_CORNERS.every((slot) => s.co[slot] === 0);
/** The top corners home and untwisted — what two-look PLL's first half reaches. */
export const topCornersHome = (s) => U_CORNERS.every((c) => s.cp[c] === c && s.co[c] === 0);
/**
 * The top corners each in their OWN slot, twist ignored — the owner's stage 5, and NOT a checkpoint
 * this app's method route has.
 *
 * `topCornersHome` above is the app's own last-layer boundary and is strictly stronger: PLL's
 * contract is `topFaceOriented` (`last-layer.js`), so the app orients the top corners and only then
 * permutes them. Most beginner books teach the other order — corners home first, twists fixed last —
 * and this is that checkpoint. The gap between the two is not a detail: a cube with all four top
 * corners in their own slots and two of them twisted satisfies this and fails `topCornersHome`.
 * `test/stage-targets.test.mjs` asserts the gap rather than describing it.
 *
 * STRICT, and deliberately: each corner in its own slot, not merely correct up to a U turn. The
 * bottom two layers are solved by then, so the side colours are fixed and a corner is home or it is
 * not — which is also how a child is taught to check it, so the weaker reading would mark a cube
 * done that the child's own check calls wrong.
 */
export const topCornersPlaced = (s) => U_CORNERS.every((c) => s.cp[c] === c);
/** The whole cube. */
export const wholeCubeSolved = (s) => allSolved(s, { edges: ALL_EDGES, corners: ALL_CORNERS });
/** Cross solved; first two layers solved. The stage contracts of §2, as predicates. */
export const crossSolved = keeping(CROSS, []);
export const firstTwoLayers = keeping([...CROSS, ...MIDDLE], F1L);

/** Raised when the repertoire cannot reach a sub-goal. Never swallowed: an unsolvable stage
 *  means the tables are wrong, and a solver that quietly returned a partial solution would be
 *  handing a learner moves that do not lead anywhere. */
export class MethodSolverError extends Error {
  constructor(stage, target, state) {
    super(`method solver: no step reaches ${stage}/${target}`);
    this.name = 'MethodSolverError';
    this.stage = stage;
    this.target = target;
    this.state = state;
  }
}
