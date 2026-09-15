// The consumers' private reads, ported onto the public surface — plan Phase 5 of
// dev-docs/tutorial-capability-plan.md (items 5.1 and 5.2).
//
// cubus-im walks the element's three.js scene for two things (`test/browser/consumer-surface.test.mjs` pins the
// walks as they are, and keeps them until cubus-im stops needing them). Each is ported here and run beside the
// walk on the SAME cubes, so a port that answers differently from what it replaces fails before anyone adopts
// it — and every port drives the element through the proxy that throws on anything the manifest omits.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { installPublicCube } from './public-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

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
      import * as kit from '/lib/cube-kit.js';
      window.__kit = kit;
    `,
  });
  await page.waitForFunction(() => !!window.__kit);
});

after(async () => { await fixture?.close(); });

const build = (attrs) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
  const cube = window.__publicCube(el);
  for (const [k, v] of Object.entries(a)) cube.setAttribute(k, v);
  el.clock = 1_000_000;
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
}, attrs);

/** cubus-im's `centreColours`, as `pipeline/drillkit.py` and `pipeline/cube-avatar.js` write it: the scene walk. */
const walkedColours = () => page.evaluate(() => {
  const out = {};
  for (const c of window.__cube.cubies) {
    const p = [c.position.x, c.position.y, c.position.z].map(Math.round);
    if (p.filter(Boolean).length !== 1) continue;
    const mesh = c.children.find((m) => m.userData?.face);
    if (mesh) out[mesh.userData.face] = `#${mesh.material.color.getHexString()}`;
  }
  return out;
});
/** The port: one call, through the public cube. */
const portedColours = () => page.evaluate(() => ({ ...window.__publicCube(window.__cube).drawnColours() }));

// Plan item 5.1.
test('drawnColours() answers what the centre walk answers, under every palette and both schemes', async () => {
  const SCRAMBLED = 'DRLUUBFBRBLURRLRUBLRDDFDLFUFUFFDBRDUBRUFLLFDDBFLUBLRBD';
  for (const palette of ['muted', 'classic', 'colorsafe']) {
    for (const scheme of ['western', 'japanese']) {
      for (const cube of [{}, { scramble: "R U R' U' M2 y" }, { facelets: SCRAMBLED }]) {
        await build({ palette, scheme, ...cube });
        const walked = await walkedColours();
        assert.equal(Object.keys(walked).length, 6, 'precondition: the walk found six centres');
        assert.deepEqual(await portedColours(), walked, `${palette}, ${scheme}, ${JSON.stringify(cube)}`);
      }
    }
  }
  // Held another way, the centres' colours are still keyed by face: the walk reads cube-local positions.
  await build({ orientation: 'D B', scheme: 'japanese' });
  assert.deepEqual(await portedColours(), await walkedColours());
});

test('a focus greys what the walk reads, and not what drawnColours() answers — a swatch is the colour', async () => {
  await build({ palette: 'classic' });
  const plain = await portedColours();
  await page.evaluate(() => window.__publicCube(window.__cube).setAttribute('focus', 'piece:UF'));
  assert.deepEqual(await portedColours(), plain, 'a focus changed the colours a swatch is drawn from');
  const walked = await walkedColours();
  assert.notDeepEqual(walked, plain, 'precondition: the walk reads the focus treatment');
  // And a picture's unread centre is the unknown sticker's colour, as it is drawn.
  const unread = `UUUU?UUUU${'R'.repeat(9)}${'F'.repeat(9)}${'D'.repeat(9)}${'L'.repeat(9)}${'B'.repeat(9)}`;
  await build({ facelets: unread });
  assert.deepEqual(await portedColours(), await walkedColours());
});

/**
 * `pipeline/build-playground.py`'s counter, as it is written: pieces away from home, read off the scene — by
 * identity stamp, position, and which colour faces which way.
 */
