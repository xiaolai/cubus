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
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

import { ROTATIONS, SOLVED_FACELETS, applyMoves, faceletAt, held, play } from '../cube-oracle.mjs';
import { SCENARIOS } from '../fixtures/tutorial-scenarios.mjs';
import * as cubeKit from '../../lib/cube-kit.js';
import { BROWSER_PLAYER_KINDS, OPEN_ITEMS, startOf, strictKit, underGapRules } from '../tutorial-runner.mjs';
import { readMatrices, readStickers, toWorld } from './drawn-cube.mjs';
import { installPublicCube } from './public-cube.mjs';
import { installSampler } from './sampling.mjs';
import { startBrowserFixture } from './harness.mjs';

const require = createRequire(import.meta.url);

/** What a scenario may use of the model: cube-kit, strictly. */
const kit = strictKit(cubeKit);

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
  // The public cube a scenario is WRITTEN against: the manifest's attributes, methods, properties,
  // events and DOM operations, and nothing else (test/browser/public-cube.mjs).
  await installPublicCube(page);
  // The script runtime, loaded IN the page as the app would load it — so the drivers write onto the
  // element through the same public cube a scenario is held to, and nothing is reimplemented here.
  await page.addScriptTag({
    type: 'module',
    content: `
      import { buildScript } from '/lib/script-view.js';
      import { createClockDriver, createStopDriver } from '/lib/script-drive.js';
      window.__script = { buildScript, createClockDriver, createStopDriver };
    `,
  });
  await page.waitForFunction(() => !!window.__script);
  await page.evaluate(installSampler);
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
      bogusEvent: attempt(() => cube.addEventListener('cubus-nothing', () => {})),
      notAListener: attempt(() => cube.addEventListener('cubus-step', 'go')),
      pinTheClock: attempt(() => { cube.clock = 1; }),
      seek: attempt(() => cube.seek(0)),
      alg: attempt(() => cube.setAttribute('alg', 'R')),
      animating: attempt(() => cube.animating),
      listen: attempt(() => cube.addEventListener('cubus-step', () => {})),
      size: attempt(() => cube.style.width),
      writeAlg: attempt(() => { cube.alg = 'R'; }),
    };
  });
  assert.match(refused.stickers ?? '', /no member "stickers"/);
  assert.match(refused.privateAnim ?? '', /no member "_anim"/);
  assert.match(refused.bogusAttribute ?? '', /no attribute "not-an-attribute"/);
  assert.match(refused.bogusEvent ?? '', /no event "cubus-nothing"/);
  assert.match(refused.notAListener ?? '', /a listener is a function/);
  // The pinned clock is a test seam, declared as one on the element: a lesson that set it would stop
  // the cube, so it is not part of the contract even though it is not private.
  assert.match(refused.pinTheClock ?? '', /no writable property "clock"/);
  for (const allowed of ['seek', 'alg', 'animating', 'listen', 'size', 'writeAlg']) {
    assert.equal(refused[allowed], null, `${allowed} is part of the contract and was refused`);
  }
});

/**
 * The world facelets drawn brighter under `spec` than with no highlight, read off the CANVAS — the
 * sampler reads pixels, never materials — and placed on the oracle's layout by where each lit sticker is.
 */
const litFacelets = async (spec) => {
  const lit = await page.evaluate((s) => {
    const el = window.__cube;
    const cube = window.__publicCube(el);
    cube.setAttribute('highlight', s);
    const shown = window.__appearance.stickers(el);
    cube.setAttribute('highlight', 'none');
    const rest = window.__appearance.stickers(el);
    const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    el.root.updateMatrixWorld(true);
    const V = el.stickers[0].position.constructor;
    return Object.keys(shown).filter((k) => lum(shown[k]) - lum(rest[k]) > 8).map((k) => {
      const [i, face] = k.split(':');
      const c = el.cubies[Number(i)];
      const m = c.children.find((x) => x.userData?.face === face && !x.userData.n);
      const at = m.getWorldPosition(new V()); const centre = c.getWorldPosition(new V());
      return { cubie: [centre.x, centre.y, centre.z], offset: [at.x - centre.x, at.y - centre.y, at.z - centre.z] };
    });
  }, spec);
  const scale = Math.max(1, ...lit.flatMap((s) => s.cubie.map(Math.abs)));
  return lit.map((s) => {
    const len = Math.hypot(...s.offset);
    return faceletAt(s.cubie.map((v) => Math.round(v / scale) + 0), s.offset.map((v) => Math.round(v / len) + 0));
  }).sort((a, b) => a - b);
};

