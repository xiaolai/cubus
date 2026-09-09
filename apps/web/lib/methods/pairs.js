// The Pairs stage — the first two layers — and its rungs.
//
// The stage's contract is the state "first two layers solved". Both rungs end there, which is
// what makes them interchangeable under it (dev-docs/method-solver-return-plan.md §2).
//
//   rung 0  the corner, then the edge that belongs beside it. Two separate journeys per slot.
//   rung 1  the pair, joined and inserted together, built out of six triggers.
//   rung 2  the 41-case F2L table, generated and proved (lib/data/case-tables.js). It cannot be
//           complete (§7a finding F1), so rung 1's fallback stays the floor beneath it — rung 2
//           reaches exactly the same 150 configurations, in fewer moves.
//
// Rung 0 is where rung 1 falls back to when no trigger sequence reaches a pair, which is why
// `placeCorner` and `placeEdge` live here rather than inside either rung.

import {
  applyAlg, applyMove, cornerSlot, cornerSolved, edgeSlot, edgeSolved, rotateAlg, rotateState,
  CORNERS, EDGES, CORNER, EDGE,
} from '../cube-pieces.js';
import { F2L_CASES } from '../data/case-tables.js';
import {
  AUF, CROSS, F1L, F2L_PAIRS, MIDDLE, MethodSolverError, U_CORNERS,
  crossSolved, firstTwoLayers, fromRepertoire, keeping, repertoire, shortestTo, slotSafe,
} from './engine.js';

/** Putting a first-layer corner from the top into DFR. The three orientations it can be in,
 *  plus the trigger repeated, which is what the beginner method actually teaches. */
const F1L_INSERTS = [
  { name: 'right-hand', alg: "R U R'" },
  { name: 'left-hand', alg: "F' U' F" },
  { name: 'facing-up', alg: "R U2 R' U' R U R'" },
];

/** Middle-layer edges. The same pair of algs both inserts a correct edge and ejects a wrong
 *  one — which is exactly how it is taught, and why no separate "eject" table exists. */
const MIDDLE_INSERTS = [
  { name: 'insert-right', alg: "U R U' R' U' F' U F" },
  { name: 'insert-left', alg: "U' F' U F U R U' R'" },
];

const F2L_TRIGGERS = [
  { name: 'right', alg: "R U R'" },
  { name: 'right-back', alg: "R U' R'" },
  { name: 'right-half', alg: "R U2 R'" },
  { name: 'left', alg: "F' U' F" },
  { name: 'left-back', alg: "F' U F" },
  { name: 'left-half', alg: "F' U2 F" },
];

export const PAIRS_ALGS = [...F1L_INSERTS, ...MIDDLE_INSERTS, ...F2L_TRIGGERS];

/** Built once, for the reason `last-layer.js` gives at `look`: `repertoire` rotates and prefixes
 *  every entry, so rebuilding it inside a solve pays that for each of the four slots, every time. */
const F1L_REPERTOIRE = Object.freeze(repertoire(F1L_INSERTS));
const MIDDLE_REPERTOIRE = Object.freeze(repertoire(MIDDLE_INSERTS));

/** The pieces a pair's algorithm may not disturb: every OTHER first-layer corner and every cross
 *  and middle edge but its own. Whether they happen to be solved yet is deliberately not asked —
 *  see `slotSafe`, and the F2L case that had ten answers before it was asked this way. */
const protectedCorners = (pair) => F1L.filter((c) => c !== pair.corner);
const protectedEdges = (pair) => [...CROSS, ...MIDDLE.filter((e) => e !== pair.edge)];

/**
 * The six triggers turned into each slot's frame, with every AUF in front — the whole search
 * space of rung 1, built once instead of once per solve.
 *
 * **Slot-safety is checked HERE, and that is why the search does not check it.** It is a property
 * of an algorithm on a solved cube, so an algorithm that leaves the protected slots holding their
 * own cubies untwisted still does after another one that also does — the property survives
 * composition. Every route the search can build is therefore slot-safe because every step of it
 * is, which made the per-node `slotSafe` call a constant computed 24 times a ply and the
 * slot-safety bit in the dedup key a partition into one part.
 *
 * A seventh trigger that broke the property would not fail a test; it would quietly widen what
 * this rung claims to teach, and the widening would only show up as an F2L case with two answers.
 * So it fails here, at load, naming the algorithm.
 */
