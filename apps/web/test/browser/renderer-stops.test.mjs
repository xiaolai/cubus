// Stops: the positions a child's walk waits at, and the transport that plays between them.
//
// dev-docs/tutorial-capability-plan.md item 2.3; dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md
// decision 9 and R4. A whole-cube turn changes nothing about the cube's arrangement, so a walk cannot
// observe it and must not wait at it: it belongs to the group of the move it leads into. `x y R` is ONE
// stop — the child regrips and turns — and the group's tokens are fed one at a time, because handing
// three to the element at once lets the backlog rule (more than two pending, the oldest completes at
// once) snap the regrip away.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { readMatrices } from './drawn-cube.mjs';
import { startBrowserFixture } from './harness.mjs';

let fixture; let page;

before(async () => {
  fixture = await startBrowserFixture();
  page = await fixture.browser.newPage();
  await page.goto(`${fixture.base}/index.html`);
  await page.waitForFunction(() => !!customElements.get('cubus-cube'));
});

after(async () => { await fixture?.close(); });

/** A fresh element with `attrs`, one frame in, on a pinned clock, recording every `cubus-step`. */
const build = (attrs) => page.evaluate(async (a) => {
  if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
  const el = document.createElement('cubus-cube');
  el.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:240px;z-index:99999';
  for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
  el.clock = 1_000_000;
  window.__steps = [];
  el.addEventListener('cubus-step', (e) => window.__steps.push(e.detail));
  document.body.appendChild(el);
  window.__cube = el;
  await new Promise((r) => requestAnimationFrame(() => r()));
  window.__steps.length = 0; // the mount's own report; each test starts from what it did itself
}, attrs);

const call = (method, ...args) => page.evaluate(([m, a]) => window.__cube[m](...a), [method, args]);
const steps = () => page.evaluate(() => window.__steps.map((d) => ({ ...d })));
const stops = () => page.evaluate(() => window.__cube.stops);
/** Advance the pinned clock by `ms` and let one frame run. */
const advance = (ms) => page.evaluate(async (by) => {
  const el = window.__cube;
  el.clock = el._now() + by;
  await new Promise((r) => requestAnimationFrame(() => r()));
}, ms);
/** How deep the element's animation backlog is — what `_drainBacklog` decides on. */
const pending = () => page.evaluate(() => window.__cube._queue.length + (window.__cube._anim ? 1 : 0));

test('where a sequence stops: after every move that changes the pieces, and at the end', async () => {
  const cases = [
    ['', [0]],
    ["R U R'", [0, 1, 2, 3]],
    ['x y R', [0, 3]],
    ['U x y R', [0, 1, 4]],
    ['x U', [0, 2]],
    ['x y', [0, 2]], // no piece ever moves: one hold-only stop at the end
    ["U U'", [0, 1, 2]],
    ["M M'", [0, 1, 2]], // a slice moves pieces, so each is a stop of its own
    ['R x', [0, 1, 2]], // a trailing regrip is a stop: it is where the sequence leaves the cube
    ['Rw U', [0, 1, 2]],
  ];
  for (const [alg, expected] of cases) {
    await build({ alg });
    assert.deepEqual(await stops(), expected, `stops of "${alg}"`);
  }
});

test('a group animates every token of itself, one at a time, and the backlog never snaps a regrip', async () => {
  await build({ alg: 'x y R' });
  const at0 = await readMatrices(page);
  await call('seek', 3);
  const at3 = await readMatrices(page);
  await call('seek', 0);
  await page.evaluate(() => { window.__steps.length = 0; });

  await call('stepStop');
  const mid = [];
  for (let token = 0; token < 3; token++) {
    // 190 ms a quarter turn at the default tempo: read half way through this token, then land it.
    await advance(95);
    assert.equal(await pending(), 1, 'a group queued more than one token at once — the backlog rule can snap it');
    mid.push(await readMatrices(page));
    await advance(120);
  }
  assert.deepEqual(await readMatrices(page), at3, 'the group did not land on its stop');
  for (const [i, m] of mid.entries()) {
    assert.notDeepEqual(m, at0, `token ${i} was not drawn part way through — it was completed at once`);
    assert.notDeepEqual(m, at3, `token ${i} was not drawn part way through — it was completed at once`);
  }
  assert.deepEqual(await steps(), [
    { index: 1, total: 3, stop: 0, stops: 1 },
    { index: 2, total: 3, stop: 0, stops: 1 },
    { index: 3, total: 3, stop: 1, stops: 1 },
  ], 'every token reports, and only the last is at a stop');
});

