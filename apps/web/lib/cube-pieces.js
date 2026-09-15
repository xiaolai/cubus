// The cube as 20 pieces, not 54 stickers.
//
// A solver reasons in cubies — "which slot holds this edge, and which way up" — and a facelet
// string cannot answer that without a lookup per question. So this module carries the piece-level
// model, and nothing else: no DOM, no storage, no cubejs at runtime.
//
// It was written for the method solver, which was removed on 2026-08-29 (dev-docs/solver-research.md).
// It stayed because two things that outlived it are built on it, and neither is optional:
// `two-phase.js` COMPOSES every one of its move tables from `MOVES` here rather than typing them,
// and `cube-selfcheck.test.mjs` uses `rotateState` to build a genuinely conjugated decoder — the
// one thing that can tell a uniformly relabelled cube from an offset one.
//
// The permutation/orientation convention is cubejs's (Kociemba ordering), and the quarter-turn
// tables below were DERIVED from cubejs rather than typed from memory. `cube-pieces.test.mjs`
// re-derives them and fails on any disagreement. That test is not ceremony: a wrong table
// still produces well-formed algs that simply do not solve, so the failure it guards against
// is silent by construction.

// The facelet layout — which sticker belongs to which slot — so a state can be written as the 54
// characters every other part of the app speaks in. Tables only; the arithmetic is `toFacelets` below.
import { CENTERS, CORNER_FACELETS, EDGE_FACELETS, FACE_LETTERS } from './cube-layout.js';

/** Corner slots, in cubejs order. Index is the slot; the value stored there is the cubie. */
export const CORNERS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
/** Edge slots, in cubejs order. */
export const EDGES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

/** Name -> index, so stage code can say `EDGE.DF` instead of 5. */
export const CORNER = Object.fromEntries(CORNERS.map((n, i) => [n, i]));
export const EDGE = Object.fromEntries(EDGES.map((n, i) => [n, i]));

/** The six quarter turns, derived from cubejs. Everything else is composed from these. */
const QUARTER = {
  U: { cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0],
       ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  R: { cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2],
       ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  F: { cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0],
       ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11], eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0] },
  D: { cp: [0, 1, 2, 3, 5, 6, 7, 4], co: [0, 0, 0, 0, 0, 0, 0, 0],
       ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  L: { cp: [0, 2, 6, 3, 4, 1, 5, 7], co: [0, 1, 2, 0, 0, 2, 1, 0],
       ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  B: { cp: [0, 1, 3, 7, 4, 5, 2, 6], co: [0, 0, 1, 2, 0, 0, 2, 1],
       ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7], eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1] },
};

/** The identity — also what "solved" means, since a slot holding its own cubie is solved. */
export const SOLVED = Object.freeze({
  cp: [0, 1, 2, 3, 4, 5, 6, 7],
  co: [0, 0, 0, 0, 0, 0, 0, 0],
  ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
});

/** `a` then `b`. Orientation adds in the destination's frame, which is why the lookup is by
 *  `b`'s permutation and not by the slot index. */
function compose(a, b) {
  const cp = new Array(8);
  const co = new Array(8);
  for (let i = 0; i < 8; i++) {
    cp[i] = a.cp[b.cp[i]];
    co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
  }
  const ep = new Array(12);
  const eo = new Array(12);
  for (let i = 0; i < 12; i++) {
    ep[i] = a.ep[b.ep[i]];
    eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2;
  }
  return { cp, co, ep, eo };
}

/** All 18 face turns. `F2` is `F` twice and `F'` is `F` three times — composed, never typed,
 *  so a typo cannot introduce a move that is subtly not the move it is named after. */
export const MOVES = (() => {
  const all = {};
  for (const [face, q] of Object.entries(QUARTER)) {
    const twice = compose(q, q);
    all[face] = q;
    all[`${face}2`] = twice;
    all[`${face}'`] = compose(twice, q);
  }
  return Object.freeze(all);
})();

/** Every move name, in a stable order — the move set a stage searches over. */
export const MOVE_NAMES = Object.freeze(Object.keys(MOVES));

/** State after applying one move. Never mutates its input. */
export function applyMove(state, move) {
  const m = MOVES[move];
  if (!m) throw new Error(`unknown move: ${move}`);
  return compose(state, m);
}

/** State after applying a space-separated alg. An empty alg returns an equal copy. */
export function applyAlg(state, alg) {
  let s = { cp: [...state.cp], co: [...state.co], ep: [...state.ep], eo: [...state.eo] };
  for (const move of String(alg).trim().split(/\s+/).filter(Boolean)) s = applyMove(s, move);
  return s;
}

/** The state of a cubejs `Cube`, copied out. cubejs is the only parser we have for a facelet
 *  string, so this is the seam — and it reads cubejs's INTERNAL fields, which is exactly why
 *  the test pins their layout. */
/**
 * A state as its facelet string — the inverse of reading one.
 *
 * Here rather than in the solver, where it lived until plan item 3.2: it is a statement about the
 * PIECE MODEL in the published facelet layout, and `lib/stage-picture.js` was importing the whole
 * two-phase engine to get at it. `lib/two-phase.js` re-exports it, so every caller's import still
 * reads the same.
 */
