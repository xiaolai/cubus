// A whole-cube turn inside a sequence: the frame `<cubus-cube>` carries beside its pieces.
//
// dev-docs/tutorial-capability-plan.md item 2.2; dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md,
// decisions 7 and 8. A rotation, a slice or a wide move turns the whole cube, and the piece state cannot
// say so — its slots are named relative to the centres. So the element keeps a frame through the
// sequence: position 0 is identity (the hold there is `orientation`, on the root), a centre-moving move
// composes onto it as it lands, `stepBack` takes it off again, and `seek` rebuilds it from scratch.
//
// What would go wrong without each case: a played sequence and a sought one drawing different cubes (the
// frame advanced on one path and not the other); `orientation` written after `alg` composing on the wrong
// side of the frame; a scramble's rotation leaking into the hold; and ghosts, the back view or the fit
// reading the cube as upright when a turn inside the sequence has put it on its side.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { SOLVED_FACELETS, applyMoves, held } from '../cube-oracle.mjs';
import { BACKEND, CHANNEL_STEP, LAUNCH, TOLERANCE, compare, render } from './appearance-goldens.mjs';
import { readMatrices, readStickers, toWorld } from './drawn-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

/** Sequences with a turn of the whole cube before, between and after face turns. */
const SEQUENCES = ['y R', 'x y R', "M M'", 'U x'];

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

/** A fresh element with `attrs`, one frame in, on a pinned clock. */
const build = (attrs) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
  for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
  el.clock = 1_000_000;
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
}, attrs);

// AUTOROTATE IS A TURN, AND THE FIT DID NOT KNOW IT (audit, 2026-09-16). `_advanceSpin` rotates the root on
// every frame while the attribute is on, so the upright silhouette the `view` fit assumes is exactly what the
// cube is not — and the fit never re-ran, because spinning is not an event anything refits for. A ghost
// vertex reached 1.062 of the frame at elevation 9, 34 degrees in.
//
// Checked over a WHOLE REVOLUTION rather than at one angle: the defect is that some angles clip, so a single
// sample can pass a broken fit by landing on one that does not.
test('a spinning cube keeps every ghost on the canvas, at every angle of the turn', async () => {
  for (const elevation of ['4', '9']) {
    await build({ facelets: SOLVED_FACELETS, ghosts: 'on', 'ghost-elevation': elevation, autorotate: '' });
    const worst = await page.evaluate(async () => {
      const el = window.__cube;
      const V = el.camera.position.constructor;
      let out = 0;
      for (let deg = 0; deg < 360; deg += 2) {
        el._spin = (deg * Math.PI) / 180;
        el._applyRoot();
        el.root.updateMatrixWorld(true);
        el.camera.updateMatrixWorld(true);
        for (const g of el._ghostMeshes) {
          if (g.visible === false) continue;
          const pos = g.geometry.attributes.position;
          g.updateMatrixWorld(true);
          for (let i = 0; i < pos.count; i++) {
            const p = new V().fromBufferAttribute(pos, i).applyMatrix4(g.matrixWorld).project(el.camera);
            out = Math.max(out, Math.abs(p.x), Math.abs(p.y));
          }
        }
      }
      return Math.round(out * 10000) / 10000;
    });
    assert.ok(worst <= 1, `spinning at elevation ${elevation}: a ghost vertex reaches ${worst} of the frame`);
  }
  // And switching the spin OFF is an event the fit hears: neither state is an event the draw loop refits
  // for, so the attribute's reaction is what keeps the two in step.
  await build({ facelets: SOLVED_FACELETS, ghosts: 'on', 'ghost-elevation': '9', autorotate: '' });
  const spinning = await page.evaluate(() => window.__cube.camera.position.length());
  await page.evaluate(() => window.__cube.removeAttribute('autorotate'));
  const still = await page.evaluate(() => window.__cube.camera.position.length());
  assert.ok(still < spinning, `stopping the spin left the wide fit in place (${still} vs ${spinning})`);
});

