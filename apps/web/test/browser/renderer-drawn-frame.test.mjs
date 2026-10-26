// `drawnFrame()`: the element reports the frame it drew (dev-docs/adr/0013-the-element-reports-the-frame-it-drew.md;
// the criteria are dev-docs/overlay-geometry-plan.md's, numbered as there).
//
// THE ORACLE IS THE PICTURE. A sticker the record calls clean is read off the canvas, and its colour must be
// the one cube-oracle gives its slot under the scramble — never one the element reports. The palette is the
// app's own table (lib/sticker-palettes.js), which the element paints from but does not decide.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { STICKER_PALETTES } from '../../lib/sticker-palettes.js';
import { eyeDirection, fitDistance, fitDistanceStable, silhouette } from '../../lib/cube-kit.js';
import { SOLVED_FACELETS, STICKERS, applyMoves } from '../cube-oracle.mjs';
import { MANIFEST, installPublicCube } from './public-cube.mjs';
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

const SCRAMBLE = "R U F' L2 D B' R' U2 F L' D2 B R2";
const EXPECTED = applyMoves(SOLVED_FACELETS, SCRAMBLE);
const IDS = STICKERS.map((s, i) => `${s.face}${(i % 9) + 1}`);
/** The plan's grazing limit: a sticker turned further than 77° from the eye is not read. */
const FACING = Math.cos((77 * Math.PI) / 180);

