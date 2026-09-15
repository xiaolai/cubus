// `orientation` — which way the CUBE is held, as opposed to where the observer stands.
//
// Two different statements, and they need two different mechanisms. `camera-up` moves the eye, and
// `_placeLights` bolts the lighting rig to the camera — so rolling the eye rolls the sun, which is
// right for a product shot and wrong for "the child turned it over in their hands", where the lamp
// is in the room and stays put. Turning the object gets that for free, because the camera never
// moves. Two cases here assert exactly that and nothing else.
//
// THE FIXTURE IS NOT SQUARE, on purpose. `docs/preflight.md` rule 22 in cubus-im, paid for by
// `camera-up` itself: its fixture was square, which is the one frame shape in which a quarter turn
// of the roll cannot change what fits — so the test written to prove the up vector reached the
// distance fit COULD NOT HAVE FAILED, and three of six passed with the feature fully reverted.
//
// Every case here has been run against a reverted `orientation`. What that showed is recorded at
// the foot of this file.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ORIENTATIONS, turnFacelets } from '../../lib/cube-orientation.js';
import { startBrowserFixture } from './harness.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
// Scrambled on every face, so no symmetry can hide a sticker that landed in the wrong place.
const SCRAMBLED = 'BBURUFLLFRRDBRUDRDLDBFFFUUFLDRUDBDLBLUULFLRFRDBBRDLFUB';

// Non-square, and not by a little: 16:9. A quarter turn changes what fits here.
const W = 320;
const H = 180;

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  // NOT reduced-motion: `turnTo` lands instantly under that preference (deliberately — the turn is
  // decoration, the destination is the content), and half this file is about the journey.
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

/**
 * A fresh element per case, disposed and awaited off the DOM first — the pattern `camera-up.test`
 * settled on, and for its reason: WebKit caps how many WebGL contexts a document may hold.
 *
 * Two frames before anything is measured. The ResizeObserver reports ASYNCHRONOUSLY, so the first
 * fit runs against an aspect of 1 and the next against the real 16:9 — which made a camera
 * distance read 0.5% different depending on how early in the file it was taken, and blamed the
 * feature for it.
 *
 * The one case that needs MANY cubes — the 24 orientations — does not build 24 elements. It swaps
 * attributes on one, because 48 contexts exhausts the cap partway through and every later case
 * then runs against a cube whose scene was never built: autorotate reports no spin and ghost
 * culling reports no ghosts, both of which read exactly like a broken feature.
 */
async function cube({ attrs = {} } = {}) {
  await page.evaluate(async (a) => {
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = `position:fixed;left:0;top:0;width:${a.w}px;height:${a.h}px;z-index:99999`;
    // Attributes BEFORE connecting: `connectedCallback` draws immediately, so an attribute set
    // after it is not in the first frame. The renderer's own notes record the hour this cost once.
    for (const [k, v] of Object.entries(a.attrs)) el.setAttribute(k, String(v));
    document.body.appendChild(el);
    window.__cube = el;
  }, { w: W, h: H, attrs });
  // Wait for the CONDITION, not for a number of frames. The ResizeObserver reports
  // asynchronously, so the element's first fit runs against the camera's constructed aspect and
  // the real one arrives a frame or two later — which made a distance read 0.5% different
  // depending on how early in the case it was taken, and blamed the feature for it.
  await page.waitForFunction((want) => Math.abs(window.__cube.camera.aspect - want) < 1e-9, W / H);
  // And a half-built cube must not masquerade as a working one: WebKit caps WebGL contexts, and an
  // element whose scene never got one reports no stickers, no spin and no ghosts — three failures
  // that read exactly like a broken feature.
  const built = await page.evaluate(() => ({
    stickers: window.__cube.stickers?.length ?? 0,
    ghosts: window.__cube._ghostMeshes?.length ?? 0,
    running: window.__cube._running === true,
  }));
  assert.deepEqual(built, { stickers: 54, ghosts: 54, running: true }, 'the cube was not built');
  // Every attribute this case asked for is ON the element. Without this the helper's own signature
  // silently swallowed them — `cube({ attrs: {...} })` set one attribute literally called "attrs" —
  // and the cases that did not depend on an attribute went green over a cube nobody had configured.
  const missing = await page.evaluate((want) => Object.keys(want).filter(
    (k) => window.__cube.getAttribute(k) !== String(want[k])), attrs);
  assert.deepEqual(missing, [], 'attributes never reached the element');
  return page;
}

/**
 * The PICTURE, as the set of (where a sticker is in the world, what colour it is).
 *
 * World position, because that is what the eye sees: it already carries the root's rotation, so
 * two cubes that draw the same picture by different routes produce the same map here. Rounded,
 * because a quarter turn through a quaternion leaves 6e-17 where a zero belongs.
 */
