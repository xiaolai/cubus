// Assemble a validated ScanResult from the AI detector's per-sticker COLOUR CLASSES
// (0..5). The guided scan gives us 6 faces (identified by their centre colour) but each face is
// captured at an ARBITRARY rotation — the camera doesn't know which way is "up". A wrong per-face
// rotation lands the 8 outer stickers in the wrong facelet slots, so the cube reads as unsolvable.
//
// We recover the rotations by search: the user's real cube IS solvable, so the true rotation combo
// is always among the solvable ones. Try all 4^6 per-face rotations, keep the DISTINCT solvable
// facelet strings, then:
//   • exactly one  -> it must be the true cube (the true combo is guaranteed to be in the set) → use it.
//   • none         -> no rotation fixes it → the failure is a COLOUR misread → reject for re-scan.
//   • more than one -> rotationally ambiguous colours (solved/symmetric cubes) → reject as ambiguous.
// This means the user can show each side ANY way up; orientation is solved for them.
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

/** ScanResult plus AI-path extras: a human reason and whether the failure was rotational ambiguity. */
export type AiScanResult = ScanResult & { reason?: string; ambiguous?: boolean };

/** 90° clockwise position map for a 3x3 face in reading order; the centre (index 4) is fixed. */
const ROT90 = [6, 3, 0, 7, 4, 1, 8, 5, 2] as const;

/** Rotate a 9-element face array 90° CW, `k` times (k is taken mod 4). */
function rotateFace<T>(a: T[], k: number): T[] {
  let out = a;
  for (let t = 0; t < ((k % 4) + 4) % 4; t++) out = ROT90.map((i) => out[i]!);
  return out;
}

function cubejsRoundTrips(facelets: string): boolean {
  try {
    return Cube.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}

function reject(reason: string, ambiguous = false): AiScanResult {
  return {
    facelets: '',
    valid: false,
    confidence: 0,
    lowConfidence: [...Array(54).keys()],
    reason,
    ambiguous,
  };
}

/**
 * Turn 6 detected faces (colour classes, any rotation) into a validated ScanResult by solving each
 * face's rotation. Rejects a scan whose 6 centres are not 6 distinct colours (not a real cube), a
 * colour misread (no rotation is solvable), and a rotationally ambiguous read — each with a `reason`.
 */
export function assembleColors(faces: Record<Face, ColorFace>, threshold = 0.15): AiScanResult {
  // Centre colour → face letter. Centres don't move under rotation, so this is fixed. Two faces
  // sharing a centre colour is impossible on a real cube, so bail out loudly.
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

  // Build the 54-char facelet string for one per-face rotation combo, or null if any sticker's
  // colour isn't one of the 6 centre colours (can't be placed on a real cube).
  const buildFacelets = (rots: number[]): string | null => {
    const letters: string[] = [];
    for (let fi = 0; fi < 6; fi++) {
      const rc = rotateFace(faces[FACES[fi]!]!.colors, rots[fi]!);
      for (let i = 0; i < 9; i++) {
        const owner = centreOwner.get(rc[i]!);
        if (owner === undefined) return null;
        letters.push(owner);
      }
    }
    return letters.join('');
  };

  // Search all 4^6 rotation combos; keep the FIRST combo producing each DISTINCT solvable string
  // (n=0 is the all-zero combo, so an already-correct capture is preferred on ties).
  const solvable = new Map<string, number[]>();
  const rots = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 4096; n++) {
    for (let i = 0; i < 6; i++) rots[i] = (n >> (2 * i)) & 3;
    const fl = buildFacelets(rots);
    if (fl && !solvable.has(fl) && isStructurallyValid(fl) && cubejsRoundTrips(fl)) {
      solvable.set(fl, [...rots]);
    }
  }

  if (solvable.size === 0) {
    return reject('no orientation of the faces is solvable — a colour was misread; re-scan');
  }
  if (solvable.size > 1) {
    return reject(
      `${solvable.size} orientations are solvable — the colours are rotationally ambiguous; re-scan one face`,
      true,
    );
  }

  // Unique solvable state = the real cube. Rotate the confidences the same way for the report.
  const [facelets, chosen] = [...solvable.entries()][0]!;
  const conf: number[] = [];
  for (let fi = 0; fi < 6; fi++) {
    for (const c of rotateFace(faces[FACES[fi]!]!.confidence, chosen[fi]!)) conf.push(c);
  }
  let min = 1;
  const lowConfidence: number[] = [];
  conf.forEach((c, i) => {
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  });
  return { facelets, valid: true, confidence: min, lowConfidence };
}
