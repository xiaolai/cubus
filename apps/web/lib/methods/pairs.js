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
import { edgesInLayerWithout } from '../cube-questions.js';
import {
  AUF, CROSS, F1L, F2L_PAIRS, MIDDLE, MethodSolverError, REGRIPS, U_CORNERS, U_EDGES,
  algLength, crossSolved, firstTwoLayers, fromRepertoire, joinAlg, keeping, repertoire, shortestTo, slotSafe,
  turnedCorner, turnedEdge,
} from './engine.js';

/** Putting a first-layer corner from the top into DFR. The three orientations it can be in,
 *  plus the trigger repeated, which is what the beginner method actually teaches. */
const F1L_INSERTS = [
  { name: 'right-hand', alg: "R U R'" },
  { name: 'left-hand', alg: "F' U' F" },
  { name: 'facing-up', alg: "R U2 R' U' R U R'" },
];

/** Middle-layer edges, as the course teaches them: the edge on top at the front goes down into the
 *  front-right slot, or the front-left one. The same algorithm inserts a correct edge and ejects a
 *  wrong one — which is exactly how it is taught, and why no separate "eject" table exists.
 *
 *  `insert-left` used to be `U' F' U F U R U' R'`, which goes into the front-RIGHT slot from the
 *  other side: a second way into one slot, where the course has one way into each of two (plan
 *  item 6.2). */
