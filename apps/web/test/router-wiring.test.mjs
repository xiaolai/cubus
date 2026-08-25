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
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent', 'requestAnimationFrame',
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
  assert.equal(activeNav(), 'timer', 'nav should mark the deep-linked screen');
  assert.equal(screenTitle(), 'Timer');
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

  for (const id of SCREENS) {
    win.location.hash = `#/${id}`;
    await tick();
    assert.equal(activeNav(), id, `${id} should be the active screen`);
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
  win.location.hash = '#/timer'; // leave immediately, while the cube mount is still awaiting
  await tick();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(win.document.querySelector('.nav-item.active')?.dataset.nav, 'timer');
  assert.ok(win.document.querySelector('#clock'), 'the timer screen is the one mounted');
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
    ['trainer', 'drill', 'lessons'],
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
  const labels = [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.textContent);
  assert.ok(labels.some((l) => l.includes('Stats')), 'Stats is present');
  assert.ok(!labels.some((l) => l.includes('Session stats')), 'and no longer called Session stats');
  // Nothing groups the list any more, so there is no heading left over to point at a screen that
  // no longer exists.
  assert.equal(win.document.querySelector('#nav .nav-group'), null, 'the sidebar is one flat list');
  assert.equal(win.document.querySelector('#nav .eyebrow'), null, 'and carries no section titles');
});

test('Stats carries the content Home used to, and Settings carries the pairing controls', async () => {
  win.location.hash = '#/stats';
  await tick();
  const text = win.document.querySelector('#stage').textContent;
  for (const moved of ['SINGLE BEST', 'ALG MASTERY', 'Recent solves', 'PICK UP WHERE YOU LEFT OFF', 'WEEK']) {
    assert.ok(text.includes(moved), `Stats should carry "${moved}" from the old Home`);
  }

  // .v and .d are declared as `.stat .v` / `.stat .d`, so the headline numbers are unstyled
  // without the class. There is no layout engine here to notice that, hence the direct check.
  const headline = [...win.document.querySelectorAll('#stage .card')].filter((c) => c.querySelector('.v'));
  assert.equal(headline.length, 3, 'three headline cards');
  for (const c of headline) assert.ok(c.classList.contains('stat'), '.v needs a .stat ancestor to be styled');

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
  } finally {
    state.connected = false;
    state.cubeName = '';
  }
});

// The sidebar was three labelled sections over nine items. Flattened, every page sits at the top
// level in one list — so the thing to pin is that nothing was lost in the flattening and no
// heading survived it.
test('the sidebar is one flat list of every page, with no section titles', async () => {
  win.location.hash = '#/home';
  await tick();
  assert.deepEqual(navLabels(), [
    'Home', 'Restore', 'Scramble', 'Timer', 'Stats', 'Alg trainer', 'Drill', 'Lessons', 'Settings',
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