/** Mount a fresh element through the public proxy, its clock pinned, and wait for a frame it drew. */
const build = (attrs, { width = 300, height = 300 } = {}) => page.evaluate(async ({ a, width, height }) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;z-index:99999`;
  const cube = window.__publicCube(el);
  for (const [k, v] of Object.entries(a)) cube.setAttribute(k, v);
  el.clock = 1_000_000;
  window.__cube = el;
  window.__pub = cube;
  document.body.appendChild(el);
  // Until a frame has been drawn: the record exists only BECAUSE a draw happened.
  for (let i = 0; i < 60 && !cube.drawnFrame(); i++) await new Promise((r) => requestAnimationFrame(() => r()));
  if (!cube.drawnFrame()) throw new Error('no frame drawn in 60 animation frames');
}, { a: attrs, width, height });

/**
 * The record and, in the same task, the canvas it describes: a 5×5 grid inside each reported quad (inset
 * 20%), read from the drawing buffer. Nothing is redrawn — `preserveDrawingBuffer` keeps the last frame, and
 * the record is of the last frame.
 */
const shot = () => page.evaluate(() => {
  const el = window.__cube;
  const rec = window.__pub.drawnFrame();
  const canvas = el.querySelector('canvas');
  const c2 = document.createElement('canvas');
  c2.width = canvas.width; c2.height = canvas.height;
  const g = c2.getContext('2d');
  g.drawImage(canvas, 0, 0);
  const px = g.getImageData(0, 0, c2.width, c2.height).data;
  const scale = canvas.width / el.clientWidth;
  const at = (x, y) => {
    const i = (Math.floor(y * scale) * c2.width + Math.floor(x * scale)) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  const steps = [0.2, 0.35, 0.5, 0.65, 0.8];
  const samples = (rec?.views ?? []).map((v) => (v.stickers ?? []).map(({ corners: [c0, c1, c2_, c3] }) =>
    steps.flatMap((u) => steps.map((w) => {
      const x = (1 - u) * (1 - w) * c0[0] + u * (1 - w) * c1[0] + u * w * c2_[0] + (1 - u) * w * c3[0];
      const y = (1 - u) * (1 - w) * c0[1] + u * (1 - w) * c1[1] + u * w * c2_[1] + (1 - u) * w * c3[1];
      return at(x, y);
    }))));
  return { rec: JSON.parse(JSON.stringify(rec)), samples };
});

// --- Colour: a lit sticker is `k · albedo + s` in linear light. ----------------------------------------------
//
// `k` is how much light a face gets, measured from the picture per face of each view as the median over its
// stickers of each one's own fit against the oracle's albedo for its slot; a median over a face's stickers is
// not moved by the few a mark lies over. `s` is the near-white a specular highlight adds, and it moves across a
// face, so it is fitted per pixel (`fitPixel`). A pixel then READS the palette colour nearest to it (`classify`).

const linear = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const hex = (h) => [1, 3, 5].map((i) => linear(parseInt(h.slice(i, i + 2), 16)));
const PALETTE = Object.fromEntries(Object.entries(STICKER_PALETTES.muted).map(([k, h]) => [k, hex(h)]));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** The least-squares `k` of `p ≈ k · c + s` over a set of pixels of one albedo `c`. */
function fitLight(pixels, c) {
  let n = 0; let sc = 0; let scc = 0; let sp = 0; let spc = 0;
  for (const rgb of pixels) {
    rgb.slice(0, 3).forEach((v, ch) => { const x = linear(v); n++; sc += c[ch]; scc += c[ch] ** 2; sp += x; spc += x * c[ch]; });
  }
  return (n * spc - sc * sp) / (n * scc - sc * sc);
}

/** Each face's light in view `vi`, keyed by the face letter of the slots on it. */
function lightsOf({ rec, samples }, vi) {
  const fits = {};
  rec.views[vi].stickers.forEach((st, i) => {
    if (st.facing <= FACING) return;
    (fits[st.id[0]] ||= []).push(fitLight(samples[vi][i], PALETTE[EXPECTED[i]]));
  });
  return Object.fromEntries(Object.entries(fits).map(([f, xs]) => [f, { k: median(xs) }]));
}

/**
 * The least squares `p ≈ k · c + s` with `k` in [lo, hi] and `s >= 0`: a specular highlight only adds light,
 * and it moves across a face (the top face, near the key light's reflection, most), so it is the pixel's own.
 * The minimum is the free one when that is feasible, else on an edge of the feasible set.
 */
function fitPixel(p, c, lo, hi) {
  const n = 3; const sc = c[0] + c[1] + c[2]; const scc = c[0] ** 2 + c[1] ** 2 + c[2] ** 2;
  const sp = p[0] + p[1] + p[2]; const spc = p[0] * c[0] + p[1] * c[1] + p[2] * c[2];
  const err = (k, a) => Math.hypot(...p.map((x, ch) => x - k * c[ch] - a));
  const clampK = (k) => Math.min(hi, Math.max(lo, k));
  const det = n * scc - sc * sc;
  const candidates = [];
  if (det > 1e-12) {
    const k = (n * spc - sc * sp) / det; const a = (sp - k * sc) / n;
    if (k >= lo && k <= hi && a >= 0) candidates.push([k, a]);
  }
  for (const k of [lo, hi]) candidates.push([k, Math.max(0, (sp - k * sc) / n)]);
  candidates.push([clampK(spc / scc), 0]);
  return Math.min(...candidates.map(([k, a]) => err(k, a)));
}

/**
 * The palette letter a pixel is under a face's `light`, and how far it is from it relative to its brightness:
 * `k` held within a band of the face's, so a dark pixel cannot pass for any colour, and the specular white the
 * pixel's own (`fitPixel`).
 */
function classify(rgb, light) {
  const p = rgb.slice(0, 3).map(linear);
  const norm = Math.hypot(...p) || 1;
  let best = null;
  for (const [letter, c] of Object.entries(PALETTE)) {
    const r = fitPixel(p, c, light.k / BAND, light.k * BAND) / norm;
    if (!best || r < best.r) best = { letter, r };
  }
  return best;
}
/** How far one pixel's light may stray from its face's, as a factor; and how far a pixel may sit from its fit. */
const BAND = 1.35;
const RESIDUAL = 0.1;
const reads = (rgb, letter, light) => {
  const c = classify(rgb, light);
  return c.letter === letter && c.r < RESIDUAL;
};

/** Every sticker of view `vi` reported clean and facing, with any grid pixel that does not read its slot. */
function cleanStickers(shotData, vi) {
  const { rec, samples } = shotData;
  const lights = lightsOf(shotData, vi);
  const out = [];
  rec.views[vi].stickers.forEach((s, i) => {
    if (s.covered.length || s.facing <= FACING) return;
    const light = lights[s.id[0]];
    const bad = samples[vi][i].filter((rgb) => !reads(rgb, EXPECTED[i], light)).map((rgb) => [rgb, classify(rgb, light)]);
    out.push({ id: s.id, bad });
  });
  return out;
}

const assertClean = (shotData, vi, what) => {
  const clean = cleanStickers(shotData, vi);
  const wrong = clean.filter((s) => s.bad.length).map((s) =>
    `${s.id} wants ${EXPECTED[IDS.indexOf(s.id)]}: ${s.bad.slice(0, 3).map(([p, c]) => `${JSON.stringify(p)}=${c.letter}/${c.r.toFixed(3)}`).join(' ')}`);
  assert.deepEqual(wrong, [], `${what}: stickers reported clean whose pixels are not their slot's colour`);
  return clean;
};

