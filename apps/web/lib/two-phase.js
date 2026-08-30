// Our own two-phase solver — Kociemba's algorithm, implemented from the published method.
//
// This replaces the vendored min2phase. Why: dev-docs/two-phase-plan.md (an unresolved licence
// contradiction in code that ships). What was and was not consulted while writing it:
// dev-docs/two-phase-provenance.md — the method is public and decades old, and no existing
// solver's source was opened for this file.
//
// The algorithm, in one paragraph: phase 1 drives the cube into the subgroup
// G1 = ⟨U, D, L2, R2, F2, B2⟩ — every corner untwisted, every edge unflipped, the four E-slice
// edges somewhere in their slice. Phase 2 finishes inside G1, where only those ten moves are
// needed. Each phase searches over COORDINATES: the state is projected onto small integers, a
// move becomes a table lookup, and pruning tables over coordinate pairs give IDA* its lower
// bound. Tables are megabytes, not gigabytes — the largest dimension is 8! = 40,320.
//
// The state model is cube-pieces.js's {cp, co, ep, eo} — cubejs's ordering, which is Kociemba's.
// Every move table below is COMPOSED from cube-pieces' MOVES rather than typed here, and
// two-phase.test.mjs re-checks every one of the 18 moves against cube-pieces on random states.
// That test is not ceremony: a wrong table still produces well-formed algs that simply do not
// solve, so the failure it guards against is silent by construction.
//
// The search's hot path allocates nothing: the DFS walks coordinate tables, and each probe
// replays its phase-1 maneuver through preallocated per-depth buffers. That is what makes a
// probe budget (~tens of thousands per tier) affordable — measured in solver-move-count.md.

import { CORNERS, EDGES, MOVES, MOVE_NAMES, SOLVED, applyMove } from './cube-pieces.js';

// ---- the move set -----------------------------------------------------------------------------

/** Move indices are positions in cube-pieces' MOVE_NAMES: faces in U,R,F,D,L,B order, each as
 *  [quarter, half, inverse quarter]. So `face = (idx / 3) | 0`, and opposite faces share an
 *  axis (U-D, R-L, F-B): `axis = face % 3`. */
export const ALL_MOVES = Object.freeze(Array.from({ length: 18 }, (_, i) => i));

/** The ten moves that exist inside G1, as indices into MOVE_NAMES. */
export const PHASE2_MOVES = Object.freeze(
  ['U', 'U2', "U'", 'R2', 'F2', 'D', 'D2', "D'", 'L2', 'B2'].map((n) => MOVE_NAMES.indexOf(n)),
);
if (PHASE2_MOVES.includes(-1)) {
  throw new Error('two-phase: cube-pieces MOVE_NAMES no longer contains the G1 move set');
}

// Table row widths, defined once beside the move sets they index. Every `coord * width + mi`
// below uses these — a literal 18 or 10 that drifted from the move lists would misindex every
// table silently.
const P1_WIDTH = ALL_MOVES.length;
const P2_WIDTH = PHASE2_MOVES.length;

/** Each move's cubie-level permutation, straight from cube-pieces — the probe path reads these
 *  rather than composing whole states, which is what keeps it allocation-free. */
const MOVE_CP = ALL_MOVES.map((m) => MOVES[MOVE_NAMES[m]].cp);
const MOVE_EP = ALL_MOVES.map((m) => MOVES[MOVE_NAMES[m]].ep);

// ---- coordinates ------------------------------------------------------------------------------
// Each is a bijection between one component of the state and [0, count), with the solved state
// at 0. rank(unrank(i)) == i for every i is asserted by the test suite, not assumed.

export const TWIST_COUNT = 2187; //  3^7 — corner orientations; the eighth twist is determined
export const FLIP_COUNT = 2048; //   2^11 — edge orientations; the twelfth flip is determined
export const SLICE_COUNT = 495; //   C(12,4) — which four slots hold the E-slice edges
export const PERM8_COUNT = 40320; // 8! — corner permutation, and U/D-edge permutation in G1
export const PERM4_COUNT = 24; //    4! — the slice edges' order among themselves, in G1

/** Corner orientation as a base-3 number over the first seven corners. */
export function twistOf(co) {
  let t = 0;
  for (let i = 0; i < 7; i++) t = t * 3 + co[i];
  return t;
}

export function twistTo(t) {
  const co = new Array(8);
  let sum = 0;
  for (let i = 6; i >= 0; i--) {
    co[i] = t % 3;
    sum += co[i];
    t = (t / 3) | 0;
  }
  co[7] = (3 - (sum % 3)) % 3; // legal states twist to a multiple of three
  return co;
}

/** Edge orientation as a base-2 number over the first eleven edges. */
export function flipOf(eo) {
  let f = 0;
  for (let i = 0; i < 11; i++) f = f * 2 + eo[i];
  return f;
}

export function flipTo(f) {
  const eo = new Array(12);
  let sum = 0;
  for (let i = 10; i >= 0; i--) {
    eo[i] = f % 2;
    sum += eo[i];
    f = (f / 2) | 0;
  }
  eo[11] = sum % 2; // legal states flip an even number of edges
  return eo;
}

/** C(n, k) for n ≤ 12, k ≤ 4 — all the binomials the slice coordinate needs. */
const CNK = (() => {
  const c = Array.from({ length: 13 }, () => new Array(5).fill(0));
  for (let n = 0; n < 13; n++) {
    c[n][0] = 1;
    for (let k = 1; k <= Math.min(n, 4); k++) c[n][k] = c[n - 1][k - 1] + c[n - 1][k];
  }
  return c;
})();