// A SEEK IS NOT A NEW PICTURE (audit, 2026-09-16). `seek()` calls `reset()`, which rebuilt every trail and
// refitted the camera — so scrubbing rebuilt geometry, materials and a canvas texture per numeral to draw
// the identical trail, and snapped a hand-turned view back to the attributes' angle on every position.
test('seeking does not rebuild an unchanged trail, or throw away a hand-turned view', async () => {
  await build({ alg: "R U R' U'", trail: 'piece:URF' });
  const outcome = await page.evaluate(async () => {
    const el = window.__cube;
    const before = new Set(el._trailMeshes.map((m) => m.uuid));
    // A trail covers the WHOLE of `alg` from position 0, so the cursor is not one of its inputs.
    el.seek(2); el.seek(1); el.seek(3);
    const after = new Set(el._trailMeshes.map((m) => m.uuid));
    const kept = [...after].filter((id) => before.has(id)).length;

    // And a hand on the cube: move the camera the way a drag does, then seek.
    const V = el.camera.position.constructor;
    const turned = new V(1, 0.2, 0.3).normalize().multiplyScalar(el.camera.position.length());
    el.camera.position.copy(turned); el.camera.lookAt(0, 0, 0);
    el.seek(0);
    const drift = new V().copy(el.camera.position).normalize().angleTo(turned.clone().normalize());

    // ...but an explicit instruction still outranks the hand.
    el.setAttribute('camera-longitude', '200');
    const obeyed = new V().copy(el.camera.position).normalize().angleTo(turned.clone().normalize());
    return { before: before.size, kept, drift, obeyed };
  });
  assert.ok(outcome.before > 0, 'precondition: a trail was drawn');
  assert.equal(outcome.kept, outcome.before, `three seeks rebuilt the trail: ${outcome.kept} of ${outcome.before} meshes survived`);
  assert.ok(outcome.drift < 1e-3, `seeking moved a hand-turned view by ${outcome.drift.toFixed(4)} rad`);
  assert.ok(outcome.obeyed > 0.1, 'a new camera-longitude was ignored because the view had been orbited once');
});

// ...and changing something a trail IS a function of still redraws it, or the cache is a stale picture.
test('a trail is redrawn when anything it is drawn from changes', async () => {
  await build({ alg: "R U R' U'", trail: 'piece:URF' });
  for (const [attr, value] of [['trail-style', 'ribbon'], ['trail', 'piece:UF'], ['alg', "R U R' U' R U R' U'"]]) {
    const changed = await page.evaluate(async ([a, v]) => {
      const el = window.__cube;
      const before = new Set(el._trailMeshes.map((m) => m.uuid));
      el.setAttribute(a, v);
      await new Promise((r) => requestAnimationFrame(() => r()));
      return el._trailMeshes.filter((m) => !before.has(m.uuid)).length;
    }, [attr, value]);
    assert.ok(changed > 0, `changing \`${attr}\` left the old trail on screen`);
  }
});

/** Call `method` on the element with `args`. */
const call = (method, ...args) => page.evaluate(([m, a]) => window.__cube[m](...a), [method, args]);
const setAttr = (name, value) => page.evaluate(([n, v]) => window.__cube.setAttribute(n, v), [name, value]);

/** One animated move — `step` or `stepBack` — run to its end on the pinned clock, frame by frame. */
const animate = (method) => page.evaluate(async (m) => {
  const el = window.__cube;
  const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
  const done = new Promise((r) => el.addEventListener('cubus-step', r, { once: true }));
  el[m]();
  // Through the middle of the turn first, so the move is animated rather than completed by a drain.
  for (const ms of [60, 120, 180, 1000]) { el.clock = el._now() + ms; await tick(); }
  await done;
}, method);

const seekMatrices = async (k) => { await call('seek', k); return readMatrices(page); };