/** Grid pixels of sticker `i` in view `vi` that do not read its slot's colour. */
const offColour = (shotData, vi, i) => {
  const light = lightsOf(shotData, vi)[shotData.rec.views[vi].stickers[i].id[0]];
  return shotData.samples[vi][i].filter((rgb) => !reads(rgb, EXPECTED[i], light));
};

// --- Independent geometry, for what the record says covers what. ------------------------------------------

/** Positive-area overlap of two convex polygons by separating axes: touching along an axis separates. */
function overlapPositive(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]; const [x1, y1] = poly[(i + 1) % poly.length];
      const n = [y0 - y1, x1 - x0];
      const len = Math.hypot(...n);
      if (len < 1e-9) continue;
      const span = (p) => p.map(([x, y]) => (x * n[0] + y * n[1]) / len);
      const sa = span(a); const sb = span(b);
      if (Math.min(Math.max(...sa), Math.max(...sb)) - Math.max(Math.min(...sa), Math.min(...sb)) <= 1e-6) return false;
    }
  }
  return true;
}

// --- 1, 9 -----------------------------------------------------------------------------------------------------

test('null before the first draw; a deep-frozen record of 54 world slots after it', async () => {
  const before = await page.evaluate(() => {
    const el = document.createElement('cubus-cube');
    const cube = window.__publicCube(el);
    return cube.drawnFrame();
  });
  assert.equal(before, null);
  await build({ scramble: SCRAMBLE });
  const result = await page.evaluate(() => {
    const rec = window.__pub.drawnFrame();
    const frozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => !v || typeof v !== 'object' || frozen(v));
    const writes = [
      () => { 'use strict'; rec.revision = -1; },
      () => { 'use strict'; rec.views[0].stickers[0].corners[0][0] = -1; },
      () => { 'use strict'; rec.views[0].stickers[0].covered.push('arrow'); },
      () => { 'use strict'; rec.views[0].camera.eye[0] = 0; },
    ].map((w) => { try { w(); return 'wrote'; } catch (e) { return e instanceof TypeError ? 'threw' : String(e); } });
    return { frozen: frozen(rec), writes, rec: JSON.parse(JSON.stringify(rec)) };
  });
  assert.equal(result.frozen, true);
  assert.deepEqual(result.writes, ['threw', 'threw', 'threw', 'threw']);
  const { rec } = result;
  assert.equal(rec.settled, true);
  assert.deepEqual(rec.views.map((v) => v.role), ['main']);
  assert.deepEqual(rec.views[0].rect, { x: 0, y: 0, width: 300, height: 300 });
  assert.deepEqual(rec.views[0].stickers.map((s) => s.id), IDS);
});

test('public: drawnFrame is a manifest method, and the proxy lets a consumer call it', async () => {
  assert.ok(MANIFEST.methods.includes('drawnFrame'));
  assert.deepEqual(MANIFEST.events, ['cubus-step']);
  await build({ scramble: SCRAMBLE });
  assert.equal(await page.evaluate(() => typeof window.__pub.drawnFrame().revision), 'number');
});

// --- 2, 3 -----------------------------------------------------------------------------------------------------

test('every clean, facing sticker reads its slot colour, with every mark kind on', async () => {
  await build({ scramble: SCRAMBLE, alg: "F R U R' U' F'", trail: 'piece:UF', labels: 'position', arrow: 'L', ghosts: 'on', 'back-view': 'top-right' });
  const s = await shot();
  const clean = assertClean(s, 0, 'main view');
  const kinds = new Set(s.rec.views[0].stickers.flatMap((x) => x.covered));
  console.log('# kinds covering the main view:', [...kinds].join(' '), '| clean facing:', clean.length);
  assert.ok(clean.length >= 8, `only ${clean.length} clean facing stickers — the check would be near vacuous`);
});