/**
 * Which four slots hold the E-slice edges (cubies 8..11), ranked so that solved — slice edges
 * at home in slots 8..11 — is 0. The order of the slice edges among themselves is deliberately
 * ignored: in phase 1 only membership matters, and 495 beats 11,880.
 */
const SLICE_MAX = SLICE_COUNT - 1; // the home set's colex rank, and the flip point

export function sliceOf(ep) {
  // Colexicographic rank of the ascending slot set {s1 < s2 < s3 < s4}: C(s1,1) + C(s2,2) +
  // C(s3,3) + C(s4,4). The home set {8,9,10,11} ranks highest at SLICE_MAX, so it is flipped
  // to 0.
  let colex = 0;
  let k = 0;
  for (let slot = 0; slot < 12; slot++) if (ep[slot] >= 8) colex += CNK[slot][++k];
  return SLICE_MAX - colex;
}

export function sliceTo(r) {
  let rem = SLICE_MAX - r;
  const slots = [];
  for (let k = 4; k >= 1; k--) {
    // The largest v with C(v, k) ≤ what remains is the k-th largest occupied slot.
    let v = k - 1;
    while (v + 1 <= 11 && CNK[v + 1][k] <= rem) v++;
    slots.push(v);
    rem -= CNK[v][k];
  }
  const ep = new Array(12).fill(-1);
  slots.sort((a, b) => a - b).forEach((s, i) => {
    ep[s] = 8 + i; // slice cubies in ascending order — sliceOf ignores their order anyway
  });
  let next = 0;
  for (let i = 0; i < 12; i++) if (ep[i] < 0) ep[i] = next++;
  return ep;
}

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040]; // (n-1-i)! lookups for permutations of n ≤ 8

/** Lehmer rank of `n` entries starting at `start`, allocation-free. Only relative order
 *  matters, so it ranks slice edges 8..11 as readily as a permutation of 0..7. The identity
 *  is 0, and each position weighs by how many later entries are smaller. One implementation
 *  under every ranking below. */
function rankSpan(p, start, n) {
  const last = start + n - 1;
  let r = 0;
  for (let i = start; i <= last; i++) {
    let smaller = 0;
    for (let j = i + 1; j <= last; j++) if (p[j] < p[i]) smaller++;
    r += smaller * FACT[last - i];
  }
  return r;
}

/** Lehmer rank of a whole permutation (length ≤ 8). */
export function permRank(p) {
  return rankSpan(p, 0, p.length);
}

export function permUnrank(r, n) {
  const avail = Array.from({ length: n }, (_, i) => i);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = FACT[n - 1 - i];
    out[i] = avail.splice((r / f) | 0, 1)[0];
    r %= f;
  }
  return out;
}

/** The probe path's rankers: the U/D-edge (or corner) coordinate over slots 0..7, and the
 *  slice edges' order over slots 8..11. In G1 those spans hold exactly those cubies. */
const rankFirst8 = (p) => rankSpan(p, 0, 8);
const rankSlice4 = (ep) => rankSpan(ep, 8, 4);

// ---- move tables ------------------------------------------------------------------------------
// table[coord * width + mi] is the coordinate after the move at index mi of the table's move
// list. Built by unranking, applying the move at cubie level, re-ranking. The appliers below are
// cube-pieces' compose() restricted to one component — each coordinate transforms independently
// of the rest of the state, which is what the agreement test proves on full random states.

/** Slot i receives the occupant of slot mp[i] — cube-pieces' permutation composition. */
const applyPerm = (p, mp) => {
  const out = new Array(mp.length);
  for (let i = 0; i < mp.length; i++) out[i] = p[mp[i]];
  return out;
};

const applyCo = (co, m) => {
  const out = new Array(8);
  for (let i = 0; i < 8; i++) out[i] = (co[m.cp[i]] + m.co[i]) % 3;
  return out;
};

const applyEo = (eo, m) => {
  const out = new Array(12);
  for (let i = 0; i < 12; i++) out[i] = (eo[m.ep[i]] + m.eo[i]) % 2;
  return out;
};

function buildTable(Type, count, moveIdx, unrank, step) {
  const width = moveIdx.length;
  const table = new Type(count * width);
  for (let c = 0; c < count; c++) {
    const st = unrank(c);
    for (let mi = 0; mi < width; mi++) table[c * width + mi] = step(st, MOVES[MOVE_NAMES[moveIdx[mi]]]);
  }
  return table;
}

let tables = null;

