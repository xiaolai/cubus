// Center-referenced soft color classification (algorithm §3.3, §13). A sample is
// classified RELATIVE to the session's 6 center colors, by CIEDE2000 in CIELAB —
// calibration-free and illumination-tolerant. Output is a soft distribution with an
// ε-floor on all six colors PLUS an explicit `unknown` mass for glare / skin / off-
// sticker pixels (never a hard label — §12/#18). Color math is via culori, never
// hand-rolled (same discipline as cube-scanner).

import { converter, differenceCiede2000 } from 'culori';
import type { Face } from '../cube.js';
import { normalizeSoft } from '../likelihood.js';
import type { SoftColor } from '../types.js';

/** sRGB triple, each channel 0..255. */
export type RGB = [number, number, number];

const toLab = converter('lab65');
const ciede = differenceCiede2000();

function culoriRgb([r, g, b]: RGB): { mode: 'rgb'; r: number; g: number; b: number } {
  return { mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 };
}

/** CIEDE2000 distance between two sRGB colors. */
export function ciede2000(a: RGB, b: RGB): number {
  return ciede(toLab(culoriRgb(a)), toLab(culoriRgb(b)));
}

export interface ClassifyOptions {
  temp: number; // softmax temperature in ΔE00 units (smaller = sharper)
  farMid: number; // ΔE00 at which `unknown` mass reaches 0.5
  farScale: number; // steepness of the unknown transition
}
export const DEFAULT_CLASSIFY: ClassifyOptions = { temp: 6, farMid: 26, farScale: 5 };

/**
 * Classify one sample against the 6 center colors → a soft distribution.
 * @param centers the 6 face-center colors, URFDLB order.
 */
export function classifySoft(
  sample: RGB,
  centers: Record<Face, RGB>,
  opts: ClassifyOptions = DEFAULT_CLASSIFY,
): SoftColor {
  const faces: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
  const dist = faces.map((f) => ciede2000(sample, centers[f]));
  const minD = Math.min(...dist);
  // far from every center (glare / skin / not a sticker) -> high unknown mass
  const unknownMass = 1 / (1 + Math.exp(-(minD - opts.farMid) / opts.farScale));

  const weights = dist.map((d) => Math.exp(-d / opts.temp));
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const soft = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0, unknown: unknownMass } as SoftColor;
  faces.forEach((f, i) => {
    soft[f] = (weights[i]! / wSum) * (1 - unknownMass);
  });
  return normalizeSoft(soft);
}

/** Standard speedcube sticker colors (U white, R red, F green, D yellow, L orange, B blue). */
export const CANONICAL_CENTERS: Record<Face, RGB> = {
  U: [245, 245, 245],
  R: [200, 30, 30],
  F: [0, 150, 70],
  D: [255, 215, 0],
  L: [255, 120, 0],
  B: [0, 80, 200],
};
