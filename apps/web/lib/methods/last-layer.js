// The OLL and PLL stages, and their rungs.
//
// Both stages are built the same way, out of LOOKS: a look is one sub-goal plus the repertoire
// that reaches it. "Two-look OLL" is literally two looks; a full-OLL rung is the same stage with
// ONE look and a bigger table. That is the whole reason the rungs here are data rather than
// branches (dev-docs/method-solver-return-plan.md §1) — the difference between rung 0 and rung 1
// is the length of an array, and the engine never learns which it got.
//
//   OLL rung 0  two-look: orient the edges, then the corners. 6 algs, 2 steps.
//   OLL rung 1  full OLL — 57 algs, 1 step. The algorithms speedcubers learn, sourced in
//               lib/data/human-algs.js. The proved fewest-turn table (lib/data/case-tables.js,
//               crates/optimal-solver) is what each of them is checked against, not what is taught.
//   PLL rung 0  two-look: permute the corners, then the edges. 5 algs, 2 steps.
//   PLL rung 1  full PLL — 21 algs, 1 step. Likewise.
//
// **Rung 1 of each is the same `look`, with a longer array and one ply.** No new mechanism, which
// is the claim the two-rung design was written to be able to make: the engine still does not know
// which rung it got.
//
// Completeness at rung 0 is PROVED, not sampled: bench/method-solver-profile.mjs enumerates all
// 62,208 reachable last-layer states and every one of them is reached by these tables.

import { CORNER, applyAlg } from '../cube-pieces.js';
import { HUMAN_OLL, HUMAN_PLL } from '../data/human-algs.js';
import {
  AUF, MethodSolverError, U_CORNERS, U_EDGES, firstTwoLayers, fromRepertoire, repertoire,
  topCornersHome, topCornersOriented, topCornersPlaced, topEdgesHome, topEdgesOriented, wholeCubeSolved,
} from './engine.js';

/** Orienting the last-layer edges. One alg, applied up to three times. */
const EOLL = [{ name: 'edge-orient', alg: "F R U R' U' F'" }];

