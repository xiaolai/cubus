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

import { ROTATIONS, SOLVED_FACELETS, applyMoves, held, play } from '../cube-oracle.mjs';
import { SCENARIOS } from '../fixtures/tutorial-scenarios.mjs';
import * as cubeKit from '../../lib/cube-kit.js';
import { OPEN_ITEMS, strictKit, underGapRules } from '../tutorial-runner.mjs';
import { readMatrices, readStickers, toWorld } from './drawn-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

/** What a scenario may use of the model: cube-kit, strictly. */
const kit = strictKit(cubeKit);

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

/** Seek through the public cube, then read the drawing back — the reading is a check and reads the scene. */
const drawn = async (k) => {
  if (k !== null) await page.evaluate((to) => window.__publicCube(window.__cube).seek(to), k);
  return readStickers(page);
};

const tokens = (alg) => alg.trim().split(/\s+/).filter(Boolean);

/** Every cubie's stickers as one string, so a greyed cubie can be told from an untouched one. */
const cubieColours = () => page.evaluate(() => window.__cube.cubies
  .map((c) => c.children.filter((m) => m.userData?.face).map((m) => m.material.color.getHex()).join()));

/** Which pieces are in focus: the cubies still wearing the colours they were painted. */
const inFocus = async (trueColours) => {
  const now = await cubieColours();
  return page.evaluate(([base, colours]) => window.__cube.cubies
    .filter((c, i) => colours[i] === base[i]).map((c) => c.userData.piece), [trueColours, now]);
};

/** Advance the pinned clock by `ms` and let one frame run. */
const tick = (ms) => page.evaluate(async (by) => {
  const el = window.__cube;
  el.clock = el._now() + by;
  await new Promise((r) => requestAnimationFrame(() => r()));
}, ms);

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
  // The child's moves — centre-moving ones among them — read by the interpreter into the identity-frame
  // tokens the element's `alg` takes (ADR 0004 decision 7), and drawn at every position as the oracle
  // plays the child's letters. At the reference hold a single token reads the same both ways; after a
  // slice or a rotation the letters that follow do not, which is the whole reason for the interpreter.
  async 'element-tokens'(sc) {
    const [up, front] = sc.orientation.split(' ');
    for (const alg of sc.algs) {
      const { drawn: tokens } = kit.run(kit.parse(alg), [up, front], kit.SOLVED);
      await build({ orientation: sc.orientation, alg: tokens.join(' ') });
      const oracle = play(SOLVED_FACELETS, sc.orientation, alg);
      for (let k = 0; k < oracle.worlds.length; k++) {
        assert.equal(toWorld(await drawn(k)), oracle.worlds[k], `${sc.id}: "${alg}" (drawn "${tokens.join(' ')}") after ${k} moves`);
      }
    }
  },
  // A stop is where a walk waits, and a regrip is not one: `x y R` is one stop, so a child following on
  // a real cube sees the whole-cube turn ANIMATE and then the turn, rather than a cube that jumped
  // (ADR 0004 decision 9 and R4). Driven entirely through the public cube; read off the drawing.
  async 'stop-animation'(sc) {
    await build({ alg: sc.alg });
    const ends = [];
    for (const k of [0, tokens(sc.alg).length]) { await drawn(k); ends.push(await readMatrices(page)); }
    await page.evaluate(() => window.__publicCube(window.__cube).seek(0));
    await page.evaluate(() => window.__publicCube(window.__cube).stepStop());
    for (const token of tokens(sc.alg)) {
      // The clock is a test seam, not a consumer's to touch — so it is written on the element, while
      // everything a host would do goes through the public cube.
      await tick(95);
      const mid = await readMatrices(page);
      for (const [i, end] of ends.entries()) {
        assert.notDeepEqual(mid, end, `${sc.id}: "${token}" was not drawn part way through (it reads as position ${i ? 'last' : '0'})`);
      }
      await tick(120);
    }
    assert.deepEqual(await readMatrices(page), ends[1], `${sc.id}: the group did not land on its stop`);
  },
  // A cue says "watch this piece" at the position it is written, and a scrubber must not change which
  // piece that is: focus binds where it took effect and keeps naming those pieces through a seek
  // (ADR 0004 decision 10 and R10).
  async 'focus-seek'(sc) {
    await build({ alg: sc.alg });
    const trueColours = await cubieColours();
    const at = async (k) => {
      await page.evaluate((to) => window.__publicCube(window.__cube).seek(to), k);
      return inFocus(trueColours);
    };
    await at(tokens(sc.alg).length);
    await page.evaluate((sel) => window.__publicCube(window.__cube).setAttribute('focus', sel), sc.selector);
    const bound = await inFocus(trueColours);
    assert.equal(bound.length, 1, `${sc.id}: "${sc.selector}" should name one piece, not ${bound.join(', ') || 'none'}`);
    assert.deepEqual(await at(0), bound, `${sc.id}: seeking away re-bound "${sc.selector}"`);
    assert.deepEqual(await at(tokens(sc.alg).length), bound, `${sc.id}: seeking back re-bound "${sc.selector}"`);
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
