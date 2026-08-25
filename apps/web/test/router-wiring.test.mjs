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
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

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
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }

  // Boots on import. loadSolver() reaches for an https: specifier, which Node refuses outright;
  // app.js already try/catches that, so the shell renders without a solver — exactly what an
  // offline launch does today.
  await import('../lib/app.js');
  await tick();
});

// The screen's name lives in the title bar chip now; there is no separate title bar of its own.
const screenTitle = () => win.document.querySelector('.titlebar .chip #title').textContent;
const activeNav = () =>
  win.document.querySelector('.nav-item.active')?.getAttribute('data-nav') ?? null;

test('boot honours a deep link instead of falling back to home', () => {
  // Timer is hidden from the sidebar by default, so there is no nav item to mark — the title bar
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
    // A hidden screen has nothing in the sidebar to highlight; it must still route and render.
    if (listed().includes(id)) assert.equal(activeNav(), id, `${id} should be the active screen`);
    const stage = win.document.querySelector('#stage .screen.active');
    assert.ok(stage, `${id} rendered no screen element`);
    assert.ok(stage.innerHTML.trim().length > 0, `${id} rendered an empty stage`);
  }

  win.removeEventListener('error', onError);
  assert.deepEqual(errors, [], 'no screen should raise while rendering');
});

// The screen name now lives only in the title bar. On Windows and Linux the Tauri build hides the
// custom bar and uses the native one, so the chip alone would leave those platforms with no screen
// name at all — the document/window title is what covers that, and it is easy to drop silently.
test('the screen name also reaches the window title, not just the drawn chip', async () => {
  win.location.hash = '#/settings';
  await tick();
  assert.equal(screenTitle(), 'Settings');
  assert.equal(win.document.title, 'Settings · Cubus');
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
    ['ghosts', 'ghost-elevation', 'camera-distance', 'camera-latitude', 'camera-longitude', 'facelet-scale']
      .map((a) => `${a}=${cube.getAttribute(a)}`),
    ['ghosts=floating', 'ghost-elevation=8', 'camera-distance=27',
     'camera-latitude=-60', 'camera-longitude=170', 'facelet-scale=0.4'],
  );
});

// The cube card carries the cube and one corner tool, and the transport is one row: four buttons,
// the progress bar, the pacing toggle if a cube is connected, and the step count. Everything else
// that used to sit there said something the chips, the animation or the nav were already saying.
test('the cube screen is the cube, one transport row, and nothing else', async () => {
  win.location.hash = '#/home';
  await tick();
  const cubeCard = win.document.querySelector('#stage .cols > .col > .card');
  // One tool over the cube, in the corner: the speed menu. Nothing else draws on top of it.
  assert.deepEqual(
    [...cubeCard.querySelectorAll('button')].map((b) => b.id),
    ['speedBtn'],
    'the cube card carries exactly one control',
  );
  for (const gone of ['#coach', '#scrub', '#validity', '#copyState', '#viewCard']) {
    assert.equal(win.document.querySelector(gone), null, `${gone} should be gone`);
  }
  // With no smart cube there is nothing to pace against, so there is no pacing control at all.
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
  assert.equal(win.document.querySelector('.transport .spacer'), null, 'the spacer is gone');
  assert.ok(win.document.querySelector('#progBar'), 'the bar has a fill element to drive');
});