const SLOT_REPERTOIRE = Object.freeze(F2L_PAIRS.map((pair, slot) => rotatedInto(F2L_TRIGGERS, pair, slot)));

/**
 * The 41 generated cases, rotated into each slot's frame — rung 2's whole repertoire.
 *
 * Checked for slot-safety exactly as the triggers are, and that check is not a formality here: the
 * table was searched in a projection that ignores the top layer, and "reaches the goal in that
 * projection" and "leaves the other slots alone" being the same statement is the argument the
 * whole table rests on. It is proved in `f2l.rs`, asserted by the generator, replayed by
 * `f2l-table.test.mjs` — and asked once more here, on the algorithms this rung will actually run.
 */
const SLOT_CASES = Object.freeze(F2L_PAIRS.map((pair, slot) => rotatedInto(F2L_CASES, pair, slot)));

/** A table of algorithms in one slot's frame, refused if any of them disturbs a protected slot. */
function rotatedInto(algs, pair, slot) {
  const candidates = repertoire(algs, { rotations: [slot] });
  const unsafe = candidates.find((c) => !slotSafe(c.alg, protectedCorners(pair), protectedEdges(pair), slot));
  if (unsafe) {
    throw new Error(`pairs: "${unsafe.name}" ("${unsafe.alg}") disturbs a slot it must not`);
  }
  return Object.freeze(candidates);
}

// ---- the two shared journeys ------------------------------------------------------------------

/** Lift a corner to the top and drop it into its slot: two steps, the beginner's way. Shared
 *  with the pairing rung, which falls back to it for a pair case it has no algorithm for. */
export function placeCorner(state, corner, intact, steps, stage) {
  const inTop = (s) => U_CORNERS.includes(cornerSlot(s, corner)) && intact(s);
  const lift = shortestTo(state, inTop, 4);
  if (lift === null) throw new MethodSolverError(stage, corner, state);
  if (lift) {
    state = applyAlg(state, lift);
    steps.push({ stage, kind: 'goal', target: corner, alg: lift, why: { key: 'firstLayer.lift', corner } });
  }
  const home = (s) => cornerSolved(s, corner) && intact(s);
  const found = fromRepertoire(state, F1L_REPERTOIRE, home);
  if (!found) throw new MethodSolverError(stage, corner, state);
  steps.push({ stage, kind: 'case', target: corner, alg: found.alg,
    caseName: found.used[0].name, why: { key: 'firstLayer.insert', corner } });
  return found.state;
}

/** Put a middle-layer edge in its slot. The same algorithm ejects a wrong edge and inserts the
 *  right one, which is why this may take two of them. */
export function placeEdge(state, edge, intact, steps, stage) {
  const home = (s) => edgeSolved(s, edge) && intact(s);
  const found = fromRepertoire(state, MIDDLE_REPERTOIRE, home, 2);
  if (!found) throw new MethodSolverError(stage, edge, state);
  // The SAME algorithm ejects a wrong edge and inserts the right one, which is why this may take
  // two of them — and why one caption cannot serve both. A step that lifts the edge OUT of the
  // middle layer while the sentence says "send this edge down" is describing the opposite of what
  // the learner is about to watch. Which one it is is read from the cube, not assumed: replay each
  // application and see whether the edge ends up home.
  let cursor = state;
  for (const used of found.used) {
    const after = applyAlg(cursor, used.alg);
    steps.push({ stage, kind: 'case', target: edge, alg: used.alg, caseName: used.name,
      why: { key: edgeSolved(after, edge) ? 'middleLayer.insert' : 'middleLayer.eject', edge } });
    cursor = after;
  }
  return found.state;
}

// ---- rung 0: the corner, then its edge ---------------------------------------------------------

