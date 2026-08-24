// The Restore screen (route id `scan`): the camera opens with the screen, and the six-face scan happens on the
// screen itself — no modal, and no camera picture.
//
// Both of those are easy to break invisibly. Drop `autostart` and the screen looks identical but
// waits for a click that no longer exists; drop `headless` and the raw feed reappears; forget to
// stop the panel on the way out and the camera light stays on with nothing showing it. This file
// drives the real index.html + lib/app.js and pins all three.
//
// The scanner bundle is NOT loaded here (disableJavaScriptFileLoading), so <ai-scan-panel> stays
// an inert element — which is exactly what lets us feed it synthetic `scan-progress` events and
// assert on what the screen draws from them.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let win;
const $ = (sel) => win.document.querySelector(sel);
const all = (sel) => [...win.document.querySelectorAll(sel)];
const panel = () => $('#stage ai-scan-panel');
const progress = (detail) =>
  panel().dispatchEvent(new win.CustomEvent('scan-progress', { detail }));

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const face = (n) => ({ face: n, colors: Array(9).fill(FACES.indexOf(n)) });

before(async () => {
  win = new Window({
    url: 'http://localhost/#/scan', // boot straight onto the scan screen
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  // A stored camera choice must reach the element BEFORE it opens anything.
  win.localStorage.setItem('cubusSettings', JSON.stringify({ cameraId: 'stored-cam' }));
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent', 'requestAnimationFrame',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  await tick();
});

test('entering the screen mounts the scanner itself — no modal, no click', () => {
  assert.equal($('#scanModal'), null, 'the scan modal must be gone');
  const el = panel();
  assert.ok(el, 'the scan screen must mount <ai-scan-panel>');
  assert.ok(el.hasAttribute('autostart'), 'autostart is what opens the camera on entry');
  assert.ok(el.hasAttribute('headless'), 'headless is what keeps the camera picture off screen');
});

test('the screen never shows the camera picture', () => {
  assert.equal($('#stage video'), null, 'no <video> may be drawn into the screen');
});

test('an absent scanner bundle says so rather than claiming a camera is opening', () => {
  // <ai-scan-panel> is undefined here, so nothing will ever report — the screen must not sit on
  // an "Opening the camera…" it cannot deliver. The scanner speaks through the aside card.
  assert.equal($('#scanHow').textContent, 'Loading the scanner…');
});

test('the six sides start pending, with nothing captured', () => {
  const tiles = all('.scan-face');
  assert.equal(tiles.length, 6);
  assert.deepEqual(tiles.map((t) => t.dataset.face), FACES);
  assert.equal(tiles.filter((t) => t.classList.contains('done')).length, 0);
  assert.equal($('#scanLive'), null, 'no separate viewfinder — the tiles and the aside say it all');
  assert.equal($('#scanBar'), null, 'no progress bar — the tiles are the progress');
});

// Must run before anything repaints the tiles.
test('each face tile is edged in its neighbours colours, so the way to hold it is visible', () => {
  // Read the palette out of the tiles themselves: with nothing captured yet, each tile's centre
  // cell is painted its own face colour. So this asserts the RELATIONSHIP rather than a set of
  // hex values, and keeps working if the palette changes.
  const colourOf = Object.fromEntries(all('.scan-face').map((t) =>
    [t.dataset.face, t.querySelectorAll('.tile > i')[4].style.background]));
  const bordersOf = (f) => $(`.scan-face[data-face="${f}"] .tile`)
    .getAttribute('style').replace('border-color:', '').trim().split(/\s+/);
  // The canonical URFDLB layout — derived from EDGE_FACELET in the scanner package and pinned by
  // its own test. Up is the one worth reading against a cube: white centre, blue above, red to
  // the right, green below, orange to the left.
  const EXPECT = {
    U: ['B', 'R', 'F', 'L'], R: ['U', 'B', 'D', 'F'], F: ['U', 'R', 'D', 'L'],
    D: ['F', 'R', 'B', 'L'], L: ['U', 'F', 'D', 'B'], B: ['U', 'L', 'D', 'R'],
  };
  for (const [face, sides] of Object.entries(EXPECT)) {
    assert.deepEqual(bordersOf(face), sides.map((n) => colourOf[n]), `${face} tile edges`);
  }
});

test('progress marks exactly the captured sides and moves the count', () => {
  progress({ phase: 'scanning', message: 'Got the Front side — 2/6. Show another side…',
    captured: [face('R'), face('F')], live: null });
  const done = all('.scan-face').filter((t) => t.classList.contains('done'));
  assert.deepEqual(done.map((t) => t.dataset.face), ['R', 'F']);
  assert.equal($('#scanHow').textContent, 'Got the Front side — 2/6. Show another side…');
});

test('a restart un-captures the sides again rather than leaving them marked done', () => {
  progress({ phase: 'scanning', message: 'Show any side to the camera — held flat and centred.',
    captured: [], live: null });
  assert.equal(all('.scan-face.done').length, 0);
});

test('a failure surfaces on the screen and offers a retry', () => {
  progress({ phase: 'error', message: 'Cannot start: Permission denied', captured: [], live: null });
  assert.ok($('#scanHow').classList.contains('err'), 'an error must read as one');
  assert.equal($('#scanHow').textContent, 'Cannot start: Permission denied');
  // ...and the card must not still be headed "How it works" over an error.
  assert.equal($('#scanHowTitle').textContent, 'Camera trouble');
  // With no camera running the webcam button is the way back, and says so.
  assert.ok(!$('.scan-cam').classList.contains('on'), 'the lens must not read as live');
  assert.match($('#scanCamBtn').title, /click to turn it on/);
});

// Which camera answered matters more here than anywhere, because the pane shows no picture: a
// Continuity Camera (an iPhone) or a virtual camera looks exactly like a broken one.
test('a stored camera choice is pinned as an attribute, not a property', () => {
  // An attribute survives the custom-element upgrade; a property set before it would be clobbered
  // by the element's own class field, and the pin would silently do nothing.
  assert.equal(panel().getAttribute('device-id'), 'stored-cam');
});

test('the webcam button is the camera menu', () => {
  const btn = $('#scanCamBtn');
  assert.ok(btn, 'the webcam button must be present');
  assert.equal($('.menu').hidden, true, 'closed until asked for');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.menu').hidden, false, 'clicking it opens the camera list');
  const items = [...$('.menu').querySelectorAll('button')].map((b) => b.textContent);
  assert.equal(items[0], 'Default camera', 'first entry hands the choice back to the platform');
  // Cameras and nothing else — starting over has its own button beside the webcam.
  assert.ok(items.every((t) => t !== 'Start the scan over'));
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.menu').hidden, true, 'and clicking again closes it');
});

test('the menu lists the cameras and marks the one in use', async () => {
  panel().cameras = async () => [
    { deviceId: 'builtin', label: 'MacBook Air Camera' },
    { deviceId: 'iphone', label: 'iPhone Camera' }, // a Continuity Camera, the case that started this
  ];
  progress({ phase: 'scanning', message: 'Show any side to the camera — held flat and centred.',
    captured: [], live: null, device: { deviceId: 'builtin', label: 'MacBook Air Camera' } });
  await tick();
  $('#scanCamBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const cams = [...$('.menu').querySelectorAll('[data-value]')].map((b) => b.textContent);
  assert.deepEqual(cams, ['Default camera', 'MacBook Air Camera', 'iPhone Camera']);
  // The camera pinned earlier in this file is not attached now, and a pin to a missing device is
  // not what gets used — the panel falls back to the platform default, so that is what is ticked.
  // Ticking nothing would leave the menu mute about which camera is in force.
  assert.deepEqual([...$('.menu').querySelectorAll('.now')].map((b) => b.textContent), ['Default camera']);
  $('#scanCamBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
});

test('choosing a camera pins it and remembers it', async () => {
  let started = 0;
  panel().start = () => { started++; };
  $('#scanCamBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  [...$('.menu').querySelectorAll('[data-value]')].find((b) => b.dataset.value === 'iphone')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(panel().getAttribute('device-id'), 'iphone', 'pinned as an attribute');
  assert.equal(JSON.parse(win.localStorage.getItem('cubusSettings')).cameraId, 'iphone', 'and remembered');
  assert.equal(started, 1, 'and the camera reopens on the chosen device');
  assert.equal($('.menu').hidden, true, 'the menu closes on choosing');
});

test('a nearly-solved cube points at the one side it needs shown again', () => {
  // Six unoriented face photos genuinely do not determine a nearly-solved cube, so the scanner
  // asks for one side back, held a stated way up. The sentence alone would send a child hunting
  // through six tiles for the colour it named.
  progress({ phase: 'confirm', message: 'Show the GREEN side again, with WHITE facing up.',
    captured: FACES.map(face), live: null, confirm: { face: 'F', up: 'U' } });
  assert.deepEqual(all('.scan-face.asked').map((t) => t.dataset.face), ['F']);
  assert.equal($('#scanHow').textContent, 'Show the GREEN side again, with WHITE facing up.');
  assert.equal($('#scanHowTitle').textContent, 'One more look');
  assert.equal(all('.scan-face.done').length, 6, 'the six sides are still captured');
});

test('the pointer clears once the scan moves on', () => {
  progress({ phase: 'scanning', message: 'Show any side to the camera — held flat and centred.',
    captured: [], live: null, confirm: null });
  assert.deepEqual(all('.scan-face.asked'), []);
});

// The detector's held-out colour accuracy is ~90%, so a scan can fail on one sticker a person can
// see at a glance. Clicking it must offer the six colours and push the correction back.
test('a sticker on a captured side opens a colour picker and reports the correction', () => {
  progress({ phase: 'scanning', message: 'Got the Right side — 1/6. Show another side…',
    captured: [face('R')], live: null, confirm: null });
  const calls = [];
  panel().setSticker = (...args) => calls.push(args);
  const cells = all('.scan-face[data-face="R"] .tile > i');
  cells[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const pick = $('.swatches');
  assert.ok(pick && !pick.hidden, 'clicking a captured sticker must offer the colours');
  assert.equal(pick.querySelectorAll('button').length, 6, 'all six cube colours');
  pick.querySelectorAll('button')[3].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, [['R', 0, 3]], 'face, sticker index, chosen colour class');
  assert.equal($('.swatches').hidden, true, 'and it closes on choosing');
});

// A centre cannot be recoloured without renaming the face, so it does the other useful thing.
test('the centre re-reads its side instead of offering colours', () => {
  const colours = [], rescans = [];
  panel().setSticker = (...args) => colours.push(args);
  panel().rescanFace = (...args) => rescans.push(args);
  all('.scan-face[data-face="R"] .tile > i')[4].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true, 'no colour picker for the centre');
  assert.deepEqual(colours, [], 'and never a colour change, which would rename the face');
  assert.deepEqual(rescans, [['R']], 'it throws that side away so the camera reads it again');
});

test('the centre of a side with nothing read yet has nothing to re-read', () => {
  const rescans = [];
  panel().rescanFace = (...args) => rescans.push(args);
  assert.ok(!$('.scan-face[data-face="B"]').classList.contains('done'));
  all('.scan-face[data-face="B"] .tile > i')[4].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(rescans, []);
});

// Correcting means overruling a reading, so there has to BE one. Hand-building a side the camera
// never saw is nine guesses, not a correction, and it would leave a face the camera then refuses.
test('a side with nothing read yet offers nothing to correct', () => {
  const calls = [];
  panel().setSticker = (...args) => calls.push(args);
  assert.ok(!$('.scan-face[data-face="B"]').classList.contains('done'), 'B has not been captured');
  all('.scan-face[data-face="B"] .tile > i')[7].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true, 'no colours offered on an unread side');
  assert.deepEqual(calls, []);
});

test('the restart button throws the whole scan away', () => {
  let restarts = 0, starts = 0;
  panel().restart = () => { restarts++; };
  panel().start = () => { starts++; };
  // Say a camera is running, so this is a restart rather than a re-open. Stated here rather than
  // inherited from whichever test ran last.
  progress({ phase: 'scanning', message: 'x', captured: [], live: null,
    device: { deviceId: 'builtin', label: 'MacBook Air Camera' }, confirm: null });
  $('#scanResetBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(restarts, 1);
  assert.equal(starts, 0);
});

test('with the camera dark, the restart button is the way back on', () => {
  let restarts = 0, starts = 0;
  panel().restart = () => { restarts++; };
  panel().start = () => { starts++; };
  progress({ phase: 'error', message: 'Cannot start: Permission denied',
    captured: [], live: null, device: null, confirm: null });
  $('#scanResetBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(starts, 1, 'restarting a scan that has no camera would do nothing');
  assert.equal(restarts, 0);
});

// Clicking a sticker used to place a real text caret in it — invisible in Chrome, blinking in the
// WKWebView the desktop app runs in. The cure is `user-select: none` on the shell, and the half
// that is easy to lose is the other one: restoring selection for the facelet string, which is the
// one thing on these screens worth copying and has no Copy button on every screen that shows it.
// Asserted against the stylesheet text because the test DOM has no layout engine to compute it.
test('the shell takes no text caret, but the facelet string stays copyable', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.match(css, /body\s*\{[^}]*user-select:\s*none/, 'the shell must not take a caret');
  assert.match(css, /\.mono[^{]*\{[^}]*user-select:\s*text/, 'the facelet string must stay selectable');
});

// Painting and the camera are exclusive: one authors the cube, the other reads it.
test('the paint toggle releases the camera and opens all 48 outer stickers', () => {
  const paints = [], sets = [];
  panel().setPainting = (on) => paints.push(on);
  panel().setSticker = (...args) => sets.push(args);
  const unread = $('.scan-face[data-face="B"]');
  assert.ok(!unread.classList.contains('done'), 'B has not been read');

  // camera mode: an unread side offers nothing
  all('.scan-face[data-face="B"] .tile > i')[3].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true);

  $('#scanPaintBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(paints, [true], 'the panel is told to release the camera');
  assert.ok($('.scan-cam').classList.contains('paint'), 'and the button reads as held down');

  // paint mode: the same sticker is now paintable
  all('.scan-face[data-face="B"] .tile > i')[3].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, false, 'an unread side is paintable while painting');
  $('.swatches').querySelectorAll('button')[2].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(sets, [['B', 3, 2]]);
});

test('the centre does nothing while painting — there is no camera to re-read with', () => {
  const rescans = [];
  panel().rescanFace = (...args) => rescans.push(args);
  progress({ phase: 'painting', message: 'x', captured: [face('R')], live: null, device: null, confirm: null });
  all('.scan-face[data-face="R"] .tile > i')[4].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(rescans, []);
});

test('toggling paint off hands the cube back to the camera', () => {
  const paints = [];
  panel().setPainting = (on) => paints.push(on);
  $('#scanPaintBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(paints, [false]);
  assert.ok(!$('.scan-cam').classList.contains('paint'));
  // and back to camera rules: an unread side stops offering colours
  all('.scan-face[data-face="B"] .tile > i')[3].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true);
});

// A finished scan used to jump straight to another screen, which took the six tiles away exactly
// when they first meant something — and with them any chance to check the read.
test('a completed scan stays on the screen and shows what was found', () => {
  // A REAL cube — `R U R' U'` from solved. Not a hand-mangled string: swapping stickers keeps the
  // colour counts and centres right, so cubejs accepts it, and then solve() searches an
  // unreachable state until the process is killed. setFacelets solves whatever it is handed.
  const scrambled = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: scrambled, valid: true, confidence: 1, lowConfidence: [] },
  }));
  assert.equal(win.location.hash, '#/scan', 'it must not navigate away');
  assert.ok($('#stage ai-scan-panel'), 'the scanner is still mounted');
  assert.equal($('#scanState').textContent, scrambled, 'the aside shows the state that was found');
  assert.equal($('#scanCube').firstElementChild.getAttribute('facelets'), scrambled,
    'and the 3D twin follows it, without re-rendering the screen');
});

// Left last: it navigates away, which tears the screen down.
test('leaving the screen releases the camera', async () => {
  let stopped = 0;
  const el = panel();
  el.stop = () => { stopped++; };
  win.cubusGo('viewer');
  await tick();
  assert.equal(stopped, 1, 'the panel must be stopped, not left to a lifecycle callback');
  assert.equal(panel(), null, 'and removed from the page');
});
