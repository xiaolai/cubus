// What an algorithm DOES to a solved cube, computed from the move tables and never written down beside it.
//
// dev-docs/algorithm-drill-v2-plan.md §2. Every field here is arithmetic over `cube-pieces.js`, read through
// the app's one interpreter (`run` in `lib/cube-moves.js`), so a face turn, a wide turn (`r`, `Rw`, `2Rw`), a
// slice (`M`, `E`, `S`) and a whole-cube turn (`x`, `y`, `z`) are all read as what they do. A hand-written
// "Sune twists three corners" would be a claim beside the algorithm; this module is the measurement, and a
// later module (WI-3) turns it into words. Nothing here produces a sentence.
//
// THE FRAME EVERYTHING IS NAMED IN is the frame the algorithm's LETTERS are written in: `URF` is the corner
// at the up-right-front of the cube as the learner holds it when the algorithm begins, wherever that corner
// is in the scan frame. That is the only frame in which an algorithm's own letters mean anything, and it is
// the frame every table in this repository declares — the human-speed table, CMLL and the method engine's
// repertoires are all written in the METHOD frame (white on D, `METHOD_FRAME` in `lib/solving-hold.js`), so
// for them "the bottom" is the white side and "the cross" is the white cross. The piece model keeps pieces
// RELATIVE TO THE CENTRES, so every position below is a place relative to the centres, and an algorithm whose
// slices or rotations do not cancel ends with the centres somewhere else: that is reported as the hold it
// ends in (`endHold`), never folded into the pieces.
//
// The `hold` option says how the cube is held when the algorithm begins, as `[up, front]` in the SCAN frame's
// letters (ADR 0004). It changes exactly one thing — which scan-frame faces `endHold` names — because the
// effect relative to the learner's hands is the same whichever way the cube is held. The piece fields are
// computed in the letters' own frame and are hold-free by construction.
//
// WHAT CHANGED FROM THE FIRST VERSION (deleted with the old Drill in 33860b1): that one refused an algorithm
// that leaves the cube turned, because its order "would be of something nobody performs". It has an order —
// repeat the algorithm, each time reading its letters in the hold in force, until pieces AND hold are back —
// and `orderOf` computes it. The first version's four counts (`corners`, `edges`, `twisted`, `flipped`) keep
// their names and meaning, so a face-turn algorithm measures exactly as it did.
import { CORNERS, EDGES, SOLVED } from './cube-pieces.js';
import { run } from './cube-moves.js';
import { CROSS, F1L, crossSolved, firstTwoLayers, keeping } from './methods/engine.js';
import { bothBlocksBuilt, firstBlockBuilt } from './methods/roux-blocks.js';

/** The hold whose letters are the cube's own: what the letters-frame measurement is run in. */
const OWN_HOLD = Object.freeze(['U', 'F']);

const sameHold = (a, b) => a[0] === b[0] && a[1] === b[1];

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a / gcd(a, b)) * b;

/**
 * The cycles of one kind of piece, each as the positions a piece travels through and the orientation it
 * has gathered by the time it is back where it started.
 *
 * DIRECTION: `positions: ['UF', 'UL', 'UR']` means the piece at UF goes to UL, the one at UL to UR, and the
 * one at UR to UF. In the piece model `perm[i]` is the piece now AT slot i, so the piece that started at
 * slot `a` is now at the slot `i` with `perm[i] === a` — the walk below follows that. Each cycle starts at
 * its lowest slot in cubejs's order (`CORNERS`, `EDGES`), so one effect has one spelling.
 *
 * `turn` is the cycle's NET orientation, summed over the whole cycle: the orientation a piece carries after
 * going once round it. It is frame-free where a single moved piece's orientation is not (an edge's flip is
 * measured against the F/B axis, `rotateState` in `cube-pieces.js`), and it is what decides the cycle's
 * order: a 3-cycle with a net twist takes nine repetitions, not three. A cycle of length one with a turn is a
 * piece twisted or flipped IN PLACE, and is listed with the twists rather than here.
 */