// Screens that were absorbed rather than deleted: Solve guide and Playback became the cube screen,
// the cube screen then became Home, and Smart cube became a card in Settings. Those links are
// already out in the wild, and an unknown id falls back to HOME — which is silently right for
// three of them and silently WRONG for #/pair, whose controls are in Settings.
test('links to the absorbed screens land on the screen that absorbed them', async () => {
  for (const [legacy, landing] of [['guide', 'home'], ['playback', 'home'], ['viewer', 'home'], ['pair', 'settings']]) {
    win.location.hash = `#/${legacy}`;
    await tick();
    assert.equal(activeNav(), landing, `#/${legacy} must land on ${landing}`);
    assert.equal(win.location.hash, `#/${landing}`, 'and the URL is rewritten to the canonical one');
  }
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

// Connecting a smart cube is what makes pacing a choice, so the toggle appears with the cube and
// starts on. The state module is exported for exactly this kind of check.
test('the pacing toggle appears only with a smart cube, and defaults to following', async () => {
  const { state } = await import('../lib/app.js');
  assert.equal(state.connected, false, 'precondition: nothing connected');

  state.connected = true;
  try {
    win.location.hash = '#/timer';
    await tick();
    win.location.hash = '#/home'; // re-render, since the markup is built once at mount
    await tick();

    const follow = win.document.querySelector('.transport [data-mode]');
    assert.ok(follow, 'a connected cube should offer the toggle');
    assert.equal(follow.dataset.mode, 'cube');
    assert.ok(follow.classList.contains('on'), 'following is the default, not an opt-in');
    assert.equal(
      win.document.querySelectorAll('.transport [data-mode]').length,
      1,
      'one toggle, not a pair of mutually exclusive pills',
    );
  } finally {
    state.connected = false;
  }
});

// Speed went from a fixed constant to a three-way choice in the cube card's corner. The wiring sits
// ahead of the solve on purpose, so it is live even here, where there is no solver to reach.
test('the speed menu offers three speeds, defaults to normal, and drives the renderer', async () => {
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/home';
  await tick();

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
    win.location.hash = '#/timer';
    await tick();
    win.location.hash = '#/home';
    await tick();
    const cube = win.document.querySelector('#viewCube > cubus-cube');
    assert.equal(cube.getAttribute('tempo-scale'), '0.1', 'unknown id must not become a tempo');
  } finally {
    win.localStorage.removeItem('walkSpeed');
  }
});

// The state card names what it shows and carries one tool. The raw 54-character facelet string it
// used to print said nothing the net beside it was not already showing in colour.
test('the state card is the net plus a dice, and says which state it is', async () => {
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/home';
  await tick();

  const card = [...win.document.querySelectorAll('#stage .aside > .card')].at(-1);
  assert.equal(card.querySelector('.eyebrow').textContent, 'INITIAL STATE');
  assert.equal(win.document.querySelector('#viewState'), null, 'the facelet string is gone');
  assert.ok(card.querySelector('#viewNet'), 'the net stays');

  // The dice sits on the eyebrow's own line, which is what puts it level with the label.
  const dice = card.querySelector('#randCube');
  assert.ok(dice, 'random cube is still reachable');
  assert.equal(dice.parentElement.className, 'eyebrow-row');
  assert.equal(dice.parentElement.firstElementChild.className, 'eyebrow', 'label first, tool second');
  assert.equal(dice.textContent.trim(), '', 'an icon button, not a labelled one');
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
  assert.equal(win.document.querySelector('.aside .eyebrow-row .eyebrow').textContent, 'TARGET STATE');
  assert.match(win.document.querySelector('#randCube').title, /scramble/i);
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
  // CROSS/F2L/OLL/PLL are phases of a solve; pinning them here would invent structure.
  assert.deepEqual(
    [...win.document.querySelectorAll('#solList .eyebrow')].map((e) => e.textContent),
    ['SCRAMBLE'],
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
  win.location.hash = '#/home';
  await tick();
  assert.equal(win.document.querySelector('.aside .eyebrow-row .eyebrow').textContent, 'INITIAL STATE');
  assert.equal(win.document.querySelector('.card-h b').textContent, 'Solution');
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
  assert.equal(win.document.querySelector('#viewCube'), null, 'no cube card left behind');
});

// ⌃⌥⌘D reveals an Advanced section in Settings that can take the placeholder screens out of the
// sidebar. Two things here are easy to get wrong and invisible when you do: the chord must be
// matched on e.code (macOS Option rewrites e.key, so this arrives as "∂"), and a nav group whose
// every entry is hidden must not render as a bare heading over nothing.
const chord = (over = {}) =>
  new win.KeyboardEvent('keydown', {
    code: 'KeyD', key: '∂', ctrlKey: true, altKey: true, metaKey: true, bubbles: true, ...over,
  });
const navIds = () => [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
// The sidebar is one flat list now, so there are no group headings to name.
const navLabels = () => [...win.document.querySelectorAll('#nav [data-nav] .lbl')].map((e) => e.textContent);

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

  // The preference it controls IS saved, which is the distinction being drawn.
  win.document.querySelector('[data-nav-toggle="drill"]').click();
  await tick();
  assert.match(win.localStorage.getItem('cubusSettings') ?? '', /navHidden.*drill/);

  // Put it back through the UI: clearing localStorage alone would leave the in-memory settings
  // holding a hidden entry, and the next test would see a sidebar it did not ask for.
  win.document.querySelector('[data-nav-toggle="drill"]').click();
  await tick();
  assert.ok([...win.document.querySelectorAll('#nav [data-nav]')].some((b) => b.dataset.nav === 'drill'));
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

test('hiding an entry removes it from the sidebar, and the rest is untouched', async () => {
  win.location.hash = '#/settings';
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  assert.ok(navIds().includes('lessons'), 'precondition: Lessons is listed');

  win.document.querySelector('[data-nav-toggle="lessons"]').click();
  await tick();
  assert.ok(!navIds().includes('lessons'), 'gone from the sidebar');
  assert.ok(navIds().includes('settings'), 'and its neighbours are untouched');

  // All three at once.
  for (const id of ['trainer', 'drill']) win.document.querySelector(`[data-nav-toggle="${id}"]`).click();
  await tick();
  assert.deepEqual(navIds().filter((i) => ['trainer', 'drill', 'lessons'].includes(i)), []);

  // Hiding is cosmetic: the address still works, which is the escape hatch.
  win.location.hash = '#/lessons';
  await tick();
  assert.ok(win.document.querySelector('#stage .screen'), 'a hidden screen is still reachable');

  // Restore through the UI, not by wiping localStorage. `settings` is a live module-level object:
  // clearing storage leaves it holding the hidden ids, so every later test in this file inherits a
  // sidebar with three entries missing. That is exactly what it did before this comment existed.
  win.location.hash = '#/settings';
  await tick();
  for (const id of ['lessons', 'trainer', 'drill']) {
    win.document.querySelector(`[data-nav-toggle="${id}"]`).click();
    await tick();
  }
  assert.deepEqual(
    ['trainer', 'drill', 'lessons'].filter((i) => !navIds().includes(i)),
    [],
    'every entry is back before the next test runs',
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
  win.location.hash = '#/home';
  await tick();
  assert.ok(win.document.querySelector('#viewCube'), 'Home renders the cube');
  assert.ok(win.document.querySelector('.transport'), 'and its transport');
  assert.ok(!win.document.querySelector('#scanCta'), 'the old landing-page call to action is gone');
});

test('the sidebar no longer offers 3D viewer or Smart cube, and Stats is renamed', async () => {
  win.location.hash = '#/home';
  await tick();
  const ids = [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
  assert.ok(!ids.includes('viewer'), 'the cube screen is reached as Home');
  assert.ok(!ids.includes('pair'), 'smart cube lives in Settings');
  // Stats is hidden by default now (it shows representative numbers, not yours), so what matters
  // is that when it IS shown it carries the shorter name.
  assert.ok(!ids.includes('stats'), 'Stats is hidden by default');
  const labels = [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.textContent);
  assert.ok(!labels.some((l) => l.includes('Session stats')), 'and it is not called Session stats');
  // Nothing groups the list any more, so there is no heading left over to point at a screen that
  // no longer exists.
  assert.equal(win.document.querySelector('#nav .nav-group'), null, 'the sidebar is one flat list');
  assert.equal(win.document.querySelector('#nav .eyebrow'), null, 'and carries no section titles');
});

test('Stats carries the content Home used to, and Settings carries the pairing controls', async () => {
  // The premise has to be stated. Stats used to show a fabricated session to everyone, so its
  // cards appeared whether or not anything had been solved; an empty session now reads as empty,
  // and this test is about the cards, so it needs solves to exist.
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [{ n: 1, time: '19.02', scramble: "R U' F2", tps: '5.9', moves: 40, at: Date.now() }],
  }));
  try {
    win.location.hash = '#/stats';
    await tick();
    const text = win.document.querySelector('#stage').textContent;
    // ALG MASTERY and PICK UP WHERE YOU LEFT OFF are gone, and deliberately: both were hardcoded
    // progress figures for tracking that does not exist. What replaced them is measured or absent.
    for (const moved of ['SINGLE BEST', 'AO5', 'Recent solves', 'WEEK', 'AVERAGES']) {
      assert.ok(text.includes(moved), `Stats should carry "${moved}"`);
    }

    // .v and .d are declared as `.stat .v` / `.stat .d`, so the headline numbers are unstyled
    // without the class. There is no layout engine here to notice that, hence the direct check.
    const headline = [...win.document.querySelectorAll('#stage .card')].filter((c) => c.querySelector('.v'));
    assert.equal(headline.length, 3, 'three headline cards');
    for (const c of headline) assert.ok(c.classList.contains('stat'), '.v needs a .stat ancestor to be styled');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }

  win.location.hash = '#/settings';
  await tick();
  assert.ok(win.document.querySelector('#stage').textContent.includes('SMART CUBE'));
  const pair = win.document.querySelector('#pairBtn');
  assert.ok(pair, 'the pair button moved across');
  assert.equal(typeof pair.onclick, 'function', 'and its handler came with it, not just its markup');
  assert.ok(win.document.querySelector('#macIn'), 'the MAC field is here while disconnected');
});

// The permanent "No smart cube" box in the sidebar said the same thing on every screen forever,
// including the whole time you are not using a cube. It is replaced by an indicator that appears
// beside the cube only while one is actually connected.
test('the sidebar no longer carries a permanent connection box', async () => {
  win.location.hash = '#/home';
  await tick();
  assert.equal(win.document.querySelector('#cubeStatus'), null);
  assert.equal(win.document.querySelector('#cubeStatusLabel'), null);
  assert.equal(win.document.querySelector('.cube-status'), null);
});

test('a connected cube shows an indicator ahead of the speed button, and nothing when not', async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/home';
  await tick();
  const ind = win.document.querySelector('#cubeLive');
  assert.ok(ind, 'the indicator is in the markup');
  assert.equal(ind.hidden, true, 'but hidden with no cube connected');

  // It must sit BEFORE the speed button — the tools row reads status first, then controls.
  const tools = [...win.document.querySelector('.card-tools').children].map((el) => el.id);
  assert.deepEqual(tools, ['cubeLive', 'speedBtn']);

  state.connected = true;
  state.cubeName = 'GAN-test';
  try {
    win.location.hash = '#/timer';
    await tick();
    win.location.hash = '#/home';
    await tick();
    const on = win.document.querySelector('#cubeLive');
    assert.equal(on.hidden, false, 'shown once a cube is connected');
    assert.match(on.title, /GAN-test/, 'and it names the cube');

    // THREE states, not two. "Connected" and "we know what this cube looks like" are different
    // claims, and an indicator that collapses them back into on/off is the exact bug the trust
    // model exists to prevent — it would show a confident glyph over a cube whose position we
    // cannot vouch for.
    //
    // Connected-but-stale is the default on arrival: pairing establishes nothing. So this walks
    // trusted -> stale, which also pins that losing trust repaints the glyph IN PLACE rather than
    // waiting for a re-render that a user mid-solve will never trigger.
    state.cube.trusted = true;
    win.location.hash = '#/timer';
    await tick();
    win.location.hash = '#/home';
    await tick();
    const trusted = win.document.querySelector('#cubeLive');
    assert.equal(trusted.classList.contains('stale'), false, 'trusted: no stale marking');
    assert.match(trusted.title, /tracking/, 'and it says the chain is intact');

    win.cubusFeed.gap({ missing: 2, from: 4, to: 7 });
    await tick();
    assert.equal(trusted.classList.contains('stale'), true, 'stale: marked in place, not hidden');
    assert.match(trusted.title, /went unrecorded/, 'and it says WHY, so the fix is obvious');
    assert.equal(trusted.hidden, false, 'a stale cube is still a connected cube');
  } finally {
    state.connected = false;
    state.cubeName = '';
    state.cube.trusted = false;
    state.cube.staleWhy = '';
  }
});

// The sidebar was three labelled sections over nine items. Flattened, every page sits at the top
// level in one list — so the thing to pin is that nothing was lost in the flattening and no
// heading survived it.
test('the sidebar is one flat list of every page, with no section titles', async () => {
  win.location.hash = '#/home';
  await tick();
  // The default sidebar is the beginner's path. Timer and Stats are speedcubing instruments and
  // start hidden; Alg trainer, Drill and Lessons remain listed.
  assert.deepEqual(navLabels(), [
    'Home', 'Restore', 'Scramble', 'Alg trainer', 'Drill', 'Lessons', 'Settings',
  ]);
  assert.equal(win.document.querySelector('#nav .nav-group'), null, 'no grouping wrapper');
  assert.equal(win.document.querySelector('#nav .eyebrow'), null, 'no SOLVE / PRACTICE / LEARN');
  // Every child of #nav is a page button — nothing else lives in there now.
  const kinds = [...win.document.querySelector('#nav').children].map((el) => el.tagName);
  assert.deepEqual([...new Set(kinds)], ['BUTTON']);
});

// The smart-cube card's confusion was that it asked for a Bluetooth address without saying why, in
// a build that already knows it, and put the step-3 action somewhere other than step 3.
test('the smart cube card only asks for an address where one is actually needed', async () => {
  win.location.hash = '#/settings';
  await tick();

  // happy-dom has no navigator.bluetooth, which is the "this browser cannot" branch.
  assert.equal(win.navigator.bluetooth, undefined, 'precondition: no Web Bluetooth here');
  const note = win.document.querySelector('#btNote');
  assert.match(note.textContent, /cannot use Bluetooth/i, 'it says so instead of offering a dead button');
  assert.equal(win.document.querySelector('#pairBtn').disabled, true, 'and Pair is not offered');
  assert.equal(
    win.document.querySelector('#macRow').hidden, true,
    'no point asking for an address when pairing cannot happen at all',
  );

  // The address field explains itself rather than being a bare box labelled "cube MAC (macOS)".
  const row = win.document.querySelector('#macRow').textContent;
  assert.match(row, /encrypts/i, 'it says what the address is for');
  assert.match(row, /GAN app/i, 'and where to find it');
});

test('the setup steps carry their own action', async () => {
  win.location.hash = '#/settings';
  await tick();
  const steps = [...win.document.querySelectorAll('.card')]
    .find((c) => c.textContent.includes('SMART CUBE'))
    .textContent;
  assert.match(steps, /Turn the cube/);
  assert.match(steps, /Solve it once/);
  // "Anchor solved state" was jargon parked away from the step it completes.
  assert.ok(!steps.includes('Anchor solved state'), 'the jargon label is gone');
});

// ---- Follow cube -------------------------------------------------------------------------
//
// Exercised on the SCRAMBLE screen, because that is the one that mounts completely here: it needs
// only cubejs to build its moves, while the solve path needs cubing.js and bails early. The state
// machine under test is the same one either way.
//
// What these pin is the bug that made the feature feel broken: it listened to ~1Hz facelet
// snapshots alone, so turns made inside a second produced no state to match, and `at` (the
// ANIMATION position, up to 3.8s behind) was used as the cursor — so a second turn compared
// against the wrong index and, once the cube ran two ahead, nothing could ever match again.

const feed = () => win.cubusFeed;
const followSetup = async (state) => {
  state.connected = true;
  state.cubeName = 'GAN-test';
  // Following requires a TRUSTED cube, not merely a connected one: the move stream is in the
  // cube's own frame, so following an unverified cube advances the guide on turns that may not be
  // the ones being made. A real user reaches this by scanning or by confirming the cube's report.
  state.cube.trusted = true;
  state.cube.source = 'cube';
  state.cube.staleWhy = '';
  // A scramble walk starts from a SOLVED cube, so following one requires the cube in your hand to
  // actually be solved. Saying "connected and trusted" without saying what it looks like is not
  // enough, and deliberately so — that gap is what let a solved cube complete a random solve.
  state.live = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
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

test('a turn advances the guide immediately, without waiting for the animation', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    assert.ok(moves.length > 2, 'precondition: a scramble was generated');
    assert.ok(win.document.querySelector('[data-mode="cube"]')?.classList.contains('on'));

    // Two turns back to back — faster than any animation could finish. Under the old wiring the
    // second was dropped, because `at` had not moved yet.
    feed().move({ notation: moves[0], serial: 1 });
    feed().move({ notation: moves[1], serial: 2 });
    assert.equal(win.document.querySelector('#followNote').hidden, true, 'both turns were accepted');
  } finally {
    state.connected = false; state.cubeName = '';
  }
});

