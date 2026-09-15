// The tutorial corpus, element half: what `<cubus-cube>` DRAWS, read back as a child would see it and
// compared with an oracle that shares no code with it.
//
// dev-docs/tutorial-capability-plan.md items 0.2 and 0.3. The drawing is read sticker by sticker: where
// each one sits in the world (the element's orientation included) and which way it faces, mapped onto
// the published facelet layout by `test/cube-oracle.mjs`. The expectation comes from that oracle, which
// is checked against cubejs in `test/cube-oracle.test.mjs`. So a wrong entry in the renderer's pose
// table, a hold drawn the wrong way round or a turn applied to the wrong layer shows up as a letter in
// the wrong place — never as two copies of one mistake agreeing with each other.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';

import { ROTATIONS, SOLVED_FACELETS, applyMoves, faceletAt, held, play } from '../cube-oracle.mjs';
import { SCENARIOS } from '../fixtures/tutorial-scenarios.mjs';
import { OPEN_ITEMS, underGapRules } from '../tutorial-runner.mjs';
import { startBrowserFixture } from './harness.mjs';

/** What a consumer may touch, as the element itself declares it (plan item 2.5 widens this). */
const MANIFEST = JSON.parse(readFileSync(new URL('../../vendor/cubus-cube.manifest.json', import.meta.url), 'utf8'));

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  // The public cube a scenario is WRITTEN against: the manifest's attributes through the DOM's own
  // attribute calls, the manifest's methods, and nothing else. Anything more throws, naming itself.
  await page.evaluate((manifest) => {
    const attributes = new Set(manifest.attributes);
    const methods = new Set(manifest.methods);
    const attributeCalls = new Set(['setAttribute', 'removeAttribute', 'getAttribute']);
    window.__publicCube = (el) => new Proxy(el, {
      get(target, name) {
        if (typeof name === 'symbol') throw new Error('a symbol read on the public cube');
        if (attributeCalls.has(name)) {
          return (attr, ...rest) => {
            if (!attributes.has(attr)) throw new Error(`the manifest lists no attribute "${attr}"`);
            return target[name](attr, ...rest);
          };
        }
        if (methods.has(name)) return (...args) => target[name](...args);
        throw new Error(`the manifest lists no member "${name}"`);
      },
    });
  }, MANIFEST);
});

after(async () => { await fixture?.close(); });

/** A fresh element with `attrs`, written through the public cube, one frame in, on a pinned clock. */
const build = (attrs) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
  const cube = window.__publicCube(el);
  for (const [k, v] of Object.entries(a)) cube.setAttribute(k, v);
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
  el.clock = 4_000_000;
}, attrs);

/**
 * Every sticker of the drawn cube: its home face (the colour it was painted, for a cube built from
 * moves rather than a facelet string), the world position of its cubie and its world offset from that
 * cubie. `seek` goes through the public cube; the reading is a check, and reads the scene directly.
 */
const drawn = (k) => page.evaluate((to) => {
  const el = window.__cube;
  if (to !== null) window.__publicCube(el).seek(to);
  el.root.updateMatrixWorld(true);
  const V = el.stickers[0].position.constructor;
  return el.stickers.map((m) => {
    const s = m.getWorldPosition(new V());
    const c = m.parent.getWorldPosition(new V());
    return { face: m.userData.face, cubie: [c.x, c.y, c.z], offset: [s.x - c.x, s.y - c.y, s.z - c.z] };
  });
}, k);

/** The drawn stickers as world facelets, on the oracle's layout. Throws on a sticker that lands nowhere. */
export function toWorld(stickers) {
  const scale = Math.max(...stickers.flatMap((s) => s.cubie.map(Math.abs)));
  const out = new Array(54).fill('?');
  for (const s of stickers) {
    const pos = s.cubie.map((v) => Math.round(v / scale) + 0);
    const len = Math.hypot(...s.offset);
    const n = s.offset.map((v) => Math.round(v / len) + 0);
    const i = faceletAt(pos, n);
    if (i < 0) throw new Error(`a sticker at ${pos} facing ${n} is on no facelet`);
    if (out[i] !== '?') throw new Error(`two stickers drawn on facelet ${i}`);
    out[i] = s.face;
  }
  return out.join('');
}

