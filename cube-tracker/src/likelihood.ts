// Observation likelihood: how well a candidate state explains a partial view, in
// cube coordinates. Kept deliberately robust — every cell is ε-floored (never
// log 0), an `unknown` cell is non-discriminating, and a null/outlier baseline
// lets the belief reject an off-model view instead of committing a wrong move
// (algorithm §12/#4, #18).

import { type CubeState, type Face, encodeFacelets } from './cube.js';
import type { SoftColor } from './types.js';

/** One observed cell mapped to a cube facelet index. */
export interface ViewCell {
  index: number; // 0..53
  soft: SoftColor;
}

/** A partial observation expressed in CUBE coordinates (orientation already applied). */
export interface CubeView {
  cells: ViewCell[];
}

const EPS = 1e-6;
const UNIFORM = 1 / 6;

/** log P(observe this soft color | the true color at the cell is `predicted`). */
export function cellLogLik(predicted: Face, soft: SoftColor): number {
  // An occluded cell (high `unknown`) spreads its mass uniformly, so it neither
  // rewards nor punishes any prediction.
  const p = soft[predicted] * (1 - soft.unknown) + soft.unknown * UNIFORM;
  return Math.log(Math.max(p, EPS));
}

/** Total log-likelihood of `facelets` (a candidate's 54-char string) under a view. */
export function scoreFacelets(facelets: string, view: CubeView): number {
  let s = 0;
  for (const c of view.cells) s += cellLogLik(facelets[c.index] as Face, c.soft);
  return s;
}

/** Convenience: encode a state and score it. */
export function scoreView(state: CubeState, view: CubeView): number {
  return scoreFacelets(encodeFacelets(state), view);
}

/** Mean per-cell log-likelihood — the absolute-fit measure the commit rule floors on. */
export function meanCellLogLik(facelets: string, view: CubeView): number {
  return view.cells.length === 0
    ? Number.NEGATIVE_INFINITY
    : scoreFacelets(facelets, view) / view.cells.length;
}

/**
 * The null / outlier hypothesis: "no modeled transition explains this view."
 * Baseline = uniform-color likelihood per cell. A candidate must beat this to be
 * believed at all.
 */
export function nullLogLik(view: CubeView): number {
  return view.cells.length * Math.log(UNIFORM);
}

/** Number of visible cells where two candidate facelet strings predict different colors. */
export function discrimCells(fa: string, fb: string, view: CubeView): number {
  let n = 0;
  for (const c of view.cells) if (fa[c.index] !== fb[c.index]) n++;
  return n;
}

/** Build a sharp soft color that puts most mass on one face (test/perception helper). */
export function sharpSoft(color: Face, p = 0.9): SoftColor {
  const rest = (1 - p) / 6; // spread the remainder over 6 colors + unknown-ish
  const out = { U: rest, R: rest, F: rest, D: rest, L: rest, B: rest, unknown: rest } as SoftColor;
  out[color] = p + rest;
  return normalizeSoft(out);
}

/** An all-unknown soft color (occluded cell). */
export function unknownSoft(): SoftColor {
  const e = EPS;
  return { U: e, R: e, F: e, D: e, L: e, B: e, unknown: 1 - 6 * e };
}

/** Renormalize a soft color to sum to 1 with an ε floor on every component. */
export function normalizeSoft(s: SoftColor): SoftColor {
  const keys: (keyof SoftColor)[] = ['U', 'R', 'F', 'D', 'L', 'B', 'unknown'];
  let sum = 0;
  for (const k of keys) sum += Math.max(s[k], EPS);
  const out = {} as SoftColor;
  for (const k of keys) out[k] = Math.max(s[k], EPS) / sum;
  return out;
}
