// Every lifecycle transition of `<cubus-cube>` owns ALL of its state.
//
// Five defects found by three rounds of audit on 2026-09-14 turned out to be one mechanism: a
// transition that reset or released SOME of what it owned and left the rest standing. Replacing the
// alg kept the old alg's moves running; recycling reached attributes but not the values set through
// properties; disposing released the context but not the geometry, the materials or the closures
// that hold the old scene; building published "built" before the build had succeeded; and the frame
// loop went on using the element after a listener it had just called had torn it down.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

/** A fresh cube, one frame in, on a pinned clock. */
const build = (attrs = { facelets: SOLVED }) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
  for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
  el.clock = 1_000_000;
}, attrs);

// Replacing the alg used to reset the counters and leave the OLD alg's move in flight and its queue
// behind them: queue R and U, replace the alg with F, and R and U went on playing and reported
// themselves as steps 1 and 2 of an alg one move long.
test('replacing the alg calls off the old alg\'s moves, in flight and queued', async () => {
  await build();
  const outcome = await page.evaluate(async () => {
    const el = window.__cube;
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const steps = [];
    el.addEventListener('cubus-step', (e) => steps.push(`${e.detail.index}/${e.detail.total}`));
    el.setAttribute('alg', 'R U');
    el.clock = 1_000_000;
    el.step(); el.step();              // R in flight, U queued
    el.clock = 1_000_000 + 95;         // part way through R
    await tick();
    el.setAttribute('alg', 'F');       // a new walk
    const settled = el.cubies.every((c) => [c.position.x, c.position.y, c.position.z].every(Number.isInteger));
    el.clock = 1_000_000 + 10_000;     // long enough for anything left running to finish
    await tick(); await tick();
    return { steps, settled, anim: el._anim, queue: el._queue.length };
  });
  assert.deepEqual(outcome.steps, [], `the old alg's moves went on reporting: ${outcome.steps.join(', ')}`);
  assert.equal(outcome.anim, null, 'the old alg still has a move in flight');
  assert.equal(outcome.queue, 0, 'the old alg still has moves queued');
  assert.equal(outcome.settled, true, 'the cube was left part way through a move of the alg it no longer walks');
});

// `recycle()` removed every observed ATTRIBUTE — and a value set through a PROPERTY never became
// one, so it survived: a recycled cube came back with the last screen's palette, alg and scramble.
test('recycle clears what was set through properties, not only through attributes', async () => {
  await build();
  const outcome = await page.evaluate(async () => {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const el = window.__cube;
    const colours = () => el.stickers.map((m) => m.material.color.getHex()).join();
    el.recycle();
    await tick();
    const fresh = { colours: colours(), sol: el._sol.length, ghosts: el._attrs.ghosts };
    el.palette = 'colorsafe';
    el.scramble = "R U R'";
    el.alg = 'F2 L';
    el.ghosts = 'on';
    await tick();
    const dirty = colours();
    el.recycle();
    await tick();
    const solved = el.cubies.every((c) => c.quaternion.x === 0 && c.quaternion.y === 0 && c.quaternion.z === 0);
    return { fresh, dirty, after: { colours: colours(), sol: el._sol.length, ghosts: el._attrs.ghosts }, solved };
  });
  assert.notEqual(outcome.dirty, outcome.fresh.colours, 'precondition: the properties changed the picture');
  assert.deepEqual(outcome.after, outcome.fresh, 'a recycled cube kept values that were set through properties');
  assert.equal(outcome.solved, true, 'a recycled cube is still scrambled');
});