const picture = async () => {
  const pic = await page.evaluate(() => {
    const el = window.__cube;
    el.scene.updateMatrixWorld(true);
    // `-0` and `0` are the same place and format differently ("-0.000" against "0.000"), and a
    // quarter turn produces one wherever it negates a zero component — so half the orientations
    // compared unequal to themselves until this was here.
    const r3 = (v) => +v.toFixed(3) + 0;
    return el.stickers.map((m) => {
      const p = m.getWorldPosition(new (Object.getPrototypeOf(el.camera.position).constructor)());
      return `${r3(p.x)},${r3(p.y)},${r3(p.z)}=${m.material.color.getHexString()}`;
    }).sort();
  });
  // A cube whose scene was never built has no stickers, and two empty pictures compare EQUAL.
  // That is not hypothetical here: the first version of the 24-orientation case below built 48
  // WebGL contexts, WebKit refused most of them, and the case passed by comparing nothing with
  // nothing. Green is not evidence that anything happened.
  assert.equal(pic.length, 54, 'the cube drew no stickers — its scene was never built');
  return pic;
};

const rootQuat = () => page.evaluate(() => {
  const q = window.__cube.root.quaternion;
  return [q.x, q.y, q.z, q.w].map((n) => +n.toFixed(6) + 0);
});

const lights = () => page.evaluate(() => window.__cube._lights.map(([l]) =>
  [l.position.x, l.position.y, l.position.z].map((n) => +n.toFixed(4) + 0)));

const camera = () => page.evaluate(() => {
  const c = window.__cube.camera;
  return [c.position.x, c.position.y, c.position.z].map((n) => +n.toFixed(4) + 0);
});

/** Run `body` in the page with console.warn captured. The body is a literal in this file and the
 *  argument is PASSED, never interpolated — same shape as `camera-up.test.mjs`. */
const withWarnings = (body, arg) => page.evaluate(async ([b, a]) => {
  const said = [];
  const real = console.warn;
  console.warn = (...m) => { said.push(m.join(' ')); };
  // AWAITED inside the page. A body that returns a promise otherwise serialises as `{}` — which is
  // how the refusal case came to assert against an empty object and pass on nothing.
  try { return [await new Function('arg', b)(a), said]; } finally { console.warn = real; }
}, [body, arg]);

// ---- the picture ------------------------------------------------------------------------------

// THE CASE THIS FEATURE EXISTS FOR, and the one that could not be written before `turnFacelets`
// lived in this repository: the renderer and an independent facelet model must agree about what a
// turned cube looks like. A handedness error satisfies every count, every centre check and every
// closure test in the unit suite while showing a child a mirror image of their cube.
// THE DEFINITION, asked of the renderer directly and for all 24: an orientation names which cube
// face points UP and which faces the VIEWER, so the rotation the element applies must send the up
// face's normal to +Y and the front face's to +Z. Nothing is shared with the implementation here —
// no matrix, no quaternion conversion, no permutation — so a transpose cannot hide. It did not:
// this is the case that found `Matrix4.set` being fed columns, which for a rotation is its
// INVERSE, and which every count, centre check and determinant in the unit suite passed happily.
//
// What this buys, with the unit suite: `cube-orientation.js` is pinned to cubejs-derived
// permutations there, and the renderer is pinned to `orientationMatrix` here, so what the child
// sees and what `turnFacelets` describes are the same cube by construction.
//
// NOT a comparison of rendered COLOURS against `turnFacelets`. That looks like the obvious test
// and is wrong: a facelet letter names a FACE, the palette maps letters to colours by face, and
// `turnFacelets` renames the letters — so painting a turned string with a fixed palette recolours
// the stickers. Turning a real cube does not.
test('all 24 orientations put the named faces where their names say', async () => {
  await cube({ attrs: { facelets: SCRAMBLED, 'camera-fit': 'stable' } });
  const NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
  const wrong = await page.evaluate(([specs, normals]) => {
    const el = window.__cube;
    const V = Object.getPrototypeOf(el.camera.position).constructor;
    const bad = [];
    for (const [up, front] of specs) {
      el.setAttribute('orientation', `${up} ${front}`);
      const q = el.root.quaternion;
      const at = (letter) => new V(...normals[letter]).applyQuaternion(q).toArray().map((n) => Math.round(n) + 0);
      const upAt = at(up);
      const frontAt = at(front);
      if (upAt.join() !== '0,1,0' || frontAt.join() !== '0,0,1') {
        bad.push(`${up} ${front}: up->${upAt.join()} front->${frontAt.join()}`);
      }
    }
    return bad;
  }, [ORIENTATIONS.map((o) => [...o]), NORMAL]);
  assert.deepEqual(wrong, []);
});

