// Framing the cube: how far back the camera stands so that everything it is about to draw —
// the cube and the ghost faces its view shows — lands inside the canvas, whatever the canvas's
// shape. Pure arithmetic, no three.js, so it can be held to its claim in Node.
//
// It replaces a hand-tuned distance ("18 frames the tuned look") that was right for one slot
// shape and clipped the ghost faces' corners in every other: a distance is not a property of
// the scene, it is a property of the scene AND the frame, and the frame changes with every
// window. The renderer calls this from _applyCamera on every attribute change and every resize.
//
// Geometry, in cubie units, matching cubus-cube.js: cubies at −1/0/1 with a 0.94 body and a
// sticker face at 1.51; a ghost is a 0.78 plane (scaled with facelet-scale like the stickers)
// floating 0.48 + elevation × 0.42 past its cubie's centre along the face normal, and only the
// faces turned AWAY from the eye show ghosts (dot(normal, eye) < −0.15, as _ghostShows culls).

/** The six face normals. */
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CUBE_HALF = 1.51;
const GHOST_HALF = 0.39;
const GHOST_BASE = 0.48;
const GHOST_PER_ELEVATION = 0.42;
const SHOWS_BELOW = -0.15;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

/** The unit vector from the origin toward a camera at (latitude, longitude) in degrees — the
 *  same spherical convention _applyCamera positions the camera with. */
export function eyeDirection(latDeg, lonDeg) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

/**
 * The points whose projection bounds the drawing: the cube's eight corners, and the four
 * corners of each ghost face the eye will see. Every drawn thing is a convex shape inside the
 * convex hull of these, so fitting the points fits the picture.
 *
 * @param {object} o
 * @param {number[]} o.eye          unit direction toward the camera
 * @param {number|null} o.elevation ghost elevation, or null when ghosts are off
 * @param {number} [o.scale]        facelet-scale (0.3–1; 0.9 is the renderer's own default)
 * @param {boolean} [o.cull]        false to include EVERY face's ghosts, not just the ones this
 *                                  eye would see. Only the stable fit below wants this: a fit that
 *                                  must hold at every angle has to bound the ghosts that show at
 *                                  the other angles too.
 * @returns {number[][]}
 */
export function silhouette({ eye, elevation, scale = 0.9, cull = true }) {
  const points = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) points.push([sx * CUBE_HALF, sy * CUBE_HALF, sz * CUBE_HALF]);
  if (elevation === null || elevation === undefined || !Number.isFinite(elevation)) return points;
  const s = Math.max(0.3, Math.min(1, scale)) / 0.9;
  const lateral = 1 + GHOST_HALF * s; // the outer tiles' centres are at ±1, their edges GHOST_HALF·s beyond
  const along = 1 + GHOST_BASE + elevation * GHOST_PER_ELEVATION;
  for (const n of NORMALS) {
    if (cull && dot(n, eye) >= SHOWS_BELOW) continue; // faces the eye can see carry no ghost
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].filter((a) => !dot(a, n));
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      points.push([
        n[0] * along + axes[0][0] * a * lateral + axes[1][0] * b * lateral,
        n[1] * along + axes[0][1] * a * lateral + axes[1][1] * b * lateral,
        n[2] * along + axes[0][2] * a * lateral + axes[1][2] * b * lateral,
      ]);
    }
  }
  return points;
}

/** The camera's right and up axes for an eye direction, with +y as "up" the way three.js's
 *  lookAt resolves it (and its fallback when the eye is straight above or below). */
export function cameraAxes(eye) {
  const forward = [-eye[0], -eye[1], -eye[2]];
  let right = cross(forward, [0, 1, 0]);
  if (Math.hypot(...right) < 1e-6) right = cross(forward, [0, 0, 1]);
  right = norm(right);
  const up = norm(cross(right, forward));
  return { forward, right, up };
}

/**
 * The smallest camera distance at which every point projects inside the frame, with `margin`
 * of the half-frame kept clear on every side. Perspective: a point at lateral offset x and at
 * depth t toward the camera projects to x / (d − t) against tan(fov / 2), so it fits when
 * d ≥ t + |x| / (tan · (1 − margin)); the fit is the largest of those over all points and both
 * axes. Exact, not tuned: at the returned distance the tightest corner sits exactly `margin`
 * from the edge and nothing sits nearer.
 *
 * @param {object} o
 * @param {number[][]} o.points  world-space points to keep in frame
 * @param {number} o.vfovDeg     the camera's vertical field of view
 * @param {number} o.aspect      canvas width / height
 * @param {number[]} o.eye       unit direction toward the camera
 * @param {number} [o.margin]    share of the half-frame left clear (0.06 = 3% of the canvas each side)
 */
export function fitDistance({ points, vfovDeg, aspect, eye, margin = 0.06 }) {
  const tanV = Math.tan(((vfovDeg / 2) * Math.PI) / 180) * (1 - margin);
  const tanH = tanV * aspect;
  const { right, up } = cameraAxes(eye);
  let d = 0;
  for (const p of points) {
    const t = dot(p, eye);
    d = Math.max(d, t + Math.abs(dot(p, right)) / tanH, t + Math.abs(dot(p, up)) / tanV);
  }
  return d;
}

/**
 * The distance that frames `points` at EVERY view angle, so orbiting does not resize the subject.
 *
 * `fitDistance` fits the silhouette THIS eye draws, which is right for a fixed view and wrong for
 * a moving one: a cube seen corner-on is about 1.7 wide and seen face-on is 1 wide, so a camera
 * that refits as it swings appears to zoom. Measured on the real element, walking from 35/45 to
 * 15/0 pulled in from 10.66 to 8.41 and the cube grew 27% while "only the camera moved".
 *
 * The bound is the points' enclosing sphere, not a scan over candidate angles: for a point at
 * radius r the worst case over all eyes of r*cos(t) + r*sin(t)/tan is r*sqrt(1 + 1/tan^2), which
 * is exact and O(n). A scan would be approximate AND slower, and would need re-running on every
 * aspect change.
 *
 * Strictly stronger than `fitDistance` — clip-free at every angle implies clip-free at this one.
 * It is opt-in only because it costs apparent size, about 11% when ghosts are floating, and a view
 * that never moves programmatically has nothing to gain from it.
 */
export function fitDistanceStable({ points, vfovDeg, aspect, margin = 0.06 }) {
  const tanV = Math.tan(((vfovDeg / 2) * Math.PI) / 180) * (1 - margin);
  const tanH = tanV * aspect;
  const r = points.reduce((m, p) => Math.max(m, Math.hypot(p[0], p[1], p[2])), 0);
  return r * Math.max(Math.sqrt(1 + 1 / (tanV * tanV)), Math.sqrt(1 + 1 / (tanH * tanH)));
}

/**
 * Where each point lands, as a fraction of the half-frame (|x| ≤ 1 and |y| ≤ 1 means inside),
 * for a camera at distance `d` on `eye`. The check the test holds the fit to.
 */
export function project({ points, vfovDeg, aspect, eye, d }) {
  const tanV = Math.tan(((vfovDeg / 2) * Math.PI) / 180);
  const tanH = tanV * aspect;
  const { right, up } = cameraAxes(eye);
  return points.map((p) => {
    const depth = d - dot(p, eye);
    return { x: dot(p, right) / (depth * tanH), y: dot(p, up) / (depth * tanV), depth };
  });
}
