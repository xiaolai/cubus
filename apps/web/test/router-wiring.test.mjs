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
  assert.equal(win.document.querySelector('#title'), null, 'the title chip is gone; the tab is the name');
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
  assert.equal(win.document.querySelector('.transport .spacer'), null, 'the spacer is gone');
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

// `#/pair` was the smart-cube pairing screen, and it used to redirect to Settings because the
// pairing card moved there. Settings no longer says anything about a cube, so an old bookmark
// landing there would find nothing it came for — better to treat it as the unknown route it now
// is and fall through to Home.
test('the pairing route is not aliased anywhere, it simply no longer exists', async () => {
  win.location.hash = '#/pair';
  await tick();
  // It is an unknown route now, and unknown routes render Home. (The URL is left alone — the
  // router only rewrites hashes it recognises as aliases. That is pre-existing behaviour and the
  // same for any typo.)
  assert.equal(activeNav(), 'home', 'an unknown route falls back to Home');
  assert.ok(win.document.querySelector('#viewCube'), 'and Home actually mounted');
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

  // The state card leads the aside — the arrangement you are looking at, above the moves that
  // change it — and the move list follows.
  const cards = [...win.document.querySelectorAll('#stage .aside > .card')];
  const card = cards[0];
  assert.equal(card.querySelector('.state-h').textContent, 'Initial State');
  assert.ok(cards[1]?.querySelector('#solList'), 'the move list comes second');
  assert.equal(win.document.querySelector('#viewState'), null, 'the facelet string is gone');
  assert.ok(card.querySelector('#viewNet'), 'the net stays');

  // The dice is a developer shortcut on this side of the screen — it loads a random cube that is
  // NOT the one in anyone's hand — so by default it is not rendered at all. The Advanced toggle
  // brings it back (tested with the other Advanced toggles below); Scramble keeps its own die.
  assert.equal(card.querySelector('#randCube'), null, 'no dev die on the solve side by default');
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
  win.location.hash = '#/home';
  await tick();
  assert.equal(win.document.querySelector('.aside .eyebrow-row .state-h').textContent, 'Initial State');
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
// toolbar. Two things here are easy to get wrong and invisible when you do: the chord must be
// matched on e.code (macOS Option rewrites e.key, so this arrives as "∂"), and a nav group whose
// every entry is hidden must not render as a bare heading over nothing.
const chord = (over = {}) =>
  new win.KeyboardEvent('keydown', {
    code: 'KeyD', key: '∂', ctrlKey: true, altKey: true, metaKey: true, bubbles: true, ...over,
  });
const navIds = () => [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
// The toolbar is one flat row of tabs, so there are no group headings to name.
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
  // holding a hidden entry, and the next test would see a toolbar it did not ask for.
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

// The About card: the app's mark, then a short table — version, website, author — each row led
// by an inline icon from the app's own set (there is no icon library to need; the paths in `P`
// are drawn by hand). The links are real anchors: the old card printed "cubus.im" as dead text.
test('the About card states version, website and author, with real links', async () => {
  win.location.hash = '#/settings';
  await tick();
  const { VERSION } = await import('../lib/app.js');
  const card = [...win.document.querySelectorAll('#stage .card')]
    .find((c) => c.querySelector('.eyebrow')?.textContent === 'ABOUT');
  assert.ok(card, 'the About card exists');
  assert.ok(card.querySelector('.about-brand img[src="./icons/icon.svg"]'), 'led by the app mark');
  assert.equal(card.querySelector('.about-brand b').textContent, 'Cubus');
  const rows = [...card.querySelectorAll('.about-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.k').textContent), ['Version', 'Website', 'Author']);
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
  const cargo = readFileSync(at('../../desktop/src-tauri/Cargo.toml'), 'utf8');
  assert.match(cargo, new RegExp(`^version = "${VERSION.replace(/\./g, '\\.')}"$`, 'm'),
    'the desktop crate version');
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
  assert.equal(win.document.querySelector('#randCube'), null, 'and gone again');
  win.localStorage.removeItem('cubusSettings');
});

test('hiding an entry removes it from the toolbar, and the rest is untouched', async () => {
  win.location.hash = '#/settings';
  await tick();
  win.document.dispatchEvent(chord());
  await tick();
  assert.ok(navIds().includes('lessons'), 'precondition: Lessons is listed');

  win.document.querySelector('[data-nav-toggle="lessons"]').click();
  await tick();
  assert.ok(!navIds().includes('lessons'), 'gone from the toolbar');
  assert.deepEqual(navIds(), ['home', 'scan', 'scramble', 'trainer', 'drill'], 'and its neighbours are untouched');

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
  // toolbar with three entries missing. That is exactly what it did before this comment existed.
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

test('the toolbar no longer offers 3D viewer or Smart cube, and Stats is renamed', async () => {
  win.location.hash = '#/home';
  await tick();
  const ids = [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.dataset.nav);
  assert.ok(!ids.includes('viewer'), 'the cube screen is reached as Home');
  assert.ok(!ids.includes('pair'), 'there is no pairing screen');
  // Stats is hidden by default now (it shows representative numbers, not yours), so what matters
  // is that when it IS shown it carries the shorter name.
  assert.ok(!ids.includes('stats'), 'Stats is hidden by default');
  const labels = [...win.document.querySelectorAll('#nav [data-nav]')].map((b) => b.textContent);
  assert.ok(!labels.some((l) => l.includes('Session stats')), 'and it is not called Session stats');
  // Nothing groups the list any more, so there is no heading left over to point at a screen that
  // no longer exists.
  assert.equal(win.document.querySelector('#nav .nav-group'), null, 'the tab row is flat');
  assert.equal(win.document.querySelector('#nav .eyebrow'), null, 'and carries no section titles');
});


// The permanent status box in the old leading pane said the same thing on every screen forever,
// including the whole time you are not using a cube. It is replaced by an indicator that appears
// beside the cube only while one is actually connected.
test('the shell no longer carries a permanent connection box', async () => {
  win.location.hash = '#/home';
  await tick();
  assert.equal(win.document.querySelector('#cubeStatus'), null);
  assert.equal(win.document.querySelector('#cubeStatusLabel'), null);
  assert.equal(win.document.querySelector('.cube-status'), null);
});


// The nav was three labelled sections over nine items in a leading pane. It is one flat row of
// tabs in the title bar now, with Settings as the bar's trailing button — so the things to pin are
// that nothing was lost in the flattening, that no heading survived it, and that Settings is
// reachable from the bar without being a tab.
test('the toolbar is one flat row of tabs, with Settings as its own button', async () => {
  win.location.hash = '#/home';
  await tick();
  // The default row is the beginner's path. Timer and Stats are speedcubing instruments and
  // start hidden; Alg trainer, Drill and Lessons remain listed.
  assert.deepEqual(navLabels(), [
    'Home', 'Restore', 'Scramble', 'Alg trainer', 'Drill', 'Lessons',
  ]);
  assert.equal(win.document.querySelector('#nav .nav-group'), null, 'no grouping wrapper');
  assert.equal(win.document.querySelector('#nav .eyebrow'), null, 'no SOLVE / PRACTICE / LEARN');
  // Every child of #nav is a page button — nothing else lives in there now.
  const kinds = [...win.document.querySelector('#nav').children].map((el) => el.tagName);
  assert.deepEqual([...new Set(kinds)], ['BUTTON']);
  // Settings: in the trailing zone, not in the row, and it navigates.
  const gear = win.document.querySelector('#tbTrail [data-nav="settings"]');
  assert.ok(gear, 'Settings is the trailing toolbar button');
  assert.equal(win.document.querySelector('#nav [data-nav="settings"]'), null, 'and not a tab');
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
      assert.equal(stage.querySelector('img'), null, `${screen} rendered stored markup as an element`);
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






// ---- Follow cube (recovered from v0, extended with move-driven Previous) --------------------
//
// Exercised on the SCRAAMBLE-free scramble screen, because it mounts completely here: it needs
// only cubejs to build its moves, while the solve path needs cubing.js and bails early. What
// these pin is the bug that made v0's feature feel broken — listening to ~1Hz snapshots alone
// and cursoring off `at` (the ANIMATION position) dropped any second turn made inside a second.

const feed = () => win.cubusFeed;

/** Put the cube model back the way a fresh boot leaves it. The helpers below mutate connection,
 *  trust, live and reported state — anything not reset here leaks into whatever test runs next. */
const resetCubeModel = (state) => {
  win.cubusFeed.useConnection(null);
  state.connected = false;
  state.cubeName = '';
  state.cube.trusted = false;
  state.cube.source = 'none';
  state.cube.staleWhy = '';
  state.cube.isPhysical = false;
  state.cube.offset = null;
  state.cube.offsetAt = 0;
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
    assert.equal(win.document.querySelector('[data-mode="cube"]'), null,
      'no cube, no toggle — a switch with one position');
    const moves = await followSetup(state);
    assert.ok(moves.length > 2, 'precondition: a scramble was generated');
    const btn = win.document.querySelector('[data-mode="cube"]');
    assert.ok(btn, 'connected: the toggle exists');
    assert.ok(btn.classList.contains('on'), 'and following is the default');
    assert.ok(!btn.disabled);
  } finally { resetCubeModel(state); }
});

test('a turn advances the guide immediately, without waiting for the animation', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    assert.ok(moves.length > 2, 'precondition: a scramble was generated');
    // Two turns back to back — faster than any animation could finish. Under the old wiring the
    // second was dropped, because the cursor had not moved yet.
    feed().move({ notation: moves[0], serial: 1 });
    feed().move({ notation: moves[1], serial: 2 });
    assert.equal(win.document.querySelector('#followNote').hidden, true, 'neither was refused');
    // And the cursor really moved: a deliberately wrong third turn names move 3 as the expected
    // one. Without this, both move() calls could be no-ops and the test still passed.
    const wrong = moves[2].startsWith('U') ? 'R' : 'U';
    feed().move({ notation: wrong, serial: 3 });
    const note = win.document.querySelector('#followNote');
    assert.equal(note.hidden, false, 'a wrong turn is surfaced');
    assert.ok(win.document.querySelector('#followMsg').textContent.includes(`the next move is ${moves[2]}`),
      `the guide is waiting on move 3 (${moves[2]}), so the first two were taken`);
  } finally { resetCubeModel(state); }
});

// The extension this branch exists for: the cube drives BOTH transport directions. Undoing the
// move you just made is pressing Previous — immediately, not a second later when a snapshot
// happens to notice (which is all v0 had, and it felt like the guide stopped listening).
test('undoing the last move steps the guide back, like pressing Previous', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    assert.ok(moves.length > 1);
    const inv = (m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`);
    feed().move({ notation: moves[0], serial: 1 });
    assert.equal(win.document.querySelector('#followNote').hidden, true);
    feed().move({ notation: inv(moves[0]), serial: 2 });
    assert.equal(win.document.querySelector('#followNote').hidden, true, 'the undo was accepted');
    // The cursor is back at 0: a wrong move now names move 1 as the expected one again.
    const wrong = moves[0].startsWith('U') ? 'R' : 'U';
    feed().move({ notation: wrong, serial: 3 });
    assert.ok(win.document.querySelector('#followMsg').textContent.includes(`the next move is ${moves[0]}`),
      'after the undo, the guide expects the first move again');
  } finally { resetCubeModel(state); }
});

test('a wrong turn says so instead of going quiet, and offers a way out', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const moves = await followSetup(state);
    const wrong = moves[0].startsWith('U') ? 'R' : 'U';
    feed().move({ notation: wrong, serial: 1 });
    const note = win.document.querySelector('#followNote');
    assert.equal(note.hidden, false);
    assert.ok(win.document.querySelector('#followMsg').textContent.includes(wrong));
    assert.ok(win.document.querySelector('#resolveBtn'), 'and offers a way out');
  } finally { resetCubeModel(state); }
});

test('a missed-move gap is reported, not mistaken for a wrong turn, and disables following', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    feed().gap({ missing: 2, from: 4, to: 7 });
    assert.equal(win.document.querySelector('#followNote').hidden, false);
    assert.match(win.document.querySelector('#followMsg').textContent, /Missed 2 turns/);
    const btn = win.document.querySelector('[data-mode="cube"]');
    assert.ok(btn.disabled, 'following a cube we cannot vouch for is not on offer');
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

test('touching the transport takes over from the cube; the toggle resumes', async () => {
  const { state } = await import('../lib/app.js');
  try {
    await followSetup(state);
    const btn = win.document.querySelector('[data-mode="cube"]');
    assert.ok(btn.classList.contains('on'), 'precondition: following');
    win.document.querySelector('#nextBtn').click();
    assert.ok(!btn.classList.contains('on'), 'pressing Next hands control back to you');
    btn.click();
    assert.ok(btn.classList.contains('on'), 'and the toggle resumes following');
  } finally { resetCubeModel(state); }
});

test('the titlebar indicator appears with a connection and leaves with it', async () => {
  const { state } = await import('../lib/app.js');
  try {
    const ind = win.document.querySelector('#cubeLive');
    assert.ok(ind, 'the indicator exists in the titlebar');
    assert.equal(ind.hidden, true, 'and is absent with no cube');
    win.cubusFeed.useConnection({ requestBattery: async () => ({ level: 80 }) });
    assert.equal(ind.hidden, false, 'a connection reveals it');
    assert.ok(ind.classList.contains('stale'), 'a fresh connection is connected, not trusted');
    state.cube.trusted = true;
    win.cubusFeed.facelets(SOLVED_FACELETS);
    win.cubusFeed.useConnection(null);
    assert.equal(ind.hidden, true, 'a disconnect takes it away');
  } finally { resetCubeModel(state); }
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
