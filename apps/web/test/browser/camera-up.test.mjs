// `camera-up` — which face of the world ends up at the top of the frame.
//
// Latitude and longitude place the EYE and leave the roll fixed at world +Y. That is right for
// every ordinary view and wrong for exactly one thing: showing a cube that is being held upside
// down. A course that tells a child to turn their cube over has to be able to draw that, and
// moving the eye below the equator without also turning the up vector renders the picture
// vertically mirrored — which is worse than not moving the camera at all, because it looks
// deliberate. (cubus-im carried that defect for six lessons before anybody noticed the finished
// layer was on the wrong side of the screen.)
//
// So these tests are about what is DRAWN, not about the attribute coming back out again: a known
// world point is projected through the real camera and its side of the frame is asserted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

import { freePort } from '../free-port.mjs';

const SERVE = fileURLToPath(new URL('../../serve.mjs', import.meta.url));
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
let proc; let browser; let base; let ctx;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), CUBUS_LIVE_RELOAD: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`serve.mjs did not start within 20s. It said: ${said.trim() || '(nothing)'}`)),
      20_000,
    );
    const note = (d) => { said += d.toString(); if (said.includes(`:${port}`)) { clearTimeout(timeout); resolve(); } };
    proc.stdout.on('data', note);
    proc.stderr.on('data', (d) => { said += d.toString(); });
    proc.on('error', reject);
  });
  try {
    browser = await webkit.launch();
  } catch (cause) {
    throw new Error('WebKit for Playwright is not installed — run: pnpm --filter cubus-web exec playwright install webkit', { cause });
  }
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  ctx = { page, warnings };
});

after(async () => {
  await browser?.close();
  proc?.kill('SIGTERM');
});

/** A fresh element on the shared page. One WebGL context at a time — WebKit caps how many live. */
async function cube(attrs = {}) {
  ctx.warnings.length = 0;
  await ctx.page.evaluate((a) => {
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
    el.setAttribute('facelets', a.facelets);
    for (const [k, v] of Object.entries(a.attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    window.__cube = el;
  }, { facelets: SOLVED, attrs });
  return ctx.page;
}

/** Where a world point lands in the frame: normalised device coordinates, y up. */
const project = (page, p) => page.evaluate(([x, y, z]) => {
  const c = window.__cube.camera;
  const v = new (Object.getPrototypeOf(c.position).constructor)(x, y, z);
  v.project(c);
  return { x: +v.x.toFixed(4), y: +v.y.toFixed(4) };
}, p);

const cameraUp = (page) => page.evaluate(() => {
  const u = window.__cube.camera.up;
  return [u.x, u.y, u.z].map((n) => Math.round(n));
});

test('by default the world\'s up is the frame\'s up, and the U face is drawn above the middle', async () => {
  const page = await cube();
  assert.deepEqual(await cameraUp(page), [0, 1, 0]);
  const u = await project(page, [0, 1, 0]);
  const d = await project(page, [0, -1, 0]);
  assert.ok(u.y > 0, `the U centre should be in the top half, was y=${u.y}`);
  assert.ok(d.y < 0, `the D centre should be in the bottom half, was y=${d.y}`);
});

test('camera-up="D" turns the picture over: the U face is drawn BELOW the middle', async () => {
  const page = await cube({ 'camera-up': 'D' });
  assert.deepEqual(await cameraUp(page), [0, -1, 0]);
  const u = await project(page, [0, 1, 0]);
  const d = await project(page, [0, -1, 0]);
  assert.ok(u.y < 0, `held over, the U centre belongs in the bottom half, was y=${u.y}`);
  assert.ok(d.y > 0, `held over, the D centre belongs in the top half, was y=${d.y}`);
});

test('turning it over mirrors the frame rather than moving the subject', async () => {
  // Same eye, opposite roll: every point must land at exactly minus its old coordinates, and the
  // cube must not change apparent size. Getting the eye right and the roll wrong looks almost
  // like this and is not this, which is why both halves are asserted.
  const probes = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 1, 1]];
  const page = await cube({ 'camera-latitude': '35', 'camera-longitude': '45' });
  const before = [];
  for (const p of probes) before.push(await project(page, p));
  const dist = await page.evaluate(() => +window.__cube.camera.position.length().toFixed(4));

  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
  const after = [];
  for (const p of probes) after.push(await project(page, p));
  const dist2 = await page.evaluate(() => +window.__cube.camera.position.length().toFixed(4));

  for (const [i, p] of probes.entries()) {
    assert.ok(Math.abs(after[i].x + before[i].x) < 1e-3, `${p} x should mirror: ${before[i].x} -> ${after[i].x}`);
    assert.ok(Math.abs(after[i].y + before[i].y) < 1e-3, `${p} y should mirror: ${before[i].y} -> ${after[i].y}`);
  }
  assert.equal(dist2, dist, 'the fit must not change — a 180 degree roll cannot alter what fits');
});

