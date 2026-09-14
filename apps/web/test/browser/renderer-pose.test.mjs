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
    return el.cubies.map((c) => [...c.matrixWorld.elements].map((v) => Math.round(v * 1e5) / 1e5));
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
