// Face letters on the cube — plan item 4.3 of dev-docs/tutorial-capability-plan.md.
//
// ONE SENTENCE, and it is about the PLACE (owner's call, 2026-09-16, reversing his own earlier one): however
// the cube is turned, the face toward you is F, the one on top is U, the one on the right is R. So the whole
// content of this feature is that the letters DO NOT MOVE, and the cases below turn the cube every way there
// is and demand the same six letters in the same six places.
//
// A `face` mode used to sit beside it — a letter riding its own centre, so a regrip carried U underneath —
// and its removal is checked here too: it is a word the element does not know any more. Removed rather than
// left unapproved because it says the opposite of the rule above, and a mode that contradicts the lesson is
// a trap for whoever writes the next one.
//
// How the letters LOOK is still the owner's to approve before a golden holds them.
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

/**
 * Each letter: the world direction it stands in, and how far its plane is from facing the camera squarely.
 *
 * READ AFTER A DRAW, not after a frame: the letters are turned to the camera by `_faceCamera`, which runs
 * inside `_draw`. Reading between the mount and the first draw would measure the orientation they were built
 * with, which is nobody's claim.
 */
const letters = () => page.evaluate(() => {
  const el = window.__cube;
  el._dirty = true; el._draw();
  el.scene.updateMatrixWorld(true);
  const V = el.camera.position.constructor;
  const Q = el.camera.quaternion.constructor;
  const out = {};
  for (const mesh of el._labelMeshes ?? []) {
    const at = mesh.getWorldPosition(new V());
    const round = (v) => [v.x, v.y, v.z].map((c) => Math.round(c) + 0);
    // `+ 0`, because a rounding compared against another number must not keep a -0 (app-source's guard).
    const raw = (v) => [v.x, v.y, v.z].map((c) => Math.round(c * 1000) / 1000 + 0);
    out[mesh.userData.label] = {
      at: round(at.clone().normalize()),
      // Which way the letter's own plane points, in the world. A letter is PAINTED on its face, so this is
      // the face's own outward direction — not the camera's, which is what a billboard would give.
      facing: round(new V(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new Q()))),
      // And which way its TOP points. `facing` alone cannot tell two letters in the same plane apart when
      // one is turned within it — which is the defect a ghost's letter had, twice, with `facing` right.
      up: round(new V(0, 1, 0).applyQuaternion(mesh.getWorldQuaternion(new Q()))),
      // Both again, UNROUNDED. `round` makes whole numbers, so a letter tilted by anything under 45 degrees
      // rounds to exactly the axis it leans off: a check made on `facing` or `up` passes a 29-degree tilt,
      // and did, when this suite was first run against one on purpose.
      facingRaw: raw(new V(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new Q()))),
      upRaw: raw(new V(0, 1, 0).applyQuaternion(mesh.getWorldQuaternion(new Q()))),
      // And how far out it sits. The stickers' surface is at 1.5: a letter on the centre sticker is a hair
      // above it, and one FLOATING off the cube is the defect this number exists to catch.
      lift: Math.round(at.length() * 1000) / 1000,
    };
  }
  return out;
});
const WORLD = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };

/**
 * The ghosts as DRAWN, a face at a time: how far out they stand, and whether they are showing.
 *
 * TWO distances, because they are not the same number. `lift` is the offset each ghost is placed at past its
 * own CUBIE (`_ghostLift`). `plane` is where that puts the face's ghost grid in the world, one lattice step
 * further from the middle — and that is the plane a face's letter is put on (`_ghostPlaneLift`), so that it
 * lands on the grid's centre rather than one step short of it. Read off the meshes rather than computed
 * again: where the letters go is a claim about the ghosts that are there, and recomputing the elevation here
 * would pass even if the two had drifted apart.
 *
 * Asked of a SOLVED cube: a ghost travels with its cubie, so on a turned cube a face's twins are scattered
 * among the cubies that now hold its stickers and "that face's plane" names nothing.
 */
