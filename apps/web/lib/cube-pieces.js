// The cube as 20 pieces, not 54 stickers.
//
// A method solver reasons in cubies — "the blue-white edge is in the top layer, flipped" —
// and a facelet string cannot answer that without a lookup per question. So this module
// carries the piece-level model the layer-by-layer stages are written against, and nothing
// else: no DOM, no storage, no cubejs at runtime.
//
// The permutation/orientation convention is cubejs's (Kociemba ordering), and the quarter-turn
// tables below were DERIVED from cubejs rather than typed from memory. `cube-pieces.test.mjs`
// re-derives them and fails on any disagreement. That test is not ceremony: a wrong table
// still produces well-formed algs that simply do not solve, so the failure it guards against
// is silent by construction.

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

/** The alg that undoes `alg`. */
export function invert(alg) {
  return String(alg).trim().split(/\s+/).filter(Boolean).reverse()
    .map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`))
    .join(' ');
}
