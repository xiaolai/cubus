// Orientation resolution: the 24 whole-cube orientations as facelet permutations
// (a geometric model), plus a resolver that, given the believed state and a
// camera-frame observation, returns the CONSISTENT orientations — one for a
// 3-face view, the irreducible 4-way D4 set for a single-face view (algorithm
// §12/#2). Orientation is resolved INSIDE the core; the observation is never
// handed pre-resolved cube coordinates (§12/#19).
//
// Camera-frame indices use the same 0..53 URFDLB layout as cube coordinates, but
// in the CAMERA's frame: `render(S, o)[i]` is the color the camera sees at camera
// slot i when the physical cube (state S) is rotated by orientation o.

import { FACES, type Face, type Orientation } from './cube.js';
import type { CubeView, ViewCell } from './likelihood.js';

type Vec3 = readonly [number, number, number];
type Mat3 = readonly number[]; // row-major length 9

const NORMAL: Record<Face, Vec3> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};
const RIGHT: Record<Face, Vec3> = {
  U: [1, 0, 0],
  R: [0, 0, -1],
  F: [1, 0, 0],
  D: [1, 0, 0],
  L: [0, 0, 1],
  B: [-1, 0, 0],
};
const DOWN: Record<Face, Vec3> = {
  U: [0, 0, 1],
  R: [0, -1, 0],
  F: [0, -1, 0],
  D: [0, 0, -1],
  L: [0, -1, 0],
  B: [0, -1, 0],
};

/** 3D center of each of the 54 facelets (index = face*9 + row*3 + col). */
const CENTERS: Vec3[] = (() => {
  const out: Vec3[] = [];
  for (const f of FACES) {
    const n = NORMAL[f];
    const rt = RIGHT[f];
    const dn = DOWN[f];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        out.push([
          n[0] * 1.5 + rt[0] * (c - 1) + dn[0] * (r - 1),
          n[1] * 1.5 + rt[1] * (c - 1) + dn[1] * (r - 1),
          n[2] * 1.5 + rt[2] * (c - 1) + dn[2] * (r - 1),
        ]);
  }
  return out;
})();

const RX: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0]; // +90° about +x: (x,y,z)->(x,-z,y)
const RY: Mat3 = [0, 0, 1, 0, 1, 0, -1, 0, 0]; // +90° about +y: (x,y,z)->(z,y,-x)
const IDENTITY_MAT: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function matMul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k]! * b[k * 3 + j]!;
      out[i * 3 + j] = s;
    }
  return out;
}
function matVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}
function transpose(m: Mat3): Mat3 {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}
const matKey = (m: Mat3): string => m.map((x) => Math.round(x)).join(',');

/** The 24 proper rotations of the cube as 3×3 matrices, generated from RX and RY. */
const ROTATION_MATS: Mat3[] = (() => {
  const seen = new Map<string, Mat3>([[matKey(IDENTITY_MAT), IDENTITY_MAT]]);
  const queue = [IDENTITY_MAT];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const g of [RX, RY]) {
      const next = matMul(g, cur);
      const k = matKey(next);
      if (!seen.has(k)) {
        seen.set(k, next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()];
})();

function nearestFacelet(p: Vec3): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 54; i++) {
    const c = CENTERS[i]!;
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Per-orientation facelet permutation: `PERMS[o][i]` is the cube facelet whose
 * color appears at camera slot `i` when the cube is rotated by orientation `o`.
 */
export const PERMS: number[][] = ROTATION_MATS.map((m) => {
  const inv = transpose(m);
  return Array.from({ length: 54 }, (_, i) => nearestFacelet(matVec(inv, CENTERS[i]!)));
});

export const ORIENTATION_COUNT = PERMS.length;

/** The face-map (URFDLB slot → physical face) induced by orientation `o`. */
export function faceMapOf(o: number): Orientation {
  const centerIdx: Record<Face, number> = { U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 };
  return FACES.map((slot) => {
    // camera center of `slot` shows the physical face whose center facelet is PERMS[o][centerIndex(slot)]
    const cubeFacelet = PERMS[o]![centerIdx[slot]]!;
    return FACES[Math.floor(cubeFacelet / 9)]!;
  });
}

/** The color the camera sees at each slot when state `facelets` is rotated by `o`. */
export function render(facelets: string, o: number): string {
  return PERMS[o]!.map((cubeIdx) => facelets[cubeIdx]).join('');
}

/** One camera-frame observed cell: a camera slot index (0..53) and its soft color. */
export interface CameraCell {
  slot: number;
  soft: import('./types.js').SoftColor;
}

/** Map a camera-frame observation to a cube-coordinate view, under orientation `o`. */
export function toCubeView(cells: CameraCell[], o: number): CubeView {
  const perm = PERMS[o]!;
  const out: ViewCell[] = cells.map((c) => ({ index: perm[c.slot]!, soft: c.soft }));
  return { cells: out };
}

/**
 * The orientations consistent with a camera observation of the believed state.
 * Returns the argmax-scoring set (within `tol`) — a unique orientation for a rich
 * (3-face) view, the 4-way D4 set for a single-face view.
 */
export function resolveOrientations(
  believedFacelets: string,
  cells: CameraCell[],
  tol = 1e-6,
): number[] {
  return bestOrientationMatch(believedFacelets, cells, tol).orientations;
}

/**
 * The best mean-match score of any orientation, plus the argmax set. Recovery
 * scores each ball candidate by this (its best-orientation fit to the view).
 */
export function bestOrientationMatch(
  believedFacelets: string,
  cells: CameraCell[],
  tol = 1e-6,
): { score: number; orientations: number[] } {
  if (cells.length === 0) return { score: 0, orientations: [...Array(ORIENTATION_COUNT).keys()] };
  const scores = PERMS.map((perm) => {
    let s = 0;
    for (const c of cells) s += c.soft[believedFacelets[perm[c.slot]!] as Face];
    return s / cells.length;
  });
  const best = Math.max(...scores);
  const orientations: number[] = [];
  for (let o = 0; o < scores.length; o++) if (best - scores[o]! <= tol) orientations.push(o);
  return { score: best, orientations };
}
