// The die: what a press HOLDS, and where a press that produces nothing is SAID.
//
// Two failures, both invisible from outside and both about the same button (found by audit,
// 2026-09-05):
//
//   * The press stayed live for the length of the roll. Rolling is a real Kociemba search — the
//     die was disabled only afterwards, while the answer was being solved — so two presses could
//     be in flight at once, land in either order, and let the EARLIER one adopt its cube over the
//     later one on a screen already showing it. The press is held from before the first await
//     now, and each roll carries a generation, so a superseded roll is parked rather than adopted.
//   * A roll that produced nothing was reported to the console on any screen without a solution
//     card — which is every screen showing a solved cube. For the person pressing the button that
//     is indistinguishable from a button that does nothing.
//
// A file of its own because the fixture is the point: the dev die is on the solve screen only
// when Advanced has asked for it, and the subject has to be a SOLVED cube — the one composition
// that draws no solution card and therefore has no move count to write a failure into.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let win;
let state;
const $ = (sel) => win.document.querySelector(sel);
const go = async (id) => { win.cubusGo(id); await tick(); };

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
  // Written before the app is imported: settings are read once, at module evaluation.
  win.localStorage.setItem('cubusSettings', JSON.stringify({
    theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: [],
    navDefaults: 99, devRandCube: true, language: '', dragRotate: false, solveTier: 'twenty',
  }));
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  ({ state } = await import('../lib/app.js'));
  await tick();
  await settle(1500); // the solver loads in the background, and the die does nothing without it
});

// The failure has to reach the person who pressed the button. `#moveCount` is where it is said
// while there is a walk — the same line failWalk uses, so one press gets one set of words — and a
// solved cube has no such line at all.
test('a roll that produces nothing is said on a screen with no solution card', async () => {
  const parse = Cube.fromString;
  // The roll goes through cubejs's parser before it goes anywhere near a search (it draws a
  // state, then asks whether that state is one turn from solved). Taking the parser away is the
  // shortest honest way to make a real roll fail the way the pool can fail.
  Cube.fromString = () => { throw new Error('test: the parser is gone'); };
  try {
    // A cube rolled ahead of the press is handed over without rolling anything, so it has to be
    // drained first or this tests the happy path. The Timer's own scramble takes it — the take is
    // synchronous — and the roll that would replace it fails on the same broken parser.
    await go('timer');
    await settle(150);
    await go('home');
    await settle(100);

    assert.equal(state.cube.facelets, SOLVED, 'precondition: the subject is a solved cube');
    assert.equal($('#moveCount'), null, 'precondition: a solved cube draws no solution card, so there is no count to write into');
    const die = $('#randCube');
    assert.ok(die, 'precondition: Advanced put the dev die on the solve screen');
    const say = $('#rollSay');
    assert.ok(say, 'the die needs a line of its own, or a failed press has nowhere to be said');
    assert.equal(say.getAttribute('role'), 'status', 'and it must be announced, not merely drawn');

    die.click();
    await settle(200);
    assert.match($('#rollSay').textContent, /could not be rolled/i,
      'the press failed into the console alone — from the outside that is a button that does nothing');
  } finally {
    Cube.fromString = parse;
  }
});

// The press is the moment the button stops being available, not the moment the answer starts
// being solved. Everything between those two used to be a window in which a second press rolled a
// second cube.
test('the die is held from the press, not from after the roll', async () => {
  await go('home');
  await settle(100);
  const die = $('#randCube');
  assert.ok(die, 'precondition: the dev die is drawn');
  assert.equal(die.disabled, false, 'precondition: the die is available');
  const before = state.cube.facelets;

  die.click();
  assert.equal(die.disabled, true,
    'the die stayed live across the roll it started — a second press rolls a second cube, and the two can land in either order');
  die.click(); // held, so this one does nothing at all

  await settle(3000);
  assert.notEqual(state.cube.facelets, before, 'the press produced a cube');
  assert.equal($('#randCube').disabled, false, 'and the die comes back, or one roll costs the screen its button');
});
