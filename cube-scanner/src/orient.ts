// Recover per-face rotations from top-down flat reads (the tabletop scan). Each face is
// laid flat and read at an UNKNOWN quarter-turn, so we brute-force the 4^5 rotation
// combinations (one face pinned as the reference frame) and keep the one that assembles
// into a solvable cube. The colour-count + solvability constraints make the solvable
// combination essentially unique for a real scramble, so the user never aligns a face —
// they just show each side any way up. Pure + Node-tested.

import Cube from 'cubejs';
import { LOW_CONFIDENCE_THRESHOLD } from './assemble.js';
import { classify } from './classify.js';
import { isStructurallyValid } from './facelet-cube.js';
import { FACES, type Face, type RGB, type ScanResult } from './types.js';

/** Rotate a 3x3 face (row-major, 9 cells) clockwise by `q` quarter-turns. */
export function rotateFace<T>(cells: readonly T[], q: number): T[] {
  const CW = [6, 3, 0, 7, 4, 1, 8, 5, 2]; // new[i] = old[CW[i]] for a 90° CW turn
  let out = cells.slice();
  const n = ((q % 4) + 4) % 4;
  for (let t = 0; t < n; t++) out = CW.map((i) => out[i]!);
  return out;
}

function cubejsRoundTrips(facelets: string): boolean {
  try {
    return Cube.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}

export interface OrientationResult extends ScanResult {
  rotations?: Record<Face, number>; // recovered quarter-turns per face, when valid
}

/**
 * Given six faces read flat but at unknown rotation (identified by center colour), find
 * the quarter-turn per face that yields a solvable cube. Classification runs once (rotation
 * only permutes positions, not colours); then all 4^6 = 4096 per-face rotations are
 * searched. Because face identities are pinned by center colour, the solvable combination
 * is unique — the true cube — so every face may be shown any way up. Returns the assembled
 * result; when valid, `rotations` holds the recovered turns. If no combination is solvable
 * the identity arrangement is returned as invalid (a misread — re-show a face).
 */
export function solveOrientations(
  faces: Record<Face, RGB[]>,
  threshold: number = LOW_CONFIDENCE_THRESHOLD,
): OrientationResult {
  for (const f of FACES) {
    if (!faces[f] || faces[f].length !== 9)
      throw new Error(`face ${f}: expected 9 samples, got ${faces[f]?.length ?? 0}`);
  }
  const centers = FACES.map((f) => faces[f][4]!);
  const samples: RGB[] = [];
  for (const f of FACES) for (const s of faces[f]) samples.push(s);
  const { letters, confidence } = classify(samples, centers);
  const faceLetters = Object.fromEntries(
    FACES.map((f, i) => [f, letters.slice(i * 9, i * 9 + 9)]),
  ) as Record<Face, string[]>;
  const faceConf = Object.fromEntries(
    FACES.map((f, i) => [f, confidence.slice(i * 9, i * 9 + 9)]),
  ) as Record<Face, number[]>;

  // Decode each candidate as base-4 over all six faces (2 bits each, 12 bits total).
  for (let code = 0; code < 4096; code++) {
    const turns: Record<Face, number> = {
      U: code & 3,
      R: (code >> 2) & 3,
      F: (code >> 4) & 3,
      D: (code >> 6) & 3,
      L: (code >> 8) & 3,
      B: (code >> 10) & 3,
    };
    let facelets = '';
    for (const f of FACES) facelets += rotateFace(faceLetters[f], turns[f]).join('');
    if (isStructurallyValid(facelets) && cubejsRoundTrips(facelets)) {
      let min = 1;
      const lowConfidence: number[] = [];
      let idx = 0;
      for (const f of FACES) {
        for (const c of rotateFace(faceConf[f], turns[f])) {
          if (c < min) min = c;
          if (c < threshold) lowConfidence.push(idx);
          idx++;
        }
      }
      return { facelets, valid: true, confidence: min, lowConfidence, rotations: turns };
    }
  }

  // No solvable combination — return the identity arrangement, flagged invalid.
  let facelets = '';
  for (const f of FACES) facelets += faceLetters[f].join('');
  let min = 1;
  const lowConfidence: number[] = [];
  confidence.forEach((c, i) => {
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  });
  return { facelets, valid: false, confidence: min, lowConfidence };
}
