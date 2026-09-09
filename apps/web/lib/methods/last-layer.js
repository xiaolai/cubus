// The OLL and PLL stages, and their rungs.
//
// Both stages are built the same way, out of LOOKS: a look is one sub-goal plus the repertoire
// that reaches it. "Two-look OLL" is literally two looks; a full-OLL rung is the same stage with
// ONE look and a bigger table. That is the whole reason the rungs here are data rather than
// branches (dev-docs/method-solver-return-plan.md §1) — the difference between rung 0 and rung 1
// is the length of an array, and the engine never learns which it got.
//
//   OLL rung 0  two-look: orient the edges, then the corners. 6 algs, 2 steps.
//   OLL rung 1  full OLL — 57 algs, 1 step. Phase C; the table does not exist yet.
//   PLL rung 0  two-look: permute the corners, then the edges. 5 algs, 2 steps.
//   PLL rung 1  full PLL — 21 algs, 1 step. Phase C.
//
// Completeness at rung 0 is PROVED, not sampled: bench/method-solver-profile.mjs enumerates all
// 62,208 reachable last-layer states and every one of them is reached by these tables.

import { applyAlg } from '../cube-pieces.js';
import {
  AUF, MethodSolverError, U_CORNERS, U_EDGES, firstTwoLayers, fromRepertoire, repertoire,
  topCornersHome, topCornersOriented, topEdgesOriented, wholeCubeSolved,
} from './engine.js';

/** Orienting the last-layer edges. One alg, applied up to three times. */
const EOLL = [{ name: 'edge-orient', alg: "F R U R' U' F'" }];

/** Orienting the last-layer corners — the seven cases of two-look OLL, in face turns only
 *  (no wide or slice moves, because the renderer and the move list only speak face turns). */
const OCLL = [
  { name: 'sune', alg: "R U R' U R U2 R'" },
  { name: 'antisune', alg: "R U2 R' U' R U' R'" },
  { name: 'headlights', alg: "R2 D R' U2 R D' R' U2 R'" },
  { name: 'double-sune', alg: "R U R' U R U' R' U R U2 R'" },
  { name: 'pi', alg: "R U2 R2 U' R2 U' R2 U2 R" },
];

