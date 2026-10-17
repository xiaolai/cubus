// Roux's distance tables: what they index, how one is built, how a shipped one is read, and the descent.
//
// THE FRAME IS THE BLOCKS' (dev-docs/solve-methods-plan.md Phase 8). Roux turns the middle slice, and `M`
// moves centres: the app's piece model reads it as `R L'` with the hold turned (lib/cube-moves.js). Inside a
// Roux step the pieces are tracked the way a solver sees them instead — positions fixed to the left and right
// centres, the slice centres' turn counted apart — which is cubejs's own model, and `M` there permutes and
// flips the four slice edges and nothing else. Every Roux stage boundary is upright with the centres lined up
// (lib/methods/roux.js), and there the two models are the same state, so a stage reads the cube as held,
// searches here, and hands the driver the child's letters to replay. `roux-tables.test.mjs` holds the two
// models to each other on every aligned sequence it plays, and `M_PHYSICAL` to cubejs.
//
// FOUR TABLES SHIP, three are built on load:
//   first-block   DL FL BL, DLF DBL over the 18 face turns — 5,322,240 positions, every one reachable
//   second-block  DR FR BR, DFR DRB over R, U and M, the first block solved — 1,088,640 positions
//   lse-orient    the last six edges, their flips, the slice's turn and the top's — every M and U turn
//   lse-sides, lse-finish  the same space, but only the 5,760 positions whose edges are oriented, over the
//                 moves that keep them so: small enough to build in milliseconds, so they are not shipped.
//
// A SHIPPED TABLE IS TWO BITS A POSITION: its distance mod 3, or 3 where the goal cannot be reached. That is
// enough to descend. Every move here has its inverse in the same move set, so a neighbour's distance differs
// from a position's by at most one, and of the three values d - 1, d, d + 1 only the first is (v - 1) mod 3:
// the neighbour holding that value is exactly the one a move closer. The descent ends where the goal holds,
// which it asks of the position itself, never of the table.

import { MOVES, compose } from '../cube-pieces.js';
import { FIRST_BLOCK, SECOND_BLOCK } from './roux-blocks.js';

/** Edge slots, in `cube-pieces.js`'s order — which is cubejs's. */
const UR = 0, UF = 1, UL = 2, UB = 3, DF = 5, DB = 7;

export { FIRST_BLOCK, SECOND_BLOCK };

/** The last six edges' slots: the top four and the two the slice carries through the bottom. */
export const LSE_SLOTS = Object.freeze([UR, UF, UL, UB, DF, DB]);
/** The slots the middle slice passes through. An edge's orientation is read against these when the slice
 *  stands a quarter turn off (`edgesOriented`). */
const SLICE_SLOTS = Object.freeze([UF, UB, DF, DB]);

/**
 * The middle slice's quarter turn in the block frame: slot i takes the piece from slot `ep[i]`, flipped by
 * `eo[i]` — the convention of `cube-pieces.js`'s `MOVES`. The four slice edges cycle and flip; nothing else
 * moves. DATA, and checked twice over: against cubejs's own `M`, and against the app's interpreter on every
 * sequence whose slice turns add up to none (`roux-tables.test.mjs`).
 */
export const M_PHYSICAL = Object.freeze({
  cp: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]),
  co: Object.freeze([0, 0, 0, 0, 0, 0, 0, 0]),
  ep: Object.freeze([0, 3, 2, 7, 4, 1, 6, 5, 8, 9, 10, 11]),
  eo: Object.freeze([0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0]),
});

/**
 * The moves a table steps by, each with its action in the block frame and how far it turns the slice and the
 * top. A face turn's action is the piece model's own (`cube-pieces.js` `MOVES`): it moves no centre, so it is
 * the same in either frame.
 */
export function blockMoves(names) {
  const faceMoves = MOVES;
  const M2 = compose(M_PHYSICAL, M_PHYSICAL);
  const slice = { M: [M_PHYSICAL, 1], M2: [M2, 2], "M'": [compose(M2, M_PHYSICAL), 3] };
  return Object.freeze(names.map((name) => {
    const [action, turn] = Object.hasOwn(slice, name) ? slice[name] : [faceMoves[name], 0];
    if (!action) throw new Error(`roux-tables: no move "${name}"`);
    const top = { U: 1, U2: 2, "U'": 3 }[name] ?? 0;
    return Object.freeze({ name, action, slice: turn, top });
  }));
}