const ghostPlanes = () => page.evaluate(() => {
  const el = window.__cube;
  el._dirty = true; el._draw();
  el.scene.updateMatrixWorld(true);
  const V = el.camera.position.constructor;
  const NORMALS = { R: [1, 0, 0], L: [-1, 0, 0], U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1] };
  const round = (v) => Math.round(v * 1000) / 1000;
  const out = {};
  for (const g of el._ghostMeshes ?? []) {
    const n = g.userData.n;
    const key = Object.keys(NORMALS).find((k) => NORMALS[k].every((c, i) => Math.abs(n[i] - c) < 0.01));
    if (!key) continue;
    const at = g.getWorldPosition(new V());
    const plane = round(at.x * n[0] + at.y * n[1] + at.z * n[2]);
    const lift = round(g.position.x * n[0] + g.position.y * n[1] + g.position.z * n[2]);
    const seen = out[key] ??= { plane, lift, shown: false, twins: 0 };
    seen.twins += 1;
    if (g.visible) seen.shown = true;
    // One face, one plane and one offset: anything else is the defect, and NaN fails every comparison below.
    if (plane !== seen.plane) seen.plane = Number.NaN;
    if (lift !== seen.lift) seen.lift = Number.NaN;
  }
  return out;
});

/** Where the camera is, as a direction — which decides the faces that are turned away. */
const eye = () => page.evaluate(() => {
  const el = window.__cube;
  const at = el.camera.position.clone().normalize();
  return [at.x, at.y, at.z].map((c) => Math.round(c * 100) / 100 + 0);
});

test('position letters name the places: held any way, the face on top is U', async () => {
  for (const orientation of ['U F', 'D B', 'R F']) {
    await build({ labels: 'position', orientation });
    const drawn = await letters();
    assert.equal(Object.keys(drawn).length, 6, 'six letters');
    for (const [letter, dir] of Object.entries(WORLD)) {
      assert.deepEqual(drawn[letter].at, dir, `held ${orientation}, ${letter} is not on its place`);
      // PAINTED ON THE FACE: lying in its plane and pointing out of it, not turned to the camera.
      assert.deepEqual(drawn[letter].facing, dir, `held ${orientation}, ${letter} does not lie in its face`);
      // And ON the centre sticker, whose surface is at 1.5 — a letter at 1.62 floats off the cube, which is
      // what this looked like for the hours between one instruction and its correction.
      assert.ok(drawn[letter].lift > 1.5 && drawn[letter].lift < 1.56,
        `held ${orientation}, ${letter} sits at ${drawn[letter].lift}, not on its sticker`);
    }
  }
});

test('a regrip inside a sequence does not move them either', async () => {
  // The case that used to prove `face` letters TRAVEL, turned round: `x` is a regrip in the middle of a
  // sequence, and the place called U is still the top of the screen after it. A letter parented to the cube
  // rather than to the scene fails here and nowhere else in this file.
  await build({ labels: 'position', alg: 'x' });
  await page.evaluate(() => window.__publicCube(window.__cube).seek(1));
  const turned = await letters();
  for (const [letter, dir] of Object.entries(WORLD)) {
    assert.deepEqual(turned[letter].at, dir, `after x, ${letter} moved off its place`);
  }
  // Turned on AFTER the regrip, they land in the same places — the letters are not computed from the cube.
  await build({ alg: 'x' });
  await page.evaluate(() => window.__publicCube(window.__cube).seek(1));
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('labels', 'position'));
  const late = await letters();
  assert.deepEqual(late, turned, 'letters turned on after the regrip landed somewhere else');
});

test('face is not a mode any more: it draws nothing, like any other word', async () => {
  await build({ labels: 'face' });
  assert.deepEqual(await letters(), {}, '`face` still draws letters');
  await build({ labels: 'face', orientation: 'D B' });
  assert.deepEqual(await letters(), {}, '`face` still draws letters under a regrip');
});

test('letters come and go with the attribute, and a word that is not a mode draws none', async () => {
  await build({ labels: 'position' });
  assert.equal(Object.keys(await letters()).length, 6);
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('labels', 'none'));
  assert.deepEqual(await letters(), {}, 'letters were left standing after they were turned off');
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('labels', 'everywhere'));
  assert.deepEqual(await letters(), {});
  // Recycled, an element has no letters: `labels` goes back to its default with every other attribute.
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('labels', 'position'));
  await page.evaluate(() => window.__publicCube(window.__cube).recycle());
  assert.deepEqual(await letters(), {}, 'a recycled cube kept the last screen\'s letters');
});