// And the cube really is being carried by that rotation, rather than the rotation being set on
// something nothing is parented to: every sticker moves, and the set of places they occupy is the
// same set, because the 24 orientations are the cube's own symmetries.
test('the stickers travel with the rotation, onto the positions a cube occupies', async () => {
  await cube({ attrs: { facelets: SCRAMBLED, 'camera-fit': 'stable' } });
  const upright = (await picture()).map((s) => s.split('=')[0]);
  for (const spec of ['D B', 'R F', 'U L', 'B D']) {
    await page.evaluate((s) => window.__cube.setAttribute('orientation', s), spec);
    const turned = await picture();
    assert.deepEqual(turned.map((s) => s.split('=')[0]), upright,
      `${spec} moved stickers off the positions a cube occupies`);
    assert.notDeepEqual(turned, await (async () => {
      await page.evaluate(() => window.__cube.setAttribute('orientation', 'U F'));
      return picture();
    })(), `${spec} drew the same picture as an upright cube`);
    await page.evaluate((s) => window.__cube.setAttribute('orientation', s), spec);
  }
});

test('the default is the identity, and drawing it changes nothing', async () => {
  await cube({ attrs: { facelets: SCRAMBLED } });
  const plain = await picture();
  await cube({ attrs: { facelets: SCRAMBLED, orientation: 'U F' } });
  assert.deepEqual(await picture(), plain);
  assert.deepEqual(await rootQuat(), [0, 0, 0, 1]);
});

// ---- the reason it is the object and not the camera -------------------------------------------

test('turning the cube leaves the lights exactly where they were', async () => {
  await cube({ attrs: { facelets: SOLVED } });
  const before = await lights();
  const held = await rootQuat();
  await page.evaluate(() => window.__cube.setAttribute('orientation', 'D B'));
  // Both halves, or this passes over a cube that never turned: the rig must be where it was AND
  // the cube must have moved. Reverted, the first half alone is green.
  assert.notDeepEqual(await rootQuat(), held, 'the cube did not turn at all');
  assert.deepEqual(await lights(), before, 'the lighting rig moved — this is the camera doing it');
});

test('turning the cube leaves the camera exactly where it was', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-fit': 'stable' } });
  const before = await camera();
  const held = await rootQuat();
  await page.evaluate(() => window.__cube.setAttribute('orientation', 'R F'));
  assert.notDeepEqual(await rootQuat(), held, 'the cube did not turn at all');
  assert.deepEqual(await camera(), before);
});

// `camera-up` is the OTHER statement and keeps its own job: it moves the observer, and moving the
// observer moves the rig. Asserted here so the two mechanisms cannot quietly become one.
test('camera-up still moves the rig — the two mechanisms stay different', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-latitude': -35 } });
  const before = await lights();
  await page.evaluate(() => window.__cube.setAttribute('camera-up', 'D'));
  assert.notDeepEqual(await lights(), before);
});

// ---- refusals ---------------------------------------------------------------------------------

test('a pair on one axis is refused, and the cube does not move', async () => {
  await cube({ attrs: { facelets: SOLVED, orientation: 'D B' } });
  const held = await rootQuat();
  for (const bad of ['U D', 'F F', 'L R', 'U', 'U F B', 'U X', '']) {
    const [, said] = await withWarnings(
      'window.__cube.setAttribute("orientation", arg); return null;', bad,
    );
    assert.equal(said.length, 1, `"${bad}" should warn exactly once`);
    assert.match(said[0], /refusing orientation/);
    assert.deepEqual(await rootQuat(), held, `"${bad}" moved the cube`);
  }
});

// ---- the phase primitive ----------------------------------------------------------------------

// The finding that reshaped the design: a lesson's cube is a pure function of `t`, so a timestamp
// reached by seeking backwards has to give the SAME pose as one reached by playing forwards. An
// animation that eases from "wherever the cube is now" cannot, and endpoint equality across the 24
// cannot see the difference.
test('a phase is a pure function of its arguments, however it was reached', async () => {
  await cube({ attrs: { facelets: SCRAMBLED, 'camera-fit': 'stable' } });
  const poseAt = (p) => page.evaluate((phase) => {
    window.__cube.showTurn('U F', 'D B', phase);
    const q = window.__cube.root.quaternion;
    return [q.x, q.y, q.z, q.w].map((n) => +n.toFixed(6) + 0);
  }, p);

  const direct = await poseAt(0.37);
  // A renderer that never moves satisfies "same phase, same pose" perfectly.
  assert.notDeepEqual(await poseAt(0), await poseAt(1), 'the two ends are the same pose');
  assert.notDeepEqual(direct, await poseAt(0), 'a phase partway along is the same as the start');
  await poseAt(0.37);
  // Forwards, then to the same phase.
  for (const p of [0, 0.1, 0.2, 0.3]) await poseAt(p);
  assert.deepEqual(await poseAt(0.37), direct, 'playing forwards into it gave a different pose');
  // Backwards from beyond it.
  for (const p of [1, 0.9, 0.6]) await poseAt(p);
  assert.deepEqual(await poseAt(0.37), direct, 'seeking backwards into it gave a different pose');
  // And from the other end entirely.
  await poseAt(1);
  assert.deepEqual(await poseAt(0.37), direct);
});

