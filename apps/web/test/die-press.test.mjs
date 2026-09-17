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
import { isAbsent } from './dom-assert.mjs';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';
import { eventually, solverLoaded } from './fixtures/app-waits.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let win;
let state;
const $ = (sel) => win.document.querySelector(sel);
const go = async (id) => { win.cubusGo(id); await tick(); };
/** The cube `alg` turns a solved one into. */
const turned = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };

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
  await solverLoaded(); // the die ignores a press made before the solver has loaded
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
    isAbsent($('#moveCount'), 'precondition: a solved cube draws no solution card, so there is no count to write into');
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

  // Waited for as a fact — the die released — rather than a guessed three seconds, which a busy machine
  // outruns (test/fixtures/app-waits.mjs).
  await eventually(() => !$('#randCube').disabled, 'the roll to finish and the die to come back');
  assert.notEqual(state.cube.facelets, before, 'the press produced a cube');
  assert.equal($('#randCube').disabled, false, 'and the die comes back, or one roll costs the screen its button');
});

// On Scramble the roll IS the walk's load, and refreshScreen() only starts it: the press was let go
// the moment the click returned, with the count still "working…" and a second roll a click away
// (found by audit, 2026-09-13). The release is observed as it happens, not polled for.
test('on Scramble the die is held until the walk it rolled is on screen', async () => {
  await go('scramble');
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && !($('#solList .chip-m') && $('#randCube') && !$('#randCube').disabled)) {
    await settle(50);
  }
  const die = $('#randCube');
  assert.ok(die && !die.disabled && $('#solList .chip-m'), 'precondition: a scramble is walked and the die is available');
  const chips = () => [...win.document.querySelectorAll('#solList .chip-m')].map((chip) => chip.textContent).join(' ');
  const walked = chips();
  // Read in the setter that lets the press go, at that instant: a MutationObserver's record is
  // delivered later, by which time a walk still loading has had the chance to land.
  const own = Object.getOwnPropertyDescriptor(win.HTMLButtonElement.prototype, 'disabled');
  let atRelease = null;
  Object.defineProperty(die, 'disabled', {
    configurable: true,
    get() { return own.get.call(this); },
    set(on) {
      own.set.call(this, on);
      if (!on && atRelease === null) atRelease = { count: $('#moveCount')?.textContent ?? '', chips: chips() };
    },
  });
  try {
    die.click();
    assert.equal(die.disabled, true, 'the Scramble die came back while the roll it started was still running');
    const t1 = Date.now();
    while (Date.now() - t1 < 20000 && atRelease === null) await settle(50);
  } finally {
    delete die.disabled;
  }
  assert.ok(atRelease !== null, 'and the die comes back');
  // At release the walk on screen is the one the press rolled: not the last one, and not none.
  assert.ok(atRelease.chips && atRelease.chips !== walked, 'the die came back before the walk it rolled was on screen');
  const countAtRelease = atRelease.count;
  assert.notEqual(countAtRelease, 'working…', 'the die came back before the walk it rolled was on screen');
});

// Scramble walks from solved, so it draws solved until its roll lands — and says so. It was built
// from Home's subject: that cube's setup alg beside a solved net, and for good when the roll failed
// (found by audit, 2026-09-13). Read before any roll can land: renderScreen draws it synchronously.
test('Scramble starts from a solved cube, whatever Home was showing', async () => {
  const { adoptCube } = await import('../lib/cube-connection.js');
  const { deriveCube } = await import('../lib/cube-subject.js');
  const { renderScreen } = await import('../lib/screen-shell.js');
  adoptCube(turned('R U F'), { physical: false, source: 'generated', setupAlg: 'R U F' });
  await deriveCube();
  state.screen = 'scramble';
  renderScreen({ navigated: true });
  const cube = $('#viewCube > cubus-cube');
  assert.ok(cube, 'precondition: Scramble drew a cube');
  assert.equal(cube.getAttribute('scramble'), null, "Scramble drew Home's cube, not the solved one it starts from");
  assert.equal(cube.getAttribute('facelets'), SOLVED, 'and not a solved cube');
  assert.equal(cube.getAttribute('aria-label'), 'A solved cube', "and described Home's cube");
});

// A subject taken in place is the same renderer handed a new cube. It kept the words of the cube it
// replaced, because only building one wrote them (found by audit, 2026-09-13).
test('a cube taken in place is described as the cube it now is', async () => {
  const { adoptCube } = await import('../lib/cube-connection.js');
  const { deriveCube } = await import('../lib/cube-subject.js');
  adoptCube(turned('R'), { physical: true, source: 'camera' });
  await deriveCube();
  await go('home');
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && win.document.querySelectorAll('#solList .chip-m').length !== 1) await settle(50);
  const cube = $('#viewCube > cubus-cube');
  assert.ok(cube, 'precondition: Home drew the cube');
  assert.equal(cube.getAttribute('aria-label'), 'Your cube — 1 move from solved', 'precondition: described as it was built');
  const before = state.cube.facelets;
  $('#randCube').click();
  while (Date.now() - t0 < 40000 && !(state.cube.facelets !== before && !$('#randCube').disabled)) await settle(50);
  assert.ok(state.cube.facelets !== before, 'precondition: the die rolled a new cube');
  assert.ok($('#viewCube > cubus-cube') === cube, 'precondition: the new cube was taken in place');
  assert.equal(cube.getAttribute('aria-label'), `A scrambled cube — ${state.cube.moves.length} moves from solved`,
    'the renderer still describes the cube the die replaced');
});