for (const alg of SEQUENCES) {
  test(`"${alg}": every position played, stepped back and sought draws the same cube`, async () => {
    const n = alg.split(' ').length;
    await build({ alg });
    const sought = [];
    for (let k = 0; k <= n; k++) sought.push(await seekMatrices(k));
    // A frame that never moved would make every position of a pure rotation look the same; a sequence
    // with a whole-cube turn in it must draw at least one position differently from the one before.
    assert.ok(sought.some((m, k) => k > 0 && JSON.stringify(m) !== JSON.stringify(sought[k - 1])), `"${alg}" drew no move at all`);

    await build({ alg });
    assert.deepEqual(await readMatrices(page), sought[0], `"${alg}" at load`);
    for (let k = 1; k <= n; k++) {
      await animate('step');
      assert.deepEqual(await readMatrices(page), sought[k], `"${alg}" played to ${k}`);
    }
    for (let k = n - 1; k >= 0; k--) {
      await animate('stepBack');
      assert.deepEqual(await readMatrices(page), sought[k], `"${alg}" stepped back to ${k}`);
    }
  });
}

test('a whole-cube turn in the sequence is drawn as the hold it leaves', async () => {
  // Checked on stickers against the oracle rather than on matrices against the element itself: `x`
  // leaves the cube held F D, `y` leaves it U R, and a frame composed on the wrong side, or turned the
  // wrong way, reads as a different hold. `alg` is IDENTITY-frame tokens, so a rotation after a rotation
  // turns about the cube's own axis: `y` after `x` is about the U face, now at the back, and leaves R D;
  // the child's "x then y" is the identity `x z` and leaves F R. Composed on the wrong side, the two swap.
  // A slice or a wide move turns the whole cube too, and leaves pieces relative to the centres as the face
  // turns it is made of: `M` is `R L'` held B U, `Rw` is `L` held F D (plan item 2.1's acceptance).
  const cases = [
    ['x', '', 'F D'], ['y', '', 'U R'], ["x'", '', 'B U'], ['z', '', 'L F'], ['x y', '', 'R D'], ['x z', '', 'F R'],
    ['M', "R L'", 'B U'], ['Rw', 'L', 'F D'], ['r', 'L', 'F D'],
  ];
  for (const [alg, pieces, hold] of cases) {
    await build({ alg });
    await call('seek', alg.split(' ').length);
    const expected = held(pieces ? applyMoves(SOLVED_FACELETS, pieces) : SOLVED_FACELETS, hold);
    assert.equal(toWorld(await readStickers(page)), expected, `"${alg}" should leave ${pieces || 'no pieces moved'}, held ${hold}`);
  }
});

test('orientation written before or after alg, or part way through it, gives the same matrices', async () => {
  const alg = 'x y R';
  await build({ orientation: 'R B', alg });
  const before2 = [];
  for (let k = 0; k <= 3; k++) before2.push(await seekMatrices(k));

  await build({ alg });
  await setAttr('orientation', 'R B');
  for (let k = 0; k <= 3; k++) assert.deepEqual(await seekMatrices(k), before2[k], `orientation after alg, position ${k}`);

  await build({ alg });
  await call('seek', 2);
  await setAttr('orientation', 'R B');
  assert.deepEqual(await readMatrices(page), before2[2], 'orientation written at position 2');
  await animate('step');
  assert.deepEqual(await readMatrices(page), before2[3], 'and played on from there');
});

test('a scramble moves pieces only: scramble="x" leaves the cube held as orientation says', async () => {
  await build({ orientation: 'R B' });
  const plain = await readMatrices(page);
  await build({ orientation: 'R B', scramble: 'x' });
  assert.deepEqual(await readMatrices(page), plain, 'a scramble of "x" turned the cube');
  // And the pieces a centre-moving scramble leaves are relative to the centres, not to the world.
  await build({ scramble: 'M' });
  const pieces = await readMatrices(page);
  await build({ scramble: "R L'" });
  assert.deepEqual(pieces, await readMatrices(page), 'scramble "M" should leave the pieces "R L\'" leaves');
  // A scramble's frame does not leak into the sequence played on top of it.
  await build({ scramble: 'y', alg: 'R' });
  await call('seek', 1);
  const onTop = await readMatrices(page);
  await build({ alg: 'R' });
  assert.deepEqual(onTop, await seekMatrices(1), 'scramble "y" changed how "R" is drawn');
});