const walkedAway = () => page.evaluate(() => {
  const sortLetters = (x) => String(x).split('').sort().join('');
  const state = () => window.__cube.cubies.filter((c) => c.userData.piece).map((c) => ({
    piece: sortLetters(c.userData.piece),
    at: [c.position.x, c.position.y, c.position.z].map(Math.round).join(','),
    facing: c.children.filter((m) => m.userData?.face && !m.userData.n)
      .map((m) => `${m.userData.face}:${m.material.color.getHexString()}`).sort().join('|'),
  }));
  const home = window.__home;
  return state().filter((c) => { const h = home.find((x) => x.piece === c.piece); return !h || h.at !== c.at || h.facing !== c.facing; }).length;
});

// Plan item 5.2: the counter from the MODEL — the script's own cube and `piecesAway` — never from `cube.cubies`.
//
// The two do NOT always agree, and the port is the one that is right. The playground's rule is lesson 2's — a
// piece is away if it is out of its slot OR in it the wrong way round — but its walk reads each sticker's
// build-time face letter and its colour, and neither changes when a piece twists in place. So the walk counts
// only pieces out of their slots. cubejs, which shares no code with either, decides both numbers at every
// position: the walk's is its pieces out of place, the port's adds the pieces home but twisted.
test('the playground\'s counter from the model counts what its rule says; the scene walk misses a piece twisted in place', async () => {
  const require = (await import('node:module')).createRequire(import.meta.url);
  const Cube = require('cubejs');
  let sawTwist = false;
  for (const [scramble, turns] of [['', "R U R' U' R U R' U'"], ["F R U' R' U' R U R' F'", "U R U' R' U' F' U F"]]) {
    await build(scramble ? { scramble } : {});
    await page.evaluate(() => {
      const sortLetters = (x) => String(x).split('').sort().join('');
      window.__home = window.__cube.cubies.filter((c) => c.userData.piece).map((c) => ({
        piece: sortLetters(c.userData.piece),
        at: [c.position.x, c.position.y, c.position.z].map(Math.round).join(','),
        facing: c.children.filter((m) => m.userData?.face && !m.userData.n)
          .map((m) => `${m.userData.face}:${m.material.color.getHexString()}`).sort().join('|'),
      }));
    });
    const counted = await page.evaluate(async ([sc, alg]) => {
      const kit = window.__kit;
      const built = kit.buildScript({ schema: 2, start: sc ? { scramble: sc } : {}, steps: [{ move: alg }] });
      const walk = kit.createStopDriver(built, { cube: window.__publicCube(window.__cube) });
      const out = [];
      for (let k = 0; k < built.positions.length; k++) {
        if (k > 0) walk.next();
        out.push(kit.piecesAway(kit.viewAtPosition(built, k).cube).pieces.length);
      }
      return out;
    }, [scramble, turns]);
    const walked = [];
    for (let k = 0; k < counted.length; k++) {
      await page.evaluate((to) => window.__publicCube(window.__cube).seek(to), k);
      walked.push(await walkedAway());
    }
    // The oracle: out of place, and home but twisted, measured from the cube the walk started on.
    const cube = new Cube(); if (scramble) cube.move(scramble);
    const start = { cp: [...cube.cp], co: [...cube.co], ep: [...cube.ep], eo: [...cube.eo] };
    const oracle = [];
    const moves = turns.split(' ');
    for (let k = 0; k <= moves.length; k++) {
      if (k > 0) cube.move(moves[k - 1]);
      let moved = 0; let twisted = 0;
      for (let i = 0; i < 8; i++) { if (cube.cp[i] !== start.cp[i]) moved++; else if (cube.co[i] !== start.co[i]) twisted++; }
      for (let i = 0; i < 12; i++) { if (cube.ep[i] !== start.ep[i]) moved++; else if (cube.eo[i] !== start.eo[i]) twisted++; }
      oracle.push({ moved, twisted });
      if (twisted) sawTwist = true;
    }
    assert.deepEqual(walked, oracle.map((o) => o.moved), `"${scramble}" then "${turns}": the walk is not the pieces out of place`);
    // The port counts from SOLVED; the walk's home is the scrambled cube it loaded. On a scrambled start the two
    // homes differ, so the port is held to its own rule on the solved start only.
    if (!scramble) assert.deepEqual(counted, oracle.map((o) => o.moved + o.twisted), `"${turns}": the port does not count what lesson 2's rule counts`);
  }
  assert.ok(sawTwist, 'precondition: some position leaves a piece home but twisted, or the two counts could not be told apart');
});
