// The verified cube engine: CubeState as cubie permutation + orientation, the 18
// half-turn moves, the cube-group legality check, facelet encode/decode, and the
// 24 whole-cube orientations. This is the correctness foundation — its move
// tables are the standard Kociemba generators, validated in tests against known
// group facts (single-face order 4, sexy-move order 6, R·U order 105, superflip
// an involution) and cross-checked against cubejs. See
// dev-docs/cube-tracker-algorithm.md and dev-docs/research/verify-tracker-claims.mjs.

/** The six faces, in Kociemba / URFDLB order. */
export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';
export const FACES: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B'] as const;

/** A quarter/half/reverse turn of one face, e.g. 'U', 'U2', "U'". 18 in total. */
export type Move = Face | `${Face}2` | `${Face}'`;

/** A cube as cubie permutation + orientation (centers implicit — the standard rep). */
export interface CubeState {
  cp: number[]; // corner permutation (8)
  co: number[]; // corner orientation (8), each 0..2
  ep: number[]; // edge permutation (12)
  eo: number[]; // edge orientation (12), each 0..1
}

/** The solved cube. */
export const SOLVED_STATE: CubeState = {
  cp: [0, 1, 2, 3, 4, 5, 6, 7],
  co: [0, 0, 0, 0, 0, 0, 0, 0],
  ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

// Standard Kociemba basic-move generators (corner labels URF UFL ULB UBR DFR DLF
// DBL DRB = 0..7; edge labels UR UF UL UB DR DF DL DB FR FL BL BR = 0..11).
const BASE: Readonly<Record<Face, CubeState>> = {
  U: {
    cp: [3, 0, 1, 2, 4, 5, 6, 7],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  R: {
    cp: [4, 1, 2, 0, 7, 5, 6, 3],
    co: [2, 0, 0, 1, 1, 0, 0, 2],
    ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  F: {
    cp: [1, 5, 2, 3, 0, 4, 6, 7],
    co: [1, 2, 0, 0, 2, 1, 0, 0],
    ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11],
    eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0],
  },
  D: {
    cp: [0, 1, 2, 3, 5, 6, 7, 4],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  L: {
    cp: [0, 2, 6, 3, 4, 1, 5, 7],
    co: [0, 1, 2, 0, 0, 2, 1, 0],
    ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  B: {
    cp: [0, 1, 3, 7, 4, 5, 2, 6],
    co: [0, 0, 1, 2, 0, 0, 2, 1],
    ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7],
    eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1],
  },
};

/** Cube-group product a·b — apply a, then b (matches cubejs's cubie multiply). */
export function multiply(a: CubeState, b: CubeState): CubeState {
  const cp = new Array<number>(8);
  const co = new Array<number>(8);
  for (let i = 0; i < 8; i++) {
    cp[i] = a.cp[b.cp[i]!]!;
    co[i] = (a.co[b.cp[i]!]! + b.co[i]!) % 3;
  }
  const ep = new Array<number>(12);
  const eo = new Array<number>(12);
  for (let i = 0; i < 12; i++) {
    ep[i] = a.ep[b.ep[i]!]!;
    eo[i] = (a.eo[b.ep[i]!]! + b.eo[i]!) % 2;
  }
  return { cp, co, ep, eo };
}

/** The group inverse of a state. */
export function inverse(s: CubeState): CubeState {
  const cp = new Array<number>(8);
  const co = new Array<number>(8);
  const ep = new Array<number>(12);
  const eo = new Array<number>(12);
  for (let e = 0; e < 12; e++) ep[s.ep[e]!] = e;
  for (let e = 0; e < 12; e++) eo[e] = s.eo[ep[e]!]! % 2;
  for (let c = 0; c < 8; c++) cp[s.cp[c]!] = c;
  for (let c = 0; c < 8; c++) {
    const ori = s.co[cp[c]!]!;
    co[c] = ori === 0 ? 0 : 3 - ori;
  }
  return { cp, co, ep, eo };
}

/** All 18 moves, in a canonical order (face-major: U U2 U' R R2 R' …). */
export const MOVE_NAMES: readonly Move[] = FACES.flatMap((f): Move[] => [f, `${f}2`, `${f}'`]);

/** The precomputed cubie of every move (base, its square, and its inverse). */
export const MOVES: Readonly<Record<Move, CubeState>> = (() => {
  const out = {} as Record<Move, CubeState>;
  for (const f of FACES) {
    const base = BASE[f];
    out[f] = base;
    out[`${f}2`] = multiply(base, base);
    out[`${f}'`] = multiply(multiply(base, base), base);
  }
  return out;
})();

/** Apply a move to a state. */
export function applyMove(s: CubeState, m: Move): CubeState {
  return multiply(s, MOVES[m]);
}

/** Apply a sequence of moves (space-separated or an array) to a state. */
export function applySequence(s: CubeState, moves: readonly Move[] | string): CubeState {
  const list = typeof moves === 'string' ? (moves.trim().split(/\s+/) as Move[]) : moves;
  let out = s;
  for (const m of list) {
    if (!m) continue;
    // Fail loud at the string boundary: a bad token would otherwise crash cryptically
    // inside multiply() with an undefined move.
    if (!(m in MOVES)) throw new Error(`applySequence: unknown move "${m}"`);
    out = applyMove(out, m);
  }
  return out;
}

/** A stable, comparable key for a state. */
export function stateKey(s: CubeState): string {
  return `${s.cp.join(',')}|${s.co.join(',')}|${s.ep.join(',')}|${s.eo.join(',')}`;
}

export function statesEqual(a: CubeState, b: CubeState): boolean {
  return stateKey(a) === stateKey(b);
}

export function cloneState(s: CubeState): CubeState {
  return { cp: [...s.cp], co: [...s.co], ep: [...s.ep], eo: [...s.eo] };
}

function isPermutation(a: number[], n: number): boolean {
  if (a.length !== n) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]!) return false;
    seen[v] = true;
  }
  return true;
}

