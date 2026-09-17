// Wiring tests for the hash router — the half that router.test.mjs deliberately cannot reach.
//
// router.test.mjs covers the ROUTING RULES against plain objects. This file covers their
// ATTACHMENT TO THE WINDOW: that a deep link is honoured at boot, that hashchange actually
// re-renders, that go() moves the URL, and that a bogus hash is corrected. Those are the parts
// that fail silently — the rules can be perfect while nothing is listening.
//
// The real index.html and the real lib/app.js are used, so this breaks if the wiring is removed.
//
// node --test runs each file in its own process, so app.js boots exactly once here. The tests are
// therefore ordered and share that one booted app, driving it the way a user would.

import assert from 'node:assert/strict';
import { isAbsent } from './dom-assert.mjs';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { APP_SOURCES, blockAt, walk } from './app-source.mjs';

import { Window } from 'happy-dom';
import { solverLoaded } from './fixtures/app-waits.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let win;

before(async () => {
  win = new Window({
    url: 'http://localhost/#/timer', // boot on a deep link, not on home
    settings: {
      // The page pulls <cubus-cube> and the scanner panel from ./vendor/ and fonts from a CDN.
      // None of that is under test and none of it should be fetched here.
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);

  // app.js reads these off the global scope at module evaluation. defineProperty rather than
  // assignment: Node exposes `navigator` as a getter-only global, so `globalThis.navigator = …`
  // throws.
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    // Both halves of the animation API. `cancelAnimationFrame` was missing, and because screen
    // teardown swallows its own errors the resulting ReferenceError was invisible: every cleanup
    // that cancels a frame silently aborted part-way through. It surfaced only once a test drove
    // the timer far enough to depend on what came after the cancel.
    'requestAnimationFrame', 'cancelAnimationFrame',
    // The Timer measures with performance.now() and schedules with requestAnimationFrame. Taking
    // the frames from happy-dom and the clock from Node means the two are not the same timeline.
    'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }

  // Boots on import. loadSolver() reaches for an https: specifier, which Node refuses outright;
  // app.js already try/catches that, so the shell renders without a solver — exactly what an
  // offline launch does today.
  await import('../lib/app.js');
  await tick();
});

// The bar no longer draws the screen's name — the filled tab is the name — so "where am I" is read
// from the document title, which is what a browser tab and (via setTitle) the OS window show.
const screenTitle = () => win.document.title.replace(/ · Cubus$/, '');
// Settings is the trailing toolbar button rather than a tab, so the active marker is matched on
// the data attribute both kinds carry, not on the tab class.
const activeNav = () =>
  win.document.querySelector('[data-nav].active')?.getAttribute('data-nav') ?? null;

test('boot honours a deep link instead of falling back to home', () => {
  // Timer is hidden from the toolbar by default, so there is no tab to mark — the window title
  // is what says where you are. That a hidden screen still ROUTES is the property being checked.
  assert.equal(screenTitle(), 'Timer');
  assert.ok(win.document.querySelector('#stage .screen.active'), 'the deep-linked screen mounted');
});

test('the stage actually rendered that screen', () => {
  const stage = win.document.querySelector('#stage');
  assert.ok(stage.querySelector('.screen.active'), 'a screen should be mounted');
  assert.ok(stage.textContent.trim().length > 0, 'screen must not be blank');
});

// The listener is the thing most easily left off: every rule can be correct and nothing happens.
test('hashchange re-renders — Back and Forward will walk the screens', async () => {
  win.location.hash = '#/home';
  await tick();
  assert.equal(activeNav(), 'home');
  assert.equal(screenTitle(), 'Cube');
});

test('go() moves the URL as well as the screen', async () => {
  win.cubusGo('settings');
  await tick();
  assert.equal(win.location.hash, '#/settings', 'URL must follow the screen');
  assert.equal(activeNav(), 'settings');
  // The gear itself — the one control a user can see. The smart-cube indicator beside it shares
  // data-nav="settings" and comes first, and for as long as the marker was matched on data-nav
  // it landed on that hidden button, so the bar never showed where you were on Settings.
  assert.ok(win.document.querySelector('#tbTrail [aria-label="Settings"]').classList.contains('active'), 'the visible gear is marked current');
  assert.ok(!win.document.querySelector('#cubeLive').classList.contains('active'), 'the hidden indicator is not');
});

test('an unknown hash falls back to home rather than rendering nothing', async () => {
  win.location.hash = '#/not-a-screen';
  await tick();
  assert.equal(activeNav(), 'home');
  assert.ok(win.document.querySelector('#stage .screen.active'), 'home must render');
});

// Every screen must at least render. A template literal that throws — an unbalanced brace, a
// reference to a field that does not exist — produces a blank stage, and nothing else here would
// notice, because the other tests only visit four of them.
test('every screen renders without throwing', async () => {
  const SCREENS = [
    'home', 'scan', 'scramble', 'timer', 'stats',
    'trainer', 'drill', 'lessons', 'settings',
  ];
  const errors = [];
  const onError = (e) => errors.push(`${e.message ?? e}`);
  win.addEventListener('error', onError);

  const listed = () => [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
  for (const id of SCREENS) {
    win.location.hash = `#/${id}`;
    await tick();
    // A hidden screen has nothing in the toolbar to highlight; it must still route and render.
    if (listed().includes(id)) assert.equal(activeNav(), id, `${id} should be the active screen`);
    const stage = win.document.querySelector('#stage .screen.active');
    assert.ok(stage, `${id} rendered no screen element`);
    assert.ok(stage.innerHTML.trim().length > 0, `${id} rendered an empty stage`);
  }

  win.removeEventListener('error', onError);
  assert.deepEqual(errors, [], 'no screen should raise while rendering');
});

// The bar draws no screen name — the filled tab is the name — so the document/window title is the
// only place the name is written, and it is easy to drop silently: nothing on screen would change.
test('the screen name reaches the window title, and nothing else draws it', async () => {
  win.location.hash = '#/settings';
  await tick();
  assert.equal(win.document.title, 'Settings · Cubus');
  isAbsent(win.document.querySelector('#title'), 'the title chip is gone; the tab is the name');
  win.location.hash = '#/scan';
  await tick();
  assert.equal(win.document.title, 'Restore · Cubus', 'and it follows the screen');
});

// A nav item with no screen behind it falls back to home, which reads as a bug rather than as work
// not yet done. Scramble is in the nav before it is built, so this is the shape to guard.
test('every nav item lands on its own screen, including ones not built yet', async () => {
  const items = [...win.document.querySelectorAll('[data-nav]')].map((b) => b.dataset.nav);
  assert.ok(items.includes('scramble'), 'Scramble is offered in the nav');
  for (const id of items) {
    win.location.hash = `#/${id}`;
    await tick();
    assert.equal(activeNav(), id, `${id} must not fall back to another screen`);
  }
});

// The Cube screen persists its view settings, and for a long time applied only one of them: the
// sliders rendered the saved numbers while the cube drew at the renderer's defaults, so the screen
// claimed a camera angle it was not using and a reload silently undid any adjustment.
test('the cube screen applies every saved view setting, not just the ones it shows', async () => {
  win.localStorage.setItem('cubeView', JSON.stringify({
    hintElev: 8, camDist: 27, camLat: -60, camLon: 170, facScale: 0.4, tempo: 2, ghosts: true, coach: true,
  }));
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/home';
  await tick();
  const cube = win.document.querySelector('#viewCube > cubus-cube');
  assert.deepEqual(
    ['ghosts', 'ghost-elevation', 'camera-latitude', 'camera-longitude', 'facelet-scale']
      .map((a) => `${a}=${cube.getAttribute(a)}`),
    ['ghosts=floating', 'ghost-elevation=8', 'camera-latitude=-60', 'camera-longitude=170', 'facelet-scale=0.4'],
  );
  // The distance is not a setting any more: the renderer fits the picture to the slot
  // (lib/cube-frame.js), so a stored camDist is dropped rather than applied — a distance that
  // was right for one slot shape clipped the ghost faces on every other.
  assert.equal(cube.getAttribute('camera-distance'), null, 'no camera-distance is set');
  assert.equal('camDist' in JSON.parse(win.localStorage.getItem('cubeView')), false, 'and the stale key is gone from storage');
});

/** Give Home something to walk. A solved cube is a cube to look at, not a walk (tested further
 *  down), so a test that wants the transport, the move list or the speed menu first makes the
 *  subject a scrambled one — a generated cube, the way the dev die and the Scramble hand-off do
 *  it without a camera. Waits for the solver first: it is what decides whether a cube is
 *  solvable at all, and without it Home has nothing to say either way. */
const scrambledHome = async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/scramble';
  await tick();
  assert.ok(await waitFor(() => win.document.querySelectorAll('#solList .chip-m').length > 0), 'no solver');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const c = new Cube();
  c.move("R U R' U' F2 D L2 B' R2 U2");
  Object.assign(state.cube, { facelets: c.asString(), derived: false, setupAlg: '', solution: '', moves: [], stepFacelets: [], isPhysical: false, source: 'generated' });
  win.location.hash = '#/home';
  await tick();
};

// The cube card carries the cube and one corner tool, and the transport is one row: four buttons,
// the progress bar, the pacing toggle if a cube is connected, and the step count. Everything else
// that used to sit there said something the chips, the animation or the nav were already saying.
test('the cube screen is the cube, one transport row, and nothing else', async () => {
  await scrambledHome();
  // The cube card is the composition's `primary` region, a direct child of the grid.
  const cubeCard = win.document.querySelector('#stage .cols > .card.primary');
  // One tool over the cube, in the corner: the speed menu. Nothing else draws on top of it.
  assert.deepEqual(
    [...cubeCard.querySelectorAll('button')].map((b) => b.id),
    ['speedBtn'],
    'the cube card carries exactly one control',
  );
  for (const gone of ['#coach', '#scrub', '#validity', '#copyState', '#viewCard']) {
    isAbsent(win.document.querySelector(gone), `${gone} should be gone`);
  }
  // Nothing paces the walk but you, so there is no pacing control — only a speed preference.
  // "Slowest" was a switch with one position: it named the only behaviour the screen has.
  const modes = [...win.document.querySelectorAll('[data-mode]')].map((b) => b.dataset.mode);
  assert.deepEqual(modes, [], 'no pacing control offline');
  assert.ok(!win.document.querySelector('.transport').textContent.includes('Slowest'));
  // Back and repeat are different questions — undo a move, versus show that one again.
  assert.deepEqual(
    [...win.document.querySelectorAll('.transport .tbtn')].map((b) => b.id),
    ['prevBtn', 'repeatBtn', 'nextBtn', 'playBtn'],
  );

  // The progress bar sits after the play button and took the old spacer's job, so the row has no
  // inert flexible gap left in it.
  const row = [...win.document.querySelector('.transport').children].map((el) => el.id || el.className);
  assert.equal(row.indexOf('progress'), row.indexOf('playBtn') + 1, 'progress bar follows play');
  isAbsent(win.document.querySelector('.transport .spacer'), 'the spacer is gone');
  assert.ok(win.document.querySelector('#progBar'), 'the bar has a fill element to drive');
});

// Screens that were absorbed rather than deleted: Solve guide and Playback became the cube screen,
// the cube screen then became Home, and Smart cube became a card in Settings. Those links are
// already out in the wild, and an unknown id falls back to HOME — which is silently right for
// three of them and silently WRONG for #/pair, whose controls are in Settings.
test('links to the absorbed screens land on the screen that absorbed them', async () => {
  for (const [legacy, landing] of [['guide', 'home'], ['playback', 'home'], ['viewer', 'home']]) {
    win.location.hash = `#/${legacy}`;
    await tick();
    assert.equal(activeNav(), landing, `#/${legacy} must land on ${landing}`);
    assert.equal(win.location.hash, `#/${landing}`, 'and the URL is rewritten to the canonical one');
  }
});

// `#/pair` was the smart-cube pairing screen. With the smart cube back (this branch), its
// controls live in Settings — so an old pairing bookmark lands where the controls actually are,
// not on Home with nothing it came for.
test('the old pairing route lands on Settings, where the cube controls live now', async () => {
  win.location.hash = '#/pair';
  await tick();
  assert.equal(activeNav(), 'settings', 'a pairing bookmark reaches the smart-cube card');
  win.location.hash = '#/home';
  await tick();
});

// Setting an identical hash fires no hashchange, so this path is driven by go()'s direct render.
// The scan flow depends on it: go('home') while the cube screen is open must still refresh.
test('navigating onto the current screen still re-renders', async () => {
  win.location.hash = '#/home';
  await tick();
  const first = win.document.querySelector('#stage .screen.active');
  win.cubusGo('home');
  await tick();
  const second = win.document.querySelector('#stage .screen.active');
  assert.equal(activeNav(), 'home');
  assert.notEqual(first, second, 'the screen element should have been rebuilt, not left in place');
});


// Speed went from a fixed constant to a three-way choice in the cube card's corner. The wiring sits
// ahead of the solve on purpose, so it is live even here, where there is no solver to reach.
test('the speed menu offers three speeds, defaults to normal, and drives the renderer', async () => {
  await scrambledHome();

  const opts = [...win.document.querySelectorAll('.menu [data-speed]')];
  assert.deepEqual(opts.map((b) => b.dataset.speed), ['slow', 'normal', 'fast']);
  assert.deepEqual(opts.map((b) => b.textContent), ['Slow', 'Normal', 'Fast']);
  assert.deepEqual(
    opts.filter((b) => b.className === 'now').map((b) => b.dataset.speed),
    ['normal'],
    'exactly one speed is marked current, and it is the default',
  );

  const cube = win.document.querySelector('#viewCube > cubus-cube');
  assert.equal(cube.getAttribute('tempo-scale'), '0.1', 'normal is 1.9s per quarter turn');

  // A bigger tempo-scale is FASTER: the renderer divides its 190ms base by it.
  opts.find((b) => b.dataset.speed === 'fast').click();
  assert.equal(cube.getAttribute('tempo-scale'), '0.2');
  opts.find((b) => b.dataset.speed === 'slow').click();
  assert.equal(cube.getAttribute('tempo-scale'), '0.05');

  // It has to survive re-entering the screen, which Random cube does on every press.
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/home';
  await tick();
  const again = win.document.querySelector('#viewCube > cubus-cube');
  assert.equal(again.getAttribute('tempo-scale'), '0.05', 'the choice is remembered');
  assert.deepEqual(
    [...win.document.querySelectorAll('.menu [data-speed]')]
      .filter((b) => b.className === 'now').map((b) => b.dataset.speed),
    ['slow'],
    'and the menu says so',
  );
  win.localStorage.removeItem('walkSpeed');
});

// localStorage is a boundary, so a value that is no longer a speed must not reach setAttribute.
test('a junk saved speed falls back to the default instead of being trusted', async () => {
  win.localStorage.setItem('walkSpeed', JSON.stringify({ id: 'ludicrous' }));
  try {
    await scrambledHome();
    const cube = win.document.querySelector('#viewCube > cubus-cube');
    assert.equal(cube.getAttribute('tempo-scale'), '0.1', 'unknown id must not become a tempo');
  } finally {
    win.localStorage.removeItem('walkSpeed');
  }
});

// The speed menu is the same kind of control as the camera menu, and it had half of what a
// keyboard and a screen reader need: its button never said that it opens a menu or whether it is
// open, and the arrow keys did nothing inside it (found by audit, 2026-09-14). The rest was held by
// nothing: a probe mutating the menu's opening, placing, focus, Escape and click-away found every
// one unheld.
test('the speed button says it opens a menu, and the menu takes the keyboard as the camera menu does', async () => {
  await scrambledHome();
  const btn = win.document.querySelector('#speedBtn');
  const menu = win.document.querySelector('[data-speed]').closest('.menu');
  const key = (k) => win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  assert.equal(btn.getAttribute('aria-haspopup'), 'menu', 'the speed button does not say it opens a menu');
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'a closed menu is not said as closed');
  assert.equal(menu.hidden, true, 'the menu is open before anyone asked for it');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, false, 'pressing the speed button did not open its menu');
  assert.equal(btn.getAttribute('aria-expanded'), 'true', 'an open menu is not said as open');
  assert.ok(btn.classList.contains('open'), 'the speed button does not look pressed while its menu is open');
  assert.notEqual(menu.style.maxWidth, '', 'the menu was never placed under its button');
  assert.ok(win.document.activeElement === menu.querySelector('.now'), 'opening the menu did not put focus on the speed in force');
  key('ArrowDown');
  assert.equal(win.document.activeElement?.dataset.speed, 'fast', 'ArrowDown did not move to the next speed');
  key('ArrowDown');
  assert.equal(win.document.activeElement?.dataset.speed, 'slow', 'ArrowDown from the last speed did not wrap to the first');
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, true, 'Escape left the speed menu open');
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'the menu closed and the button still says it is open');
  assert.ok(!btn.classList.contains('open'), 'the menu closed and the button still looks pressed');
  assert.ok(win.document.activeElement === btn, 'Escape dropped focus instead of handing it back to the speed button');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, true, 'a click elsewhere left the speed menu open');
});