function cornerThenEdge(state, steps) {
  const placedCorners = [];
  for (const corner of F1L) {
    const intact = keeping(CROSS, placedCorners);
    if (cornerSolved(state, corner) && intact(state)) { placedCorners.push(corner); continue; }
    state = placeCorner(state, corner, intact, steps, 'first-layer');
    placedCorners.push(corner);
  }
  const placedEdges = [];
  for (const edge of MIDDLE) {
    const intact = keeping([...CROSS, ...placedEdges], F1L);
    if (edgeSolved(state, edge) && intact(state)) { placedEdges.push(edge); continue; }
    state = placeEdge(state, edge, intact, steps, 'middle-layer');
    placedEdges.push(edge);
  }
  return state;
}

// ---- rung 1: the pair, joined and inserted together --------------------------------------------
// The rung below puts the corner in, then goes back for the edge that belongs beside it — two
// steps, and the second one has to undo part of the first. Pairing them is the single largest
// step reduction available: ten steps become four.
//
// No memorised case list at this rung. The moves are the same triggers the rung below already
// uses, and the step is whichever short sequence of them provably places the pair. That keeps the
// reason intact — pair them up, then insert the pair — and keeps the table from being a list of
// 41 algorithms nobody checked. Rung 2 is that list, generated and proved; it is Phase C.
//
// **There used to be an ejection branch here, and it could never run.** When the direct search
// failed it tried to lift the pair loose first, then place it. `f2l-configurations.test.mjs`
// enumerates the search's ENTIRE input space — the 384 places the corner and its edge can be,
// which is exhaustive because the search reads nothing else about the cube — and the split is
// 150 solved directly, 234 falling back, none ejected. The reason is not the sample: a slot-safe
// algorithm fixes the protected slots as POSITIONS, so a piece sitting in one can never leave it,
// and the ejection goal — both pieces up in the top layer — is unsatisfiable in exactly the cases
// that reach the branch. The 150 are every configuration with neither piece buried elsewhere, and
// they are the 41 taught cases once the four top-layer alignments are folded together.

/**
 * The name of the F2L case: where the corner and its edge are, seen from the working slot.
 *
 * Deliberately NOT the sequence of triggers that solves it. A learner recognises a position and
 * recalls what to do; naming the step after the moves would name it after the answer, and would
 * produce a different "case" every time the search took a different route to the same place.
 *
 * The whole STATE is turned until the slot being worked on is at the front right, and the pair is
 * read there. An earlier version relabelled the slot names instead and read the flip where it
 * stood — which describes a situation that does not exist, because edge orientation is measured
 * against the F/B axis and is not invariant under the turn (see `rotateState`). That is exactly
 * why one case used to come out with a different algorithm depending on which slot it was in.
 */
function f2lPosition(state, turns) {
  // Turning the cube `4 - turns` brings slot `turns` to the front right, and carries the pair's
  // own cubies onto the front-right pair: corner DFR, edge FR. Which pair it is therefore does
  // not need to be passed — the rotation is what identifies it, and a `pair` argument alongside
  // was a second way to say the same thing that nothing read and nothing kept in step.
  const inFrame = rotateState(state, (4 - (turns % 4)) % 4);
  const cornerAt = cornerSlot(inFrame, CORNER.DFR);
  const edgeAt = edgeSlot(inFrame, EDGE.FR);
  return `${CORNERS[cornerAt]}${inFrame.co[cornerAt]}/${EDGES[edgeAt]}${inFrame.eo[edgeAt]}`;
}

/**
 * The case, and how far to turn the top before it looks like the case.
 *
 * "Turn U until it matches" is not part of a case — it is what you do before you recognise one.
 * Folding the four alignments together is what turns the 150 REACHABLE configurations into 42
 * names — the 41 cases F2L is taught as, plus the one where the pair is already placed. (The
 * whole domain is 384; the other 234 have a piece buried in a protected slot and never reach a
 * case at all. `f2l-configurations.test.mjs` enumerates both halves.) The fold is verified to be
 * faithful: no name covers two different positions, only the four rotations of one.
 */
export function f2lAlignment(state, turns) {
  let best = null;
  let bestTurns = 0;
  let aligned = state;
  for (let u = 0; u < 4; u++) {
    const name = f2lPosition(aligned, turns);
    if (best === null || name < best) { best = name; bestTurns = u; }
    aligned = applyMove(aligned, 'U');
  }
  return { turns: bestTurns, name: best };
}

