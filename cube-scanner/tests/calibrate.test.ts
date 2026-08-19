// S5 verification (calibration, hardware-free): the pure cube-group math and the
// calibration invariant, cross-checked against cubejs move application — the
// independent oracle. The decisive property is move-tracking: after calibration,
// applying the same turn to the reported feed keeps physical = transform(reported).

import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import { applyCalibration, calibrationTransform, inverse, multiply } from '../src/calibrate.js';
import { SOLVED_FACELETS, decodeFacelets, encodeFacelets } from '../src/facelet-cube.js';
import { scrambleFacelets } from './helpers.js';

const move = (facelets: string, alg: string): string =>
  Cube.fromString(facelets).move(alg).asString();

const IDENTITY = decodeFacelets(SOLVED_FACELETS)!;
const REPORTED = scrambleFacelets("R U R' U' F2 L D' B");
const SCANNED = scrambleFacelets("D2 F R2 U' L F' B2 U");

describe('cube-group math', () => {
  it('multiply matches cubejs move application (same convention)', () => {
    const r = decodeFacelets(REPORTED)!;
    for (const m of ['R', 'U', 'F', "R'", 'D2', 'L']) {
      const moveCube = decodeFacelets(move(SOLVED_FACELETS, m))!;
      expect(encodeFacelets(multiply(r, moveCube))).toBe(move(REPORTED, m));
    }
  });

  it('inverse is a true group inverse (s · s⁻¹ = identity)', () => {
    const s = decodeFacelets(REPORTED)!;
    expect(multiply(s, inverse(s))).toEqual(IDENTITY);
    expect(encodeFacelets(multiply(inverse(s), s))).toBe(SOLVED_FACELETS);
  });
});

describe('calibration', () => {
  it('maps the reported snapshot exactly onto the scanned snapshot', () => {
    const g = calibrationTransform(SCANNED, REPORTED);
    expect(applyCalibration(g, REPORTED)).toBe(SCANNED);
  });

  it('is the identity when scanned and reported already agree', () => {
    const g = calibrationTransform(REPORTED, REPORTED);
    expect(g).toEqual(IDENTITY);
    expect(applyCalibration(IDENTITY, SCANNED)).toBe(SCANNED);
  });

  it('tracks physical moves without re-scanning (the key property)', () => {
    const g = calibrationTransform(SCANNED, REPORTED);
    // Turn the real cube: both the reported feed and the (hidden) physical state
    // advance by the same alg. Calibrated output must equal the moved scan.
    for (const alg of ['R', "U'", 'F2', "R U R' U'", 'L D B', 'R2 U2 F2']) {
      expect(applyCalibration(g, move(REPORTED, alg))).toBe(move(SCANNED, alg));
    }
  });

  it('throws loudly on an undecodable state', () => {
    expect(() => calibrationTransform('not-a-cube', REPORTED)).toThrow(/cube/);
    const g = calibrationTransform(SCANNED, REPORTED);
    expect(() => applyCalibration(g, 'nope')).toThrow(/cube/);
  });

  it('rejects a decodable-but-unsolvable state (duplicate cubie)', () => {
    // Solved with facelet 19 (F) recolored to R: the UF slot now reads (U,R),
    // duplicating the UR edge. Still decodable, but not a real permutation.
    const dup = SOLVED_FACELETS.split('');
    dup[19] = 'R';
    expect(decodeFacelets(dup.join(''))).not.toBeNull(); // decodes...
    expect(() => calibrationTransform(SOLVED_FACELETS, dup.join(''))).toThrow(/valid|solvable/);
  });

  it('rejects a malformed transform in applyCalibration', () => {
    const badTransform = { ...IDENTITY, co: [] }; // truncated orientation
    expect(() => applyCalibration(badTransform, REPORTED)).toThrow(/transform/);
  });
});
