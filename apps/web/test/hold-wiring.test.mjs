// How the cube is held, where the rest of the suite never looked — ADR 0003.
//
// The browser suite drives the stage walks and the lesson's turn-over in a real WebKit, and
// `solving-hold.test.mjs` holds every renaming to the identity that defines it. What neither reached,
// found by the audit of 2026-09-13:
//
//   * the smart cube's off-plan line under a TURNED-OVER walk. Every test of that line followed a
//     scramble, which is held as scanned, where naming a move for the hold changes nothing — so a
//     missing or wrong hold there passed the whole suite.
//   * a walk that fails to load after a turned-over one. The failure path put the net and the heading
//     back and left the cube drawn upside down under "could not work it out".
//   * a hold asked for before `<cubus-cube>` is a renderer — every hold in happy-dom, where the
//     vendored bundle is never loaded. That branch wrote an `orientation` attribute that outlived the
//     pose it named.
//
// Its own file because the fixture is the point: the developer die on Home, so there is a scrambled
// cube to send back to a stage, and a parser that can be taken away mid-session.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import { TUMBLED, renameAlg } from '../lib/solving-hold.js';
import Cube from '../vendor/cubejs.js';
import { solverLoaded } from './fixtures/app-waits.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let win;
let state;
const $ = (sel) => win.document.querySelector(sel);

/** Wait for `ok()`. A LIVENESS bound, not a speed claim: happy-dom solves on this thread. */
async function until(ok, what, ms = 60_000) {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await settle(50);
  }
}

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

const chipTexts = () => [...win.document.querySelectorAll('#solList .chip-m')].map((b) => b.textContent);

/**
 * A freshly rolled cube on Home, sent back to "two layers" — a stage built tumbled.
 *
 * Every wait is on the NEW cube. The first version waited on "chips, a repair sentence, a tumbled
 * hold", which the previous case had already left on screen — so it returned before the roll had
 * landed, and the case after it raced a cube still arriving.
 */
async function tumbledWalk() {
  win.cubusGo('home');
  await tick();
  await until(() => $('#randCube') && !$('#randCube').disabled, 'the die');
  const before = state.cube.facelets;
  $('#randCube').click();
  await until(() => state.cube.facelets !== before, 'the rolled cube to become the subject');
  // The target outlives the walk, and pressing the target already chosen does nothing — so the roll
  // itself walks to "two layers" when a previous case chose it.
  if (state.stageTarget !== 'two-layers') {
    await until(() => chipTexts().length > 0 && !/working/.test($('#moveCount')?.textContent ?? 'working'), 'a whole-cube walk');
    $('[data-stage="two-layers"]').click();
  }
  const cube = () => $('#viewCube cubus-cube');
  await until(() => /way back|couldn’t/.test($('#moveCount')?.textContent ?? '')
    && cube()?.getAttribute('facelets') === state.cube.facelets
    && cube()?.dataset.hold === 'D B', 'the repair of the rolled cube, held tumbled');
}

test('the smart cube\'s off-plan line names both moves for the hold the walk is in', async () => {
  await tumbledWalk();
  try {
    // Following a TRUSTED cube whose walk starts where the cube in the hand is — the fixture the
    // router suite follows a scramble with, on a walk that is turned over. Re-entered so the screen
    // mounts with the cube connected, the way it does when a cube is paired before the walk.
    state.connected = true;
    state.cubeName = 'GAN-test';
    state.cube.trusted = true;
    state.cube.source = 'cube';
    state.cube.staleWhy = '';
    state.live = state.cube.facelets;
    win.cubusGo('timer');
    await tick();
    win.cubusGo('home');
    await tick();
    await until(() => $('#viewCube cubus-cube')?.dataset.hold === 'D B' && chipTexts().length > 0, 'the tumbled walk, remounted');
    const cube = $('#viewCube cubus-cube');
    // The renderer is inert here; the transport calls are taken so following does not throw.
    for (const k of ['step', 'stepBack', 'seek', 'play', 'pause']) cube[k] = () => {};

    const moves = cube.getAttribute('alg').split(' ');
    const chips = chipTexts();
    assert.deepEqual(chips, renameAlg(moves.join(' '), TUMBLED).split(' '), 'precondition: the chips are named for the tumbled hold');

    // A turn the plan does not want, on a face whose NAME changes when the cube is turned over — so
    // an unrenamed line cannot pass by luck, which an R or an L turn would let it do.
    const wrong = ['U', 'D', 'F', 'B'].find((f) => f !== moves[0][0] && f !== moves[1]?.[0]);
    win.cubusFeed.move({ notation: wrong, serial: 1 });
    await tick();
    const msg = $('#followMsg')?.textContent ?? '';
    assert.ok(msg.includes(`That was ${renameAlg(wrong, TUMBLED)} — `),
      `the move just made must be named for the hold the child is in (${wrong} is ${renameAlg(wrong, TUMBLED)} held tumbled): "${msg}"`);
    assert.ok(msg.includes(`the next move is ${chips[0]}.`), `and the move to make must be the chip on screen, ${chips[0]}: "${msg}"`);
    assert.equal(cube.getAttribute('orientation'), null,
      'a hold asked for before the renderer exists must leave no attribute naming a pose behind');
  } finally {
    win.cubusFeed.useConnection(null);
    state.connected = false;
    state.cubeName = '';
    state.cube.trusted = false;
    state.cube.source = 'none';
    state.live = null;
    state.reported = null;
  }
});

test('a walk that fails to load puts the cube back as scanned', async () => {
  await tumbledWalk();
  const cube = $('#viewCube cubus-cube');
  const parse = Cube.fromString;
  // The retarget's route parses the cube before it searches, so taking the parser away fails the
  // load inside the walk's own error handling — the path that says "could not work it out".
  Cube.fromString = () => { throw new Error('test: the parser is gone'); };
  try {
    $('[data-stage="cross"]').click();
    await until(() => $('#moveCount')?.textContent === 'could not work it out', 'the load to fail');
    assert.equal(cube.dataset.hold, 'U F',
      'no walk, so no hold: a failed load left the cube upside down under the failure, about a subject with no hold');
    assert.equal(cube.getAttribute('orientation'), null);
  } finally {
    Cube.fromString = parse;
  }
});
