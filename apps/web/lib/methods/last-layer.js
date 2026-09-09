// The OLL and PLL stages, and their rungs.
//
// Both stages are built the same way, out of LOOKS: a look is one sub-goal plus the repertoire
// that reaches it. "Two-look OLL" is literally two looks; a full-OLL rung is the same stage with
// ONE look and a bigger table. That is the whole reason the rungs here are data rather than
// branches (dev-docs/method-solver-return-plan.md §1) — the difference between rung 0 and rung 1
// is the length of an array, and the engine never learns which it got.
//
//   OLL rung 0  two-look: orient the edges, then the corners. 6 algs, 2 steps.
//   OLL rung 1  full OLL — 57 algs, 1 step. The table is generated and proved; see
//               lib/data/case-tables.js and crates/optimal-solver.
//   PLL rung 0  two-look: permute the corners, then the edges. 5 algs, 2 steps.
//   PLL rung 1  full PLL — 21 algs, 1 step. Likewise.
//
// **Rung 1 of each is the same `look`, with a longer array and one ply.** No new mechanism, which
// is the claim the two-rung design was written to be able to make: the engine still does not know
// which rung it got.
//
// Completeness at rung 0 is PROVED, not sampled: bench/method-solver-profile.mjs enumerates all
// 62,208 reachable last-layer states and every one of them is reached by these tables.

import { applyAlg } from '../cube-pieces.js';
import { FULL_OLL, FULL_PLL } from '../data/case-tables.js';
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
  // The repertoire is built ONCE, here, not on every solve. `repertoire` rotates and prefixes
  // every entry, so at rung 0 that was 5 algorithms turned into 80 candidates per look per solve —
  // wasteful but invisible. At rung 1 it is 57 turned into 912, and it stopped being invisible:
  // a full-OLL-and-PLL solve measured 869 ms against 484 ms for the beginner's method, which is
  // the wrong way round and a second of silence on the screen. Hoisted, it is 6 ms.
  Object.freeze({
    stage, target, plies, reached, goal, why, names,
    candidates: Object.freeze(repertoire(algs, options ?? {})),
  });

/**
 * The pieces sitting in `slots` that fail `wrong`, by IDENTITY — the cubie, not the seat.
 *
 * Identity is what lets the highlight follow a piece through the turn. One selector, parameterized
 * by the slot list and the permutation field: the corner and edge versions differed in exactly
 * those two things and had to be kept in step by hand.
 */
const named = (slots, field) => (wrong) => (s) =>
  slots.filter((slot) => wrong(s, slot)).map((slot) => s[field][slot]);

const namedEdges = named(U_EDGES, 'ep');
const namedCorners = named(U_CORNERS, 'cp');

/** Every piece in the top layer, by identity — the fallback, and only ever the whole of it. */
const wholeTopLayer = (s) => ({
  corners: U_CORNERS.map((slot) => s.cp[slot]),
  edges: U_EDGES.map((slot) => s.ep[slot]),
});

/**
 * A look's highlight payload: the groups it is about, and only the ones with something in them.
 *
 * **The fallback belongs to the WHOLE selection, not to each group.** Each group used to name the
 * entire top layer when nothing in it was wrong — which is right for a look that is about one
 * group, and wrong for the one-look rungs, which are about both. Full OLL on the inverse of Sune
 * has three twisted corners and four correctly oriented edges, and it pointed at all four edges;
 * full PLL on the inverse of a U-perm pointed at four solved corners. A learner reading a pulse as
 * "this is what the algorithm is for" was being told the wrong thing about half the layer.
 *
 * So an empty group is simply left out, and the fallback fires only when EVERY group is empty —
 * which means the look's predicate and its goal disagree, and over-pointing beats pointing at
 * nothing.
 */
const focus = (groups) => (s) => {
  const picked = {};
  for (const [key, pick] of Object.entries(groups)) {
    const ids = pick(s);
    if (ids.length) picked[key] = ids;
  }
  if (Object.keys(picked).length) return picked;
  const all = wholeTopLayer(s);
  return Object.fromEntries(Object.keys(groups).map((key) => [key, all[key]]));
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
    const found = fromRepertoire(state, l.candidates, l.goal, l.plies);
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
    names: focus({ edges: namedEdges((st, slot) => st.eo[slot] !== 0) }),
  }),
  // 2. Orient the corners — the whole top face one colour. Edges must stay oriented.
  look({
    stage: 'top-face', target: 'corners', algs: OCLL, plies: 2,
    reached: topCornersOriented,
    goal: guard((s) => topCornersOriented(s) && topEdgesOriented(s)),
    why: 'topFace.orient',
    names: focus({ corners: namedCorners((st, slot) => st.co[slot] !== 0) }),
  }),
]);

