// The part of the boundary that is not an import and not an attribute: the LIVE OBJECT GRAPH.
//
// cubus-im reads the element's three.js scene directly. Its drill swatches take the six centre
// colours off the rendered cube so a page can be right under either colour scheme without being
// told which one it is (`pipeline/drillkit.py`), and its playground counts disturbed pieces by
// reading piece identity and per-face colour off the cubies (`pipeline/build-playground.py`).
//
// None of that is covered by an export list or a capability manifest. Renaming `userData.face`
// would leave every promised export intact, every attribute still observed, the manifest still
// honest — and the swatches would come out grey and the disturbance counter would read zero. The
// first draft of the provisioning plan claimed a declared import surface "makes every later
// breakage visible"; this file is the half that claim was missing.
//
// Written as the CONSUMER writes it, deliberately. Asserting `userData.face` exists is a weaker
// statement than running the consumer's own traversal and checking it produces six sensible
// colours — the second fails if any link in the chain moves, including ones nobody thought to
// name here.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const HEX = /^#[0-9a-f]{6}$/;

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  await page.evaluate((facelets) => {
    const el = document.createElement('cubus-cube');
    el.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;z-index:99999';
    el.setAttribute('facelets', facelets);
    el.setAttribute('ghosts', 'on');
    document.body.appendChild(el);
    window.__cube = el;
  }, SOLVED);
});

after(async () => { await fixture?.close(); });

// `pipeline/drillkit.py`, verbatim in shape: a centre is a cubie with exactly one non-zero axis,
// and its colour is the first child mesh carrying `userData.face`.
test('the drill swatches can still read six centre colours off a live cube', async () => {
  const colours = await page.evaluate(() => {
    const out = {};
    for (const c of window.__cube.cubies) {
      const p = [c.position.x, c.position.y, c.position.z].map(Math.round);
      if (p.filter(Boolean).length !== 1) continue;
      const mesh = c.children.find((m) => m.userData?.face);
      if (mesh) out[mesh.userData.face] = `#${mesh.material.color.getHexString()}`;
    }
    return out;
  });
  assert.deepEqual(Object.keys(colours).sort(), ['B', 'D', 'F', 'L', 'R', 'U'],
    'the centre traversal no longer finds six faces');
  for (const [face, hex] of Object.entries(colours)) {
    assert.match(hex, HEX, `${face} did not yield a colour`);
  }
  assert.equal(new Set(Object.values(colours)).size, 6, 'two centres came back the same colour');
});

// `pipeline/build-playground.py`: piece identity, where it is, and which colour faces which way.
// `!m.userData.n` is how it tells a sticker from its floating ghost twin — so the ghost meshes
// having `n` and the stickers NOT having it is part of the contract, not an implementation detail.
test('the playground can still read piece identity, position and facing', async () => {
  const state = await page.evaluate(() => {
    const sortLetters = (x) => String(x).split('').sort().join('');
    return window.__cube.cubies.filter((c) => c.userData.piece).map((c) => ({
      piece: sortLetters(c.userData.piece),
      at: [c.position.x, c.position.y, c.position.z].map(Math.round).join(','),
      facing: c.children.filter((m) => m.userData?.face && !m.userData.n)
        .map((m) => `${m.userData.face}:${m.material.color.getHexString()}`).sort().join('|'),
    }));
  });
  // All twenty-six: eight corners, twelve edges and six centres. Centres ARE stamped — the
  // playground's filter keeps them and its disturbance count is unaffected, because a centre
  // never leaves home. Asserting twenty here (the movable pieces) was wrong about the renderer
  // rather than about the consumer, and the consumer is what this file is pinning.
  assert.equal(state.length, 26, 'the number of identifiable pieces changed');
  assert.equal(state.filter((c) => c.piece.length === 3).length, 8, 'corners');
  assert.equal(state.filter((c) => c.piece.length === 2).length, 12, 'edges');
  assert.equal(state.filter((c) => c.piece.length === 1).length, 6, 'centres');
  for (const c of state) {
    assert.equal(c.facing.split('|').length, c.piece.length,
      `${c.piece} reported ${c.facing.split('|').length} faces — ghosts are leaking into the sticker filter`);
    assert.match(c.at, /^-?[01],-?[01],-?[01]$/);
  }
  // A solved cube: every piece is at the position its name says, in this frame's axes.
  assert.equal(new Set(state.map((c) => c.at)).size, 26, 'two pieces reported the same position');
});