test('the orbit controls end up in the same frame as the renderer', async () => {
  // OrbitControls builds the quaternion mapping `object.up` onto +Y once, in its CONSTRUCTOR
  // (three r185, OrbitControls.js ~line 406). If nothing rebuilt it, dragging would orbit in the
  // old frame while the renderer drew in the new one — up would move the cube down. This test
  // also pins the private field's name, so a three upgrade that renames it fails here rather than
  // silently restoring the bug.
  const page = await cube({ 'camera-up': 'D' });
  const state = await page.evaluate(() => {
    const c = window.__cube.controls;
    if (!c || !c._quat) return { missing: true };
    const V = Object.getPrototypeOf(window.__cube.camera.position).constructor;
    const mapped = new V(c.object.up.x, c.object.up.y, c.object.up.z).applyQuaternion(c._quat);
    return { missing: false, mapped: [mapped.x, mapped.y, mapped.z].map((n) => +n.toFixed(4)) };
  });
  assert.equal(state.missing, false, 'OrbitControls no longer exposes _quat — the up fix needs re-plumbing');
  assert.deepEqual(state.mapped, [0, 1, 0], 'the controls must map the CURRENT up onto +Y');
});

test('every face letter is accepted, and anything else is refused out loud', async () => {
  for (const [face, want] of [['U', [0, 1, 0]], ['D', [0, -1, 0]], ['R', [1, 0, 0]],
                              ['L', [-1, 0, 0]], ['F', [0, 0, 1]], ['B', [0, 0, -1]]]) {
    const page = await cube({ 'camera-up': face });
    assert.deepEqual(await cameraUp(page), want, `camera-up="${face}"`);
    assert.equal(ctx.warnings.length, 0, `camera-up="${face}" should not warn`);
  }
  for (const bad of ['X', 'up', 'UD', '', '0 1 0']) {
    const page = await cube({ 'camera-up': bad });
    assert.deepEqual(await cameraUp(page), [0, 1, 0], `camera-up="${bad}" must fall back to world up`);
    assert.ok(ctx.warnings.some((w) => w.includes('camera-up')),
      `camera-up="${bad}" must say so — a silently rolled camera looks exactly like a correct one`);
  }
});

test('the eye still lands where latitude and longitude ask, whatever the roll', async () => {
  // The roll must not move the camera. If it did, `camera-up` would be a second way to say
  // "look from somewhere else", and the two would fight.
  const page = await cube({ 'camera-latitude': '-30', 'camera-longitude': '135' });
  const a = await page.evaluate(() => window.__cube.camera.position.toArray().map((n) => +n.toFixed(4)));
  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
  const b = await page.evaluate(() => window.__cube.camera.position.toArray().map((n) => +n.toFixed(4)));
  assert.deepEqual(b, a, 'the eye position is decided by latitude and longitude alone');
});
