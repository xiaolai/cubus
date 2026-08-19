// S2 verification (the pipeline): grid sampling, classification, and full
// assembly from synthetic frames — the offline analogue of the driver's fixture
// tests. Zero hardware.

import { describe, expect, it } from 'vitest';
import { assemble } from '../src/assemble.js';
import { classify } from '../src/classify.js';
import { SOLVED_FACELETS } from '../src/facelet-cube.js';
import { gridCells, sampleCell, sampleGrid } from '../src/grid.js';
import type { Frame, RGB } from '../src/types.js';
import { CANONICAL, facesFromFacelets, scrambleFacelets } from './helpers.js';

/** Build a frame whose pixels are painted by a per-pixel color function. */
function makeFrame(width: number, height: number, paint: (x: number, y: number) => RGB): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('gridCells', () => {
  it('splits a region into 9 row-major cells', () => {
    const cells = gridCells({ x: 0, y: 0, w: 90, h: 90 });
    expect(cells).toHaveLength(9);
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 30, h: 30 });
    expect(cells[4]).toEqual({ x: 30, y: 30, w: 30, h: 30 }); // center cell
    expect(cells[8]).toEqual({ x: 60, y: 60, w: 30, h: 30 });
  });
});

describe('sampleCell (median ring)', () => {
  it('returns the solid fill color of a cell', () => {
    const frame = makeFrame(30, 30, () => [12, 200, 90]);
    expect(sampleCell(frame, { x: 0, y: 0, w: 30, h: 30 })).toEqual([12, 200, 90]);
  });

  it('ignores a central logo disc (samples the ring, not the center)', () => {
    const cx = 15;
    const cy = 15;
    const frame = makeFrame(30, 30, (x, y) =>
      Math.hypot(x - cx, y - cy) < 3 ? [0, 0, 0] : [200, 30, 40],
    );
    // The 3px black "logo" sits inside the INNER cutoff, so it is skipped.
    expect(sampleCell(frame, { x: 0, y: 0, w: 30, h: 30 })).toEqual([200, 30, 40]);
  });

  it('falls back to the center pixel for a degenerate 1px cell', () => {
    const frame = makeFrame(4, 4, () => [7, 8, 9]);
    expect(sampleCell(frame, { x: 1, y: 1, w: 1, h: 1 })).toEqual([7, 8, 9]);
  });
});

describe('sampleGrid + classify', () => {
  it('reads 9 solid stickers and classifies them against the centers', () => {
    // A face painted with 9 colored cells in a 90x90 frame.
    const letters: RGB[] = [
      CANONICAL.U,
      CANONICAL.R,
      CANONICAL.F,
      CANONICAL.D,
      CANONICAL.L,
      CANONICAL.B,
      CANONICAL.U,
      CANONICAL.R,
      CANONICAL.F,
    ];
    const cells = gridCells({ x: 0, y: 0, w: 90, h: 90 });
    const frame = makeFrame(90, 90, (x, y) => {
      const col = Math.min(2, Math.floor(x / 30));
      const row = Math.min(2, Math.floor(y / 30));
      return letters[row * 3 + col]!;
    });
    const samples = sampleGrid(frame, cells);
    expect(samples[0]).toEqual(CANONICAL.U);
    expect(samples[4]).toEqual(CANONICAL.L);

    // 54 samples but for this focused test we classify the 9 against 6 centers.
    const centers: RGB[] = [
      CANONICAL.U,
      CANONICAL.R,
      CANONICAL.F,
      CANONICAL.D,
      CANONICAL.L,
      CANONICAL.B,
    ];
    const { letters: got, confidence } = classify(samples, centers);
    expect(got.join('')).toBe('URFDLBURF');
    // Exact matches to centers -> full confidence.
    expect(Math.min(...confidence)).toBeGreaterThan(0.9);
  });
});

