// Pure facelet <-> cubie logic and the solvability check. No I/O, no cubejs —
// this is the parity gate that lets `assemble` reject a bad scan instead of
// trusting it. `assemble` layers cubejs on top as an independent cross-check.
//
// Facelet order is Kociemba URFDLB (54 chars). The corner/edge index tables are
// the standard Kociemba face-cube maps (the same tables gan-driver uses to
// encode the hardware state).

import { FACES, type Face } from './types.js';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

// Facelet indices for each cubie slot. Corner order URF UFL ULB UBR DFR DLF DBL
// DRB; edge order UR UF UL UB DR DF DL DB FR FL BL BR. Index 0 of every corner
// is its U/D ("up/down") facelet — the anchor for orientation.
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

// Solved-color letters of each cubie, in the slot's own facelet order.
const CORNER_COLOR: readonly string[][] = CORNER_FACELET.map((t) => t.map((i) => SOLVED[i]!));
const EDGE_COLOR: readonly string[][] = EDGE_FACELET.map((t) => t.map((i) => SOLVED[i]!));

/** The four sides of a face, in the order CSS `border-color` takes them. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Face-relative position of each edge-centre facelet, in a face's reading order. */
const SIDE_OF_POSITION: Readonly<Record<number, Side>> = {
  1: 'top',
  5: 'right',
  7: 'bottom',
  3: 'left',
};

/**
 * Which face borders each face on each side, with every face held in its canonical URFDLB
 * orientation — e.g. U has B above, R right, F below, L left.
 *
 * DERIVED from EDGE_FACELET rather than written out, because the twelve edge pairs already
 * contain all 24 (face, side) answers: each pair names two edge-centre facelets that touch, and
 * an edge-centre's position within its face IS the side it lies on. Writing the table by hand
 * would let it drift from the layout the solvability gate uses.
 *
 * The scan screen paints each face tile's four edges in these colours, so a user can see which
 * way up to hold a side. `apps/web/lib/app.js` carries a copy (it cannot import TypeScript);
 * `tests/facelet-cube.test.ts` pins the two equal.
 */
export const FACE_NEIGHBOURS: Readonly<Record<Face, Readonly<Record<Side, Face>>>> = (() => {
  const out = {} as Record<Face, Record<Side, Face>>;
  for (const f of FACES) out[f] = {} as Record<Side, Face>;
  for (const pair of EDGE_FACELET) {
    const [a, b] = [pair[0]!, pair[1]!];
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const side = SIDE_OF_POSITION[from % 9];
      if (side !== undefined) out[FACES[Math.floor(from / 9)]!]![side] = FACES[Math.floor(to / 9)]!;
    }
  }
  return out;
})();

/** A cube as cubie permutations + orientations. */
export interface CubeState {
  cp: number[];
  co: number[];
  ep: number[];
  eo: number[];
}

/** Which facelet indices carry the 6 face centers, in URFDLB order. */
export const CENTER_INDEX: Readonly<Record<Face, number>> = {
  U: 4,
  R: 13,
  F: 22,
  D: 31,
  L: 40,
  B: 49,
};

/**
 * Decode a facelet string into cubie permutation + orientation, or `null` if
 * any corner/edge is not a real cubie (an impossible sticker combination — the
 * commonest sign of a misread scan).
 */
export function decodeFacelets(f: string): CubeState | null {
  if (f.length !== 54) return null;

  const cp = new Array<number>(8);
  const co = new Array<number>(8);
  for (let i = 0; i < 8; i++) {
    const slot = CORNER_FACELET[i]!;
    // Orientation = the position of the U/D facelet within this slot.
    let ori = 0;
    for (; ori < 3; ori++) {
      const c = f[slot[ori]!]!;
      if (c === 'U' || c === 'D') break;
    }
    if (ori === 3) return null; // no U/D sticker on this corner -> invalid
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

/** Encode cubie permutation + orientation back into a facelet string. */
export function encodeFacelets(s: CubeState): string {
  const f = SOLVED.split('');
  for (let i = 0; i < 8; i++) {
    const dst = CORNER_FACELET[i]!;
    const src = CORNER_FACELET[s.cp[i]!]!;
    const ori = s.co[i]!;
    for (let p = 0; p < 3; p++) f[dst[(p + ori) % 3]!] = SOLVED[src[p]!]!;
  }
  for (let i = 0; i < 12; i++) {
    const dst = EDGE_FACELET[i]!;
    const src = EDGE_FACELET[s.ep[i]!]!;
    const ori = s.eo[i]!;
    for (let p = 0; p < 2; p++) f[dst[(p + ori) % 2]!] = SOLVED[src[p]!]!;
  }
  return f.join('');
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
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v > max) return false;
  }
  return true;
}

function parity(a: number[]): number {
  let inversions = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      if (a[i]! > a[j]!) inversions++;
    }
  }
  return inversions & 1;
}

/**
 * The three classic cube-group invariants: valid permutations, corner-twist sum
 * ≡ 0 (mod 3), edge-flip sum ≡ 0 (mod 2), and matching corner/edge permutation
 * parity. True iff the state is actually reachable by legal moves.
 */
export function isSolvable(s: CubeState): boolean {
  if (!isPermutation(s.cp, 8) || !isPermutation(s.ep, 12)) return false;
  // Orientations must also be well-formed: 8 corner twists in {0,1,2}, 12 edge
  // flips in {0,1}. Without this a crafted state with empty co/eo passes.
  if (!inDomain(s.co, 8, 2) || !inDomain(s.eo, 12, 1)) return false;
  const coSum = s.co.reduce((sum, v) => sum + v, 0);
  const eoSum = s.eo.reduce((sum, v) => sum + v, 0);
  if (coSum % 3 !== 0) return false;
  if (eoSum % 2 !== 0) return false;
  return parity(s.cp) === parity(s.ep);
}

/** True iff every face center holds its own URFDLB letter. */
export function centersOk(f: string): boolean {
  return (
    f.length === 54 &&
    f[CENTER_INDEX.U] === 'U' &&
    f[CENTER_INDEX.R] === 'R' &&
    f[CENTER_INDEX.F] === 'F' &&
    f[CENTER_INDEX.D] === 'D' &&
    f[CENTER_INDEX.L] === 'L' &&
    f[CENTER_INDEX.B] === 'B'
  );
}

/** True iff the facelet string is a well-formed, solvable cube (pure check). */
export function isStructurallyValid(f: string): boolean {
  if (!centersOk(f)) return false;
  const state = decodeFacelets(f);
  return state !== null && isSolvable(state);
}

export const SOLVED_FACELETS = SOLVED;