const tokens = (alg) => alg.trim().split(/\s+/).filter(Boolean);

test('the read-back is a reading: a solved cube at the reference hold reads as solved', async () => {
  await build({ orientation: 'U F' });
  assert.equal(toWorld(await drawn(null)), SOLVED_FACELETS);
});

for (const sc of SCENARIOS.filter((s) => s.half === 'element' && s.kind === 'identity')) {
  test(`${sc.id}: every position drawn as the oracle says (${sc.source})`, async () => {
    await build({ orientation: sc.orientation, alg: sc.alg });
    const moves = tokens(sc.alg);
    for (let k = 0; k <= moves.length; k++) {
      const identity = applyMoves(SOLVED_FACELETS, moves.slice(0, k).join(' '));
      assert.equal(toWorld(await drawn(k)), held(identity, sc.orientation), `${sc.id} after ${k} of ${moves.length} moves`);
    }
  });
}

for (const sc of SCENARIOS.filter((s) => s.half === 'element' && s.kind === 'identity-all-holds')) {
  test(`${sc.id}: the finished sequence drawn under each of the 24 holds`, async () => {
    const identity = applyMoves(SOLVED_FACELETS, sc.alg);
    const n = tokens(sc.alg).length;
    for (const hold of Object.keys(ROTATIONS)) {
      await build({ orientation: hold, alg: sc.alg });
      assert.equal(toWorld(await drawn(n)), held(identity, hold), `${sc.id} held ${hold}`);
    }
  });
}

test('the public cube refuses what the manifest does not list, and allows what it does', async () => {
  await build({ orientation: 'U F' });
  const refused = await page.evaluate(() => {
    const cube = window.__publicCube(window.__cube);
    const attempt = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    return {
      stickers: attempt(() => cube.stickers),
      privateAnim: attempt(() => cube._anim),
      bogusAttribute: attempt(() => cube.setAttribute('not-an-attribute', '1')),
      seek: attempt(() => cube.seek(0)),
      alg: attempt(() => cube.setAttribute('alg', 'R')),
    };
  });
  assert.match(refused.stickers ?? '', /no member "stickers"/);
  assert.match(refused.privateAnim ?? '', /no member "_anim"/);
  assert.match(refused.bogusAttribute ?? '', /no attribute "not-an-attribute"/);
  assert.equal(refused.seek, null);
  assert.equal(refused.alg, null);
});

/** The element half's runners for scenarios whose capability a plan item is still building. */
const ELEMENT_RUNNERS = {
  // Centre-moving tokens in `alg`: drawn at every position as the oracle plays them.
  async 'element-tokens'(sc) {
    for (const alg of sc.algs) {
      await build({ orientation: sc.orientation, alg });
      const oracle = play(SOLVED_FACELETS, sc.orientation, alg);
      for (let k = 0; k < oracle.worlds.length; k++) {
        assert.equal(toWorld(await drawn(k)), oracle.worlds[k], `${sc.id}: "${alg}" after ${k} moves`);
      }
    }
  },
};

for (const sc of SCENARIOS.filter((s) => s.half === 'element' && s.closedBy)) {
  const open = OPEN_ITEMS.includes(sc.closedBy);
  test(`${sc.id} (${sc.source})`, async (t) => {
    await underGapRules(t, sc, open, () => {
      const runner = ELEMENT_RUNNERS[sc.kind];
      if (!runner) throw new Error(`no runner for "${sc.kind}" yet — it arrives with plan item ${sc.closedBy}`);
      return runner(sc);
    });
  });
}
