// The renderer's framing (lib/cube-frame.js): at the distance it returns, everything the view
// draws is inside the canvas with the margin kept clear — for ANY canvas shape, camera angle,
// ghost elevation and sticker scale — and the frame is tight, so the cube is as large as that
// allows. This is the claim behind "the 3D view is never clipped, at any window size"; the
// hand-tuned distance it replaced clipped the ghost faces' corners on every slot shape but the
// one it was tuned for.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cameraAxes, eyeDirection, fitDistance, fitDistanceStable, project, silhouette } from '../lib/cube-frame.js';

const ASPECTS = [0.3, 0.5, 0.75, 0.83, 1, 1.24, 1.33, 2, 3];
const LATS = [-75, -35, 0, 35, 60, 89];
const LONS = [0, 30, 45, 90, 135, 200, 315];
const ELEVATIONS = [null, 0, 4, 9];
const SCALES = [0.3, 0.9, 1];
const VFOV = 30;
const MARGIN = 0.06;

const cases = function* () {
  for (const aspect of ASPECTS) for (const lat of LATS) for (const lon of LONS) for (const elevation of ELEVATIONS) for (const scale of SCALES) {
    yield { aspect, lat, lon, elevation, scale };
  }
};

test('at the fitted distance every drawn corner is inside the frame, with the margin clear', () => {
  let n = 0;
  for (const c of cases()) {
    const eye = eyeDirection(c.lat, c.lon);
    const points = silhouette({ eye, elevation: c.elevation, scale: c.scale });
    const d = fitDistance({ points, vfovDeg: VFOV, aspect: c.aspect, eye, margin: MARGIN });
    for (const p of project({ points, vfovDeg: VFOV, aspect: c.aspect, eye, d })) {
      assert.ok(p.depth > 0, `${JSON.stringify(c)}: a point behind the camera`);
      assert.ok(Math.abs(p.x) <= 1 - MARGIN + 1e-9 && Math.abs(p.y) <= 1 - MARGIN + 1e-9, `${JSON.stringify(c)}: a corner at (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) is outside the margin`);
    }
    n++;
  }
  assert.ok(n > 4000, `${n} cases`);
});

test('and the frame is tight: the nearest corner sits exactly on the margin, so the cube is as large as the slot allows', () => {
  for (const c of cases()) {
    const eye = eyeDirection(c.lat, c.lon);
    const points = silhouette({ eye, elevation: c.elevation, scale: c.scale });
    const d = fitDistance({ points, vfovDeg: VFOV, aspect: c.aspect, eye, margin: MARGIN });
    const reach = Math.max(...project({ points, vfovDeg: VFOV, aspect: c.aspect, eye, d }).flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
    assert.ok(Math.abs(reach - (1 - MARGIN)) < 1e-6, `${JSON.stringify(c)}: the tightest corner reaches ${reach.toFixed(4)}, not ${1 - MARGIN}`);
  }
});

test('a narrower slot stands the camera further back; a wider one no closer than the height demands', () => {
  const eye = eyeDirection(35, 45);
  const points = silhouette({ eye, elevation: 9, scale: 1 });
  const at = (aspect) => fitDistance({ points, vfovDeg: VFOV, aspect, eye });
  assert.ok(at(0.5) > at(0.83) && at(0.83) > at(1.24), 'narrower → further');
  // Past the aspect at which width stops binding, the height binds and the distance holds.
  assert.ok(Math.abs(at(3) - at(2.5)) < 1e-9, 'a very wide slot is height-bound');
});

test('ghosts widen the silhouette only on the sides the eye cannot see', () => {
  const eye = eyeDirection(35, 45); // sees U, R, F; ghosts on L, D, B
  const pts = silhouette({ eye, elevation: 9, scale: 1 });
  assert.equal(pts.length, 8 + 3 * 4, 'the cube plus three ghost faces');
  const ghost = pts.slice(8);
  assert.ok(ghost.every((p) => p[0] < -4 || p[1] < -4 || p[2] < -4), 'every ghost corner is on a hidden side');
  assert.ok(ghost.every((p) => p[0] < 2 && p[1] < 2 && p[2] < 2), 'and none on a visible one');
  assert.equal(silhouette({ eye, elevation: null }).length, 8, 'ghosts off: the cube alone');
});

test('the tuned distance it replaced clipped: 18 with elevation 9 on the 658×792 card leaves corners outside', () => {
  const eye = eyeDirection(35, 45);
  const points = silhouette({ eye, elevation: 9, scale: 1 });
  const old = 18 * 0.85 + 9 * 0.42; // _applyCamera before this module, before the aspect pull-back
  const outside = project({ points, vfovDeg: VFOV, aspect: 658 / 792, eye, d: old }).filter((p) => Math.abs(p.x) > 1 || Math.abs(p.y) > 1);
  assert.ok(outside.length > 0, 'the old distance fitted this slot, so the fit was never needed');
});

// A camera that refits as it swings appears to zoom: corner-on the cube is ~1.7 wide, face-on it
// is 1 wide. That is correct for a fixed view and wrong for a moving one, and it is what
// `camera-fit="stable"` exists to switch off.
test('the stable fit is the same distance at every angle, and clips at none of them', () => {
  for (const elevation of [null, 9]) {
    const angles = [];
    for (let lat = -90; lat <= 90; lat += 15) for (let lon = 0; lon < 360; lon += 15) angles.push([lat, lon]);

    // The full point set does not depend on the eye once culling is off, so the distance cannot.
    const dists = angles.map(([lat, lon]) => {
      const eye = eyeDirection(lat, lon);
      const points = silhouette({ eye, elevation, cull: false });
      return fitDistanceStable({ points, vfovDeg: 30, aspect: 1.4 });
    });
    const spread = Math.max(...dists) - Math.min(...dists);
    assert.ok(spread < 1e-9, `elevation ${elevation}: distance varies by ${spread} across angles`);

    // Stronger than fitDistance's guarantee: nothing clips at ANY angle, at that one distance.
    const d = dists[0];
    for (const [lat, lon] of angles) {
      const eye = eyeDirection(lat, lon);
      const points = silhouette({ eye, elevation, cull: false });
      for (const q of project({ points, vfovDeg: 30, aspect: 1.4, eye, d })) {
        assert.ok(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1,
          `elevation ${elevation}, lat ${lat} lon ${lon}: point projects to ${q.x.toFixed(3)},${q.y.toFixed(3)}`);
        assert.ok(q.depth > 0, 'a point ended up behind the camera');
      }
    }
  }
});

test('culling is on by default, so the existing per-view fit is untouched', () => {
  const eye = eyeDirection(35, 45);
  assert.deepEqual(silhouette({ eye, elevation: 9 }), silhouette({ eye, elevation: 9, cull: true }));
  // With ghosts off there is nothing to cull, so both settings must agree exactly.
  assert.deepEqual(silhouette({ eye, elevation: null }), silhouette({ eye, elevation: null, cull: false }));
});

// --- which way is up ---------------------------------------------------------------------------
//
// `worldUp` decides the roll: which face of the world lands at the top of the frame. It is a
// parameter and not the constant it used to be because a lesson can show a cube being held upside
// down, and latitude/longitude alone cannot express that — they place the eye and leave the roll
// at +Y, so the picture comes out vertically mirrored.

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('the axes are orthonormal for every up, including one parallel to the eye', () => {
  const eyes = [eyeDirection(35, 45), eyeDirection(-30, 135), eyeDirection(90, 0), eyeDirection(-90, 0)];
  const ups = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, -1]];
  for (const eye of eyes) {
    for (const up of ups) {
      const a = cameraAxes(eye, up);
      for (const [name, v] of Object.entries(a)) {
        assert.ok(near(Math.hypot(...v), 1), `${name} should be a unit vector for eye ${eye} up ${up}`);
      }
      assert.ok(near(dot3(a.right, a.up), 0), `right and up must be perpendicular for eye ${eye} up ${up}`);
      assert.ok(near(dot3(a.right, a.forward), 0), `right and forward must be perpendicular`);
      assert.ok(near(dot3(a.up, a.forward), 0), `up and forward must be perpendicular`);
    }
  }
});