/** Every facelet of the oracle's layout, with the cubie it is on and the way it faces. */
const FACELETS = (() => {
  const out = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const pos = [x, y, z];
    pos.forEach((v, axis) => {
      if (!v) return;
      const n = [0, 0, 0]; n[axis] = v;
      out.push({ pos, n, index: faceletAt(pos, n) });
    });
  }
  return out;
})();

/** The element half's runners for scenarios whose capability a plan item is still building. */
const ELEMENT_RUNNERS = {
  // Plan item 4.4: a trail for each piece a PLL cycles starts at the piece's home and ends in the slot whose
  // stickers show that piece's colours in the oracle's cube after the sequence.
  async trail(sc) {
    const world = applyMoves(SOLVED_FACELETS, sc.alg);
    const endOf = (piece) => {
      const positions = [...new Set(FACELETS.filter((f) => f.pos.filter(Boolean).length === piece.length).map((f) => f.pos.join()))];
      const found = positions.filter((key) => FACELETS.filter((f) => f.pos.join() === key).map((f) => world[f.index]).sort().join('') === [...piece].sort().join(''));
      assert.equal(found.length, 1, `${sc.id}: precondition — the oracle's cube shows ${piece}'s colours in one place`);
      return found[0].split(',').map(Number);
    };
    await build({ alg: sc.alg });
    for (const piece of sc.pieces) {
      await page.evaluate((spec) => window.__publicCube(window.__cube).setAttribute('trail', spec), `piece:${piece}`);
      const drawn = await page.evaluate(() => (window.__cube._trailMeshes ?? []).find((m) => m.userData.trail)?.userData.stops ?? null);
      assert.ok(drawn, `${sc.id}: no trail for ${piece}, which the sequence moves`);
      const home = FACELETS.filter((f) => f.pos.filter(Boolean).length === piece.length)
        .map((f) => f.pos).find((pos) => FACELETS.filter((f) => f.pos.join() === pos.join()).map((f) => SOLVED_FACELETS[f.index]).sort().join('') === [...piece].sort().join(''));
      assert.deepEqual(drawn[0], home, `${sc.id}: ${piece}'s trail does not start at its home`);
      assert.deepEqual(drawn.at(-1), endOf(piece), `${sc.id}: ${piece}'s trail does not end where the oracle puts it`);
    }
  },
  // Plan item 4.3: held any of several ways, the `position` letter on top is U, and the `face` letter on top
  // is the face whose centre the oracle puts there.
  async label(sc) {
    const onTop = (mode) => page.evaluate((m) => {
      const el = window.__cube;
      window.__publicCube(el).setAttribute('labels', m);
      el.scene.updateMatrixWorld(true);
      const V = el.camera.position.constructor;
      const top = (el._labelMeshes ?? []).find((mesh) => mesh.getWorldPosition(new V()).y > 1);
      return top?.userData.label ?? null;
    }, mode);
    for (const hold of sc.holds) {
      await build({ orientation: hold });
      assert.equal(await onTop('position'), 'U', `${sc.id}: held ${hold}, the place on top is not called U`);
      const centreOnTop = held(SOLVED_FACELETS, hold)[4];
      assert.equal(await onTop('face'), centreOnTop, `${sc.id}: held ${hold}, the letter on top is not the face the oracle puts there`);
    }
  },
  // Plan item 4.2: `arrow="next"` shows the move about to be made at every position of a sequence — on that
  // move's layers, turning its way — and nothing once it is done; and the cube under it is the oracle's. The
  // sequence is written in the child's letters and handed to the element as the interpreter draws it, as R1 is.
  async arrow(sc) {
    const { drawn: identity } = kit.run(kit.parse(sc.alg), ['U', 'F'], kit.SOLVED);
    await build({ alg: identity.join(' '), arrow: 'next' });
    const oracle = play(SOLVED_FACELETS, 'U F', sc.alg);
    for (let k = 0; k <= identity.length; k++) {
      await page.evaluate((to) => window.__publicCube(window.__cube).seek(to), k);
      assert.equal(toWorld(await readStickers(page)), oracle.worlds[k], `${sc.id}: the cube after ${k} moves`);
      const shown = await page.evaluate(() => ({ visible: window.__cube._arrow.visible, ...window.__cube._arrow.userData }));
      if (k === identity.length) { assert.equal(shown.visible, false, `${sc.id}: an arrow after the last move`); continue; }
      const [move] = kit.parse(identity[k]);
      assert.equal(shown.visible, true, `${sc.id}: no arrow before "${identity[k]}"`);
      assert.deepEqual(shown.layers, [...move.layers], `${sc.id}: the arrow before "${identity[k]}" is on the wrong layers`);
      assert.equal(Math.sign(shown.angle), Math.sign(move.angle), `${sc.id}: the arrow before "${identity[k]}" turns the other way`);
    }
  },
  // Plan item 4.1: one sticker of a piece, lit alone — named by where it faces, and by its colour. The
  // oracle says which facelet each names: the one at UF facing up, and the one showing F on the UF edge.
  async 'highlight-sticker'(sc) {
    await build({ alg: sc.alg });
    await drawn(tokens(sc.alg).length);
    const world = applyMoves(SOLVED_FACELETS, sc.alg);
    const expected = {
      'slot:UF/U': [faceletAt([0, 1, 1], [0, 1, 0])],
      'piece:UF/F': FACELETS.filter((f) => {
        if (f.pos.filter(Boolean).length !== 2 || world[f.index] !== 'F') return false;
        const pair = FACELETS.filter((g) => g.pos.join() === f.pos.join()).map((g) => world[g.index]).sort().join('');
        return pair === 'FU';
      }).map((f) => f.index),
    };
    for (const spec of sc.selectors) {
      assert.equal(expected[spec].length, 1, `${sc.id}: precondition — the oracle names one facelet for ${spec}`);
      assert.deepEqual(await litFacelets(spec), expected[spec], `${sc.id}: "${spec}" lit the wrong stickers`);
    }
  },
  // Plan item 4.1: a set with a minus. The oracle's layout says which facelets are the top layer's edges and
  // centre — every facelet on a cubie with y = 1 that is not a corner.
  async 'selector-sets'(sc) {
    await build({ alg: sc.alg || 'U U\'' });
    await drawn(0);
    const expected = FACELETS.filter((f) => f.pos[1] === 1 && f.pos.filter(Boolean).length < 3).map((f) => f.index).sort((a, b) => a - b);
    assert.equal(expected.length, 9, `${sc.id}: precondition — four edges of two stickers and a centre`);
    assert.deepEqual(await litFacelets(sc.selector), expected, `${sc.id}: "${sc.selector}" lit the wrong stickers`);
  },
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

/**
 * Let every turn the element was handed land: advance its pinned clock a frame at a time until nothing
 * is animating. A stop group feeds one token at a time, so this takes as many frames as the group has.
 */
const settle = () => page.evaluate(async () => {
  const el = window.__cube;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let i = 0; i < 60; i++) {
    el.clock = el._now() + 500;
    await frame();
    if (!window.__publicCube(el).animating) { await frame(); if (!window.__publicCube(el).animating) return; }
  }
  throw new Error('the element was still animating after 60 frames');
});