/** All six coordinate move tables, built once and shared. ~1M entries in all — trivial. */
export function moveTables() {
  if (tables) return tables;
  const identity4 = [8, 9, 10, 11];
  tables = Object.freeze({
    // Phase 1: all 18 moves.
    twistMove: buildTable(Uint16Array, TWIST_COUNT, ALL_MOVES, twistTo, (co, m) => twistOf(applyCo(co, m))),
    flipMove: buildTable(Uint16Array, FLIP_COUNT, ALL_MOVES, flipTo, (eo, m) => flipOf(applyEo(eo, m))),
    sliceMove: buildTable(Uint16Array, SLICE_COUNT, ALL_MOVES, sliceTo, (ep, m) => sliceOf(applyPerm(ep, m.ep))),
    // Phase 2: the ten G1 moves, which map U/D slots to U/D slots and slice slots to slice
    // slots — that closure is what makes the two smaller permutation coordinates well-defined.
    cpermMove: buildTable(Uint16Array, PERM8_COUNT, PHASE2_MOVES, (r) => permUnrank(r, 8), (cp, m) => permRank(applyPerm(cp, m.cp))),
    epermMove: buildTable(
      Uint16Array,
      PERM8_COUNT,
      PHASE2_MOVES,
      (r) => [...permUnrank(r, 8), ...identity4],
      (ep, m) => permRank(applyPerm(ep, m.ep).slice(0, 8)),
    ),
    spermMove: buildTable(
      Uint8Array,
      PERM4_COUNT,
      PHASE2_MOVES,
      (r) => [0, 1, 2, 3, 4, 5, 6, 7, ...permUnrank(r, 4).map((x) => x + 8)],
      (ep, m) => permRank(applyPerm(ep, m.ep).slice(8).map((x) => x - 8)),
    ),
  });
  return tables;
}

// ---- pruning tables ---------------------------------------------------------------------------
// dist[a * countB + b] is the exact number of moves to bring the coordinate PAIR home. For the
// full cube state it is a lower bound — which is all IDA* needs, and why max() of two tables is
// a better bound than either alone.

function bfsPrune(countA, countB, tableA, tableB, width) {
  const size = countA * countB;
  const dist = new Uint8Array(size).fill(255);
  const queue = new Int32Array(size);
  dist[0] = 0;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const idx = queue[head++];
    const a = (idx / countB) | 0;
    const b = idx % countB;
    const d = dist[idx] + 1;
    for (let mi = 0; mi < width; mi++) {
      const next = tableA[a * width + mi] * countB + tableB[b * width + mi];
      if (dist[next] === 255) {
        dist[next] = d;
        queue[tail++] = next;
      }
    }
  }
  // Every pair is reachable in pair dynamics (the generators cover both parities of both
  // components), so a hole here is a broken move table, and a search that later stepped onto a
  // 255 would treat a reachable state as infinitely far away — silently, forever.
  if (tail !== size) {
    throw new Error(`two-phase: pruning BFS reached ${tail} of ${size} entries — a move table is wrong`);
  }
  return dist;
}

let pruning = null; // published LAST in initialize(), so a half-built solver cannot exist

// The search reads these module-level views, assigned once by initialize(). Hoisted because the
// DFS visits millions of nodes and a property load per node is measurable where a closure
// variable is not.
let TWIST_MOVE = null;
let FLIP_MOVE = null;
let SLICE_MOVE = null;
let CPERM_MOVE = null;
let EPERM_MOVE = null;
let SPERM_MOVE = null;
let PRUNE1T = null;
let PRUNE1F = null;
let PRUNE1TF = null;
let PRUNE2C = null;
let PRUNE2E = null;

/** Build everything the search needs. Idempotent; measured 0.4-2.6 s once, machine- and
 *  load-dependent (dev-docs/solver-move-count.md §7). Everything is built into locals first
 *  and published together at the end — a throw mid-build must leave the module un-initialized,
 *  not half-initialized behind a truthy flag. */
export function initialize() {
  if (pruning) return;
  const t = moveTables();
  const built = {
    prune1t: bfsPrune(TWIST_COUNT, SLICE_COUNT, t.twistMove, t.sliceMove, P1_WIDTH),
    prune1f: bfsPrune(FLIP_COUNT, SLICE_COUNT, t.flipMove, t.sliceMove, P1_WIDTH),
    prune1tf: bfsPrune(TWIST_COUNT, FLIP_COUNT, t.twistMove, t.flipMove, P1_WIDTH),
    prune2c: bfsPrune(PERM8_COUNT, PERM4_COUNT, t.cpermMove, t.spermMove, P2_WIDTH),
    prune2e: bfsPrune(PERM8_COUNT, PERM4_COUNT, t.epermMove, t.spermMove, P2_WIDTH),
  };
  const builtRotations = buildRotations();
  ({ twistMove: TWIST_MOVE, flipMove: FLIP_MOVE, sliceMove: SLICE_MOVE } = t);
  ({ cpermMove: CPERM_MOVE, epermMove: EPERM_MOVE, spermMove: SPERM_MOVE } = t);
  ({ prune1t: PRUNE1T, prune1f: PRUNE1F, prune1tf: PRUNE1TF, prune2c: PRUNE2C, prune2e: PRUNE2E } = built);
  rotations = builtRotations;
  pruning = built; // the publish — everything above succeeded
}

/** For tests: the built pruning tables. */
export function pruningTables() {
  initialize();
  return pruning;
}

// ---- phase 1: into G1 -------------------------------------------------------------------------

const FACE_OF = (m) => (m / 3) | 0; // 0 U, 1 R, 2 F, 3 D, 4 L, 5 B
const AXIS_OF = (f) => f % 3; //       0 UD, 1 RL, 2 FB

/** Same face twice never helps; of a commuting opposite-face pair, keep one order only. */
function moveAllowed(prevMove, m) {
  if (prevMove < 0) return true;
  const face = FACE_OF(m);
  const prev = FACE_OF(prevMove);
  if (face === prev) return false;
  return AXIS_OF(face) !== AXIS_OF(prev) || face < prev;
}

const IS_PHASE2 = (() => {
  const flags = new Array(P1_WIDTH).fill(false);
  for (const m of PHASE2_MOVES) flags[m] = true;
  return flags;
})();