test('labels: position — every facing centre carries "label", and each shows a pixel that is not its colour', async () => {
  await build({ scramble: SCRAMBLE, labels: 'position' });
  const s = await shot();
  const stickers = s.rec.views[0].stickers;
  const centres = stickers.map((x, i) => [x, i]).filter(([x]) => x.id.endsWith('5') && x.facing > FACING);
  assert.equal(centres.length, 3, 'three faces are seen from the default eye');
  for (const [x, i] of centres) {
    assert.ok(x.covered.includes('label'), `${x.id} is under its letter: ${JSON.stringify(x.covered)}`);
    assert.ok(offColour(s, 0, i).length > 0, `${x.id}: the letter changes no pixel the grid reads`);
  }
  assertClean(s, 0, 'labels');
});

test('arrow: L — U7 carries "arrow"', async () => {
  await build({ scramble: SCRAMBLE, arrow: 'L' });
  const s = await shot();
  const u7 = s.rec.views[0].stickers[IDS.indexOf('U7')];
  assert.ok(u7.covered.includes('arrow'), JSON.stringify(u7));
  assertClean(s, 0, 'arrow');
});

test('trail: piece:UF — the trail widens the drawn fit past the cues-only fit, a sticker carries "trail", the rest are clean', async () => {
  const attrs = { scramble: SCRAMBLE, alg: "F R U R' U' F'", trail: 'piece:UF' };
  // The fit the cues alone give, as the element would compute it: ghosts off (the default), so no elevation,
  // and the culled fit, because nothing asks for `camera-fit: stable` and the cube is upright.
  const kit = (camera, rect) => fitDistance({
    points: silhouette({ eye: eyeDirection(35, 45), elevation: null, scale: 0.9, cull: true }),
    vfovDeg: camera.vfovDeg, aspect: rect.width / rect.height, eye: eyeDirection(35, 45), worldUp: [0, 1, 0],
  });
  await build({ scramble: attrs.scramble, alg: attrs.alg });
  const plain = (await shot()).rec.views[0];
  const d0 = Math.hypot(...plain.camera.eye);
  const k = kit(plain.camera, plain.rect);
  assert.ok(Math.abs(d0 - k) / k < 1e-9, `with no trail the drawn |eye| ${d0} is not the cues-only fit ${k}`);
  await build(attrs);
  const s = await shot();
  const d = Math.hypot(...s.rec.views[0].camera.eye);
  assert.ok(d > k * (1 + 1e-3), `|eye| ${d} is not past the cues-only fit ${k}: the trail did not widen the fit`);
  // Nor is it the other fit a cues-only reader could pick, the stable one (no culling, the bounding sphere).
  const ks = fitDistanceStable({
    points: silhouette({ eye: eyeDirection(35, 45), elevation: null, scale: 0.9, cull: false }),
    vfovDeg: s.rec.views[0].camera.vfovDeg, aspect: s.rec.views[0].rect.width / s.rec.views[0].rect.height,
  });
  assert.ok(Math.abs(d - ks) / ks > 1e-3, `|eye| ${d} is the cues-only stable fit ${ks}`);
  const trailed = s.rec.views[0].stickers.filter((x) => x.covered.includes('trail')).map((x) => x.id);
  assert.ok(trailed.length > 0, 'no sticker carries "trail"');
  console.log('# under the trail:', trailed.join(' '));
  assertClean(s, 0, 'trail');
  // `piece:UF`'s tube only grazes U1's edge from this eye, which the grid never reads. `slot:UF`'s is drawn
  // across the inside of stickers, so there a trail left out of the cover is seen in the pixels.
  await build({ ...attrs, trail: 'slot:UF' });
  const across = await shot();
  const inked = across.rec.views[0].stickers.filter((x, i) => x.facing > FACING && offColour(across, 0, i).length > 0);
  assert.ok(inked.some((x) => x.covered.includes('trail')), 'no sticker\'s pixels show the slot:UF tube — this scene would be vacuous');
  assertClean(across, 0, 'trail across stickers');
});

