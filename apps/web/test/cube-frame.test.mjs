// The renderer's framing (lib/cube-frame.js): at the distance it returns, everything the view
// draws is inside the canvas with the margin kept clear — for ANY canvas shape, camera angle,
// ghost elevation and sticker scale — and the frame is tight, so the cube is as large as that
// allows. This is the claim behind "the 3D view is never clipped, at any window size"; the
// hand-tuned distance it replaced clipped the ghost faces' corners on every slot shape but the
// one it was tuned for.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eyeDirection, fitDistance, project, silhouette } from '../lib/cube-frame.js';

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