function inDomain(a: number[], n: number, max: number): boolean {
  if (a.length !== n) return false;
  for (const v of a) if (!Number.isInteger(v) || v < 0 || v > max) return false;
  return true;
}

function parity(a: number[]): number {
  let inv = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) if (a[i]! > a[j]!) inv++;
  return inv & 1;
}

/** True iff the state is actually reachable by legal moves (the cube-group invariants). */
export function isSolvable(s: CubeState): boolean {
  if (!isPermutation(s.cp, 8) || !isPermutation(s.ep, 12)) return false;
  if (!inDomain(s.co, 8, 2) || !inDomain(s.eo, 12, 1)) return false;
  if (s.co.reduce((sum, v) => sum + v, 0) % 3 !== 0) return false;
  if (s.eo.reduce((sum, v) => sum + v, 0) % 2 !== 0) return false;
  return parity(s.cp) === parity(s.ep);
}

// --- facelet encode/decode (Kociemba URFDLB, 54 chars) -----------------------

const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const CORNER_FACELET: readonly (readonly number[])[] = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51],
];
const EDGE_FACELET: readonly (readonly number[])[] = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
  [32, 16],
  [28, 25],
  [30, 43],
  [34, 52],
  [23, 12],
  [21, 41],
  [50, 39],
  [48, 14],
];
const CORNER_COLOR = CORNER_FACELET.map((t) => t.map((i) => SOLVED_FACELETS[i]!));
const EDGE_COLOR = EDGE_FACELET.map((t) => t.map((i) => SOLVED_FACELETS[i]!));

/** Which facelet index carries each face center, URFDLB order. */
export const CENTER_INDEX: Readonly<Record<Face, number>> = {
  U: 4,
  R: 13,
  F: 22,
  D: 31,
  L: 40,
  B: 49,
};

/** The 9 facelet indices of a face, URFDLB order (U = 0..8, R = 9..17, …). */
export function faceIndices(f: Face): number[] {
  const base = FACES.indexOf(f) * 9;
  return Array.from({ length: 9 }, (_, i) => base + i);
}

/** Encode a state into its 54-char facelet string. */
export function encodeFacelets(s: CubeState): string {
  const f = SOLVED_FACELETS.split('');
  for (let i = 0; i < 8; i++) {
    const dst = CORNER_FACELET[i]!;
    const src = CORNER_FACELET[s.cp[i]!]!;
    const ori = s.co[i]!;
    for (let p = 0; p < 3; p++) f[dst[(p + ori) % 3]!] = SOLVED_FACELETS[src[p]!]!;
  }
  for (let i = 0; i < 12; i++) {
    const dst = EDGE_FACELET[i]!;
    const src = EDGE_FACELET[s.ep[i]!]!;
    const ori = s.eo[i]!;
    for (let p = 0; p < 2; p++) f[dst[(p + ori) % 2]!] = SOLVED_FACELETS[src[p]!]!;
  }
  return f.join('');
}

