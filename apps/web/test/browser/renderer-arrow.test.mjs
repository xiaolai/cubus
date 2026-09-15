// The turn arrow — plan item 4.2 of dev-docs/tutorial-capability-plan.md.
//
// An arrow's whole content is WHICH LAYER and WHICH WAY, so those are checked on the geometry, against the
// move's own meaning: a right-handed turn about the move's axis carries the arc's start toward its end with
// the sign of the move's angle, and the arc sits on the move's layer. Whether it is drawn at all is checked
// on the canvas. How it LOOKS is not asserted anywhere — that is the owner's to approve before a golden
// holds it (the plan's rule for every Phase 4 look).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { readToken } from '../../lib/cube-notation.js';
import { installPublicCube } from './public-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  await installPublicCube(page);
});

after(async () => { await fixture?.close(); });

const build = (attrs) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
  const cube = window.__publicCube(el);
  for (const [k, v] of Object.entries(a)) cube.setAttribute(k, v);
  el.clock = 1_000_000;
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
}, attrs);
/** The arrow as drawn: visible or not, and where its arc starts and ends in the cube's own frame. */
const arrow = () => page.evaluate(() => {
  const a = window.__cube._arrow;
  return { visible: a.visible, ...a.userData };
});
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

test('an arrow turns the way its move does, on its move\'s layer, for every kind of move', async () => {
  const tokens = ['R', "R'", 'U', "D'", 'F2', "B'", 'L', 'M', "E'", 'S', 'Rw', "Uw'", 'x', "y'", 'z2'];
  for (const token of tokens) {
    await build({ arrow: token });
    const drawn = await arrow();
    const { move } = readToken(token);
    assert.equal(drawn.visible, true, `${token}: no arrow was drawn`);
    // The turn that carries start to end, about the move's axis, has the sign of the move's angle.
    const turn = dot(cross(drawn.start, drawn.end), drawn.axis);
    assert.equal(Math.sign(turn), Math.sign(move.angle), `${token}: the arrow points the other way round`);
    // On the move's layer: along the axis, the arc sits on the face for a face turn, and through the
    // layers' middle for anything wider.
    const along = dot(drawn.start, drawn.axis);
    const layers = move.layers;
    if (layers.length === 1 && layers[0] !== 0) assert.ok(Math.sign(along) === layers[0] && Math.abs(along) > 1.4, `${token}: not on its face (${along})`);
    else assert.ok(Math.abs(along - layers.reduce((a, b) => a + b, 0) / layers.length) < 1e-6, `${token}: not on its layers (${along})`);
    assert.deepEqual(drawn.axis, [move.axis === 'x' ? 1 : 0, move.axis === 'y' ? 1 : 0, move.axis === 'z' ? 1 : 0]);
    // And every point of it stands on or over a face's surface. A slice's arrow drawn as a ring about its layer
    // passed through the cube at every corner and showed as fragments (found on the Phase 4 look sheet).
    const inside = drawn.points.filter((q) => Math.max(...q.map(Math.abs)) < 1.52);
    assert.deepEqual(inside, [], `${token}: part of the arrow is inside the cube, where nobody can see it`);
  }
});

test('a half turn sweeps further than a quarter, and none refuses a word that is not a move', async () => {
  await build({ arrow: 'R' });
  const quarter = await arrow();
  await build({ arrow: 'R2' });
  const half = await arrow();
  const angleOf = (d) => Math.acos(Math.max(-1, Math.min(1, dot(
    [0, d.start[1], d.start[2]], [0, d.end[1], d.end[2]]) / (Math.hypot(d.start[1], d.start[2]) * Math.hypot(d.end[1], d.end[2])))));
  assert.ok(angleOf(half) > angleOf(quarter) * 1.5, 'a half turn drew the same arc as a quarter');
  await build({ arrow: 'Q' });
  assert.equal((await arrow()).visible, false, 'a word that is not a move drew an arrow');
  await build({ arrow: 'none' });
  assert.equal((await arrow()).visible, false);
});

test('next follows the sequence: the move about to be made, and nothing once it is done', async () => {
  await build({ alg: "R U'", arrow: 'next' });
  const seen = [(await arrow()).angle];
  await page.evaluate(() => window.__publicCube(window.__cube).seek(1));
  seen.push((await arrow()).angle);
  await page.evaluate(() => window.__publicCube(window.__cube).seek(2));
  assert.equal((await arrow()).visible, false, 'an arrow was left standing after the last move');
  assert.deepEqual(seen, [readToken('R').move.angle, readToken("U'").move.angle]);
  // And a regrip in the sequence turns the arrow with the cube: after `y`, the cube's own x axis — the one
  // the next `R` turns about — points out of the world's front.
  await build({ alg: 'y R', arrow: 'next' });
  await page.evaluate(() => window.__publicCube(window.__cube).seek(1));
  const world = await page.evaluate(() => {
    const a = window.__cube._arrow;
    a.updateMatrixWorld(true);
    const V = a.position.constructor;
    const axis = new V(...a.userData.axis).applyQuaternion(a.quaternion);
    return [axis.x, axis.y, axis.z].map((v) => Math.round(v) + 0);
  });
  assert.deepEqual(world, [0, 0, 1], 'after y the arrow for R was drawn about the world\'s x axis, not the cube\'s');
});

test('the arrow is drawn: the canvas changes when one is asked for', async () => {
  const shoot = () => page.evaluate(() => {
    const el = window.__cube;
    el._dirty = true; el._draw();
    const gl = el.renderer.getContext();
    const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px);
  });
  await build({ arrow: 'none' });
  const plain = await shoot();
  await build({ arrow: 'U' });
  const withArrow = await shoot();
  const changed = plain.filter((v, i) => Math.abs(v - withArrow[i]) > 8).length;
  assert.ok(changed > 400, `an arrow on U changed only ${changed} channel values — it is not being drawn`);
});
