// What the renderer costs to draw, as ceilings — Stage 0 §3b of dev-docs/renderer-v2-plan.md.
//
// WHAT IT IS FOR. The plan's later stages are about making the cube cheaper to draw, and the
// failure mode of such work is silence: an instancing stage that quietly did not instance leaves
// every existing test green, because nothing in `apps/web` counts what the GPU was asked to do.
// These are that count. They are CEILINGS, not equalities — work that makes the cube cheaper must
// not have to edit its own gate to land, and work that makes it dearer has to say so here first.
//
// The numbers are §1's measured baseline, re-measured on this branch after the pose work:
// 188 drawables (26 bodies + 54 stickers + 54 ghosts + 54 ghost-edge lines), 110 materials,
// 4 geometries, 4 programs, 57,132 triangles, and 161 draw calls a frame with ghosts on against
// 80 with them off.
//
// The composition is asserted as well as the totals. A total alone passes a scene that has traded
// fifty stickers for fifty ghosts, which is a different cube drawn at the same price.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/** §1's table. Every entry is "no more than this". */
const BUDGET = Object.freeze({
  drawables: 188,
  materials: 110,
  geometries: 4,
  programs: 4,
  triangles: 57_132,
  callsWithGhosts: 161,
  callsWithoutGhosts: 80,
});

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

/**
 * Build a cube, draw one frame, and report what the draw cost.
 *
 * `renderer.info.render` is reset per frame by three, so the counts are read after a frame that
 * definitely happened — `_dirty` is forced, and the read waits a further frame so the numbers
 * belong to a complete render rather than to whatever half of one the previous test left.
 */
const cost = (attrs) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:320px;z-index:99999';
  for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
  el._dirty = true;
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => requestAnimationFrame(() => r()));

  const kinds = { mesh: 0, line: 0, other: 0 };
  const materials = new Set();
  const geometries = new Set();
  el.scene.traverse((o) => {
    if (o.isMesh) kinds.mesh++;
    else if (o.isLine || o.isLineSegments) kinds.line++;
    else if (o.isLight || o.isScene || o.type === 'Group' || o.type === 'Object3D') return;
    else kinds.other++;
    if (o.material) for (const m of [o.material].flat()) materials.add(m.uuid);
    if (o.geometry) geometries.add(o.geometry.uuid);
  });
  const info = el.renderer.info;
  return {
    drawables: kinds.mesh + kinds.line,
    meshes: kinds.mesh,
    lines: kinds.line,
    other: kinds.other,
    materials: materials.size,
    geometries: geometries.size,
    programs: info.programs?.length ?? 0,
    calls: info.render.calls,
    triangles: info.render.triangles,
  };
}, attrs);

test('a cube with ghosts draws inside its budget', async () => {
  const c = await cost({ facelets: SOLVED, ghosts: 'on', 'ghost-elevation': '9', 'camera-fit': 'stable' });
  assert.ok(c.calls <= BUDGET.callsWithGhosts,
    `${c.calls} draw calls a frame, budget ${BUDGET.callsWithGhosts} — the scene got dearer to draw`);
  assert.ok(c.triangles <= BUDGET.triangles,
    `${c.triangles} triangles, budget ${BUDGET.triangles}`);
  assert.ok(c.materials <= BUDGET.materials,
    `${c.materials} materials, budget ${BUDGET.materials}`);
  assert.ok(c.geometries <= BUDGET.geometries,
    `${c.geometries} geometries, budget ${BUDGET.geometries} — geometry sharing has been lost`);
  assert.ok(c.programs <= BUDGET.programs,
    `${c.programs} shader programs, budget ${BUDGET.programs}`);
});

test('turning the ghosts off halves the draw calls, and they come back on', async () => {
  const off = await cost({ facelets: SOLVED, ghosts: 'none', 'camera-fit': 'stable' });
  assert.ok(off.calls <= BUDGET.callsWithoutGhosts,
    `${off.calls} draw calls with no ghosts, budget ${BUDGET.callsWithoutGhosts}`);
  // Not a ceiling: a scene that draws the same number with ghosts on and off is one where the
  // ghost cull has stopped working, and every ceiling above would still pass.
  const on = await cost({ facelets: SOLVED, ghosts: 'on', 'ghost-elevation': '9', 'camera-fit': 'stable' });
  assert.ok(on.calls > off.calls,
    `ghosts on drew ${on.calls} calls and ghosts off drew ${off.calls} — the ghosts are not being drawn`);
});

// The composition, not just the total. A cube that has swapped stickers for ghosts, or collapsed
// its 54 sticker materials into one shared grey, costs about the same and is a different picture.
test('the scene is the cube it is meant to be: 26 bodies, 54 stickers, 54 ghosts and their outlines', async () => {
  const c = await cost({ facelets: SOLVED, ghosts: 'on', 'ghost-elevation': '9' });
  assert.equal(c.meshes, 26 + 54 + 54, `${c.meshes} meshes — expected 26 bodies, 54 stickers, 54 ghosts`);
  assert.equal(c.lines, 54, `${c.lines} line objects — expected one outline per ghost`);
  assert.equal(c.other, 0, 'the scene has grown a drawable that is neither a mesh nor a line');
  assert.ok(c.drawables <= BUDGET.drawables, `${c.drawables} drawables, budget ${BUDGET.drawables}`);
  // One material per sticker and one per ghost is what the plan's A2 proposes to remove. Until it
  // does, a DROP here is as interesting as a rise: it means two stickers are sharing a colour.
  assert.ok(c.materials >= 108, `${c.materials} materials — stickers or ghosts have stopped owning their own`);
});

test('a cube nobody has touched draws nothing at all', async () => {
  // The renderer draws on demand (`if (moving || this._dirty)`), which is why the frame cost above
  // is paid only while something is happening. A cube at rest that keeps drawing is a battery
  // leak on every screen that parks one, and no other test would notice.
  const idle = await page.evaluate(async () => {
    const el = window.__cube;
    el._dirty = false;
    await new Promise((r) => requestAnimationFrame(() => r()));
    const was = el.renderer.info.render.frame;
    for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(() => r()));
    return el.renderer.info.render.frame - was;
  });
  assert.equal(idle, 0, `a still cube drew ${idle} frames in five animation frames`);
});