test('turning the frame over negates both screen axes and leaves forward alone', () => {
  const eye = eyeDirection(35, 45);
  const a = cameraAxes(eye);
  const b = cameraAxes(eye, [0, -1, 0]);
  assert.deepEqual(b.forward, a.forward, 'the eye has not moved, so forward cannot change');
  for (let i = 0; i < 3; i++) {
    assert.ok(near(a.up[i] + b.up[i], 0), 'up must be exactly reversed');
    assert.ok(near(a.right[i] + b.right[i], 0), 'right must be exactly reversed');
  }
});

test('a half turn of the frame cannot change what fits in it', () => {
  // The two screen axes both reverse, and the fit measures |dot| against each — so the distance is
  // invariant. Worth pinning: if it were not, turning a cube over would appear to resize it, which
  // is precisely the illusion `camera-fit="stable"` exists to remove.
  for (const [lat, lon] of [[35, 45], [-30, 135], [0, 0], [70, 210]]) {
    const eye = eyeDirection(lat, lon);
    const geom = {
      points: silhouette({ eye, elevation: 4, scale: 0.9, cull: true }),
      vfovDeg: 45, aspect: 1.35, eye,
    };
    assert.ok(near(fitDistance({ ...geom, worldUp: [0, -1, 0] }), fitDistance(geom), 1e-12),
      `the fit changed when the frame turned over, at ${lat}/${lon}`);
  }
});

test('a QUARTER turn of the frame does change the fit, and the fit follows it', () => {
  // The other half of the previous test: `worldUp` is genuinely wired into the framing rather
  // than ignored. A non-square canvas fits differently when the subject is rolled ninety degrees,
  // and the returned distance has to move with it or the corners clip.
  const eye = eyeDirection(35, 45);
  const geom = {
    points: silhouette({ eye, elevation: 4, scale: 0.9, cull: true }),
    vfovDeg: 45, aspect: 2.2, eye,
  };
  const upright = fitDistance(geom);
  const rolled = fitDistance({ ...geom, worldUp: [1, 0, 0] });
  assert.ok(Math.abs(rolled - upright) > 1e-6,
    'a quarter turn in a wide frame must change the fit, or worldUp is not reaching it');
});