// What choosing does: the menu closes, focus goes back to the button, and which speed is in force
// is said to a screen reader as well as ticked — none of it held before (probe, 2026-09-14).
test('choosing a speed closes the menu, hands focus back, and says which speed is in force', async () => {
  await scrambledHome();
  const btn = win.document.querySelector('#speedBtn');
  const menu = win.document.querySelector('[data-speed]').closest('.menu');
  try {
    assert.equal(btn.getAttribute('aria-label'), 'Animation speed — Normal', "the speed button's name does not say the speed in force");
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    menu.querySelector('[data-speed="slow"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.equal(menu.hidden, true, 'the menu stayed open after a speed was chosen');
    assert.ok(win.document.activeElement === btn, 'choosing a speed left focus inside a closed menu');
    assert.deepEqual([...menu.querySelectorAll('[data-speed]')].map((b) => b.getAttribute('aria-checked')),
      ['true', 'false', 'false'], 'the tick moved and a screen reader was not told');
    assert.equal(btn.getAttribute('aria-label'), 'Animation speed — Slow', "the speed button's name did not follow the choice");
  } finally {
    win.localStorage.removeItem('walkSpeed');
  }
});

test('once the cube screen is gone, a click or an Escape on the page reaches none of its speed menu', async () => {
  await scrambledHome();
  const menu = win.document.querySelector('[data-speed]').closest('.menu');
  win.document.querySelector('#speedBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, false, 'precondition: the speed menu is open');
  win.location.hash = '#/timer';
  await tick();
  win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, false, "a click or an Escape after leaving reached the old screen's speed menu");
});

// The state card names what it shows and carries one tool. The raw 54-character facelet string it
// used to print said nothing the net beside it was not already showing in colour.
test('the state card is the net plus a dice, and says which state it is', async () => {
  await scrambledHome();

  // The state card leads the aside — the arrangement you are looking at, above the moves that
  // change it — and the move list follows.
  const cards = [...win.document.querySelectorAll('#stage .aside > .card')];
  const card = cards[0];
  assert.equal(card.querySelector('.state-h').textContent, 'Initial State');
  assert.ok(cards[1]?.querySelector('#solList'), 'the move list comes second');
  isAbsent(win.document.querySelector('#viewState'), 'the facelet string is gone');
  assert.ok(card.querySelector('#viewNet'), 'the net stays');

  // The dice is a developer shortcut on this side of the screen — it loads a random cube that is
  // NOT the one in anyone's hand — so by default it is not rendered at all. The Advanced toggle
  // brings it back (tested with the other Advanced toggles below); Scramble keeps its own die.
  isAbsent(card.querySelector('#randCube'), 'no dev die on the solve side by default');
  assert.equal(card.querySelector('.eyebrow-row .state-h').textContent, 'Initial State',
    'the eyebrow row stays, so the layout does not shift when the die is toggled on');
});

// Scramble stopped being a placeholder and became the cube screen walked from the other end.
//
// Unlike the solve path, this one runs to completion here: generating a scramble needs only
// cubejs, which is vendored and imports fine in Node. So these are real behaviour tests, not
// markup tests — the first version of this file asserted only labels and buttons, and mutating
// `setup` and the stage names did not turn it red.

/** Poll until `fn()` is true. The scramble is generated asynchronously behind loadSolver(). */
const waitFor = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

test('scramble is the same screen, not a mirrored transport', async () => {
  win.location.hash = '#/scramble';
  await tick();

  assert.ok(!win.document.querySelector('#stage').textContent.includes('not built yet'));
  assert.deepEqual(
    [...win.document.querySelectorAll('.transport .tbtn')].map((b) => b.id),
    ['prevBtn', 'repeatBtn', 'nextBtn', 'playBtn'],
    'four buttons, the same four',
  );
  assert.ok(win.document.querySelector('#speedBtn'), 'and the same speed menu');
  assert.equal(win.document.querySelector('.card-h b').textContent, 'Scramble');
  // The net means the opposite thing here, so it must not claim to be the initial state.
  assert.equal(win.document.querySelector('.aside .eyebrow-row .state-h').textContent, 'Target State');
  assert.match(win.document.querySelector('#randCube').title, /scramble/i);
});

// The filled chip is the move just shown, so before anything has been shown nothing is filled. It
// used to mark the next move, and a black first chip at 0 / 22 read as a step already taken.
test('no move is marked before one is shown, and the mark follows the move just made', async () => {
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/scramble';
  await tick();
  const ready = await waitFor(() => win.document.querySelectorAll('#solList .chip-m').length > 0);
  assert.ok(ready, 'no scramble was ever generated');
  const chips = () => [...win.document.querySelectorAll('#solList .chip-m')];
  const total = chips().length;
  const marked = () => chips().flatMap((c, k) => (c.classList.contains('cur') ? [k] : []));
  const count = () => win.document.querySelector('#stepLbl').textContent;

  assert.deepEqual(marked(), [], 'nothing is filled at 0 / n');
  assert.equal(count(), `0 / ${total}`);

  // The renderer reports how many moves it has applied; the screen fills the last of them.
  const cube = win.document.querySelector('#viewCube > cubus-cube');
  const applied = (index) => cube.dispatchEvent(new win.CustomEvent('cubus-step', { detail: { index, total } }));
  applied(1);
  assert.deepEqual(marked(), [0], 'after one move, the first chip is the one filled');
  assert.ok(chips()[0].classList.contains('played'), 'and it counts as played');
  applied(3);
  assert.deepEqual(marked(), [2]);
  assert.equal(count(), `3 / ${total}`);
  applied(total);
  assert.deepEqual(marked(), [total - 1], 'at the end the last move stays filled');

  // Clicking a chip lands the highlight on that chip: it seeks to just after the clicked move.
  // The vendored renderer is not loaded here, so a stand-in seek() reports what it was asked for,
  // the way the real one does through cubus-step.
  const asked = [];
  cube.pause = () => {}; // taking over stops playback first, which the real renderer honours
  cube.seek = (n) => { asked.push(n); applied(n); };
  chips()[4].click();
  assert.deepEqual(asked, [5], 'chip 4 (the fifth move) seeks to five moves applied');
  assert.deepEqual(marked(), [4], 'and chip 4 is the one filled');
  assert.equal(count(), `5 / ${total}`);
});

test('scramble starts solved and lands exactly where the net says', async () => {
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/scramble';
  await tick();
  const ready = await waitFor(() => win.document.querySelectorAll('#solList .chip-m').length > 0);
  assert.ok(ready, 'no scramble was ever generated');

  const cube = win.document.querySelector('#viewCube > cubus-cube');
  const moves = [...win.document.querySelectorAll('#solList .chip-m')].map((b) => b.textContent);

  assert.equal(cube.getAttribute('scramble'), '', 'the cube must START solved, not from a scan');
  assert.equal(cube.getAttribute('alg').trim(), moves.join(' '), 'the chips are the moves it plays');
  // No group headings at all: CROSS/F2L/OLL/PLL are phases of a solve and would invent structure,
  // and the one heading this list used to carry — "SCRAMBLE" with a count — repeated the card
  // header an inch above it, word for word.
  assert.deepEqual(
    [...win.document.querySelectorAll('#solList .eyebrow')].map((e) => e.textContent),
    [],
  );

  // The whole correctness claim of this screen: the net shows a target, and the moves on display
  // are the ones that get there. Replaying them on a fresh cube is independent of how the app
  // derived them (it inverts a solution), which is the part that could be wrong.
  const net = [...win.document.querySelectorAll('#viewNet .sticker')]
    .map((e) => e.className.split(' ')[1]).join('');
  const Cube = (await import('../lib/../vendor/cubejs.js')).default;
  const replay = Cube.fromString(SOLVED_FACELETS);
  for (const m of moves) replay.move(m);
  assert.equal(replay.asString(), net, 'the net is not where these moves actually land');
  assert.notEqual(net, SOLVED_FACELETS, 'a scramble that leaves the cube solved is not a scramble');
});

test('solve mode still names its own end of the walk', async () => {
  await scrambledHome();
  assert.equal(win.document.querySelector('.aside .eyebrow-row .state-h').textContent, 'Initial State');
  assert.equal(win.document.querySelector('.card-h b').textContent, 'Solution');
});

// A solved cube has nothing to walk. cubejs's search answers the identity with a fourteen-move
// no-op rather than an empty string, and "the solver returned moves" used to be the whole test of
// whether there was a solution — so every fresh launch, before anyone had scanned anything, drew
// a transport under the solved cube reading 0 / 0 with its done tick already lit.
test('a solved cube on Home is a cube to look at, not a walk of zero moves', async () => {
  const { state } = await import('../lib/app.js');
  const prev = { ...state.cube };
  try {
    // Wait for the solver: the bug only exists once there is one to ask.
    win.location.hash = '#/scramble';
    await tick();
    assert.ok(await waitFor(() => win.document.querySelectorAll('#solList .chip-m').length > 0), 'no solver');
    Object.assign(state.cube, { facelets: SOLVED_FACELETS, derived: false, setupAlg: '', solution: '', moves: [], stepFacelets: [] });
    win.location.hash = '#/home';
    await tick();
    assert.equal(state.cube.solvable, false, 'a solved cube is not "solvable"');
    assert.equal(state.cube.setupAlg, '', 'and needs no setup to reach itself');
    assert.ok(!win.document.querySelector('.cols').classList.contains('walking'), 'Home does not walk it');
    isAbsent(win.document.querySelector('.transport'), 'no transport');
    isAbsent(win.document.querySelector('#solList'), 'no solution list');
    isAbsent(win.document.querySelector('#speedBtn'), 'no speed for an animation that does not exist');
    const net = [...win.document.querySelectorAll('#viewNet .sticker')].map((e) => e.className.split(' ')[1]).join('');
    assert.equal(net, SOLVED_FACELETS, 'the net shows the solved cube');
  } finally { Object.assign(state.cube, prev); }
});

// The reconnect question on the two screens no case reached (probe, 2026-09-14, before the
// question became its own unit). Over a SOLVED cube Home has no walk, so the question stands in a
// card of its own, asks whether the cube is solved, and the heading wears the memory with its
// time. Scramble never asks: its subject is always the walk it generated.
test('an open reconnect question stands in its own card over a solved cube, and Scramble never asks it', async () => {
  const { state } = await import('../lib/app.js');
  const { whenWords } = await import('../lib/cube-memory.js');
  const prev = { ...state.cube };
  const seenAt = Date.UTC(2026, 7, 25, 13, 40);
  try {
    win.location.hash = '#/scramble';
    await tick();
    assert.ok(await waitFor(() => win.document.querySelectorAll('#solList .chip-m').length > 0), 'no solver');
    state.reconnect = { reading: 'unchanged', candidate: SOLVED_FACELETS, raw: SOLVED_FACELETS, seenAt };
    Object.assign(state.cube, { facelets: SOLVED_FACELETS, derived: false, setupAlg: '', solution: '', moves: [], stepFacelets: [] });
    win.location.hash = '#/home';
    await tick();
    const card = win.document.querySelector('.reconnect-card');
    assert.ok(card, 'a question over a cube with no walk had nowhere to stand');
    assert.match(card.querySelector('#reconnectAsk').textContent, /Is it solved right now\?/,
      'a solved candidate was asked about as if it were any cube');
    assert.equal(win.document.querySelector('.state-h').textContent, `Your cube — as we last saw it, ${whenWords(seenAt).full}`,
      'the remembered cube is not dressed as a memory with its time');
    win.location.hash = '#/scramble';
    await tick();
    isAbsent(win.document.querySelector('#reconnectAsk'), 'Scramble asked about a cube it is not showing');
    assert.equal(win.document.querySelector('.state-h').textContent, 'Target State');
  } finally {
    state.reconnect = null;
    Object.assign(state.cube, prev);
  }
});

test('an alg that reaches the solved cube does not give it a walk', async () => {
  const { state } = await import('../lib/app.js');
  const { classifyCube, ingestFacelets, takeDerivation } = await import('../lib/cube-subject.js');
  const prev = { ...state.cube };
  try {
    win.location.hash = '#/scramble';
    await tick();
    assert.ok(await waitFor(() => win.document.querySelectorAll('#solList .chip-m').length > 0), 'no solver');
    ingestFacelets(SOLVED_FACELETS);
    takeDerivation(SOLVED_FACELETS, "R R'");
    assert.equal(classifyCube().solvable, false, "a carried R R' gave the solved cube a walk");
    assert.deepEqual(state.cube.moves, [], 'and moves to make');
  } finally { Object.assign(state.cube, prev); }
});

// An async mount outliving its screen is invisible until it writes: cubeScreen awaits a solver
// load and a Kociemba search, and on the far side installs liveUpdate and paints a cube that may
// belong to a screen the user already left. The generation counter is what makes it notice.
test('a screen navigated away from mid-mount does not clobber the next one', async () => {
  win.location.hash = '#/home';
  await tick();
  win.location.hash = '#/scan'; // leave immediately, while the cube mount is still awaiting
  await tick();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(win.document.querySelector('.nav-item.active')?.dataset.nav, 'scan');
  assert.ok(win.document.querySelector('ai-scan-panel'), 'the scan screen is the one mounted');
  isAbsent(win.document.querySelector('#viewCube'), 'no cube card left behind');
});

// ⌃⌥⌘D reveals an Advanced section in Settings that can take the placeholder screens out of the
// toolbar. Two things here are easy to get wrong and invisible when you do: the chord must be
// matched on e.code (macOS Option rewrites e.key, so this arrives as "∂"), and a nav group whose
// every entry is hidden must not render as a bare heading over nothing.
const chord = (over = {}) =>
  new win.KeyboardEvent('keydown', {
    code: 'KeyD', key: '∂', ctrlKey: true, altKey: true, metaKey: true, bubbles: true, ...over,
  });
const navIds = () => [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
// The toolbar is one flat row of tabs, so there are no group headings to name.
// A tab's name is read from its aria-label, not from the drawn span: the word is drawn in the
// portrait bar and undrawn in the landscape row, and what a tab is CALLED must not depend on
// which composition happens to be on screen. It is also the stronger assertion — it checks
// what is announced, and a row that had silently lost its names would still look right.
// text. Reading the accessible name is also the stronger check: it is what a screen reader
// announces, and an icon-only row that lost its names would still look right.
const navLabels = () => [...win.document.querySelectorAll('#nav [data-nav]')].map((e) => e.getAttribute('aria-label'));

test('the Advanced section is hidden until the chord asks for it', async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/settings';
  await tick();
  assert.ok(!win.document.querySelector('[data-nav-toggle]'), 'not shown by default');

  // Option rewrites the character, so this is dispatched with key "∂" on purpose.
  win.document.dispatchEvent(chord());
  await tick();
  assert.equal(state.screen, 'settings');
  assert.deepEqual(
    [...win.document.querySelectorAll('[data-nav-toggle]')].map((b) => b.dataset.navToggle),
    ['timer', 'stats', 'trainer', 'drill', 'lessons'],
  );

  win.document.dispatchEvent(chord());
  await tick();
  assert.ok(!win.document.querySelector('[data-nav-toggle]'), 'the same chord puts it away');
});

// A press on a Settings control whose change rebuilds the screen dropped keyboard focus to <body>:
// focus is put back by id, and none of these had one. The mechanism audit row 132 found on the
// nickname fields (verification, 2026-09-14), and the same on every control here that repaints.
test('a press on a Settings control that rebuilds the screen leaves focus on that control', async () => {
  const { settings, save } = await import('../lib/app-settings.js');
  const was = { palette: settings.palette, theme: settings.theme, tier: settings.solveTier, source: settings.schemeSource };
  win.location.hash = '#/settings';
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  const controls = ['[data-pal="muted"]', '[data-set-theme="night"]', '[data-set-tier="nineteen"]', '[data-scheme]',
    '[data-nav-toggle="drill"]'];
  try {
    const lost = [];
    for (const sel of controls) {
      const control = win.document.querySelector(sel);
      assert.ok(control, `precondition: ${sel} is on Settings`);
      control.focus();
      control.click();
      await tick();
      if (!win.document.activeElement?.matches?.(sel)) lost.push(sel);
    }
    assert.deepEqual(lost, [], 'focus fell off these controls when Settings rebuilt');
  } finally {
    // Back through the same controls, so what is stored and drawn is what it was.
    for (const sel of ['[data-nav-toggle="drill"]', '[data-scheme]', `[data-set-tier="${was.tier}"]`,
      `[data-set-theme="${was.theme}"]`, `[data-pal="${was.palette}"]`]) {
      win.document.querySelector(sel)?.click();
      await tick();
    }
    settings.schemeSource = was.source;
    save('cubusSettings', settings);
    win.document.dispatchEvent(chord()); // Advanced shut again
    await tick();
  }
});

// The shell puts focus back only on a control with an id, and Settings repaints under whoever is
// on it. Some of its controls are drawn only on a desktop build or beside a radio (the window's
// shape, a remembered cube's Use), so the screen's source is read for every one of them.
test('every control Settings draws carries an id, and a switch row cannot be drawn without one', async () => {
  const missing = [];
  let rows = 0;
  for (const path of ['lib/screens/settings.js', 'lib/screens/settings/smart-cube.js', 'lib/screens/settings/preferences.js']) {
    assert.ok(APP_SOURCES.includes(path), `${path} is not one of the app's sources`);
    const src = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    // The markup is the literals' text: comments left out, and every `${}` walked as code.
    const tags = [...walk(src).literals.join('').matchAll(/<(?:button|a|input|select|textarea)\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(tags.length > 0, `${path}: no control was found, so nothing was checked`);
    for (const tag of tags) if (!/\sid="/.test(tag)) missing.push(`${path}: ${tag.slice(0, 90)}`);
    for (const m of src.matchAll(/switchRow\(\{/g)) {
      const open = m.index + 'switchRow('.length;
      const row = src.slice(open, walk(src, { from: open, balanced: true }).end);
      rows += 1;
      if (!/\bid:/.test(row)) missing.push(`${path}: switchRow(${row.slice(0, 90)}`);
    }
  }
  assert.deepEqual(missing, [], 'these controls carry no id, so a repaint drops focus off them');
  assert.ok(rows >= 6, `only ${rows} switch rows were found, so not every row was checked`);
  const { switchRow } = await import('../lib/screens/settings/preferences.js');
  assert.throws(() => switchRow({ style: '', title: 'x', blurb: 'x', on: false, attrs: 'data-toggle="x"', label: 'x' }),
    /no id/, 'a switch row was drawn with no id');
});

// The disclosure must not be sticky. Persisting it meant that once you pressed the chord, the
// section stayed on screen forever — an undocumented developer surface leaking into normal use.
// What it CONTROLS is still saved; only the fact that you opened it is per-page.
test('opening Advanced is not remembered', async () => {
  win.location.hash = '#/settings';
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  assert.ok(win.document.querySelector('[data-nav-toggle]'), 'precondition: it is open');

  const stored = win.localStorage.getItem('cubusSettings') ?? '';
  assert.ok(!stored.includes('advanced'), `open state must not be persisted, got: ${stored}`);

  // The preference it controls IS saved, which is the distinction being drawn. Drill starts
  // hidden, so the first click SHOWS it — and the stored hidden list must say so.
  win.document.querySelector('[data-nav-toggle="drill"]').click();
  await tick();
  const hidden = JSON.parse(win.localStorage.getItem('cubusSettings') ?? '{}').navHidden ?? [];
  assert.ok(!hidden.includes('drill'), `showing Drill persists, got: ${JSON.stringify(hidden)}`);
  assert.ok([...win.document.querySelectorAll('#nav [data-nav]')].some((b) => b.dataset.nav === 'drill'));

  // Put it back through the UI: clearing localStorage alone would leave the in-memory settings
  // holding a shown entry, and the next test would see a toolbar it did not ask for.
  win.document.querySelector('[data-nav-toggle="drill"]').click();
  await tick();
  assert.ok(![...win.document.querySelectorAll('#nav [data-nav]')].some((b) => b.dataset.nav === 'drill'));
  win.document.dispatchEvent(chord());
  await tick();
  win.localStorage.removeItem('cubusSettings');
});

test('a partial chord does nothing — every modifier is required', async () => {
  win.location.hash = '#/settings';
  await tick();
  for (const missing of [{ metaKey: false }, { altKey: false }, { ctrlKey: false }, { code: 'KeyF' }]) {
    win.document.dispatchEvent(chord(missing));
    await tick();
    assert.ok(!win.document.querySelector('[data-nav-toggle]'), `${JSON.stringify(missing)} must not fire`);
  }
});

// ⌘, opens Settings — the preferences convention on macOS — and Ctrl+, where Ctrl is the primary
// modifier. Until 2026-09-07 nothing listened: the desktop shell sets no native menu, so no
// Preferences… item claimed the accelerator, and the key reached a page with no handler.
const comma = (over = {}) =>
  new win.KeyboardEvent('keydown', { code: 'Comma', key: ',', bubbles: true, cancelable: true, ...over });

test('⌘, opens Settings from any screen, and so does Ctrl+,', async () => {
  const { state } = await import('../lib/app.js');
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    win.location.hash = '#/home';
    await tick();
    assert.equal(state.screen, 'home', 'precondition');
    const ev = comma(modifier);
    win.document.dispatchEvent(ev);
    await tick();
    assert.equal(state.screen, 'settings', `${JSON.stringify(modifier)} + comma`);
    assert.equal(activeNav(), 'settings', 'the gear is marked active');
    assert.ok(ev.defaultPrevented, 'the key is consumed, not also typed');
  }
});

test('the Settings shortcut is exact: one primary modifier, no others, no key repeat', async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/home';
  await tick();
  const wrong = [
    {},                                       // a bare comma is a comma
    { metaKey: true, ctrlKey: true },         // both is neither
    { metaKey: true, altKey: true },
    { metaKey: true, shiftKey: true },
    { metaKey: true, repeat: true },          // a held key must not re-enter the screen
    { metaKey: true, code: 'Period', key: '.' },
  ];
  for (const over of wrong) {
    const ev = comma(over);
    win.document.dispatchEvent(ev);
    await tick();
    assert.equal(state.screen, 'home', `${JSON.stringify(over)} must not navigate`);
    assert.ok(!ev.defaultPrevented, `${JSON.stringify(over)} must not be consumed`);
  }
});

test('⌘, on Settings is a no-op, not a rebuild', async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/settings';
  await tick();
  assert.equal(state.screen, 'settings', 'precondition');
  const before = win.document.querySelector('#stage').firstElementChild;
  assert.ok(before, 'the settings screen is mounted');
  win.document.dispatchEvent(comma({ metaKey: true }));
  await tick();
  assert.equal(win.document.querySelector('#stage').firstElementChild, before, 'the same DOM, untouched');
});

// The hint beside the gear is drawn only where the shortcut is guaranteed to arrive — the
// desktop shell. This harness is a browser with no Tauri API, and a browser on macOS keeps ⌘,
// for its own preferences, so a hint here would promise something the page never receives.
test('in the browser build the gear promises no shortcut', () => {
  assert.equal(win.document.querySelector('#tbTrail [aria-label="Settings"]').getAttribute('title'), 'Settings');
});

// The About card: the app's mark, then a short table — version, website, author — each row led
// by an inline icon from the app's own set (there is no icon library to need; the paths in `P`
// are drawn by hand). The links are real anchors: the old card printed "cubus.im" as dead text.
test('the About card states version, website, author and credits, with real links', async () => {
  win.location.hash = '#/settings';
  await tick();
  const { VERSION } = await import('../lib/app.js');
  const card = [...win.document.querySelectorAll('#stage .card')]
    .find((c) => c.querySelector('.eyebrow')?.textContent === 'ABOUT');
  assert.ok(card, 'the About card exists');
  assert.ok(card.querySelector('.about-brand img[src="./icons/icon.svg"]'), 'led by the app mark');
  assert.equal(card.querySelector('.about-brand b').textContent, 'Cubus');
  const rows = [...card.querySelectorAll('.about-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.k').textContent), ['Version', 'Website', 'Author', 'Credits']);
  assert.ok(rows.every((r) => r.querySelector('svg.ic')), 'each row is led by an icon');
  assert.equal(rows[0].querySelector('.num').textContent, VERSION, 'the version shown IS the constant');
  const site = rows[1].querySelector('a.link');
  assert.equal(site.getAttribute('href'), 'https://cubus.im');
  const author = rows[2].querySelector('a.link');
  assert.equal(author.getAttribute('href'), 'https://lixiaolai.com');
  assert.equal(author.textContent, '@xiaolai');
  for (const a of [site, author]) {
    assert.equal(a.getAttribute('target'), '_blank', 'external links must not navigate the app away');
    assert.equal(a.getAttribute('rel'), 'noopener');
  }
  // The notices are a LOCAL file that ships in dist, so the link is relative and must NOT carry
  // target=_blank: under Tauri it is an app asset, and the opener seam only claims http(s)
  // anchors. A remote URL here would be a network request from a card whose own sentence is
  // about what does and does not leave the device.
  const credits = rows[3].querySelector('a.link');
  assert.equal(credits.getAttribute('href'), './THIRD_PARTY_NOTICES.md');
  assert.equal(credits.getAttribute('target'), null, 'a local asset opens in place');
});

// The sentence under "Check now" claimed "Nothing leaves the device" while the button beside it
// makes an HTTPS request to github.com — and the desktop build makes the same one daily on its
// own. The claim has to be true on the build it is drawn on, so it is keyed on the updater's
// existence, which is the same gate the Check now row uses.
test('the privacy sentence names the one request the build actually makes', async () => {
  const { privacyLine } = await import('../lib/app.js');
  assert.match(privacyLine(false), /Nothing leaves the device/, 'with no updater there is genuinely nothing');
  assert.doesNotMatch(privacyLine(false), /github/i);
  const withUpdater = privacyLine(true);
  assert.match(withUpdater, /github\.com/, 'the update check is named');
  assert.match(withUpdater, /never leave|nothing about you/i, 'and what does NOT go with it');
  assert.doesNotMatch(withUpdater, /Nothing leaves the device/, 'the false half is gone');
});

// The version is written by hand in exactly one place — app.js — and every manifest must agree
// with it. Before this test, the About card told users 0.4.2 while apps/web/package.json, the
// Tauri config and the desktop Cargo.toml all said 0.1.0: five version fields, four wrong, and
// nothing red. Drift now fails the suite and names the file that lagged.
test('every manifest carries the same version the app displays', async () => {
  const { VERSION } = await import('../lib/app.js');
  const at = (p) => new URL(p, import.meta.url);
  assert.equal(JSON.parse(readFileSync(at('../package.json'), 'utf8')).version, VERSION,
    'apps/web/package.json');
  assert.equal(
    JSON.parse(readFileSync(at('../../desktop/src-tauri/tauri.conf.json'), 'utf8')).version,
    VERSION, 'tauri.conf.json — the version the installed desktop app reports');
  assert.equal(JSON.parse(readFileSync(at('../../desktop/package.json'), 'utf8')).version, VERSION,
    'apps/desktop/package.json');
  const v = VERSION.replace(/\./g, '\\.');
  const cargo = readFileSync(at('../../desktop/src-tauri/Cargo.toml'), 'utf8');
  assert.match(cargo, new RegExp(`^version = "${v}"$`, 'm'), 'the desktop crate version');
  // The lockfile is committed and records the crate's version too: a bump that leaves it behind
  // is a diff waiting to appear on the next `cargo` run, on somebody else's machine.
  const lock = readFileSync(at('../../../Cargo.lock'), 'utf8');
  assert.match(lock, new RegExp(`^name = "cubus-desktop"\\nversion = "${v}"$`, 'm'), 'Cargo.lock');
  // The iOS bundle's two, in the SOURCE xcodegen builds Info.plist from. Added 2026-08-31 after
  // the first cross-platform bump moved six places and left these at 0.1.3 — an iPhone build
  // would have gone to TestFlight reading a version the app itself denied.
  const ios = readFileSync(at('../../desktop/src-tauri/gen/apple/project.yml'), 'utf8');
  assert.match(ios, new RegExp(`^        CFBundleShortVersionString: ${v}$`, 'm'),
    'gen/apple/project.yml CFBundleShortVersionString');
  assert.match(ios, new RegExp(`^        CFBundleVersion: "${v}"$`, 'm'),
    'gen/apple/project.yml CFBundleVersion');
  // The generated plist is committed and ships until someone regenerates it, so it has to agree
  // with its own source rather than being trusted to.
  const plist = readFileSync(at('../../desktop/src-tauri/gen/apple/cubus-desktop_iOS/Info.plist'), 'utf8');
  // BOTH keys, each tied to its own key line. `<string>${v}</string>` anywhere in the file used to
  // satisfy this, so a plist carrying 0.2.1 in one key and 0.2.0 in the other would have passed —
  // and CFBundleVersion is the one the App Store rejects a duplicate of.
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>${v}</string>`),
      `the generated Info.plist ${key}`);
  }

  // And these are exactly the places `pnpm bump` moves — one more would drift silently.
  const { SITES } = await import('../../../scripts/bump-version.mjs');
  assert.deepEqual(SITES.map((s) => s.file).sort(), [
    'Cargo.lock', 'apps/desktop/package.json',
    'apps/desktop/src-tauri/Cargo.toml',
    'apps/desktop/src-tauri/gen/apple/cubus-desktop_iOS/Info.plist',
    'apps/desktop/src-tauri/gen/apple/cubus-desktop_iOS/Info.plist',
    'apps/desktop/src-tauri/gen/apple/project.yml',
    'apps/desktop/src-tauri/gen/apple/project.yml',
    'apps/desktop/src-tauri/tauri.conf.json', 'apps/web/lib/version.js', 'apps/web/package.json',
  ]);
});

// The random-cube die on the solve screen is a developer shortcut (the cube it loads is not the
// one in anyone's hand), so it hides behind the same Advanced section — and, unlike the
// disclosure itself, the preference is saved.
test('the Advanced toggle brings the dev die back, and turning it off takes it away', async () => {
  win.location.hash = '#/settings';
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  const toggle = () => win.document.querySelector('[data-toggle="devRandCube"]');
  assert.ok(toggle(), 'the die has a toggle in Advanced');

  toggle().click();
  await tick();
  assert.match(win.localStorage.getItem('cubusSettings') ?? '', /devRandCube.:true/,
    'the preference persists — it is the disclosure that must not');
  win.location.hash = '#/home';
  await tick();
  const dice = win.document.querySelector('#randCube');
  assert.ok(dice, 'the die is back on the solve screen');
  assert.equal(dice.parentElement.className, 'eyebrow-row', 'on the eyebrow row, level with the label');
  assert.match(dice.title, /random scrambled cube/i);

  // Off again through the same UI, so later tests see the default screen. Advanced is still
  // open — the disclosure lasts the page, not the visit — so no second chord to get back in.
  win.location.hash = '#/settings';
  await tick();
  toggle().click();
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  win.location.hash = '#/home';
  await tick();
  isAbsent(win.document.querySelector('#randCube'), 'and gone again');
  win.localStorage.removeItem('cubusSettings');
});

test('showing an entry adds it to the toolbar, hiding removes it, and the rest is untouched', async () => {
  win.location.hash = '#/settings';
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  assert.ok(!navIds().includes('lessons'), 'precondition: Lessons starts hidden');

  // Show all three, in the order the toolbar lists them.
  for (const id of ['trainer', 'drill', 'lessons']) win.document.querySelector(`[data-nav-toggle="${id}"]`).click();
  await tick();
  assert.deepEqual(navIds(), ['home', 'scan', 'scramble', 'trainer', 'drill', 'lessons'], 'shown in toolbar order');

  // Hide one: its neighbours are untouched.
  win.document.querySelector('[data-nav-toggle="lessons"]').click();
  await tick();
  assert.ok(!navIds().includes('lessons'), 'gone from the toolbar');
  assert.deepEqual(navIds(), ['home', 'scan', 'scramble', 'trainer', 'drill'], 'and its neighbours are untouched');

  // Hiding is cosmetic: the address still works, which is the escape hatch.
  win.location.hash = '#/lessons';
  await tick();
  assert.ok(win.document.querySelector('#stage .screen'), 'a hidden screen is still reachable');

  // Restore the DEFAULT through the UI, not by wiping localStorage. `settings` is a live
  // module-level object: clearing storage leaves it holding the shown ids, so every later test in
  // this file would inherit a toolbar with two extra entries.
  win.location.hash = '#/settings';
  await tick();
  for (const id of ['trainer', 'drill']) {
    win.document.querySelector(`[data-nav-toggle="${id}"]`).click();
    await tick();
  }
  assert.deepEqual(
    navIds().filter((i) => ['trainer', 'drill', 'lessons'].includes(i)),
    [],
    'the default toolbar is back before the next test runs',
  );
  win.document.dispatchEvent(chord());
  await tick();
  win.localStorage.removeItem('cubusSettings');
});

// The screen model was restructured: Home is the cube, the old Home content moved into Stats, and
// Smart cube became a card in Settings. Each of those leaves a way to get it silently wrong — a
// nav entry pointing at a screen that no longer exists, or pairing controls that render but were
// never wired because their mount stayed behind on the deleted screen.
test('Home is the cube screen, not a separate landing page', async () => {
  await scrambledHome();
  assert.ok(win.document.querySelector('#viewCube'), 'Home renders the cube');
  assert.ok(win.document.querySelector('.transport'), 'and its transport');
  assert.ok(!win.document.querySelector('#scanCta'), 'the old landing-page call to action is gone');
});

test('the toolbar no longer offers 3D viewer or Smart cube, and Stats is renamed', async () => {
  win.location.hash = '#/home';
  await tick();
  const ids = [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
  assert.ok(!ids.includes('viewer'), 'the cube screen is reached as Home');
  assert.ok(!ids.includes('pair'), 'there is no pairing screen');
  // Stats is hidden by default now (it shows representative numbers, not yours), so what matters
  // is that when it IS shown it carries the shorter name.
  assert.ok(!ids.includes('stats'), 'Stats is hidden by default');
  // The placeholder screens are hidden by default IN CODE, not by a stored preference: a wiped
  // localStorage once put all three back in the toolbar. Timer rides on the same rule.
  for (const id of ['trainer', 'drill', 'lessons', 'timer']) {
    assert.ok(!ids.includes(id), `${id} is hidden by default, whatever storage says`);
  }
  const labels = [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.textContent);
  assert.ok(!labels.some((l) => l.includes('Session stats')), 'and it is not called Session stats');
  // Nothing groups the list any more, so there is no heading left over to point at a screen that
  // no longer exists.
  isAbsent(win.document.querySelector('#nav .nav-group'), 'the tab row is flat');
  isAbsent(win.document.querySelector('#nav .eyebrow'), 'and carries no section titles');
});


// The permanent status box in the old leading pane said the same thing on every screen forever,
// including the whole time you are not using a cube. It is replaced by an indicator that appears
// beside the cube only while one is actually connected.
test('the shell no longer carries a permanent connection box', async () => {
  win.location.hash = '#/home';
  await tick();
  isAbsent(win.document.querySelector('#cubeStatus'));
  isAbsent(win.document.querySelector('#cubeStatusLabel'));
  isAbsent(win.document.querySelector('.cube-status'));
});


// The nav was three labelled sections over nine items in a leading pane. It is one flat row of
// tabs in the title bar now, with Settings as the bar's trailing button — so the things to pin are
// that nothing was lost in the flattening, that no heading survived it, and that Settings is
// reachable from the bar without being a tab.
// Dragging the 3D cube around is off by default: every cube in the app is set up at a chosen
// angle that the ghost faces depend on, and a stray drag swung it away with no way back. The
// preference is a Settings toggle, saved, and reaches every cube through the `orbit` attribute.
test('drag-to-rotate is off by default, and the toggle reaches the cube as an attribute', async () => {
  win.location.hash = '#/home';
  await tick();
  assert.equal(win.document.querySelector('cubus-cube').getAttribute('orbit'), 'locked', 'locked by default');
  win.location.hash = '#/settings';
  await tick();
  const toggle = () => win.document.querySelector('[data-toggle="dragRotate"]');
  assert.ok(toggle(), 'the option lives in Settings');
  assert.ok(!toggle().classList.contains('on'), 'and starts off');
  toggle().click();
  await tick();
  assert.match(win.localStorage.getItem('cubusSettings') ?? '', /dragRotate.:true/, 'the choice is saved');
  win.location.hash = '#/home';
  await tick();
  assert.equal(win.document.querySelector('cubus-cube').getAttribute('orbit'), 'free', 'and the next cube is free to orbit');
  // Back to the default through the UI, so later tests see locked cubes.
  win.location.hash = '#/settings';
  await tick();
  toggle().click();
  await tick();
  win.location.hash = '#/home';
  await tick();
  assert.equal(win.document.querySelector('cubus-cube').getAttribute('orbit'), 'locked');
});

test('the toolbar is one flat row of tabs, with Settings as its own button', async () => {
  win.location.hash = '#/home';
  await tick();
  // The default row is the beginner's path and nothing else: Timer and Stats are speedcubing
  // instruments, Alg trainer, Drill and Lessons are placeholder screens — all five start hidden,
  // in code, and are one chord away.
  assert.deepEqual(navLabels(), ['Home', 'Restore', 'Scramble']);
  // Every tab draws a real glyph. icon() falls back to a bare dot for a name it does not know, so
  // a deleted or renamed glyph does not throw — it renders something almost plausible, and in an
  // icons-only row there is no label left to give the game away. Two icons were retired on
  // 2026-08-30; this is what makes the next retirement safe.
  const FALLBACK = '<circle cx="12" cy="12" r="2"></circle>';
  for (const svg of win.document.querySelectorAll('#nav [data-nav] svg.ic')) {
    assert.notEqual(svg.innerHTML.trim(), FALLBACK, `a tab fell back to the placeholder dot: ${svg.closest('[data-nav]').dataset.nav}`);
    assert.ok(svg.innerHTML.length > 0, 'a tab icon is empty');
  }
  isAbsent(win.document.querySelector('#nav .nav-group'), 'no grouping wrapper');
  isAbsent(win.document.querySelector('#nav .eyebrow'), 'no SOLVE / PRACTICE / LEARN');
  // #nav holds one capsule (the segmented control's pill; the nav itself is the box the
  // stylesheet floats over the bar or lays at the foot of the window), and every child of the
  // capsule is a page button — nothing else lives in there.
  assert.deepEqual([...win.document.querySelector('#nav').children].map((el) => el.className), ['capsule']);
  const kinds = [...win.document.querySelector('#nav .capsule').children].map((el) => el.tagName);
  assert.deepEqual([...new Set(kinds)], ['BUTTON']);
  // Settings: in the trailing zone, not in the row, and it navigates. By its label — the hidden
  // smart-cube indicator beside it also carries data-nav="settings", and a data-nav match
  // handed this test the indicator under the name "gear".
  const gear = win.document.querySelector('#tbTrail [aria-label="Settings"]');
  assert.ok(gear, 'Settings is the trailing toolbar button');
  isAbsent(win.document.querySelector('#nav [data-nav="settings"]'), 'and not a tab');
  gear.click();
  await tick();
  assert.equal(win.location.hash, '#/settings');
  assert.ok(gear.classList.contains('active'), 'and it is marked while Settings is showing');
});




// The off-track note lives at the FOOT OF THE SOLUTION CARD, and that placement is the fix, not a
// preference. In the transport row, showing it changed that card's height, which resized the cube
// card above it — so every stray turn made the whole page flash. In the solution card it takes its
// space from #solList, which is `flex:1` and scrolls, and the aside is a separate column from the
// cube. Measured at the time: showing it changes ONLY #solList's height (477px -> 395px); the cube
// card, the canvas, the transport and the card's own box are all unchanged to the pixel.

// Timer and Stats are speedcubing instruments, not part of learning to solve a cube — and Stats
// still shows representative numbers rather than yours, which is worse than showing nothing. They
// start hidden and are one chord away. Hiding stays cosmetic: the routes keep working.
test('Timer and Stats start hidden, but remain reachable and re-showable', async () => {
  win.location.hash = '#/home';
  await tick();
  const ids = () => [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
  assert.ok(!ids().includes('timer'), 'Timer is not in the default toolbar');
  assert.ok(!ids().includes('stats'), 'Stats is not in the default toolbar');

  // Reachable by address, like every other hidden entry.
  win.location.hash = '#/timer';
  await tick();
  assert.ok(win.document.querySelector('#clock'), 'the Timer screen still routes and renders');

  // And re-showable from Advanced, which is the whole point of hiding rather than removing.
  win.location.hash = '#/settings';
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  win.document.querySelector('[data-nav-toggle="timer"]').click();
  await tick();
  assert.ok(ids().includes('timer'), 'toggling brings it back');
  win.document.querySelector('[data-nav-toggle="timer"]').click();
  await tick();
  assert.ok(!ids().includes('timer'), 'and puts it away again');
  win.document.dispatchEvent(chord());
  await tick();
  win.localStorage.removeItem('cubusSettings');
});

// TWO ways a battery read can fail, and they take different code paths: the cube answers without a
// level, or the request throws outright. Testing only the first left the catch free to invent a
// number — a mutation putting `state.battery = 50` there passed until this covered both.

// The setup steps are instructions, not a permanent status board. Once every step is done they are
// three ticks occupying a third of the card and telling the user nothing they cannot already see.

// ---- Trust -------------------------------------------------------------------------------
//
// "Connected" and "we know what this cube looks like" are different claims, and conflating them is
// the bug this models away. A cube reports how far it has been turned since it was last told where
// it was; disconnect it, turn it, reconnect, and it reports a state that is confidently wrong.



// Following and the manual transport were two drivers for one guide. While both were live the step
// counter tracked the ANIMATION rather than the cube — press Next twice by hand, make one real
// turn, and it read 2 / 22 with one turn made. The number whose whole job is to say where your
// cube is was saying where the drawing had got to. One rule: touching the transport takes over.


// Reported from a real session: cube connected and physically SOLVED, press Random on Home, and
// the guide ran straight to 19 / 19 with the done mark, having done nothing.
//
// The last step of every solution is the solved state. The physical cube was solved. So the
// resync — which searches all of `steps` so a cube that ran ahead can rejoin — matched the END of
// a walk the cube had never begun. Following was on because a paired, trusted cube defaults to
// following, and Random had marked itself 'camera' as though the camera had read your cube.
//
// The fix is one precondition: a walk can only be followed if it STARTS from where the cube in
// your hand actually is. That makes a random cube unfollowable and a scramble from a solved cube
// perfectly followable, with no special cases.

// A gap used to be routed only through the cube screen's handler, which exists only while a
// solution is being walked. So a missed turn that arrived while you were in Settings — or on Home
// with a solved cube, where there is nothing to walk — was dropped on the floor, and the next
// screen you opened showed a confident tracking glyph over a cube nobody could vouch for.

// Two requirements from the plan's Risks section, which are directives rather than observations.



// ---- Stats: earned, or absent ----------------------------------------------------------------
//
// This screen was entirely fabricated — a 14.82 single, a 21.44 ao5, a twenty-bar session chart
// built from a literal array, four Cross/F2L/OLL/PLL stage splits for a solver that detects no
// stages, and five invented solves handed to anyone whose history was empty. All of it was shown
// identically to someone who had never solved a cube.
test('a session with no solves says so, and invents nothing', async () => {
  win.localStorage.removeItem('cubusSolves');
  win.location.hash = '#/stats';
  await tick();
  const text = win.document.querySelector('#stage').textContent;

  assert.match(text, /Nothing to report/, 'it says the session is empty');
  // Every one of these was on screen before, for a user with no history.
  for (const invented of ['14.82', '21.44', '19.44', '23.68', 'ALG MASTERY', 'F2L', 'OLL', 'PLL', 'dot cases']) {
    assert.ok(!text.includes(invented), `"${invented}" must not appear for an empty session`);
  }
  assert.ok(!text.includes('0.00'), 'and an empty session is not a session of zero-second solves');
});

test('every figure on Stats is computed from the solves that exist', async () => {
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [
      { n: 3, time: '10.00', scramble: 'R U', tps: '4.0', moves: 40, at: Date.now() },
      { n: 2, time: '30.00', scramble: 'R U', tps: '', moves: 0, at: Date.now() },
      { n: 1, time: '20.00', scramble: 'R U', tps: '2.0', moves: 40, at: Date.now() },
    ],
  }));
  try {
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/stats';
    await tick();
    const text = win.document.querySelector('#stage').textContent;

    assert.ok(text.includes('10.00'), 'the single best is the fastest solve that happened');
    // "recorded", not "this session": the history survives reloads and there is no session
    // boundary anywhere in the app, so calling it one was a small untruth on a screen whose whole
    // purpose is to stop telling them.
    assert.ok(text.includes('3 solves recorded'));
    // Three solves is not an ao5, and saying one anyway would be a different statistic under the
    // same name — the precise shape of the lie this screen used to tell.
    assert.match(text, /needs 2 more/, 'and it says what an ao5 is still waiting for');

  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});













test('a hostile solve history cannot inject markup into Timer or Stats', async () => {
  // cubusSolves is written by anything on the origin and editable by hand. Both screens
  // interpolated persisted fields straight into innerHTML.
  const payload = '<img src=x onerror="alert(1)">';
  // The record has to REACH the sink. An earlier version put the payload in `time` for both
  // screens — which made the row unusable, so Stats rendered "Nothing to report" with no rows at
  // all and its escaping was never exercised. Deleting escHtml from Stats left this test green.
  //
  // So: a well-formed solve whose SCRAMBLE carries the payload (Stats draws that column), and a
  // separate one whose TIME carries it (the Timer draws that).
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [{ n: 1, time: '19.02', scramble: payload, moves: 40, at: Date.now() }],
  }));
  try {
    for (const [screen, sink] of [['#/stats', 'scramble'], ['#/timer', 'time']]) {
      if (sink === 'time') {
        win.localStorage.setItem('cubusSolves', JSON.stringify({
          list: [{ n: 1, time: payload, scramble: 'R U', moves: 40, at: Date.now() }],
        }));
      }
      win.location.hash = '#/home';
      await tick();
      win.location.hash = screen;
      await tick();
      await new Promise((r) => setTimeout(r, 30));

      const stage = win.document.querySelector('#stage');
      isAbsent(stage.querySelector('img'), `${screen} rendered stored markup as an element`);
      // And the premise: the payload actually reached the screen, as TEXT. Without this the test
      // passes whenever the record fails to render for some unrelated reason.
      assert.ok(
        stage.textContent.includes('<img'),
        `${screen} never reached the ${sink} sink, so it proves nothing about escaping`,
      );
    }
  } finally {
    win.localStorage.removeItem('cubusSolves');
    win.location.hash = '#/home';
    await tick();
  }
});

test('a malformed solve history is an empty session, not a crash', async () => {
  for (const junk of ['{"list":null}', '{"list":"nope"}', '{"list":[1,2,3]}', '{"list":[null]}', 'not json']) {
    win.localStorage.setItem('cubusSolves', junk);
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/stats';
    await tick();
    assert.match(
      win.document.querySelector('#stage').textContent, /Nothing to report/,
      `junk history should read as empty: ${junk}`,
    );
  }
  win.localStorage.removeItem('cubusSolves');
});


test('five clean solves produce an actual ao5', async () => {
  // The control the refusal tests need. Without it, an implementation that renders AO5 as a dash
  // whatever happens passes both the three-solve test and the corrupt-window test below — so the
  // whole "an average of n needs n solves" story would be proven by a screen that never computes
  // an average at all.
  const now = Date.now();
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    // WCA ao5 over these: drop 10 and 100, mean of 20/30/40 = 30.00.
    list: [10, 20, 30, 40, 100].map((s, i) => ({ n: 5 - i, time: `${s}.00`, scramble: 'R U', moves: 40, at: now })),
  }));
  try {
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/stats';
    await tick();
    const ao5 = [...win.document.querySelectorAll('#stage .card.stat')]
      .find((c) => c.textContent.includes('AO5'));
    assert.ok(ao5, 'the AO5 card is on screen');
    assert.equal(ao5.querySelector('.v').textContent, '30.00', 'and it is the WCA average, not a dash');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

test('a corrupt solve keeps its place, so an average refuses instead of reaching back', async () => {
  // Dropping the corrupt row closes the gap it left, so the "last five" becomes five solves that
  // were not the last five — and the ao5 computed over them looks perfectly reasonable.
  const now = Date.now();
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [
      { n: 6, time: '10.00', at: now }, { n: 5, time: '20.00', at: now },
      'corrupt',
      { n: 3, time: '40.00', at: now }, { n: 2, time: '50.00', at: now },
      { n: 1, time: '60.00', at: now },
    ],
  }));
  try {
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/stats';
    await tick();
    const text = win.document.querySelector('#stage').textContent;
    assert.match(text, /AO5—/, 'no ao5 is claimed over a window with a hole in it');
    assert.ok(text.includes('10.00'), 'while the solves that ARE readable still count');
    assert.ok(!text.includes('undefined'), 'and the corrupt row is not drawn');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

// AO5 and AO12 were one card written out twice, beside one shared note (found by audit,
// 2026-09-13; still two copies at verification, 2026-09-14). Both copies render the same today, so
// no screen can tell a copy from the one renderer: the source is read.
test('the average cards are drawn by one renderer, never written out by hand', () => {
  const src = readFileSync(new URL('../lib/screens/stats.js', import.meta.url), 'utf8');
  const card = blockAt(src, 'function averageCard(');
  assert.match(card, /class="card stat"/, 'averageCard does not draw the stat card');
  assert.equal((src.match(/<div class="eyebrow">AO(?:5|12)</g) ?? []).length, 0,
    'an average card is written out by hand beside the renderer');
});

// ---- Stats, audited 2026-09-13: one rule per question, and a chart that had no assertion at all

/** A Stats card, found by its eyebrow. */
const statCard = (eyebrow) => [...win.document.querySelectorAll('#stage .card')]
  .find((c) => c.querySelector('.eyebrow')?.textContent === eyebrow);
/** Stats, drawn over exactly this history. */
const openStats = async (list) => {
  win.localStorage.setItem('cubusSolves', JSON.stringify({ list }));
  win.location.hash = '#/home';
  await tick();
  win.location.hash = '#/stats';
  await tick();
};

test('a corrupt newest solve explains itself the same way at every average size', async () => {
  const now = Date.now();
  const clean = (n) => Array.from({ length: n }, (_, i) => ({ n: n - i, time: '20.00', scramble: 'R U', at: now }));
  try {
    await openStats([{ n: 13, time: '', at: now }, ...clean(12)]);
    assert.equal(statCard('AO5').querySelector('.d').textContent, 'a recent solve is unreadable');
    assert.equal(statCard('AO12').querySelector('.d').textContent, 'a recent solve is unreadable',
      'AO12 said it needed more solves over a window that was full but had a hole in it');
    await openStats(clean(9));
    assert.equal(statCard('AO12').querySelector('.d').textContent, 'needs 3 more', 'a short session still says how many');
    // Short AND holed: one more solve would still leave the hole inside the window, so no count.
    await openStats([{ n: 11, time: '', at: now }, ...clean(10)]);
    assert.equal(statCard('AO12').querySelector('.d').textContent, 'a recent solve is unreadable',
      'a count was promised that the next solve cannot keep — the unreadable one is still in the window');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

test('a row Stats draws is a row Stats counted', async () => {
  const now = Date.now();
  try {
    await openStats([
      { n: 4, time: 'bad', scramble: 'R U', at: now },
      { n: 3, time: '0', scramble: 'R U', at: now },
      { n: 2, time: '-3', scramble: 'R U', at: now },
      { n: 1, time: '10.00', scramble: 'R U', at: now },
    ]);
    const rows = win.document.querySelectorAll('#stage .list .row').length;
    const counted = win.document.querySelector('#stage .card-h .num').textContent;
    assert.equal(counted, '1', 'precondition: one of the four records is a solve');
    assert.equal(rows, 1, `${rows} rows drawn beside a count of ${counted}`);
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

test('the session chart draws the last twenty solves oldest-first, and marks the fastest of them', async () => {
  const now = Date.now();
  // Newest first. The fastest overall (5.00) is the OLDEST record, outside the twenty drawn; the
  // fastest of the twenty (8.00) is the one the marker must land on.
  const list = Array.from({ length: 22 }, (_, i) => ({ n: 22 - i, time: '20.00', scramble: 'R U', at: now }));
  list[21].time = '5.00';
  list[10].time = '8.00';
  list[19].time = '30.00'; // the oldest of the twenty
  try {
    await openStats(list);
    const bars = [...statCard('LAST 20 SOLVES').querySelectorAll('div[title]')];
    assert.equal(bars.length, 20);
    assert.equal(bars[0].getAttribute('title'), '30.00s', 'the oldest of the twenty is on the left');
    const marked = bars.filter((b) => (b.getAttribute('style') || '').includes('var(--accent)'));
    assert.deepEqual(marked.map((b) => b.getAttribute('title')), ['8.00s'], 'the fastest of the bars drawn is marked');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

test("a chart bar's height is proportional to the slowest solve drawn", async () => {
  const now = Date.now();
  try {
    await openStats([{ n: 2, time: '10.00', scramble: 'R U', at: now }, { n: 1, time: '20.00', scramble: 'R U', at: now }]);
    const heights = [...statCard('LAST 2 SOLVES').querySelectorAll('div[title]')]
      .map((b) => (b.getAttribute('style') || '').match(/height:(\d+)%/)?.[1]);
    assert.deepEqual(heights, ['100', '50'], 'oldest first: 20.00 is the full height, 10.00 half of it');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

test("the week chart says each day's count and best, and only dated solves appear", async () => {
  const now = Date.now();
  try {
    await openStats([
      { n: 2, time: '12.34', scramble: 'R U', at: now },
      { n: 1, time: '9.00', scramble: 'R U' }, // no date: a solve, but nobody's day
    ]);
    const days = [...statCard('WEEK').querySelectorAll('div[title]')];
    assert.equal(days.length, 7);
    assert.equal(days[6].getAttribute('title'), '1 solve · best 12.34', 'today holds the dated solve, and only it');
    assert.ok(days.slice(0, 6).every((d) => d.getAttribute('title') === '0 solves'), 'another day was given a solve');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

test('the chart eyebrow counts the bars it drew, not the records it read', async () => {
  const now = Date.now();
  const list = Array.from({ length: 20 }, (_, i) => ({ n: 20 - i, time: i % 4 === 0 ? 'junk' : '15.00', scramble: 'R U', at: now }));
  try {
    await openStats(list);
    const card = statCard('LAST 15 SOLVES');
    assert.ok(card, 'fifteen readable solves among twenty records are not "LAST 15 SOLVES"');
    assert.equal(card.querySelectorAll('div[title]').length, 15);
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});



test('a turn rate is never fabricated from a time that is not a number', async () => {
  // TWO ways this goes wrong, and they take different guards. A decimal long enough to parse as
  // Infinity is caught on the way in; a vanishingly small one is not — it is finite and positive,
  // and 40 divided by it is Infinity on the way out. A finite input does not guarantee a finite
  // result, and testing only the first left the second guard unexercised.
  // Both records are CUBE-timed: a turn rate is computed from nothing else, so without `source`
  // neither reached the division this is about — and the second guard went unexercised anyway
  // (found by audit, 2026-09-13).
  const huge = `${'9'.repeat(400)}.0`;
  const tiny = `0.${'0'.repeat(320)}1`;
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [
      { n: 2, time: huge, scramble: 'R U', moves: 40, source: 'cube', at: Date.now() },
      { n: 1, time: tiny, scramble: 'R U', moves: 40, source: 'cube', at: Date.now() },
    ],
  }));
  try {
    for (const screen of ['#/stats', '#/timer']) {
      win.location.hash = '#/home';
      await tick();
      win.location.hash = screen;
      await tick();
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(
        !/tps/.test(win.document.querySelector('#stage').textContent),
        `${screen} invented a turn rate from an unusable time`,
      );
      if (screen === '#/stats') {
        assert.equal(statCard('TURN RATE')?.querySelector('.v')?.textContent, '—',
          'a turn rate was drawn from a time too small to divide by');
      }
    }
  } finally {
    win.localStorage.removeItem('cubusSolves');
    win.location.hash = '#/home';
    await tick();
  }
});






// ---- Follow cube (state-matched; see dev-docs/follow-mode-redesign.md) ----------------------
//
// Exercised on the scramble screen, because it mounts completely here: it needs only cubejs to
// build its moves, while the solve path needs the two-phase engine and bails early.
//
// Two rules make these tests honest where the previous battery was not:
//  * Moves are fed as QUARTER TURNS ONLY — the GAN driver never emits an "R2", and a battery
//    that feeds one is testing a cube that does not exist.
//  * The renderer element is a spy whose animations NEVER complete — which is not a harness
//    weakness but the exact in-flight window where the old drawing logic dropped undos and
//    overshot the queue. What the guide asks of the renderer is asserted call by call.

const feed = () => win.cubusFeed;
let serialSeq = 0;

/** A physical turn stream: half turns become their two quarters, serials count like the cube's. */
const quarters = (m) => (m.endsWith('2') ? [m[0], m[0]] : [m]);
const invQ = (q) => (q.endsWith("'") ? q[0] : `${q}'`);
const feedQ = (qs) => { for (const q of qs) feed().move({ notation: q, serial: (serialSeq = (serialSeq + 1) % 256) }); };

/** A face that can be turned WRONGLY here: not any listed move's face, so it can never read as
 *  the midpoint of an adjacent half turn. */
const wrongFaceFor = (...near) => ['U', 'R', 'F', 'D', 'L', 'B'].find((f) => !near.some((m) => m && m[0] === f));

/** Replace the inert renderer's transport API with spies. seek() announces its landing
 *  synchronously exactly like the real one; the stop commands never complete — the race.
 *
 *  THE STOP TRANSPORT since plan item 6.5: the walk is driven through the script player, so these are
 *  the calls it makes. Recorded under the old names, because what every case below is about — how many
 *  turns were drawn and which way — did not change, and renaming them would make those cases read as
 *  though their subject had. */
const spyCube = () => {
  const el = win.document.querySelector('cubus-cube');
  const calls = [];
  // Every token of a walk is a stop, so the element's stops are 0..n. The driver reads this to decide
  // whether a position is one step along; without it every arrival would be a jump.
  Object.defineProperty(el, 'stops', {
    configurable: true,
    get: () => {
      const n = (el.getAttribute('alg') ?? '').split(' ').filter(Boolean).length;
      return Array.from({ length: n + 1 }, (_, i) => i);
    },
  });
  el.stepStop = () => { calls.push(['step']); };
  el.stepBackStop = () => { calls.push(['stepBack']); };
  el.step = () => { calls.push(['step']); };
  el.stepBack = () => { calls.push(['stepBack']); };
  el.playTo = (k) => { calls.push(['playTo', k]); };
  el.seek = (k) => {
    calls.push(['seek', k]);
    el.dispatchEvent(new win.CustomEvent('cubus-step', { detail: { index: k, total: 0 } }));
  };
  el.play = () => {};
  el.pause = () => {};
  return calls;
};
const drawnSteps = (calls) => calls.filter((c) => c[0] === 'step').length;

/** Put the cube model back the way a fresh boot leaves it. The helpers below mutate connection,
 *  trust, live and reported state — anything not reset here leaks into whatever test runs next. */
const resetCubeModel = (state) => {
  win.cubusFeed.useConnection(null);
  state.reconnect = null;
  state.connected = false;
  state.cubeName = '';
  state.cube.trusted = false;
  state.cube.source = 'none';
  state.cube.staleWhy = '';
  state.cube.isPhysical = false;
  state.cube.offset = null;
  state.cube.offsetAt = 0;
  state.cube.offsetFrom = '';
  state.live = null;
  state.reported = null;
  state.anchored = false;
};

const followSetup = async (state) => {
  state.connected = true;
  state.cubeName = 'GAN-test';
  // Following requires a TRUSTED cube whose walk STARTS where the cube in your hand is: a
  // scramble walks from solved, so the live report must say solved.
  state.cube.trusted = true;
  state.cube.source = 'cube';
  state.cube.staleWhy = '';
  state.live = SOLVED_FACELETS;
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/scramble';
  await tick();
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && win.document.querySelectorAll('#solList .chip-m').length === 0) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return [...win.document.querySelectorAll('#solList .chip-m')].map((b) => b.textContent);
};

test('the pacing toggle appears only with a smart cube, and defaults to following', async () => {
  const { state } = await import('../lib/app.js');
  try {
    win.location.hash = '#/timer';
    await tick();
    win.location.hash = '#/scramble';
    await tick();
    isAbsent(win.document.querySelector('[data-mode="cube"]'),
      'no cube, no toggle — a switch with one position');
    const moves = await followSetup(state);
    assert.ok(moves.length > 2, 'precondition: a scramble was generated');
    const btn = win.document.querySelector('[data-mode="cube"]');
    assert.ok(btn, 'connected: the toggle exists');
    assert.ok(btn.classList.contains('on'), 'and following is the default');
    assert.ok(!btn.disabled);
    assert.equal(win.document.querySelector('cubus-cube').getAttribute('tempo-scale'), '1',
      'following mirrors at the 190ms base, not at a demonstration speed');
  } finally { resetCubeModel(state); }
});

test('turns advance the guide immediately, one drawn step each — never an extra', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    assert.ok(moves.length > 2, 'precondition: a scramble was generated');
    const calls = spyCube();
    // Two turns back to back — faster than any animation could finish. The old drawing logic
    // measured its delta against the ANIMATION's position and queued three steps for these two.
    feedQ(quarters(moves[0]));
    feedQ(quarters(moves[1]));
    assert.equal(win.document.querySelector('#followNote').hidden, true, 'neither was refused');
    assert.equal(drawnSteps(calls), 2, 'two turns draw exactly two steps');
    assert.equal(calls.filter((c) => c[0] === 'seek').length, 0, 'and no panic jump');
    // And the position really moved: a deliberately wrong turn names move 3 as the expected one.
    feedQ([wrongFaceFor(moves[1], moves[2])]);
    const note = win.document.querySelector('#followNote');
    assert.equal(note.hidden, false, 'a wrong turn is surfaced');
    assert.ok(win.document.querySelector('#followMsg').textContent.includes(`the next move is ${moves[2]}`),
      `the guide is waiting on move 3 (${moves[2]}), so the first two were taken`);
  } finally { resetCubeModel(state); }
});

test('an undo made inside the animation window is drawn back, not dropped', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    assert.ok(moves.length > 1);
    const calls = spyCube();
    feedQ(quarters(moves[0]));
    // The forward animation has NOT completed — nothing ever completes in this harness, which
    // is precisely the in-flight window where the old code dropped the undo forever.
    feedQ(quarters(moves[0]).map(invQ).reverse());
    assert.equal(win.document.querySelector('#followNote').hidden, true, 'the undo was accepted');
    assert.deepEqual(calls[calls.length - 1], ['stepBack'], 'and drawn back immediately');
    // The position is back at 0: a wrong move now names move 1 as the expected one again.
    feedQ([wrongFaceFor(moves[0], moves[1])]);
    assert.ok(win.document.querySelector('#followMsg').textContent.includes(`the next move is ${moves[0]}`),
      'after the undo, the guide expects the first move again');
  } finally { resetCubeModel(state); }
});