function cyclesOf(perm, ori, names, mod) {
  const seen = new Array(perm.length).fill(false);
  const cycles = [];
  const inPlace = [];
  const whereNow = new Array(perm.length);
  perm.forEach((piece, slot) => { whereNow[piece] = slot; });
  for (let start = 0; start < perm.length; start += 1) {
    if (seen[start]) continue;
    const slots = [];
    let turn = 0;
    for (let at = start; !seen[at]; at = whereNow[at]) {
      seen[at] = true;
      slots.push(at);
      turn += ori[at];
    }
    turn %= mod;
    if (slots.length === 1) {
      if (turn !== 0) inPlace.push(Object.freeze({ position: names[start], turn }));
    } else {
      cycles.push(Object.freeze({ positions: Object.freeze(slots.map((s) => names[s])), turn }));
    }
  }
  return { cycles, inPlace };
}

/** Cycle lengths, longest first — the first version's `corners` / `edges`, kept for the same reason: a
 *  length is frame-free where a position is not. */
const lengthsOf = (cycles) => Object.freeze(cycles.map((c) => c.positions.length).sort((a, b) => b - a));

/** Even or odd, from cycle lengths: a k-cycle is k-1 swaps. Corner and edge parity are equal on every
 *  reachable cube, so one word describes both; the test holds the two equal rather than assuming it. */
const parityOf = (cycles) => (cycles.reduce((n, c) => n + c.positions.length - 1, 0) % 2 === 0 ? 'even' : 'odd');

/** The order of a piece state that leaves the hold alone: the lcm over its cycles of length × (3 or 2 when
 *  the cycle's net turn is not zero, else 1), in-place twists and flips included as cycles of length one. */
function pieceOrder(state) {
  const c = cyclesOf(state.cp, state.co, CORNERS, 3);
  const e = cyclesOf(state.ep, state.eo, EDGES, 2);
  let order = 1;
  for (const cyc of c.cycles) order = lcm(order, cyc.positions.length * (cyc.turn ? 3 : 1));
  for (const cyc of e.cycles) order = lcm(order, cyc.positions.length * (cyc.turn ? 2 : 1));
  if (c.inPlace.length) order = lcm(order, 3);
  if (e.inPlace.length) order = lcm(order, 2);
  return order;
}

/** One application read from the letters' own hold: the pieces relative to the centres, and the hold the
 *  learner ends in, both in the letters' frame. */
const played = (alg) => run(alg, OWN_HOLD, SOLVED);

/**
 * How many repetitions bring the cube back — every piece home AND the cube held as it was at the start.
 *
 * STRUCTURE, NOT A SEARCH. When the algorithm leaves the hold alone this is the lcm of its cycle orders. When
 * it turns the cube, its whole-cube part is a rotation of order k (one, two, three or four — the hold comes
 * back within four repetitions on every one of the 24); k repetitions are then a pure piece effect, and the
 * order is k times that effect's order. Each repetition reads the letters in the hold in force, which is what
 * a learner repeating the algorithm does — and what cubejs does, which is why it can judge this.
 */
export function orderOf(alg) {
  let now = played(alg);
  let k = 1;
  // `run` from SOLVED in the letters' hold: the hold after k repetitions is the rotation to the k-th power.
  while (!sameHold(now.hold, OWN_HOLD)) {
    k += 1;
    if (k > 4) throw new Error(`alg-effect: "${alg}" did not bring the hold back in four repetitions, which every rotation does`);
    now = run(alg, now.hold, now.state);
  }
  return k * pieceOrder(now.state);
}

/**
 * The regions `keepsOf` can claim, each a predicate on a piece state relative to the centres, named in the
 * letters' frame: `D` is the BOTTOM, so for every table in this repository (written in the method frame,
 * white on D) "the cross" is the white cross. The predicates are the method engine's and the Roux blocks'
 * own, never a second copy of which slots a region holds.
 *
 * `centres` is the odd one out: the centres cannot move relative to themselves, so it asks the other thing —
 * whether the cube ends held as it began. An algorithm with an uncancelled slice or rotation keeps every
 * piece region it keeps relative to the centres, carried round with the whole cube, and does NOT keep
 * `centres`. Ordered from smallest to largest within each method, so a caller can say the largest.
 */
