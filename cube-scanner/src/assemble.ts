// Turn 6 captured faces into a validated ScanResult. Two independent checks
// gate `valid`: our own pure parity math (facelet-cube) AND a cubejs round-trip.
// cubejs is a deliberately separate implementation, so agreement between the two
// is real evidence the scan is a well-formed, solvable cube — not a shared bug.

import Cube from 'cubejs';
import { classify } from './classify.js';
import { isStructurallyValid } from './facelet-cube.js';
import { FACES, type Face, type RGB, type ScanResult } from './types.js';

/** Below this per-sticker confidence, a sticker is flagged for re-capture. */
export const LOW_CONFIDENCE_THRESHOLD = 0.15;

/** cubejs parses the string and re-serializes to the same facelets. */
function cubejsRoundTrips(facelets: string): boolean {
  try {
    return Cube.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}

/**
 * @param faces 6 faces, each an array of 9 sticker colors in reading order.
 * @param threshold per-sticker confidence below which a sticker is flagged.
 */
export function assemble(
  faces: Record<Face, RGB[]>,
  threshold: number = LOW_CONFIDENCE_THRESHOLD,
): ScanResult {
  if (!Number.isFinite(threshold)) {
    throw new Error(`lowConfidence threshold must be a finite number, got ${threshold}`);
  }
  const centers: RGB[] = [];
  const samples: RGB[] = [];
  for (const face of FACES) {
    const stickers = faces[face];
    if (!stickers || stickers.length !== 9) {
      throw new Error(`face ${face}: expected 9 samples, got ${stickers?.length ?? 0}`);
    }
    centers.push(stickers[4]!);
    for (const rgb of stickers) samples.push(rgb);
  }

  const { letters, confidence } = classify(samples, centers);
  const facelets = letters.join('');
  const valid = isStructurallyValid(facelets) && cubejsRoundTrips(facelets);

  let min = 1;
  const lowConfidence: number[] = [];
  for (let i = 0; i < confidence.length; i++) {
    const c = confidence[i]!;
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  }

  return { facelets, valid, confidence: min, lowConfidence };
}