/** The case name alone, for tests and for anything that only wants to know which one it is. */
export const f2lCaseName = (state, turns) => f2lAlignment(state, turns).name;

/**
 * Place every pair, from a repertoire and a ply budget.
 *
 * ONE function for both rungs, because the difference between them is genuinely only those two
 * arguments: rung 1 composes up to three triggers, rung 2 applies one generated algorithm. A
 * second copy of this loop would be two places for the fallback rule, the naming and the
 * slot-safety contract to drift apart.
 */
/**
 * Is a piece of this pair sitting somewhere the algorithm may not disturb?
 *
 * §7a finding F1: a corner in another pair's solved slot, or an edge in a cross slot or another
 * pair's slot, cannot come out under a maneuver that leaves those slots alone. So the repertoire
 * search cannot succeed, and running it is 912 candidate applications to discover that — on 234 of
 * the 384 configurations, which `f2l-configurations.test.mjs` enumerates exhaustively and whose
 * line is exactly this predicate. Asking first is not an optimisation of the search; it is
 * declining to ask a question with a known answer.
 */
const buried = (state, pair, protectedCorners, protectedEdges) =>
  protectedCorners.includes(cornerSlot(state, pair.corner))
  || protectedEdges.includes(edgeSlot(state, pair.edge));

/**
 * Line the top up, then look for one case that places the pair.
 *
 * The alignment comes first because that is the order a learner works in, and because it is what
 * makes the algorithm depend on the CASE rather than on where the top happened to be — the
 * difference between something memorable and a different answer every time. It is not applied to
 * the caller's state: if no case reaches this pair the fallback starts from where the learner
 * actually is, not from a turn we made for a lookup that then failed.
 */
function searchPair(state, pair, slot, candidates, plies, done) {
  const { turns, name: caseName } = f2lAlignment(state, slot);
  const align = AUF[turns];
  const aligned = align ? applyAlg(state, align) : state;
  // Two nodes are the same when this pair is in the same place. Deduplicating on the WHOLE cube
  // instead made the search's choice depend on the other 18 pieces, which is how one case ended
  // up with three algorithms. The route's slot-safety used to be a third field here and was
  // always 1 — it partitioned nothing, at the cost of a `slotSafe` call per node.
  const keyOf = (s) => {
    const c = cornerSlot(s, pair.corner);
    const e = edgeSlot(s, pair.edge);
    return `${c}.${s.co[c]}|${e}.${s.eo[e]}`;
  };
  // Rank in the front-right frame: the same case must get the same algorithm whichever slot
  // it appears in, or there is nothing to learn.
  const inFrontRightFrame = (alg) => rotateAlg(alg, (4 - slot) % 4);
  const found = fromRepertoire(aligned, candidates, done, plies, keyOf, inFrontRightFrame);
  return found ? { ...found, align, caseName } : null;
}

/**
 * The pair as ONE step — the unit a learner recognises at this rung.
 *
 * The alignment is part of the step's algorithm, so it is part of the step's PARTS. Without it the
 * two disagreed: a step whose alg was `R U R'` listed a single part of `U R U R'`, which does not
 * solve the pair — and "open the step up to see how it is made" is the whole reason `parts`
 * exists. It is named for what it is rather than folded into the trigger beside it, because
 * turning the top until it matches is not one of the six triggers.
 */
function pairStep({ align, alg, used, caseName }, pair) {
  const aligning = align ? [{ name: 'align', alg: align }] : [];
  const parts = [...aligning, ...used].map((u) => ({ name: u.name, alg: u.alg }));
  return {
    stage: 'f2l',
    kind: 'case',
    target: pair.corner,
    alg: [align, alg].filter(Boolean).join(' ').trim(),
    caseName,
    // The triggers stay attached: the case is what you recognise, the parts are how you get out of
    // it, and a learner meeting the case for the first time needs both.
    parts,
    why: { key: 'f2l.pair', corner: pair.corner, edge: pair.edge },
  };
}