// `dispose()` released the WebGL context and nothing the scene owned: four geometries and 110
// materials were never disposed, and the element went on holding the old scene through `root`,
// `cubies`, `stickers` and the closures the frame loop and the resize observer capture.
test('dispose releases every geometry and material once, and lets go of the old scene', async () => {
  await build({ facelets: SOLVED, ghosts: 'on' });
  const outcome = await page.evaluate(() => {
    const el = window.__cube;
    const geometries = new Map();
    const materials = new Map();
    el.scene.traverse((o) => {
      if (o.geometry) geometries.set(o.geometry.uuid, o.geometry);
      for (const m of [o.material].flat().filter(Boolean)) materials.set(m.uuid, m);
    });
    const count = new Map();
    for (const r of [...geometries.values(), ...materials.values()]) {
      const real = r.dispose.bind(r);
      r.dispose = () => { count.set(r.uuid, (count.get(r.uuid) ?? 0) + 1); real(); };
    }
    el.dispose();
    const once = [...count.values()].every((n) => n === 1);
    return {
      geometries: geometries.size,
      materials: materials.size,
      disposed: count.size,
      once,
      held: ['root', 'cubies', 'stickers', '_tick', '_resize', '_ro', '_io'].filter((k) => el[k] != null),
    };
  });
  assert.equal(outcome.disposed, outcome.geometries + outcome.materials,
    `disposed ${outcome.disposed} of ${outcome.geometries} geometries and ${outcome.materials} materials`);
  assert.equal(outcome.once, true, 'a shared geometry or material was disposed more than once');
  assert.deepEqual(outcome.held, [], `a disposed cube still holds the old scene through ${outcome.held.join(', ')}`);
});

// Building published `this.scene` — the "already built" marker — before the WebGL context existed.
// A context that could not be created left a half-built element, and the next connect took the
// "already built" branch and threw on an observer that was never made.
test('a build that fails leaves nothing half-built, and the next connect builds cleanly', async () => {
  const outcome = await page.evaluate(async () => {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); window.__cube = null; }
    const real = HTMLCanvasElement.prototype.getContext;
    const errors = [];
    const onError = (e) => { errors.push(String(e.message ?? e)); e.preventDefault?.(); };
    window.addEventListener('error', onError);
    const el = document.createElement('cubus-cube');
    el.setAttribute('facelets', 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
    el.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
    HTMLCanvasElement.prototype.getContext = function () { return null; }; // no WebGL at all
    try {
      document.body.appendChild(el);
    } catch { /* reported through the error event, as a callback's throw is */ }
    HTMLCanvasElement.prototype.getContext = real;
    const failed = { scene: el.scene != null, canvases: el.querySelectorAll('canvas').length, errors: errors.length };
    el.remove();
    document.body.appendChild(el);      // the GPU is back: this connect has to build from scratch
    await tick();
    window.removeEventListener('error', onError);
    const ok = el.scene != null && el.renderer != null && el._running === true;
    el.dispose(); el.remove();
    return { failed, ok, laterErrors: errors.slice(failed.errors) };
  });
  assert.ok(outcome.failed.errors >= 1, 'precondition: the build without WebGL failed, and said so');
  assert.equal(outcome.failed.scene, false, 'a failed build published the element as built');
  assert.equal(outcome.failed.canvases, 0, 'a failed build left its canvas in the element');
  assert.deepEqual(outcome.laterErrors, [], `the connect after a failed build threw: ${outcome.laterErrors.join('; ')}`);
  assert.equal(outcome.ok, true, 'the connect after a failed build did not produce a working cube');
});

// A `cubus-step` listener is the host's code, and it may tear the element down — a screen that
// leaves when the walk ends does exactly that. The frame loop went on after dispatching and read
// the controls the listener had just released.
test('a step listener that disposes the cube does not break the frame it was called from', async () => {
  await build();
  const errors = await page.evaluate(async () => {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const el = window.__cube;
    const seen = [];
    const onError = (e) => { seen.push(String(e.message ?? e)); e.preventDefault?.(); };
    window.addEventListener('error', onError);
    el.addEventListener('cubus-step', () => el.dispose(), { once: true });
    el.setAttribute('alg', 'R');
    el.clock = 1_000_000;
    el.step();
    el.clock = 1_000_000 + 1000;         // the turn completes on the next frame, and the listener runs
    await tick(); await tick(); await tick();
    window.removeEventListener('error', onError);
    window.__cube = null;
    return seen;
  });
  assert.deepEqual(errors, [], `the frame went on after the cube was disposed: ${errors.join('; ')}`);
});

