// The two things A1b had to prove beyond "the picture is unchanged"
// (dev-docs/renderer-v2-plan.md §4 A1b).
//
// POSE, PAINT AND IDENTITY ARE THREE SOURCES. The pose is arithmetic over {cp,co,ep,eo}, which is
// always a legal cube. The PAINT is the facelet string verbatim — any 54 characters of URFDLB?,
// including a half-read scan, including a string no cube could ever be — and `screens/scan.js`
// feeds exactly that while a scan is running. The IDENTITY behind `piece:` may be absent, and
// `_stampPieces` deliberately writes null when the letters name no piece. Deriving all three from
// the piece state would have been the obvious simplification and would have broken a live scan.
//
// AND FOCUS IS HISTORY-DEPENDENT. `focus` resolves inside `_paint()`, and a completed move
// re-resolves the highlight but NOT the focus — so the same attributes on the same final cube give
// two different pictures depending on whether the focus was set before or after the turn. A pose
// that is a pure function of the state would quietly make those two agree. The plan required that
// to be decided rather than drifted into: it is PRESERVED, and this is the case that says so.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startBrowserFixture } from './harness.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
/** A scan two sides in: the rest unread. Not a legal cube, and not meant to be. */
const HALF_READ = `${'U'.repeat(9)}${'R'.repeat(9)}${'?'.repeat(27)}${'B'.repeat(9)}`;
/** Six faces of one colour: a string the parser accepts and no cube can be. */
const ALL_ONE = 'U'.repeat(54);
let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

/** A cube with `attrs`, one frame in, on a pinned clock so nothing is caught mid-breath. */
const build = (attrs) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
  for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
  el.clock = 2_000_000;
}, attrs);

/** What each sticker is painted, in the element's own order. */
const paint = () => page.evaluate(() => window.__cube.stickers.map((m) => m.material.color.getHex()));
/** Which piece each cubie is stamped with — null where the letters name none. */
const stamps = () => page.evaluate(() => window.__cube.cubies.map((c) => c.userData.piece ?? null));
/** Play `alg` to its end with the clock pinned past every turn. */
const play = (alg) => page.evaluate(async (a) => {
  const el = window.__cube;
  el.setAttribute('alg', a);
  el.clock = 2_000_000;
  for (let i = 0; i < a.trim().split(/\s+/).length; i++) el.step();
  el.clock = 3_000_000;
  await new Promise((r) => requestAnimationFrame(() => r()));
}, alg);

test('a half-read cube animates, and the unread stickers stay unread', async () => {
  await build({ facelets: HALF_READ });
  const before2 = await paint();
  const stamped = await stamps();
  await play("R U R'");
  assert.deepEqual(await paint(), before2, 'a turn repainted a scan that is still being read');
  assert.deepEqual(await stamps(), stamped, 'a turn invented or lost a piece identity');
  // Twenty-seven unread stickers means at least nine cubies carry letters that name no piece.
  assert.ok(stamped.filter((p) => p === null).length >= 9,
    'an unread cube was given identities it cannot have');
});

test('a string no cube could be still draws, and claims no identities', async () => {
  await build({ facelets: ALL_ONE });
  const stamped = await stamps();
  // The CENTRES keep a stamp, and should: a centre shows one letter, and a cubie showing `U` is
  // the U centre whatever the rest of the string says — there is no other reading of it. What must
  // claim nothing is the twenty movable cubies, whose letters here name no piece that exists.
  const movable = await page.evaluate(() => window.__cube.cubies
    .map((c, i) => (Math.abs(c.position.x) + Math.abs(c.position.y) + Math.abs(c.position.z) > 1 ? i : -1))
    .filter((i) => i >= 0));
  assert.equal(movable.length, 20, 'precondition: twenty cubies move and six are centres');
  assert.deepEqual(movable.map((i) => stamped[i]).filter(Boolean), [],
    'a cube of one colour was stamped with pieces, so `piece:` would match on a fiction');
  const before2 = await paint();
  await play('F2 L');
  assert.deepEqual(await paint(), before2, 'a turn repainted an impossible cube');
  assert.deepEqual(await stamps(), stamped, 'a turn stamped identities onto an impossible cube');
});

