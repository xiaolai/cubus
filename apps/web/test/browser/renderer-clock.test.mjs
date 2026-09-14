// The renderer's pinned clock — Stage 0 of dev-docs/renderer-v2-plan.md, and the thing every
// later comparison rests on.
//
// A turn eases over wall-clock milliseconds and the highlight breathes on its own period, so two
// renders of "the same" cube are only the same picture by luck. `clock` freezes both, which is
// what makes a mid-turn frame reproducible — and a change that claims to leave the picture alone
// can only be checked against a picture that holds still.
//
// It is a PROPERTY, never an attribute: the capability manifest is built from
// `observedAttributes`, and a test seam advertised to consumers as a capability is a promise
// nobody meant to make. `cube-manifest.test.mjs` is what would notice; this file states the
// intent where the seam is.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
/** packages/cubus-cube/src/cubus-cube.js HL_PERIOD — one full breath of the highlight. */
const HL_PERIOD = 1200;
let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

/** A fresh cube with a highlight running, so there is something on a clock to watch. */
async function cube() {
  await page.evaluate((facelets) => {
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
    el.setAttribute('facelets', facelets);
    el.setAttribute('highlight', 'slot:UF');
    document.body.appendChild(el);
    window.__cube = el;
  }, SOLVED);
  // One frame, so the element has built its scene and started its highlight.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

const phaseAt = (ms) => page.evaluate((t) => {
  window.__cube.clock = t;
  return window.__cube._hlPhase();
}, ms);

test('a pinned clock holds the breath still', async () => {
  await cube();
  const readings = await page.evaluate(async () => {
    window.__cube.clock = 5000;
    const out = [];
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      out.push(window.__cube._hlPhase());
    }
    return out;
  });
  assert.equal(new Set(readings).size, 1, `the breath moved under a pinned clock: ${readings.join(', ')}`);
});

test('half a period on is the other end of the breath', async () => {
  await cube();
  const at = await phaseAt(5000);
  const half = await phaseAt(5000 + HL_PERIOD / 2);
  // The breath is a cosine, so a half period is its reflection: p -> 1 - p, exactly.
  assert.ok(Math.abs(half - (1 - at)) < 1e-9, `${at} and ${half} are not half a period apart`);
  const full = await phaseAt(5000 + HL_PERIOD);
  assert.ok(Math.abs(full - at) < 1e-9, 'a whole period did not come back to the same point');
});

// THE CASE THAT FAILS AGAINST THE OBVIOUS SETTER. `Number(null)` is 0, so
// `Number.isFinite(Number(v)) ? Number(v) : null` pins the clock at zero when asked to release it
// — time stops instead of starting, and every later reading is of a cube frozen at the epoch.
test('clock = null lets time go again', async () => {
  await cube();
  await phaseAt(5000);
  const moved = await page.evaluate(async () => {
    window.__cube.clock = null;
    if (window.__cube.clock !== null) return 'the getter still reports a pinned clock';
    const first = window.__cube._now();
    await new Promise((r) => setTimeout(r, 30));
    const second = window.__cube._now();
    return second > first ? 'ok' : `time did not advance: ${first} then ${second}`;
  });
  assert.equal(moved, 'ok');
});

test('a turn held at a pinned clock is the same frame every time', async () => {
  await cube();
  // Start a quarter turn, then pin the clock part-way into it and read where the layer sits.
  const twice = await page.evaluate(async () => {
    const read = async () => {
      const el = window.__cube;
      el.clock = null;
      el.reset();
      el.setAttribute('alg', 'R');
      el.clock = 1_000_000;       // the turn starts on this instant
      el.step();
      el.clock = 1_000_000 + 95;  // part-way through a 190ms quarter turn
      await new Promise((r) => requestAnimationFrame(() => r()));
      // WORLD transforms, not each cubie's own: today a turn in flight lives on a temporary
      // parent group, and after the pose work it will live on the cubies themselves. What the
      // eye gets is the world matrix either way, so that is what an instrument may read.
      el.root.updateMatrixWorld(true);
      return el.cubies.map((c) => [...c.matrixWorld.elements].map((v) => Math.round(v * 1e6) / 1e6 + 0));
    };
    return [await read(), await read()];
  });
  assert.deepEqual(twice[0], twice[1], 'the same clock gave two different mid-turn frames');
  // A cube at rest sits on the lattice: every entry of every world matrix is a whole number. Part
  // way through a turn it cannot be, so a fractional entry is the proof that the clock stopped the
  // animation where it was asked to rather than after it had finished.
  assert.ok(twice[0].some((m) => m.some((v) => !Number.isInteger(v))),
    'nothing was caught mid-turn — the clock did not freeze the animation where it was asked to');
});