describe('assemble (full scan)', () => {
  it('recovers the solved cube exactly, valid and fully confident', () => {
    const result = assemble(facesFromFacelets(SOLVED_FACELETS));
    expect(result.facelets).toBe(SOLVED_FACELETS);
    expect(result.valid).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.lowConfidence).toEqual([]);
  });

  it('recovers scrambled cubes exactly and marks them valid', () => {
    for (const alg of ["R U R' U' F2 L D' B", 'U2 R2 F2 D2 L2 B2']) {
      const f = scrambleFacelets(alg);
      const result = assemble(facesFromFacelets(f));
      expect(result.facelets).toBe(f);
      expect(result.valid).toBe(true);
    }
  });

  it('flags an ambiguous sticker (red/orange midpoint) as low confidence', () => {
    const faces = facesFromFacelets(SOLVED_FACELETS);
    // R face, sticker 0 -> global sticker index 9. Paint it halfway to orange.
    faces.R[0] = [
      Math.round((CANONICAL.R[0] + CANONICAL.L[0]) / 2),
      Math.round((CANONICAL.R[1] + CANONICAL.L[1]) / 2),
      Math.round((CANONICAL.R[2] + CANONICAL.L[2]) / 2),
    ];
    const result = assemble(faces);
    expect(result.lowConfidence).toContain(9);
    expect(result.confidence).toBeLessThan(0.15);
  });

  it('marks an unsolvable scan invalid (single flipped edge)', () => {
    const f = SOLVED_FACELETS.split('');
    [f[7], f[19]] = [f[19]!, f[7]!]; // flip edge UF
    const result = assemble(facesFromFacelets(f.join('')));
    expect(result.facelets).toBe(f.join('')); // colors still recovered exactly
    expect(result.valid).toBe(false); // but parity gate rejects it
  });

  it('throws loudly when a face is missing stickers', () => {
    const faces = facesFromFacelets(SOLVED_FACELETS);
    faces.U = faces.U.slice(0, 8);
    expect(() => assemble(faces)).toThrow(/face U/);
  });

  it('honors a custom low-confidence threshold', () => {
    // Same ambiguous sticker as above, but a threshold of 0 flags nothing
    // (confidence is clamped >= 0), proving the parameter is wired through.
    const faces = facesFromFacelets(SOLVED_FACELETS);
    faces.R[0] = [
      Math.round((CANONICAL.R[0] + CANONICAL.L[0]) / 2),
      Math.round((CANONICAL.R[1] + CANONICAL.L[1]) / 2),
      Math.round((CANONICAL.R[2] + CANONICAL.L[2]) / 2),
    ];
    expect(assemble(faces, 0).lowConfidence).toEqual([]);
    expect(assemble(faces).lowConfidence).toContain(9); // default still flags it
  });
});

describe('property: assemble accepts valid cubes and rejects corrupted ones', () => {
  const ALGS = [
    'R',
    "R U R' U'",
    'F2 B2 U2 D2 L2 R2',
    "R U2 R' U' R U' R'",
    "L' U' L U' L' U2 L",
    "R U R' F' R U R' U' R' F R2 U' R'",
    'U D R L F B',
    'R2 U2 R2 U2 R2 U2',
    "F R U R' U' F'",
    "R U R' U R U2 R'",
  ];

  for (const alg of ALGS) {
    it(`accepts "${alg}" exactly, rejects a one-sticker corruption`, () => {
      const f = scrambleFacelets(alg);
      const ok = assemble(facesFromFacelets(f));
      expect(ok.facelets).toBe(f);
      expect(ok.valid).toBe(true);

      // Recolor one sticker to a different existing color -> counts break -> the
      // cube can no longer be well-formed, so it must be rejected.
      const other = f[0] === 'U' ? 'R' : 'U';
      const corrupted = other + f.slice(1);
      expect(assemble(facesFromFacelets(corrupted)).valid).toBe(false);
    });
  }
});

describe('input validation (fail loud)', () => {
  it('sampleCell throws on a truncated frame buffer', () => {
    const bad: Frame = { data: new Uint8ClampedArray(0), width: 90, height: 90 };
    expect(() => sampleCell(bad, { x: 0, y: 0, w: 30, h: 30 })).toThrow(/too small/);
  });

  it('sampleCell throws on zero dimensions', () => {
    const z: Frame = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => sampleCell(z, { x: 0, y: 0, w: 1, h: 1 })).toThrow(/dimensions/);
  });

  it('1px fallback samples the pixel the center falls in, not a neighbor', () => {
    // (1,1) is blue, everything else red. A 1px cell at (1,1) must read blue.
    const frame = makeFrame(4, 4, (x, y) => (x === 1 && y === 1 ? [0, 0, 255] : [255, 0, 0]));
    expect(sampleCell(frame, { x: 1, y: 1, w: 1, h: 1 })).toEqual([0, 0, 255]);
  });

  it('classify yields confidence 0 for a non-finite sample (never trusted)', () => {
    const samples: RGB[] = Array.from({ length: 9 }, () => [...CANONICAL.U] as RGB);
    samples[0] = [Number.NaN, Number.NaN, Number.NaN];
    const centers: RGB[] = [
      CANONICAL.U,
      CANONICAL.R,
      CANONICAL.F,
      CANONICAL.D,
      CANONICAL.L,
      CANONICAL.B,
    ];
    expect(classify(samples, centers).confidence[0]).toBe(0);
  });

  it('assemble rejects a non-finite threshold', () => {
    expect(() => assemble(facesFromFacelets(SOLVED_FACELETS), Number.NaN)).toThrow(/finite/);
  });
});
