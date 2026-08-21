// Assemble a validated ScanResult from the AI detector's per-sticker COLOUR CLASSES
// (0..5) — the AI path's analogue of assemble.ts, which works on RGB samples and the
// classical `classify`. The guided-scan contract is identical: the caller supplies the
// 6 faces in URFDLB order, each 9 colour classes in reading order. Each sticker's face
// letter is the face whose CENTRE carries the same colour; then the SAME dual verifier
// (facelet parity in facelet-cube + an independent cubejs round-trip) gates `valid`.
//
// Colour-class indices match ml/data.yaml: 0 white 1 red 2 green 3 yellow 4 orange 5 blue.

import Cube from 'cubejs';
import { isStructurallyValid } from './facelet-cube.js';
import { FACES, type Face, type ScanResult } from './types.js';

/** One face as seen by the detector: 9 colour classes + 9 detection confidences, reading order. */
export interface ColorFace {
  colors: number[]; // 9 colour-class indices (0..5)
  confidence: number[]; // 9 per-sticker detector confidences (0..1)
}

function cubejsRoundTrips(facelets: string): boolean {
  try {
    return Cube.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}

function reject(reason: string): ScanResult & { reason: string } {
  return {
    facelets: '',
    valid: false,
    confidence: 0,
    lowConfidence: [...Array(54).keys()],
    reason,
  };
}

/**
 * Turn 6 detected faces (colour classes) into a validated ScanResult. Rejects a scan
 * whose 6 centres are not 6 distinct colours (not a real cube) before it can reach the
 * verifier, and reports a `reason` so the UI can say WHY rather than silently failing.
 */
export function assembleColors(
  faces: Record<Face, ColorFace>,
  threshold = 0.15,
): ScanResult & { reason?: string } {
  // Map each face's centre colour -> that face's letter. Two faces sharing a centre
  // colour is impossible on a real cube, so bail out loudly.
  const centreOwner = new Map<number, Face>();
  for (const face of FACES) {
    const f = faces[face];
    if (!f || f.colors.length !== 9 || f.confidence.length !== 9) {
      throw new Error(`face ${face}: expected 9 colours + 9 confidences`);
    }
    const centre = f.colors[4]!;
    if (centreOwner.has(centre)) return reject(`two faces share centre colour ${centre}`);
    centreOwner.set(centre, face);
  }
  if (centreOwner.size !== 6) return reject('the 6 centres are not 6 distinct colours');

  const letters: string[] = [];
  const lowConfidence: number[] = [];
  let min = 1;
  let idx = 0;
  for (const face of FACES) {
    const f = faces[face];
    for (let i = 0; i < 9; i++) {
      const owner = centreOwner.get(f.colors[i]!);
      letters.push(owner ?? '?'); // a colour not among the 6 centres can't be placed
      const c = f.confidence[i]!;
      if (c < min) min = c;
      if (c < threshold) lowConfidence.push(idx);
      idx++;
    }
  }

  const facelets = letters.join('');
  const valid =
    !letters.includes('?') && isStructurallyValid(facelets) && cubejsRoundTrips(facelets);
  return { facelets, valid, confidence: min, lowConfidence };
}