export const REGIONS = Object.freeze([
  Object.freeze({ id: 'centres', kept: (_state, hold) => sameHold(hold, OWN_HOLD) }),
  Object.freeze({ id: 'cross', kept: (state) => crossSolved(state) }),
  Object.freeze({ id: 'first-layer', kept: (state) => keeping(CROSS, F1L)(state) }),
  Object.freeze({ id: 'first-two-layers', kept: (state) => firstTwoLayers(state) }),
  Object.freeze({ id: 'first-block', kept: (state) => firstBlockBuilt(state) }),
  Object.freeze({ id: 'both-blocks', kept: (state) => bothBlocksBuilt(state) }),
]);

/** The ids of every region an algorithm leaves as it found it on a solved cube, in `REGIONS` order. Judged
 *  at the END of the algorithm: a region taken apart and rebuilt on the way (every last-layer algorithm
 *  breaks the first two layers mid-way) is kept. */
export function keepsOf(alg) {
  const { state, hold } = played(alg);
  return Object.freeze(REGIONS.filter((r) => r.kept(state, hold)).map((r) => r.id));
}

/**
 * Everything measurable about one algorithm's effect on a solved cube, frozen.
 *
 *   alg, moves          the text and its token count
 *   hold, endHold       `[up, front]` in the scan frame's letters: how the cube is held at the start (the
 *                       option) and at the end. `keepsHold` is whether they are the same.
 *   cornerCycles,       the pieces that change place, as cycles (see `cyclesOf`): `{ positions, turn }`,
 *   edgeCycles          `turn` the net twist (corners, 0–2) or flip (edges, 0–1) gathered going once round.
 *   twistedInPlace      corners that stay in their slot turned: `{ position, turn }`, `turn` 1 when the
 *                       corner's U/D sticker has moved one facelet round it in the order of its name (URF:
 *                       from U to R) — clockwise seen from outside the corner — and 2 the other way.
 *   flippedInPlace      edges that stay in their slot flipped: `{ position, turn: 1 }`.
 *   movedCorners,       how many corners / edges are not as they were — moved, re-oriented, or both.
 *   movedEdges, pieces  `pieces` is their sum.
 *   corners, edges,     the first version's four counts, unchanged in meaning: cycle lengths longest first,
 *   twisted, flipped    and how many slots hold a corner with a non-zero twist / an edge with a non-zero
 *                       flip, moved pieces included (that count is in cubejs's convention, which is where
 *                       the old test checked it).
 *   parity              'even' or 'odd': the permutation parity, the same for corners and edges.
 *   order, keeps        `orderOf` and `keepsOf`, so one call carries everything a description needs.
 */
export function effectOf(alg, { hold = OWN_HOLD } = {}) {
  const own = played(alg);
  // The same letters read from the given hold: its pieces are in the scan frame, so only its HOLD is used —
  // the pieces are named in the letters' frame above. `run` refuses a hold that is not one.
  const end = run(alg, hold, SOLVED).hold;
  const { state } = own;
  const c = cyclesOf(state.cp, state.co, CORNERS, 3);
  const e = cyclesOf(state.ep, state.eo, EDGES, 2);
  const cornerParity = parityOf(c.cycles);
  if (cornerParity !== parityOf(e.cycles)) {
    throw new Error(`alg-effect: "${alg}" gives corners and edges different parity, which no cube can have`);
  }
  const movedCorners = CORNERS.filter((_, i) => state.cp[i] !== i || state.co[i] !== 0).length;
  const movedEdges = EDGES.filter((_, i) => state.ep[i] !== i || state.eo[i] !== 0).length;
  return Object.freeze({
    alg: String(alg),
    moves: own.drawn.length,
    hold: Object.freeze([...hold]),
    endHold: Object.freeze([...end]),
    keepsHold: sameHold(own.hold, OWN_HOLD),
    cornerCycles: Object.freeze(c.cycles),
    edgeCycles: Object.freeze(e.cycles),
    twistedInPlace: Object.freeze(c.inPlace),
    flippedInPlace: Object.freeze(e.inPlace),
    movedCorners,
    movedEdges,
    pieces: movedCorners + movedEdges,
    corners: lengthsOf(c.cycles),
    edges: lengthsOf(e.cycles),
    twisted: state.co.filter((v) => v !== 0).length,
    flipped: state.eo.filter((v) => v !== 0).length,
    parity: cornerParity,
    order: orderOf(alg),
    keeps: keepsOf(alg),
  });
}