/** Orienting the last-layer corners — the seven cases of two-look OLL, in face turns only. The beginner
 *  table keeps to face turns by choice, so the first algorithms a child meets need no notation beyond the
 *  six faces; the one-look table below is where wide turns and slices come in. */
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
const look = ({ stage, target, algs, plies, options, reached, goal, why, names, afterSetup = false }) =>
  // The repertoire is built ONCE, here, not on every solve. `repertoire` rotates and prefixes
  // every entry, so at rung 0 that was 5 algorithms turned into 80 candidates per look per solve —
  // wasteful but invisible. At rung 1 it is 57 turned into 912, and it stopped being invisible:
  // a full-OLL-and-PLL solve measured 869 ms against 484 ms for the beginner's method, which is
  // the wrong way round and a second of silence on the screen. Hoisted, it is 6 ms.
  Object.freeze({
    stage, target, plies, reached, goal, why, names, afterSetup,
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
      // A look that begins each step by turning the top (`afterSetup`) is about the piece that turn BRINGS
      // to where the work is done, so its pieces are read after the turn — read before it, the course's
      // corner twist pointed at every twisted corner and at none in particular (Codex refute, 2026-10-14).
      const setup = l.afterSetup && used.auf ? used.auf : '';
      const names = { ...l.names(setup ? applyAlg(cursor, setup) : cursor), ...(setup ? { topTurn: true } : {}) };
      cursor = applyAlg(cursor, used.pieces ?? used.alg);
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

/** The whole top face one colour — what both OLL rungs are for, asked of the cube. ONE definition, which the
 *  two-look goal, the one-look goal and the stage contract all read. */
const topOriented = (s) => topCornersOriented(s) && topEdgesOriented(s);

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
    goal: guard(topOriented),
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

/** One look, 57 algorithms: recognise the case and finish the top face in one go.
 *
 *  THE ALGORITHMS SPEEDCUBERS LEARN, not the proved fewest-turn ones (owner's decision, 2026-10-13:
 *  human-speed first, fewer turns second). Of the 57 proved answers, 43 turn the back, bottom or left
 *  face — a sequence nobody's hands are taught. What this rung gives up is a few turns a case; what it
 *  gets is the algorithm a learner will find on every sheet and video, under the same number. */
const FULL_OLL_LOOK = Object.freeze([
  look({
    stage: 'top-face', target: 'corners', algs: HUMAN_OLL, plies: 1,
    // NO ROTATED COPIES, and this reverses a measured choice on purpose. With the proved table, the four
    // y-relabelled copies of each entry shortened a last layer from 22.45 to 21.22 moves by reaching a
    // case without its pre-AUF. A relabelled copy of a human algorithm is the same hands moved to the
    // back and left — `R U R'` becoming `B U B'` — which is the exact thing this table exists to stop
    // teaching. The table is complete without them; the top is turned to line the case up instead.
    // (And `repertoire` refuses to relabel a wide turn or a slice at all: it relabels face letters only.)
    options: { rotations: [0] },
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

/** One look, 21 algorithms: the whole last layer into place, plus the turn that lines it up. The
 *  human-speed table, for full OLL's reason above. */
const FULL_PLL_LOOK = Object.freeze([
  look({
    stage: 'top-edges', target: 'permute', algs: [...HUMAN_PLL, ...ALIGN], plies: 1,
    // No rotated copies, for full OLL's reason: a relabelled T-perm is a T-perm done with the left hand
    // at the back. The proved table's rotations bought 2 moves on the inverse of `B2 U L' R B2 L R' U B2`;
    // turning the top before and after is what a learner does instead.
    options: { rotations: [0], post: AUF },
    reached: wholeCubeSolved, goal: wholeCubeSolved, why: 'lastLayer.permute',
    names: focus({
      corners: namedCorners((st, slot) => st.cp[slot] !== slot),
      edges: namedEdges((st, slot) => st.ep[slot] !== slot),
    }),
  }),
]);

/** The top face one colour, with the first two layers still there. OLL's contract, PLL's keep. */
export const topFaceOriented = guard(topOriented);

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
    blurb: 'The whole top face in one algorithm — 57 of them, the ones speedcubers learn',
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
    blurb: 'The whole last layer in one algorithm — 21 of them, the ones speedcubers learn',
    targets: Object.freeze({ edges: Object.freeze([]), corners: Object.freeze([]) }),
    keep: topFaceOriented,
    contract: wholeCubeSolved,
    why: 'stage.pll',
    run: runLooks(FULL_PLL_LOOK),
  }),
]);

// ---- the course's order ------------------------------------------------------------------------
//
// THE LAST LAYER AS THE BEGINNER COURSE TEACHES IT (cubus-courses lessons 13–16; ADR 0009): the top
// edges turned up, then put home; the top corners put home, then each turned up. The app's own order
// orients everything before it permutes anything, and the two orders cross at the oll/pll line — the
// course places the edges BEFORE it turns the corners — so neither of its halves composes with a rung
// of the other route. It is a PAIR, chosen whole by `settings.lastLayer` (`methodFor`'s `lastLayer`),
// never by the rung dials.
//
// Every algorithm is the lesson's own, named with the lesson it comes from. The course does each from
// whichever side it is needed (its `rotateAlg`), so the swap and the cycle are relabelled for all four
// sides as the app's two-look tables are; the corner twist is never relabelled, because the course does
// it at the front-right only and turns the TOP to bring each corner there.
//
// Two of its looks have STAGE NAMES OF THEIR OWN, `edges-home` and `corners-turned`. A step's stage name
// is what files it under a heading (`DIAL_OF`, lib/method-lesson.js), and the app's `top-edges` is a
// last-layer stage while its `top-face` is a top-face one: borrowed here, the course's edges would be
// headed "Last layer" in the middle of its top-face section and its corner twists "Top face" after it.
//
// Completeness is PROVED as rung 0's is: `bench/method-solver-profile.mjs exhaustive course course`
// walks every one of the 62,208 reachable last-layer states through this pair — 0 failures, 2026-10-14 —
// and CI's nightly `last-layer-sweep` re-proves it in a shard of its own (`ci-plan.test.mjs` holds that
// the shard exists).

/** Lesson 13: the cross on top — the same six moves as the app's edge orientation. */
const COURSE_CROSS = [{ name: 'course-cross', alg: "F R U R' U' F'" }];
/** Lesson 14: swaps two top edges. It moves and twists the top corners as it goes — lesson 15 and 16
 *  put them right — and leaves the first two layers and the other two edges where they were. */
const COURSE_SWAP = [{ name: 'course-edge-swap', alg: "R U R' U R U2 R' U" }];
/** Lesson 15: moves three top corners round, leaving the front-right one where it is. */
const COURSE_CYCLE = [{ name: 'course-corner-cycle', alg: "U R U' L' U R' U' L" }];
/** Lesson 16: lesson 9's four moves, done twice or four times until the front-right corner turns up.
 *  The first two layers come apart while it runs and come back when every corner is up — which is what
 *  the lesson warns the child about, and why each application is one step. */
const TWIST = "R' D' R D";
const COURSE_TWIST = [
  { name: 'course-corner-twist', alg: `${TWIST} ${TWIST}` },
  { name: 'course-corner-twist-back', alg: `${TWIST} ${TWIST} ${TWIST} ${TWIST}` },
];

/** The whole cube solved once the top is turned to line up — what the twisting leaves. */
const solvedButTheTop = (s) => AUF.some((u) => wholeCubeSolved(applyAlg(s, u)));

/** The top edges home, the right way up, with the first two layers there: the course's lesson 14. */
export const topEdgesSolved = guard(topEdgesHome);

/** Every algorithm the course's route can name on a step — in `CASE_NAMES` for the reason the app's are. */
export const COURSE_ALGS = detach([...COURSE_CROSS, ...COURSE_SWAP, ...COURSE_CYCLE, ...COURSE_TWIST]);

const COURSE_EDGES = Object.freeze([
  // 1. The cross on top — the app's own edge-orientation look, under the course's name for its algorithm.
  look({
    stage: 'top-cross', target: 'edges', algs: COURSE_CROSS, plies: 3,
    reached: topEdgesOriented, goal: guard(topEdgesOriented), why: 'topCross.orient',
    names: focus({ edges: namedEdges((st, slot) => st.eo[slot] !== 0) }),
  }),
  // 2. The top edges home: turn the top to line up as many as will, swap two, again if need be.
  look({
    stage: 'edges-home', target: 'place', algs: [...COURSE_SWAP, ...ALIGN], plies: 2, options: { post: AUF },
    reached: topEdgesHome, goal: topEdgesSolved, why: 'topEdges.place',
    names: focus({ edges: namedEdges((st, slot) => st.ep[slot] !== slot) }),
  }),
]);

const COURSE_CORNERS = Object.freeze([
  // 3. The top corners into their own places, any way round. NO turn of the top before the cycle: the
  //    edges are home, and turning the top would take them away again.
  look({
    stage: 'top-corners', target: 'place', algs: COURSE_CYCLE, plies: 2, options: { auf: [''] },
    reached: (s) => topEdgesHome(s) && topCornersPlaced(s),
    goal: guard((s) => topEdgesHome(s) && topCornersPlaced(s)), why: 'topCorners.place',
    names: focus({ corners: namedCorners((st, slot) => st.cp[slot] !== slot) }),
  }),
  // 4. Each top corner turned up, one at a time at the front-right, turning only the top between them.
  //    Each step names the ONE corner it turns: the one at the front right once the top has been turned.
  look({
    stage: 'corners-turned', target: 'twist', algs: COURSE_TWIST, plies: 4, options: { rotations: [0] },
    reached: solvedButTheTop, goal: solvedButTheTop, why: 'topCorners.twist', afterSetup: true,
    names: focus({ corners: namedCorners((st, slot) => slot === CORNER.URF && st.co[slot] !== 0) }),
  }),
  // 5. The top turned to line up — the moment lesson 16 is written around.
  look({
    stage: 'corners-turned', target: 'align', algs: ALIGN, plies: 1, options: { post: AUF },
    reached: wholeCubeSolved, goal: wholeCubeSolved, why: 'lastLayer.align',
    names: focus({ corners: () => [], edges: () => [] }),
  }),
]);

/** The course's last layer, as the two stages a method has: its edges half where `oll` stands, its corners
 *  half where `pll` does. Not rungs of either — `methodFor` puts both in together or neither. */
export const COURSE_LAST_LAYER = Object.freeze({
  oll: Object.freeze({
    id: 'oll',
    rung: 'course',
    label: 'edges first',
    blurb: 'The top edges turned up and put home — lessons 13 and 14 of the course',
    targets: Object.freeze({ edges: Object.freeze([]), corners: Object.freeze([]) }),
    keep: firstTwoLayers,
    contract: topEdgesSolved,
    why: 'stage.oll',
    run: runLooks(COURSE_EDGES),
  }),
  pll: Object.freeze({
    id: 'pll',
    rung: 'course',
    label: 'corners home, then turned',
    blurb: 'The top corners put home, then each one turned up — lessons 15 and 16 of the course',
    targets: Object.freeze({ edges: Object.freeze([]), corners: Object.freeze([]) }),
    keep: topEdgesSolved,
    contract: wholeCubeSolved,
    why: 'stage.pll',
    run: runLooks(COURSE_CORNERS),
  }),
});
