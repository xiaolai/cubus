// A QuadDetector backed by OpenCV.js (algorithm §12/#15). OpenCV is INJECTED by the
// app (never bundled here — cube-tracker stays dependency-free), so `cv` is loosely
// typed. This is the on-device, hardware-verified piece: it finds the cube's visible
// face quads via a classical contour pipeline, then hands them to the pure, tested
// geometry (orderCorners / assignSlots). Its thresholds are tuned against real footage
// with the on-video overlay, not in the offline gate. The pure geometry it relies on
// IS unit-tested.
//
// Sensitivity notes (why this is permissive by design): a cube face rarely simplifies
// to EXACTLY four convex corners under perspective, sticker gaps, glare and sensor
// noise — so we accept a 4-to-6 point blob and derive its four corners from a rotated
// bounding box (minAreaRect). Edge thresholds auto-adapt to the frame (Otsu) so lighting
// stops mattering, and RETR_LIST keeps inner face contours (a corner view's outer
// contour is the whole-cube hexagon, not a face). Quality is enforced afterwards by
// area, fill-ratio and squareness rather than by demanding a pristine polygon up front.

import { assignSlots, centroid, orderCorners } from './geometry.js';
import type { DetectedFace, Point, QuadDetector } from './localize.js';
import type { Frame } from './motion.js';

// OpenCV.js has a very large, dynamically-shaped surface; typing it as the injected
// module (any) keeps this adapter honest without re-declaring hundreds of members.
type Cv = any;

export interface OpencvDetectorOptions {
  minFaceAreaFrac: number; // a face quad must cover at least this fraction of the frame
  maxFaceAreaFrac: number; // …and at most this (rejects the whole-frame monitor bezel etc.)
  autoCanny: boolean; // derive Canny thresholds from the frame (Otsu) instead of fixed
  cannyLow: number; // fixed-threshold fallback when autoCanny is off / Otsu degenerate
  cannyHigh: number;
  approxEps: number; // approxPolyDP epsilon as a fraction of the contour perimeter
  maxApproxVerts: number; // accept a blob whose polygon has 4..this many vertices
  fillMin: number; // contour area / bounding-box area — rejects rings, L-shapes, the hexagon
  squarenessMin: number; // min side-ratio of the bounding box to count as a face
}
export const DEFAULT_OPENCV: OpencvDetectorOptions = {
  minFaceAreaFrac: 0.008,
  maxFaceAreaFrac: 0.6,
  autoCanny: true,
  cannyLow: 50,
  cannyHigh: 150,
  approxEps: 0.04,
  maxApproxVerts: 6,
  fillMin: 0.6,
  squarenessMin: 0.5,
};

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** min/max side-ratio of a 4-corner quad (1 = perfect square, →0 = degenerate). */
function squareness(q: readonly Point[]): number {
  const sides = [dist(q[0]!, q[1]!), dist(q[1]!, q[2]!), dist(q[2]!, q[3]!), dist(q[3]!, q[0]!)];
  const min = Math.min(...sides);
  const max = Math.max(...sides);
  return max === 0 ? 0 : min / max;
}

/** Shoelace area of a polygon (absolute). */
function polyArea(q: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % q.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** The four corners of a rotated rectangle (center/size/angle°), computed directly to
 *  avoid depending on the presence/shape of cv.RotatedRect.points across builds. */
function boxCorners(r: {
  center: Point;
  size: { width: number; height: number };
  angle: number;
}): Point[] {
  const a = (r.angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hw = r.size.width / 2;
  const hh = r.size.height / 2;
  const { x: cx, y: cy } = r.center;
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

/**
 * Create an OpenCV-backed detector. `cv` is the loaded OpenCV.js module (the same one
 * the app already loads for cube-scanner).
 */
export function opencvDetector(cv: Cv, opts: OpencvDetectorOptions = DEFAULT_OPENCV): QuadDetector {
  return {
    detect(frame: Frame): { faces: DetectedFace[]; alignedGeometry: boolean } {
      const src = cv.matFromImageData({
        data: frame.data,
        width: frame.width,
        height: frame.height,
      });
      const gray = new cv.Mat();
      const edges = new cv.Mat();
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
      const frameArea = frame.width * frame.height;
      const minArea = opts.minFaceAreaFrac * frameArea;
      const maxArea = opts.maxFaceAreaFrac * frameArea;
      const candidates: { corners: Point[]; area: number; sq: number }[] = [];
      try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        // Auto edge thresholds: Otsu gives a data-driven high threshold, low = half of it.
        let lo = opts.cannyLow;
        let hi = opts.cannyHigh;
        if (opts.autoCanny) {
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
        // RETR_LIST: keep inner face contours too (the outer contour of a corner view is
        // the whole-cube hexagon, not a face).
        cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const contArea = cv.contourArea(c);
          if (contArea >= minArea && contArea <= maxArea) {
            const peri = cv.arcLength(c, true);
            const approx = new cv.Mat();
            cv.approxPolyDP(c, approx, opts.approxEps * peri, true);
            let corners: Point[] | null = null;
            if (approx.rows === 4 && cv.isContourConvex(approx)) {
              corners = [];
              for (let k = 0; k < 4; k++)
                corners.push({ x: approx.data32S[k * 2]!, y: approx.data32S[k * 2 + 1]! });
            } else if (approx.rows >= 4 && approx.rows <= opts.maxApproxVerts) {
              // Imperfect but quad-like: take the rotated bounding box's four corners.
              corners = boxCorners(cv.minAreaRect(c));
            }
            approx.delete();
            if (corners) {
              const boxArea = polyArea(corners);
              const fill = boxArea > 0 ? contArea / boxArea : 0;
              const sq = squareness(corners);
              if (fill >= opts.fillMin && sq >= opts.squarenessMin)
                candidates.push({ corners, area: boxArea, sq });
            }
          }
          c.delete();
        }
      } finally {
        src.delete();
        gray.delete();
        edges.delete();
        contours.delete();
        hierarchy.delete();
        kernel.delete();
      }

      // Keep the up-to-3 largest, mutually-distinct quads (the 3 visible faces).
      candidates.sort((a, b) => b.area - a.area);
      const kept: { corners: Point[]; sq: number }[] = [];
      for (const cand of candidates) {
        const cc = centroid(cand.corners);
        const near = kept.some((k) => dist(centroid(k.corners), cc) < 0.5 * Math.sqrt(cand.area));
        if (!near) kept.push(cand);
        if (kept.length === 3) break;
      }

      const slots = assignSlots(kept.map((k) => centroid(k.corners)));
      const faces: DetectedFace[] = kept.map((k, i) => ({
        slot: slots[i]!,
        quad: orderCorners(k.corners),
      }));
      // A rough alignment proxy: every kept face is reasonably square. The precise
      // mid-turn / rolling-shutter rejection is tuned on-device with the overlay.
      const alignedGeometry = faces.length > 0 && kept.every((k) => k.sq >= opts.squarenessMin);
      return { faces, alignedGeometry };
    },
  };
}
