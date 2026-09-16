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
    // ONE LINE PER LAYER THE MOVE TURNS, each ON its layer. One rule for every kind of move, which is the
    // point of the change: the old rule had a branch for face turns, because they alone were drawn as an arc
    // on their own face while everything else got a straight line across a face it crossed.
    assert.equal(drawn.lanes, move.layers.length, `${token}: ${drawn.lanes} lines for ${move.layers.length} layers`);
    // `+ 0` and a NUMERIC sort, both load-bearing: a middle layer rounds to -0, which deep-equals nothing,
    // and a default sort compares numbers as text. Every slice in this list has a layer at 0.
    const up = (a, b) => a - b;
    const on = [...new Set(drawn.points.map((q) => Math.round(dot(q, drawn.axis) * 1e6) / 1e6 + 0))].sort(up);
    assert.deepEqual(on, [...move.layers].sort(up), `${token}: its lines sit at ${on.join(', ')}, not on layers ${move.layers.join(', ')}`);
    assert.deepEqual(drawn.axis, [move.axis === 'x' ? 1 : 0, move.axis === 'y' ? 1 : 0, move.axis === 'z' ? 1 : 0]);
    // And every point of it stands on or over a face's surface. A slice's arrow drawn as a ring about its layer
    // passed through the cube at every corner and showed as fragments (found on the Phase 4 look sheet).
    const inside = drawn.points.filter((q) => Math.max(...q.map(Math.abs)) < 1.52);
    assert.deepEqual(inside, [], `${token}: part of the arrow is inside the cube, where nobody can see it`);
  }
});

// THE TWO THINGS A STRAIGHT LINE CANNOT SAY BY ITSELF, and how each is said instead.
//
// 180°: a line says which layer and which way, never how far, because 90° and 180° move the same layer the
// same way. The arc this replaced could sweep further — the one thing it could say that a line cannot — so a
// half turn carries a DOT past its head, the way the stem of an `i` does.
//
// TOGETHER: two lines pointing the same way are two instructions unless something joins them, so a move
// wider than one layer has a bar TIED across its lines near their tails. One line never gets one; a tie
// across a single line would be a mark with nothing to say.
const extras = () => page.evaluate(() => ({
  dots: window.__cube._arrow.children.filter((m) => m.userData.halfTurn).length,
  ties: window.__cube._arrow.children.filter((m) => m.userData.tie).length,
}));
/** How far each dot sits from the line's tail and from its head, in the cube's own frame. */
const dotPlaces = () => page.evaluate(() => {
  const a = window.__cube._arrow;
  const V = window.__cube.camera.position.constructor;
  const start = new V(...a.userData.start); const end = new V(...a.userData.end);
  return a.children.filter((m) => m.userData.halfTurn)
    .map((m) => ({ toTail: m.position.distanceTo(start), toHead: m.position.distanceTo(end) }));
});

test('a half turn carries a dot and a quarter does not; a wide move is tied and a single layer is not', async () => {
  // Every mark is drawn twice — its ink, and the rim under it — so the counts come in pairs.
  for (const [token, dots, ties] of [
    ['R', 0, 0], ["U'", 0, 0], ['M', 0, 0],
    ['R2', 2, 0], ['U2', 2, 0], ['M2', 2, 0],
    ['Rw', 0, 2], ['x', 0, 2], ["Uw'", 0, 2],
    ['Rw2', 2, 2], ['x2', 2, 2],
  ]) {
    await build({ arrow: token });
    assert.deepEqual(await extras(), { dots, ties },
      `${token}: expected ${dots / 2 || 'no'} dot and ${ties / 2 || 'no'} tie`);
  }
  // AT THE TAIL, not past the head (owner's call, 2026-09-16): the head is the one part of the line already
  // doing a job — it says which way — and a mark beyond it competes with the first thing a reader looks at.
  for (const token of ['R2', "U2", 'M2', 'x2']) {
    await build({ arrow: token });
    for (const { toTail, toHead } of await dotPlaces()) {
      assert.ok(toTail < toHead, `${token}: its dot is ${toTail.toFixed(2)} from the tail and ${toHead.toFixed(2)} from the head — it is on the wrong end`);
      assert.ok(toTail > 0.1, `${token}: its dot sits on the tail rather than clear of it`);
    }
  }
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

// The look sheet, 2026-09-16. The arrow was a near-black body inside a light rim, and the cube's plastic is
// a near-black too — so the body vanished into it and the RIM read as the figure: a hollow outline rather
// than a mark. It is the other way up now and has no hue at all: a WHITE body carried by a dark shadow
// (owner's call — "shouldn't use colors that similar to any 6 colors in the cube"). WHICH colours is not
// assertable here; `lib/annotation-inks.js` and its unit test hold that, where they can be measured against
// every palette. What IS assertable is that the mark has two parts, which way round they are drawn, and that
// the body is the lighter of the two — the exact thing that was wrong.
const parts = () => page.evaluate(() => window.__cube._arrow.children.map((m) => ({
  kind: m.geometry.type, order: m.renderOrder, colour: m.material.color.getHexString(),
  light: m.material.color.r + m.material.color.g + m.material.color.b,
})));

test('an arrow is a light body carried by a dark shadow, and the shadow is drawn under it', async () => {
  await build({ arrow: 'R' });
  const drawn = await parts();
  const shadow = drawn.filter((p) => p.order === 2); const body = drawn.filter((p) => p.order === 3);
  assert.deepEqual(shadow.map((p) => p.kind), ['TubeGeometry', 'ConeGeometry'], 'the arrow has no shadow');
  assert.deepEqual(body.map((p) => p.kind), ['TubeGeometry', 'ConeGeometry'], 'the arrow has no body');
  // The shadow UNDER the body. Drawn the other way round it covers the mark it exists to carry, and nothing
  // else in this file would notice: the geometry, the layer and the direction are all still right.
  assert.ok(Math.max(...shadow.map((p) => p.order)) < Math.min(...body.map((p) => p.order)));
  assert.equal(new Set(shadow.map((p) => p.colour)).size, 1, 'the shadow is not one colour');
  assert.equal(new Set(body.map((p) => p.colour)).size, 1, 'the body is not one colour');
  // THE HALF THAT WAS WRONG: the body is the LIGHT one. Inverted, the mark is a hollow outline again, and
  // every other assertion in this file goes on passing.
  assert.ok(body[0].light > shadow[0].light + 1.5,
    `the body is #${body[0].colour} and the shadow #${shadow[0].colour} — the mark is inside out`);
});

// RESTORED. This case was deleted by accident on 2026-09-17, by a rewrite that replaced everything from a
// comment to the end of the file — which is how a check disappears without a single test going red: the
// suite simply reports one fewer. It is the only case here that asks whether an arrow reaches the CANVAS;
// every other one reads the scene graph, and all of them pass over a cube that draws nothing at all.
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