test('a turn that is not the next move says so instead of going quiet', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    const wrong = moves[0].startsWith('U') ? 'R' : 'U';
    feed().move({ notation: wrong, serial: 1 });
    const note = win.document.querySelector('#followNote');
    assert.equal(note.hidden, false, 'the guide must not just ignore it');
    assert.match(win.document.querySelector('#followMsg').textContent, new RegExp(wrong));
    assert.match(win.document.querySelector('#followMsg').textContent, /next move is/);
    assert.ok(win.document.querySelector('#resolveBtn'), 'and offers a way out');
  } finally {
    state.connected = false; state.cubeName = '';
  }
});

test('a missed-move gap is reported, not mistaken for a wrong turn', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    feed().gap({ missing: 2, from: 4, to: 7 });
    assert.equal(win.document.querySelector('#followNote').hidden, false);
    assert.match(win.document.querySelector('#followMsg').textContent, /Missed 2 turns/);
  } finally {
    state.connected = false; state.cubeName = '';
  }
});

test('a snapshot from off the plan is named, and clears once the cube rejoins', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    // A REAL cube that is simply not on the plan. The old fixture was SOLVED.replace('R','F') —
    // eight R and ten F, an arrangement no cube can hold. It only behaved like an off-plan
    // snapshot because nothing validated cube reports; now that they are validated it is rejected
    // as unreadable, which is a different thing and a different message.
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
    const offPlan = (() => { const c = new Cube(); c.move("R U F' D2 L"); return c.asString(); })();
    assert.notEqual(offPlan, SOLVED_FACELETS, 'precondition: a real cube, and not the start');
    assert.ok(moves.length > 0);
    feed().facelets(offPlan);
    assert.equal(win.document.querySelector('#followNote').hidden, false, 'off-plan is surfaced');

    // Turning back onto a state the plan knows must recover, rather than stalling forever.
    feed().facelets('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
    assert.equal(win.document.querySelector('#followNote').hidden, true, 'it rejoins on its own');
  } finally {
    state.connected = false; state.cubeName = '';
  }
});

// The off-track note lives at the FOOT OF THE SOLUTION CARD, and that placement is the fix, not a
// preference. In the transport row, showing it changed that card's height, which resized the cube
// card above it — so every stray turn made the whole page flash. In the solution card it takes its
// space from #solList, which is `flex:1` and scrolls, and the aside is a separate column from the
// cube. Measured at the time: showing it changes ONLY #solList's height (477px -> 395px); the cube
// card, the canvas, the transport and the card's own box are all unchanged to the pixel.
test('the off-track note sits in the solution card, not in the transport', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    const note = win.document.querySelector('#followNote');
    assert.ok(note, 'the note is in the markup');

    const card = note.closest('.card');
    assert.ok(card, 'it is inside a card');
    assert.ok(card.contains(win.document.querySelector('#solList')), 'that card is the solution card');
    assert.equal(card.contains(win.document.querySelector('.transport')), false, 'and not the transport card');

    // It must be the LAST child, or it would push the list around from the middle.
    assert.equal(card.lastElementChild, note, 'it is the foot of the card');

    // The list has to be the thing that gives up the space.
    const listCls = win.document.querySelector('#solList').className;
    assert.match(listCls, /\blist\b/, '#solList must keep the .list class that makes it flex:1 and scroll');
  } finally {
    state.connected = false; state.cubeName = '';
  }
});

// Timer and Stats are speedcubing instruments, not part of learning to solve a cube — and Stats
// still shows representative numbers rather than yours, which is worse than showing nothing. They
// start hidden and are one chord away. Hiding stays cosmetic: the routes keep working.
test('Timer and Stats start hidden, but remain reachable and re-showable', async () => {
  win.location.hash = '#/home';
  await tick();
  const ids = () => [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
  assert.ok(!ids().includes('timer'), 'Timer is not in the default sidebar');
  assert.ok(!ids().includes('stats'), 'Stats is not in the default sidebar');

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

// ---- Battery -----------------------------------------------------------------------------
//
// This used to report a hardcoded 78% for every cube forever. That is worse than showing nothing:
// a flat battery is what disconnects a cube mid-solve, and a mid-solve disconnect is what silently
// desyncs its tracking from the cube in your hand. The number has to be the cube's own.
const settingsWithCube = async (state, level, anchored = true) => {
  win.cubusFeed.useConnection({ requestBattery: async () => (level === null ? {} : { level }) });
  state.anchored = anchored;
  win.location.hash = '#/home';
  await tick();
  win.location.hash = '#/settings';
  await tick();
  await new Promise((r) => setTimeout(r, 60));
};

test('the battery meter shows the cube its own level, and warns when it is low', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await settingsWithCube(state, 84);
    assert.ok(win.document.querySelector('#battMeter'), 'a meter is drawn');
    assert.match(win.document.querySelector('#battMeter').textContent, /84%/);
    assert.ok(!win.document.querySelector('#stage').textContent.includes('Battery low'));

    await settingsWithCube(state, 12);
    assert.match(win.document.querySelector('#battMeter').textContent, /12%/);
    // The warning has to say what it COSTS, not just that it is low.
    const txt = win.document.querySelector('#stage').textContent;
    assert.match(txt, /Battery low/);
    assert.match(txt, /stops counting turns/, 'it explains the consequence');
  } finally {
    win.cubusFeed.useConnection(null);
  }
});

// TWO ways a battery read can fail, and they take different code paths: the cube answers without a
// level, or the request throws outright. Testing only the first left the catch free to invent a
// number — a mutation putting `state.battery = 50` there passed until this covered both.
test('a cube that will not answer its battery says unknown rather than guessing', async () => {
  const { state } = await import('../lib/app.js');
  try {
    // (a) answers, but with no level in it
    await settingsWithCube(state, null);
    assert.equal(win.document.querySelector('#battMeter'), null, 'no fictional meter is drawn');
    assert.ok(win.document.querySelector('#battRefresh'), 'and there is a way to ask again');
    assert.equal(state.battery, null);

    // (b) the request itself fails
    win.cubusFeed.useConnection({ requestBattery: async () => { throw new Error('timeout'); } });
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/settings';
    await tick();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(state.battery, null, 'a failed read must not become a number');
    assert.equal(win.document.querySelector('#battMeter'), null);
  } finally {
    win.cubusFeed.useConnection(null);
  }
});

// The setup steps are instructions, not a permanent status board. Once every step is done they are
// three ticks occupying a third of the card and telling the user nothing they cannot already see.
test('the setup checklist collapses once the cube is set up', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await settingsWithCube(state, 84, false);
    assert.match(win.document.querySelector('#stage').textContent, /Turn the cube/, 'steps show while incomplete');

    await settingsWithCube(state, 84, true);
    const txt = win.document.querySelector('#stage').textContent;
    assert.ok(!txt.includes('Turn the cube'), 'and go once they are all done');
    assert.match(txt, /Set up and tracking/);
    assert.ok(win.document.querySelector('#anchorBtn'), 're-marking stays reachable');
  } finally {
    win.cubusFeed.useConnection(null);
    state.anchored = false;
  }
});