/**
 * Enumerate phase-1 maneuvers of EXACTLY `depth` moves that land in G1, in lexicographic move
 * order. `onSolution(path)` is called for each; returning true from it aborts the enumeration
 * (found what we wanted, or out of budget).
 *
 * Maneuvers ending with a G1 move are skipped: the same total solution is found from the
 * shorter phase-1 maneuver with that move opening phase 2, so keeping them would only spend
 * probes on duplicates. The empty maneuver (a state already in G1) is the one exception.
 */
function phase1DFS(t, f, s, depthLeft, prevMove, path, onSolution) {
  if (exhausted) return true; // the abort channel — nothing below spends what is not there
  if (--nodesLeft < 0) {
    exhausted = true;
    return true;
  }
  // The same abort channel, reached from outside. `exhausted` already stops both phases
  // wherever it is set, so a stop needs no new plumbing — only somewhere to be asked.
  if ((nodesLeft & STOP_POLL_MASK) === 0 && stopRequested(currentDepth)) {
    exhausted = true;
    return true;
  }
  searchStats.p1Nodes++; // counted only inside the budget, so spent === budget on exhaustion
  if (depthLeft === 0) {
    if (t === 0 && f === 0 && s === 0 && (path.length === 0 || !IS_PHASE2[path[path.length - 1]])) {
      return onSolution(path);
    }
    return false;
  }
  const bound1 = Math.max(PRUNE1T[t * SLICE_COUNT + s], PRUNE1F[f * SLICE_COUNT + s]);
  if (bound1 > depthLeft || PRUNE1TF[t * FLIP_COUNT + f] > depthLeft) return false;
  for (let m = 0; m < P1_WIDTH; m++) {
    if (!moveAllowed(prevMove, m)) continue;
    path.push(m);
    const abort = phase1DFS(
      TWIST_MOVE[t * P1_WIDTH + m],
      FLIP_MOVE[f * P1_WIDTH + m],
      SLICE_MOVE[s * P1_WIDTH + m],
      depthLeft - 1,
      m,
      path,
      onSolution,
    );
    path.pop();
    if (abort) return true;
  }
  return false;
}

/**
 * The shortest maneuver taking `state` into G1, as move names. Exists for tests and for
 * development probing — the full solver drives the same DFS with a phase-2 continuation.
 *
 * @throws if nothing is found within `maxDepth` — the published diameter of this coset space
 *         is 12, so an empty answer at 12 means broken tables, not a hard cube.
 */
export function solveIntoG1(state, { maxDepth = 12 } = {}) {
  initialize();
  resetStats();
  nodesLeft = Number.MAX_SAFE_INTEGER; // the 12-deep minimal search is small; no budget needed
  exhausted = false;
  // This reaches phase1DFS, so it owns currentDepth for the duration. -1 rather than the loop's
  // depth: there is no parallel slice behind this search, so no stop decision should be made
  // about it — and a leftover depth from the last solvePattern is worse than none.
  currentDepth = -1;
  const t = twistOf(state.co);
  const f = flipOf(state.eo);
  const s = sliceOf(state.ep);
  for (let depth = 0; depth <= maxDepth; depth++) {
    let found = null;
    phase1DFS(t, f, s, depth, -1, [], (path) => {
      found = path.map((m) => MOVE_NAMES[m]);
      return true;
    });
    if (found) return found;
  }
  if (maxDepth >= 12) {
    throw new Error(`two-phase: no phase-1 maneuver within ${maxDepth} moves — the tables are wrong`);
  }
  // Below the published diameter an empty answer can simply mean a deep state — that is the
  // caller's bound, not a broken solver.
  throw new Error(`two-phase: no phase-1 maneuver within ${maxDepth} moves — the diameter is 12`);
}

// ---- facelets ---------------------------------------------------------------------------------
// The 54-character facelet string, in the standard order every solver and cubejs share: faces
// U R F D L B, nine stickers each, row-major with the face held as the published convention
// holds it. Colors are named by their home face's letter. cube-pieces' CORNERS/EDGES names
// double as the color sequences — letter k of 'URF' is the color at the cubie's k-th sticker —
// and the test suite pins this whole convention to cubejs by round-tripping random states.

/** Facelet indices of each corner slot's three stickers, U/D sticker first. */
const CORNER_FACELETS = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];

/** Facelet indices of each edge slot's two stickers, the EDGES-name order first. */
const EDGE_FACELETS = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52],
  [23, 12], [21, 41], [50, 39], [48, 14],
];

const CENTERS = [4, 13, 22, 31, 40, 49];
const FACE_LETTERS = 'URFDLB';

/**
 * A facelet string as a cubie state, or null when it is not a solvable cube.
 *
 * null covers every way a scan can be wrong: colors that are not the six, a center out of
 * place, a sticker set that spells no real cubie, a twisted corner, a flipped edge, two
 * swapped pieces (parity). The caller's contract is "no answer for this", which is the same
 * null an exhausted search returns — and the tiered search upstream turns a first-answer null
 * into a loud error rather than a quiet shrug.
 */