// The constants are checked in `test/annotation-inks.test.mjs`; this checks the PLATE IS ACTUALLY THERE, by
// reading the texture each letter is drawn from and measuring the contrast inside it. The two halves can
// come apart — a plate colour that is never painted is exactly as readable as no plate — and the failure
// would be invisible on any palette whose stickers happen to be light.
test('a letter is written on a light plate, and the contrast is measured in the texture itself', async () => {
  await build({ labels: 'position', palette: 'colorsafe' });
  const seen = await page.evaluate(() => {
    const lum = (r, g, b) => {
      const f = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    return window.__cube._labelMeshes.map((mesh) => {
      const canvas = mesh.material.map.image;
      const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const lit = []; let opaque = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) continue;          // the transparent margin outside the plate
        opaque++;
        lit.push(lum(px[i], px[i + 1], px[i + 2]));
      }
      lit.sort((a, b) => a - b);
      const at = (q) => lit[Math.floor((lit.length - 1) * q)];
      return { letter: mesh.userData.label, covered: opaque / (canvas.width * canvas.height), dark: at(0.02), light: at(0.98) };
    });
  });
  assert.equal(seen.length, 6, 'six letters');
  for (const { letter, covered, dark, light } of seen) {
    // The plate covers most of the texture, so the glyph sits ON it rather than on the sticker beside it.
    assert.ok(covered > 0.5, `${letter}: its plate covers ${(covered * 100).toFixed(0)}% of the texture`);
    const ratio = (light + 0.05) / (dark + 0.05);
    assert.ok(ratio >= 4.5, `${letter}: the glyph is ${ratio.toFixed(1)}:1 against its own plate`);
  }
  // The texture does not depend on the palette, which is what makes ONE measurement cover every sticker: a
  // letter drawn per-sticker would need eighteen, and the worst of those was 1.5:1.
  const colorsafe = seen.map((s) => [s.dark, s.light].map((v) => Math.round(v * 1e6) + 0).join());
  await build({ labels: 'position', palette: 'classic' });
  const classic = await page.evaluate(() => window.__cube._labelMeshes.map((mesh) => {
    const canvas = mesh.material.map.image;
    const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const lum = (r, g, b) => {
      const f = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const lit = [];
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] >= 200) lit.push(lum(px[i], px[i + 1], px[i + 2]));
    lit.sort((a, b) => a - b);
    const at = (q) => lit[Math.floor((lit.length - 1) * q)];
    return [at(0.02), at(0.98)].map((v) => Math.round(v * 1e6) + 0).join();
  }));
  assert.deepEqual(classic, colorsafe, 'the letters are drawn differently under a different palette');
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

// Ghosts and letters together (2026-09-21). A letter is painted on the centre sticker — and with ghosts on,
// the three faces you cannot see are drawn as floating planes instead, so a letter left on the sticker is
// INSIDE the cube: drawn, and invisible. Which is the whole job `labels` has, naming all six faces at once.

/** Is `a` the same direction as `b`, to within a rounding step? */
const sameWay = (a, b) => a.every((c, i) => Math.abs(c - b[i]) < 0.2);

const SOLVED = `${'U'.repeat(9)}${'R'.repeat(9)}${'F'.repeat(9)}${'D'.repeat(9)}${'L'.repeat(9)}${'B'.repeat(9)}`;

/** Which faces the element draws as ghosts for a camera at `at` — its own rule, and the letters follow it. */
const turnedAwayFrom = (at) => Object.keys(WORLD).filter((k) => WORLD[k][0] * at[0] + WORLD[k][1] * at[1] + WORLD[k][2] * at[2] < -0.15);

const OPPOSITE = { F: 'B', B: 'F', R: 'L', L: 'R', U: 'D', D: 'U' };