// ---- Trust -------------------------------------------------------------------------------
//
// "Connected" and "we know what this cube looks like" are different claims, and conflating them is
// the bug this models away. A cube reports how far it has been turned since it was last told where
// it was; disconnect it, turn it, reconnect, and it reports a state that is confidently wrong.
test('trust is established by evidence, not by pairing', async () => {
  const { state } = await import('../lib/app.js');
  // Start from no knowledge explicitly. Earlier tests establish trust legitimately, and a test
  // whose premise depends on running first is a test that will lie the day someone reorders them.
  state.cube.trusted = false;
  state.cube.source = 'none';
  try {
    win.cubusFeed.useConnection({ requestBattery: async () => ({ level: 90 }) });
    assert.equal(state.cube.trusted, false, 'pairing alone establishes nothing');

    // A generated cube is known by construction — and is NOT the cube in your hand. Those are
    // different claims, and calling this one 'camera' was the bug that let a solved physical cube
    // instantly complete a random solve.
    win.location.hash = '#/home';
    await tick();
    win.document.querySelector('#randCube')?.click();
    await tick();
    assert.equal(state.cube.trusted, true, 'we know exactly what it is');
    assert.equal(state.cube.source, 'generated');
    assert.equal(state.cube.isPhysical, false, 'but it is not the cube you are holding');
  } finally {
    win.cubusFeed.useConnection(null);
  }
});

test('a missed turn breaks trust and stops following', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    assert.ok(moves.length > 0);
    assert.ok(state.cube.trusted, 'precondition: trusted');
    assert.ok(win.document.querySelector('[data-mode="cube"]').classList.contains('on'));

    win.cubusFeed.gap({ missing: 3, from: 4, to: 8 });
    assert.equal(state.cube.trusted, false, 'turns we never saw means we no longer know the cube');
    assert.match(state.cube.staleWhy, /3 turns went unrecorded/);
    assert.equal(
      win.document.querySelector('[data-mode="cube"]').classList.contains('on'), false,
      'and following stops rather than tracking a cube it cannot vouch for',
    );
  } finally {
    state.connected = false; state.cubeName = '';
    state.cube.trusted = false; state.cube.staleWhy = '';
  }
});

test('following will not start on a connected-but-unverified cube', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    state.cube.trusted = false;
    state.cube.staleWhy = 'it disconnected';
    win.location.hash = '#/timer';
    await tick();
    win.location.hash = '#/scramble';
    await tick();
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && win.document.querySelectorAll('#solList .chip-m').length === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const toggle = win.document.querySelector('[data-mode="cube"]');
    assert.ok(toggle, 'the toggle is still offered');
    assert.equal(toggle.disabled, true, 'but it cannot be switched on');
    assert.match(toggle.title, /Read the cube first/);
  } finally {
    state.connected = false; state.cubeName = '';
    state.cube.trusted = false; state.cube.staleWhy = '';
  }
});

// Following and the manual transport were two drivers for one guide. While both were live the step
// counter tracked the ANIMATION rather than the cube — press Next twice by hand, make one real
// turn, and it read 2 / 22 with one turn made. The number whose whole job is to say where your
// cube is was saying where the drawing had got to. One rule: touching the transport takes over.
test('using the transport hands control back, so only one thing drives the guide', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    const toggle = win.document.querySelector('[data-mode="cube"]');
    assert.ok(toggle.classList.contains('on'), 'following is on by default with a trusted cube');

    win.document.querySelector('#nextBtn').click();
    assert.equal(toggle.classList.contains('on'), false, 'Next hands control over');
    assert.match(toggle.title, /click to let the cube drive again/, 'and says how to give it back');

    // And it is one click to resume, which is why taking over costs nothing.
    toggle.click();
    assert.ok(toggle.classList.contains('on'));
    assert.match(toggle.title, /keeps up/);
  } finally {
    state.connected = false; state.cubeName = '';
    state.cube.trusted = false; state.cube.staleWhy = '';
  }
});

test('every manual control hands control back, not just Next', async () => {
  const { state } = await import('../lib/app.js');
  const toggle = () => win.document.querySelector('[data-mode="cube"]');
  for (const id of ['#playBtn', '#prevBtn', '#repeatBtn']) {
    try {
      await followSetup(state);
      assert.ok(toggle().classList.contains('on'), `precondition for ${id}`);
      // Back and Repeat are disabled at step 0, and there is no way to advance past it here: the
      // renderer never upgrades under happy-dom, so cube.step() is a no-op and the step index
      // stays put. The disabled gating has its own test; this one is about the handler, so enable
      // the button and exercise it directly rather than asserting a click that cannot land.
      const btn = win.document.querySelector(id);
      btn.disabled = false;
      btn.click();
      assert.equal(toggle().classList.contains('on'), false, `${id} must take over too`);
    } finally {
      state.connected = false; state.cubeName = '';
      state.cube.trusted = false; state.cube.staleWhy = '';
    }
  }

  // Jumping to a move is taking over just as much as pressing Next is.
  await followSetup(state);
  try {
    assert.ok(toggle().classList.contains('on'));
    win.document.querySelector('#solList .chip-m').click();
    assert.equal(toggle().classList.contains('on'), false, 'clicking a move takes over');
  } finally {
    state.connected = false; state.cubeName = '';
    state.cube.trusted = false; state.cube.staleWhy = '';
  }
});

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
test('a generated cube is not followed, however solved the real one is', async () => {
  const { state } = await import('../lib/app.js');
  const SOLVED = SOLVED_FACELETS;
  try {
    win.cubusFeed.useConnection({ requestBattery: async () => ({ level: 88 }) });
    state.cube.trusted = true;
    state.cube.staleWhy = '';
    state.live = SOLVED;                      // the cube in your hand is solved

    win.location.hash = '#/timer';
    await tick();
    win.location.hash = '#/home';
    await tick();
    win.document.querySelector('#randCube').click();
    await tick();
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && win.document.querySelectorAll('#solList .chip-m').length === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const total = win.document.querySelectorAll('#solList .chip-m').length;
    assert.ok(total > 0, 'a solution was worked out');
    assert.equal(win.document.querySelector('#stepLbl').textContent, `0 / ${total}`);

    const toggle = win.document.querySelector('[data-mode="cube"]');
    assert.equal(toggle.disabled, true, 'following a cube you are not holding is refused');
    assert.match(toggle.title, /not the cube in your hand/);

    // The real cube reporting itself — once a second, in life — must change nothing here.
    const subject = state.cube.facelets;
    assert.notEqual(subject, SOLVED, 'precondition: the guide is about a different cube');
    win.cubusFeed.facelets(SOLVED);
    await tick();
    // The snapshot is recorded as what the CUBE looks like, and must not become what the GUIDE is
    // about. One variable used to answer both, so a second later the random cube you asked for had
    // silently been replaced by the one on your desk.
    assert.equal(state.live, SOLVED, 'what the cube says is recorded');
    assert.equal(state.cube.facelets, subject, 'but the guide is still about the cube you asked for');
    assert.equal(
      win.document.querySelector('#stepLbl').textContent, `0 / ${total}`,
      'a solved physical cube must not complete a solve it never performed',
    );
    assert.equal(win.document.querySelector('#doneMark').hidden, true);
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.live = null;
  }
});