test('a reset puts the frame back at identity', async () => {
  await build({ alg: 'x' });
  const upright = await readMatrices(page);
  await call('seek', 1);
  assert.notDeepEqual(await readMatrices(page), upright, '"x" did not turn the cube');
  await call('reset');
  assert.deepEqual(await readMatrices(page), upright, 'reset() kept the sequence\'s frame');
});

// A new alg puts the frame back with the cube. This said the opposite until 2026-09-16 — a replacement
// kept the pose the old sequence had reached — and that was the defect, not the rule: `seek(k)` replays
// from the cube `scramble`/`facelets` describes, so a sequence that started anywhere else made one
// position mean two cubes (Codex audit; the pieces are pinned in renderer-lifecycle.test.mjs). What is
// unchanged is the other half: the FIT follows the cube, turned or upright, rather than assuming either.
test('a new alg starts upright with its sequence, and the fit follows the cube', async () => {
  await build({ alg: 'x' });
  const upright = await readMatrices(page);
  await call('seek', 1);
  assert.notDeepEqual(await readMatrices(page), upright, '"x" did not turn the cube');
  assert.equal(await page.evaluate(() => window.__cube._turned()), true, 'a cube on its side was fitted as upright');
  await setAttr('alg', 'R');
  assert.deepEqual(await readMatrices(page), upright, 'replacing alg kept the old sequence\'s frame');
  assert.equal(await page.evaluate(() => window.__cube._turned()), false, 'an upright cube with a face-turn alg was fitted as turned');
  // And a sequence that turns the cube counts from the moment it loads, before any move has landed.
  await setAttr('alg', 'x');
  assert.equal(await page.evaluate(() => window.__cube._turned()), true, 'a sequence with a rotation in it was fitted as upright');
});

test('Chromium: after "x", ghosts, back views and lighting draw what orientation="F D" draws', async () => {
  const chromium = await startBrowserFixture({ engine: 'chromium', launch: LAUNCH });
  try {
    const cpage = await chromium.browser.newPage({ deviceScaleFactor: 1, viewport: { width: 400, height: 400 } });
    await cpage.goto(`${chromium.base}/index.html`);
    await cpage.waitForFunction(() => !!customElements.get('cubus-cube'));
    const scramble = "R U R' F2 D L'";
    const cases = [
      { name: 'plain', attrs: { scramble } },
      { name: 'ghosts', attrs: { scramble, ghosts: 'on', 'ghost-elevation': '4' } },
      { name: 'side-by-side', attrs: { scramble, ghosts: 'on', 'back-view': 'side-by-side' }, w: 320, h: 240 },
      { name: 'top-right', attrs: { scramble, 'back-view': 'top-right' }, w: 320, h: 240 },
    ];
    for (const c of cases) {
      const size = { w: c.w ?? 240, h: c.h ?? 240 };
      const turned = await render(cpage, { name: c.name, ...size, attrs: { ...c.attrs, alg: 'x' }, seek: 1 });
      // The reference counts as turned for the fit (it is held other than U F), and so does a sequence
      // with a rotation in it — so both are fitted by the same rule and the pictures can agree exactly.
      const heldFD = await render(cpage, { name: c.name, ...size, attrs: { ...c.attrs, orientation: 'F D' } });
      assert.match(turned.backend, BACKEND, `drawn by ${turned.backend}`);
      const upright = await render(cpage, { name: c.name, ...size, attrs: c.attrs });
      const result = compare({ width: heldFD.w, height: heldFD.h, rgba: heldFD.rgba }, turned);
      assert.ok(!result.sizeMismatch, result.sizeMismatch);
      assert.ok(result.changed <= TOLERANCE,
        `${c.name}: "x" drew ${result.changed} pixels more than ${CHANNEL_STEP} step from orientation="F D" (worst ${result.worst})`);
      // And the comparison can fail: the same cube not turned is a different picture.
      const control = compare({ width: upright.w, height: upright.h, rgba: upright.rgba }, turned);
      assert.ok(control.changed > 1000, `${c.name}: an upright cube matched a turned one (${control.changed} pixels) — the check cannot see a frame`);
    }
  } finally {
    await chromium.close();
  }
});