test('a half turn advances through a silent midpoint, and undoes through one too', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    const h = moves.findIndex((m) => m.endsWith('2'));
    if (h === -1) return; // this scramble happens to carry no half turn — nothing to pin
    const calls = spyCube();
    for (let i = 0; i < h; i++) feedQ(quarters(moves[i]));
    const before = drawnSteps(calls);
    const note = win.document.querySelector('#followNote');
    const face = moves[h][0];
    feedQ([face]);
    assert.equal(note.hidden, true, 'half a half-turn is legal and silent — no wrong-move scolding');
    assert.equal(drawnSteps(calls), before, 'and nothing is drawn at the midpoint');
    feedQ([face]);
    assert.equal(note.hidden, true);
    assert.equal(drawnSteps(calls), before + 1, 'the completed half turn is one drawn step');
    // Undoing an R2 arrives as two counter-quarters — the driver has no other way to say it.
    feedQ([`${face}'`]);
    assert.equal(note.hidden, true, 'half-way back is silent too');
    feedQ([`${face}'`]);
    assert.deepEqual(calls[calls.length - 1], ['stepBack'], 'the undone half turn steps the guide back');
  } finally { resetCubeModel(state); }
});

test('a wrong turn says so, and undoing it clears the note by itself — no snapshot needed', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    const wrong = wrongFaceFor(moves[0]);
    feedQ([wrong]);
    const note = win.document.querySelector('#followNote');
    assert.equal(note.hidden, false);
    assert.ok(!note.classList.contains('info'), 'a wrong turn reads as a warning, not information');
    assert.ok(win.document.querySelector('#followMsg').textContent.includes(wrong));
    assert.ok(win.document.querySelector('#resolveBtn'), 'and offers a way out');
    // The old latch ignored the very undo the note asked for, until a snapshot rescued it.
    feedQ([invQ(wrong)]);
    assert.equal(note.hidden, true, 'the undo is heard the moment it happens');
  } finally { resetCubeModel(state); }
});