// The check the plan asked for by name: an isolated focus picture cannot tell these apart, because
// both end on the same cube with the same attributes. Only the ORDER differs.
test('focus set before a turn and after it are different pictures, and still are', async () => {
  await build({ facelets: SOLVED, focus: 'slot:UR' });
  await play('R');
  const setBefore = await paint();

  await build({ facelets: SOLVED });
  await play('R');
  await page.evaluate(() => { window.__cube.setAttribute('focus', 'slot:UR'); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const setAfter = await paint();

  assert.notDeepEqual(setBefore, setAfter,
    'focus stopped latching: set before a turn and set after it now give the same picture. That is '
    + 'arguably the better behaviour, but it is a DECISION, and A1b was not allowed to make it by '
    + 'accident (renderer-v2-plan.md §4 A1b).');
});

// A selector written while a turn is in flight names what was in its positions when the cube last
// SETTLED — never what the moving geometry rounds to. Halfway through R the UR edge sits at
// (1, 0.707, 0.707), which rounds to (1, 1, 1): a corner's coordinates, so `slot:UR` lit the URF
// corner, a piece no edge slot can hold (found by review, 2026-09-15; requirement R8 of
// dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md). The two channels then
// keep today's split (that record's decision 10): when the turn completes, highlight moves to the
// new occupant of UR and focus stays on the piece it named.
test('a selector written mid-turn names the settled occupant, and each channel keeps its own rule after', async () => {
  await build({ facelets: SOLVED });
  const got = await page.evaluate(async () => {
    const el = window.__cube;
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const at = (x, y, z) => el.cubies.find((c) => c.position.x === x && c.position.y === y && c.position.z === z);
    const pieceAtUR = () => at(1, 1, 0).userData.piece;
    const colours = () => el.cubies.map((c) => c.children.filter((m) => m.userData?.face).map((m) => m.material.color.getHex()).join());
    // The set holds stickers and their ghosts (plan item 4.1); a piece is lit when its stickers are.
    const lit = () => [...new Set([...(el._hlSet ?? [])].map((m) => m.parent.userData.piece))];
    const kept = (before) => { const now = colours(); return el.cubies.filter((c, i) => now[i] === before[i]).map((c) => c.userData.piece); };

    const settledUR = pieceAtUR();
    const trueColours = colours();
    el.setAttribute('alg', 'R');
    el.clock = 5_000_000;
    el.step();
    el.clock = 5_000_000 + 95;                          // halfway through a 190ms quarter turn
    await tick();
    const midTurn = el.cubies.some((c) => [c.position.x, c.position.y, c.position.z].some((v) => !Number.isInteger(v)));
    el.setAttribute('highlight', 'slot:UR');
    el.setAttribute('focus', 'slot:UR');
    await tick();
    const during = { highlight: lit(), focus: kept(trueColours) };
    el.clock = 5_000_000 + 400;                         // past the end of the turn
    await tick();
    return { settledUR, midTurn, during, after: { highlight: lit(), occupantUR: pieceAtUR() } };
  });

  assert.ok(got.midTurn, 'precondition: the selectors were written while the turn was in flight');
  assert.deepEqual(got.during.highlight, [got.settledUR],
    `highlight written mid-turn lit ${got.during.highlight.join(', ')}, not the piece settled in UR`);
  assert.ok(got.during.focus.includes(got.settledUR) && got.during.focus.length === 1,
    `focus written mid-turn kept ${got.during.focus.join(', ')} in colour, not the piece settled in UR`);
  assert.notEqual(got.after.occupantUR, got.settledUR, 'precondition: R moved a different piece into UR');
  assert.deepEqual(got.after.highlight, [got.after.occupantUR],
    'after the turn, highlight no longer follows its position to the new occupant');
});

test('every settled cubie sits on exact integers, with nothing rounded into place', async () => {
  await build({ facelets: SOLVED });
  await play("R U R' U' F2 D B L2");
  const off = await page.evaluate(() => window.__cube.cubies
    .map((c) => [c.position.x, c.position.y, c.position.z])
    .filter((p) => p.some((v) => !Number.isInteger(v))));
  assert.deepEqual(off, [], 'a settled cubie is off the lattice — the pose is drifting');
});

// The signed angle, checked where it actually matters — the transport, not the module. The plan
// names this case: finish `step()` on `R2`, then sample `stepBack()` halfway. A half turn has two
// ways round and both share their endpoints, so a descriptor carrying a TOKEN rather than a signed
// angle cannot tell them apart — and an undo that canonicalises puts the moving layer 180 degrees
// from where the forward playback has it at the mirrored instant.
test('an undone half turn retraces the way it came, not the other way round', async () => {
  await build({ facelets: SOLVED });
  const sample = (backwards) => page.evaluate(async (back) => {
    const el = window.__cube;
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    el.clock = null;
    el.reset();
    el.setAttribute('alg', 'R2');
    el.clock = 1_000_000;
    el.step();                        // a half turn runs 380ms at tempo 1
    if (back) {
      el.clock = 1_000_000 + 380;     // let it finish
      await tick();
      el.clock = 2_000_000;
      el.stepBack();                  // and undo it
      el.clock = 2_000_000 + 285;     // three quarters through the undo
    } else {
      el.clock = 1_000_000 + 95;      // one quarter through the turn
    }
    await tick();
    el.root.updateMatrixWorld(true);
    return el.cubies.map((c) => [...c.matrixWorld.elements].map((v) => Math.round(v * 1e5) / 1e5 + 0));
  }, backwards);

  const forward = await sample(false);
  const undone = await sample(true);
  // The easing is symmetric, so a quarter of the way forward and three quarters of the way back
  // are the same instant of the same rotation — reached from opposite ends.
  assert.deepEqual(undone, forward,
    'the undo took the other way round: the descriptor has lost the sign of its angle');
  assert.ok(forward.some((m) => m.some((v) => !Number.isInteger(v))),
    'precondition: the sample was taken mid-turn, not at an endpoint');
});

/** Every cubie's stickers as one string, so a greyed cubie can be told from an untouched one. */
const cubieColours = () => page.evaluate(() => window.__cube.cubies
  .map((c) => c.children.filter((m) => m.userData?.face).map((m) => m.material.color.getHex()).join()));
/** Which pieces are IN focus: the cubies still wearing their true colours. */
const inFocus = async (trueColours) => {
  const now = await cubieColours();
  return page.evaluate(([base, colours]) => window.__cube.cubies
    .filter((c, i) => colours[i] === base[i]).map((c) => c.userData.piece), [trueColours, now]);
};
const seek = (k) => page.evaluate(async (to) => {
  window.__cube.seek(to);
  await new Promise((r) => requestAnimationFrame(() => r()));
}, k);
const writeFocus = (v) => page.evaluate(async (sel) => {
  window.__cube.setAttribute('focus', sel);
  await new Promise((r) => requestAnimationFrame(() => r()));
}, v);

// R10 of dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md, and plan item 2.4 of
// dev-docs/tutorial-capability-plan.md. Focus LATCHES (decision 10), and a seek must not quietly undo
// that: `seek()` resets and repaints, so a focus bound after a turn used to be re-resolved at position 0
// and again at the position it came back to — a lesson that says "watch this piece", then scrubs, lit a
// different piece each time. The binding is to the pieces the selector named where it was written.
test('focus bound after a turn names the same pieces after a seek away and back', async () => {
  await build({ facelets: SOLVED, alg: 'R' });
  const trueColours = await cubieColours();
  await seek(1);
  await writeFocus('slot:UR');
  const bound = await inFocus(trueColours);
  assert.equal(bound.length, 1, `precondition: one piece is in focus, not ${bound.join(', ')}`);

  await seek(0);
  const atHome = await inFocus(trueColours);
  await seek(1);
  const back = await inFocus(trueColours);
  assert.deepEqual(atHome, bound, 'seeking away re-bound the focus to whatever was then in UR');
  assert.deepEqual(back, bound, 'seeking back re-bound the focus');

  // And the piece it stayed on is NOT the one a fresh reading at position 0 would name, or the case
  // would pass on a renderer that re-binds at every paint.
  await seek(0);
  await writeFocus('none');
  await writeFocus('slot:UR');
  assert.notDeepEqual(await inFocus(trueColours), bound,
    'precondition: at position 0 the UR slot holds a different piece, so a re-binding would be visible');
});

test('a new cube re-binds the focus; a new alg does not', async () => {
  await build({ facelets: SOLVED, alg: 'R' });
  const trueColours = await cubieColours();
  await seek(1);
  await writeFocus('slot:UR');
  const bound = await inFocus(trueColours);

  await page.evaluate(async () => {
    window.__cube.setAttribute('alg', "U R U'");
    await new Promise((r) => requestAnimationFrame(() => r()));
  });
  assert.deepEqual(await inFocus(trueColours), bound, 'a new sequence on the same cube re-bound the focus');

  await page.evaluate(async () => {
    window.__cube.setAttribute('scramble', "R U R'");
    await new Promise((r) => requestAnimationFrame(() => r()));
  });
  const afterLoad = await inFocus(trueColours);
  assert.equal(afterLoad.length, 1, `a loaded cube left ${afterLoad.length} pieces in focus`);
  assert.deepEqual(afterLoad, ['RU'], 'a new cube did not re-bind the focus to the slot it names');
});

// The regression the round-1 audit reproduced: `reset()` wrote the geometry AFTER painting, so
// `focus` — which resolves inside `_paint()` — answered for whatever the PREVIOUS cube had in the
// slot. Set focus on UR, turn R, reset, and the FR piece stayed coloured on a solved cube.
test('reset puts the cubies home before it paints, so focus names the cube in front of you', async () => {
  await build({ facelets: SOLVED, focus: 'slot:UR' });
  const solved = await paint();
  await play('R');
  await page.evaluate(async () => {
    window.__cube.reset();
    await new Promise((r) => requestAnimationFrame(() => r()));
  });
  assert.deepEqual(await paint(), solved,
    'after reset the cube is solved and focus is on slot UR, so it must look exactly as it did '
    + 'before the turn — it did not, so focus resolved against the geometry of the turned cube');
});

// `focus` and `highlight` share a grammar, so on the same cube at the same moment one selector names
// the same cubies for both. Each built its own reading of the cubies until 2026-09-14; this is the
// case that notices two readings drifting apart. Set on a settled cube with no turn in between,
// because focus latching across a turn is a separate, deliberate difference (see above).
test('focus and highlight name the same cubies for the same selectors', async () => {
  await build({ scramble: "R U F' L2 D B'" });
  const named = await page.evaluate(async () => {
    const el = window.__cube;
    const spec = 'slot:UR,piece:UF,slot:DFR';
    el.setAttribute('highlight', spec);
    el.setAttribute('focus', spec);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const lit = [...new Set([...el._hlSet].map((m) => el.cubies.indexOf(m.parent)))].sort((a, b) => a - b);
    // Out of focus is exactly grey: every palette colour has a hue, so r = g = b only when greyed.
    const grey = (m) => Math.abs(m.material.color.r - m.material.color.g) < 1e-9
      && Math.abs(m.material.color.g - m.material.color.b) < 1e-9;
    const kept = el.cubies.flatMap((c, i) => (c.children.some((m) => m.userData?.face && !grey(m)) ? [i] : []));
    return { lit, kept, total: el.cubies.length };
  });
  // Three DISTINCT cubies, so no selector is covered by another: were `piece:UF` sitting in UR, or a
  // kind like `edges` in the list, a reading that lost the piece identity would light the same set.
  assert.equal(named.lit.length, 3, `precondition: three selectors name three cubies (${named.lit})`);
  assert.deepEqual(named.kept, named.lit, 'focus kept different cubies from the ones highlight lit');
});

// And where it actually bit: the parser. An alg naming something every object has must be refused
// whole, as any other bad token is — not played, and not thrown on the first frame.
test('an alg naming what every object inherits is refused, not played', async () => {
  await build({ facelets: SOLVED });
  const outcome = await page.evaluate(async () => {
    const el = window.__cube;
    const warned = [];
    const real = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    const errors = [];
    const onError = (e) => errors.push(String(e.message ?? e));
    window.addEventListener('error', onError);
    try {
      const out = {};
      for (const tok of ['toString', 'constructor', '__proto__', 'R toString']) {
        out[tok] = el._parse(tok).length;
      }
      el.setAttribute('alg', 'toString');
      el.clock = 5_000_000;
      el.step();
      el.clock = 5_001_000;
      await new Promise((r) => requestAnimationFrame(() => r()));
      await new Promise((r) => requestAnimationFrame(() => r()));
      return { parsed: out, warned: warned.length, errors };
    } finally {
      console.warn = real;
      window.removeEventListener('error', onError);
    }
  });
  assert.deepEqual(outcome.parsed, { toString: 0, constructor: 0, __proto__: 0, 'R toString': 0 },
    'an inherited key was parsed as a move — and one bad token must refuse the whole alg');
  assert.ok(outcome.warned >= 4, 'the refusal went unsaid');
  assert.deepEqual(outcome.errors, [], 'a refused alg still threw when asked to play');
});

// The third instance of one class of defect: a palette name is whatever an author typed, and on an
// ordinary object `toString` is a function. It skipped the fallback and painted every sticker
// `undefined`, which left the previous colours standing (found by audit, 2026-09-14).
test('a palette named after something every object has falls back, like any unknown palette', async () => {
  await build({ facelets: SOLVED, palette: 'no-such-palette' });
  const unknown = await paint();
  for (const inherited of ['toString', 'constructor', '__proto__']) {
    await build({ facelets: SOLVED, palette: inherited });
    assert.deepEqual(await paint(), unknown,
      `palette="${inherited}" did not fall back the way an unknown palette does`);
  }
});

// The Stage-0 clock exists to make a frame reproducible, and autorotate went on turning under it:
// it added a fixed step every frame, so it also turned twice as fast on a 120 Hz display.
test('autorotate turns by time on the element\'s clock, and holds still when the clock does', async () => {
  const spins = await page.evaluate(async () => {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const el = window.__cube;
    el.setAttribute('autorotate', '');
    el.clock = 7_000_000;
    await tick();
    const pinned = [];
    for (let i = 0; i < 6; i++) { await tick(); pinned.push(el._spin); }
    el.clock = 7_000_000 + 1000;
    await tick();
    const oneSecond = el._spin - pinned[0];
    el.removeAttribute('autorotate');
    return { pinned, oneSecond };
  });
  assert.equal(new Set(spins.pinned).size, 1, `autorotate moved under a pinned clock: ${spins.pinned.join(', ')}`);
  // 0.0035 rad a frame at the 60 Hz it was tuned on is 0.21 rad a second — whatever the display.
  assert.ok(Math.abs(spins.oneSecond - 0.21) < 1e-9, `one second of clock turned the cube ${spins.oneSecond} rad, not 0.21`);
});

// The regression the round-2 verification reproduced: off screen the loop keeps running and returns
// before the spin code, so the reference time was kept, and the first frame back added the whole
// hidden stretch at once — a minute away leapt the cube 12.6 rad.
test('autorotate does not leap when the cube comes back on screen', async () => {
  const leap = await page.evaluate(async () => {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const el = window.__cube;
    el.setAttribute('autorotate', '');
    el.clock = 9_000_000;
    await tick(); await tick();
    const before = el._spin;
    el._visible = false;                 // what the IntersectionObserver reports off screen
    for (let i = 0; i < 3; i++) await tick();
    el.clock = 9_000_000 + 60_000;       // a minute passes while nobody can see it
    await tick();
    el._visible = true;
    await tick();
    const back = el._spin;
    el.removeAttribute('autorotate');
    return back - before;
  });
  assert.ok(Math.abs(leap) < 0.05, `a minute off screen turned the cube ${leap} rad on its return`);
});
