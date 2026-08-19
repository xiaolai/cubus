// Calibration ("know the blocks"): align the smart-cube feed to the physical
// cube WITHOUT solving. At one instant the camera gives the true state
// `scanned` while the cube reports `reported`; both are the same physical cube,
// so a fixed group element g = scanned · reported⁻¹ maps one to the other. Every
// legal turn right-multiplies both states by the same move, so g stays constant:
// physical = g · reported holds for all later reported states.
//
// This is pure cube-group math (the same cubie multiply/inverse convention
// cubejs uses), so it is fully unit-testable offline and produces plain facelet
// strings for the renderer — no dependency on the async cubing.js kpuzzle. The
// tests cross-check it against cubejs move application (the independent oracle).

import {
  type CubeState,
  decodeFacelets,
  encodeFacelets,
  isSolvable,
  isStructurallyValid,
} from './facelet-cube.js';

/** Cube-group product a·b (apply b to a). Matches cubejs's cubie multiply. */
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

/** The group inverse of a state (Kociemba invCubieCube). */
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

/**
 * The calibration transform g = scanned · reported⁻¹, computed from the two
 * facelet snapshots taken at the same instant. Throws if either is not a
 * decodable cube.
 */
export function calibrationTransform(scanned: string, reported: string): CubeState {
  // Both must be genuinely solvable cubes: decoding alone permits duplicate
  // cubies / parity violations, which would make `inverse` produce a non-
  // permutation (undefined slots, NaN twists).
  if (!isStructurallyValid(scanned) || !isStructurallyValid(reported)) {
    throw new Error('calibration needs two valid, solvable cube states');
  }
  return multiply(decodeFacelets(scanned)!, inverse(decodeFacelets(reported)!));
}

/** Apply a calibration transform to a reported state -> the physical facelets. */
export function applyCalibration(transform: CubeState, reported: string): string {
  // The transform is a mutable CubeState the caller supplies; a malformed one
  // (e.g. a truncated co/eo) would silently produce the wrong facelets.
  if (!isSolvable(transform)) {
    throw new Error('calibration: transform is not a valid cube-group element');
  }
  if (!isStructurallyValid(reported)) {
    throw new Error('calibration: reported state is not a valid, solvable cube');
  }
  return encodeFacelets(multiply(transform, decodeFacelets(reported)!));
}