/** Decode a 54-char facelet string into a state, or null if the stickers are impossible. */
export function decodeFacelets(f: string): CubeState | null {
  if (f.length !== 54) return null;
  const cp = new Array<number>(8);
  const co = new Array<number>(8);
  for (let i = 0; i < 8; i++) {
    const slot = CORNER_FACELET[i]!;
    let ori = 0;
    for (; ori < 3; ori++) {
      const c = f[slot[ori]!]!;
      if (c === 'U' || c === 'D') break;
    }
    if (ori === 3) return null;
    const c0 = f[slot[ori]!]!;
    const c1 = f[slot[(ori + 1) % 3]!]!;
    const c2 = f[slot[(ori + 2) % 3]!]!;
    let found = -1;
    for (let j = 0; j < 8; j++) {
      const cc = CORNER_COLOR[j]!;
      if (c0 === cc[0] && c1 === cc[1] && c2 === cc[2]) {
        found = j;
        break;
      }
    }
    if (found < 0) return null;
    cp[i] = found;
    co[i] = ori;
  }
  const ep = new Array<number>(12);
  const eo = new Array<number>(12);
  for (let i = 0; i < 12; i++) {
    const slot = EDGE_FACELET[i]!;
    const a = f[slot[0]!]!;
    const b = f[slot[1]!]!;
    let found = -1;
    let ori = 0;
    for (let j = 0; j < 12; j++) {
      const ec = EDGE_COLOR[j]!;
      if (a === ec[0] && b === ec[1]) {
        found = j;
        ori = 0;
        break;
      }
      if (a === ec[1] && b === ec[0]) {
        found = j;
        ori = 1;
        break;
      }
    }
    if (found < 0) return null;
    ep[i] = found;
    eo[i] = ori;
  }
  return { cp, co, ep, eo };
}

/** True iff the facelet string is a well-formed, solvable cube (pure check). */
export function isStructurallyValid(f: string): boolean {
  const centersOk = f.length === 54 && FACES.every((face) => f[CENTER_INDEX[face]] === face);
  if (!centersOk) return false;
  const s = decodeFacelets(f);
  return s !== null && isSolvable(s);
}

// --- the 24 whole-cube orientations ------------------------------------------
//
// An Orientation records, for each URFDLB slot, which physical face currently
// occupies it — i.e. orientation[i] is the physical face shown where FACES[i]
// would be in the identity pose. The 24 are the proper rotations of the cube,
// generated by two axis rotations. The full facelet-level remap (incl. in-plane
// roll) lives in orientation.ts (built on this enumeration).

/** A whole-cube orientation: the physical face at each URFDLB slot. */
export type Orientation = readonly Face[]; // length 6, indexed like FACES

export const IDENTITY_ORIENTATION: Orientation = [...FACES];

// Face permutations for the two rotation generators, as URFDLB-indexed images.
// x tips the cube forward about the R–L axis: U→F→D→B→U (R, L fixed).
// y spins about the U–D axis: F→R→B→L→F (U, D fixed).
function permFromCycle(cycle: readonly Face[]): Orientation {
  const img: Face[] = [...FACES];
  for (let i = 0; i < cycle.length; i++) {
    const from = cycle[i]!;
    const to = cycle[(i + 1) % cycle.length]!;
    img[FACES.indexOf(from)] = to;
  }
  return img;
}
const ROT_X = permFromCycle(['U', 'F', 'D', 'B']);
const ROT_Y = permFromCycle(['F', 'R', 'B', 'L']);

/** Compose two orientations: (a∘b)[i] = a[indexOf(b[i])] — apply b, then a. */
export function composeOrientation(a: Orientation, b: Orientation): Orientation {
  return FACES.map((_, i) => a[FACES.indexOf(b[i]!)]!);
}

function orientationKey(o: Orientation): string {
  return o.join('');
}

/** The 24 proper rotations of the cube, as face-relabelling orientations. */
export const ORIENTATIONS: readonly Orientation[] = (() => {
  const seen = new Map<string, Orientation>();
  const queue: Orientation[] = [IDENTITY_ORIENTATION];
  seen.set(orientationKey(IDENTITY_ORIENTATION), IDENTITY_ORIENTATION);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const g of [ROT_X, ROT_Y]) {
      const next = composeOrientation(g, cur);
      const k = orientationKey(next);
      if (!seen.has(k)) {
        seen.set(k, next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()];
})();