export function parseFacelets(facelets) {
  if (typeof facelets !== 'string' || facelets.length !== 54) return null;
  for (let i = 0; i < 6; i++) {
    if (facelets[CENTERS[i]] !== FACE_LETTERS[i]) return null; // centers define the color frame
  }
  const counts = new Map();
  for (const ch of facelets) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  if (counts.size !== 6 || [...counts.values()].some((n) => n !== 9)) return null;

  const corners = parseCornerSlots(facelets);
  if (corners === null) return null;
  const edges = parseEdgeSlots(facelets);
  if (edges === null) return null;
  const { cp, co } = corners;
  const { ep, eo } = edges;

  // A real cube has each piece exactly once, orientations that cancel out, and matching
  // permutation parities — anything else is scanner noise or a twisted/reassembled cube.
  if (new Set(cp).size !== 8 || new Set(ep).size !== 12) return null;
  if (co.reduce((x, y) => x + y, 0) % 3 !== 0) return null;
  if (eo.reduce((x, y) => x + y, 0) % 2 !== 0) return null;
  if (permutationParity(cp) !== permutationParity(ep)) return null;
  return { cp, co, ep, eo };
}

/** Corner slots from stickers: which cubie sits in each slot, and how it is twisted. null when
 *  any sticker triple spells no real corner. */
function parseCornerSlots(facelets) {
  const cp = new Array(8);
  const co = new Array(8);
  for (let slot = 0; slot < 8; slot++) {
    const [a, b, c] = CORNER_FACELETS[slot];
    const stickers = [facelets[a], facelets[b], facelets[c]];
    const ori = stickers.findIndex((sticker) => sticker === 'U' || sticker === 'D');
    if (ori < 0) return null; // a corner with no U/D sticker is not a corner of this cube
    const name = stickers[ori] + stickers[(ori + 1) % 3] + stickers[(ori + 2) % 3];
    const cubie = CORNERS.indexOf(name);
    if (cubie < 0) return null;
    cp[slot] = cubie;
    co[slot] = ori;
  }
  return { cp, co };
}

/** Edge slots from stickers, trying both orientations. null when a pair spells no real edge. */
function parseEdgeSlots(facelets) {
  const ep = new Array(12);
  const eo = new Array(12);
  for (let slot = 0; slot < 12; slot++) {
    const [a, b] = EDGE_FACELETS[slot];
    const upright = EDGES.indexOf(facelets[a] + facelets[b]);
    const flipped = EDGES.indexOf(facelets[b] + facelets[a]);
    if (upright >= 0) {
      ep[slot] = upright;
      eo[slot] = 0;
    } else if (flipped >= 0) {
      ep[slot] = flipped;
      eo[slot] = 1;
    } else {
      return null;
    }
  }
  return { ep, eo };
}

/** Even or odd, by cycle decomposition — the same computation random-state.js makes. */
function permutationParity(perm) {
  const seen = new Array(perm.length).fill(false);
  let swaps = 0;
  for (let start = 0; start < perm.length; start++) {
    if (seen[start]) continue;
    let length = 0;
    for (let at = start; !seen[at]; at = perm[at]) {
      seen[at] = true;
      length++;
    }
    swaps += length - 1;
  }
  return swaps % 2;
}

/** The inverse of parseFacelets, for tests: a cubie state as its facelet string. */
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

// ---- phase 2: inside G1 -----------------------------------------------------------------------

/**
 * Exact-depth DFS inside G1. On success the winning maneuver is LEFT IN `path` (indices into
 * MOVE_NAMES) — the caller owns the array and reads it on true.
 */
function phase2DFS(c, e, s, depthLeft, prevMove, path) {
  if (exhausted) return false; // false, not found — the ladder and phase 1 both stop on the flag
  if (--nodesLeft < 0) {
    exhausted = true;
    return false;
  }
  // Phase 2 polls as well as phase 1. It used not to, which made the stop protocol a half
  // measure: a worker already inside an expensive probe kept spending its whole budget after a
  // shallower sibling had won, which is exactly the wait the shared word exists to avoid.
  if ((nodesLeft & STOP_POLL_MASK) === 0 && stopRequested(currentDepth)) {
    exhausted = true;
    return false;
  }
  searchStats.p2Nodes++;
  if (depthLeft === 0) return c === 0 && e === 0 && s === 0;
  if (Math.max(PRUNE2C[c * PERM4_COUNT + s], PRUNE2E[e * PERM4_COUNT + s]) > depthLeft) return false;
  for (let mi = 0; mi < P2_WIDTH; mi++) {
    const m = PHASE2_MOVES[mi];
    if (!moveAllowed(prevMove, m)) continue;
    path.push(m);
    if (phase2DFS(CPERM_MOVE[c * P2_WIDTH + mi], EPERM_MOVE[e * P2_WIDTH + mi], SPERM_MOVE[s * P2_WIDTH + mi], depthLeft - 1, m, path)) {
      return true;
    }
    path.pop();
  }
  return false;
}

// ---- axis conjugation -------------------------------------------------------------------------
// The published multi-axis technique: the same cube viewed along another axis is a different
// search problem with the same answer length, and a state that is stubborn along one axis is
// almost always easy along another. The search below interleaves three views — identity, x, z —
// which is what collapses the worst case; min2phase's speed comes from the same idea.

/** Facelet sources for the whole-cube rotations: rotated[i] = original[perm[i]]. DERIVED from
 *  cubejs (the same discipline as cube-pieces' quarter-turn tables — never typed from memory)
 *  and re-derived against cubejs by the test suite on every run. */
