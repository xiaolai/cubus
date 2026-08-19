// Perspective sampling: read a face's 9 stickers from an ARBITRARY quadrilateral
// in the frame (offset / rotated / skewed), not a fixed axis-aligned grid. Given
// the 4 detected face corners, we build the unit-square -> quad projective map
// (Heckbert, "Projective Mappings for Image Warping") and sample each sticker in
// normalized face space, projecting every sample point into the image — so the
// sampling follows the perspective instead of fighting it.
//
// Pure math + pixel reads, no DOM and no OpenCV, so it is fully Node-testable.
// OpenCV.js is used only to FIND the corners (detect.ts); the warp lives here.

import type { Frame, RGB } from './types.js';

export type Point = readonly [number, number];

/** The 4 corners of a face, in reading order: top-left, top-right, bottom-right, bottom-left. */
export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

/** A 3x3 projective transform with the bottom-right element fixed at 1. */
export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}

/**
 * Order 4 unordered points into a Quad (tl, tr, br, bl). Top-left has the
 * smallest x+y, bottom-right the largest; top-right the smallest y-x,
 * bottom-left the largest. Pure — the detector reuses it on OpenCV's raw points.
 */
export function orderCorners(pts: readonly Point[]): Quad {
  if (pts.length !== 4) throw new Error(`orderCorners expects 4 points, got ${pts.length}`);
  let tl = pts[0]!;
  let br = pts[0]!;
  let tr = pts[0]!;
  let bl = pts[0]!;
  for (const p of pts) {
    const sum = p[0] + p[1];
    const diff = p[1] - p[0];
    if (sum < tl[0] + tl[1]) tl = p;
    if (sum > br[0] + br[1]) br = p;
    if (diff < tr[1] - tr[0]) tr = p;
    if (diff > bl[1] - bl[0]) bl = p;
  }
  return { tl, tr, br, bl };
}

/**
 * The projective map taking the unit square corners
 * (0,0)->tl, (1,0)->tr, (1,1)->br, (0,1)->bl to the given quad.
 */
export function unitSquareToQuad(q: Quad): Transform {
  const [x0, y0] = q.tl;
  const [x1, y1] = q.tr;
  const [x2, y2] = q.br;
  const [x3, y3] = q.bl;

  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;

  // Parallelogram (affine) case: the two "sag" terms vanish.
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return { a: x1 - x0, b: x3 - x0, c: x0, d: y1 - y0, e: y3 - y0, f: y0, g: 0, h: 0 };
  }

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;

  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
  };
}

/** Map a normalized face coordinate (u,v) in [0,1]^2 to an image point. */
export function project(t: Transform, u: number, v: number): Point {
  const w = t.g * u + t.h * v + 1;
  return [(t.a * u + t.b * v + t.c) / w, (t.d * u + t.e * v + t.f) / w];
}

function pixel(frame: Frame, x: number, y: number): RGB {
  const cx = Math.min(frame.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(frame.height - 1, Math.max(0, Math.round(y)));
  const i = (cy * frame.width + cx) * 4;
  return [frame.data[i]!, frame.data[i + 1]!, frame.data[i + 2]!];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

// Normalized-space offsets within a cell: a ring that skips the center (logo/
// glare) and the edges (gaps). Each is a fraction of a 1/3-wide cell half-width.
const RING = [0.35, 0.6];
const ANGLES = 8;

function assertFrame(frame: Frame): void {
  const { width, height, data } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid frame dimensions: ${width}x${height}`);
  }
  if (data.length < width * height * 4) {
    throw new Error(`frame buffer too small: ${data.length} < ${width * height * 4}`);
  }
}

/**
 * Sample the 9 sticker colors from a face quad, URFDLB reading order (row-major).
 * Each sticker is the median of a ring sampled in normalized cell space, so the
 * ring follows the perspective and skips the logo + inter-sticker gaps.
 */
export function sampleQuad(frame: Frame, quad: Quad): RGB[] {
  assertFrame(frame);
  const t = unitSquareToQuad(quad);
  const half = 1 / 6; // half a cell width in normalized [0,1] face space
  const out: RGB[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cu = (col + 0.5) / 3;
      const cv = (row + 0.5) / 3;
      const rs: number[] = [];
      const gs: number[] = [];
      const bs: number[] = [];
      for (const r of RING) {
        for (let k = 0; k < ANGLES; k++) {
          const ang = (2 * Math.PI * k) / ANGLES;
          const u = cu + Math.cos(ang) * r * half;
          const v = cv + Math.sin(ang) * r * half;
          const [x, y] = project(t, u, v);
          const [pr, pg, pb] = pixel(frame, x, y);
          rs.push(pr);
          gs.push(pg);
          bs.push(pb);
        }
      }
      out.push([median(rs), median(gs), median(bs)]);
    }
  }
  return out;
}
