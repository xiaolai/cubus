// T4 (geometric core): the localizer's perspective-sample → classify pipeline,
// verified offline against synthetic frames. The real quad DETECTOR (finding the cube
// in a cluttered in-hand frame) is injected and verified on-device.
import { describe, expect, it } from 'vitest';
import { type Face, faceIndices } from '../src/cube.js';
import { CANONICAL_CENTERS, type RGB } from '../src/perception/color.js';
import {
  type Quad,
  type QuadDetector,
  classifyCells,
  createLocalizer,
  nullDetector,
  sampleQuad,
} from '../src/perception/localize.js';
import type { Frame } from '../src/perception/motion.js';
import type { SoftColor } from '../src/types.js';

const FACES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
const argmaxFace = (s: SoftColor): Face =>
  FACES.reduce((a, b) => (s[b] > s[a] ? b : a), 'U' as Face);

/** Paint a size×size frame as a 3×3 grid of the given colors (row-major). */
function frameWithGrid(size: number, colors9: RGB[]): Frame {
  const data = new Uint8ClampedArray(size * size * 4);
  const cell = size / 3;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = Math.min(2, Math.floor(x / cell));
      const r = Math.min(2, Math.floor(y / cell));
      const [R, G, B] = colors9[r * 3 + c]!;
      const i = (y * size + x) * 4;
      data[i] = R;
      data[i + 1] = G;
      data[i + 2] = B;
      data[i + 3] = 255;
    }
  return { data, width: size, height: size };
}
const fullQuad = (size: number): Quad => [
  { x: 0, y: 0 },
  { x: size - 1, y: 0 },
  { x: size - 1, y: size - 1 },
  { x: 0, y: size - 1 },
];

const PATTERN: Face[] = ['U', 'R', 'F', 'D', 'L', 'B', 'U', 'R', 'F'];
const COLORS9: RGB[] = PATTERN.map((f) => CANONICAL_CENTERS[f]);

describe('localizer geometric core', () => {
  it('samples and classifies the 9 stickers from an axis-aligned quad', () => {
    const frame = frameWithGrid(90, COLORS9);
    const soft = classifyCells(sampleQuad(frame, fullQuad(90)));
    expect(soft.map(argmaxFace)).toEqual(PATTERN);
  });

  it('handles a perspective (non-axis-aligned) quad via bilinear sampling', () => {
    const frame = frameWithGrid(120, COLORS9);
    // a slightly skewed quad inside the frame — bilerp maps sticker centers correctly
    const quad: Quad = [
      { x: 8, y: 6 },
      { x: 112, y: 10 },
      { x: 116, y: 114 },
      { x: 4, y: 110 },
    ];
    const soft = classifyCells(sampleQuad(frame, quad));
    expect(soft.map(argmaxFace)).toEqual(PATTERN);
  });
});

describe('localizer composition', () => {
  it('turns a detected face into camera-slot cells with correct colors', () => {
    const frame = frameWithGrid(90, COLORS9);
    const detector: QuadDetector = {
      detect: () => ({ faces: [{ slot: 'F', quad: fullQuad(90) }], alignedGeometry: true }),
    };
    const res = createLocalizer(detector).detect(frame);
    expect(res.alignedGeometry).toBe(true);
    expect(res.cells.length).toBe(9);
    const bySlot = new Map(res.cells.map((c) => [c.slot, argmaxFace(c.soft)]));
    faceIndices('F').forEach((idx, k) => expect(bySlot.get(idx)).toBe(PATTERN[k]));
  });

  it('the null detector localizes nothing (the on-device detector plugs in here)', () => {
    const res = createLocalizer(nullDetector()).detect(frameWithGrid(30, COLORS9));
    expect(res.cells).toEqual([]);
    expect(res.alignedGeometry).toBe(false);
  });
});