test('phase 0 and phase 1 are the two named orientations', async () => {
  const at = async (p) => { await page.evaluate((x) => window.__cube.showTurn('U F', 'D B', x), p); return picture(); };
  await cube({ attrs: { facelets: SCRAMBLED, orientation: 'U F', 'camera-fit': 'stable' } });
  const start = await picture();
  await cube({ attrs: { facelets: SCRAMBLED, orientation: 'D B', 'camera-fit': 'stable' } });
  const end = await picture();

  assert.notDeepEqual(start, end, 'the two orientations draw the same picture');
  await cube({ attrs: { facelets: SCRAMBLED, 'camera-fit': 'stable' } });
  assert.deepEqual(await at(0), start);
  assert.deepEqual(await at(1), end);
});

test('a phase outside [0,1] is clamped rather than extrapolated', async () => {
  await cube({ attrs: { facelets: SCRAMBLED, 'camera-fit': 'stable' } });
  const pose = (p) => page.evaluate((x) => {
    window.__cube.showTurn('U F', 'D B', x);
    const q = window.__cube.root.quaternion;
    return [q.x, q.y, q.z, q.w].map((n) => +n.toFixed(6) + 0);
  }, p);
  assert.notDeepEqual(await pose(0), await pose(1), 'the two ends are the same pose');
  assert.deepEqual(await pose(-5), await pose(0));
  assert.deepEqual(await pose(5), await pose(1));
  assert.deepEqual(await pose(Number.NaN), await pose(1));
});

// ---- turnTo, and the lifecycle it has to survive ----------------------------------------------

// Two halves, deliberately not one. Sampling "part-way through" a 120ms turn after two frames is
// a race — two frames is ~33ms on a quiet machine and past 120ms on a loaded one, and the case
// then reports that the cube arrived too early. So the journey is measured on a turn long enough
// that no sampling delay can finish it, and the ARRIVAL is measured on a turn that is awaited.
test('turnTo is a journey: part-way through, the cube is neither where it was nor where it is going', async () => {
  await cube({ attrs: { facelets: SCRAMBLED, 'camera-fit': 'stable' } });
  // Sampled EVERY frame for the whole turn, not once at a guessed moment. Two earlier versions of
  // this case were races in opposite directions: one sampled 120ms in and found the turn already
  // finished on a loaded machine, the other stretched the turn to 30s so it could not finish and
  // found no movement at all — the easing is cubic, so two frames into a 30s turn is 5e-9 of the
  // way. Watching the whole journey needs no guess about when the interesting part happens.
  const best = await page.evaluate(async () => {
    const q0 = window.__cube.root.quaternion.clone();
    const end = window.__cube._pose('D B').q.clone();
    let between = 0;
    let live = true;
    const done = window.__cube.turnTo('D', 'B', { ms: 300 }).then((ok) => { live = false; return ok; });
    while (live) {
      await new Promise((res) => requestAnimationFrame(res));
      const q = window.__cube.root.quaternion;
      between = Math.max(between, Math.min(q.angleTo(q0), q.angleTo(end)));
    }
    return { between, ok: await done, total: q0.angleTo(end) };
  });
  assert.equal(best.ok, true);
  assert.ok(best.total > 1, 'the destination is where the cube already was');
  assert.ok(best.between > 0.05, `the cube never appeared between its two ends (best ${best.between.toFixed(4)} rad)`);
});

test('an awaited turnTo resolves true and lands exactly where the cut would have', async () => {
  await cube({ attrs: { facelets: SCRAMBLED, orientation: 'D B', 'camera-fit': 'stable' } });
  const cut = await picture();
  await cube({ attrs: { facelets: SCRAMBLED, 'camera-fit': 'stable' } });
  const upright = await picture();
  const ok = await page.evaluate(() => window.__cube.turnTo('D', 'B', { ms: 60 }));
  assert.equal(ok, true);
  assert.notDeepEqual(cut, upright, 'the destination is where the cube already was');
  assert.deepEqual(await picture(), cut, 'an animated turn did not end where the cut would have');
});

