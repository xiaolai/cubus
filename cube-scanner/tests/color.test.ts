// S1 verification: the color core is a faithful wrapper over culori.
//
// CIEDE2000 is checked against the published Sharma-Wu-Dalal (2005) reference
// pairs — the standard's own test vectors, NOT culori's output — so this proves
// we compute real CIEDE2000 (and not, say, the older CIE76 Euclidean distance),
// rather than testing culori against itself.

import { describe, expect, it } from 'vitest';
import { ciede2000, rgbDistance, toLab } from '../src/color.js';
import type { Lab } from '../src/types.js';

const lab = (l: number, a: number, b: number): Lab => ({ l, a, b });

describe('ciede2000 (against the CIEDE2000 standard reference vectors)', () => {
  // Two rock-solid pairs from the Sharma et al. reference table. CIE76 would
  // give 4.00 and ~2.236 for these; CIEDE2000 gives the values below, so these
  // two alone distinguish a correct implementation from the naive one.
  it('matches Sharma reference pair 1', () => {
    expect(ciede2000(lab(50, 2.6772, -79.7751), lab(50, 0, -82.7485))).toBeCloseTo(2.0425, 3);
  });

  it('matches Sharma reference gray-axis pair', () => {
    expect(ciede2000(lab(50, 0, 0), lab(50, -1, 2))).toBeCloseTo(2.3669, 3);
  });

  it('is zero for identical colors', () => {
    expect(ciede2000(lab(37, 12, -5), lab(37, 12, -5))).toBe(0);
  });

  it('is symmetric', () => {
    const a = lab(60.2574, -34.0099, 36.2677);
    const b = lab(60.4626, -34.1751, 39.4387);
    expect(ciede2000(a, b)).toBeCloseTo(ciede2000(b, a), 10);
  });

  it('orders a near pair below a far pair', () => {
    const base = lab(50, 0, 0);
    const near = lab(51, 1, -1);
    const far = lab(20, 40, -50);
    expect(ciede2000(base, near)).toBeLessThan(ciede2000(base, far));
  });
});

describe('toLab (sRGB -> CIELAB anchors)', () => {
  it('maps white near L*=100 on the neutral axis', () => {
    const w = toLab([255, 255, 255]);
    expect(w.l).toBeGreaterThan(99);
    expect(Math.abs(w.a)).toBeLessThan(1.5);
    expect(Math.abs(w.b)).toBeLessThan(1.5);
  });

  it('maps black near L*=0', () => {
    const k = toLab([0, 0, 0]);
    expect(k.l).toBeLessThan(1);
  });

  it('maps mid gray onto the neutral axis (a*,b* ~ 0)', () => {
    const g = toLab([128, 128, 128]);
    expect(Math.abs(g.a)).toBeLessThan(1.5);
    expect(Math.abs(g.b)).toBeLessThan(1.5);
    expect(g.l).toBeGreaterThan(40);
    expect(g.l).toBeLessThan(70);
  });

  it('separates the classic red/orange pair by a clear margin', () => {
    // The scanner's top risk. They must be distinguishable in CIEDE2000.
    const red: RGBTuple = [208, 32, 42];
    const orange: RGBTuple = [255, 106, 0];
    expect(rgbDistance(red, orange)).toBeGreaterThan(10);
  });
});

type RGBTuple = [number, number, number];
