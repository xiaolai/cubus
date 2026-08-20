// T4 (geometric core): the localizer's homography sample → classify pipeline, verified
// offline against synthetic frames — including perspective-correctness (a direct
// projective check, non-circular), out-of-frame → unknown, and center-logo robustness.
// The real quad DETECTOR is injected and verified on-device.
import { describe, expect, it } from 'vitest';
import { type Face, faceIndices } from '../src/cube.js';
import { CANONICAL_CENTERS, type RGB } from '../src/perception/color.js';
import {
  type Quad,
  type QuadDetector,
  classifyCells,
  createLocalizer,
  nullDetector,
  projectQuad,
  sampleQuad,
} from '../src/perception/localize.js';
import type { Frame } from '../src/perception/motion.js';
import type { SoftColor } from '../src/types.js';

const FACES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
const argmaxFace = (s: SoftColor): Face =>
  FACES.reduce((a, b) => (s[b] > s[a] ? b : a), 'U' as Face);
const PATTERN: Face[] = ['U', 'R', 'F', 'D', 'L', 'B', 'U', 'R', 'F'];
const COLORS9: RGB[] = PATTERN.map((f) => CANONICAL_CENTERS[f]);

function blank(size: number): Frame {
  return { data: new Uint8ClampedArray(size * size * 4), width: size, height: size };
}
function put(f: Frame, x: number, y: number, [r, g, b]: RGB): void {
  if (x < 0 || x >= f.width || y < 0 || y >= f.height) return;
  const i = (y * f.width + x) * 4;
  f.data[i] = r;
  f.data[i + 1] = g;
  f.data[i + 2] = b;
  f.data[i + 3] = 255;
}
function frameWithGrid(size: number, colors9: RGB[]): Frame {
  const f = blank(size);
  const cell = size / 3;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = Math.min(2, Math.floor(x / cell));
      const r = Math.min(2, Math.floor(y / cell));
      put(f, x, y, colors9[r * 3 + c]!);
    }
  return f;
}
/** Paint the 3×3 grid warped through a quad's homography (a real projective fixture). */
function frameWarped(size: number, quad: Quad, colors9: RGB[]): Frame {
  const f = blank(size);
  const N = 400;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const u = i / N;
      const v = j / N;
      const p = projectQuad(quad, u, v);
      const c = Math.min(2, Math.floor(u * 3));
      const r = Math.min(2, Math.floor(v * 3));
      put(f, Math.round(p.x), Math.round(p.y), colors9[r * 3 + c]!);
    }
  return f;
}
const fullQuad = (size: number): Quad => [
  { x: 0, y: 0 },
  { x: size - 1, y: 0 },
  { x: size - 1, y: size - 1 },
  { x: 0, y: size - 1 },
];