// A superseding turn starts from the NEAREST named orientation, not from the exact pose the cube
// is in — the primitive interpolates between two named ends, which is what makes a scrubber
// reproducible. So the step is bounded by half a turn rather than being zero, and that is a
// deliberate trade rather than an oversight.
test('a superseding turn starts from the nearest named orientation', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-fit': 'stable' } });
  const r = await page.evaluate(async () => {
    const el = window.__cube;
    const step = async (phase) => {
      el.showTurn('U F', 'D B', phase);
      const before = el.root.quaternion.clone();
      const p = el.turnTo('R', 'F', { ms: 5000 });
      const after = el.root.quaternion.clone();
      el.turnTo('U', 'F', { ms: 0 });
      await p;
      return before.angleTo(after);
    };
    return { early: await step(0.1), late: await step(0.9) };
  });
  // The step back is exactly the distance already travelled from the nearer end. "U F" to "D B"
  // is a half turn, so a tenth of the way in is 0.1π ≈ 0.314 rad either side — and the WORST case,
  // superseding at phase 0.5 of a half turn, is π/2. That bound is the claim; the two measured
  // values are here so a change in the easing or the pairing shows up as a number rather than as a
  // silently wider jump.
  const HALF_TURN_WORST = Math.PI / 2;
  assert.ok(r.early < HALF_TURN_WORST, `an early supersede stepped ${r.early.toFixed(3)} rad`);
  assert.ok(r.late < HALF_TURN_WORST, `a late supersede stepped ${r.late.toFixed(3)} rad`);
  assert.ok(Math.abs(r.early - 0.1 * Math.PI) < 0.05, `expected ~0.314, got ${r.early.toFixed(3)}`);
  assert.ok(Math.abs(r.late - 0.1 * Math.PI) < 0.05, `expected ~0.314, got ${r.late.toFixed(3)}`);
});

test('a superseding turnTo settles the first with false rather than leaving it pending', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-fit': 'stable' } });
  const r = await page.evaluate(async () => {
    const first = window.__cube.turnTo('D', 'B', { ms: 5000 });
    await new Promise((res) => requestAnimationFrame(res));
    const second = window.__cube.turnTo('R', 'F', { ms: 40 });
    return { first: await first, second: await second };
  });
  assert.equal(r.first, false, 'the superseded turn should report that it was interrupted');
  assert.equal(r.second, true);
});

// On its OWN element: disposing the shared one would leave every later case running against a
// cube whose scene had been torn down, which is a failure that reads exactly like a broken feature.
test('dispose settles a pending turn — an await on a dead element must not hang', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-fit': 'stable' } });
  const settled = await page.evaluate(() => {
    const pending = window.__cube.turnTo('D', 'B', { ms: 10_000 });
    window.__cube.dispose();
    return Promise.race([pending, new Promise((r) => setTimeout(() => r('HUNG'), 1500))]);
  });
  assert.equal(settled, false);
});

test('recycle puts the orientation back and settles a pending turn', async () => {
  await cube({ attrs: { facelets: SOLVED, orientation: 'D B', 'camera-fit': 'stable' } });
  const heldBefore = await rootQuat();
  const settled = await page.evaluate(() => {
    const pending = window.__cube.turnTo('R', 'F', { ms: 10_000 });
    window.__cube.recycle();
    return Promise.race([pending, new Promise((r) => setTimeout(() => r('HUNG'), 1500))]);
  });
  assert.equal(settled, false);
  assert.notDeepEqual(heldBefore, [0, 0, 0, 1], 'the cube was never held any other way');
  assert.deepEqual(await rootQuat(), [0, 0, 0, 1], 'recycle left the cube held the old way');
  assert.equal(await page.evaluate(() => window.__cube.orientation), 'U F');
});

test('turnTo refuses an impossible pair without starting anything', async () => {
  await cube({ attrs: { facelets: SOLVED, orientation: 'D B', 'camera-fit': 'stable' } });
  const held = await rootQuat();
  // AWAITED. The first version wrote `turnTo(...) && false`, which discards the promise: it passed
  // whether the call resolved true, resolved false, or never settled at all.
  const [ok, said] = await withWarnings(
    'return window.__cube.turnTo("U", "D").then((v) => ({ resolved: v, turning: !!window.__cube._turning }));',
  );
  assert.deepEqual(ok, { resolved: false, turning: false },
    'a refused turn must resolve false and start nothing');
  assert.equal(said.length, 1);
  assert.match(said[0], /refusing turnTo/);
  assert.deepEqual(await rootQuat(), held);
});

// ---- coexistence ------------------------------------------------------------------------------

