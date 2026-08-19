// Verifies the perspective sampler: the unit-square -> quad map, and that
// sampleQuad recovers the 9 sticker colors from an arbitrarily skewed face. The
// skewed case is built by inverse-warping a known 9-color face into a quad, so
// the test is independent of the forward sampler it checks.

import { describe, expect, it } from 'vitest';
import {
  type Point,
  type Quad,
  type Transform,
  orderCorners,
  project,
  sampleQuad,
  unitSquareToQuad,
} from '../src/homography.js';
import type { Frame, RGB } from '../src/types.js';

const NINE: RGB[] = [
  [246, 247, 248], // white
  [208, 32, 42], // red
  [4, 158, 74], // green
  [255, 212, 0], // yellow
  [255, 106, 0], // orange
  [0, 87, 200], // blue
  [140, 20, 200], // purple (extra distinct colors for a 9-cell test)
  [0, 180, 200], // cyan
  [90, 60, 20], // brown
];

/** Invert the 3x3 projective transform (bottom-right fixed at 1). */
function invert(t: Transform): (x: number, y: number) => [number, number] {
  const { a, b, c, d, e, f, g, h } = t;
  const det = a * (e - f * h) - b * (d - f * g) + c * (d * h - e * g);
  // adjugate (transpose of cofactors) / det
  const i00 = (e - f * h) / det;
  const i01 = (c * h - b) / det;
  const i02 = (b * f - c * e) / det;
  const i10 = (f * g - d) / det;
  const i11 = (a - c * g) / det;
  const i12 = (c * d - a * f) / det;
  const i20 = (d * h - e * g) / det;
  const i21 = (b * g - a * h) / det;
  const i22 = (a * e - b * d) / det;
  return (x, y) => {
    const u = i00 * x + i01 * y + i02;
    const v = i10 * x + i11 * y + i12;
    const w = i20 * x + i21 * y + i22;
    return [u / w, v / w];
  };
}

/** Paint a frame so the given quad shows the 9 colors as a 3x3 face. */
function warpPaint(width: number, height: number, quad: Quad, colors: RGB[]): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  const toUV = invert(unitSquareToQuad(quad));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = toUV(x + 0.5, y + 0.5);
      const i = (y * width + x) * 4;
      data[i + 3] = 255;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        const cell = Math.min(2, Math.floor(v * 3)) * 3 + Math.min(2, Math.floor(u * 3));
        const [r, g, b] = colors[cell]!;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    }
  }
  return { data, width, height };
}

describe('unitSquareToQuad + project', () => {
  it('maps the unit-square corners exactly onto an affine quad', () => {
    const q: Quad = { tl: [10, 20], tr: [110, 20], br: [110, 120], bl: [10, 120] };
    const t = unitSquareToQuad(q);
    expect(project(t, 0, 0)).toEqual([10, 20]);
    expect(project(t, 1, 0)[0]).toBeCloseTo(110, 6);
    expect(project(t, 1, 1)[1]).toBeCloseTo(120, 6);
    expect(project(t, 0, 1)).toEqual([10, 120]);
    // center maps to the parallelogram centroid
    const [cx, cy] = project(t, 0.5, 0.5);
    expect(cx).toBeCloseTo(60, 6);
    expect(cy).toBeCloseTo(70, 6);
  });

  it('maps the unit-square corners exactly onto a skewed (projective) quad', () => {
    const q: Quad = { tl: [20, 25], tr: [180, 40], br: [165, 185], bl: [35, 160] };
    const t = unitSquareToQuad(q);
    for (const [u, v, pt] of [
      [0, 0, q.tl],
      [1, 0, q.tr],
      [1, 1, q.br],
      [0, 1, q.bl],
    ] as const) {
      const [x, y] = project(t, u, v);
      expect(x).toBeCloseTo(pt[0], 6);
      expect(y).toBeCloseTo(pt[1], 6);
    }
  });
});

describe('orderCorners', () => {
  it('orders shuffled points into tl, tr, br, bl', () => {
    const tl: Point = [10, 12];
    const tr: Point = [90, 15];
    const br: Point = [95, 88];
    const bl: Point = [8, 92];
    // Feed them shuffled; expect them sorted back into reading order.
    expect(orderCorners([br, bl, tr, tl])).toEqual({ tl, tr, br, bl });
  });

  it('throws unless given exactly 4 points', () => {
    expect(() => orderCorners([[0, 0]])).toThrow(/4 points/);
  });
});

describe('sampleQuad', () => {
  it('recovers 9 stickers from an axis-aligned quad', () => {
    const q: Quad = { tl: [0, 0], tr: [180, 0], br: [180, 180], bl: [0, 180] };
    const frame = warpPaint(180, 180, q, NINE);
    expect(sampleQuad(frame, q)).toEqual(NINE);
  });

  it('recovers 9 stickers from a skewed, rotated quad (the whole point)', () => {
    const q: Quad = { tl: [30, 22], tr: [172, 48], br: [150, 176], bl: [24, 150] };
    const frame = warpPaint(200, 200, q, NINE);
    expect(sampleQuad(frame, q)).toEqual(NINE);
  });

  it('throws on a truncated frame', () => {
    const q: Quad = { tl: [0, 0], tr: [10, 0], br: [10, 10], bl: [0, 10] };
    const bad: Frame = { data: new Uint8ClampedArray(0), width: 20, height: 20 };
    expect(() => sampleQuad(bad, q)).toThrow(/too small/);
  });
});
