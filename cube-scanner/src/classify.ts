// Classify each sampled sticker against the 6 live face-center colors, by
// nearest CIEDE2000 distance. Comparing to THIS scan's own centers (not fixed
// constants) is what makes classification lighting-tolerant and calibration-
// free: warm light shifts every sticker and every center together.
//
// Per-sticker confidence is `1 - nearest/secondNearest`: near 1 when one center
// clearly wins, near 0 when two centers tie — the signal that flags an
// ambiguous sticker (the classic red/orange case) for re-capture.

import { ciede2000, toLab } from './color.js';
import { FACES, type Face, type Lab, type RGB } from './types.js';

export interface Classification {
  letters: Face[];
  confidence: number[];
}

/**
 * @param samples 54 sticker colors, URFDLB order.
 * @param centers 6 face-center colors, URFDLB order (these define the labels).
 */
export function classify(samples: RGB[], centers: RGB[]): Classification {
  if (centers.length !== 6) throw new Error(`expected 6 centers, got ${centers.length}`);
  const centerLabs: Lab[] = centers.map(toLab);

  const letters: Face[] = [];
  const confidence: number[] = [];
  for (const sample of samples) {
    const lab = toLab(sample);
    let nearest = Number.POSITIVE_INFINITY;
    let second = Number.POSITIVE_INFINITY;
    let nearestIdx = 0;
    for (let k = 0; k < 6; k++) {
      // A non-finite distance (e.g. a NaN sample) must never win the argmin.
      const d = ciede2000(lab, centerLabs[k]!);
      const dist = Number.isFinite(d) ? d : Number.POSITIVE_INFINITY;
      if (dist < nearest) {
        second = nearest;
        nearest = dist;
        nearestIdx = k;
      } else if (dist < second) {
        second = dist;
      }
    }
    letters.push(FACES[nearestIdx]!);
    // Coerce a non-finite ratio (all-NaN sample) to 0 -> flagged, not trusted.
    const raw = second === 0 ? 0 : 1 - nearest / second;
    const conf = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    confidence.push(conf);
  }
  return { letters, confidence };
}