// `autorotate` used to write `root.rotation.y` directly, which is the same property the pose now
// owns. Two writers of one property is how one of them silently wins — and the one that loses here
// would be the orientation, so a lesson's cube would quietly stand back up while it spun.
test('autorotate spins the held cube without straightening it', async () => {
  await cube({ attrs: { facelets: SOLVED, orientation: 'D B', autorotate: '', 'camera-fit': 'stable' } });
  const held = await page.evaluate(async () => {
    // Which way is the cube's own D face pointing? Under "D B" it is up, and it must STAY up
    // while a turntable spins about the world's vertical.
    const V = Object.getPrototypeOf(window.__cube.camera.position).constructor;
    const readD = () => {
      window.__cube.scene.updateMatrixWorld(true);
      return new V(0, -1, 0).applyQuaternion(window.__cube.root.quaternion).y;
    };
    const first = readD();
    await new Promise((r) => setTimeout(r, 250));
    return { first, later: readD(), spun: window.__cube._spin > 0 };
  });
  assert.equal(held.spun, true, 'autorotate did not run');
  assert.ok(held.first > 0.99, 'the D face was not up to begin with');
  assert.ok(held.later > 0.99, 'spinning straightened the cube up');
});

test('a turn plays over a held cube without disturbing the alg animation', async () => {
  await cube({ attrs: { facelets: SOLVED, orientation: 'D B', alg: "R U R' U'", 'camera-fit': 'stable' } });
  // `_applied > 0` proved only that ONE move had landed — playback stopping the instant the turn
  // began would have passed. This waits for the whole four-move algorithm to finish.
  const r = await page.evaluate(async () => {
    const done = new Promise((res) => {
      const seen = [];
      window.__cube.addEventListener('cubus-step', (e) => {
        seen.push(e.detail.index);
        if (e.detail.index >= 4) res(seen);
      });
    });
    window.__cube.play();
    await new Promise((res) => setTimeout(res, 80));
    const ok = await window.__cube.turnTo('R', 'F', { ms: 80 });
    const steps = await Promise.race([
      done,
      new Promise((res) => setTimeout(() => res('STALLED'), 5000)),
    ]);
    return { ok, steps, applied: window.__cube._applied };
  });
  assert.equal(r.ok, true);
  assert.notEqual(r.steps, 'STALLED', 'the solution stopped animating once the cube was turned');
  assert.equal(r.applied, 4, 'the whole algorithm should have played through the turn');
});

// ---- framing ----------------------------------------------------------------------------------

// A settled orientation is one of the cube's own symmetries, so its silhouette is unchanged and any
// fit still frames it. A pose PARTWAY between two is the one shape that is not a cube's — so it is
// the one the default `view` fit cannot frame, and the element borrows the stable fit for the
// duration rather than letting the corners clip.
test('a cube mid-turn stays inside the frame even under the default fit', async () => {
  await cube({ attrs: { facelets: SOLVED, ghosts: 'on' } });
  const worst = await page.evaluate(async () => {
    const V = Object.getPrototypeOf(window.__cube.camera.position).constructor;
    let out = 0;
    let moved = 0;
    for (let i = 0; i <= 20; i++) {
      window.__cube.showTurn('U F', 'D B', i / 20);
      window.__cube.scene.updateMatrixWorld(true);
      moved = Math.max(moved, Math.abs(window.__cube.root.quaternion.x));
      // CORNERS, not centres. A ghost panel is a square with a real extent, so its centre can sit
      // comfortably inside the frame while two of its corners hang outside — which is exactly the
      // clipping this case claims to rule out.
      for (const g of window.__cube._ghostMeshes) {
        g.updateWorldMatrix(true, false);
        const box = g.geometry.boundingBox
          ?? (g.geometry.computeBoundingBox(), g.geometry.boundingBox);
        for (const sx of [box.min.x, box.max.x]) {
          for (const sy of [box.min.y, box.max.y]) {
            const p = new V(sx, sy, 0).applyMatrix4(g.matrixWorld).project(window.__cube.camera);
            out = Math.max(out, Math.abs(p.x), Math.abs(p.y));
          }
        }
      }
    }
    return { out, moved };
  });
  assert.ok(worst.moved > 0.1, 'the cube never actually turned, so nothing was framed');
  assert.ok(worst.out <= 1, `a ghost left the frame mid-turn (worst |ndc| ${worst.out.toFixed(3)})`);
});

// The stable fit is borrowed for as long as the cube is held some way other than upright, and
// given back the moment it is upright again — including a SETTLED turn, which is the half that was
// not obvious and that the framing case above caught.
test('the tight fit comes back when the cube is upright again, and not before', async () => {
  await cube({ attrs: { facelets: SOLVED, ghosts: 'on' } });
  const dist = () => page.evaluate(() => +window.__cube.camera.position.length().toFixed(6) + 0);
  const pose = (from, to, phase) => page.evaluate(
    ([f, o, p]) => window.__cube.showTurn(f, o, p), [from, to, phase],
  );

  const upright = await dist();
  await pose('U F', 'D B', 0.5);
  const mid = await dist();
  await pose('D B', 'D B', 1);
  const held = await dist();
  await pose('U F', 'U F', 1);
  const back = await dist();

  assert.ok(mid > upright, 'a mid-turn pose was framed no more widely than an upright one');
  assert.equal(held, mid, 'a settled turn went back to the fit that assumes an upright cube');
  assert.equal(back, upright, 'the tight fit was not given back');
});

