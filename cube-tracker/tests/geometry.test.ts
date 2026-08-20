// Pure detector geometry: corner ordering and camera-slot assignment.
import { describe, expect, it } from 'vitest';
import { assignSlots, centroid, orderCorners } from '../src/perception/geometry.js';
import type { Point } from '../src/perception/localize.js';

describe('orderCorners', () => {
  it('orders scrambled corners into TL, TR, BR, BL', () => {
    const scrambled: Point[] = [
      { x: 10, y: 10 }, // TL
      { x: 0, y: 12 }, // BL
      { x: 11, y: 1 }, // TR (given axis-aligned-ish, up-right)
      { x: 1, y: 0 }, // TL-ish...
    ];
    // use a clean square to make the expectation unambiguous
    const sq: Point[] = [
      { x: 5, y: 0 },
      { x: 0, y: 5 },
      { x: 5, y: 5 },
      { x: 0, y: 0 },
    ];
    void scrambled;
    const [tl, tr, br, bl] = orderCorners(sq);
    expect(tl).toEqual({ x: 0, y: 0 });
    expect(tr).toEqual({ x: 5, y: 0 });
    expect(br).toEqual({ x: 5, y: 5 });
    expect(bl).toEqual({ x: 0, y: 5 });
  });
  it('rejects a non-quad', () => {
    expect(() => orderCorners([{ x: 0, y: 0 }])).toThrow(/4 points/);
  });
});

describe('assignSlots (U/R/F corner view)', () => {
  it('assigns top→U, right→R, left→F for three faces', () => {
    // U on top, F lower-left, R lower-right
    const centroids: Point[] = [
      { x: 50, y: 10 }, // top → U
      { x: 20, y: 60 }, // lower-left → F
      { x: 80, y: 60 }, // lower-right → R
    ];
    expect(assignSlots(centroids)).toEqual(['U', 'F', 'R']);
  });
  it('a single face defaults to F (resolver disambiguates)', () => {
    expect(assignSlots([{ x: 5, y: 5 }])).toEqual(['F']);
  });
  it('two faces: the higher one is U', () => {
    expect(
      assignSlots([
        { x: 0, y: 40 },
        { x: 0, y: 5 },
      ]),
    ).toEqual(['F', 'U']);
  });
});

describe('centroid', () => {
  it('averages the points', () => {
    expect(
      centroid([
        { x: 0, y: 0 },
        { x: 4, y: 2 },
      ]),
    ).toEqual({ x: 2, y: 1 });
  });
});
