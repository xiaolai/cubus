// Face detection via OpenCV.js — the ONE part that genuinely needs the CV
// library and can only be validated against real webcam frames. It finds the
// cube face outline (the standard document-scanner recipe: gray -> blur -> Canny
// -> contours -> the largest convex 4-corner quad) and returns its 4 corners.
// The perspective sampling (homography.ts) and everything downstream stay pure.
//
// OpenCV.js is INJECTED, not imported, so cube-scanner's own bundle stays lean:
// the app loads opencv.js (window.cv) and passes it in; the Node smoke test
// passes @techstark/opencv-js. Thresholds below are starting points and need
// tuning against a real cube under real light.

import { type Point, type Quad, orderCorners } from './homography.js';
import type { Frame } from './types.js';

/**
 * The OpenCV.js namespace. The emscripten API isn't cleanly typed and we cross a
 * WASM boundary, so this is intentionally `any`.
 */
export type OpenCv = any;

export interface DetectOptions {
  cannyLow?: number;
  cannyHigh?: number;
  /** approxPolyDP epsilon as a fraction of the contour perimeter. */
  approxEpsilon?: number;
  /** The face must cover at least this fraction of the frame to count. */
  minAreaFraction?: number;
}

/**
 * Find the cube face quad in a frame, or null if no confident face is found.
 * Never throws on "no face" — returning null is the normal "keep looking" path.
 */
export function detectFaceQuad(cv: OpenCv, frame: Frame, opts: DetectOptions = {}): Quad | null {
  const cannyLow = opts.cannyLow ?? 50;
  const cannyHigh = opts.cannyHigh ?? 150;
  const epsilon = opts.approxEpsilon ?? 0.05;
  const minArea = (opts.minAreaFraction ?? 0.15) * frame.width * frame.height;

  const src = cv.matFromImageData(frame);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const cleanup = [src, gray, edges, contours, hierarchy];

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(gray, edges, cannyLow, cannyHigh);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, kernel);
    kernel.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let best: Point[] | null = null;
    let bestArea = minArea;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, epsilon * cv.arcLength(cnt, true), true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const area = Math.abs(cv.contourArea(approx));
        if (area > bestArea) {
          bestArea = area;
          const d = approx.data32S;
          best = [
            [d[0], d[1]],
            [d[2], d[3]],
            [d[4], d[5]],
            [d[6], d[7]],
          ];
        }
      }
      approx.delete();
      cnt.delete();
    }
    return best ? orderCorners(best) : null;
  } finally {
    for (const mat of cleanup) mat.delete();
  }
}
