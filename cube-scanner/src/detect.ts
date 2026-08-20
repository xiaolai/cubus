// Face detection via OpenCV.js — the ONE part that genuinely needs the CV library and
// can only be validated against real webcam frames. It finds cube face outlines with a
// classical contour pipeline (gray → blur → auto-Canny → contours → quad-like blobs) and
// returns their corners; the perspective sampling (homography.ts) stays pure.
//
// Two entry points share one robust core: detectFaceQuad (the largest single face, for
// the flat scanner) and detectFaceQuads (up to three, for the two-corner scan). Robust =
// tolerant: a cube face rarely reduces to EXACTLY four convex corners, so a 4-to-6 point
// blob's corners come from a rotated bounding box (minAreaRect); Canny thresholds adapt to
// the frame (Otsu). Quality is enforced by area, fill-ratio and squareness afterwards.
//
// OpenCV.js is INJECTED, not imported, so cube-scanner's bundle stays lean. Thresholds are
// starting points and are tuned against a real cube with the panel's on-video overlay.

import { type Point, type Quad, orderCorners } from './homography.js';
import type { Frame } from './types.js';

/**
 * The OpenCV.js namespace. The emscripten API isn't cleanly typed and we cross a WASM
 * boundary, so this is intentionally `any`.
 */
export type OpenCv = any;

export interface DetectOptions {
  cannyLow?: number; // fixed-threshold fallback when autoCanny is off / Otsu degenerate
  cannyHigh?: number;
  autoCanny?: boolean; // derive Canny thresholds from the frame (Otsu). Default true.
  /** approxPolyDP epsilon as a fraction of the contour perimeter. */
  approxEpsilon?: number;
  /** Accept a blob whose polygon has 4..this many vertices (via minAreaRect). Default 6. */
  maxApproxVerts?: number;
  /** A face must cover at least this fraction of the frame. */
  minAreaFraction?: number;
  /** …and at most this (rejects the whole-frame bezel / a wall). Default 0.9. */
  maxAreaFraction?: number;
  /** contour area / bounding-box area — rejects rings, L-shapes, the cube hexagon. */
  fillMin?: number;
  /** min side-ratio of the bounding box to count as a face. */
  squarenessMin?: number;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
function centroid(pts: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}
function squareness(pts: readonly Point[]): number {
  const s = [
    dist(pts[0]!, pts[1]!),
    dist(pts[1]!, pts[2]!),
    dist(pts[2]!, pts[3]!),
    dist(pts[3]!, pts[0]!),
  ];
  const min = Math.min(...s);
  const max = Math.max(...s);
  return max === 0 ? 0 : min / max;
}
function polyArea(pts: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
/** Corners of a rotated rect (center/size/angle°), computed directly (build-independent). */
function boxCorners(r: {
  center: { x: number; y: number };
  size: { width: number; height: number };
  angle: number;
}): Point[] {
  const a = (r.angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hw = r.size.width / 2;
  const hh = r.size.height / 2;
  const cx = r.center.x;
  const cy = r.center.y;
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Point);
}

/** The shared robust core: up to `maxFaces` distinct face-quad corner sets, largest first. */
function detectQuadCorners(
  cv: OpenCv,
  frame: Frame,
  opts: DetectOptions,
  maxFaces: number,
): Point[][] {
  const epsilon = opts.approxEpsilon ?? 0.04;
  const maxVerts = opts.maxApproxVerts ?? 6;
  const fillMin = opts.fillMin ?? 0.6;
  const squarenessMin = opts.squarenessMin ?? 0.45;
  const frameArea = frame.width * frame.height;
  const minArea = (opts.minAreaFraction ?? 0.15) * frameArea;
  const maxArea = (opts.maxAreaFraction ?? 0.9) * frameArea;

  const src = cv.matFromImageData(frame);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const cleanup = [src, gray, edges, contours, hierarchy, kernel];
  const candidates: { corners: Point[]; area: number }[] = [];
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    let lo = opts.cannyLow ?? 50;
    let hi = opts.cannyHigh ?? 150;
    if (opts.autoCanny ?? true) {
      const bin = new cv.Mat();
      const otsu = cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      bin.delete();
      if (otsu >= 1) {
        hi = otsu;
        lo = 0.5 * otsu;
      }
    }
    cv.Canny(gray, edges, lo, hi);
    cv.dilate(edges, edges, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const contArea = Math.abs(cv.contourArea(cnt));
      if (contArea >= minArea && contArea <= maxArea) {
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, epsilon * cv.arcLength(cnt, true), true);
        let corners: Point[] | null = null;
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const d = approx.data32S;
          corners = [
            [d[0], d[1]],
            [d[2], d[3]],
            [d[4], d[5]],
            [d[6], d[7]],
          ];
        } else if (approx.rows >= 4 && approx.rows <= maxVerts) {
          corners = boxCorners(cv.minAreaRect(cnt));
        }
        approx.delete();
        if (corners) {
          const boxArea = polyArea(corners);
          const fill = boxArea > 0 ? contArea / boxArea : 0;
          if (fill >= fillMin && squareness(corners) >= squarenessMin)
            candidates.push({ corners, area: boxArea });
        }
      }
      cnt.delete();
    }
  } finally {
    for (const mat of cleanup) mat.delete();
  }

  candidates.sort((a, b) => b.area - a.area);
  const kept: Point[][] = [];
  for (const cand of candidates) {
    const cc = centroid(cand.corners);
    const near = kept.some((k) => dist(centroid(k), cc) < 0.5 * Math.sqrt(cand.area));
    if (!near) kept.push(cand.corners);
    if (kept.length === maxFaces) break;
  }
  return kept;
}

/**
 * Find the single largest cube face quad in a frame, or null. Never throws on "no face" —
 * null is the normal "keep looking" path. Used by the flat single-face scanner.
 */
export function detectFaceQuad(cv: OpenCv, frame: Frame, opts: DetectOptions = {}): Quad | null {
  const corners = detectQuadCorners(cv, frame, opts, 1);
  return corners[0] ? orderCorners(corners[0]) : null;
}

/**
 * Find up to three cube face quads (a corner view shows three faces at once). Used by the
 * two-corner scan. The default min-area is lower than the single-face path since three
 * faces share the frame.
 */
export function detectFaceQuads(cv: OpenCv, frame: Frame, opts: DetectOptions = {}): Quad[] {
  const merged: DetectOptions = { minAreaFraction: 0.02, maxAreaFraction: 0.5, ...opts };
  return detectQuadCorners(cv, frame, merged, 3).map(orderCorners);
}
