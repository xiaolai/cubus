// The Pairs stage — the first two layers — and its rungs.
//
// The stage's contract is the state "first two layers solved". Both rungs end there, which is
// what makes them interchangeable under it (dev-docs/method-solver-return-plan.md §2).
//
//   rung 0  the corner, then the edge that belongs beside it. Two separate journeys per slot.
//   rung 1  the pair, joined and inserted together, built out of six triggers.
//   rung 2  the 41-case F2L table. Not here yet — it is Phase C, and it cannot be complete
//           (§7a finding F1), so rung 1's behaviour stays the floor beneath it.
//
// Rung 0 is where rung 1 falls back to when no trigger sequence reaches a pair, which is why
// `placeCorner` and `placeEdge` live here rather than inside either rung.

import {
  applyAlg, applyMove, cornerSlot, cornerSolved, edgeSlot, edgeSolved, rotateAlg, rotateState,
  CORNERS, EDGES, CORNER, EDGE,
} from '../cube-pieces.js';
import {
  AUF, CROSS, F1L, F2L_PAIRS, MIDDLE, MethodSolverError, U_CORNERS, U_EDGES,
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
  const found = fromRepertoire(state, repertoire(F1L_INSERTS), home);
  if (!found) throw new MethodSolverError(stage, corner, state);
  steps.push({ stage, kind: 'case', target: corner, alg: found.alg,
    caseName: found.used[0].name, why: { key: 'firstLayer.insert', corner } });
  return found.state;
}

/** Put a middle-layer edge in its slot. The same algorithm ejects a wrong edge and inserts the
 *  right one, which is why this may take two of them. */