// A gap used to be routed only through the cube screen's handler, which exists only while a
// solution is being walked. So a missed turn that arrived while you were in Settings — or on Home
// with a solved cube, where there is nothing to walk — was dropped on the floor, and the next
// screen you opened showed a confident tracking glyph over a cube nobody could vouch for.
test('a missed turn breaks trust even with no solution on screen to notice it', async () => {
  const { state } = await import('../lib/app.js');
  try {
    state.connected = true;
    state.cubeName = 'GAN-test';
    state.cube.trusted = true;
    state.cube.staleWhy = '';

    // Settings has no walk, no move stream handler, and no reason to care — which is the point.
    win.location.hash = '#/settings';
    await tick();
    win.cubusFeed.gap({ missing: 3, from: 4, to: 8 });
    await tick();

    assert.equal(state.cube.trusted, false, 'trust lapses wherever the user happens to be');
    assert.match(state.cube.staleWhy, /3 turns went unrecorded/, 'and it records what happened');
  } finally {
    state.connected = false; state.cubeName = '';
    state.cube.trusted = false; state.cube.staleWhy = '';
  }
});

// Two requirements from the plan's Risks section, which are directives rather than observations.
test('the repair scan says what it will cost, not just what it buys', async () => {
  const { state } = await import('../lib/app.js');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  try {
    win.cubusFeed.useConnection({
      requestBattery: async () => ({ level: 50 }),
      getState: async () => ({ facelets: new Cube().asString() }),
    }, CUBE_A);
    state.cube.trusted = false;
    state.cube.staleWhy = 'it disconnected, and may have been turned since';
    state.cube.facelets = (() => { const c = new Cube(); c.move('R U'); return c.asString(); })();

    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/scan';
    await tick();
    await new Promise((r) => setTimeout(r, 40));

    const text = win.document.querySelector('#scanHow').textContent;
    assert.match(text, /not have to solve it first/, 'what the scan buys');
    // A cube that just reconnected is plausibly close to solved, and that is exactly where six
    // face photographs do not determine the cube. Inheriting that cost silently would make the
    // scanner look broken at the moment it is working hardest.
    assert.match(text, /close to solved is the hardest/, 'and what it may cost');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.cube.staleWhy = ''; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('the browser Bluetooth limitation is explained once, where it can be acted on', async () => {
  win.localStorage.removeItem('cubusCubes');
  win.cubusFeed.useConnection(null);
  // happy-dom has no Web Bluetooth, so the pair button is correctly disabled and this whole path
  // is unreachable without a stand-in. Scoped to this test and removed afterwards — leaving it
  // defined would silently flip the address-field branch for every test that follows.
  Object.defineProperty(win.navigator, 'bluetooth', {
    value: { getAvailability: async () => true }, configurable: true,
  });
  try {
  // Home first. Setting the hash to a screen you are already on fires no hashchange and re-renders
  // nothing, so the stub above would not be picked up — the test then passed alone and failed in
  // the suite depending on where the previous test happened to leave the router.
  win.location.hash = '#/home';
  await tick();
  win.location.hash = '#/settings';
  await tick();

  // Forget every remembered cube through the UI. Clearing localStorage is not enough — the
  // registry is held in memory too, and a leftover address from an earlier test means Pair has
  // something to try, so the empty-address refusal is never reached. (That fallback is correct
  // behaviour; it just is not what this test is about.)
  for (let guard = 0; guard < 10; guard++) {
    const forget = win.document.querySelector('[data-forget-cube]');
    if (!forget) break;
    forget.click();
    forget.click();
    await tick();
  }
  assert.equal(win.document.querySelector('[data-forget-cube]'), null, 'no cube is remembered');

  assert.ok(
    win.document.querySelector('#macIn'),
    'the field exists, which is where something can actually be done about it',
  );
  const blurb = win.document.querySelector('#stage').textContent;
  assert.match(blurb, /will not reveal it/, 'and the reason sits with the field');

  // Now press Pair with the field empty — the path that used to say the same thing again, two
  // seconds after the user had just read it. The refusal must point at the field, not re-argue.
  win.document.querySelector('#pairBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const msg = win.document.querySelector('#pairMsg').textContent;
  // That this arrives at all is the other half. doConnect's failure path calls setConnected(false),
  // which re-rendered Settings and discarded the node this message was about to be written into —
  // so pressing Pair with an empty field used to produce silence.
  assert.notEqual(msg, '', 'the refusal reaches the screen rather than a discarded copy of it');
  assert.match(msg, /address/, 'it says what is missing');
  assert.ok(!/macOS|browser|reveal/.test(msg), `the refusal re-explains the limitation: ${msg}`);
  } finally {
    delete win.navigator.bluetooth;
    win.location.hash = '#/home';
    await tick();
  }
});

test('a connection update that changes nothing leaves Settings standing', async () => {
  const { state } = await import('../lib/app.js');
  try {
    win.cubusFeed.useConnection(null);
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/settings';
    await tick();
    const before = win.document.querySelector('#pairBtn');
    assert.ok(before);

    // setConnected(false) while already disconnected. This used to re-render unconditionally,
    // which tore the DOM out from under whatever was mid-flight — that is how doConnect's error
    // message ended up written into a discarded copy of the screen and shown to nobody.
    win.cubusFeed.useConnection(null);
    await tick();
    assert.equal(
      win.document.querySelector('#pairBtn'), before,
      'the screen was rebuilt for a change that did not happen',
    );

    // And a real change still repaints, or the guard would have bought silence instead.
    win.cubusFeed.useConnection(fakeCube(), CUBE_A);
    await tick();
    assert.notEqual(win.document.querySelector('#pairBtn'), before, 'a real change still redraws');
    assert.match(win.document.querySelector('#stage').textContent, /Disconnect/);
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

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
    // Turn rate comes only from the two solves a cube measured; the hand-timed one is left out
    // rather than estimated. 40 turns in 10s is the best of them.
    assert.ok(text.includes('best of 2 cube-timed'));
    assert.ok(text.includes('4.0'), 'the best turn rate is measured, not averaged into existence');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

test('with no cube-timed solves, Stats offers to measure rather than estimating', async () => {
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [{ n: 1, time: '20.00', scramble: 'R U', tps: '', moves: 0, at: Date.now() }],
  }));
  try {
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/stats';
    await tick();
    const text = win.document.querySelector('#stage').textContent;
    assert.match(text, /connect a cube to measure/, 'the turn rate is absent, and says why');
    assert.match(text, /nothing honest to show without one/);
    assert.ok(text.includes('20.00'), 'while the times that DO exist are still shown');
  } finally {
    win.localStorage.removeItem('cubusSolves');
  }
});

// ---- Timer, driven by the cube ---------------------------------------------------------------
//
// The number stops being an estimate of when a thumb moved and becomes what the cube reports. The
// hard part is telling "applying the scramble" apart from "starting the solve" — both are just
// turns — which is why it arms on the exact arrangement the scramble was meant to produce.
const openTimer = async (state, { connected, trusted }) => {
  if (connected) win.cubusFeed.useConnection(fakeCube(), CUBE_A);
  else win.cubusFeed.useConnection(null);
  state.cube.trusted = trusted;
  win.location.hash = '#/home';
  await tick();
  win.location.hash = '#/timer';
  await tick();
  // Wait for a REAL scramble. "solver loading…" also contains a space, so a naive check passed
  // instantly and every assertion below then ran against a timer with no target to arm on.
  // Wait for a REAL scramble. "solver loading…" also contains a space, so a naive space check
  // passed instantly and every assertion below then ran against a timer with no target to arm on.
  //
  // Just wait — the screen retries for itself once the solver lands. Clicking New scramble in this
  // loop ran a fresh Kociemba search every 100 ms and buried the event loop.
  //
  // The budget is generous because building the Kociemba tables is the slowest thing in the suite
  // and it competes with whatever else is on the machine; at 25 s this failed roughly one run in
  // ten under load. If it is ever hit for real, the message says which of the two things went
  // wrong rather than leaving a bare precondition failure to interpret.
  const t0 = Date.now();
  const scr = () => win.document.querySelector('#scr').textContent.trim();
  while (Date.now() - t0 < 60000 && !/^[URFDLB]['2]?( |$)/.test(scr())) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(
    scr(), /^[URFDLB]['2]?( |$)/,
    `no scramble after ${Math.round((Date.now() - t0) / 1000)}s — the screen still says ${JSON.stringify(scr())}`,
  );
};
/** The arrangement the shown scramble is meant to produce, from a solved cube. */
const scrambleTarget = async () => {
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const c = new Cube();
  c.move(win.document.querySelector('#scr').textContent);
  return c.asString();
};

test('a trusted cube times the solve itself: no spacebar, and a real turn count', async () => {
  const { state } = await import('../lib/app.js');
  win.localStorage.removeItem('cubusSolves');
  try {
    await openTimer(state, { connected: true, trusted: true });
    const hint = () => win.document.querySelector('#timerHint').textContent;
    assert.match(hint(), /Apply the scramble/, 'it says what it is waiting for');

    // Turns made while SETTING UP must not start the clock — that was the whole difficulty.
    win.cubusFeed.move({ notation: 'R', serial: 1 });
    await tick();
    assert.match(hint(), /Apply the scramble/, 'setup turns do not start it');

    // Nor do the arrangements the cube passes THROUGH on the way. Half-applied scrambles are
    // reported once a second, and arming on any of them would mean the clock starts on a turn
    // that is still setup — the exact confusion this design exists to avoid.
    const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
    const partway = new Cube(); partway.move("R U'");
    assert.notEqual(partway.asString(), await scrambleTarget(), 'precondition: not the target');
    win.cubusFeed.facelets(partway.asString());
    await tick();
    assert.match(hint(), /Apply the scramble/, 'a state that is not the target does not arm it');

    // The cube reaches exactly what the scramble asked for. Now, and only now, it is ready.
    win.cubusFeed.facelets(await scrambleTarget());
    await tick();
    assert.match(hint(), /Ready — turn to start/);

    win.cubusFeed.move({ notation: 'U', serial: 2 });
    await tick();
    assert.match(hint(), /stops when your cube is solved/, 'the first real turn starts it');

    for (const n of ['R', 'F', "L'"]) win.cubusFeed.move({ notation: n, serial: 9 });
    await new Promise((r) => setTimeout(r, 20));
    win.cubusFeed.facelets(SOLVED_FACELETS);
    await tick();

    assert.match(hint(), /New scramble to go again/, 'reaching solved ends it, with no keypress');
    const solves = JSON.parse(win.localStorage.getItem('cubusSolves')).list;
    assert.equal(solves.length, 1, 'and the solve was recorded');
    assert.equal(solves[0].moves, 4, 'with the turns the cube actually reported');
    // The rate is DERIVED from moves and time rather than stored beside them, so a half-written or
    // hand-edited record cannot show a figure that disagrees with its own numbers. Asserted where
    // the user sees it.
    assert.equal(solves[0].tps, undefined, 'the derived field is not persisted');
    assert.match(win.document.querySelector('#lastFive').textContent, /[\d.]+ tps/, 'and it is shown');
  } finally {
    win.location.hash = '#/home';   // leaving cancels the clock's animation loop
    await tick();
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusSolves');
    win.localStorage.removeItem('cubusCubes');
  }
});

test('the manual timer keeps working with a cube attached — the floor never rises', async () => {
  const { state } = await import('../lib/app.js');
  win.localStorage.removeItem('cubusSolves');
  try {
    await openTimer(state, { connected: true, trusted: true });
    win.document.querySelector('#clock').click();
    await tick();
    assert.match(win.document.querySelector('#timerHint').textContent, /Running/);
    win.document.querySelector('#clock').click();
    await tick();
    const solves = JSON.parse(win.localStorage.getItem('cubusSolves')).list;
    assert.equal(solves.length, 1, 'a hand-timed solve still records');
    assert.equal(solves[0].moves, 0, 'with no turn count, because nothing counted turns');
    assert.ok(
      !/tps/.test(win.document.querySelector('#lastFive').textContent),
      'and it claims no turn rate it did not measure',
    );
  } finally {
    win.location.hash = '#/home';   // leaving cancels the clock's animation loop
    await tick();
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusSolves');
    win.localStorage.removeItem('cubusCubes');
  }
});

test('an untrusted cube does not drive the timer', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await openTimer(state, { connected: true, trusted: false });
    // Stopping on "solved" from a cube whose position we cannot vouch for would record a time for
    // a solve that may not have happened. Manual only, and the hint says so.
    assert.match(win.document.querySelector('#timerHint').textContent, /Click or hold space/);
    win.cubusFeed.facelets(await scrambleTarget());
    win.cubusFeed.move({ notation: 'U', serial: 1 });
    await tick();
    assert.match(win.document.querySelector('#timerHint').textContent, /Click or hold space/, 'still not running');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

// ---- Read from the cube ----------------------------------------------------------------------
//
// The payoff: with a trusted cube the eight-second camera dance disappears. The button's real job
// is naming the SUBJECT — a guide can be about a generated scramble, a cube scanned ten minutes
// ago, or the one in your hand, and there was no way to say "never mind all that, this one".
const homeWithCube = async (state, { trusted, reports, staleWhy = 'it disconnected' }) => {
  win.cubusFeed.useConnection({
    requestBattery: async () => ({ level: 50 }),
    getState: async () => ({ facelets: reports }),
  }, CUBE_A);
  state.cube.trusted = trusted;
  state.cube.staleWhy = trusted ? '' : staleWhy;
  win.location.hash = '#/timer';
  await tick();
  win.location.hash = '#/home';
  await tick();
};

test('reading a trusted cube adopts it in place, with no navigation and no camera', async () => {
  const { state } = await import('../lib/app.js');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const at = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };
  try {
    const mine = at("R U F2 L'");
    // The guide starts out about something that is NOT the cube in your hand.
    state.cube.facelets = at("D2 B");
    state.cube.isPhysical = false;
    await homeWithCube(state, { trusted: true, reports: mine });

    const btn = win.document.querySelector('#readCubeBtn');
    assert.ok(btn, 'the control is there whenever a cube is paired');
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(state.cube.facelets, mine, 'the guide is now about the cube in your hand');
    assert.equal(state.cube.isPhysical, true, 'and it knows that');
    assert.equal(win.location.hash, '#/home', 'no navigation — it happens where you are');
    assert.equal(win.document.querySelector('ai-scan-panel'), null, 'and no camera was opened');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.cube.isPhysical = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('reading a stale cube refuses, says why, and offers the repair', async () => {
  const { state } = await import('../lib/app.js');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const at = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };
  try {
    const subject = at("D2 B");
    state.cube.facelets = subject;
    state.cube.isPhysical = false;
    await homeWithCube(state, {
      trusted: false, reports: at("R U"), staleWhy: 'it disconnected, and may have been turned since',
    });

    win.document.querySelector('#readCubeBtn').click();
    await new Promise((r) => setTimeout(r, 30));

    // Quietly adopting a position nobody can vouch for is the whole failure this models away.
    assert.equal(state.cube.facelets, subject, 'nothing was adopted');

    const note = win.document.querySelector('#readNote');
    assert.equal(note.hidden, false, 'it says something rather than doing nothing');
    const text = win.document.querySelector('#readMsg').textContent;
    assert.match(text, /may have been turned since/, 'it says WHY, using the recorded reason');
    assert.match(text, /not have to solve it/, 'and what the fix costs — the wall this design removes');
    assert.equal(
      win.document.querySelector('#readScanBtn').hidden, false,
      'and the repair is one click away, not a instruction to go and find it',
    );

    win.document.querySelector('#readScanBtn').click();
    await tick();
    assert.equal(win.location.hash, '#/scan', 'which takes you to the camera');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.cube.isPhysical = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('with no cube paired there is no read control at all', async () => {
  win.location.hash = '#/home';
  await tick();
  assert.equal(win.document.querySelector('#readCubeBtn'), null);
  assert.equal(win.document.querySelector('#readNote'), null, 'and no note waiting to be shown');
});

test('a cube that will not answer the read says so instead of freezing', async () => {
  const { state } = await import('../lib/app.js');
  try {
    win.cubusFeed.useConnection({
      requestBattery: async () => ({ level: 50 }),
      getState: async () => { throw new Error('timeout'); },
    }, CUBE_A);
    state.cube.trusted = true;
    win.location.hash = '#/timer';
    await tick();
    win.location.hash = '#/home';
    await tick();

    const btn = win.document.querySelector('#readCubeBtn');
    btn.click();
    await new Promise((r) => setTimeout(r, 30));

    assert.match(win.document.querySelector('#readMsg').textContent, /did not answer/);
    assert.equal(btn.disabled, false, 'and the button is usable again');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

// ---- The tracking offset ---------------------------------------------------------------------
//
// cube-trust.test.mjs proves the maths. These prove it is WIRED — that the correction is derived
// where it should be, thrown away where it must be, and kept where throwing it away would cost
// the user a scan for nothing. A perfect module nothing calls is this branch's recurring bug.
const cubeTrust = async () => (await import(new URL('../lib/cube-trust.js', import.meta.url).href));

// Any non-identity correction will do for the lifecycle tests — they are about when it is kept
// and when it is thrown away, not about what it computes. cube-trust.test.mjs owns the maths.
const SOME_OFFSET = 'RRRRRRRRRUUUUUUUUUFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/** Finish a camera scan the way the scanner element does — the real listener, not a seam. */
const scanComplete = (facelets) =>
  win.document.querySelector('ai-scan-panel')
    .dispatchEvent(new win.CustomEvent('scan-complete', { detail: { facelets, valid: true } }));

/** A connected cube reporting `reported`, with the app already trusting nothing. */
const connectedAt = async (reported) => {
  win.cubusFeed.useConnection(fakeCube(), CUBE_A);
  win.cubusFeed.facelets(reported);
  await tick();
};

test('a scan while connected repairs tracking; the same scan alone does not', async () => {
  const { state } = await import('../lib/app.js');
  const { applyOffset } = await cubeTrust();
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const at = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };
  try {
    // The cube counted "R U" and then missed "F2" while disconnected. It reports the first;
    // the camera sees the truth.
    const reported = at("R U");
    const scanned = at("R U F2");

    await connectedAt(reported);
    assert.equal(state.cube.offset, null, 'precondition: nothing corrected yet');

    win.location.hash = '#/scan';
    await tick();
    scanComplete(scanned);
    await tick();

    assert.ok(state.cube.offset, 'one camera reading is enough — no solving involved');
    // And it is a correction that keeps working, which is the whole claim.
    const later = at("R U D'");            // the cube counts one more turn
    const truth = at("R U F2 D'");         // where it physically is  -- NOT equal to `later`
    assert.notEqual(later, truth, 'precondition: the raw report is wrong');
    assert.equal(applyOffset(state.cube.offset, later, Cube), truth, 'and the correction fixes it');

    // Now the same scan with no cube attached: there is nothing to correct, and inventing a
    // correction against a cube that is not there would be worse than doing nothing.
    win.cubusFeed.useConnection(null);
    state.cube.offset = null;
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/scan';
    await tick();
    scanComplete(scanned);
    await tick();
    assert.equal(state.cube.offset, null, 'no cube, no correction');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('the correction is applied to every later report, at one place', async () => {
  const { state } = await import('../lib/app.js');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const at = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };
  try {
    const reported = at("R U");
    const scanned = at("R U F2");
    await connectedAt(reported);
    win.location.hash = '#/scan';
    await tick();
    scanComplete(scanned);
    await tick();

    // A raw report arrives from the cube. What the rest of the app sees must be the TRUTH, and
    // nothing downstream should have to know a correction exists.
    win.cubusFeed.facelets(at("R U D'"));
    await tick();
    assert.equal(state.live, at("R U F2 D'"), 'state.live is corrected, not raw');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('a scan that contradicts a TRUSTED cube changes nothing, and says why', async () => {
  const { state } = await import('../lib/app.js');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const at = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };
  try {
    await connectedAt(at("R U"));
    state.cube.trusted = true;   // an unbroken chain: the two MUST agree
    state.cube.staleWhy = '';
    const subject = state.cube.facelets;
    const sourceBefore = state.cube.source;

    win.location.hash = '#/scan';
    await tick();
    scanComplete(at("R U F2"));
    await tick();

    // Deriving a correction from a contradiction bakes the mistake in permanently. Which of the
    // two is wrong is not knowable; that there is a problem is, and that is the useful half.
    assert.equal(state.cube.offset, null, 'no correction derived from a contradiction');
    assert.match(
      win.document.querySelector('#scanHow').textContent, /not what your cube is reporting/,
      'and the screen says so rather than going quiet',
    );
    // The WHOLE transition, not just the correction. The screen said "nothing was changed" while
    // the contradictory scan was adopted and marked trusted and physical — so the one sentence the
    // user had to go on was false.
    assert.equal(state.cube.facelets, subject, 'the contradictory reading was not adopted');
    assert.equal(state.cube.source, sourceBefore, 'and did not become the thing we trust');
    assert.equal(state.cube.trusted, false, 'trust drops, because one of the two is wrong');
    assert.match(state.cube.staleWhy, /disagreed/, 'and the reason is recorded');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('disconnect throws the correction away; a missed turn keeps it', async () => {
  const { state } = await import('../lib/app.js');
  try {
    // A gap means moves were MISSED, not that the reference moved. The offset is still the right
    // relationship — what was lost is the moves in between — so discarding it would cost the user
    // a second scan for nothing.
    win.cubusFeed.useConnection(fakeCube(), CUBE_A);
    state.cube.offset = SOME_OFFSET;
    state.cube.offsetAt = 111;
    state.cube.trusted = true;

    win.cubusFeed.gap({ missing: 2, from: 4, to: 7 });
    await tick();
    assert.equal(state.cube.trusted, false, 'trust drops');
    assert.ok(state.cube.offset, 'but the correction survives — a scan would re-earn it for free');

    // A disconnect is different: across it the cube may sleep, reset its counters, or be turned.
    // Keeping the offset would apply yesterday's correction to today's readings.
    win.cubusFeed.disconnect();
    await tick();
    assert.equal(state.cube.offset, null, 'the correction dies with the connection');
    assert.equal(state.cube.offsetAt, 0);
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('the correction is visible in Settings, and resetting it does not restore trust', async () => {
  const { state } = await import('../lib/app.js');
  try {
    win.cubusFeed.useConnection(fakeCube(), CUBE_A);
    state.cube.offset = SOME_OFFSET;
    state.cube.offsetAt = new Date(2026, 0, 1, 14, 32).getTime();
    state.cube.trusted = true;
    await openSettings();

    // Silent correction is on the "what we should not build" list: an offset from a bad scan makes
    // everything subtly wrong, and with nothing on screen to explain it the app is haunted.
    const card = win.document.querySelector('#stage').textContent;
    assert.match(card, /Tracking corrected/);
    assert.match(card, /14:32/, 'and it says when, so a bad scan can be traced to it');

    win.document.querySelector('#offsetReset').click();
    await tick();
    assert.equal(state.cube.offset, null, 'reset clears it');
    assert.equal(
      state.cube.trusted, false,
      'and trust goes with it — the correction was the only thing making the readings true',
    );
    assert.match(state.cube.staleWhy, /correction was reset/, 'the reason is recorded, not implied');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.cube.staleWhy = ''; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('a correction survives a gap and a second scan, instead of erasing itself', async () => {
  const { state } = await import('../lib/app.js');
  const { applyOffset } = await cubeTrust();
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const at = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };
  try {
    // The cube counted "R U" and missed "F2" while nobody was watching.
    const raw = at('R U');
    const truth = at('R U F2');
    await connectedAt(raw);
    win.location.hash = '#/scan';
    await tick();
    scanComplete(truth);
    await tick();
    const first = state.cube.offset;
    assert.ok(first, 'precondition: a correction exists');

    // A gap KEEPS the correction — the moves were missed, the reference did not move.
    win.cubusFeed.gap({ missing: 1, from: 4, to: 6 });
    await tick();
    assert.equal(state.cube.offset, first, 'precondition: the gap kept it');

    // Now scan again. The repair must derive from what the cube SAID, not from what the app has
    // already corrected it to — those are different values whenever a correction is active, and
    // deriving against the corrected one yields the identity. The correction that made the reading
    // look right would then delete itself, and every later report would silently be wrong.
    win.cubusFeed.facelets(raw);
    await tick();
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/scan';
    await tick();
    scanComplete(truth);
    await tick();

    assert.ok(state.cube.offset, 'the correction is still there');
    assert.equal(state.cube.offset, first, 'and it is the same one, not the identity');
    assert.equal(
      applyOffset(state.cube.offset, at("R U D'"), Cube), at("R U F2 D'"),
      'so later reports are still corrected',
    );
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.live = null; state.reported = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('the Disconnect button clears trust and the correction, like any other disconnect', async () => {
  const { state } = await import('../lib/app.js');
  try {
    win.cubusFeed.useConnection(fakeCube(), CUBE_A);
    state.cube.offset = SOME_OFFSET;
    state.cube.offsetAt = 111;
    state.cube.trusted = true;
    await openSettings();

    // The web transport removes its own disconnect listener before disconnecting, so the driver's
    // event never fires on this path. It called setConnected(false) directly, which left a cube
    // the user had deliberately let go still marked trusted with its correction alive.
    win.document.querySelector('#pairBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(state.connected, false);
    assert.equal(state.cube.trusted, false, 'a deliberate disconnect still ends the chain');
    assert.equal(state.cube.offset, null, 'and takes the correction with it');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('a new connection inherits nothing from the last one', async () => {
  const { state } = await import('../lib/app.js');
  try {
    // A camera scan of one cube left the app trusted and holding a report. Pairing a DIFFERENT
    // cube used to keep both, so the new cube was treated as verified on the strength of a reading
    // of the old one — and a repair would derive its correction from the wrong cube's report.
    win.cubusFeed.useConnection(fakeCube(), CUBE_A);
    state.cube.trusted = true;
    state.live = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
    state.reported = state.live;
    state.cube.offset = SOME_OFFSET;

    win.cubusFeed.useConnection(fakeCube(), CUBE_B);
    await tick();

    assert.equal(state.cube.trusted, false, 'pairing establishes nothing');
    assert.match(state.cube.staleWhy, /just connected/, 'and says so');
    assert.equal(state.live, null, 'no report carried over');
    assert.equal(state.reported, null);
    assert.equal(state.cube.offset, null, 'and no correction from a different cube');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.trusted = false;
    state.live = null; state.reported = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('a hostile solve history cannot inject markup into Timer or Stats', async () => {
  // cubusSolves is written by anything on the origin and editable by hand. Both screens
  // interpolated persisted fields straight into innerHTML.
  const payload = '<img src=x onerror="globalThis.__pwned = true">';
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [{ n: payload, time: payload, scramble: payload, tps: payload, moves: payload, at: Date.now() }],
  }));
  try {
    for (const screen of ['#/timer', '#/stats']) {
      win.location.hash = '#/home';
      await tick();
      win.location.hash = screen;
      await tick();
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(
        win.document.querySelector('#stage img'), null,
        `${screen} rendered stored markup as an element`,
      );
      assert.equal(globalThis.__pwned, undefined);
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

test('scanning a cube that has already been repaired is not a contradiction', async () => {
  const { state } = await import('../lib/app.js');
  const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url).href)).default;
  const at = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };
  try {
    // Repair once, so a correction is active.
    const raw = at('R U');
    const truth = at('R U F2');
    await connectedAt(raw);
    win.location.hash = '#/scan';
    await tick();
    scanComplete(truth);
    await tick();
    assert.ok(state.cube.offset, 'precondition: a correction is active');
    state.cube.trusted = true;
    state.cube.staleWhy = '';

    // Now scan the same cube again, correctly. "Does the camera agree with where the cube IS" is a
    // question about CORRECTED truth; the raw report deliberately differs from it whenever a
    // correction exists. Comparing the scan against the raw report meant that repairing a cube
    // once made every later scan of it look like a contradiction — the fix for one bug creating a
    // worse one, on the exact path it was meant to protect.
    win.cubusFeed.facelets(raw);
    await tick();
    win.location.hash = '#/home';
    await tick();
    win.location.hash = '#/scan';
    await tick();
    scanComplete(truth);
    await tick();

    assert.ok(
      !/not what your cube is reporting/.test(win.document.querySelector('#scanHow').textContent),
      'a correct scan of a repaired cube is not called a contradiction',
    );
    assert.equal(state.cube.facelets, truth, 'and it is adopted');
    assert.equal(state.cube.trusted, true, 'and trust survives');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.live = null; state.reported = null;
    win.localStorage.removeItem('cubusCubes');
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

test('a refused anchor shows its refusal instead of throwing', async () => {
  const { state } = await import('../lib/app.js');
  try {
    // anchorSolved() refuses when the cube does not report itself solved, and that refusal is the
    // point: it is what teaches the user why. Declaring the connection token INSIDE the try meant
    // the catch referenced an undeclared binding, so every refusal became a ReferenceError and the
    // user saw nothing at all.
    win.cubusFeed.useConnection({
      requestBattery: async () => ({ level: 50 }),
      anchorSolved: async () => { throw new Error('refusing to anchor: the cube is not solved'); },
    }, CUBE_A);
    state.cube.trusted = true;
    state.cube.offset = SOME_OFFSET;
    await openSettings();

    win.document.querySelector('#anchorBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));

    assert.match(win.document.querySelector('#pairMsg').textContent, /not solved/, 'the refusal is shown');
    assert.equal(win.document.querySelector('#anchorForceBtn')?.hidden, false, 'and the way through is offered');
    // Anchoring moves the cube's own solved reference, so trust and the correction go first. If it
    // then fails, the cube is left honestly untrusted rather than confidently wrong.
    assert.equal(state.cube.offset, null, 'the correction was dropped');
    assert.equal(state.cube.trusted, false, 'and trust went with it');
    assert.equal(state.anchored, false);
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.offset = null; state.cube.offsetAt = 0;
    state.cube.trusted = false; state.anchored = false; state.live = null;
    win.localStorage.removeItem('cubusCubes');
  }
});

test('a turn rate is never fabricated from a time that is not a number', async () => {
  // TWO ways this goes wrong, and they take different guards. A decimal long enough to parse as
  // Infinity is caught on the way in; a vanishingly small one is not — it is finite and positive,
  // and 40 divided by it is Infinity on the way out. A finite input does not guarantee a finite
  // result, and testing only the first left the second guard unexercised.
  const huge = `${'9'.repeat(400)}.0`;
  const tiny = `0.${'0'.repeat(320)}1`;
  win.localStorage.setItem('cubusSolves', JSON.stringify({
    list: [
      { n: 2, time: huge, scramble: 'R U', moves: 40, at: Date.now() },
      { n: 1, time: tiny, scramble: 'R U', moves: 40, at: Date.now() },
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
    }
  } finally {
    win.localStorage.removeItem('cubusSolves');
    win.location.hash = '#/home';
    await tick();
  }
});

// ---- Cube identity ---------------------------------------------------------------------------
//
// The app used to keep exactly ONE cube address and overwrite it on every connect, so pairing a
// second cube destroyed the first. A browser on macOS will not read the address back off the cube,
// which made that unrecoverable rather than merely annoying. These drive the real Settings screen,
// because the registry passing its own unit tests while nothing calls it is the failure that
// three separate bundle-staleness bugs on this branch already taught.
const CUBE_A = 'AA:BB:CC:DD:EE:FF';
const CUBE_B = '11:22:33:44:55:66';
const fakeCube = () => ({ requestBattery: async () => ({ level: 50 }) });
const listedCubes = () =>
  [...win.document.querySelectorAll('[data-forget-cube]')].map((b) => b.dataset.forgetCube).sort();
const storedCubes = () => Object.keys(JSON.parse(win.localStorage.getItem('cubusCubes') || '{}')).sort();

const openSettings = async () => {
  win.location.hash = '#/home';
  await tick();
  win.location.hash = '#/settings';
  await tick();
};

test('pairing a second cube leaves the first one listed and stored', async () => {
  win.localStorage.removeItem('cubusCubes');
  try {
    win.cubusFeed.useConnection(fakeCube(), CUBE_A);
    win.cubusFeed.useConnection(null);
    win.cubusFeed.useConnection(fakeCube(), CUBE_B);
    await openSettings();

    assert.deepEqual(listedCubes(), [CUBE_B, CUBE_A].sort(), 'both cubes are on screen');
    assert.deepEqual(storedCubes(), [CUBE_B, CUBE_A].sort(), 'and both survive to storage');
  } finally {
    win.cubusFeed.useConnection(null);
    win.localStorage.removeItem('cubusCubes');
  }
});

test('a nickname is stored, shown, and used wherever the cube is named', async () => {
  win.localStorage.removeItem('cubusCubes');
  try {
    win.cubusFeed.useConnection(fakeCube(), CUBE_A);
    await openSettings();

    const field = win.document.querySelector(`[data-rename-cube="${CUBE_A}"]`);
    assert.ok(field, 'the row is editable in place — no dialog');
    field.value = 'The green one';
    field.dispatchEvent(new win.Event('change'));
    await tick();

    assert.equal(JSON.parse(win.localStorage.getItem('cubusCubes'))[CUBE_A].nickname, 'The green one');

    await openSettings();
    assert.match(
      win.document.querySelector('#stage').textContent, /The green one · live/,
      'the card header uses your word for the cube, not the device name',
    );
  } finally {
    win.cubusFeed.useConnection(null);
    win.localStorage.removeItem('cubusCubes');
  }
});

test('forgetting a cube takes two clicks, and removes only that cube', async () => {
  win.localStorage.removeItem('cubusCubes');
  try {
    win.cubusFeed.useConnection(fakeCube(), CUBE_A);
    win.cubusFeed.useConnection(null);
    win.cubusFeed.useConnection(fakeCube(), CUBE_B);
    win.cubusFeed.useConnection(null);
    await openSettings();

    const btn = win.document.querySelector(`[data-forget-cube="${CUBE_A}"]`);
    btn.click();
    await tick();
    // One click must not destroy it: on macOS a browser cannot get the address back, so this is
    // the only control here that loses something the app cannot re-derive.
    assert.deepEqual(storedCubes(), [CUBE_B, CUBE_A].sort(), 'the first click only arms it');
    assert.match(btn.textContent, /Really forget/, 'and it says so');

    btn.click();
    await tick();
    assert.deepEqual(storedCubes(), [CUBE_B], 'the second click forgets exactly one cube');
    assert.deepEqual(listedCubes(), [CUBE_B], 'and the screen agrees');
  } finally {
    win.cubusFeed.useConnection(null);
    win.localStorage.removeItem('cubusCubes');
  }
});

test('a remembered address is what a bare Pair reaches for', async () => {
  win.localStorage.removeItem('cubusCubes');
  try {
    win.cubusFeed.useConnection(fakeCube(), CUBE_B);
    win.cubusFeed.useConnection(null);
    await openSettings();

    // The address field is an ADD field once cubes are known. Prefilling it with a cube already
    // listed above invited pairing a duplicate of the row you were looking at.
    const macIn = win.document.querySelector('#macIn');
    assert.equal(macIn?.value, '', 'the add-another field starts empty');
    assert.ok(
      win.document.querySelector(`[data-use-cube="${CUBE_B}"]`),
      'and the remembered cube is reachable from its own row instead',
    );
  } finally {
    win.localStorage.removeItem('cubusCubes');
  }
});