test('a lost turn stands follow down, says so, and restores the walk speed', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    const el = win.document.querySelector('cubus-cube');
    assert.equal(el.getAttribute('tempo-scale'), '1', 'precondition: follow tempo active');
    feed().movesLost();
    assert.equal(win.document.querySelector('#followNote').hidden, false);
    // No number. The old copy said "Missed 2 turns" from a move serial the app no longer has;
    // reconciliation proves a turn was lost and cannot count it, and inventing the count would be
    // the comfortable sentence rather than the true one.
    assert.match(win.document.querySelector('#followMsg').textContent, /A turn went unrecorded/);
    assert.doesNotMatch(win.document.querySelector('#followMsg').textContent, /\d/,
      'and it must not name a number it cannot know');
    const btn = win.document.querySelector('[data-mode="cube"]');
    assert.ok(btn.disabled, 'following a cube we cannot vouch for is not on offer');
    assert.notEqual(el.getAttribute('tempo-scale'), '1', 'and the demonstration speed is back');
  } finally { resetCubeModel(state); }
});

test('a disconnect while following stands follow down through the trust hook', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    const el = win.document.querySelector('cubus-cube');
    feed().disconnect();
    const btn = win.document.querySelector('[data-mode="cube"]');
    assert.ok(btn.disabled, 'a vanished cube is not on offer to follow');
    assert.ok(!btn.classList.contains('on'));
    assert.notEqual(el.getAttribute('tempo-scale'), '1', 'tempo does not leak past the lapse');
  } finally { resetCubeModel(state); }
});