test('stepBackStop() undoes the whole group', async () => {
  await build({ alg: 'x y R' });
  const at0 = await readMatrices(page);
  await call('stepStop');
  for (let i = 0; i < 3; i++) await advance(220);
  await page.evaluate(() => { window.__steps.length = 0; });

  await call('stepBackStop');
  for (let i = 0; i < 3; i++) {
    assert.equal(await pending(), 1, 'the undo queued more than one token at once');
    await advance(220);
  }
  assert.deepEqual(await readMatrices(page), at0, 'stepBackStop left the cube part way through the group');
  assert.deepEqual((await steps()).map((d) => d.index), [2, 1, 0], 'the undo counts down token by token');
});

test('a stop command mid-group settles that group first', async () => {
  // Stops at 0, 1 and 4: `U`, then the group `x y R`, then the trailing `U'` at 5.
  await build({ alg: "U x y R U'" });
  assert.deepEqual(await stops(), [0, 1, 4, 5]);
  await call('stepStop');
  await advance(220);
  await call('stepStop'); // the group x y R
  await advance(95); // part way through `x`
  await page.evaluate(() => { window.__steps.length = 0; });

  await call('stepStop'); // the child asked for the next stop while the regrip was still turning
  assert.deepEqual((await steps()).map((d) => d.index), [2, 3, 4],
    'the group did not settle: its remaining tokens should land at once, and nothing further');
  assert.equal(await page.evaluate(() => window.__cube._applied), 4, 'the settled group did not reach its stop');
  assert.equal(await pending(), 1, 'the new group was not started, or was queued whole');
  await advance(220);
  const played = await readMatrices(page);
  await call('seek', 5);
  assert.deepEqual(played, await readMatrices(page), 'the settle-then-play path is not the cube at stop 3');
});

test('with no whole-cube turn, stops are tokens and stepStop is step', async () => {
  const alg = "R U R' U'";
  await build({ alg });
  const byStop = [];
  for (let k = 0; k < 4; k++) { await call('stepStop'); await advance(400); byStop.push(await readMatrices(page)); }
  const byStopSteps = await steps();

  await build({ alg });
  for (let k = 0; k < 4; k++) {
    await call('step');
    await advance(400);
    assert.deepEqual(await readMatrices(page), byStop[k], `"${alg}": stepStop and step drew different cubes at ${k + 1}`);
  }
  assert.deepEqual(byStopSteps, await steps(), 'stepStop and step reported differently');
  assert.deepEqual(byStopSteps.map((d) => [d.index, d.stop]), [[1, 1], [2, 2], [3, 3], [4, 4]]);
});

test('a jump and a reload report the stop they land on', async () => {
  await build({ alg: 'U x y R' });
  await call('seek', 2);
  assert.deepEqual((await steps()).at(-1), { index: 2, total: 4, stop: 1, stops: 2 }, 'a seek into a group reports the stop behind it');
  await call('seek', 4);
  assert.deepEqual((await steps()).at(-1), { index: 4, total: 4, stop: 2, stops: 2 });
  await call('reset');
  assert.deepEqual((await steps()).at(-1), { index: 0, total: 4, stop: 0, stops: 2 });
});

test('a group in flight is dropped by a new alg, a reset and a seek', async () => {
  for (const interrupt of [
    () => page.evaluate(() => window.__cube.setAttribute('alg', "R U R'")),
    () => call('reset'),
    () => call('seek', 0),
  ]) {
    await build({ alg: 'x y R' });
    await call('stepStop');
    await advance(95);
    await interrupt();
    await advance(1000);
    assert.equal(await page.evaluate(() => window.__cube._group), null, 'a group outlived the sequence it belonged to');
    assert.equal(await page.evaluate(() => window.__cube._applied), 0, 'a dropped group went on playing');
  }
});

// `stepStop` goes to the element's OWN next stop, and the element groups a sequence its own way: a regrip
// belongs to the turn it leads into, so `x y R` is one group. A script gives every STEP a position, so a
// step that only regrips ends INSIDE one of those groups — reachable only by `seek`, which snaps the very
// turn D4's "turn the whole cube so the gap is in front of you" exists to show (Codex audit and its verify
// pass, 2026-09-16). `playTo` is the element's answer: any token, walked the way a group plays.
// THREE FINDINGS, ONE MECHANISM (audit, 2026-09-16). `stepStop`, `playTo` and `stepBackStop` were three
// copies of one procedure — settle, check the press still means something, pick a target, start — and each
// kept its own copy of the lifecycle rules. The copies had drifted into two real defects, and the fix is one
// `_walkTo`: a freshness check that notices a cube sent somewhere else, and transports that exclude.