const TWO_LOOK_PLL = Object.freeze([
  // 3. Permute the corners, then the edges. The trailing U is part of the candidate, because
  //    "turn the top until it matches" is a move a learner makes and must be shown.
  look({
    stage: 'top-corners', target: 'permute', algs: [...CPLL, ...ALIGN], plies: 2, options: { post: AUF },
    reached: topCornersHome, goal: guard(topCornersHome), why: 'topCorners.permute',
    names: focus({ corners: namedCorners((st, slot) => st.cp[slot] !== slot) }),
  }),
  look({
    stage: 'top-edges', target: 'permute', algs: [...EPLL, ...ALIGN], plies: 2, options: { post: AUF },
    reached: wholeCubeSolved, goal: wholeCubeSolved, why: 'topEdges.permute',
    names: focus({ edges: namedEdges((st, slot) => st.ep[slot] !== slot) }),
  }),
]);

/** The whole top face one colour — what both OLL rungs are for, asked of the cube. */
const topOriented = (s) => topCornersOriented(s) && topEdgesOriented(s);

/** One look, 57 algorithms: recognise the case and finish the top face in one go.
 *
 *  The algorithms are proved minimal, so this rung is not merely fewer STEPS than two-look — it is
 *  fewer moves as well, which is the thing a flat ladder would fail (§10). */
const FULL_OLL_LOOK = Object.freeze([
  look({
    stage: 'top-face', target: 'corners', algs: FULL_OLL, plies: 1,
    // ALL FOUR ROTATIONS, and the argument against them was about the wrong thing. The table is
    // complete, so a rotated variant of an entry is indeed another entry's case — coverage needs
    // no rotations. LENGTH does: the case's own entry is minimal for the alignment the generator
    // chose, and reaching that alignment costs a pre-AUF, while a y-rotated sibling may reach the
    // same case needing none. Measured over 60 cubes: 22.45 moves per last layer without them and
    // 21.22 with, for 2.3 ms a solve. The repertoire is built once at module load, so the four
    // copies cost search time and nothing else.
    options: {},
    reached: topOriented, goal: guard(topOriented), why: 'topFace.orient',
    // Both kinds, because a one-look OLL is about both — an edge that needs flipping and a corner
    // that needs twisting are the same step here, and pointing at only the corners would leave the
    // learner looking for what the algorithm was for.
    names: focus({
      corners: namedCorners((st, slot) => st.co[slot] !== 0),
      edges: namedEdges((st, slot) => st.eo[slot] !== 0),
    }),
  }),
]);

/** One look, 21 algorithms: the whole last layer into place, plus the turn that lines it up. */
const FULL_PLL_LOOK = Object.freeze([
  look({
    stage: 'top-edges', target: 'permute', algs: [...FULL_PLL, ...ALIGN], plies: 1,
    // Rotations for the same reason as full OLL above: they do not widen the coverage a complete
    // table already has, they shorten the answer. The inverse of `B2 U L' R B2 L R' U B2` came out
    // at 11 moves without them and 9 with, using a rotated entry of the table it already had.
    options: { post: AUF },
    reached: wholeCubeSolved, goal: wholeCubeSolved, why: 'lastLayer.permute',
    names: focus({
      corners: namedCorners((st, slot) => st.cp[slot] !== slot),
      edges: namedEdges((st, slot) => st.ep[slot] !== slot),
    }),
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
  Object.freeze({
    id: 'oll',
    rung: 1,
    label: 'full OLL',
    blurb: 'The whole top face in one algorithm — 57 of them, each the shortest there is',
    targets: Object.freeze({ edges: Object.freeze([]), corners: Object.freeze([]) }),
    keep: firstTwoLayers,
    contract: topFaceOriented,
    why: 'stage.oll',
    run: runLooks(FULL_OLL_LOOK),
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
  Object.freeze({
    id: 'pll',
    rung: 1,
    label: 'full PLL',
    blurb: 'The whole last layer in one algorithm — 21 of them, each the shortest there is',
    targets: Object.freeze({ edges: Object.freeze([]), corners: Object.freeze([]) }),
    keep: topFaceOriented,
    contract: wholeCubeSolved,
    why: 'stage.pll',
    run: runLooks(FULL_PLL_LOOK),
  }),
]);
