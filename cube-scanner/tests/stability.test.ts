import { describe, expect, it } from 'vitest';
import { SteadyDetector, frameDifference } from '../src/stability.js';
import type { RGB } from '../src/types.js';
import { makeFrame } from './helpers.js';

const solid = (v: RGB) => makeFrame(64, 64, () => v);

describe('frameDifference', () => {
  it('is 0 for identical frames', () => {
    expect(frameDifference(solid([120, 30, 200]), solid([120, 30, 200]))).toBe(0);
  });

  it('grows with the per-channel difference', () => {
    const base = solid([100, 100, 100]);
    const near = solid([104, 100, 100]);
    const far = solid([200, 200, 200]);
    expect(frameDifference(base, near)).toBeLessThan(frameDifference(base, far));
  });

  it('is +Infinity for mismatched sizes', () => {
    expect(
      frameDifference(
        makeFrame(10, 10, () => [0, 0, 0]),
        solid([0, 0, 0]),
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('SteadyDetector', () => {
  it('reports steady only after N consecutive still frames', () => {
    const det = new SteadyDetector({ threshold: 6, framesNeeded: 3 });
    const still: RGB = [50, 60, 70];
    expect(det.push(solid(still))).toBe(false); // frame 1 (no prev)
    expect(det.push(solid(still))).toBe(false); // 1 still
    expect(det.push(solid(still))).toBe(false); // 2 still
    expect(det.push(solid(still))).toBe(true); // 3 still -> steady
  });

  it('resets the counter on motion', () => {
    const det = new SteadyDetector({ threshold: 6, framesNeeded: 2 });
    det.push(solid([50, 50, 50]));
    det.push(solid([50, 50, 50])); // 1 still
    expect(det.push(solid([200, 200, 200]))).toBe(false); // motion -> reset
    expect(det.push(solid([200, 200, 200]))).toBe(false); // 1 still again
    expect(det.push(solid([200, 200, 200]))).toBe(true); // 2 still -> steady
  });

  it('reset() clears state', () => {
    const det = new SteadyDetector({ framesNeeded: 1 });
    det.push(solid([1, 2, 3]));
    det.push(solid([1, 2, 3]));
    det.reset();
    expect(det.motion(solid([1, 2, 3]))).toBe(Number.POSITIVE_INFINITY);
  });
});