test('with ghosts on, the letter of a face you cannot see is lifted clear of the cube and turned to be read', async () => {
  await build({ labels: 'position', ghosts: 'all', facelets: SOLVED });
  const [letter, ghost, at] = [await letters(), await ghostPlanes(), await eye()];
  const away = turnedAwayFrom(at);
  assert.ok(away.length >= 1 && away.length < 6, `expected some faces turned away, got ${away.join('') || 'none'}`);
  for (const [key, l] of Object.entries(letter)) {
    if (away.includes(key)) {
      // Drawn where it can be SEEN. Left on the sticker it was inside the cube: drawn, and invisible — which
      // defeats the one job `labels` has, naming all six faces at once.
      assert.equal(ghost[key]?.shown, true, `${key} is turned away and has no ghost drawn to carry its letter`);
      assert.ok(l.lift > 1.6, `${key} is turned away and its letter is still on the sticker, at ${l.lift}`);
      // ON the plane that face's ghost grid stands on, exactly — one piece of arithmetic for both, and a
      // letter placed at the ghosts' own offset instead would land a step short, inside the grid's near edge.
      assert.equal(l.lift, ghost[key].plane, `${key}'s letter is at ${l.lift}, its ghost grid at ${ghost[key].plane}`);
      // Written the way its OPPOSITE face's letter is — B as F, L as R, D as U (owner's call, 2026-09-22):
      // a ghost is seen from the side its opposite face is seen from. The opposite face is always on show
      // when this one is turned away, so its letter is on its sticker, and it is read off the cube rather
      // than out of a table that could drift from LABEL_TURN.
      //
      // BOTH axes. An earlier version turned each ghost letter to the camera; a later one kept the plane
      // and laid the reader's up into it. Each had this letter's `facing` right, and each was wrong on
      // screen — it is the TOP, turned within the plane, that a person reads as crooked.
      const ref = letter[OPPOSITE[key]];
      assert.ok(sameWay(l.facingRaw, ref.facingRaw), `${key} is out on a ghost and should face as ${OPPOSITE[key]} does (${ref.facingRaw}), not ${l.facingRaw}`);
      assert.ok(sameWay(l.upRaw, ref.upRaw), `${key}'s letter should stand as ${OPPOSITE[key]}'s does, top towards ${ref.upRaw}, not ${l.upRaw}`);
    } else {
      assert.ok(Math.abs(l.lift - 1.513) < 0.01, `${key} is on show, so its letter belongs on the sticker, not at ${l.lift}`);
      assert.ok(sameWay(l.facing, WORLD[key]), `${key} is on its sticker and should lie in that face's plane: facing ${l.facing}`);
    }
  }
});

test('a lifted letter moves with the ghosts, step for step, and comes back to the sticker when they go', async () => {
  await build({ labels: 'position', ghosts: 'all', facelets: SOLVED });
  const [near, nearGhost, at] = [await letters(), await ghostPlanes(), await eye()];
  const away = turnedAwayFrom(at);
  assert.ok(away.length, 'precondition: some face is turned away');
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('ghost-elevation', '9'));
  const [far, farGhost] = [await letters(), await ghostPlanes()];
  for (const key of away) {
    const ghostStep = Math.round((farGhost[key].plane - nearGhost[key].plane) * 1000) / 1000 + 0;
    const letterStep = Math.round((far[key].lift - near[key].lift) * 1000) / 1000 + 0;
    assert.ok(ghostStep > 1, `precondition: elevation 9 moved ${key}'s ghosts out by ${ghostStep}`);
    assert.equal(letterStep, ghostStep, `${key}'s letter moved ${letterStep} while its ghosts moved ${ghostStep}`);
  }
  // And back: with the ghosts gone, every letter is on its own sticker again, in that face's plane.
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('ghosts', 'none'));
  const home = await letters();
  for (const [key, l] of Object.entries(home)) {
    assert.ok(Math.abs(l.lift - 1.513) < 0.01, `${key} stayed out at ${l.lift} after the ghosts went`);
    assert.ok(sameWay(l.facing, WORLD[key]), `${key} kept the turn it had on its ghost: facing ${l.facing}`);
  }
});