export function toFacelets(state) {
  const out = new Array(54);
  for (let i = 0; i < 6; i++) out[CENTERS[i]] = FACE_LETTERS[i];
  for (let slot = 0; slot < 8; slot++) {
    const name = CORNERS[state.cp[slot]];
    for (let k = 0; k < 3; k++) out[CORNER_FACELETS[slot][(k + state.co[slot]) % 3]] = name[k];
  }
  for (let slot = 0; slot < 12; slot++) {
    const name = EDGES[state.ep[slot]];
    for (let k = 0; k < 2; k++) out[EDGE_FACELETS[slot][(k + state.eo[slot]) % 2]] = name[k];
  }
  return out.join('');
}

export function fromCube(cube) {
  return { cp: [...cube.cp], co: [...cube.co], ep: [...cube.ep], eo: [...cube.eo] };
}

/** Which slot currently holds edge cubie `cubie`. */
export function edgeSlot(state, cubie) {
  const at = state.ep.indexOf(cubie);
  if (at < 0) throw new Error(`edge cubie ${cubie} is not on the cube`);
  return at;
}

/** Which slot currently holds corner cubie `cubie`. */
export function cornerSlot(state, cubie) {
  const at = state.cp.indexOf(cubie);
  if (at < 0) throw new Error(`corner cubie ${cubie} is not on the cube`);
  return at;
}

/** An edge is solved when its own slot holds it, the right way round. */
export const edgeSolved = (state, cubie) => state.ep[cubie] === cubie && state.eo[cubie] === 0;
/** A corner is solved when its own slot holds it, untwisted. */
export const cornerSolved = (state, cubie) => state.cp[cubie] === cubie && state.co[cubie] === 0;

/** Every listed edge and corner solved. The stage invariant, written once. */
export function allSolved(state, { edges = [], corners = [] }) {
  return edges.every((e) => edgeSolved(state, e)) && corners.every((c) => cornerSolved(state, c));
}

/**
 * An algorithm string as its list of move tokens — the one tokenizer everything shares.
 *
 * There were three: `algLength` in `methods/engine.js`, `movesOf` in `app.js`, and `movesIn` in
 * `method-lesson.js`. They agreed, which is the point — a move COUNT decides what a lesson says
 * it costs, and a move INDEX decides which move the animation is on, so two spellings of "what
 * counts as a move" would put the caption and the playhead on different moves and neither would
 * look wrong on its own.
 */
export const movesOf = (alg) => {
  const text = String(alg ?? '').trim();
  return text ? text.split(/\s+/) : [];
};

/** How many moves an algorithm is. */
export const moveCount = (alg) => movesOf(alg).length;

/** A whole-cube turn about U, as a face relabelling. `F` becomes `R`, and so on round. */
const Y_FACES = { U: 'U', D: 'D', F: 'R', R: 'B', B: 'L', L: 'F' };

/** `alg` as seen after turning the whole cube `k` quarter turns about U. */
export function rotateAlg(alg, k) {
  let out = String(alg);
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) out = out.replace(/[UDFRBL]/g, (f) => Y_FACES[f]);
  return out;
}

/**
 * The same whole-cube turn, as a STATE.
 *
 * Relabelling an algorithm is the easy half. The hard half is that **edge orientation is not
 * invariant under this rotation**: in this convention a flip is measured against the F/B axis,
 * and `F` flips edges where `R` does not — so turning the cube changes which edges read as
 * flipped. The eight U/D-layer edges flip; the four middle ones do not.
 *
 * That is not a detail. Reading a piece's slot in one frame and its flip in another describes a
 * situation that does not exist, and it is exactly how the F2L stage came to give one case two
 * different algorithms depending on which slot it turned up in.
 *
 * These values were derived, not remembered: they are the only ones for which conjugating every
 * one of the eighteen moves reproduces `rotateAlg`, and the test re-derives them.
 */
const Y_STATE = Object.freeze({
  cp: [1, 2, 3, 0, 5, 6, 7, 4],
  co: [0, 0, 0, 0, 0, 0, 0, 0],
  ep: [1, 2, 3, 0, 5, 6, 7, 4, 9, 10, 11, 8],
  eo: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
});

function inverseOf(state) {
  const cp = new Array(8);
  const co = new Array(8);
  for (let i = 0; i < 8; i++) { cp[state.cp[i]] = i; co[state.cp[i]] = (3 - state.co[i]) % 3; }
  const ep = new Array(12);
  const eo = new Array(12);
  for (let i = 0; i < 12; i++) { ep[state.ep[i]] = i; eo[state.ep[i]] = state.eo[i]; }
  return { cp, co, ep, eo };
}
const Y_INVERSE = inverseOf(Y_STATE);

/** `state` as seen after turning the whole cube `k` quarter turns about U. */
export function rotateState(state, k) {
  let out = state;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) out = compose(compose(Y_INVERSE, out), Y_STATE);
  return { cp: [...out.cp], co: [...out.co], ep: [...out.ep], eo: [...out.eo] };
}

/** The alg that undoes `alg`: the same turns, backwards, each reversed. An involution on every
 *  face-turn form (R->R'->R, R2->R2), which is what lets one function turn a solution into a setup
 *  alg and a setup alg back into a solution. */
export function invert(alg) {
  return String(alg).trim().split(/\s+/).filter(Boolean).reverse()
    .map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`))
    .join(' ');
}
