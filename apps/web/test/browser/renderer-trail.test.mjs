// Trails — plan item 4.4 of dev-docs/tutorial-capability-plan.md.
//
// A trail's content is the ROUTE: which slots a piece passes through over a sequence, in order, and that it
// travels between them along the arc a turn really moves it on. The route is checked against cubejs's own
// piece tracking — an implementation that shares no code with the renderer's pose — and the arcs against
// the stops they join. How a trail LOOKS is the owner's to approve before a golden holds it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

import { slotVector } from '../../lib/cube-highlight.js';
import { installPublicCube } from './public-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');
const CORNERS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const EDGES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

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
const trails = () => page.evaluate(() => (window.__cube._trailMeshes ?? []).filter((m) => m.userData.trail).map((m) => ({ ...m.userData })));

/** Where cubejs says a piece is after each prefix of `alg`, as slot positions, repeats collapsed. */
function route(piece, alg) {
  const names = piece.length === 3 ? CORNERS : EDGES;
  const id = names.findIndex((n) => [...n].sort().join('') === [...piece].sort().join(''));
  const cube = new Cube();
  const slotOf = () => names[(piece.length === 3 ? cube.cp : cube.ep).indexOf(id)];
  const out = [slotVector(slotOf())];
  for (const move of alg.split(' ').filter(Boolean)) {
    cube.move(move);
    const at = slotVector(slotOf());
    if (at.join() !== out[out.length - 1].join()) out.push(at);
  }
  return out;
}

test('a trail passes through the slots cubejs puts the piece in, in order', async () => {
  for (const [alg, piece] of [["R U R' U'", 'URF'], ["R U R' U'", 'UF'], ["R U' R U R U R U' R' U' R2", 'UF'], ["F R U R' U' F'", 'UR']]) {
    await build({ alg, trail: `piece:${piece}` });
    const [trail] = await trails();
    const expected = route(piece, alg);
    if (expected.length < 2) { assert.equal(trail, undefined, `${piece} does not move in "${alg}", and a trail was drawn`); continue; }
    assert.deepEqual(trail.stops, expected, `${piece} over "${alg}"`);
  }
});

test('between two stops the trail is the arc a turn moves the piece on, and lands on the next stop', async () => {
  // A regrip FIRST, so every later arc is about an axis the frame has turned — and a slice among the turns.
  await build({ alg: "x R U2 M'", trail: 'piece:UF,piece:DF' });
  for (const trail of await trails()) {
    const { stops, curve } = trail;
    // Every twelfth point of the curve is where a turn landed, and every point sits the piece's own distance
    // from the centre — an arc, not a chord through the cube.
    for (let k = 1; k < stops.length; k++) {
      assert.deepEqual(curve[k * 12].map((v) => Math.round(v * 1e6) / 1e6 + 0), stops[k], `${trail.trail}: turn ${k} did not land on its stop`);
    }
    const radius = Math.hypot(...stops[0]);
    for (const p of curve) assert.ok(Math.abs(Math.hypot(...p) - radius) < 1e-6, `${trail.trail}: a point of the curve left the sphere its cubie turns on`);
    // Drawn outside the stickers, where it can be seen: a trail lifted by a plain scale of its cubie's centre kept
    // a top-layer edge's path inside the cube, and a U permutation's whole trail drew hidden (found on the look sheet).
    assert.deepEqual(trail.lifted.filter((q) => Math.max(...q.map(Math.abs)) < 1.55), [], `${trail.trail}: part of the trail is inside the cube`);
  }
});

test('a slot names the piece standing in it where the sequence starts, and a word that is not one draws nothing', async () => {
  await build({ scramble: 'R', alg: "U R U'", trail: 'slot:UR' });
  const [bySlot] = await trails();
  // After the scramble `R`, the FR edge stands in UR: the trail is the FR edge's route over the sequence.
  const expected = (() => {
    const cube = new Cube(); cube.move('R');
    const id = cube.ep[EDGES.indexOf('UR')];
    const out = [slotVector('UR')];
    for (const move of ['U', 'R', "U'"]) {
      cube.move(move);
      const at = slotVector(EDGES[cube.ep.indexOf(id)]);
      if (at.join() !== out[out.length - 1].join()) out.push(at);
    }
    return out;
  })();
  assert.deepEqual(bySlot.stops, expected);
  await build({ alg: 'R', trail: 'layer:U' });
  assert.deepEqual(await trails(), [], 'a trail was drawn for a selector that names no single piece');
  await build({ alg: 'R', trail: 'piece:UF' });
  assert.deepEqual(await trails(), [], 'R does not move UF, and a trail was drawn');
});

test('a trail is drawn: the canvas changes when one is asked for', async () => {
  const shoot = () => page.evaluate(() => {
    const el = window.__cube;
    el._dirty = true; el._draw();
    const gl = el.renderer.getContext();
    const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px);
  });
  // The U permutation's three edges: the case whose trail drew entirely hidden before its lift was fixed.
  const uperm = "R U' R U R U R U' R' U' R2";
  await build({ alg: uperm });
  const plain = await shoot();
  await build({ alg: uperm, trail: 'piece:UF,piece:UL,piece:UR' });
  const traced = await shoot();
  const changed = plain.filter((v, i) => Math.abs(v - traced[i]) > 8).length;
  assert.ok(changed > 3000, `a U permutation's trails changed only ${changed} channel values — they are not being seen`);
});

test('a trail is fitted into the frame: every point it draws lands inside the canvas', async () => {
  // The commutator's corner loops below the cube; before the fit knew about trails it ran off the frame.
  for (const [alg, trail] of [["R U R' U'", 'piece:URF'], ["R U' R U R U R U' R' U' R2", 'piece:UF,piece:UL,piece:UR']]) {
    await build({ alg, trail });
    const outside = await page.evaluate(() => {
      const el = window.__cube;
      el.root.updateMatrixWorld(true);
      el.camera.updateMatrixWorld(true);
      const V = el.camera.position.constructor;
      return (el._trailMeshes ?? []).filter((m) => m.userData.lifted).flatMap((m) => m.userData.lifted)
        .map((q) => new V(...q).applyMatrix4(el.root.matrixWorld).project(el.camera))
        .filter((p) => Math.abs(p.x) > 1 || Math.abs(p.y) > 1).length;
    });
    assert.equal(outside, 0, `${trail} over "${alg}": ${outside} points of the trail are off the canvas`);
  }
});