test('a snapshot from off the plan is named, and clears once the cube rejoins', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    assert.ok(moves.length > 0);
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
    const offPlan = (() => { const c = new Cube(); c.move("R U F' D2 L"); return c.asString(); })();
    feed().facelets(offPlan);
    assert.equal(win.document.querySelector('#followNote').hidden, false, 'off-plan is surfaced');
    feed().facelets(SOLVED_FACELETS);
    assert.equal(win.document.querySelector('#followNote').hidden, true, 'it rejoins on its own');
  } finally { resetCubeModel(state); }
});

test('a distant midpoint is a wrong position, not silent progress', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    const h = moves.findIndex((m, i) => i >= 2 && m.endsWith('2'));
    if (h === -1) return; // no half turn far enough from the start in this scramble
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
    const c = new Cube();
    for (let i = 0; i < h; i++) c.move(moves[i]);
    c.move(moves[h][0]); // one quarter into a half turn the cube is nowhere near
    feed().facelets(c.asString());
    const note = win.document.querySelector('#followNote');
    assert.equal(note.hidden, false, 'a midpoint only counts beside its own half turn');
    assert.match(win.document.querySelector('#followMsg').textContent, /not on the plan/);
  } finally { resetCubeModel(state); }
});

test('an unchanged snapshot still corrects the guide after a lost move packet', async () => {
  const { state } = await import('../lib/app.js');
  const prevFacelets = state.cube.facelets;
  try {
    const moves = await followSetup(state);
    const calls = spyCube();
    // The scan/anchor had adopted solved, and the cube reports match it — the exact case the
    // old onFacelets deduplicated into silence before the screen could hear it.
    state.cube.isPhysical = true;
    state.cube.facelets = SOLVED_FACELETS;
    feedQ(quarters(moves[0]));   // the turn arrives…
    // …but its UNDO's packets are lost. Only the ~1Hz snapshot knows the cube is back at solved.
    feed().facelets(SOLVED_FACELETS);
    assert.deepEqual(calls[calls.length - 1], ['stepBack'], 'the swallowed correction now lands');
    feedQ([wrongFaceFor(moves[0], moves[1])]);
    assert.ok(win.document.querySelector('#followMsg').textContent.includes(`the next move is ${moves[0]}`),
      'and the guide expects move 1 again');
  } finally {
    state.cube.facelets = prevFacelets;
    resetCubeModel(state);
  }
});

