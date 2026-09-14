// `camera-up` — which face of the world ends up at the top of the frame.
//
// Latitude and longitude place the EYE and leave the roll fixed at world +Y. That is right for
// every ordinary view and wrong for exactly one thing: showing a cube that is being held upside
// down. Moving the eye below the equator without also turning the up vector renders the picture
// vertically mirrored — which is worse than not moving the camera at all, because it looks
// deliberate. (cubus-im carried that defect for six lessons before anybody noticed the finished
// layer was on the wrong side of the screen.)
//
// Every test here has been checked to FAIL when the feature is removed. That is not decoration:
// the first version of this file had three tests that passed with `camera-up` fully reverted, and
// none that noticed if `worldUp` never reached the distance fit.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { eyeDirection, fitDistance, fitDistanceStable, silhouette } from '../../lib/cube-frame.js';
import { startBrowserFixture } from './harness.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
let fixture; let ctx;

before(async () => {
  fixture = await startBrowserFixture();
  const page = await fixture.browser.newPage({ reducedMotion: 'reduce' });
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  ctx = { page };
});

after(async () => { await fixture?.close(); });

/**
 * A fresh element on the shared page, sized as asked.
 *
 * The previous one is disposed AND awaited off the DOM before the next is built: WebKit caps how
 * many WebGL contexts a document may hold, and a still-connected element keeps refitting (and so
 * keeps warning) while the next test is setting up.
 */
async function cube({ w = 240, h = 240, ...attrs } = {}) {
  await ctx.page.evaluate((a) => {
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = `position:fixed;left:0;top:0;width:${a.w}px;height:${a.h}px;z-index:99999`;
    el.setAttribute('facelets', a.facelets);
    for (const [k, v] of Object.entries(a.attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    window.__cube = el;
  }, { w, h, facelets: SOLVED, attrs });
  return ctx.page;
}

/** Run `fn` in the page with console.warn captured, and return [result, warnings]. */
const withWarnings = (page, fn, arg) => page.evaluate(([body, a]) => {
  const said = [];
  const real = console.warn;
  console.warn = (...m) => { said.push(m.join(' ')); };
  try { return [new Function('arg', body)(a), said]; } finally { console.warn = real; }
}, [fn, arg]);

/** Where a world point lands in the frame: normalised device coordinates, y up. */
const project = (page, p) => page.evaluate(([x, y, z]) => {
  const c = window.__cube.camera;
  const v = new (Object.getPrototypeOf(c.position).constructor)(x, y, z);
  v.project(c);
  return { x: +v.x.toFixed(4) + 0, y: +v.y.toFixed(4) + 0 };
}, p);

const cameraUp = (page) => page.evaluate(() => {
  const u = window.__cube.camera.up;
  return [u.x, u.y, u.z].map((n) => Math.round(n) + 0);
});

/** The eye direction, normalised — where latitude and longitude actually put the camera. */
const eye = (page) => page.evaluate(() => {
  const p = window.__cube.camera.position.clone().normalize();
  return [p.x, p.y, p.z].map((n) => +n.toFixed(4) + 0);
});

/** What the element actually fitted to, and everything needed to recompute it independently. */
const fitInputs = (page) => page.evaluate(() => {
  const el = window.__cube, c = el.camera;
  return {
    d: c.position.length(),
    fov: c.fov,
    aspect: c.aspect,
    lat: Number(el.getAttribute('camera-latitude') ?? 35),
    lon: Number(el.getAttribute('camera-longitude') ?? 45),
    scale: Number(el.getAttribute('facelet-scale') ?? 0.9),
  };
});

/** The distance `fitDistance` gives for those inputs under a chosen roll, computed HERE from the
 *  module — so the browser's answer is checked against something the browser did not produce. */
function expectedFit({ fov, aspect, lat, lon, scale }, worldUp) {
  const eye = eyeDirection(lat, lon);
  return fitDistance({
    points: silhouette({ eye, elevation: null, scale, cull: true }),
    vfovDeg: fov, aspect, eye, worldUp,
  });
}
const FACE_VEC = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };

test('by default the world\'s up is the frame\'s up, and the U face is drawn above the middle', async () => {
  const page = await cube();
  assert.deepEqual(await cameraUp(page), [0, 1, 0]);
  assert.ok((await project(page, [0, 1, 0])).y > 0, 'the U centre belongs in the top half');
  assert.ok((await project(page, [0, -1, 0])).y < 0, 'the D centre belongs in the bottom half');
});

test('camera-up="D" turns the picture over: the U face is drawn BELOW the middle', async () => {
  const page = await cube({ 'camera-up': 'D' });
  assert.deepEqual(await cameraUp(page), [0, -1, 0]);
  assert.ok((await project(page, [0, 1, 0])).y < 0, 'held over, the U centre belongs in the bottom half');
  assert.ok((await project(page, [0, -1, 0])).y > 0, 'held over, the D centre belongs in the top half');
});

test('turning it over mirrors the frame rather than moving the subject', async () => {
  const probes = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [1, 1, 1]];
  const page = await cube({ 'camera-latitude': '35', 'camera-longitude': '45' });
  const before = [];
  for (const p of probes) before.push(await project(page, p));
  const dist = await page.evaluate(() => +window.__cube.camera.position.length().toFixed(4) + 0);

  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
  const after = [];
  for (const p of probes) after.push(await project(page, p));
  const dist2 = await page.evaluate(() => +window.__cube.camera.position.length().toFixed(4) + 0);

  for (const [i, p] of probes.entries()) {
    assert.ok(Math.abs(after[i].x + before[i].x) < 1e-3, `${p} x should mirror: ${before[i].x} -> ${after[i].x}`);
    assert.ok(Math.abs(after[i].y + before[i].y) < 1e-3, `${p} y should mirror: ${before[i].y} -> ${after[i].y}`);
  }
  assert.equal(dist2, dist, 'the fit must not change — a half turn cannot alter what fits');
});

