// A drill round's reveal on the real `<cubus-cube>` — plan item 3.4 of dev-docs/tutorial-capability-plan.md.
//
// The claim cubus-im's prediction verifier exists for, made about the event driver: the drill says where a
// piece WILL be, and then plays the turn — so the lit piece has to land there. If those two ever disagreed
// the drill would teach a child to distrust their own correct answer. And the recognition reveal lights the
// piece's HOME slot, not the slot it is sitting in. Driven through the manifest proxy; read off the scene.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { slotVector } from '../../lib/cube-highlight.js';
import { PREDICTION, RECOGNITION, predictionScript, recognitionScript } from '../fixtures/cubus-im-drills.mjs';
import { installPublicCube } from './public-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

const ROUND = 2;
let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  await installPublicCube(page);
  await page.addScriptTag({
    type: 'module',
    content: `
      import { buildScript } from '/lib/script-view.js';
      import { createEventDriver } from '/lib/script-rounds.js';
      window.__drill = (doc) => {
        const el = document.createElement('cubus-cube');
        el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
        el.clock = 1_000_000;
        if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
        document.body.appendChild(el);
        window.__cube = el;
        window.__driver = createEventDriver(buildScript(doc), { cube: window.__publicCube(el) });
      };
    `,
  });
  await page.waitForFunction(() => typeof window.__drill === 'function');
});

after(async () => { await fixture?.close(); });

const settle = () => page.evaluate(async () => {
  const el = window.__cube;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let i = 0; i < 60; i++) {
    el.clock = el._now() + 500;
    await frame();
    if (!el._anim && !el._queue.length) { await frame(); return; }
  }
  throw new Error('still animating');
});
/**
 * What the child sees: the colour at every facelet position in the world.
 *
 * Not the cubies' matrices, because a reveal re-loads the cube it is about from its stickers — a painted
 * cube stands every cubie at home in its painted colours, where a scrambled one moved the cubies — and the
 * two are the same picture through different geometry. Colour at a place is the picture.
 */
const picture = () => page.evaluate(() => {
  const el = window.__cube;
  el.root.updateMatrixWorld(true);
  const V = el.stickers[0].position.constructor;
  return el.stickers.map((m) => {
    const s = m.getWorldPosition(new V());
    return `${[s.x, s.y, s.z].map((v) => Math.round(v * 100) + 0).join(',')}=${m.material.color.getHex()}`;
  }).sort();
});

/** Where each lit cubie stands, in the cube's own coordinates. A test seam: it reads the scene. */
const lit = () => page.evaluate(() => [...new Set([...(window.__cube._hlSet ?? [])].map((m) => m.parent))]
  .map((c) => [c.position.x, c.position.y, c.position.z].map((v) => Math.round(v) + 0)));

/** Load a round, answer it right, and play its reveal to the end. */
async function answerAndReveal(doc, faces) {
  await page.evaluate((d) => window.__drill(d), doc);
  await page.evaluate((k) => window.__driver.seek(k), ROUND);
  await settle();
  const before = { lit: await lit(), picture: await picture() };
  for (const f of faces) await page.evaluate((x) => window.__driver.select(x), f);
  const verdict = await page.evaluate(() => window.__driver.round.verdict);
  for (let left = 1, guard = 0; left > 0 && guard < 10; guard++) {
    left = await page.evaluate(() => window.__driver.reveal());
    await settle();
  }
  return { before, verdict, after: { lit: await lit(), picture: await picture() } };
}

test('a prediction\'s reveal plays the turn, and the lit piece lands where the answer said', async () => {
  for (const r of PREDICTION.filter((x) => x.moves)) {
    const { before, verdict, after } = await answerAndReveal(predictionScript(r), r.dest);
    assert.equal(verdict, 'right', `${r.piece} after ${r.turn}: the right answer was marked ${verdict}`);
    assert.deepEqual(before.lit, [slotVector(r.slot)], `${r.piece} was not lit where it sits before the turn`);
    assert.deepEqual(after.lit, [slotVector(r.dest.join(''))], `${r.piece} after ${r.turn} is lit at ${JSON.stringify(after.lit)}, not ${r.dest.join('')}`);
    assert.notDeepEqual(after.picture, before.picture, 'the reveal did not turn the cube');
  }
});

test('a turn that does not touch the piece is revealed with the piece where it already was', async () => {
  const r = PREDICTION.find((x) => !x.moves);
  const { verdict, after } = await answerAndReveal(predictionScript(r), r.dest);
  assert.equal(verdict, 'right');
  assert.deepEqual(after.lit, [slotVector(r.slot)], `${r.turn} moved the lit ${r.piece} out of ${r.slot}`);
});

test('a recognition reveal moves nothing and lights the home slot — UL, not BL where the piece sits', async () => {
  const r = RECOGNITION[0];
  assert.equal(`${r.piece} in ${r.slot}`, 'UL in BL', 'precondition: the round the acceptance names');
  const { before, verdict, after } = await answerAndReveal(recognitionScript(r), r.home);
  assert.equal(verdict, 'right');
  assert.deepEqual(before.lit, [slotVector('BL')], 'the question did not light the slot being asked about');
  assert.deepEqual(after.picture, before.picture, 'a recognition reveal changed the picture — it moved the cube');
  assert.deepEqual(after.lit, [slotVector('UL')], `the reveal lit ${JSON.stringify(after.lit)} — the piece's home is UL`);
});