// --- 4 --------------------------------------------------------------------------------------------------------

test('must-not, depth: a trail passing BEHIND the body covers none of the stickers its outline crosses', async () => {
  // The B turn carries whatever sits at UB round the back face; from the default eye its trail floats behind
  // the cube.
  await build({ scramble: SCRAMBLE, alg: 'B', trail: 'slot:UB', ghosts: 'none' });
  const s = await shot();
  // The trail's 2D outline, projected here from its own meshes with the element's camera — not from the
  // record, which is what is being checked.
  const tris = await page.evaluate(() => {
    const el = window.__cube;
    el.scene.updateMatrixWorld(true);
    const V = el.camera.position.constructor;
    const w = el.clientWidth; const h = el.clientHeight;
    const out = [];
    for (const mesh of el._trailMeshes) {
      const pos = mesh.geometry.attributes.position; const idx = mesh.geometry.index;
      const n = idx ? idx.count : pos.count;
      const at = (k) => {
        const p = new V().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(mesh.matrixWorld).project(el.camera);
        return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h];
      };
      for (let k = 0; k + 2 < n; k += 3) out.push([at(k), at(k + 1), at(k + 2)]);
    }
    return out;
  });
  assert.ok(tris.length > 0, 'the trail drew nothing');
  const stickers = s.rec.views[0].stickers;
  const crossed = stickers.map((x, i) => [x, i]).filter(([x]) => x.facing > FACING && tris.some((t) => overlapPositive(x.corners, t)));
  console.log('# outline crosses:', crossed.map(([x]) => x.id).join(' '));
  assert.ok(crossed.length > 0, 'the trail\'s outline crosses no facing sticker — this case would prove nothing');
  for (const [x, i] of crossed) {
    assert.ok(!x.covered.includes('trail') && !x.covered.includes('numeral'), `${x.id} is behind the trail's outline, not under it: ${JSON.stringify(x.covered)}`);
    assert.deepEqual(offColour(s, 0, i), [], `${x.id}: pixels under a trail drawn behind the body`);
  }
});

// --- 6 --------------------------------------------------------------------------------------------------------

test('back view top-right: two views, the inset rect in CSS px from the top, inset cover, and the back camera\'s pixels', async () => {
  const W = 260; const H = 220;
  await build({ scramble: SCRAMBLE, alg: "F R U R' U' F'", trail: 'piece:UF', 'back-view': 'top-right' }, { width: W, height: H });
  const s = await shot();
  assert.deepEqual(s.rec.views.map((v) => v.role), ['main', 'back']);
  const iw = Math.floor(0.32 * W); const ih = Math.floor(0.32 * H);
  const back = s.rec.views[1].rect;
  assert.deepEqual(back, { x: W - iw - 10, y: 10, width: iw, height: ih });
  const r = [[back.x, back.y], [back.x + iw, back.y], [back.x + iw, back.y + ih], [back.x, back.y + ih]];
  const main = s.rec.views[0].stickers;
  const meets = main.filter((x) => overlapPositive(x.corners, r)).map((x) => x.id);
  assert.ok(meets.length > 0, 'no main-view sticker meets the inset at this size — the inset case would be vacuous');
  assert.deepEqual(main.filter((x) => x.covered.includes('inset')).map((x) => x.id), meets);
  assert.ok(s.rec.views[1].stickers.every((x) => !x.covered.includes('inset')), 'the back view is not under itself');
  assertClean(s, 0, 'main view under the inset');
  const clean = assertClean(s, 1, 'back view');
  assert.ok(clean.length >= 8, `only ${clean.length} clean facing stickers in the back view`);
});