// Recycling cannot cover this: `connectedCallback` draws immediately, so an orientation written
// before the element was connected has to be read during the build or the first frame shows a cube
// held the way nobody asked for. It reached the screen once for ghosts, for exactly this reason.
test('an orientation set before connecting is in the first frame', async () => {
  await cube({ attrs: { facelets: SCRAMBLED, orientation: 'D B', 'camera-fit': 'stable' } });
  assert.notDeepEqual(await rootQuat(), [0, 0, 0, 1], 'the first frame drew an upright cube');
  assert.equal(await page.evaluate(() => window.__cube.orientation), 'D B');
});

// ---- ghosts -----------------------------------------------------------------------------------

// `_ghostShows` was already written to compose the root's world quaternion before testing against
// the eye, years before anything rotated the root. This is the case that proves it — a ghost layer
// written in local space would look identical until the cube was turned.
test('ghost culling follows the cube, not the world', async () => {
  await cube({ attrs: { facelets: SOLVED, ghosts: 'on', 'camera-fit': 'stable' } });
  const shownFor = (spec) => page.evaluate((s) => {
    window.__cube.setAttribute('orientation', s);
    window.__cube._cullGhosts();
    return window.__cube._ghostMeshes.filter((g) => g.visible).map((g) => g.userData.face).sort().join('');
  }, spec);

  const upright = await shownFor('U F');
  const over = await shownFor('D B');
  assert.equal(upright.length, over.length, 'a different NUMBER of faces was ghosted');
  assert.notEqual(upright, over, 'the same faces were ghosted after turning the cube over');
  // The eye is above the equator, so the underside is always among the hidden faces — and after
  // turning the cube over, the face underneath is the one that was on top.
  assert.ok(upright.includes('D'), 'the underside was not ghosted upright');
  assert.ok(over.includes('U'), 'the old top was not ghosted once the cube was turned over');
});

// ---- the two mechanisms, composed ------------------------------------------------------------
//
// `camera-up` and `orientation` both change which way is up on screen, and a consumer deriving
// both from the same grip would apply it twice. The rule, stated here and asserted rather than
// assumed: **`camera-up`'s letter names a WORLD direction and is read in the fixed frame, never
// through the cube's orientation.** So the two are independent, and composing them is meaningful
// rather than accidental — but a lesson expressing "the child turned the cube over" wants
// `orientation` alone, because that is a fact about the cube and not about where anyone is standing.

test('camera-up is read in the fixed frame, so turning the cube does not move the horizon', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-up': 'D', 'camera-fit': 'stable' } });
  const up = () => page.evaluate(() => {
    const u = window.__cube.camera.up;
    return [u.x, u.y, u.z].map((n) => Math.round(n) + 0);
  });
  const before = await up();
  assert.deepEqual(before, [0, -1, 0], 'camera-up="D" should put world -Y at the top of the frame');
  const held = await rootQuat();
  await page.evaluate(() => window.__cube.setAttribute('orientation', 'R F'));
  assert.notDeepEqual(await rootQuat(), held, 'the cube did not turn');
  assert.deepEqual(await up(), before, 'the observer followed the cube — the two are meant to be independent');
});

test('and the orientation is unaffected by where the observer is standing', async () => {
  await cube({ attrs: { facelets: SOLVED, orientation: 'D B', 'camera-fit': 'stable' } });
  const faceUp = () => page.evaluate(() => {
    const V = Object.getPrototypeOf(window.__cube.camera.position).constructor;
    return new V(0, -1, 0).applyQuaternion(window.__cube.root.quaternion).toArray().map((n) => Math.round(n) + 0);
  });
  assert.deepEqual(await faceUp(), [0, 1, 0], 'the D face should be pointing up');
  for (const letter of ['D', 'R', 'B']) {
    await page.evaluate((l) => window.__cube.setAttribute('camera-up', l), letter);
    assert.deepEqual(await faceUp(), [0, 1, 0], `camera-up="${letter}" moved the cube`);
  }
});

// ---- what the audit found ---------------------------------------------------------------------

