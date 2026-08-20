// Pure detector geometry (the testable half of the OpenCV QuadDetector): order a
// quad's four corners into TL,TR,BR,BL, and assign each detected face a CAMERA slot
// from its image position (top-facing → U, then R to the right, F to the left in the
// standard U/R/F corner view). The slot only needs to reflect the true camera frame;
// orientation.ts's 24-way resolver maps camera → cube.

import type { Face } from '../cube.js';
import type { Point, Quad } from './localize.js';

/** Order four unordered corners into TL, TR, BR, BL. */
export function orderCorners(pts: readonly Point[]): Quad {
  if (pts.length !== 4) throw new Error(`orderCorners: expected 4 points, got ${pts.length}`);
  let tl = pts[0]!;
  let br = pts[0]!;
  let tr = pts[0]!;
  let bl = pts[0]!;
  for (const p of pts) {
    if (p.x + p.y < tl.x + tl.y) tl = p; // smallest x+y → top-left
    if (p.x + p.y > br.x + br.y) br = p; // largest x+y → bottom-right
    if (p.x - p.y > tr.x - tr.y) tr = p; // largest x−y → top-right
    if (p.x - p.y < bl.x - bl.y) bl = p; // smallest x−y → bottom-left
  }
  return [tl, tr, br, bl];
}

/** Centroid of a set of points. */
export function centroid(pts: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/**
 * Assign a camera slot to each detected face from its centroid, for the standard
 * U/R/F corner view: the top-most face is U; of the lower two, the right one is R and
 * the left one is F. Returns slots in the SAME order as the input centroids.
 */
export function assignSlots(centroids: readonly Point[]): Face[] {
  const n = centroids.length;
  if (n === 0) return [];
  if (n === 1) return ['F']; // a single face — the resolver figures out which cube face
  const out = new Array<Face>(n);
  let top = 0;
  for (let i = 1; i < n; i++) if (centroids[i]!.y < centroids[top]!.y) top = i;
  out[top] = 'U';
  const rest: number[] = [];
  for (let i = 0; i < n; i++) if (i !== top) rest.push(i);
  if (n === 2) {
    out[rest[0]!] = 'F';
    return out;
  }
  const [a, b] = rest as [number, number]; // exactly two for n === 3
  if (centroids[a]!.x > centroids[b]!.x) {
    out[a] = 'R';
    out[b] = 'F';
  } else {
    out[a] = 'F';
    out[b] = 'R';
  }
  return out;
}