test('out-of-order cube events trip a loud warning instead of silent tracking', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    const seq = [...quarters(moves[0]), ...quarters(moves[1])];
    feed().move({ notation: seq[0], serial: 100 });
    assert.equal(win.document.querySelector('#followNote').hidden, true);
    feed().move({ notation: seq[1], serial: 90 }); // the shared counter went BACKWARDS
    assert.equal(win.document.querySelector('#followNote').hidden, false);
    assert.match(win.document.querySelector('#followMsg').textContent, /out of order/);
  } finally { resetCubeModel(state); }
});

test('taking over pauses follow neutrally, keeps tracking, and resume seeks to the cube', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    const calls = spyCube();
    const el = win.document.querySelector('cubus-cube');
    const btn = win.document.querySelector('[data-mode="cube"]');
    win.document.querySelector('#nextBtn').click();
    assert.ok(!btn.classList.contains('on'), 'pressing Next hands control back to you');
    const note = win.document.querySelector('#followNote');
    assert.equal(note.hidden, false);
    assert.ok(note.classList.contains('info'), 'pausing is information, not a warning');
    assert.notEqual(el.getAttribute('tempo-scale'), '1', 'the demonstration speed is back');
    assert.deepEqual(calls.find((c) => c[0] === 'seek'), ['seek', 0],
      'the hand-over collapsed the follow queue at the cube, before the manual step');
    // The cube keeps being tracked while the user drives — silently.
    const before = calls.length;
    feedQ(quarters(moves[0]));
    assert.equal(calls.length, before, 'physical turns draw nothing while paused');
    assert.ok(note.classList.contains('info'), 'and raise no wrong-move complaint');
    // Resume: the cube leads again, from where it actually is — not from the buttons.
    btn.click();
    assert.ok(btn.classList.contains('on'), 'the toggle resumes following');
    assert.equal(el.getAttribute('tempo-scale'), '1');
    assert.deepEqual(calls.filter((c) => c[0] === 'seek').pop(), ['seek', 1],
      'resume seeks to the tracked cube position');
    assert.ok(win.document.querySelector('#stepLbl').textContent.startsWith('1 /'),
      'and the counter tells the cube’s truth');
    assert.equal(note.hidden, true, 'the pause line is gone');
  } finally { resetCubeModel(state); }
});

test('choosing a walk speed while following is stored, not applied over the mirror tempo', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    const el = win.document.querySelector('cubus-cube');
    win.document.querySelector('[data-speed="slow"]').click();
    assert.equal(el.getAttribute('tempo-scale'), '1', 'the mirror tempo holds while the cube drives');
    win.document.querySelector('[data-speed="normal"]').click(); // put the stored choice back
    win.document.querySelector('#nextBtn').click();
    assert.equal(el.getAttribute('tempo-scale'), '0.1', 'taking over applies the chosen walk speed');
  } finally { resetCubeModel(state); }
});

test('Re-solve starts from the cube as it is now, not from the last adopted snapshot', async () => {
  const { state } = await import('../lib/app.js');
  const prev = state.cube.facelets;
  try {
    const moves = await followSetup(state);
    // One physical turn: the model is ahead of anything the app has adopted — the exact
    // sub-second window where the old Re-solve rebuilt a walk for a cube that no longer existed.
    feedQ(quarters(moves[0]));
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
    const walked = (() => { const c = new Cube(); c.move(moves[0]); return c.asString(); })();
    win.document.querySelector('#resolveBtn').click();
    assert.equal(state.cube.facelets, walked, 'the walked-ahead model was adopted before the remount');
    assert.equal(state.live, walked,
      'live carries it too — or the next mount compares the fresh walk against a stale snapshot and refuses to follow');
    assert.equal(win.location.hash, '#/home',
      'on Scramble, Re-solve goes to the solve walk — Scramble itself always starts from solved and would ignore the cube');
  } finally {
    state.cube.facelets = prev;
    resetCubeModel(state);
  }
});