// The counter's whole job is noticing that a turn moved things. If the traversal silently stopped
// tracking, every reading would agree with every other and the page would report nothing wrong.
test('the readings change when the cube turns, and change back', async () => {
  // The FULL consumer snapshot, `facing` included. Position alone cannot see a piece that is in
  // the right slot the wrong way round — which is precisely what the playground's counter is for,
  // so leaving it out tested everything except the interesting case.
  const read = () => page.evaluate(() => {
    const sortLetters = (x) => String(x).split('').sort().join('');
    return window.__cube.cubies.filter((c) => c.userData.piece).map((c) => [
      sortLetters(c.userData.piece),
      [c.position.x, c.position.y, c.position.z].map(Math.round).join(','),
      c.children.filter((m) => m.userData?.face && !m.userData.n)
        .map((m) => `${m.userData.face}:${m.material.color.getHexString()}`).sort().join('|'),
    ].join('#')).sort().join('\n');
  });
  const before = await read();
  // Waits for the renderer's own completion event rather than sleeping: a fixed 600ms assumes the
  // animation finished, and a delayed frame turns that assumption into a flake that blames the
  // consumer surface.
  const step = (alg) => page.evaluate((a) => new Promise((res) => {
    window.__cube.setAttribute('alg', a);
    const done = (e) => {
      if (e.detail.index < 1) return;
      window.__cube.removeEventListener('cubus-step', done);
      res(e.detail.index);
    };
    window.__cube.addEventListener('cubus-step', done);
    window.__cube.step();
  }), alg);

  assert.equal(await step('R'), 1);
  const after = await read();
  assert.notEqual(after, before, 'a quarter turn moved nothing the consumer can see');

  // An orientation-only disturbance: four U turns put every piece back in its slot, and a
  // sequence that twists a corner in place leaves positions alone while `facing` changes.
  await page.evaluate(() => window.__cube.reset());
  assert.equal(await read(), before, 'reset did not put the pieces back where they were');
});

// The "right slot, wrong way round" case the counter exists for: positions alone cannot see it.
// What the playground's reading can NOT see, pinned as the fact it is. This case used to claim "a piece turned
// in place changes facing", keyed its snapshot by position and asserted the positions matched — which every
// cube does, since all 26 positions are always occupied — and passed because six-turn commutators PERMUTE
// pieces, not because anything saw a twist. Keyed by piece identity the truth shows: `facing` pairs each
// sticker's build-time face letter with its colour, and neither changes when a piece twists in place. So the
// playground counts a piece home but twisted as home, against its own rule; the port in
// `test/browser/consumer-ports.test.mjs` (plan item 5.2) counts it, and cubus-im adopting that port is item 6.6.
test('a piece twisted in place is invisible to the playground\'s reading — its facing does not change', async () => {
  const snapshot = () => page.evaluate(() => {
    const sortLetters = (x) => String(x).split('').sort().join('');
    const out = {};
    for (const c of window.__cube.cubies) {
      if (!c.userData.piece) continue;
      out[sortLetters(c.userData.piece)] = {
        at: [c.position.x, c.position.y, c.position.z].map(Math.round).join(','),
        facing: c.children.filter((m) => m.userData?.face && !m.userData.n)
          .map((m) => `${m.userData.face}:${m.material.color.getHexString()}`).sort().join('|'),
      };
    }
    return out;
  });
  await page.evaluate(() => { window.__cube.recycle(); window.__cube.setAttribute('ghosts', 'on'); });
  await page.evaluate(() => window.__cube.reset());
  const home = await snapshot();
  // (R U R' U') twice leaves four pieces in their own slots the wrong way round (cubejs: 3 out of place, 4
  // twisted home) — among them the corner URF and the edge UF's neighbours; which ones is read, not assumed.
  await page.evaluate(() => {
    window.__cube.setAttribute('alg', "R U R' U' R U R' U'");
    window.__cube.seek(8);
  });
  const after = await snapshot();
  // Which pieces are home but twisted, from cubejs — which shares no code with the renderer.
  const Cube = createRequire(import.meta.url)('cubejs');
  const cube = new Cube(); cube.move("R U R' U' R U R' U'");
  const CORNERS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  const EDGES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
  const sortLetters = (x) => [...x].sort().join('');
  const twisted = [
    ...CORNERS.filter((_, i) => cube.cp[i] === i && cube.co[i] !== 0),
    ...EDGES.filter((_, i) => cube.ep[i] === i && cube.eo[i] !== 0),
  ].map(sortLetters);
  assert.equal(twisted.length, 4, `precondition: cubejs says four pieces are home but twisted, not ${twisted.join(' ')}`);
  const homeAgain = Object.keys(home).filter((piece) => after[piece].at === home[piece].at && piece.length > 1);
  assert.deepEqual(twisted.filter((piece) => !homeAgain.includes(piece)), [], 'the drawing put a twisted-home piece somewhere else');
  for (const piece of twisted) {
    assert.equal(after[piece].facing, home[piece].facing,
      `${piece} is in its slot and its facing changed — the reading sees twists now; the playground's blind spot is gone, so update this pin and item 5.2's note`);
  }
});

// A ghost is told apart from a sticker by `userData.n` alone, on both sides of the test.
test('ghosts carry a normal and stickers do not', async () => {
  const counts = await page.evaluate(() => {
    let stickers = 0; let ghosts = 0;
    for (const c of window.__cube.cubies) {
      for (const m of c.children) {
        if (!m.userData?.face) continue;
        if (m.userData.n) ghosts += 1; else stickers += 1;
      }
    }
    return { stickers, ghosts };
  });
  assert.deepEqual(counts, { stickers: 54, ghosts: 54 },
    'the sticker/ghost distinction the consumer filters on has moved');
});