export const ROTATION_PERMS = Object.freeze({
  x: Object.freeze([18, 19, 20, 21, 22, 23, 24, 25, 26, 15, 12, 9, 16, 13, 10, 17, 14, 11, 27, 28, 29, 30, 31, 32, 33, 34, 35, 53, 52, 51, 50, 49, 48, 47, 46, 45, 38, 41, 44, 37, 40, 43, 36, 39, 42, 8, 7, 6, 5, 4, 3, 2, 1, 0]),
  z: Object.freeze([42, 39, 36, 43, 40, 37, 44, 41, 38, 6, 3, 0, 7, 4, 1, 8, 5, 2, 24, 21, 18, 25, 22, 19, 26, 23, 20, 15, 12, 9, 16, 13, 10, 17, 14, 11, 33, 30, 27, 34, 31, 28, 35, 32, 29, 47, 50, 53, 46, 49, 52, 45, 48, 51]),
});

/** The group inverse: where each piece CAME FROM, with the twist undone. Solving the inverse
 *  and inverting the answer is a fourth-through-sixth view of the same cube — the published
 *  companion to axis conjugation, and worth having for the same reason: independent luck. */
function inverseState(state) {
  const cp = new Array(8);
  const co = new Array(8);
  const ep = new Array(12);
  const eo = new Array(12);
  for (let i = 0; i < 8; i++) {
    cp[state.cp[i]] = i;
    co[state.cp[i]] = (3 - state.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    ep[state.ep[i]] = i;
    eo[state.ep[i]] = state.eo[i];
  }
  return { cp, co, ep, eo };
}

/** U <-> U', F2 <-> F2 — the inverse move at the index level. */
const invMoveIdx = (m) => m - (m % 3) + (2 - (m % 3));

const statesEqual = (a, b) =>
  a.cp.every((v, i) => v === b.cp[i]) &&
  a.co.every((v, i) => v === b.co[i]) &&
  a.ep.every((v, i) => v === b.ep[i]) &&
  a.eo.every((v, i) => v === b.eo[i]);

let rotations = null; // [{ rotate(facelets), mapBack[18] }], one per extra orientation

/**
 * Build the two extra orientations. Everything here is DERIVED, then asserted: the color
 * relabelling comes from where the rotation puts the centers, and the move mapping µ (with
 * T(state·m) = T(state)·µ(m)) is found by matching cubie states over all 18 moves — a search
 * that either finds exactly one match per move or throws.
 */
function buildRotations() {
  const built = [];
  for (const perm of [ROTATION_PERMS.x, ROTATION_PERMS.z]) {
    const solvedFacelets = toFacelets(SOLVED);
    const relabel = {};
    for (let c = 0; c < 6; c++) relabel[solvedFacelets[perm[CENTERS[c]]]] = FACE_LETTERS[c];
    if (new Set(Object.values(relabel)).size !== 6) {
      throw new Error('two-phase: rotation color relabelling is not a bijection');
    }
    const rotate = (facelets) => {
      let out = '';
      for (let i = 0; i < 54; i++) out += relabel[facelets[perm[i]]];
      return out;
    };
    const mapBack = new Array(P1_WIDTH).fill(-1);
    for (let m = 0; m < P1_WIDTH; m++) {
      const image = parseFacelets(rotate(toFacelets(applyMove(SOLVED, MOVE_NAMES[m]))));
      const matches = [];
      for (let m2 = 0; m2 < P1_WIDTH; m2++) {
        if (statesEqual(image, applyMove(SOLVED, MOVE_NAMES[m2]))) matches.push(m2);
      }
      if (matches.length !== 1) {
        throw new Error(`two-phase: rotation maps ${MOVE_NAMES[m]} to ${matches.length} moves`);
      }
      mapBack[matches[0]] = m; // µ(m) = matches[0], so the way back from it is m
    }
    if (mapBack.includes(-1)) throw new Error('two-phase: rotation move map is not a bijection');
    built.push({ rotate, mapBack });
  }
  return built;
}

// ---- the whole search -------------------------------------------------------------------------

/**
 * min2phase-shaped bounds, which is the shape lib/solver-engine.js already drives:
 * `solLen` is EXCLUSIVE — accept nothing that long or longer. `probeMax` budgets the search in
 * SEARCH NODES across both phases, so a slow phone and a fast laptop do the same work and only
 * the waiting differs — and unlike min2phase's phase-2 probes, a node costs the same few
 * nanoseconds wherever it falls, so the budget is proportional to time as well as
 * deterministic.
 */
// solLen matches LOOSEST_BOUND in solver-engine.js — the wrapper always sets both bounds
// explicitly, so these defaults exist for direct module use and must not quietly disagree
// with it.
const BOUNDS = { solLen: 23, probeMax: 100_000_000 };

/** Diagnostics for the last search — what it cost, in the same units the budget is spent in,
 *  and `view` = which of the six views produced the answer (-1 while none has). TREAT AS
 *  READ-ONLY, like moveTables() and pruningTables(): these are live internals, exposed because
 *  copies would cost megabytes on a hot path, and the test suite pins the budget to these
 *  numbers so "probeMax bounds the work" is a checked claim, not a comment. */
/** How many views the search has: three axes x normal/inverse. Exported because the parallel
 *  client has to divide them, and a second copy of this number elsewhere is how a slice ends up
 *  searching nothing or a filter ends up out of range. */
export const VIEW_COUNT = 6;

export const searchStats = { probes: 0, p1Nodes: 0, p2Nodes: 0, view: -1, depth: -1 };

function resetStats() {
  searchStats.probes = 0;
  searchStats.p1Nodes = 0;
  searchStats.p2Nodes = 0;
  searchStats.view = -1;
  searchStats.depth = -1;
}

/** The running budget, decremented once per search node of either phase, and the flag that
 *  aborts every level of both searches the moment it runs out. Module-level so the DFS
 *  functions see them without threading parameters through every recursive call. */
let nodesLeft = 0;

/** Asked, periodically, whether this search has been made pointless by another one.
 *
 *  Injected — this module has no idea that workers exist, and should not. The parallel client
 *  supplies a function that reads one word of a SharedArrayBuffer; everything else supplies
 *  nothing and pays a predicate that returns false.
 *
 *  It is polled rather than pushed because the search is SYNCHRONOUS: a worker in the middle of
 *  phase 1 never returns to its event loop, so a postMessage asking it to stop is not read until
 *  the search it was meant to stop has finished. One shared word is the only channel that
 *  reaches inside a running search. */
let stopRequested = () => false;

/** The phase-1 depth the outer loop is currently exploring, so the stop predicate can be asked
 *  a question it can answer: not "should I stop" but "can anything I find from here still be
 *  better than what someone else already has". Module-level for the same reason the bounds are:
 *  the search is one synchronous walk with nowhere to thread a parameter through.
 *
 *  -1 means "no depth applies", and every entry point that reaches phase1DFS must leave it that
 *  way. solveIntoG1 is such an entry point and has no depth of its own; without the reset it
 *  would hand the predicate a depth left over from the last solvePattern, and a stop decision
 *  would be made about a search that had already finished. */
let currentDepth = -1;

/** How often to ask. Every 65536 nodes: a node is ~20 ns, so the question costs well under a
 *  thousandth of the work between asks, and the latency it adds to a stop is ~1 ms. Checking
 *  every node would be correct and measurably slower; checking every million would make a stop
 *  arrive too late to matter. */
const STOP_POLL_MASK = 0xffff;

/**
 * Install the predicate the search polls, or clear it with null.
 *
 * Module-level like the bounds, and for the same reason: the search is one synchronous walk with
 * no per-call context to thread a callback through. A caller that sets it owns clearing it.
 */
export function setStopSignal(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('two-phase: the stop signal must be a function or null');
  }
  stopRequested = fn ?? (() => false);
}