/** A driver over the element in the page, through the public cube. `kind` is `clock` or `stop`. */
const drive = (kind, doc) => page.evaluate(([k, d]) => {
  const built = window.__script.buildScript(d);
  const cube = window.__publicCube(window.__cube);
  window.__driver = k === 'clock'
    ? window.__script.createClockDriver(built, { cube })
    : window.__script.createStopDriver(built, { cube });
}, [kind, doc]);
const call = (method, ...args) => page.evaluate(([m, a]) => {
  const out = window.__driver[m](...a);
  return out && { position: out.position, moves: out.moves, hold: out.hold, kind: out.kind };
}, [method, args]);
const attribute = (name) => page.evaluate((n) => window.__publicCube(window.__cube).getAttribute(n), name);

/** The player half's runners that need a drawing: each drives the REAL element and reads it back. */
const PLAYER_RUNNERS = {
  // R2: the hold is written once, when the sequence loads, and the sequence turns the cube. A player that
  // wrote the current hold on every paint would draw `y` twice — the element's frame and the attribute.
  async 'episode-hold-timeline'(sc) {
    await build({});
    await drive('clock', { schema: 2, start: { hold: 'U F' }, steps: [{ say: 'watch', at: 0 }, { move: sc.moves, at: 1 }] });
    const oracle = play(SOLVED_FACELETS, 'U F', sc.moves);
    const times = [0, ...tokens(sc.moves).map((_, j) => 1 + j * 0.55 + 0.01)];
    for (const [k, t] of times.entries()) {
      await call('paint', t);
      await settle();
      assert.equal(await attribute('orientation'), 'U F', `${sc.id}: the hold was written again at ${t}s`);
      assert.equal(toWorld(await readStickers(page)), oracle.worlds[k], `${sc.id}: at ${t}s (${k} of the child's moves)`);
    }
  },

  // R7 and cubus-im lesson 10 §4: a trailing whole-cube turn is turned when the schedule says, never
  // when its segment is loaded — the flip comes after the sentence that announces it.
  async 'timed-trailing-rotation'(sc) {
    await build({});
    const identity = startOf(sc);
    await drive('clock', {
      schema: 2,
      start: { hold: sc.start.hold, scramble: sc.start.setup },
      steps: [{ say: 'the first layer is done', at: 0 }, { say: 'now turn it over', at: 2 }, { move: sc.moves, at: 4 }],
    });
    const oracle = play(identity, sc.start.hold, sc.moves);
    for (const t of [0, 2, 3.99]) {
      await call('paint', t);
      await settle();
      assert.equal(toWorld(await readStickers(page)), oracle.worlds[0], `${sc.id}: turned over at ${t}s, before its time`);
    }
    await call('paint', 4.01);
    await settle();
    assert.equal(toWorld(await readStickers(page)), oracle.worlds.at(-1), `${sc.id}: not turned over at its time`);
  },

  // R3: a walk moves by stops. `y R` is one press, played as a group, and back undoes the whole group.
  async 'walk-stops'(sc) {
    for (const walk of sc.walks) {
      await build({});
      await drive('stop', { schema: 2, start: { hold: 'U F' }, steps: [{ move: walk }] });
      const oracle = play(SOLVED_FACELETS, 'U F', walk);
      assert.equal((await call('next')).position, 1, `${sc.id}: "${walk}" is one stop`);
      await settle();
      assert.equal(toWorld(await readStickers(page)), oracle.worlds.at(-1), `${sc.id}: "${walk}" after one press`);
      assert.equal((await call('back')).position, 0);
      await settle();
      assert.equal(toWorld(await readStickers(page)), oracle.worlds[0], `${sc.id}: back did not undo "${walk}" whole`);
    }
  },

  // R5: a planned slice, reported by a smart cube as two face turns in either order, is followed with no
  // off-plan note — and the drawing ends where the walk does.
  async 'walk-reports'(sc) {
    const Cube = require('cubejs');
    for (const reports of sc.reports) {
      await build({});
      await drive('stop', { schema: 2, start: { hold: 'U F' }, steps: [{ move: sc.planned }] });
      const cube = new Cube();
      const read = [];
      for (const turn of reports.split(' ')) {
        cube.move(turn);
        read.push(await page.evaluate((f) => window.__driver.observe(f), cube.asString()));
        await settle();
      }
      assert.deepEqual(read.filter((r) => r.kind === 'off'), [], `${sc.id}: "${reports}" was called off plan`);
      assert.equal(read.at(-1).position, tokens(sc.planned).length, `${sc.id}: "${reports}" did not finish the walk`);
      assert.equal(toWorld(await readStickers(page)), play(SOLVED_FACELETS, 'U F', sc.planned).worlds.at(-1),
        `${sc.id}: the drawing did not end where "${reports}" left the cube`);
    }
  },
};

for (const sc of SCENARIOS.filter((s) => s.half === 'player' && BROWSER_PLAYER_KINDS.includes(s.kind))) {
  const open = OPEN_ITEMS.includes(sc.closedBy);
  test(`${sc.id} (${sc.source})`, async (t) => {
    await underGapRules(t, sc, open, () => {
      const runner = PLAYER_RUNNERS[sc.kind];
      if (!runner) throw new Error(`no runner for "${sc.kind}" yet — it arrives with plan item ${sc.closedBy}`);
      return runner(sc);
    });
  });
}

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