// ---- the camera and its light rig, measured against the right reference ----------------------

/** Read the drawn pixels and report which pane edges any ink touches. */
const edgeInk = (splitAt) => page.evaluate((split) => {
  const el = window.__cube;
  el._dirty = true;
  el._draw();
  const gl = el.renderer.getContext();
  const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const inkIn = (col) => { let n = 0; for (let y = 0; y < h; y++) if (px[(y * w + col) * 4 + 3] > 0) n++; return n; };
  const left = split ? Math.floor(w / 2) : w;
  return split
    ? { leftPaneOuter: inkIn(0), leftPaneInner: inkIn(left - 1), rightPaneInner: inkIn(left), rightPaneOuter: inkIn(w - 1) }
    : { outerLeft: inkIn(0), outerRight: inkIn(w - 1) };
}, splitAt);

// Side-by-side halves the drawing aspect, but the distance was fitted to the FULL width and a
// `back-view` change never refitted it: at 320x240 the cube ran past both edges of its pane.
test('a side-by-side cube fits inside each pane, and refits when the split comes and goes', async () => {
  await page.evaluate(async () => {
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px';
    el.setAttribute('scramble', "F R U");
    el.setAttribute('ghosts', 'on');
    document.body.appendChild(el);
    window.__cube = el;
    await new Promise((r) => requestAnimationFrame(() => r()));
  });
  const whole = await edgeInk(false);
  assert.deepEqual(whole, { outerLeft: 0, outerRight: 0 }, 'precondition: the whole view fits');
  await page.evaluate(() => window.__cube.setAttribute('back-view', 'side-by-side'));
  const split = await edgeInk(true);
  assert.deepEqual(split, { leftPaneOuter: 0, leftPaneInner: 0, rightPaneInner: 0, rightPaneOuter: 0 },
    `the split view runs off its panes: ${JSON.stringify(split)}`);
  await page.evaluate(() => window.__cube.setAttribute('back-view', 'none'));
  const back = await page.evaluate(() => window.__cube.camera.position.length());
  await page.evaluate(() => window.__cube.setAttribute('back-view', 'side-by-side'));
  const splitDistance = await page.evaluate(() => window.__cube.camera.position.length());
  assert.ok(splitDistance > back, `a narrower pane must stand further back: ${splitDistance} vs ${back}`);
});

// The light rig keeps each light's direction relative to the camera, taken from the view the look
// was tuned under. It was taken from the camera AS CONFIGURED at build time instead, so the same
// final attributes lit the cube two ways depending on whether they were set before connecting.
test('the light rig is the same whether the camera was set before the cube connected or after', async () => {
  const rigs = await page.evaluate(async () => {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const make = async (before) => {
      const el = document.createElement('cubus-cube');
      el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px';
      el.setAttribute('facelets', 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
      const cam = { 'camera-up': 'D', 'camera-latitude': '10', 'camera-longitude': '120' };
      if (before) for (const [k, v] of Object.entries(cam)) el.setAttribute(k, v);
      document.body.appendChild(el);
      await tick();
      if (!before) for (const [k, v] of Object.entries(cam)) el.setAttribute(k, v);
      await tick();
      const out = el._lights.map(([light]) => [light.position.x, light.position.y, light.position.z]
        .map((v) => Math.round(v * 1e6) / 1e6 + 0));
      el.dispose(); el.remove();
      return out;
    };
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); window.__cube = null; }
    return { before: await make(true), after: await make(false) };
  });
  assert.deepEqual(rigs.before, rigs.after, 'the same camera lit the cube differently depending on when it was set');
});