test('the roll reaches the distance fit — checked by value, where the roll matters', async () => {
  // The one test that notices whether `worldUp` reaches `_applyCamera`'s geometry at all. Its
  // predecessor projected sticker CENTRES and asserted they were on screen, which the fit never
  // promised — it bounds the silhouette, not the mesh centres — so it read 1.27 for every roll
  // including the default and proved nothing about any of them.
  //
  // This recomputes the fit here, from the module, for the roll the element was given AND for the
  // default, then requires the element to match the first and not the second. Dropping `worldUp`
  // from the element's `geom` makes it match the second, and this fails.
  for (const [w, h] of [[200, 460], [520, 200]]) {
    for (const up of ['R', 'L', 'F', 'B']) {
      const page = await cube({ w, h, 'camera-up': up });
      const got = await fitInputs(page);
      const rolled = expectedFit(got, FACE_VEC[up]);
      const upright = expectedFit(got, FACE_VEC.U);
      assert.ok(Math.abs(rolled - upright) > 1e-6,
        `${w}x${h} up=${up}: this fixture cannot detect anything — rolled and upright fits agree`);
      assert.ok(Math.abs(got.d - rolled) < 1e-6,
        `${w}x${h} up=${up}: element fitted ${got.d.toFixed(6)}, the rolled fit is ${rolled.toFixed(6)}`);
    }
  }
});

test('an eye looking straight along its own up is fitted for EVERY roll', async () => {
  // Here the roll is undefined: cube-frame invents one, three's lookAt invents another, and
  // OrbitControls' makeSafe nudges the pole and invents a third. Fitting to a guess is how a
  // sticker corner reached 1.15 of the half-frame in a tall canvas. The contract is that the fit
  // falls back to the roll-INDEPENDENT bound, which covers all of them — asserted by value.
  for (const [up, lat, lon] of [['R', 0, 90], ['U', 90, 0], ['F', 0, 0], ['D', -90, 0]]) {
    const page = await cube({
      w: 200, h: 460, 'camera-up': up,
      'camera-latitude': String(lat), 'camera-longitude': String(lon),
    });
    const got = await fitInputs(page);
    const eye = eyeDirection(lat, lon);
    const safe = fitDistanceStable({
      points: silhouette({ eye, elevation: null, scale: got.scale, cull: true }),
      vfovDeg: got.fov, aspect: got.aspect,
    });
    assert.ok(Math.abs(got.d - safe) < 1e-6,
      `up ${up} at ${lat}/${lon}: element fitted ${got.d.toFixed(6)}, the roll-independent bound is ${safe.toFixed(6)}`);
  }
});