// A public pose change during a turn used to leave the animation running: the pose was written and
// the very next frame overwrote it from the old turn, whose promise nobody could see still ticking.
test('writing the orientation during a turn cancels it rather than fighting it', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-fit': 'stable' } });
  const r = await page.evaluate(async () => {
    const running = window.__cube.turnTo('D', 'B', { ms: 5000 });
    await new Promise((res) => requestAnimationFrame(res));
    window.__cube.setAttribute('orientation', 'R F');
    const settled = await Promise.race([
      running, new Promise((res) => setTimeout(() => res('HUNG'), 1500)),
    ]);
    const held = window.__cube.root.quaternion.clone();
    // Two more frames: if the cancelled turn were still running it would move the cube off the
    // orientation just written, which is the whole defect.
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { settled, drifted: held.angleTo(window.__cube.root.quaternion), turning: !!window.__cube._turning };
  });
  assert.equal(r.settled, false, 'the superseded turn did not settle');
  assert.equal(r.turning, false);
  assert.equal(r.drifted, 0, 'the cancelled animation went on moving the cube');
});

// A duration that is not a number is not a long turn — it is a turn whose completion test is false
// forever, leaving the promise pending until something else cancels it.
test('a turn with a non-finite duration lands at once instead of never', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-fit': 'stable' } });
  for (const ms of [Number.NaN, Infinity, -Infinity]) {
    const r = await page.evaluate(async (bad) => {
      const settled = await Promise.race([
        window.__cube.turnTo('D', 'B', { ms: bad }),
        new Promise((res) => setTimeout(() => res('HUNG'), 1000)),
      ]);
      const at = window.__cube.orientation;
      window.__cube.setAttribute('orientation', 'U F');
      return { settled, at };
    }, ms);
    assert.equal(r.settled, true, `turnTo with ms=${ms} never settled`);
  }
});

// A multi-character token is a SUBSTRING of "URFDLB", so the old check accepted "UR" and the
// refusal path threw from inside itself instead of warning and returning false.
test('a multi-character token is refused, not thrown on', async () => {
  await cube({ attrs: { facelets: SOLVED, orientation: 'D B', 'camera-fit': 'stable' } });
  const held = await rootQuat();
  for (const bad of ['UR F', 'U RF', 'URFDLB F']) {
    const [, said] = await withWarnings(
      'window.__cube.setAttribute("orientation", arg); return null;', bad,
    );
    assert.equal(said.length, 1, `"${bad}" should warn exactly once`);
    assert.match(said[0], /refusing orientation/);
    assert.deepEqual(await rootQuat(), held, `"${bad}" moved the cube`);
  }
});

// ---- what a reverted run showed ---------------------------------------------------------------
//
// Run against a reverted feature — `orientation` out of `observedAttributes` and `_applyRoot`
// returning immediately — **15 of these 22 fail**. The seven that survive, and why each is kept:
//
//   the default is the identity              asserts a cube nobody turned does not move. It cannot
//                                            fail while the feature is absent, and that is its job
//   camera-up still moves the rig            about the OTHER mechanism, and the guard that stops
//                                            the two quietly becoming one
//   a superseding turnTo settles the first   promise plumbing, which the revert leaves intact
//   dispose settles a pending turn           the same
//   turnTo refuses an impossible pair        the refusal path, which the revert leaves intact
//   a turn plays over a held cube            asserts the alg animation keeps running regardless
//   the tight fit comes back when upright    the fit rule reads `_turn`, not the pose
//
// The first draft of this file did far worse: 20 of 21 passed reverted, because half the cases
// asserted only that something did NOT happen — which is trivially true of a renderer that does
// nothing. Each of those now also asserts that the cube DID turn. That the first reverted run
// looked fine is itself a lesson: it reported 20 passes because the build had failed and the suite
// was still running against the working bundle. Check the exit code of the thing you care about.

// Round 2: cancelling BEFORE validating meant a typo in the attribute killed a perfectly good turn
// and left the cube stranded part-way through it. A request the element rejects changes nothing.
test('a refused orientation does not cancel a turn already running', async () => {
  await cube({ attrs: { facelets: SOLVED, 'camera-fit': 'stable' } });
  const r = await page.evaluate(async () => {
    const running = window.__cube.turnTo('D', 'B', { ms: 4000 });
    await new Promise((res) => requestAnimationFrame(res));
    const before = window.__cube.root.quaternion.clone();
    window.__cube.setAttribute('orientation', 'U D');   // same axis — refused
    window.__cube.showTurn('U F', 'nonsense', 0.5);      // refused
    const stillRunning = !!window.__cube._turning;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const moved = before.angleTo(window.__cube.root.quaternion) > 0;
    window.__cube.turnTo('U', 'F', { ms: 0 });
    return { stillRunning, moved, settled: await running };
  });
  assert.equal(r.stillRunning, true, 'a refused request cancelled the turn in flight');
  assert.equal(r.moved, true, 'the turn stopped advancing after a refused request');
  assert.equal(r.settled, false, 'the turn was superseded by the valid one at the end');
});