/**
 * The fallback: do the pair the way the rung below does — corner first, then its edge.
 *
 * Not a workaround. It is what a learner actually does with a case they have not met yet, and it
 * keeps the step honest by saying which one it is. §7a finding F1 says this path is STRUCTURAL — a
 * piece buried in another protected slot cannot leave it under `slotSafe` — so rung 2 shrinks it
 * and cannot remove it.
 *
 * Only what is actually out of place. This used to lift and reinsert unconditionally, so a pair
 * whose CORNER was already home cost two steps to put it back where it was — five steps where the
 * rung below took three, on a cube the rung above was supposed to be better at. Checked per piece,
 * in the order they are placed, because placing the corner can move the edge.
 */
function placeSeparately(state, pair, steps, protectedEdges, placedCorners) {
  const intact = keeping(protectedEdges, placedCorners);
  if (!(cornerSolved(state, pair.corner) && intact(state))) {
    state = placeCorner(state, pair.corner, intact, steps, 'f2l');
  }
  const withCorner = keeping(protectedEdges, [...placedCorners, pair.corner]);
  if (!(edgeSolved(state, pair.edge) && withCorner(state))) {
    state = placeEdge(state, pair.edge, withCorner, steps, 'f2l');
  }
  return state;
}

/**
 * Place every pair, from a repertoire and a ply budget.
 *
 * ONE function for both rungs, because the difference between them is genuinely only those two
 * arguments: rung 1 composes up to three triggers, rung 2 applies one generated algorithm. A
 * second copy of this loop would be two places for the fallback rule, the naming and the
 * slot-safety contract to drift apart.
 */
const pairsFrom = (repertoires, plies) => function placePairs(state, steps) {
  const placedCorners = [];
  const placedEdges = [];
  for (const [slot, pair] of F2L_PAIRS.entries()) {
    const protectedEdges = [...CROSS, ...placedEdges];
    // The pair is placed, and nothing else moved. The second half is not asked here: every route
    // this search can build is slot-safe by construction, checked once on `SLOT_REPERTOIRE`.
    const done = (s) => cornerSolved(s, pair.corner) && edgeSolved(s, pair.edge);
    if (!done(state)) {
      const found = buried(state, pair, placedCorners, protectedEdges)
        ? null
        : searchPair(state, pair, slot, repertoires[slot], plies, done);
      if (found) {
        steps.push(pairStep(found, pair));
        state = found.state;
      } else {
        state = placeSeparately(state, pair, steps, protectedEdges, placedCorners);
      }
    }
    placedCorners.push(pair.corner);
    placedEdges.push(pair.edge);
  }
  return state;
};

// ---- the rungs, as data ----------------------------------------------------------------------

/** @type {ReadonlyArray<import('./index.js').Stage>} */
export const PAIRS_RUNGS = Object.freeze([
  Object.freeze({
    id: 'pairs',
    rung: 0,
    label: 'corner, then edge',
    blurb: 'Each corner placed on its own, then the edge that belongs beside it',
    targets: Object.freeze({ edges: MIDDLE, corners: F1L }),
    keep: crossSolved,
    contract: firstTwoLayers,
    why: 'stage.pairs',
    run: cornerThenEdge,
  }),
  Object.freeze({
    id: 'pairs',
    rung: 1,
    label: 'trigger pairs',
    blurb: 'The corner joined to its edge and the pair put in together, out of six triggers',
    targets: Object.freeze({ edges: MIDDLE, corners: F1L }),
    keep: crossSolved,
    contract: firstTwoLayers,
    why: 'stage.pairs',
    run: pairsFrom(SLOT_REPERTOIRE, 3),
  }),
  Object.freeze({
    id: 'pairs',
    rung: 2,
    label: 'the F2L cases',
    blurb: 'One algorithm per case — 41 of them, each the shortest maneuver that places the pair',
    targets: Object.freeze({ edges: MIDDLE, corners: F1L }),
    keep: crossSolved,
    contract: firstTwoLayers,
    why: 'stage.pairs',
    run: pairsFrom(SLOT_CASES, 1),
  }),
]);
