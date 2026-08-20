// T4 (pure parts): center-referenced soft color classification and the motion gate.
// The localizer + real-footage gauntlet are hardware-bound and not covered here.
import { describe, expect, it } from 'vitest';
import type { Face } from '../src/cube.js';
import { CANONICAL_CENTERS, type RGB, classifySoft } from '../src/perception/color.js';
import { type Frame, StabilityGate, frameDiff } from '../src/perception/motion.js';
import type { SoftColor } from '../src/types.js';

const FACES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
function argmaxFace(s: SoftColor): Face {
  return FACES.reduce((a, b) => (s[b] > s[a] ? b : a), 'U' as Face);
}
function frameOf(w: number, h: number, fill: number): Frame {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(fill);
  return { data, width: w, height: h };
}

describe('color classification', () => {
  it('a sample at a center color classifies to that face with low unknown', () => {
    const soft = classifySoft(CANONICAL_CENTERS.F, CANONICAL_CENTERS);
    expect(argmaxFace(soft)).toBe('F');
    expect(soft.unknown).toBeLessThan(0.2);
    expect(soft.F).toBeGreaterThan(0.6);
  });
  it('a color far from every center is flagged unknown, not guessed', () => {
    const magenta: RGB = [255, 0, 255];
    const soft = classifySoft(magenta, CANONICAL_CENTERS);
    expect(soft.unknown).toBeGreaterThan(0.5);
  });
  it('red/orange is kept ambiguous — the two top faces are R and L, neither dominant', () => {
    const reddishOrange: RGB = [232, 75, 18];
    const soft = classifySoft(reddishOrange, CANONICAL_CENTERS);
    const top2 = FACES.map((f) => [f, soft[f]] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([f]) => f);
    expect(new Set(top2)).toEqual(new Set<Face>(['R', 'L']));
    expect(Math.max(soft.R, soft.L)).toBeLessThan(0.9); // not a confident hard label
  });
  it('every soft color is a normalized distribution (ε-floored, sums to 1)', () => {
    const soft = classifySoft([120, 120, 120], CANONICAL_CENTERS);
    const sum = [...FACES.map((f) => soft[f]), soft.unknown].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    for (const f of FACES) expect(soft[f]).toBeGreaterThan(0);
  });
});

describe('motion gate', () => {
  it('identical frames have zero diff; opposite frames have a large diff', () => {
    const black = frameOf(64, 64, 0);
    const white = frameOf(64, 64, 255);
    expect(frameDiff(black, frameOf(64, 64, 0))).toBe(0);
    expect(frameDiff(black, white)).toBeGreaterThan(200);
  });
  it('a size mismatch reports infinite diff (never a false "stable")', () => {
    expect(frameDiff(frameOf(64, 64, 0), frameOf(32, 32, 0))).toBe(Number.POSITIVE_INFINITY);
  });
  it('StabilityGate reports stable only after N consecutive low-diff frames', () => {
    const gate = new StabilityGate(6, 3);
    expect(gate.push(1)).toBe(false);
    expect(gate.push(2)).toBe(false);
    expect(gate.push(1)).toBe(true); // three consecutive below threshold
    expect(gate.push(50)).toBe(false); // motion breaks stability
  });
});