test('changing the roll actually renders — the matrices are not enough', async () => {
  // Counted on the RENDERER, not on a wrapper round `_draw`. Wrapping `_draw` counts the call and
  // an emptied `_draw` still satisfies it; `renderer.info.render.frame` only moves when three has
  // actually drawn a frame, which is the thing a stale picture would fail to do.
  const frames = () => ctx.page.evaluate(() => window.__cube.renderer.info.render.frame);
  const page = await cube();
  await page.waitForFunction(() => window.__cube.renderer.info.render.frame > 0);
  const before = await frames();
  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
  await page.waitForFunction((n) => window.__cube.renderer.info.render.frame > n, before, { timeout: 2000 });
  assert.ok(await frames() > before, 'no frame was rendered after the roll changed');
});

test('it turns back: D to U, and removing the attribute', async () => {
  // Every other test builds a fresh element, so a renderer that turns over but cannot turn back
  // would pass them all — and leak the lesson's orientation into the next screen, because the app
  // reuses one cube across screens rather than building a new one.
  const page = await cube();
  const upright = await project(page, [0, 1, 0]);
  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
  assert.deepEqual(await cameraUp(page), [0, -1, 0]);
  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'U'));
  assert.deepEqual(await cameraUp(page), [0, 1, 0], 'D back to U');
  assert.deepEqual(await project(page, [0, 1, 0]), upright, 'and the picture is where it started');

  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
  await page.evaluate(() => window.__cube.removeAttribute('camera-up'));
  assert.deepEqual(await cameraUp(page), [0, 1, 0], 'removing the attribute falls back to the default');
  assert.deepEqual(await project(page, [0, 1, 0]), upright, 'and so does the picture');
});

test('the orbit controls end up in the same frame as the renderer', async () => {
  // OrbitControls builds the quaternion mapping `object.up` onto +Y once, in its CONSTRUCTOR
  // (three r185, OrbitControls.js ~line 406) — and its inverse alongside. If nothing rebuilt them,
  // dragging would orbit in the old frame while the renderer drew in the new one.
  //
  // Checked with R rather than D on purpose: D's rotation is its own inverse, so a bug that set
  // `_quatInverse = _quat.clone()` instead of inverting it is invisible under D and obvious here.
  for (const up of ['R', 'F', 'D']) {
    const page = await cube({ 'camera-up': up });
    const state = await page.evaluate(() => {
      const c = window.__cube.controls;
      if (!c || !c._quat || !c._quatInverse) return { missing: true };
      const V3 = Object.getPrototypeOf(window.__cube.camera.position).constructor;
      const u = c.object.up;
      const mapped = new V3(u.x, u.y, u.z).applyQuaternion(c._quat);
      const roundTrip = new V3(u.x, u.y, u.z).applyQuaternion(c._quat).applyQuaternion(c._quatInverse);
      return {
        missing: false,
        // `+ 0` on every component: a rotation readily produces -0, and deepStrictEqual holds -0
        // and 0 to be different values — without it this reports a failure that is not one.
        mapped: [mapped.x, mapped.y, mapped.z].map((n) => +n.toFixed(4) + 0),
        roundTrip: [roundTrip.x, roundTrip.y, roundTrip.z].map((n) => +n.toFixed(4) + 0),
        up: [u.x, u.y, u.z].map((n) => Math.round(n) + 0),
      };
    });
    assert.equal(state.missing, false, 'OrbitControls no longer exposes _quat/_quatInverse — the up fix needs re-plumbing');
    assert.deepEqual(state.mapped, [0, 1, 0], `the controls must map the CURRENT up onto +Y (${up})`);
    assert.deepEqual(state.roundTrip, state.up, `_quatInverse must undo _quat (${up})`);
  }
});