let exhausted = false;

/** How deep a phase-2 tail is worth searching. A failing probe costs the whole IDA* ladder up
 *  to its depth limit, so this cap is what makes a probe's worst case affordable; solutions
 *  with longer tails are rare and their totals keep being found from other phase-1 prefixes.
 *  12 was chosen by measurement (dev-docs/solver-move-count.md §7 — a cap of 10 measured
 *  WORSE); settable only as a measurement knob for the ladder benchmark. */
let MAX_PHASE2 = 12;

/**
 * Partial update: only the fields present change, and the change persists until the next call
 * — which is why lib/solver-engine.js passes explicit bounds on every solve rather than
 * trusting what a previous caller left here. Everything is validated on the way in: a NaN
 * budget would otherwise defeat the decrement-based termination check and search forever.
 */
export function setBounds(b) {
  // Validate everything FIRST, commit together after: a call like {solLen: 10, probeMax: NaN}
  // must change nothing at all, not leave solLen moved behind a thrown budget.
  if (b.solLen !== undefined) {
    // ≥ 1 (asking for a zero-move solution is answerable — by a solved cube); ≤ 24 keeps the
    // replay stacks in bounds. The app's own ceiling is tighter (LOOSEST_BOUND, solver-engine).
    if (!Number.isInteger(b.solLen) || b.solLen < 1 || b.solLen > 24) {
      throw new RangeError(`two-phase: solLen ${b.solLen} is not an integer in 1..24`);
    }
  }
  if (b.probeMax !== undefined && (!Number.isSafeInteger(b.probeMax) || b.probeMax < 1)) {
    throw new RangeError(`two-phase: probeMax ${b.probeMax} is not a positive integer`);
  }
  if (b.maxPhase2 !== undefined && (!Number.isInteger(b.maxPhase2) || b.maxPhase2 < 1 || b.maxPhase2 > 18)) {
    throw new RangeError(`two-phase: maxPhase2 ${b.maxPhase2} is not an integer in 1..18`);
  }
  if (b.solLen !== undefined) BOUNDS.solLen = b.solLen;
  if (b.probeMax !== undefined) BOUNDS.probeMax = b.probeMax;
  if (b.maxPhase2 !== undefined) MAX_PHASE2 = b.maxPhase2;
}

// Per-depth replay buffers for the probe path. A probe replays its phase-1 maneuver from the
// start state through these — 20 writes per move, no allocation, no aliasing (one buffer per
// depth). 24 is the deepest a maneuver can go under the loosest bound.
const CP_STACK = Array.from({ length: 24 }, () => new Array(8).fill(0));
const EP_STACK = Array.from({ length: 24 }, () => new Array(12).fill(0));

/** Six views of the same cube: three axes, each forward and inverted. A rotation of a legal
 *  cube is legal, so the extra parses cannot fail once the first one succeeded. */
function buildViews(facelets, state) {
  const identityMap = Array.from({ length: P1_WIDTH }, (_, i) => i);
  const frames = [{ st: state, mapBack: identityMap }];
  for (const { rotate, mapBack } of rotations) {
    frames.push({ st: parseFacelets(rotate(facelets)), mapBack });
  }
  const views = [];
  for (const { st, mapBack } of frames) {
    views.push({ st, mapBack, inverted: false });
    views.push({ st: inverseState(st), mapBack, inverted: true });
  }
  for (const [index, view] of views.entries()) {
    view.index = index;
    view.t = twistOf(view.st.co);
    view.f = flipOf(view.st.eo);
    view.s = sliceOf(view.st.ep);
  }
  return views;
}