// A static check because it is a static mistake: var(--fade) is a DURATION token, and a browser
// handed a duration as a colour silently discards the declaration — the pause line then inherits
// the warning colour while every class-based test stays green.
test('the pause line is styled as information, in an actual colour token', () => {
  const rule = html.match(/\.follow-note\.info\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /color: var\(--ink-\d\)/, 'the info note must use a real ink colour token');
});

test('the titlebar indicator appears with a connection and leaves with it', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const ind = win.document.querySelector('#cubeLive');
    assert.ok(ind, 'the indicator exists in the titlebar');
    assert.equal(ind.hidden, true, 'and is absent with no cube');
    win.cubusFeed.useConnection({ requestBattery: async () => 80 });
    assert.equal(ind.hidden, false, 'a connection reveals it');
    assert.ok(ind.classList.contains('stale'), 'a fresh connection is connected, not trusted');
    state.cube.trusted = true;
    win.cubusFeed.facelets(SOLVED_FACELETS);
    win.cubusFeed.useConnection(null);
    assert.equal(ind.hidden, true, 'a disconnect takes it away');
  } finally { resetCubeModel(state); }
});

test('Settings offers a compatibility report, and says so loudest when the cube was refused', async () => {
  // dev-docs/universal-cube-driver.md §7: a self-check refusal that reaches nobody is a quiet
  // failure one level above the one it guards against. This is the one affordance that closes it,
  // so its ABSENCE is what this test is really about.
  const { state } = await import('../lib/app.js');
  try {
    const report = () => ({ format: 'smartcube-fixture', version: 1, capturedAt: '2026-08-31T00:00:00.000Z',
      device: { name: 'Test cube', id: '' }, protocol: { id: 'gan-gen4', name: 'GAN Gen4' },
      services: [], traffic: [], events: [] });

    win.cubusFeed.useConnection({ requestBattery: async () => 80, disconnect: async () => {}, verdict: 'stream', report });
    win.cubusGo('settings');
    await tick();
    const btn = win.document.querySelector('#cubeReportBtn');
    assert.ok(btn, 'a connected cube must be able to produce a report');
    const calm = win.document.body.textContent;
    assert.ok(calm.includes('Send us a report'), 'a working cube is asked gently');
    assert.ok(!calm.includes('did not check out'), 'and is not accused of anything');

    win.cubusFeed.useConnection({ requestBattery: async () => 80, disconnect: async () => {}, verdict: 'refused', report });
    win.cubusGo('settings');
    await tick();
    const loud = win.document.body.textContent;
    assert.ok(loud.includes('did not check out'), 'a refused cube says so plainly');
    assert.ok(win.document.querySelector('#cubeReportBtn'), 'and still offers the report');

    win.cubusFeed.useConnection(null);
    win.cubusGo('settings');
    await tick();
    isAbsent(win.document.querySelector('#cubeReportBtn'), 'with no cube there is nothing to report');
  } finally { resetCubeModel(state); }
});

test('two quick presses on Save report warn about the address first, and save nothing', async (t) => {
  const { state } = await import('../lib/app.js');
  const saved = t.mock.method(globalThis.URL, 'createObjectURL', () => 'blob:test');
  try {
    const report = () => ({ format: 'smartcube-fixture', version: 1, capturedAt: '2026-08-31T00:00:00.000Z',
      device: { name: 'Test cube', id: 'AA:BB:CC:DD:EE:FF' }, protocol: { id: 'gan-gen4', name: 'GAN Gen4' },
      services: [], traffic: [], events: [] });
    win.cubusFeed.useConnection({ requestBattery: async () => 80, disconnect: async () => {}, verdict: 'stream', report });
    win.cubusGo('settings');
    await tick();
    const btn = win.document.querySelector('#cubeReportBtn');
    btn.click();
    btn.click();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(saved.mock.callCount(), 0, 'the second press saved the address-carrying file before the warning was read');
    assert.match(win.document.querySelector('#pairMsg').textContent, /Bluetooth address/, 'the warning went unsaid');
  } finally { resetCubeModel(state); }
});

/** A connected cube whose recording carries `id` as its device id: an address, so a press warns
 *  first. */
const reportingCube = (id) => ({
  requestBattery: async () => 80, disconnect: async () => {}, verdict: 'stream',
  report: () => ({ format: 'smartcube-fixture', version: 1, capturedAt: '2026-08-31T00:00:00.000Z',
    device: { name: 'Test cube', id }, protocol: { id: 'gan-gen4', name: 'GAN Gen4' },
    services: [], traffic: [], events: [] }),
});

// The address warning is about one cube's recording. A press on one cube that landed after another
// had replaced it armed the new cube's button, and that cube's first press saved its address
// unwarned.
test('a Save report press on one cube does not answer for the cube that replaced it', async (t) => {
  const { state } = await import('../lib/app.js');
  const saved = t.mock.method(globalThis.URL, 'createObjectURL', () => 'blob:test');
  const wait = () => new Promise((r) => setTimeout(r, 50));
  try {
    win.cubusFeed.useConnection(reportingCube('AA:BB:CC:DD:EE:FF'));
    win.cubusGo('settings');
    await tick();
    win.document.querySelector('#cubeReportBtn').click(); // cube A's press, still loading the report module
    win.cubusFeed.useConnection(reportingCube('0A:0B:0C:0D:0E:0F')); // cube B takes A's place meanwhile
    win.cubusGo('settings');
    await wait();
    const armed = /anyway/.test(win.document.querySelector('#cubeReportBtn').textContent);
    win.document.querySelector('#cubeReportBtn').click(); // cube B's first press
    await wait();
    assert.deepEqual({ armed, saves: saved.mock.callCount() }, { armed: false, saves: 0 },
      "A's press answered for cube B: it armed B's button, or B's first press saved its address unwarned");
    assert.match(win.document.querySelector('#pairMsg').textContent, /Bluetooth address/, "cube B's warning went unsaid");
  } finally { resetCubeModel(state); }
});

test('a warned cube keeps its question through a repaint, and its next press saves', async (t) => {
  const { state } = await import('../lib/app.js');
  const saved = t.mock.method(globalThis.URL, 'createObjectURL', () => 'blob:test');
  const wait = () => new Promise((r) => setTimeout(r, 50));
  try {
    win.cubusFeed.useConnection(reportingCube('AA:BB:CC:DD:EE:FF'));
    win.cubusGo('settings');
    await tick();
    win.document.querySelector('#cubeReportBtn').click();
    await wait();
    assert.match(win.document.querySelector('#pairMsg').textContent, /Bluetooth address/, 'precondition: the first press warned');
    win.cubusGo('settings'); // the same cube on a fresh card, as a battery reply or a trust change draws it
    await tick();
    const btn = win.document.querySelector('#cubeReportBtn');
    assert.match(btn?.textContent ?? '', /Save it anyway/, 'the fresh card says Save report over a press that saves without asking');
    btn.click();
    await wait();
    assert.equal(saved.mock.callCount(), 1, 'the press after the warning saved nothing');
  } finally { resetCubeModel(state); }
});

test('a Bluetooth answer that lands after a cube paired does not disable its Disconnect', async () => {
  const { state } = await import('../lib/app.js');
  let answer;
  Object.defineProperty(win.navigator, 'bluetooth', {
    configurable: true, value: { getAvailability: () => new Promise((r) => { answer = r; }) },
  });
  try {
    resetCubeModel(state);
    win.cubusGo('settings');
    await tick();
    assert.ok(answer, 'precondition: the disconnected card asked whether there is a radio');
    win.cubusFeed.useConnection({ requestBattery: async () => 80, disconnect: async () => {}, verdict: 'stream', report: () => ({}) });
    win.cubusGo('settings');
    await tick();
    answer(false);
    await tick();
    await tick();
    const pair = win.document.querySelector('#pairBtn');
    assert.match(pair?.textContent ?? '', /Disconnect/, 'precondition: the connected card offers Disconnect');
    assert.equal(pair.disabled, false, 'a late "no radio" answer disabled the Disconnect of a connected cube');
    assert.doesNotMatch(win.document.querySelector('#btNote').textContent, /No Bluetooth radio/, 'and wrote over the connected note');
  } finally {
    delete win.navigator.bluetooth;
    resetCubeModel(state);
  }
});

test('a "no radio" answer to a card no longer drawn does not overrule the card on screen', async () => {
  const { state } = await import('../lib/app.js');
  const answers = [];
  Object.defineProperty(win.navigator, 'bluetooth', {
    configurable: true, value: { getAvailability: () => new Promise((r) => { answers.push(r); }) },
  });
  try {
    resetCubeModel(state);
    win.cubusGo('settings');
    await tick();
    const first = answers[answers.length - 1];
    assert.ok(first, 'precondition: the disconnected card asked whether there is a radio');
    win.cubusFeed.useConnection({ requestBattery: async () => 80, disconnect: async () => {}, verdict: 'stream', report: () => ({}) });
    win.cubusGo('settings');
    await tick();
    win.cubusFeed.useConnection(null);
    win.cubusGo('settings');
    await tick();
    const fresh = answers[answers.length - 1];
    assert.ok(fresh !== first, 'precondition: the card on screen asked for itself');
    fresh(true);
    await tick();
    await tick();
    first(false); // the first card's answer, landing last
    await tick();
    await tick();
    const pair = win.document.querySelector('#pairBtn');
    assert.match(pair?.textContent ?? '', /Pair a cube/, 'precondition: the disconnected card offers Pair');
    assert.equal(pair.disabled, false, 'an answer to a card no longer drawn disabled Pair on the card told there is a radio');
    assert.doesNotMatch(win.document.querySelector('#btNote').textContent, /No Bluetooth radio/, 'and wrote over its note');
  } finally {
    delete win.navigator.bluetooth;
    resetCubeModel(state);
  }
});

// A cube can connect while an address is being typed, and Settings then waits for the typing to
// stop before it redraws — so the card that asked is still the one drawn, over a connected cube.
test('a "no radio" answer landing after a cube connected under a typed address changes nothing', async () => {
  const { state } = await import('../lib/app.js');
  let answer;
  Object.defineProperty(win.navigator, 'bluetooth', {
    configurable: true, value: { getAvailability: () => new Promise((r) => { answer = r; }) },
  });
  let mac;
  try {
    resetCubeModel(state);
    win.cubusGo('settings');
    await tick();
    mac = win.document.querySelector('#macIn');
    assert.ok(mac && answer, 'precondition: the disconnected card asks for an address and whether there is a radio');
    mac.focus();
    win.cubusFeed.useConnection({ requestBattery: async () => 80, disconnect: async () => {}, verdict: 'stream', report: () => ({}) });
    assert.equal(state.connected, true, 'precondition: the cube connected');
    assert.ok(win.document.querySelector('#macIn') === mac, 'precondition: the card waits for the typing to stop');
    answer(false);
    await tick();
    await tick();
    assert.doesNotMatch(win.document.querySelector('#btNote').textContent, /No Bluetooth radio/, "a connected cube's card was told there is no radio");
    assert.equal(win.document.querySelector('#pairBtn').disabled, false, 'and its button was disabled');
  } finally {
    mac?.blur();
    mac?.dispatchEvent(new win.Event('focusout', { bubbles: true }));
    await tick();
    delete win.navigator.bluetooth;
    resetCubeModel(state);
  }
});

test('a remembered cube is offered Use only where this browser has Bluetooth to use', async () => {
  const { state } = await import('../lib/app.js');
  const settingsAgain = async () => { win.cubusGo('home'); await tick(); win.cubusGo('settings'); await tick(); };
  try {
    resetCubeModel(state);
    win.cubusFeed.useConnection({ requestBattery: async () => 80, disconnect: async () => {}, verdict: 'stream', report: () => ({}) });
    win.cubusFeed.useConnection(null);
    await settingsAgain();
    assert.ok(win.document.querySelector('[data-forget-cube="AA:BB:CC:DD:EE:FF"]'), 'precondition: the cube is remembered');
    isAbsent(win.document.querySelector('[data-use-cube]'), 'a browser with no Bluetooth was offered a connect it cannot make');
    Object.defineProperty(win.navigator, 'bluetooth', { configurable: true, value: { getAvailability: async () => true } });
    await settingsAgain();
    assert.ok(win.document.querySelector('[data-use-cube="AA:BB:CC:DD:EE:FF"]'), 'and a browser that has it lost the Use it can make');
  } finally {
    delete win.navigator.bluetooth;
    resetCubeModel(state);
  }
});

// The 2D net is the ANCHOR, not a follower: its card says Initial/Target State, and a label
// naming a fixed reference must never sit over a moving picture. What the cube does live is the
// 3D cube's and the transport's story. Before this, snapshots repainted the net whenever follow
// mode was off — which, for a freshly paired (untrusted) cube, was always.
test('on a walking screen, live snapshots never repaint the reference net', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    const netBefore = [...win.document.querySelectorAll('#viewNet .sticker')]
      .map((e) => e.className.split(' ')[1]).join('');
    assert.equal(netBefore.length, 54, 'precondition: the target net is painted');
    // Take over (follow off) — the exact state that used to leak snapshots into the net.
    win.document.querySelector('#nextBtn').click();
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
    const elsewhere = (() => { const c = new Cube(); c.move("R U R'"); return c.asString(); })();
    feed().facelets(elsewhere);
    const netAfter = [...win.document.querySelectorAll('#viewNet .sticker')]
      .map((e) => e.className.split(' ')[1]).join('');
    assert.equal(netAfter, netBefore, 'the reference state holds still whatever the cube does');
  } finally { resetCubeModel(state); }
});

// ---- Scramble → Solve hand-off ---------------------------------------------------------------
//
// The loop a beginner wants: scramble by following the guide, then solve THAT. It is offered at
// completion, on a press, never automatically — reaching 22/22 by clicking says nothing about
// the cube in anyone's hand. Without a trusted cube the target becomes a GENERATED subject (as
// the dev die does); with one, nothing is adopted, because the cube's own state is the subject.

const mountScramble = async () => {
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/scramble';
  await tick();
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && win.document.querySelectorAll('#solList .chip-m').length === 0) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const moves = [...win.document.querySelectorAll('#solList .chip-m')].map((b) => b.textContent);
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const c = new Cube();
  for (const m of moves) c.move(m);
  return { moves, target: c.asString() };
};
const stepTo = (i, total) => win.document.querySelector('cubus-cube')
  .dispatchEvent(new win.CustomEvent('cubus-step', { detail: { index: i, total } }));

