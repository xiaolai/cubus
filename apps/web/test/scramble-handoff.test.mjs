// "Solve this scramble" — the button that hands Home a target, and the two ways it was offered
// with nothing to hand over (found by audit, 2026-09-05).
//
// The button's visibility was keyed on the COUNT: `solveIt.hidden = i < total`. Between
// beginWalk() and the roll landing — and permanently after a roll that failed — `total` is 0 and
// `i` is 0, so `0 < 0` is false and the button was drawn, labelled "Solve this scramble", over a
// `target` that was still null. Pressing it called adoptCube(null): a subject with no facelets,
// on the app's front door.
//
// A file of its own because the fixture is a WALK THAT DOES NOT EXIST YET, in both of its shapes
// — one that has not landed, and one that never will — and both are states the scramble screen
// spends real time in.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let win;
let state;
const $ = (sel) => win.document.querySelector(sel);
const all = (sel) => [...win.document.querySelectorAll(sel)];
const go = async (id) => { win.cubusGo(id); await tick(); };

/** Poll until `fn()` is true. Rolling a scramble is a real search behind the solver pool. */
const waitFor = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await settle(20);
  }
  return false;
};

before(async () => {
  win = new Window({
    url: 'http://localhost/#/home',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  ({ state } = await import('../lib/app.js'));
  await tick();
  await settle(1500); // the solver loads in the background, and nothing rolls without it
});

// The loading window. Every observation taken while the walk is still being worked out must find
// the hand-off hidden — this is the state the screen is in for as long as the roll takes.
test('the hand-off is not offered while the scramble is still being worked out', async () => {
  await go('scramble');
  assert.ok(await waitFor(() => all('#solList .chip-m').length > 0),
    'precondition: this screen can roll a scramble at all');

  // SYNCHRONOUSLY, with nothing awaited between the navigation and the look. Re-entering the
  // screen already showing renders in place (go → applyRoute), and the mount then runs straight
  // through beginWalk() to loadWalk's first await, which is the roll — so this is the screen
  // exactly as it waits. It is also the one observation that cannot be raced: a roll already
  // parked resolves in a microtask, and any `await` here would let it through.
  win.cubusGo('scramble');
  const btn = $('#solveItBtn');
  assert.ok(btn, 'precondition: the scramble screen draws the hand-off button');
  assert.equal(all('#solList .chip-m').length, 0, 'precondition: no walk yet');
  assert.equal($('#moveCount').textContent, 'working…', 'precondition: the screen is waiting for a roll');
  assert.equal(btn.hidden, true,
    'the hand-off was on screen before there was a scramble — a press stores a cube with no facelets');

  const landed = await waitFor(() => all('#solList .chip-m').length > 0);
  assert.ok(landed, 'no scramble was ever rolled');
  assert.equal($('#solveItBtn').hidden, true, 'a walk nobody has walked yet has nothing to hand over either');
});

// And the state a failed roll leaves behind, which is the same one that never ends.
test('a roll that failed leaves no hand-off standing, and a press stores nothing', async () => {
  await go('scramble');
  const landed = await waitFor(() => all('#solList .chip-m').length > 0);
  assert.ok(landed, 'precondition: a scramble to start from');

  // Completed: the hand-off is what a finished walk offers, so this is the positive control for
  // everything below — the button really is drawn when there IS something to hand over.
  const total = all('#solList .chip-m').length;
  const cube = $('#viewCube > cubus-cube');
  cube.dispatchEvent(new win.CustomEvent('cubus-step', { detail: { index: total, total } }));
  assert.equal($('#solveItBtn').hidden, false, 'precondition: a completed scramble offers the hand-off');
  const before = state.cube.facelets;

  // Rolling draws a state and asks cubejs whether it is trivial, so taking the parser away is the
  // shortest honest way to make a real roll fail the way the pool can fail (die-press.test.mjs
  // uses the same lever). Restored before anything is clicked: the assertions below are about the
  // screen, not about a broken oracle.
  const parse = Cube.fromString;
  Cube.fromString = () => { throw new Error('test: the parser is gone'); };
  try {
    $('#randCube').click();
    await settle(400);
  } finally {
    Cube.fromString = parse;
  }
  assert.equal(all('#solList .chip-m').length, 0, 'precondition: the roll produced no walk');
  assert.match($('#moveCount').textContent, /could not|couldn/i, 'precondition: the failure is said');

  assert.equal($('#solveItBtn').hidden, true,
    'the hand-off outlived the scramble it was offering — it names a target that no longer exists');
  // Belt and braces: the handler is the second guard, because `hidden` is a property any later
  // paint could get wrong and the consequence of a press is a stored cube with no facelets.
  $('#solveItBtn').click();
  await tick();
  assert.equal(state.screen, 'scramble', 'a press with nothing to hand over navigated anyway');
  assert.equal(state.cube.facelets, before, 'and it replaced the subject with a null cube');
});

// One tokenizer and one replay, for both ends of the walk.
//
// The scramble branch used to split its own alg (`gotAlg.trim().split(/\s+/)`) and replay its own
// per-step states, beside `movesOf` and `stepStates` doing exactly that for the solve side. Two
// copies of one rule is how one copy stops being verified, and these two had already drifted:
// the inline replay THREW where stepStates warns and returns a short array, so one end of the
// walk called a failed replay a failed roll and the other end shipped the short array.
test('the scramble branch tokenizes and replays through the shared helpers, not its own copies', () => {
  const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
  const at = app.indexOf('const rolled = await randomScramble();');
  assert.notEqual(at, -1, 'the scramble branch moved — find it again rather than deleting this test');
  const end = app.indexOf('} else {', at);
  assert.ok(end > at, 'the scramble branch no longer ends at the solve branch');
  const branch = app.slice(at, end);

  assert.match(branch, /movesOf\(/, 'the scramble must be tokenized by the one tokenizer');
  assert.match(branch, /stepStates\(/, 'and replayed by the one replay');
  // Comments in this region talk ABOUT the helpers, so the negatives are asked of code only.
  const code = branch.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /\.split\(/, 'a second tokenizer is back in the scramble branch');
  assert.doesNotMatch(code, /asString\(/, 'a second per-step replay is back in the scramble branch');
  // And the shared replay degrades quietly by design (a short array, a warning), so the branch
  // that cannot use a short one has to say so itself.
  assert.match(code, /gotSteps\.length !== gotMoves\.length \+ 1/,
    'a replay that came up short must be a failed roll, not a walk with a missing step');
});