/** Permuting the last-layer corners. Adjacent swap both ways round, plus the diagonal. */
const CPLL = [
  { name: 'corner-cycle', alg: "R' F R' B2 R F' R' B2 R2" },
  { name: 'corner-cycle-back', alg: "R2 B2 R F R' B2 R F' R" },
  { name: 'diagonal', alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
];

/** Permuting the last-layer edges. Two U-perms; Z and H fall out of applying two of them. */
const EPLL = [
  { name: 'u-perm-a', alg: "R U' R U R U R U' R' U' R2" },
  { name: 'u-perm-b', alg: "R2 U R U R' U' R' U' R' U R'" },
];

/**
 * Turning the top until it lines up — not an algorithm, and that is why it is here separately.
 *
 * **A cube that needs one turn was getting nineteen.** `solveByMethod(applyAlg(SOLVED, 'U'))`
 * returned a 19-move, 2-step lesson and `U2` returned FORTY moves across four steps, because the
 * only candidates the last-layer looks had were named permutation algorithms: with the corners
 * one turn from home, the search found a pair of perms that got there rather than the turn. That
 * is the shape of answer that made the first attempt read as a broken solver, on the easiest cube
 * there is (found by audit, 2026-09-09).
 *
 * An empty body with the AUF prefix and suffix `repertoire` already adds IS the alignment, so this
 * needs no new table — and being shortest, `fromRepertoire` prefers it whenever it suffices. It is
 * kept out of `PLL_ALGS` on purpose: that is the list of algorithms a learner memorises, and
 * "turn the top until it matches" is not one of them.
 */
const ALIGN = [{ name: 'align', alg: '' }];

/** The exported tables are DETACHED copies, and frozen.
 *
 *  They used to hand out the very objects the solver reads: `OLL_ALGS[0].alg = ''` changed every
 *  later solve in the process, and reproduced a `MethodSolverError` on a state that had solved a
 *  moment earlier. An export exists to be read; sharing mutable state through one is a global
 *  variable with a nicer name. */
const detach = (algs) => Object.freeze(algs.map((a) => Object.freeze({ ...a })));

export const OLL_ALGS = detach([...EOLL, ...OCLL]);
export const PLL_ALGS = detach([...CPLL, ...EPLL]);
/** Named steps the last layer can emit that are not memorised algorithms. */
export const LAST_LAYER_EXTRAS = detach(ALIGN);

/**
 * One look: the sub-goal, the table that reaches it, and what a step of it says.
 *
 * `reached` is asked of the state to decide whether the look is needed at all. `goal` is what the
 * search must land on, and it always carries the guard — reaching the sub-goal by breaking the
 * first two layers is not reaching it.
 *
 * `names` is the focus/highlight payload: WHICH pieces this application is about, read from the
 * cube as it stands before the algorithm runs. Without it a last-layer step could only say
 * "make a cross on the top face" and point at nothing — and dev-docs/method-solver-return-plan.md
 * §5.2 is the claim that pointing is the load-bearing channel and the sentence is the assistant.
 */
const look = ({ stage, target, algs, plies, options, reached, goal, why, names }) =>
  Object.freeze({ stage, target, algs, plies, options: options ?? {}, reached, goal, why, names });

/** The pieces sitting in the U slots that fail `wrong`, by IDENTITY — the cubie, not the seat.
 *  Identity is what lets the highlight follow a piece through the turn. */
const namedEdges = (wrong) => (s) => {
  const picked = U_EDGES.filter((slot) => wrong(s, slot)).map((slot) => s.ep[slot]);
  // A look only runs when something is wrong, so an empty set means the predicate and the goal
  // disagree. Naming the whole layer is the honest fallback: it over-points rather than pointing
  // at nothing, and the test below pins that it never happens on a real solve.
  return picked.length ? picked : U_EDGES.map((slot) => s.ep[slot]);
};
const namedCorners = (wrong) => (s) => {
  const picked = U_CORNERS.filter((slot) => wrong(s, slot)).map((slot) => s.cp[slot]);
  return picked.length ? picked : U_CORNERS.map((slot) => s.cp[slot]);
};

/**
 * Run a stage's looks in order.
 *
 * Each look emits ONE step per algorithm it used, because each application is a case a learner
 * recognises on its own — three applications of the edge-orient alg is three things that
 * happened, not one long one. The cube is replayed one algorithm at a time so that each step's
 * `why` names the pieces THAT step is about, rather than the ones the first of them was.
 */
const runLooks = (looks) => (state, steps) => {
  for (const l of looks) {
    if (l.reached(state)) continue;
    const found = fromRepertoire(state, repertoire(l.algs, l.options), l.goal, l.plies);
    if (!found) throw new MethodSolverError(l.stage, l.target, state);
    // ONE replay, not two. The pieces each application is about are read BEFORE it runs — so three
    // edge-orient steps name three different sets rather than three copies of the first — and
    // whether it completed the look is read after. A first version walked the algorithms twice to
    // get those two facts; they come from either side of the same step.
    let cursor = state;
    for (const used of found.used) {
      const names = l.names(cursor);
      cursor = applyAlg(cursor, used.alg);
      // Only the LAST application reaches the look's goal. Captioning the first of three
      // edge-orient steps "make a cross on the top face" describes a thing that will not have
      // happened when it finishes, and "this finishes the cube" on a step that does not is the
      // same mistake at its most visible. `reached` is asked of the cube, so the sentence is
      // decided by what the step DID rather than by which look it belongs to.
      const done = l.reached(cursor);
      // An alignment is not the stage's algorithm, so it does not borrow the stage's sentence:
      // "move the top corners to the places they belong" over a single U turn describes a thing
      // that is not happening.
      const key = used.name === 'align' ? 'lastLayer.align' : (done ? l.why : `${l.why}.step`);
      steps.push({ stage: l.stage, kind: 'case', target: l.target, alg: used.alg,
        caseName: used.name,
        why: { key, ...names } });
    }
    state = found.state;
  }
  return state;
};

/** Everything the first two layers hold, plus whatever else this look demands. */
const guard = (extra) => (s) => firstTwoLayers(s) && extra(s);

const TWO_LOOK_OLL = Object.freeze([
  // 1. Orient the edges — the cross on top. Up to three applications; each one is its own step.
  look({
    stage: 'top-cross', target: 'edges', algs: EOLL, plies: 3,
    reached: topEdgesOriented, goal: guard(topEdgesOriented), why: 'topCross.orient',
    names: (s) => ({ edges: namedEdges((st, slot) => st.eo[slot] !== 0)(s) }),
  }),
  // 2. Orient the corners — the whole top face one colour. Edges must stay oriented.
  look({
    stage: 'top-face', target: 'corners', algs: OCLL, plies: 2,
    reached: topCornersOriented,
    goal: guard((s) => topCornersOriented(s) && topEdgesOriented(s)),
    why: 'topFace.orient',
    names: (s) => ({ corners: namedCorners((st, slot) => st.co[slot] !== 0)(s) }),
  }),
]);

const TWO_LOOK_PLL = Object.freeze([
  // 3. Permute the corners, then the edges. The trailing U is part of the candidate, because
  //    "turn the top until it matches" is a move a learner makes and must be shown.
  look({
    stage: 'top-corners', target: 'permute', algs: [...CPLL, ...ALIGN], plies: 2, options: { post: AUF },
    reached: topCornersHome, goal: guard(topCornersHome), why: 'topCorners.permute',
    names: (s) => ({ corners: namedCorners((st, slot) => st.cp[slot] !== slot)(s) }),
  }),
  look({
    stage: 'top-edges', target: 'permute', algs: [...EPLL, ...ALIGN], plies: 2, options: { post: AUF },
    reached: wholeCubeSolved, goal: wholeCubeSolved, why: 'topEdges.permute',
    names: (s) => ({ edges: namedEdges((st, slot) => st.ep[slot] !== slot)(s) }),
  }),
]);

/** The top face one colour, with the first two layers still there. OLL's contract, PLL's keep. */
export const topFaceOriented = (s) => firstTwoLayers(s) && topEdgesOriented(s) && topCornersOriented(s);

/** @type {ReadonlyArray<import('./index.js').Stage>} */
export const OLL_RUNGS = Object.freeze([
  Object.freeze({
    id: 'oll',
    rung: 0,
    label: 'two-look',
    blurb: 'The top edges first, then the top corners — six algorithms in all',
    targets: Object.freeze({ edges: Object.freeze([]), corners: Object.freeze([]) }),
    keep: firstTwoLayers,
    contract: topFaceOriented,
    why: 'stage.oll',
    run: runLooks(TWO_LOOK_OLL),
  }),
]);

/** @type {ReadonlyArray<import('./index.js').Stage>} */
export const PLL_RUNGS = Object.freeze([
  Object.freeze({
    id: 'pll',
    rung: 0,
    label: 'two-look',
    blurb: 'The top corners to their places, then the top edges — five algorithms in all',
    targets: Object.freeze({ edges: Object.freeze([]), corners: Object.freeze([]) }),
    keep: topFaceOriented,
    contract: wholeCubeSolved,
    why: 'stage.pll',
    run: runLooks(TWO_LOOK_PLL),
  }),
]);