export function placeEdge(state, edge, intact, steps, stage) {
  const home = (s) => edgeSolved(s, edge) && intact(s);
  const found = fromRepertoire(state, repertoire(MIDDLE_INSERTS), home, 2);
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
function f2lPosition(state, pair, turns) {
  // Turning the cube `4 - turns` brings slot `turns` to the front right, and carries the pair's
  // own cubies onto the front-right pair: corner DFR, edge FR.
  const inFrame = rotateState(state, (4 - (turns % 4)) % 4);
  const cornerAt = cornerSlot(inFrame, CORNER.DFR);
  const edgeAt = edgeSlot(inFrame, EDGE.FR);
  return `${CORNERS[cornerAt]}${inFrame.co[cornerAt]}/${EDGES[edgeAt]}${inFrame.eo[edgeAt]}`;
}

/**
 * The case, and how far to turn the top before it looks like the case.
 *
 * "Turn U until it matches" is not part of a case — it is what you do before you recognise one.
 * Folding the four alignments together is what takes the count from 287 positions down to the
 * 41 cases F2L is actually taught as, and it is verified to be faithful: no name covers two
 * different positions, only the four rotations of one.
 */
export function f2lAlignment(state, pair, turns) {
  let best = null;
  let bestTurns = 0;
  let aligned = state;
  for (let u = 0; u < 4; u++) {
    const name = f2lPosition(aligned, pair, turns);
    if (best === null || name < best) { best = name; bestTurns = u; }
    aligned = applyMove(aligned, 'U');
  }
  return { turns: bestTurns, name: best };
}

/** The case name alone, for tests and for anything that only wants to know which one it is. */
export const f2lCaseName = (state, pair, turns) => f2lAlignment(state, pair, turns).name;

function triggerPairs(state, steps) {
  const placedCorners = [];
  const placedEdges = [];
  for (const [slot, pair] of F2L_PAIRS.entries()) {
    const intact = keeping([...CROSS, ...placedEdges], placedCorners);
    // Every slot but this pair's, whether or not it happens to be solved yet.
    const otherCorners = F1L.filter((c) => c !== pair.corner);
    const otherEdges = [...CROSS, ...MIDDLE.filter((e) => e !== pair.edge)];
    const done = (s, alg) =>
      cornerSolved(s, pair.corner) && edgeSolved(s, pair.edge) &&
      slotSafe(alg, otherCorners, otherEdges, slot);
    // The empty algorithm is trivially slot-safe, so an already-placed pair short-circuits.
    if (done(state, '')) { placedCorners.push(pair.corner); placedEdges.push(pair.edge); continue; }

    const candidates = repertoire(F2L_TRIGGERS, { rotations: [slot] });
    const { turns, name: caseName } = f2lAlignment(state, pair, slot);
    // Line the top up first, then solve the case. That is the order a learner works in, and it
    // is also what makes the algorithm depend on the case rather than on where the top happened
    // to be — the difference between something memorable and a different answer every time.
    // Not applied to `state`: if no case reaches this pair we fall back to the rung below,
    // and that path starts from where the learner actually is, not from a turn we made for a
    // lookup that then failed.
    const align = AUF[turns];
    const aligned = align ? applyAlg(state, align) : state;
    // Two nodes are the same when this pair is in the same place and the route so far is
    // equally slot-safe. Deduplicating on the WHOLE cube instead made the search's choice
    // depend on the other 18 pieces, which is how one case ended up with three algorithms.
    const keyOf = (s, alg) => {
      const c = cornerSlot(s, pair.corner);
      const e = edgeSlot(s, pair.edge);
      return `${c}.${s.co[c]}|${e}.${s.eo[e]}|${slotSafe(alg, otherCorners, otherEdges, slot) ? 1 : 0}`;
    };
    // Fast path: the pair is already loose, so a short run of triggers places it.
    // Rank in the front-right frame: the same case must get the same algorithm whichever slot
    // it appears in, or there is nothing to learn.
    const inFrontRightFrame = (alg) => rotateAlg(alg, (4 - slot) % 4);
    let found = fromRepertoire(aligned, candidates, done, 3, keyOf, inFrontRightFrame);
    let ejected = null;
    if (!found) {
      // One or both pieces are buried in a slot. Taking them out first is the thing a learner
      // is taught before any pair case, and it is also what turns one unreachable search into
      // two reachable ones.
      const loose = (s, alg) =>
        U_CORNERS.includes(cornerSlot(s, pair.corner)) && U_EDGES.includes(edgeSlot(s, pair.edge)) &&
        slotSafe(alg, otherCorners, otherEdges, slot);
      ejected = fromRepertoire(aligned, candidates, loose, 2, keyOf, inFrontRightFrame);
      // Both halves slot-safe means the whole thing is, so the pair still has one answer.
      if (ejected) found = fromRepertoire(ejected.state, candidates, done, 3, keyOf, inFrontRightFrame);
    }

    if (!found) {
      // No pair case reaches this one. Rather than fail, do the pair the way the rung below
      // does — corner first, then its edge. This is not a workaround, it is what a learner
      // actually does with a case they have not met yet, and it keeps the step honest: it
      // says which one it is. §7a finding F1 says this fallback is STRUCTURAL — a piece buried
      // in another protected slot cannot leave it under `slotSafe` — so rung 2 shrinks it and
      // cannot remove it.
      // Only what is actually out of place. The fallback used to lift and reinsert unconditionally,
      // so a pair whose CORNER was already home cost two steps to put it back where it was — five
      // steps where the rung below took three, on a cube the rung above was supposed to be better
      // at. Checked per piece, in the order they are placed, because placing the corner can move
      // the edge.
      if (!(cornerSolved(state, pair.corner) && intact(state))) {
        state = placeCorner(state, pair.corner, intact, steps, 'f2l');
      }
      const withCorner = keeping([...CROSS, ...placedEdges], [...placedCorners, pair.corner]);
      if (!(edgeSolved(state, pair.edge) && withCorner(state))) {
        state = placeEdge(state, pair.edge, withCorner, steps, 'f2l');
      }
      placedCorners.push(pair.corner);
      placedEdges.push(pair.edge);
      continue;
    }

    // The alignment is part of the step's algorithm, so it is part of the step's PARTS. Without it
    // the two disagreed: a step whose alg was `R U R'` listed a single part of `U R U R'`, which
    // does not solve the pair — and "open the step up to see how it is made" is the whole reason
    // `parts` exists. It is named for what it is rather than folded into the trigger beside it,
    // because turning the top until it matches is not one of the six triggers.
    const aligning = align ? [{ name: 'align', alg: align }] : [];
    const used = [...aligning, ...(ejected ? [...ejected.used, ...found.used] : found.used)];
    const alg = [align, ejected ? `${ejected.alg} ${found.alg}` : found.alg].filter(Boolean).join(' ').trim();
    state = found.state;
    // One step, not three: the pair is the unit a learner recognises at this rung. The
    // triggers stay attached so the step can be opened up when it is still unfamiliar.
    steps.push({ stage: 'f2l', kind: 'case', target: pair.corner, alg, caseName,
      // The triggers stay attached: the case is what you recognise, the parts are how you get
      // out of it, and a learner meeting the case for the first time needs both.
      parts: used.map((u) => ({ name: u.name, alg: u.alg })),
      why: { key: 'f2l.pair', corner: pair.corner, edge: pair.edge, ejected: Boolean(ejected) } });
    placedCorners.push(pair.corner);
    placedEdges.push(pair.edge);
  }
  return state;
}

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
    run: triggerPairs,
  }),
]);
