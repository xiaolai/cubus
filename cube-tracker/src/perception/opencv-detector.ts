// A QuadDetector backed by OpenCV.js (algorithm §12/#15). OpenCV is INJECTED by the
// app (never bundled here — cube-tracker stays dependency-free), so `cv` is loosely
// typed. This is the on-device, hardware-verified piece: it finds the cube's visible
// face quads via a classical contour pipeline, then hands them to the pure, tested
// geometry (orderCorners / assignSlots). Its thresholds are tuned against the T4
// localizer gauntlet on real footage, not in the offline gate. The pure geometry it
// relies on IS unit-tested.

import { assignSlots, centroid, orderCorners } from './geometry.js';
import type { DetectedFace, Point, QuadDetector } from './localize.js';
import type { Frame } from './motion.js';

// OpenCV.js has a very large, dynamically-shaped surface; typing it as the injected
// module (any) keeps this adapter honest without re-declaring hundreds of members.
type Cv = any;

export interface OpencvDetectorOptions {
  minFaceAreaFrac: number; // a face quad must cover at least this fraction of the frame
  cannyLow: number;
  cannyHigh: number;
  approxEps: number; // approxPolyDP epsilon as a fraction of the contour perimeter
  squarenessMin: number; // min side-ratio for a quad to count as a well-formed face
}
export const DEFAULT_OPENCV: OpencvDetectorOptions = {
  minFaceAreaFrac: 0.01,
  cannyLow: 50,
  cannyHigh: 150,
  approxEps: 0.04,
  squarenessMin: 0.6,
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
      const minArea = opts.minFaceAreaFrac * frame.width * frame.height;
      const candidates: { corners: Point[]; area: number; sq: number }[] = [];
      try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        cv.Canny(gray, edges, opts.cannyLow, opts.cannyHigh);
        cv.dilate(edges, edges, cv.Mat.ones(3, 3, cv.CV_8U));
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const peri = cv.arcLength(c, true);
          const approx = new cv.Mat();
          cv.approxPolyDP(c, approx, opts.approxEps * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const area = cv.contourArea(approx);
            if (area >= minArea) {
              const corners: Point[] = [];
              for (let k = 0; k < 4; k++)
                corners.push({ x: approx.data32S[k * 2]!, y: approx.data32S[k * 2 + 1]! });
              candidates.push({ corners, area, sq: squareness(corners) });
            }
          }
          approx.delete();
          c.delete();
        }
      } finally {
        src.delete();
        gray.delete();
        edges.delete();
        contours.delete();
        hierarchy.delete();
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
      // mid-turn / rolling-shutter rejection is tuned on-device (T4 gauntlet).
      const alignedGeometry = faces.length > 0 && kept.every((k) => k.sq >= opts.squarenessMin);
      return { faces, alignedGeometry };
    },
  };
}