// Each view draws the ghosts of the faces turned from ITS eye, out beyond those faces and so behind the body
// from that eye: the main view's float in front of the faces the back view shows. A record that read the
// ghosts once for both views would report the back view's stickers under the main view's ghosts.
test('back view top-right with ghosts: each view reports the ghosts it drew, and reads clean', async () => {
  // Larger than the case above: ghosts widen the fit, and at 260 px the inset's stickers are a few pixels.
  await build({ scramble: SCRAMBLE, ghosts: 'on', 'back-view': 'top-right' }, { width: 520, height: 440 });
  const s = await shot();
  const drawn = await page.evaluate(() => window.__cube._ghostMeshes.filter((g) => g.visible).length);
  assert.ok(drawn > 0, 'no ghost is drawn — the case would be vacuous');
  for (const [vi, v] of s.rec.views.entries()) {
    assert.deepEqual(v.stickers.filter((x) => x.covered.includes('ghost')).map((x) => x.id), [], `${v.role}: under a ghost`);
    assertClean(s, vi, `${v.role} view with ghosts`);
  }
});

// A ghost hangs beyond the face the eye cannot see, at most 1.43 out sideways, so at any elevation >= 0 it is
// never nearer than a sticker the eye sees, whose plane is 1.5 out. A negative elevation, which the element
// accepts, carries the ghosts back through the cube and out past the opposite face: in front of stickers the eye
// sees, drawn over them.
test('ghost: a ghost drawn in front of seen stickers covers them, and the pixels show it', async () => {
  await build({ scramble: SCRAMBLE, ghosts: 'on', 'ghost-elevation': '-10' });
  const s = await shot();
  const under = s.rec.views[0].stickers.map((x, i) => [x, i]).filter(([x]) => x.facing > FACING && x.covered.includes('ghost'));
  assert.ok(under.length > 0, 'no seen sticker carries "ghost" — the case would be vacuous');
  for (const [x, i] of under) assert.ok(offColour(s, 0, i).length > 0, `${x.id} carries "ghost" and no pixel the grid reads shows one`);
  assertClean(s, 0, 'ghosts in front');
});

test('back view side-by-side: the two rects tile the width exactly', async () => {
  const W = 321; const H = 200;
  await build({ scramble: SCRAMBLE, 'back-view': 'side-by-side' }, { width: W, height: H });
  const s = await shot();
  const left = Math.floor(W / 2);
  assert.deepEqual(s.rec.views.map((v) => [v.role, v.rect]), [
    ['main', { x: 0, y: 0, width: left, height: H }],
    ['back', { x: left, y: 0, width: W - left, height: H }],
  ]);
  assertClean(s, 0, 'side-by-side main');
  assertClean(s, 1, 'side-by-side back');
});

// --- 7, 8 -----------------------------------------------------------------------------------------------------

// Disposed by the release timer and connected again, the element builds a new scene and draws the very frame
// it drew before. The record must come back, under a revision the old one never had.
test('dispose, then connect again: the same frame drawn again is recorded, under a fresh revision', async () => {
  await build({ scramble: "R U F'" });
  const out = await page.evaluate(async () => {
    const el = window.__cube;
    const before = el.drawnFrame().revision;
    el.remove();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const disposed = el.scene == null;
    const whileDisposed = el.drawnFrame();
    document.body.appendChild(el);
    el.clock = 1_000_000;
    for (let i = 0; i < 60 && !el.drawnFrame(); i++) await new Promise((r) => requestAnimationFrame(() => r()));
    const rec = el.drawnFrame();
    return { before, disposed, whileDisposed, after: rec && rec.revision, stickers: rec?.views[0].stickers?.length };
  });
  assert.equal(out.disposed, true, 'the release timer did not dispose the element — the case would test nothing');
  assert.equal(out.whileDisposed, null, 'a disposed element reports no frame');
  assert.notEqual(out.after, null, 'no record after the element drew again');
  assert.ok(out.after > out.before, `revision ${out.after} is not fresh after ${out.before}`);
  assert.equal(out.stickers, 54);
});