const MIDDLE_INSERTS = [
  { name: 'insert-right', alg: "U R U' R' U' F' U F" },
  { name: 'insert-left', alg: "U' L' U L U F U' F'" },
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

/** A part a pairs step can name that is not an algorithm: the turn that brings a slot to the front (plan
 *  item 6.3), named for the reason `align` is (lib/methods/last-layer.js) — a step's parts add up to its
 *  algorithm, and the turn is in it. */
export const PAIRS_EXTRAS = Object.freeze([Object.freeze({ name: 'turn', alg: '' })]);

/** Built once, for the reason `last-layer.js` gives at `look`: `repertoire` rotates and prefixes
 *  every entry, so rebuilding it inside a solve pays that for each of the four slots, every time. */
const F1L_REPERTOIRE = Object.freeze(repertoire(F1L_INSERTS));
/** The middle-layer inserts into a FRONT slot only: no rotated copies, so no B and no D turn. The cube is
 *  turned so the gap is in front instead (`frontInsert`, plan item 6.2). */
const FRONT_REPERTOIRE = Object.freeze(repertoire(MIDDLE_INSERTS, { rotations: [0] }));
/** The first-layer inserts into the front-right slot only, for the joined-pairs fallback, which turns the
 *  slot there first (plan item 6.3). The layer-by-layer first layer, built white up, keeps every rotation. */
const FRONT_F1L_REPERTOIRE = Object.freeze(repertoire(F1L_INSERTS, { rotations: [0] }));

/** The pieces a pair's algorithm may not disturb: every OTHER first-layer corner and every cross
 *  and middle edge but its own. Whether they happen to be solved yet is deliberately not asked —
 *  see `slotSafe`, and the F2L case that had ten answers before it was asked this way. */
const protectedCorners = (pair) => F1L.filter((c) => c !== pair.corner);
const protectedEdges = (pair) => [...CROSS, ...MIDDLE.filter((e) => e !== pair.edge)];

/**
 * The six triggers in the front-right slot's frame, with every AUF in front — the whole search space
 * of rung 1, built once instead of once per solve. One slot's frame, because every pair is worked
 * there: the cube is turned to bring its slot to the front right (plan item 6.3).
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
const FRONT_RIGHT_TRIGGERS = rotatedInto(F2L_TRIGGERS, F2L_PAIRS[0], 0);

/**
 * The 41 generated cases, in the front-right slot's frame — rung 2's whole repertoire.
 *
 * Checked for slot-safety exactly as the triggers are, and that check is not a formality here: the
 * table was searched in a projection that ignores the top layer, and "reaches the goal in that
 * projection" and "leaves the other slots alone" being the same statement is the argument the
 * whole table rests on. It is proved in `f2l.rs`, asserted by the generator, replayed by
 * `f2l-table.test.mjs` — and asked once more here, on the algorithms this rung will actually run.
 */
const FRONT_RIGHT_CASES = rotatedInto(F2L_CASES, F2L_PAIRS[0], 0);

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
 *  with the pairing rung, which falls back to it for a pair case it has no algorithm for.
 *
 *  `inserts` is the repertoire it drops the corner in with; `lead`, a turn of the whole cube made just
 *  before, folded into the first step emitted — `{ token, corner }`, the corner named as seen before the
 *  turn, which is the hold that step is made in (plan item 6.3). */
export function placeCorner(state, corner, intact, steps, stage, { inserts = F1L_REPERTOIRE, lead = null } = {}) {
  let first = lead;
  const push = (step) => {
    if (!first) { steps.push(step); return; }
    steps.push({ ...step, target: first.corner, alg: joinAlg(first.token, step.alg), why: { ...step.why, corner: first.corner, turn: true } });
    first = null;
  };
  const inTop = (s) => U_CORNERS.includes(cornerSlot(s, corner)) && intact(s);
  const lift = shortestTo(state, inTop, 4);
  if (lift === null) throw new MethodSolverError(stage, corner, state);
  if (lift) {
    state = applyAlg(state, lift);
    push({ stage, kind: 'goal', target: corner, alg: lift, why: { key: 'firstLayer.lift', corner } });
  }
  const home = (s) => cornerSolved(s, corner) && intact(s);
  const found = fromRepertoire(state, inserts, home);
  if (!found) throw new MethodSolverError(stage, corner, state);
  push({ stage, kind: 'case', target: corner, alg: found.alg,
    caseName: found.used[0].name, why: { key: 'firstLayer.insert', corner } });
  return found.state;
}

/**
 * The smallest turn of the whole cube after which one front insert, lined up with the top, puts `edge`
 * home — or, with `lift`, lifts it into the top — leaving `intactAt(turns)` true. `{ regrip, found }`, or
 * null. `edge` is named in `view`, and `intactAt(turns)` asks about the cube turned `turns` from it.
 */
function frontInsert(view, edge, intactAt, lift) {
  for (const regrip of REGRIPS) {
    const e = turnedEdge(edge, regrip.turns);
    const intact = intactAt(regrip.turns);
    const goal = lift
      ? (s) => U_EDGES.includes(edgeSlot(s, e)) && intact(s)
      : (s) => edgeSolved(s, e) && intact(s);
    const found = fromRepertoire(regrip.turns ? rotateState(view, regrip.turns) : view, FRONT_REPERTOIRE, goal);
    if (found) return { regrip, found };
  }
  return null;
}

/**
 * One edge, the middle layer's way (the joined-pairs rung's fallback, plan item 6.3): turned in from the
 * front, or lifted out and then turned in. `edge` is named in `view`; returns `{ state, turns }` as
 * `middleLayerInFront` does.
 */
function edgeInFront(view, edge, intactAt, steps, stage) {
  const push = (key, named, { regrip, found }) => steps.push({
    stage, kind: 'case', target: named, alg: joinAlg(regrip.token, found.alg), caseName: found.used[0].name,
    why: { key, edge: named, ...(regrip.token ? { turn: true } : {}) },
  });
  const direct = frontInsert(view, edge, intactAt, false);
  if (direct) {
    push('middleLayer.insert', edge, direct);
    return { state: direct.found.state, turns: direct.regrip.turns };
  }
  const out = frontInsert(view, edge, intactAt, true);
  const sofar = out ? out.regrip.turns : 0;
  const back = out && frontInsert(out.found.state, turnedEdge(edge, sofar), (t) => intactAt((sofar + t) % 4), false);
  if (!back) throw new MethodSolverError(stage, edge, view);
  push('middleLayer.eject', edge, out);
  push('middleLayer.insert', turnedEdge(edge, sofar), back);
  return { state: back.found.state, turns: (sofar + back.regrip.turns) % 4 };
}

/**
 * The middle layer THE WAY THE COURSE TEACHES IT (plan item 6.2). Look for a top edge carrying none of the
 * top colour; turn the whole cube, by the smallest turn that brings its slot to the front; send it down to
 * the right or the left. Only when no such edge is left is one stuck in the middle layer, and then the same
 * turn and insert lifts it out.
 *
 * The recognition is the named question (`edgesInLayerWithout`), asked of the cube as it is held before
 * each step, and it is what picks the edge — so `look`, the answer a step carries for its cue, is the set
 * the step's edge was chosen from. Among those, the smallest regrip wins, then the shortest insert.
 *
 * A regrip is part of the step it is made for: the step's hold is the one before it, so the pieces its
 * reason names are named in that hold, and `turn` says the step begins by turning the cube. `state` is the
 * cube as held; the return is `{ state, turns }`, the cube as held after the steps and how far their
 * regrips turned it, as `rotateState` counts.
 */
export function middleLayerInFront(state, steps, stage) {
  let view = state;
  let turns = 0;
  for (let made = 0; ; made++) {
    const home = MIDDLE.filter((e) => edgeSolved(view, e));
    if (home.length === MIDDLE.length) return { state: view, turns };
    // Every step either places an edge for good or lifts a stuck one into the top, where the next places
    // it: eight is the most four edges can take — all four flipped in their own slots — and a ninth is a
    // defect, said so. (Checked BEFORE a step, never after the loop: the eighth step can be the one that
    // finishes, and a guard after the loop refused exactly that cube.)
    if (made === 8) throw new MethodSolverError(stage, 'middle-layer', view);
    const intactAt = (t) => keeping([...CROSS, ...home.map((e) => turnedEdge(e, t))], F1L);
    const look = edgesInLayerWithout(view, 'U', 'U').pieces.map((name) => EDGE[name]);
    const inserting = look.length > 0;
    let best = null;
    for (const edge of inserting ? look : MIDDLE.filter((e) => !home.includes(e))) {
      const hit = frontInsert(view, edge, intactAt, !inserting);
      if (hit && (!best || hit.regrip.cost < best.regrip.cost
        || (hit.regrip.cost === best.regrip.cost && algLength(hit.found.alg) < algLength(best.found.alg)))) {
        best = { edge, ...hit };
      }
    }
    if (!best) throw new MethodSolverError(stage, 'middle-layer', view);
    steps.push({
      stage, kind: 'case', target: best.edge, alg: joinAlg(best.regrip.token, best.found.alg), caseName: best.found.used[0].name,
      why: {
        key: inserting ? 'middleLayer.insert' : 'middleLayer.eject',
        edge: best.edge,
        ...(best.regrip.token ? { turn: true } : {}),
        ...(inserting ? { look } : {}),
      },
    });
    view = best.found.state;
    turns = (turns + best.regrip.turns) % 4;
  }
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
  // THE GAP IN FRONT (plan item 6.2). A regrip turns the cube in the child's hands and nothing turns it
  // back, so what this stage returns is the cube as held after the last one.
  return middleLayerInFront(state, steps, 'middle-layer').state;
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
 *
 * The turn that brought the slot to the front right comes first, for the same reason (plan item 6.3).
 * `named` is the corner and edge as seen in the hold the step is made in, which is before that turn.
 */
function pairStep({ align, alg, used, caseName }, regrip, named) {
  const turning = regrip.token ? [{ name: 'turn', alg: regrip.token }] : [];
  const aligning = align ? [{ name: 'align', alg: align }] : [];
  const parts = [...turning, ...aligning, ...used].map((u) => ({ name: u.name, alg: u.alg }));
  return {
    stage: 'f2l',
    kind: 'case',
    target: named.corner,
    alg: joinAlg(regrip.token, align, alg),
    caseName,
    // The triggers stay attached: the case is what you recognise, the parts are how you get out of
    // it, and a learner meeting the case for the first time needs both.
    parts,
    why: { key: 'f2l.pair', corner: named.corner, edge: named.edge, ...(regrip.token ? { turn: true } : {}) },
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
 *
 * And by the same rule as the pair (plan item 6.3): the corner goes in with its slot turned to the front
 * right, the turn folded into its first step, and the edge by its own smallest turn, as the middle layer
 * does. `view` is the cube as held, `turns` the stage's quarter turns so far, and `edgesAt(t)` /
 * `cornersAt(t)` the placed pieces named `t` on. Returns `{ state, turns }`.
 */
function placeSeparately(view, pair, turns, regrip, named, steps, edgesAt, cornersAt) {
  let t = turns;
  if (!(cornerSolved(view, named.corner) && keeping(edgesAt(t), cornersAt(t))(view))) {
    t = (turns + regrip.turns) % 4;
    view = placeCorner(regrip.turns ? rotateState(view, regrip.turns) : view, F2L_PAIRS[0].corner,
      keeping(edgesAt(t), cornersAt(t)), steps, 'f2l',
      { inserts: FRONT_F1L_REPERTOIRE, lead: regrip.token ? { token: regrip.token, corner: named.corner } : null });
  }
  const withCorner = (at) => keeping(edgesAt(at), [...cornersAt(at), turnedCorner(pair.corner, at)]);
  const edge = turnedEdge(pair.edge, t);
  if (!(edgeSolved(view, edge) && withCorner(t)(view))) {
    const placed = edgeInFront(view, edge, (dt) => withCorner((t + dt) % 4), steps, 'f2l');
    view = placed.state;
    t = (t + placed.turns) % 4;
  }
  return { state: view, turns: t };
}

/**
 * Place every pair, from a repertoire and a ply budget.
 *
 * ONE function for both rungs, because the difference between them is genuinely only those two
 * arguments: rung 1 composes up to three triggers, rung 2 applies one generated algorithm. A
 * second copy of this loop would be two places for the fallback rule, the naming and the
 * slot-safety contract to drift apart.
 *
 * THE SLOT IN FRONT (plan item 6.3, decision D3). Every pair is worked at the front right: the cube is
 * turned, by the one turn that brings the pair's slot there, and nothing turns it back — so from the
 * first turn this is the cube as held after it, and every piece is named `turns` quarter turns on.
 */
const pairsFrom = (repertoire, plies) => function placePairs(state, steps) {
  const FRONT_RIGHT = F2L_PAIRS[0];
  let view = state;
  let turns = 0;
  const placedCorners = [];
  const placedEdges = [];
  const edgesAt = (t) => [...CROSS, ...placedEdges.map((e) => turnedEdge(e, t))];
  const cornersAt = (t) => placedCorners.map((c) => turnedCorner(c, t));
  for (const pair of F2L_PAIRS) {
    const named = { corner: turnedCorner(pair.corner, turns), edge: turnedEdge(pair.edge, turns) };
    if (!(cornerSolved(view, named.corner) && edgeSolved(view, named.edge))) {
      const regrip = REGRIPS.find((r) => turnedCorner(pair.corner, turns + r.turns) === FRONT_RIGHT.corner);
      const total = (turns + regrip.turns) % 4;
      const inFront = regrip.turns ? rotateState(view, regrip.turns) : view;
      // The pair is placed, and nothing else moved. The second half is not asked here: every route
      // this search can build is slot-safe by construction, checked once on the front-right tables.
      const done = (s) => cornerSolved(s, FRONT_RIGHT.corner) && edgeSolved(s, FRONT_RIGHT.edge);
      const found = buried(inFront, FRONT_RIGHT, cornersAt(total), edgesAt(total))
        ? null
        : searchPair(inFront, FRONT_RIGHT, 0, repertoire, plies, done);
      if (found) {
        steps.push(pairStep(found, regrip, named));
        view = found.state;
        turns = total;
      } else {
        ({ state: view, turns } = placeSeparately(view, pair, turns, regrip, named, steps, edgesAt, cornersAt));
      }
    }
    placedCorners.push(pair.corner);
    placedEdges.push(pair.edge);
  }
  return view;
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
    run: pairsFrom(FRONT_RIGHT_TRIGGERS, 3),
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
    run: pairsFrom(FRONT_RIGHT_CASES, 1),
  }),
]);