test('the eye lands exactly where latitude and longitude ask, whatever the roll', async () => {
  // Not merely "the same before and after": an implementation that ignored latitude and longitude
  // would satisfy that. The direction is checked against the angles themselves.
  const want = (lat, lon) => {
    const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
    return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)].map((n) => +n.toFixed(4) + 0);
  };
  const page = await cube({ 'camera-latitude': '-30', 'camera-longitude': '135' });
  const before = await eye(page);
  assert.deepEqual(before, want(-30, 135), 'the upright eye must match the requested angles');
  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
  assert.deepEqual(await eye(page), want(-30, 135), 'and the roll must not move it');
  assert.deepEqual(await cameraUp(page), [0, -1, 0], 'while the roll itself did take effect');
});

test('every face letter is accepted, through every way of setting it', async () => {
  const want = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
  for (const [face, v] of Object.entries(want)) {
    const page = await cube();
    const [, said] = await withWarnings(page, 'window.__cube.setAttribute("camera-up", arg); return null;', face);
    assert.deepEqual(await cameraUp(page), v, `attribute camera-up="${face}"`);
    // A valid value must be SILENT. Without this, an implementation that oriented correctly and
    // warned every time would pass — and the console is where the invalid path reports.
    assert.deepEqual(said, [], `camera-up="${face}" must not warn — said: ${JSON.stringify(said)}`);
  }
  // Normalisation, and both public entry points. Dropping `.trim()`, `.toUpperCase()`, the
  // `cameraup` alias or the property setter would each pass a test that only ever used
  // canonical-case attributes.
  const page = await cube();
  for (const [raw, v] of [['d', [0, -1, 0]], ['  r  ', [1, 0, 0]], ['\tF\n', [0, 0, 1]]]) {
    const [, said] = await withWarnings(page, 'window.__cube.setAttribute("camera-up", arg); return null;', raw);
    assert.deepEqual(await cameraUp(page), v, `attribute camera-up=${JSON.stringify(raw)}`);
    assert.deepEqual(said, [], `camera-up=${JSON.stringify(raw)} is valid and must not warn`);
  }
  await page.evaluate(() => window.__cube.setAttribute('cameraup', 'B'));
  assert.deepEqual(await cameraUp(page), [0, 0, -1], 'the DOM-lowercased alias must work too');
  await page.evaluate(() => { window.__cube.cameraUp = 'L'; });
  assert.deepEqual(await cameraUp(page), [-1, 0, 0], 'and so must the property setter');
});

test('anything else is refused out loud, and falls back rather than sticking', async () => {
  // Warnings are captured INSIDE the page around the mutation and matched to the offending value.
  // Reading them off a shared console buffer afterwards cannot tell whose warning it was: console
  // delivery is asynchronous, and an earlier case's message would satisfy a later assertion that
  // only looked for the words "camera-up".
  const page = await cube();
  for (const bad of ['X', 'up', 'UD', '', '0 1 0', 'URF']) {
    // Start from a VALID non-default roll, so a bug that warns and then leaves the old value in
    // force is caught. Warning is not enough; it has to actually fall back.
    await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
    assert.deepEqual(await cameraUp(page), [0, -1, 0], 'precondition: D is in force');
    const [, said] = await withWarnings(page, 'window.__cube.setAttribute("camera-up", arg); return null;', bad);
    assert.deepEqual(await cameraUp(page), [0, 1, 0], `camera-up=${JSON.stringify(bad)} must fall back to world up`);
    // The empty string cannot be matched by `includes` — every message contains it — so that one
    // case is held to naming the accepted values instead. Without this split the empty-string
    // assertion is a tautology and would pass on any warning at all.
    const names = bad.trim() === ''
      ? (w) => w.includes('U D R L F B')
      : (w) => w.includes(bad.trim().toUpperCase());
    assert.ok(said.some((w) => w.includes('camera-up') && names(w)),
      `camera-up=${JSON.stringify(bad)} must name what it refused — said: ${JSON.stringify(said)}`);
  }
});