test('in flight: unsettled, no stickers, camera and rect still there; settled again when the turn lands', async () => {
  await build({ scramble: SCRAMBLE, alg: 'R' });
  const mid = await page.evaluate(async () => {
    const el = window.__cube;
    window.__pub.step();
    await new Promise((r) => requestAnimationFrame(() => r()));
    // The turn's first frame, clock not advanced: every sticker still sits on its slot, and the layer is in flight.
    const start = { animating: window.__pub.animating, settled: window.__pub.drawnFrame().settled };
    el.clock = 1_000_000 + 60;
    await new Promise((r) => requestAnimationFrame(() => r()));
    return { start, animating: window.__pub.animating, rec: JSON.parse(JSON.stringify(window.__pub.drawnFrame())) };
  });
  assert.deepEqual(mid.start, { animating: true, settled: false }, 'a layer in flight on its slots is still in flight');
  assert.equal(mid.animating, true, 'the turn is in flight at the pinned clock');
  assert.equal(mid.rec.settled, false);
  assert.equal(mid.rec.views[0].stickers, null);
  assert.equal(mid.rec.views[0].camera.eye.length, 3);
  assert.deepEqual(mid.rec.views[0].rect, { x: 0, y: 0, width: 300, height: 300 });
  const end = await page.evaluate(async () => {
    window.__cube.clock = 1_000_000 + 60_000;
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(() => r()));
    return { animating: window.__pub.animating, rec: JSON.parse(JSON.stringify(window.__pub.drawnFrame())) };
  });
  assert.equal(end.animating, false);
  assert.equal(end.rec.settled, true);
  assert.equal(end.rec.views[0].stickers.length, 54);
  assert.notEqual(end.rec.revision, mid.rec.revision);
});

test('revision: a highlight pulse redraws and keeps it; an arrow change is not reported until it is drawn', async () => {
  await build({ scramble: SCRAMBLE, highlight: 'corners' });
  const pulse = await page.evaluate(async () => {
    const el = window.__cube;
    const pixels = () => {
      const c = el.querySelector('canvas');
      const g = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }).getContext('2d');
      g.drawImage(c, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const r0 = window.__pub.drawnFrame();
    const p0 = pixels();
    el.clock = 1_000_000 + 300;
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r()));
    const p1 = pixels();
    let changed = 0;
    for (let i = 0; i < p0.length; i++) if (p0[i] !== p1[i]) changed++;
    return { r0: r0.revision, r1: window.__pub.drawnFrame().revision, same: r0 === window.__pub.drawnFrame(), changed };
  });
  assert.ok(pulse.changed > 0, 'the pulse redrew nothing, so this case proves nothing');
  assert.equal(pulse.r1, pulse.r0);
  assert.equal(pulse.same, true, 'an unchanged revision is the same record');
  const arrow = await page.evaluate(async () => {
    const before = window.__pub.drawnFrame();
    window.__pub.setAttribute('arrow', 'R');
    const undrawn = window.__pub.drawnFrame();
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r()));
    const drawn = window.__pub.drawnFrame();
    return {
      undrawnSame: undrawn === before,
      before: before.revision,
      after: drawn.revision,
      arrowed: drawn.views[0].stickers.filter((x) => x.covered.includes('arrow')).length,
    };
  });
  assert.equal(arrow.undrawnSame, true, 'read before the next draw, the record is what is on screen');
  assert.notEqual(arrow.after, arrow.before);
  assert.ok(arrow.arrowed > 0, 'the drawn arrow covers a sticker');
});

// --- cost (reported, not asserted: the plan's open measurement) ----------------------------------------------

test('cost: building the record for a long trail', async () => {
  await build({
    scramble: SCRAMBLE, alg: "R U R' U' R' F R2 U' R' U' R U R' F' R U R' U' R' F R F'",
    trail: 'piece:UF,piece:UR,piece:UFR,piece:URB', labels: 'position', 'back-view': 'top-right',
  });
  const m = await page.evaluate(() => {
    const el = window.__cube;
    const runs = [];
    for (let i = 0; i < 5; i++) {
      el._frameRecord = null;
      const t0 = performance.now();
      window.__pub.drawnFrame();
      runs.push(performance.now() - t0);
    }
    const marks = el._drawn.reduce((n, v) => n + (v.marks?.length ?? 0), 0);
    const tris = el._drawn.reduce((n, v) => n + (v.marks ?? []).reduce((k, mk) => k + (mk.geometry.index ?? mk.geometry.attributes.position).count / 3, 0), 0);
    return { runs, marks, tris, trails: el._trailMeshes.length };
  });
  console.log(`# drawnFrame() build: ${m.runs.map((r) => r.toFixed(1)).join(', ')} ms over ${m.marks} marks (${m.trails} trail meshes), ~${Math.round(m.tris)} triangles, two views`);
  assert.ok(m.trails > 0);
});

