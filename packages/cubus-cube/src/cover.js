// Screen-space cover (ADR 0013 decision 3). No three.js and no DOM: points arrive projected.
// A point is [x, y, iw], CSS px and 1/w; a larger iw is nearer the eye. Across a planar primitive
// 1/w is affine in screen space, so the difference between two planes is affine too, and its sign
// over a convex overlap is decided by the overlap's vertices.

// Below this many CSS px² an overlap is an edge or a corner touching, not an overlap.
const AREA_EPS = 1e-6;

const signedArea = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
};

// Sutherland–Hodgman: `subject` clipped to the convex polygon `clip`, either winding.
function clipTo(subject, clip) {
  const turn = Math.sign(signedArea(clip));
  let out = subject.map(([x, y]) => [x, y]);
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % clip.length];
    const side = ([x, y]) => turn * ((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out;
}

// The affine iw(x, y) through three points of a plane.
function planeOf([[x0, y0, w0], [x1, y1, w1], [x2, y2, w2]]) {
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const a = ((w1 - w0) * (y2 - y0) - (w2 - w0) * (y1 - y0)) / det;
  const b = ((x1 - x0) * (w2 - w0) - (x2 - x0) * (w1 - w0)) / det;
  return ([x, y]) => w0 + a * (x - x0) + b * (y - y0);
}

/** Whether `subject` and the convex polygon `clip` overlap with positive area. */
export function overlaps(subject, clip) {
  return Math.abs(signedArea(clipTo(subject, clip))) > AREA_EPS;
}

/**
 * Whether the triangle `tri` covers the convex quad `quad`: they overlap with positive area and the
 * triangle is strictly nearer somewhere in the overlap.
 */
export function covers(quad, tri) {
  if (Math.abs(signedArea(quad)) <= AREA_EPS || Math.abs(signedArea(tri)) <= AREA_EPS) return false;
  const overlap = clipTo(tri, quad);
  if (Math.abs(signedArea(overlap)) <= AREA_EPS) return false;
  const mark = planeOf(tri);
  const sticker = planeOf(quad);
  return overlap.some((p) => mark(p) - sticker(p) > 0);
}