test('a Symbol reaches the setter without throwing', async () => {
  // `String()` on line one of _cameraUp survives a Symbol; interpolating the ORIGINAL value into
  // the warning does not, and would turn a warn-and-recover into an uncaught TypeError with the
  // fallback never returned.
  const page = await cube({ 'camera-up': 'D' });
  const [threw, said] = await withWarnings(page,
    'try { window.__cube.cameraUp = Symbol("D"); return null; } catch (e) { return String(e); }');
  assert.equal(threw, null, `setting a Symbol threw: ${threw}`);
  assert.deepEqual(await cameraUp(page), [0, 1, 0], 'and it must still fall back to world up');
  assert.ok(said.some((w) => w.includes('camera-up')), 'and still warn');
});

test('disposing a DETACHED cube still unbinds its keydown listener from the document', async () => {
  // Not about `camera-up`, but it is what this file's fixture churn exposed: it builds and
  // disposes a cube per case, and a leak here accumulates across the suite.
  //
  // OrbitControls binds a capture-phase keydown listener to `domElement.getRootNode()` and unbinds
  // from whatever THAT returns at dispose time. The element's common teardown is its release
  // timer, which fires after detachment — when `getRootNode()` is the detached subtree, not the
  // document, so the removal misses and the document keeps the listener for the life of the page.
  //
  // Matched on CALLBACK IDENTITY. Asserting only "a capture-phase keydown was removed" passes if
  // some unrelated listener happens to be torn down in the same window, which is exactly the kind
  // of assertion that survives the bug it was written for.
  const verdict = await ctx.page.evaluate(() => {
    // Spied on EventTarget.prototype, not on `document`, because the whole point is WHICH node
    // receives the removal — and the buggy path sends it to the detached CUBUS-CUBE element,
    // where a document-only spy sees nothing and the test cannot tell that from success.
    const P = EventTarget.prototype;
    const realAdd = P.addEventListener;
    const realRemove = P.removeEventListener;
    let log = [];
    P.addEventListener = function (t, f, o) {
      if (t === 'keydown' && o && o.capture) log.push({ op: 'add', target: this, fn: f });
      return realAdd.call(this, t, f, o);
    };
    P.removeEventListener = function (t, f, o) {
      if (t === 'keydown' && o && o.capture) log.push({ op: 'remove', target: this, fn: f });
      return realRemove.call(this, t, f, o);
    };
    try {
      if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
      const el = document.createElement('cubus-cube');
      el.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px;z-index:99999';
      el.setAttribute('facelets', 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
      document.body.appendChild(el);
      window.__cube = el;
      const bound = log.filter((e) => e.op === 'add' && e.target === document).map((e) => e.fn);
      const canvas = el.renderer.domElement;
      const styleBefore = canvas.style.display;

      // Reset AFTER construction. OrbitControls' `connect()` disconnects first, so the same
      // callback is removed and then added during setup — counting that as the teardown removal
      // made this test pass with the fix deleted.
      log = [];
      el.remove();
      el.dispose();

      const offDocument = log.filter((e) => e.op === 'remove' && e.target === document).map((e) => e.fn);
      const elsewhere = log.filter((e) => e.op === 'remove' && e.target !== document)
        .map((e) => e.target.nodeName || String(e.target));
      return {
        bound: bound.length,
        unbound: bound.filter((fn) => offDocument.includes(fn)).length,
        elsewhere,
        styleBefore,
        styleAfter: canvas.style.display,
        stillAttached: canvas.isConnected,
      };
    } finally {
      P.addEventListener = realAdd;
      P.removeEventListener = realRemove;
      window.__cube = null;
    }
  });
  assert.ok(verdict.bound > 0, 'OrbitControls no longer binds a capture-phase keydown — this test is moot');
  assert.equal(verdict.unbound, verdict.bound,
    `${verdict.bound - verdict.unbound} of ${verdict.bound} capture-phase keydown listeners were left on the `
    + `document — removals went to ${JSON.stringify(verdict.elsewhere)} instead`);
  assert.equal(verdict.styleAfter, verdict.styleBefore,
    'teardown changed the canvas display and did not put it back');
  assert.equal(verdict.stillAttached, false, 'teardown left the canvas in the document');
});