// The probe path's scratch: the phase-2 tail under construction. Module-level like the replay
// stacks — the search is synchronous and single-threaded, so one is enough.
const TAIL = [];

/**
 * One probe: replay the phase-1 maneuver to the view's G1 permutations, then try phase-2
 * completions from the pruning bound up to the depth left (capped by MAX_PHASE2). Returns the
 * answer mapped back into the caller's frame, or null.
 */
function probeView(view, path, d2max) {
  searchStats.probes++;
  let cp = view.st.cp;
  let ep = view.st.ep;
  for (let k = 0; k < path.length; k++) {
    const mcp = MOVE_CP[path[k]];
    const mep = MOVE_EP[path[k]];
    const ncp = CP_STACK[k];
    const nep = EP_STACK[k];
    for (let i = 0; i < 8; i++) ncp[i] = cp[mcp[i]];
    for (let i = 0; i < 12; i++) nep[i] = ep[mep[i]];
    cp = ncp;
    ep = nep;
  }
  const c = rankFirst8(cp);
  const e = rankFirst8(ep); // in G1 the U/D slots hold exactly the U/D edges
  const sp = rankSlice4(ep);
  const h2 = Math.max(PRUNE2C[c * PERM4_COUNT + sp], PRUNE2E[e * PERM4_COUNT + sp]);
  const d2cap = d2max < MAX_PHASE2 ? d2max : MAX_PHASE2;
  if (h2 > d2cap) return null;
  const prev = path.length ? path[path.length - 1] : -1;
  for (let d2 = h2; d2 <= d2cap && !exhausted; d2++) {
    TAIL.length = 0;
    if (phase2DFS(c, e, sp, d2, prev, TAIL)) {
      // Under the exclusive bound by construction: d1 + d2 <= solLen - 1. An inverted view's
      // maneuver solves the inverse, so it is reversed and inverted; then µ⁻¹ brings every
      // move back into the caller's frame.
      let moves = [...path, ...TAIL];
      if (view.inverted) moves = moves.reverse().map(invMoveIdx);
      return moves.map((m) => MOVE_NAMES[view.mapBack[m]]).join(' ');
    }
  }
  return null;
}

/**
 * Solve a facelet string within the current bounds: an alg strictly shorter than `solLen`
 * ('' for an already-solved cube), or null — out of budget, or not a solvable cube. Never an
 * error string; that was min2phase's idiom and it stops at this module's edge.
 *
 * One probe is one phase-1 maneuver handed to phase 2. The first solution that satisfies the
 * bound is returned as found — the caller asks again with a tighter bound to improve it, which
 * is exactly how lib/solve-target.js's tiered descent drives this.
 */
export function solvePattern(facelets, viewFilter = null) {
  initialize();
  resetStats();
  const state = parseFacelets(facelets);
  if (state === null) return null;

  const { solLen, probeMax } = BOUNDS;
  const maxTotal = solLen - 1;
  nodesLeft = probeMax;
  exhausted = false;
  let views = buildViews(facelets, state);
  // A slice of the six, for a caller searching the rest elsewhere. Filtering rather than
  // rebuilding keeps `view.index` the index within ALL views, which is what makes the answers
  // from separate slices comparable: the sequential engine returns the lowest view index at the
  // lowest depth, and a parallel caller can only reproduce that if the indices still mean the
  // same thing. Null is every view, which is every caller but the parallel client.
  if (viewFilter !== null) {
    const wanted = new Set(viewFilter);
    if (wanted.size === 0) throw new RangeError('two-phase: an empty view filter searches nothing');
    for (const i of wanted) {
      if (!Number.isInteger(i) || i < 0 || i >= views.length) {
        throw new RangeError(`two-phase: view ${i} is not one of the ${views.length} views`);
      }
    }
    views = views.filter((v) => wanted.has(v.index));
  }

  let answer = null;
  // Phase-1 depth is not capped at the 12-move diameter: with a tight bound the best split may
  // be a LONGER phase-1 maneuver with a short phase-2 tail, and at the limit the whole solution
  // is phase 1 alone. The node budget is what bounds the work, and it is shared across all six
  // views — deterministic however the search's luck falls.
  outer: for (let d1 = 0; d1 <= maxTotal && !exhausted; d1++) {
    currentDepth = d1;
    // Asked once per depth as well as every 65536 nodes: a slice whose remaining depths cannot
    // beat an answer someone else already holds should not start the next one at all.
    if (stopRequested(d1)) break;
    const d2max = maxTotal - d1;
    for (const view of views) {
      const aborted = phase1DFS(view.t, view.f, view.s, d1, -1, [], (path) => {
        answer = probeView(view, path, d2max);
        if (answer !== null) {
          searchStats.view = view.index;
          // The phase-1 depth this answer was found at. With the view index it forms the key a
          // parallel caller sorts on — (depth, view) is exactly the order this loop already
          // searches in, so picking the minimum across slices reproduces the sequential answer
          // whatever order the slices finished in.
          searchStats.depth = d1;
          return true;
        }
        return exhausted; // a probe that ran out of budget stops the enumeration too
      });
      if (answer !== null || aborted) break outer;
    }
  }
  currentDepth = -1; // no depth applies once the loop is done; a stale one is a stop about nothing
  return answer;
}