describe('homography (perspective-correct sampling)', () => {
  it('maps the center of a trapezoid perspective-correctly, not bilinearly', () => {
    // For this trapezoid the true projective center is (60,75); bilinear gives (60,50).
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 80, y: 100 },
      { x: 40, y: 100 },
    ];
    const p = projectQuad(quad, 0.5, 0.5);
    expect(p.x).toBeCloseTo(60, 5);
    expect(p.y).toBeCloseTo(75, 5); // NOT 50 (that would be the bilinear answer)
  });

  it('a degenerate (collinear) quad projects to finite coordinates, not NaN (regression)', () => {
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    const p = projectQuad(quad, 0.5, 0.5);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe('localizer geometric core', () => {
  it('samples and classifies the 9 stickers from an axis-aligned quad', () => {
    const soft = classifyCells(sampleQuad(frameWithGrid(90, COLORS9), fullQuad(90)));
    expect(soft.map(argmaxFace)).toEqual(PATTERN);
  });

  it('recovers the grid from a genuinely warped (trapezoid) fixture', () => {
    const quad: Quad = [
      { x: 12, y: 10 },
      { x: 108, y: 10 },
      { x: 92, y: 110 },
      { x: 28, y: 110 },
    ];
    const frame = frameWarped(120, quad, COLORS9);
    const soft = classifyCells(sampleQuad(frame, quad));
    expect(soft.map(argmaxFace)).toEqual(PATTERN);
  });

  it('reports out-of-frame stickers as unknown, not fabricated from border pixels', () => {
    // a quad hanging off the left edge — the left column of stickers is off-frame
    const quad: Quad = [
      { x: -30, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 90 },
      { x: -30, y: 90 },
    ];
    const soft = classifyCells(sampleQuad(frameWithGrid(90, COLORS9), quad));
    for (const leftCol of [0, 3, 6]) expect(soft[leftCol]!.unknown).toBeGreaterThan(0.5);
  });

  it('skips a center logo via the annulus (reads the sticker, not the logo)', () => {
    const frame = frameWithGrid(90, COLORS9);
    const cellPx = 30;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const cx = Math.round((c + 0.5) * cellPx);
        const cy = Math.round((r + 0.5) * cellPx);
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) put(frame, cx + dx, cy + dy, [255, 0, 255]);
      }
    const soft = classifyCells(sampleQuad(frame, fullQuad(90)));
    expect(soft.map(argmaxFace)).toEqual(PATTERN); // annulus dodged the magenta logo
  });
});

describe('localizer composition', () => {
  it('turns a detected face into camera-slot cells + an ROI', () => {
    const frame = frameWithGrid(90, COLORS9);
    const detector: QuadDetector = {
      detect: () => ({ faces: [{ slot: 'F', quad: fullQuad(90) }], alignedGeometry: true }),
    };
    const res = createLocalizer(detector).detect(frame);
    expect(res.alignedGeometry).toBe(true);
    expect(res.cells.length).toBe(9);
    expect(res.roi).toBeDefined();
    const bySlot = new Map(res.cells.map((c) => [c.slot, argmaxFace(c.soft)]));
    faceIndices('F').forEach((idx, k) => expect(bySlot.get(idx)).toBe(PATTERN[k]));
  });

  it('reads the palette each frame and feeds back the observed centers', () => {
    let gets = 0;
    let observes = 0;
    const detector: QuadDetector = {
      detect: () => ({ faces: [{ slot: 'F', quad: fullQuad(30) }], alignedGeometry: true }),
    };
    const palette = {
      get: () => {
        gets++;
        return CANONICAL_CENTERS;
      },
      observe: () => {
        observes++;
      },
    };
    const loc = createLocalizer(detector, palette);
    loc.detect(frameWithGrid(30, COLORS9));
    loc.detect(frameWithGrid(30, COLORS9));
    expect(gets).toBe(2); // palette re-read per frame, not captured once
    expect(observes).toBe(2); // the center sticker is fed back each frame (rolling adaptation)
    const res = loc.detect(frameWithGrid(30, COLORS9));
    expect(res.centers?.[0]?.slot).toBe('F'); // raw center reported for debug
  });

  it('the null detector localizes nothing and yields no ROI', () => {
    const res = createLocalizer(nullDetector()).detect(frameWithGrid(30, COLORS9));
    expect(res.cells).toEqual([]);
    expect(res.roi).toBeUndefined();
  });

  it('a fully-offscreen detected face is skipped — empty cells, no ROI (regression)', () => {
    const offscreen: Quad = [
      { x: -100, y: -100 },
      { x: -90, y: -100 },
      { x: -90, y: -90 },
      { x: -100, y: -90 },
    ];
    const detector: QuadDetector = {
      detect: () => ({ faces: [{ slot: 'F', quad: offscreen }], alignedGeometry: true }),
    };
    const res = createLocalizer(detector).detect(frameWithGrid(30, COLORS9));
    expect(res.cells).toEqual([]); // fully offscreen → not a real detection
    expect(res.roi).toBeUndefined();
  });
});
