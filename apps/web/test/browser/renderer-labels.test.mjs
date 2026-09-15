// Face letters on the cube — plan item 4.3 of dev-docs/tutorial-capability-plan.md.
//
// Two sentences, and the test is that they part company when the cube turns: `position` names the PLACE
// (the face on top is U, whatever colour it is — what a notation lesson teaches), `face` names the FACE
// (the white centre's U goes wherever the white centre goes). Checked on where each letter stands and which
// way it faces; how the letters LOOK is the owner's to approve before a golden holds them.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

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

/** Each letter: the world direction it stands in, and the world direction its face points. */
const letters = () => page.evaluate(() => {
  const el = window.__cube;
  el.scene.updateMatrixWorld(true);
  const V = el.camera.position.constructor;
  const out = {};
  for (const mesh of el._labelMeshes ?? []) {
    const at = mesh.getWorldPosition(new V());
    const facing = new V(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new (el.camera.quaternion.constructor)()));
    const round = (v) => [v.x, v.y, v.z].map((c) => Math.round(c) + 0);
    out[mesh.userData.label] = { at: round(at.clone().normalize()), facing: round(facing) };
  }
  return out;
});
const WORLD = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };

test('position letters name the places: held any way, the face on top is U', async () => {
  for (const orientation of ['U F', 'D B', 'R F']) {
    await build({ labels: 'position', orientation });
    const drawn = await letters();
    assert.equal(Object.keys(drawn).length, 6, 'six letters');
    for (const [letter, dir] of Object.entries(WORLD)) {
      assert.deepEqual(drawn[letter].at, dir, `held ${orientation}, ${letter} is not on its place`);
      assert.deepEqual(drawn[letter].facing, dir, `held ${orientation}, ${letter} does not face out of its place`);
    }
  }
});

test('face letters travel with their centres: held D B, the U letter is underneath', async () => {
  await build({ labels: 'face', orientation: 'D B' });
  const held = await letters();
  assert.deepEqual(held.U.at, [0, -1, 0], 'the U centre is on the bottom when the cube is held D B');
  assert.deepEqual(held.U.facing, [0, -1, 0]);
  assert.deepEqual(held.F.at, [0, 0, -1]);
  // And a regrip inside a sequence carries them too: after `x` the U centre faces the back.
  await build({ labels: 'face', alg: 'x' });
  await page.evaluate(() => window.__publicCube(window.__cube).seek(1));
  const turned = await letters();
  assert.deepEqual(turned.U.at, [0, 0, -1], 'after x the U letter stayed where the U centre was');
  assert.deepEqual(turned.F.at, [0, 1, 0]);
  // Turned on AFTER the regrip, the letters still find their own centres — not whichever centre now stands
  // in each face's home place.
  await build({ alg: 'x' });
  await page.evaluate(() => window.__publicCube(window.__cube).seek(1));
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('labels', 'face'));
  const late = await letters();
  assert.deepEqual(late.U.at, [0, 0, -1], 'letters turned on after x were put on the centres standing in the home places');
});

test('letters come and go with the attribute, and a word that is not a mode draws none', async () => {
  await build({ labels: 'position' });
  assert.equal(Object.keys(await letters()).length, 6);
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('labels', 'none'));
  assert.deepEqual(await letters(), {}, 'letters were left standing after they were turned off');
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('labels', 'everywhere'));
  assert.deepEqual(await letters(), {});
  // Recycled, an element has no letters: `labels` goes back to its default with every other attribute.
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('labels', 'face'));
  await page.evaluate(() => window.__publicCube(window.__cube).recycle());
  assert.deepEqual(await letters(), {}, 'a recycled cube kept the last screen\'s letters');
});

test('the letters are drawn: the canvas changes when they are asked for', async () => {
  const shoot = () => page.evaluate(() => {
    const el = window.__cube;
    el._dirty = true; el._draw();
    const gl = el.renderer.getContext();
    const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px);
  });
  await build({});
  const plain = await shoot();
  await build({ labels: 'position' });
  const lettered = await shoot();
  const changed = plain.filter((v, i) => Math.abs(v - lettered[i]) > 8).length;
  assert.ok(changed > 400, `letters changed only ${changed} channel values — they are not being drawn`);
});