test('a step listener that seeks or resets mid-settle does not have the old press carry on', async () => {
  // `_sol` identity says the SEQUENCE was not replaced. It says nothing about the cube having been sent
  // somewhere else WITHIN it, because reset() and seek() leave `_sol` exactly as it was — so the old check
  // passed and the press walked on from a cursor that had moved under it. Reproduced by the audit as an
  // overrun past the end of the solution.
  for (const [what, act] of [['seek', 'seek(4)'], ['reset', 'reset()']]) {
    const outcome = await page.evaluate(async (call) => {
      const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
      if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
      const el = document.createElement('cubus-cube');
      el.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
      el.setAttribute('alg', 'x y R U');
      document.body.appendChild(el); window.__cube = el;
      await tick();
      el.clock = 1_000_000;
      el.stepStop();                               // a group in flight
      let fired = false;
      const errors = [];
      window.addEventListener('error', (e) => { errors.push(String(e.message)); e.preventDefault?.(); });
      el.addEventListener('cubus-step', function once() {
        if (fired) return;
        fired = true;
        // eslint-disable-next-line no-eval
        eval(`el.${call}`);
      });
      el.stepStop();                               // settles the first group, and the listener moves the cube
      el.clock = 1_000_000 + 60_000;
      await tick(); await tick();
      return { cursor: el._cursor, length: el._sol.length, errors };
    }, act);
    assert.deepEqual(outcome.errors, [], `${what} during a settle threw: ${outcome.errors.join(', ')}`);
    assert.ok(outcome.cursor >= 0 && outcome.cursor <= outcome.length,
      `${what} during a settle left the cursor at ${outcome.cursor} of ${outcome.length}`);
  }
});

test('a bounded walk supersedes continuous play, and pause stops a group too', async () => {
  const land = (setup) => page.evaluate(async (call) => {
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    if (window.__cube) { window.__cube.dispose?.(); window.__cube.remove?.(); }
    const el = document.createElement('cubus-cube');
    el.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
    el.setAttribute('alg', 'R U F');
    document.body.appendChild(el); window.__cube = el;
    await tick();
    el.clock = 1_000_000;
    // eslint-disable-next-line no-eval
    eval(call);
    el.clock = 1_000_000 + 60_000;
    await tick(); await tick(); await tick();
    return { cursor: el._cursor, playing: el._playing, group: el._group };
  }, setup);

  // play() then playTo(1): the cube must stop at 1. It used to leave `_playing` set and run to the end —
  // two transports driving one cursor, and the one the caller asked for losing.
  const bounded = await land('el.play(); el.playTo(1);');
  assert.equal(bounded.cursor, 1, `play() then playTo(1) finished at ${bounded.cursor}, not 1`);
  assert.equal(bounded.playing, false, 'continuous play was left running under a bounded walk');

  // pause() during a stop group: clearing only `_playing` left `_advanceGroup` walking on.
  const paused = await land('el.stepStop(); el.pause();');
  assert.equal(paused.group, null, 'pause() left a stop group advancing');
  assert.ok(paused.cursor < 3, `pause() let the group run to ${paused.cursor} of 3`);
});

test('playTo walks to any token, one at a time, and lands exactly there', async () => {
  await build({ alg: 'x y R U' });
  const outcome = await page.evaluate(async () => {
    const el = window.__cube;
    const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
    const settle = async () => {
      for (let i = 0; i < 40 && el.animating; i += 1) {
        el.clock = el._now() + 500;
        await tick();
      }
      await tick();
    };
    const steps = [];
    el.addEventListener('cubus-step', (e) => steps.push(e.detail.index));
    // Into the middle of the element's own group — token 2 of the group [x, y, R].
    el.playTo(2);
    await settle();
    const forward = { cursor: el._cursor, steps: [...steps] };
    // And back out of it, the same way.
    el.playTo(0);
    await settle();
    const back = { cursor: el._cursor, steps: [...steps] };
    // Out of range is clamped, not refused: a host's model of the length is not this element's.
    el.playTo(99);
    await settle();
    return { forward, back, clamped: el._cursor, total: el._sol.length };
  });
  assert.equal(outcome.forward.cursor, 2, 'playTo did not land on the token it was asked for');
  assert.ok(outcome.forward.steps.length >= 2, 'the tokens were not played one at a time');
  assert.equal(outcome.back.cursor, 0, 'playTo could not walk backwards out of a group');
  assert.equal(outcome.clamped, outcome.total, 'an out-of-range ask left the cube part way');
});