test('finishing a scramble offers to solve it — on a press, and as a generated subject without a cube', async () => {
  const { state } = await import('../lib/app.js');
  const prev = { facelets: state.cube.facelets, physical: state.cube.isPhysical, source: state.cube.source, trusted: state.cube.trusted };
  try {
    const { moves, target } = await mountScramble();
    const btn = () => win.document.querySelector('#solveItBtn');
    assert.ok(btn(), 'the hand-off exists on Scramble');
    assert.equal(btn().hidden, true, 'and is hidden until the walk is complete');
    stepTo(moves.length - 1, moves.length);
    assert.equal(btn().hidden, true, 'one move short is not complete');
    stepTo(moves.length, moves.length);
    assert.equal(btn().hidden, false, 'complete: the way onward appears');
    assert.equal(win.location.hash, '#/scramble', 'and nothing navigates on its own');
    assert.equal(btn().textContent, 'Solve this scramble', 'without a cube it is an assumption, and says so');
    btn().click();
    await tick();
    assert.equal(win.location.hash, '#/home', 'the press goes to the solve walk');
    assert.equal(state.cube.facelets, target, 'with the scramble target as the subject');
    assert.equal(state.cube.isPhysical, false, 'not claimed to be the cube in anyone\'s hand');
    assert.equal(state.cube.source, 'generated');
  } finally {
    state.cube.facelets = prev.facelets; state.cube.isPhysical = prev.physical;
    state.cube.source = prev.source; state.cube.trusted = prev.trusted;
  }
});

// The hand-off carries a setup alg with the cube, which is the one path where a solution arrives
// without a search: it is that alg inverted. `takeDerivation` used to repeat all of finishSolve —
// the oracle applying the solution, the assignment, the tokenizer, the per-step states — and then
// record the result as UNVERIFIED, so the first use of the cube ran every one of them a second
// time. Two copies of one rule is how one copy quietly stops being verified, and this one had
// already drifted: the flag denied a check cubejs had just performed and passed.
test('a carried solution arrives CHECKED, committed once, with its steps already built', async () => {
  const { state } = await import('../lib/app.js');
  const prev = { facelets: state.cube.facelets, physical: state.cube.isPhysical, source: state.cube.source, trusted: state.cube.trusted };
  try {
    const { moves, target } = await mountScramble();
    stepTo(moves.length, moves.length);
    // Synchronous: the adoption happens on the press, and the route change does not land until
    // the hashchange task — so this reads the state the COMMIT left, with no screen involved.
    win.document.querySelector('#solveItBtn').click();
    assert.equal(state.cube.facelets, target, 'precondition: the hand-off adopted the scramble target');
    assert.ok(state.cube.solution, 'the carried alg IS the answer, inverted — there is nothing to search for');
    assert.equal(state.cube.crossChecked, true,
      'cubejs applied this solution to these facelets and found them solved; recording that as unverified made the whole commit run again');
    assert.equal(state.cube.moves.length, state.cube.solution.trim().split(/\s+/).length, 'tokenized once');
    assert.equal(state.cube.stepFacelets.length, state.cube.moves.length + 1, 'and the per-step states are already there');
    assert.equal(state.cube.derived, true);
    assert.equal(state.cube.unsolvable, false, 'an arrangement a real alg reaches is a real arrangement');
    await tick();
  } finally {
    state.cube.facelets = prev.facelets; state.cube.isPhysical = prev.physical;
    state.cube.source = prev.source; state.cube.trusted = prev.trusted;
  }
});

test('with a trusted cube at the target, the hand-off solves the cube itself and adopts nothing', async () => {
  const { state } = await import('../lib/app.js');
  const prev = { facelets: state.cube.facelets, physical: state.cube.isPhysical, source: state.cube.source };
  try {
    const { moves, target } = await mountScramble();
    state.connected = true;
    state.cube.trusted = true;
    state.cube.source = 'cube';
    state.cube.isPhysical = true;
    feed().facelets(target); // the cube reports the scrambled state: ingested as the subject
    assert.equal(state.cube.facelets, target, 'precondition: the cube is the subject');
    stepTo(moves.length, moves.length);
    const btn = win.document.querySelector('#solveItBtn');
    assert.equal(btn.textContent, 'Your cube is scrambled — solve it', 'confirmed by the cube, and worded as such');
    btn.click();
    await tick();
    assert.equal(win.location.hash, '#/home');
    assert.equal(state.cube.isPhysical, true, 'the physical subject is untouched');
    assert.equal(state.cube.source, 'cube', 'no generated adoption over a real cube');
    assert.equal(state.cube.facelets, target);
  } finally {
    resetCubeModel(state);
    state.cube.facelets = prev.facelets; state.cube.isPhysical = prev.physical; state.cube.source = prev.source;
  }
});


// ── PRD phase 4: the Timer times itself from the cube ──────────────────────────────────────────
//
// These exist because phase 4 was built, marked DONE, and then silently lost in the smart-cube
// removal and restore of 2026-08-26/28 — alone among the seven phases, because it was the only one
// living entirely inside a screen body with no module and NO TEST. Nothing failed when it vanished.
// The module's own behaviour is covered in solve-timer.test.mjs; what these cover is the wiring:
// that the Timer screen actually subscribes to the cube's two streams and acts on them.

test('phase 4: the Timer arms on the scramble, starts on a turn, and stops on solved', async () => {
  const { state } = await import('../lib/app.js');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  resetCubeModel(state);
  try {
    state.connected = true;
    state.cubeName = 'GAN-test';
    state.cube.trusted = true;
    state.cube.source = 'cube';
    state.cube.staleWhy = '';

    win.cubusGo('timer');
    await tick();
    const clock = win.document.querySelector('#clock');
    const hint = win.document.querySelector('#timerHint');
    const scrEl = win.document.querySelector('#scr');
    assert.ok(clock && hint && scrEl, 'timer screen mounted');

    // The screen generates its scramble once the solver lands. Without one there is nothing to
    // arm on, so this waits rather than skipping — a skipped precondition is how the whole
    // feature went missing unnoticed.
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !/^[URFDLB]/.test(scrEl.textContent || '')) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const scramble = scrEl.textContent || '';
    assert.match(scramble, /^[URFDLB]/, 'precondition: a scramble was generated');

    // The arrangement that scramble produces, computed independently of the app.
    const c = Cube.fromString(SOLVED_FACELETS);
    for (const m of scramble.trim().split(/\s+/)) c.move(m);
    const target = c.asString();

    // A solved cube is the most tempting wrong thing to arm on, and is explicitly rejected.
    win.cubusFeed.facelets(SOLVED_FACELETS, 1);
    await tick();
    assert.notEqual(hint.textContent, 'Ready — turn to start', 'a solved cube is not the scramble');

    // The target arms it. THIS is the positive assertion: it can only pass if the screen is
    // subscribed to the cube's snapshot stream.
    win.cubusFeed.facelets(target, 2);
    await tick();
    assert.equal(hint.textContent, 'Ready — turn to start', 'the scramble target arms the clock');

    // The first turn starts it — only possible if the move stream is subscribed too.
    win.cubusFeed.move({ notation: 'R', serial: 3, cubeTimestamp: 1000, timestamp: Date.now() });
    await tick();
    assert.match(hint.textContent, /cube stops the clock/, 'the first turn starts it');

    // Solved stops it, and the recorded time is the CUBE's span (4200 - 1000), not the host's.
    const solvesBefore = JSON.parse(win.localStorage.getItem('cubusSolves') || '{"list":[]}').list.length;
    win.cubusFeed.move({ notation: "R'", serial: 4, cubeTimestamp: 4200, timestamp: Date.now() });
    win.cubusFeed.facelets(SOLVED_FACELETS, 4);
    await tick();
    assert.equal(clock.textContent, '3.20', 'the cube clock decides the number');
    const saved = JSON.parse(win.localStorage.getItem('cubusSolves') || '{"list":[]}').list;
    assert.equal(saved.length, solvesBefore + 1, 'the solve was recorded');
    assert.equal(saved[0].source, 'cube', 'and recorded as cube-timed');
    assert.equal(saved[0].moves, 2, 'with its move count, which a turn rate needs');
  } finally { resetCubeModel(state); }
});

test('phase 4: the Timer releases the cube stream when the screen goes away', async () => {
  // A torn-down closure that keeps timing is the bug the cleanup exists to prevent — and the same
  // class of leak that phase 4 fixed for the animation frame.
  win.cubusGo('timer');
  await tick();
  win.cubusGo('home');
  await tick();
  // Feeding after teardown must not throw: the screen's handlers are detached, not dangling.
  assert.doesNotThrow(() => {
    win.cubusFeed.move({ notation: 'R', serial: 1, cubeTimestamp: 1000, timestamp: Date.now() });
    win.cubusFeed.facelets(SOLVED_FACELETS, 1);
  });
});


test('phase 4: every timer-screen sentence goes through t()', async () => {
  // dev-docs/i18n.md: new user-facing strings go through t() from the day they are written. This
  // screen was the last one wired, and a raw `say('...')` is invisible until a catalog exists —
  // by which time the sentence is old and nobody remembers it was skipped.
  const { readFileSync } = await import('node:fs');
  // The Timer is its own module now, so the whole file is the screen — no slice by position.
  const body = readFileSync(new URL('../lib/screens/timer.js', import.meta.url), 'utf8');
  assert.match(body, /SCREENS\.timer = \(\) => \{/, 'the Timer screen moved — find it again rather than deleting this test');
  const raw = [...body.matchAll(/say\((['"])(?!.*\$\{)([A-Z][^'"]{4,})\1\)/g)].map((m) => m[2]);
  assert.deepEqual(raw, [], `these timer sentences bypass t(): ${raw.join(' | ')}`);
});

// ── A roll that produces nothing ───────────────────────────────────────────────────────────────
//
// Rolling a scramble IS a solve (AGENTS.md, 2026-08-31), so it fails the way a solve fails — and
// both screens that press for one used to drop that failure on the floor. The Timer's handler is
// wired straight to onclick, so a rejection left the click as an unhandled promise while the
// screen sat on the old scramble saying nothing; Home's die awaited the roll outside its own
// try/catch and returned in silence when it came back empty. A press that can fail has to say so.

/** Run `fn` with the platform's cryptographic source taken away.
 *
 *  This is the app's own loud failure arriving from the one place a roll cannot work around:
 *  random-state.js draws every scramble from `crypto.getRandomValues` and refuses to fall back to
 *  Math.random(), so no entropy means no cube — which is exactly a roll that cannot answer. */
const withoutEntropy = async (fn) => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues() { throw new Error('no cryptographic source (test)'); } },
    configurable: true,
    writable: true,
  });
  try { return await fn(); } finally { Object.defineProperty(globalThis, 'crypto', real); }
};

test('the Timer says a scramble could not be rolled, and keeps the one in play', async () => {
  win.location.hash = '#/timer';
  await tick();
  const scr = () => win.document.querySelector('#scr');
  const hint = () => win.document.querySelector('#timerHint');
  assert.ok(await waitFor(() => /^[URFDLB]/.test(scr().textContent || '')), 'precondition: a scramble is on screen');

  await withoutEntropy(async () => {
    const said = () => /scramble could not be worked out/i.test(hint().textContent || '');
    // The first press may be handed the cube rolled ahead of it — there is at most one, and no
    // more can be rolled now — so it is the SECOND press that has to roll on the spot, and its
    // failure is the one this is about.
    win.document.querySelector('#newScr').click();
    await waitFor(said, 1000);
    const inPlay = scr().textContent;
    win.document.querySelector('#newScr').click();
    // The short wait above is patience BETWEEN presses — how long to give one before pressing
    // again. What the press was answered with is waited for at this file's own deadline instead,
    // because a roll can only fail once the solver has loaded, and that is 0.4–2.6 s of table
    // building on this thread: at load ~100 no per-press patience was enough and the suite went
    // red, where the same file passes 95/95 alone at load ~30 (measured 2026-09-14).
    assert.ok(await waitFor(said),
      `the press was answered with "${hint().textContent}" — and, before that, with an unhandled rejection`);
    assert.equal(scr().textContent, inPlay,
      'the scramble already in play is what a solve would be recorded against; a failed roll must not lose it');
    // And a solve timed now is filed under THAT scramble, the one on screen. The same commit gate
    // refuses an empty roll, which no seam here can produce; this is the path it shares.
    const clock = win.document.querySelector('#clock');
    clock.click();
    await tick();
    clock.click();
    await tick();
    const saved = JSON.parse(win.localStorage.getItem('cubusSolves') || '{"list":[]}').list;
    assert.equal(saved[0]?.scramble, inPlay, 'the solve was filed under a scramble that is not on screen');
  });
});

test('a scramble that works after one that failed takes the failure off the line', async () => {
  win.location.hash = '#/timer';
  await tick();
  const scr = () => win.document.querySelector('#scr');
  const hint = () => win.document.querySelector('#timerHint');
  const said = () => /scramble could not be worked out/i.test(hint().textContent || '');
  assert.ok(await waitFor(() => /^[URFDLB]/.test(scr().textContent || '')), 'precondition: a scramble is on screen');
  await withoutEntropy(async () => {
    // A press may be handed the cube rolled ahead of it, so press until one has to roll and fails.
    for (let i = 0; i < 3 && !said(); i++) {
      win.document.querySelector('#newScr').click();
      await waitFor(said, 2000);
    }
    // Patience between presses above; the failure itself waited for at this file's deadline, for
    // the reason the test before this one gives.
    assert.ok(await waitFor(said), 'precondition: the failure is on the line');
  });
  const failedBeside = scr().textContent;
  win.document.querySelector('#newScr').click();
  assert.ok(await waitFor(() => scr().textContent !== failedBeside && /^[URFDLB]/.test(scr().textContent || '')),
    'precondition: a new scramble arrived');
  assert.ok(!said(), `a fresh scramble stands beside "${hint().textContent}"`);
});

test('the die on the cube screen says a roll failed, where it says everything else', async () => {
  // The die is a developer affordance on the solve side, so Advanced has to be open for it to
  // exist at all — the same door the toggle test above uses.
  win.location.hash = '#/settings';
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  const toggle = () => win.document.querySelector('[data-toggle="devRandCube"]');
  assert.ok(toggle(), 'precondition: the die has a toggle in Advanced');
  toggle().click();
  await tick();
  try {
    await scrambledHome(); // a cube with a walk, so the screen has its status line
    // A press before the solver has loaded is ignored, and the loop below would read that as a press
    // that said nothing. The walk above implies a solver; this says so (test/fixtures/app-waits.mjs).
    await solverLoaded();
    const status = () => win.document.querySelector('#moveCount');
    assert.ok(status(), 'precondition: the solution card is on screen');
    await withoutEntropy(async () => {
      const said = () => /scramble could not be rolled/i.test(status()?.textContent || '');
      // At most one roll can be waiting ahead of the press, so the second has to roll on the
      // spot; the third press is slack for the solve the first one starts (the die is held
      // while it runs, and a press it ignores is not the press being measured).
      for (let press = 0; press < 3 && !said(); press++) {
        const die = win.document.querySelector('#randCube');
        assert.ok(die, 'precondition: the die is drawn');
        if (!die.disabled) die.click();
        await waitFor(said, 1500);
      }
      // Patience between presses above; what the press said waited for at this file's deadline,
      // for the reason the Timer's own "could not be rolled" test gives.
      assert.ok(await waitFor(said),
        `the press changed nothing and said "${status()?.textContent}" — a count still describing the previous cube`);
    });
  } finally {
    // Off through the same UI, so later tests see the default screen.
    win.location.hash = '#/settings';
    await tick();
    toggle()?.click();
    await tick();
    win.location.hash = '#/home';
    await tick();
  }
});