/** A cube after one block-frame move: `blockMoves`' action composed on, as the piece model applies a face
 *  turn. Returns a new state. */
export const applyBlockMove = (state, move) => compose(state, move.action);

/** The move sets, by name. A table is built over one and descended over the same one. */
export const FACE_TURNS = Object.freeze(['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'", 'D', 'D2', "D'", 'L', 'L2', "L'", 'B', 'B2', "B'"]);
export const RUM_TURNS = Object.freeze(['R', 'R2', "R'", 'U', 'U2', "U'", 'M', 'M2', "M'"]);
export const MU_TURNS = Object.freeze(['M', 'M2', "M'", 'U', 'U2', "U'"]);

// ---- a block coordinate --------------------------------------------------------------------------
//
// Some pieces, each in one of a set of slots and turned one of `span` ways, ranked densely: the slots as a
// partial permutation (digit i is the slot's index among those the earlier pieces left), then the
// orientations. The second block's slots are the nine edges and six corners R, U and M can reach once the
// first block is built, which is what makes its table a fifth the size of the first's.

function pieceCoordinate(cubies, slots, span) {
  const n = cubies.length;
  const p = slots.length;
  let perms = 1;
  for (let i = 0; i < n; i++) perms *= p - i;
  const size = perms * span ** n;
  const index = new Map(slots.map((s, i) => [s, i]));
  /** A list of (slot, orientation) per piece, as one number. */
  const rank = (where, turned) => {
    const used = new Array(p).fill(false);
    let r = 0;
    for (let i = 0; i < n; i++) {
      const j = index.get(where[i]);
      let below = 0;
      for (let q = 0; q < j; q++) if (!used[q]) below++;
      used[j] = true;
      r = r * (p - i) + below;
    }
    for (let i = 0; i < n; i++) r = r * span + turned[i];
    return r;
  };
  const unrank = (code) => {
    let r = code;
    const turned = new Array(n);
    for (let i = n - 1; i >= 0; i--) { turned[i] = r % span; r = (r - turned[i]) / span; }
    const digits = new Array(n);
    for (let i = n - 1; i >= 0; i--) { digits[i] = r % (p - i); r = (r - digits[i]) / (p - i); }
    const used = new Array(p).fill(false);
    const where = digits.map((d) => {
      let q = -1;
      for (let left = d; left >= 0; left -= used[++q] ? 0 : 1);
      used[q] = true;
      return slots[q];
    });
    return { where, turned };
  };
  return { size, rank, unrank, index, cubies, n };
}

/** The coordinate's move table: for each move, where every code goes. Built once per table, by unranking. */
function stepTable(coord, moves, kind) {
  const span = kind === 'edge' ? 2 : 3;
  const out = moves.map(() => new Int32Array(coord.size));
  for (let code = 0; code < coord.size; code++) {
    const { where, turned } = coord.unrank(code);
    moves.forEach((move, m) => {
      const perm = kind === 'edge' ? move.action.ep : move.action.cp;
      const twist = kind === 'edge' ? move.action.eo : move.action.co;
      const to = new Array(coord.n);
      const turnedTo = new Array(coord.n);
      for (let i = 0; i < coord.n; i++) {
        // The piece in slot s goes to the slot t whose source is s, and takes that slot's twist.
        const t = perm.indexOf(where[i]);
        if (!coord.index.has(t)) throw new Error(`roux-tables: a move takes a tracked piece out of the coordinate's slots`);
        to[i] = t;
        turnedTo[i] = (turned[i] + twist[t]) % span;
      }
      out[m][code] = coord.rank(to, turnedTo);
    });
  }
  return out;
}

/**
 * A block table's coordinate: edges then corners, one code. `codeOf(state)` reads a cube's block pieces, or
 * -1 when one stands outside the slots the table covers.
 */
export function blockCoordinate({ edges, corners, edgeSlots, cornerSlots, moves }) {
  const E = pieceCoordinate(edges, edgeSlots, 2);
  const C = pieceCoordinate(corners, cornerSlots, 3);
  const size = E.size * C.size;
  let tables = null;
  const steps = () => (tables ??= { e: stepTable(E, moves, 'edge'), c: stepTable(C, moves, 'corner') });
  const step = (code, m) => {
    const { e, c } = steps();
    const cc = code % C.size;
    return e[m][(code - cc) / C.size] * C.size + c[m][cc];
  };
  const codeOf = (state) => {
    const ew = edges.map((x) => state.ep.indexOf(x));
    const cw = corners.map((x) => state.cp.indexOf(x));
    if (ew.some((s) => !E.index.has(s)) || cw.some((s) => !C.index.has(s))) return -1;
    return E.rank(ew, ew.map((s) => state.eo[s])) * C.size + C.rank(cw, cw.map((s) => state.co[s]));
  };
  return Object.freeze({ size, moves, step, codeOf, warm: steps });
}

// ---- the last six edges ----------------------------------------------------------------------------
//
// A position after CMLL: which of the six edges stands in each of the six slots, their flips, how far the
// slice centres are turned (k) and how far the top is (u, read off the corners, which only U moves now).
// 720 x 64 x 4 x 4 = 737,280 codes, of which 184,320 are reachable.

const FACT = [1, 1, 2, 6, 24, 120, 720];
const rankPerm6 = (perm) => {
  let r = 0;
  const used = [false, false, false, false, false, false];
  for (let i = 0; i < 6; i++) {
    let below = 0;
    for (let j = 0; j < perm[i]; j++) if (!used[j]) below++;
    r += below * FACT[5 - i];
    used[perm[i]] = true;
  }
  return r;
};
const unrankPerm6 = (code) => {
  let r = code;
  const left = [0, 1, 2, 3, 4, 5];
  const perm = [];
  for (let i = 0; i < 6; i++) { const q = Math.floor(r / FACT[5 - i]); r %= FACT[5 - i]; perm.push(left.splice(q, 1)[0]); }
  return perm;
};

export const LSE_SIZE = 720 * 64 * 16;

/** A last-six-edges code's parts. `perm[i]` is which of the six edges (by its index in `LSE_SLOTS`) stands in
 *  the i-th slot; bit i of `flips` is its flip. */
export function lseDecode(code) {
  let r = code;
  const u = r % 4; r = (r - u) / 4;
  const k = r % 4; r = (r - k) / 4;
  const flips = r % 64;
  return { perm: unrankPerm6((r - flips) / 64), flips, k, u };
}
export const lseEncode = ({ perm, flips, k, u }) => ((rankPerm6(perm) * 64 + flips) * 4 + k) * 4 + u;

/** Every one of the six edges oriented, read against the slice: good when the slice stands even, and inverted
 *  for the slice's own slots when it stands a quarter turn off. Closed under M, U2 and (slice even) U, and
 *  EXACTLY the positions those moves reach from solved — `roux-tables.test.mjs` counts both. */
export function edgesOriented({ flips, k }) {
  for (let i = 0; i < 6; i++) {
    const want = k % 2 === 1 && SLICE_SLOTS.includes(LSE_SLOTS[i]) ? 1 : 0;
    if (((flips >> i) & 1) !== want) return false;
  }
  return true;
}

/** Whether a move keeps the six edges' orientation: every slice turn and U2 do, a quarter U only with the
 *  slice standing even. */
export const keepsOrientation = (move, k) => move.slice !== 0 || move.top === 2 || k % 2 === 0;

/** The last-six-edges move table: per move, the permutation and flips of the six slots. */
export function lseMoves(moves) {
  return Object.freeze(moves.map((move) => {
    const src = LSE_SLOTS.map((s) => LSE_SLOTS.indexOf(move.action.ep[s]));
    if (src.includes(-1)) throw new Error(`roux-tables: ${move.name} takes an edge out of the last six`);
    const flip = LSE_SLOTS.map((s) => move.action.eo[s]);
    return Object.freeze({ ...move, src, flip });
  }));
}

/** One move of the last six edges, on a code. */
export function lseStep(code, move) {
  const { perm, flips, k, u } = lseDecode(code);
  let nf = 0;
  for (let i = 0; i < 6; i++) nf |= ((((flips >> move.src[i]) & 1) ^ move.flip[i]) << i);
  return lseEncode({ perm: move.src.map((s) => perm[s]), flips: nf, k: (k + move.slice) % 4, u: (u + move.top) % 4 });
}

/**
 * A cube's last-six-edges code, given how far its slice is turned, or -1 when it is not in that space: a
 * block piece out of place, a corner not where some turn of the top puts it, or an edge outside the six.
 * `topTurns` are the four corner arrangements U^u makes from solved, passed in from the piece model.
 */
export function lseCodeOf(state, k, topTurns) {
  const u = topTurns.findIndex((t) => t.cp.every((c, i) => c === state.cp[i]) && t.co.every((c, i) => c === state.co[i]));
  if (u < 0) return -1;
  for (const e of [...FIRST_BLOCK.edges, ...SECOND_BLOCK.edges]) if (state.ep[e] !== e || state.eo[e] !== 0) return -1;
  const perm = LSE_SLOTS.map((s) => LSE_SLOTS.indexOf(state.ep[s]));
  if (perm.includes(-1)) return -1;
  let flips = 0;
  LSE_SLOTS.forEach((s, i) => { flips |= state.eo[s] << i; });
  return lseEncode({ perm, flips, k, u });
}

// ---- building, packing, reading ---------------------------------------------------------------------

const UNREACHED = 0xff;

/**
 * Exact distances from a goal set, breadth-first, as one byte a code (255 unreached). `allowed(code, m)` says
 * whether move m may be made from a code; it must hold for a move's inverse wherever it holds for the move,
 * which every set here satisfies, so the graph is undirected and a distance FROM the goal is a distance TO it.
 */
export function buildDistances(size, goals, moveCount, step, allowed = () => true) {
  const dist = new Uint8Array(size).fill(UNREACHED);
  const queue = new Int32Array(size);
  let tail = 0;
  for (const g of goals) if (dist[g] === UNREACHED) { dist[g] = 0; queue[tail++] = g; }
  for (let head = 0; head < tail; head++) {
    const code = queue[head];
    const d = dist[code] + 1;
    for (let m = 0; m < moveCount; m++) {
      if (!allowed(code, m)) continue;
      const n = step(code, m);
      if (dist[n] === UNREACHED) { dist[n] = d; queue[tail++] = n; }
    }
  }
  return dist;
}

/** Exact distances as two bits a code: the distance mod 3, or 3 unreached. Four codes a byte, low bits first. */
export function pack(dist) {
  const out = new Uint8Array(Math.ceil(dist.length / 4));
  for (let i = 0; i < dist.length; i++) {
    const v = dist[i] === UNREACHED ? 3 : dist[i] % 3;
    out[i >> 2] |= v << ((i & 3) * 2);
  }
  return out;
}

/** A packed table's two bits at `code`. */
export const packedAt = (packed, code) => (packed[code >> 2] >> ((code & 3) * 2)) & 3;

/** FNV-1a over the bytes — the integrity check a loaded table must pass. Not a defence against an attacker,
 *  who could change the constant too; a defence against a truncated or corrupted file, which would otherwise
 *  give descents that wander and are refused only after a whole stage. */
export function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The shortest route from `code` to the goal, over a table: a list of move indices. `value(code)` reads the
 * table — two bits mod 3, or an exact byte — and `mod` says which (3 or 256). `atGoal(code)` is asked of the
 * position itself. Throws when the goal cannot be reached from here, or when no move descends, which an exact
 * table never allows: either is a corrupted table, and a stage built on one must not run.
 */
export function descend(code, { value, mod, unreached, moveCount, step, allowed = () => true, atGoal, limit = 64 }) {
  const route = [];
  let at = code;
  if (value(at) === unreached) throw new Error('roux-tables: this position cannot reach the goal');
  while (!atGoal(at)) {
    if (route.length >= limit) throw new Error('roux-tables: a descent ran past any distance a table holds');
    const want = (value(at) + mod - 1) % mod;
    let next = -1;
    for (let m = 0; m < moveCount && next < 0; m++) {
      if (!allowed(at, m)) continue;
      const n = step(at, m);
      if (value(n) === want) { next = n; route.push(m); }
    }
    if (next < 0) throw new Error('roux-tables: no move descends — the table is not the one it claims to be');
    at = next;
  }
  return route;
}
