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
import { isAbsent, isSame } from './dom-assert.mjs';
import { test, before } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';
import Cube from '../vendor/cubejs.js';
import { createSelfCheck } from '../lib/cube-selfcheck.js';

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
/** The net's hexes for the classic palette, as the DOM reports them — for asserting which colour
 *  a tile got. Named for what it holds: two other tests use a local `NET` for the face letters. */
const NET_HEX = {
  U: '#F4F2EC', D: '#F0C000', F: '#00A651', B: '#0051BA', R: '#C41E3A', L: '#FF6C00',
};

/** A stand-in for a live session (lib/cube-session.js), with the REAL self-check behind it.
 *
 *  app.js hands every camera reading to `session.cameraScan()` — that is what derives the
 *  correction and what makes the session's verdict and the app's trust one model instead of two.
 *  A fake without it is not a session, and a fake that stubbed the derivation would be testing a
 *  private copy the app no longer has. */
const fakeConn = (over = {}) => {
  const check = createSelfCheck({ Cube });
  return {
    requestBattery: async () => 60,
    disconnect: async () => {},
    mayFollow: () => check.verdict !== 'refused',
    numbersMoves: () => true,
    get verdict() { return check.verdict; },
    cameraScan: (scanned, reported) => { check.onCameraScan(scanned, reported); return check.offset; },
    ...over,
  };
};

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
  isAbsent($('#scanModal'), 'the scan modal must be gone');
  const el = panel();
  assert.ok(el, 'the scan screen must mount <ai-scan-panel>');
  assert.ok(el.hasAttribute('autostart'), 'autostart is what opens the camera on entry');
  assert.ok(el.hasAttribute('headless'), 'headless is what keeps the camera picture off screen');
});

test('the screen never shows the camera picture', () => {
  isAbsent($('#stage video'), 'no <video> may be drawn into the screen');
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
  isAbsent($('#scanLive'), 'no separate viewfinder — the tiles and the aside say it all');
  isAbsent($('#scanBar'), 'no progress bar — the tiles are the progress');
});

// Must run before anything repaints the tiles.
test('each face tile is edged in its neighbours colours, so the way to hold it is visible', () => {
  // Read the palette out of the tiles themselves: with nothing captured yet, each tile's centre
  // cell is painted its own face colour. So this asserts the RELATIONSHIP rather than a set of
  // hex values, and keeps working if the palette changes.
  const colourOf = Object.fromEntries(all('.scan-face').map((t) =>
    [t.dataset.face, t.querySelectorAll('.tgrid > .cell')[4].style.backgroundColor]));
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

// The aside speaks with two voices in two places: a pinned notice — what the scanner needs and
// why, standing until the situation changes — and the transient camera hint on its own line
// below. One line for both is the old design, and it is how a refusal's explanation got
// overwritten by "show any side to the camera" within a single tick and read as a crash.
test('a pinned notice owns the card, with the camera hint on its own line below', () => {
  progress({ phase: 'scanning', message: 'Show any side to the camera — point a side at the camera…',
    captured: FACES.map(face), live: null, confirm: null,
    notice: { title: 'One sticker looks wrong', tone: 'err', body: 'Fixing a marked sticker makes this a solvable cube.' } });
  assert.equal($('#scanHowTitle').textContent, 'One sticker looks wrong');
  assert.equal($('#scanHow').textContent, 'Fixing a marked sticker makes this a solvable cube.');
  assert.ok($('#scanHow').classList.contains('err'), 'the notice keeps its tone');
  assert.equal($('#scanHint').hidden, false, 'the tick hint drops to its own line, not over the notice');
  assert.match($('#scanHint').textContent, /point a side/);
});

// A notice may recommend ONE action, and the host draws it as a button in the same card as the
// sentence: the refusal that can name no sticker says "start the scan over", and pointing at the
// toolbar's ↻ from the aside was the confusion (2026-09-06). Hidden again the moment a notice
// without an action arrives, so a stale button never outlives its sentence.
test('a notice with an action gets its button in the card, wired to the panel', () => {
  let restarts = 0;
  panel().restart = () => { restarts++; };
  progress({ phase: 'scanning', message: 'Show one side to the camera to re-read just that side.',
    captured: FACES.map(face), live: null, confirm: null,
    notice: { title: 'Some stickers were misread', tone: 'err',
      body: 'At least %1 stickers do not fit a real cube. Start the scan over. Show one side to the camera to re-read just that side.',
      params: [3], action: { label: 'Start over', kind: 'restart' } } });
  const btn = $('#scanAction');
  assert.equal(btn.hidden, false, 'the action is drawn');
  assert.equal(btn.textContent, 'Start over');
  assert.equal($('#scanHint').hidden, true, 'the hint repeats the notice and is hidden');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(restarts, 1, 'the button is the panel restart');
  progress({ phase: 'scanning', message: 'Show any side to the camera.',
    captured: [], live: null, confirm: null, notice: null });
  assert.equal($('#scanAction').hidden, true, 'no action, no button');
});

// A notice that has to state a NUMBER or a side name cannot bake it into the sentence: the baked
// string would never match a catalog key. The panel sends the sentence with %1..%9 intact plus the
// values, and the host translates first and substitutes after (dev-docs/i18n.md, the seam).
test('a notice carrying params is filled in after translation, not before', () => {
  progress({ phase: 'scanning', message: 'Show any side to the camera.',
    captured: FACES.map(face), live: null, confirm: null,
    notice: { title: 'More than one sticker looks wrong', tone: 'err',
      body: 'At least %1 stickers were misread. Show the %2 side to the camera again.',
      params: [3, 'GREEN'] } });
  assert.equal($('#scanHow').textContent,
    'At least 3 stickers were misread. Show the GREEN side to the camera again.');
});

test('a notice with no params renders its sentence untouched', () => {
  progress({ phase: 'scanning', message: 'Show any side to the camera.',
    captured: FACES.map(face), live: null, confirm: null,
    notice: { title: 'One sticker looks wrong', tone: 'err', body: 'Fixing the marked sticker makes this solvable.' } });
  assert.equal($('#scanHow').textContent, 'Fixing the marked sticker makes this solvable.');
});

test('a hint that restates the notice is suppressed rather than doubled', () => {
  progress({ phase: 'confirm', message: 'Show the GREEN side again, with WHITE facing up.',
    captured: FACES.map(face), live: null, confirm: { face: 'F', up: 'U' },
    notice: { title: 'One more look', tone: 'info',
      body: 'One held look decides it. Show the GREEN side again, with WHITE facing up.' } });
  assert.equal($('#scanHowTitle').textContent, 'One more look');
  assert.equal($('#scanHint').hidden, true);
  // and with the notice gone, the card goes back to one voice
  progress({ phase: 'scanning', message: 'x', captured: [], live: null, confirm: null, notice: null });
  assert.equal($('#scanHint').hidden, true);
  assert.equal($('#scanHow').textContent, 'x');
});

// A finished scan must answer "what do I do now?" — and only this screen can, because the next
// action is this screen's own button. "Scan complete — solvable cube captured" states the past;
// the card's job at that moment is to point at "Solve this cube".
test('a complete scan tells the user to press "Solve this cube"', () => {
  // The button is a promise about this screen's scan, so before one succeeds it is not pressable.
  assert.equal($('#scanSolveBtn').disabled, true, 'disabled until a scan stands complete');
  progress({ phase: 'done', message: 'Scan complete — solvable cube captured.',
    captured: FACES.map(face), live: null, device: null, confirm: null, notice: null, complete: true });
  assert.equal($('#scanSolveBtn').disabled, false, 'a complete scan makes it pressable');
  assert.equal($('#scanHowTitle').textContent, 'Scanned');
  assert.match($('#scanHow').textContent, /Solve this cube/);
  assert.ok($('#scanHow').classList.contains('ok'));
  assert.equal($('#scanHint').hidden, true, 'camera off — nothing to hint about');
  // The camera reopened over the finished scan: its own line matters again, under the guidance.
  progress({ phase: 'scanning', message: 'Scan finished — start the scan over to read a different cube.',
    captured: FACES.map(face), live: null, confirm: null, notice: null, complete: true,
    device: { deviceId: 'builtin', label: 'MacBook Air Camera' } });
  assert.match($('#scanHow').textContent, /Solve this cube/, 'the guidance stands');
  assert.equal($('#scanHint').hidden, false);
  assert.match($('#scanHint').textContent, /start the scan over/);
  // A correction that re-opens the verdict takes the button away again until it re-settles.
  progress({ phase: 'checking', message: 'Corrected — checking…',
    captured: FACES.map(face), live: null, device: null, confirm: null, notice: null, complete: false });
  assert.equal($('#scanSolveBtn').disabled, true, 'not pressable while the verdict is open');
});

// A colour misread points at the sticker it most plausibly landed on — a pulsing mark on the
// tile, and the suggested colour ringed when the picker opens there. The sentence alone would
// send a child hunting through 54 stickers.
test('suspect stickers are marked on the tile, and the picker rings the suggested colour', () => {
  progress({ phase: 'scanning', message: 'x', captured: FACES.map(face), live: null, confirm: null,
    suspects: [{ face: 'R', index: 2, to: 5 }],
    notice: { title: 'One sticker looks wrong', tone: 'err', body: 'b' } });
  const cells = all('.scan-face[data-face="R"] .tgrid > .cell');
  assert.ok(cells[2].classList.contains('suspect'), 'the suspect sticker is marked');
  assert.equal(all('.scan-face .cell.suspect').length, 1, 'and only it');
  panel().setSticker = () => {};
  cells[2].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const sug = all('.swatches button.suggest');
  assert.equal(sug.length, 1, 'the picker rings exactly the suggested colour');
  // The picker offers COLOURS now, not sides: class 5 is blue, wherever blue sits on the cube
  // (ADR 0001 §8.5 — a class and a position are different questions).
  assert.equal(Number(sug[0].dataset.colour), 5, 'the suggested colour class is the one rung');
  // A plain progress — the situation changed — clears the marks.
  progress({ phase: 'scanning', message: 'x', captured: FACES.map(face), live: null, confirm: null });
  assert.equal(all('.scan-face .cell.suspect').length, 0);
});

// The detector's held-out colour accuracy is ~90%, so a scan can fail on one sticker a person can
// see at a glance. Clicking it must offer the six colours and push the correction back.
test('a sticker on a captured side opens a colour picker and reports the correction', () => {
  progress({ phase: 'scanning', message: 'Got the Right side — 1/6. Show another side…',
    captured: [face('R')], live: null, confirm: null });
  const calls = [];
  panel().setSticker = (...args) => calls.push(args);
  const cells = all('.scan-face[data-face="R"] .tgrid > .cell');
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
  all('.scan-face[data-face="R"] .tgrid > .cell')[4].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true, 'no colour picker for the centre');
  assert.deepEqual(colours, [], 'and never a colour change, which would rename the face');
  assert.deepEqual(rescans, [['R']], 'it throws that side away so the camera reads it again');
});

test('the centre of a side with nothing read yet has nothing to re-read', () => {
  const rescans = [];
  panel().rescanFace = (...args) => rescans.push(args);
  assert.ok(!$('.scan-face[data-face="B"]').classList.contains('done'));
  all('.scan-face[data-face="B"] .tgrid > .cell')[4].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(rescans, []);
});

// Correcting means overruling a reading, so there has to BE one. Hand-building a side the camera
// never saw is nine guesses, not a correction, and it would leave a face the camera then refuses.
test('a side with nothing read yet offers nothing to correct', () => {
  const calls = [];
  panel().setSticker = (...args) => calls.push(args);
  assert.ok(!$('.scan-face[data-face="B"]').classList.contains('done'), 'B has not been captured');
  all('.scan-face[data-face="B"] .tgrid > .cell')[7].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true, 'no colours offered on an unread side');
  assert.deepEqual(calls, []);
});

// One call whatever the camera state: the panel's restart() reopens a dark camera itself, so the
// screen no longer has to guess which of two methods to call — and a wrong guess used to mean
// either a dead button (restart with no camera) or a silent wipe (start when a scan existed).
test('the restart button hands the whole decision to panel.restart()', () => {
  for (const device of [{ deviceId: 'builtin', label: 'MacBook Air Camera' }, null]) {
    let restarts = 0, starts = 0;
    panel().restart = () => { restarts++; };
    panel().start = () => { starts++; };
    progress({ phase: device ? 'scanning' : 'error', message: 'x', captured: [], live: null,
      device, confirm: null });
    $('#scanResetBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.equal(restarts, 1, `restart() with device=${JSON.stringify(device)}`);
    assert.equal(starts, 0, 'start() would keep the captures, which is not what this button says');
  }
});

// Clicking a sticker used to place a real text caret in it — invisible in Chrome, blinking in the
// WKWebView the desktop app runs in. The cure is `user-select: none` on the shell, and the half
// that is easy to lose is the other one: putting selection BACK where a user genuinely needs it.
//
// That second half used to name `.mono`, the raw facelet string. Both screens that printed one
// dropped it (the Restore card, then the cube screen's state card), so the exception guarded a
// class no element carries and the audit flagged the rule as dead. Real form controls are what is
// left that must stay selectable — a text input you cannot put a cursor in is broken, and that is
// the failure `user-select: none` on the shell would cause if the exception were ever lost.
// Asserted against the stylesheet text because the test DOM has no layout engine to compute it.
test('the shell takes no text caret, but real inputs stay selectable', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.match(css, /body\s*\{[^}]*user-select:\s*none/, 'the shell must not take a caret');
  assert.match(css, /input[^{]*\{[^}]*user-select:\s*text/, 'form controls must stay selectable');
  assert.doesNotMatch(css, /\.mono\s*\{/, 'the .mono rule is dead — no element carries the class');
});

// Painting and the camera are exclusive: one authors the cube, the other reads it.
test('the paint toggle releases the camera and opens all 48 outer stickers', () => {
  const paints = [], sets = [];
  panel().setPainting = (on) => paints.push(on);
  panel().setSticker = (...args) => sets.push(args);
  const unread = $('.scan-face[data-face="B"]');
  assert.ok(!unread.classList.contains('done'), 'B has not been read');

  // camera mode: an unread side offers nothing
  all('.scan-face[data-face="B"] .tgrid > .cell')[3].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true);

  $('#scanPaintBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(paints, [true], 'the panel is told to release the camera');
  assert.ok($('.scan-cam').classList.contains('paint'), 'and the button reads as held down');

  // paint mode: the same sticker is now paintable
  all('.scan-face[data-face="B"] .tgrid > .cell')[3].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, false, 'an unread side is paintable while painting');
  $('.swatches').querySelectorAll('button')[2].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(sets, [['B', 3, 2]]);
});

test('the centre does nothing while painting — there is no camera to re-read with', () => {
  const rescans = [];
  panel().rescanFace = (...args) => rescans.push(args);
  progress({ phase: 'painting', message: 'x', captured: [face('R')], live: null, device: null, confirm: null });
  all('.scan-face[data-face="R"] .tgrid > .cell')[4].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(rescans, []);
});

test('toggling paint off hands the cube back to the camera', () => {
  const paints = [];
  panel().setPainting = (on) => paints.push(on);
  $('#scanPaintBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(paints, [false]);
  assert.ok(!$('.scan-cam').classList.contains('paint'));
  // and back to camera rules: an unread side stops offering colours
  all('.scan-face[data-face="B"] .tgrid > .cell')[3].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true);
});

// The twin is meant to show what has been READ, so an unread side must not look like a solved one.
test('the detected-state twin fills in side by side, unread stickers marked unknown', () => {
  progress({ phase: 'scanning', message: 'x', captured: [face('U'), face('R')],
    live: null, device: null, confirm: null });
  const twin = $('#scanCube > cubus-cube');
  const fl = twin.getAttribute('facelets');
  assert.equal(fl.length, 54);
  assert.equal(fl.slice(0, 9), 'UUUUUUUUU', 'a read side shows its colours');
  assert.equal((fl.match(/\?/g) ?? []).length, 36, 'the four unread sides are unknown, not solved');
  assert.equal(twin.getAttribute('ghosts'), 'floating', 'all six faces readable at once');
});

// Which way up each side was held stops mattering once the cube reads as solvable: the validated
// string IS the canonical layout, and the scanner reports each face's rotation, so a face that
// was captured the wrong way up is animated TURNING to its true orientation before the repaint.
// The turn is a CSS transform driven by timers, so the repaint must land — and the transform must
// clear — with no transition events, which this DOM never fires.
test('a solvable scan turns each mis-held tile and settles into the canonical layout', async () => {
  const FL = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  const NET = ['U', 'R', 'F', 'D', 'L', 'B'];
  // Shown deliberately wrong-way-up, so a repaint that does nothing would leave a mismatch.
  progress({ phase: 'scanning', message: 'x',
    captured: NET.map((f) => ({ face: f, colors: Array(9).fill(NET.indexOf(f)) })),
    live: null, device: null, confirm: null });
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: FL, valid: true, confidence: 1, lowConfidence: [],
      rotations: [1, 2, 3, 0, 0, 0] },
  }));
  // The mis-held tiles are turning; a 180° turn runs 800 ms, so at 400 ms it is still in flight.
  const grid = (f) => $(`.scan-face[data-face="${f}"] .tgrid`);
  assert.match(grid('U').style.transform, /rotate\(90deg\)/, 'a quarter-off tile turns 90°');
  assert.match(grid('R').style.transform, /rotate\(180deg\)/);
  assert.match(grid('F').style.transform, /rotate\(-90deg\)/, '270° CW reads better as 90° back');
  assert.equal(grid('D').style.transform, '', 'a tile held right does not move');
  await new Promise((r) => setTimeout(r, 900));
  const palette = Object.fromEntries(NET.map((f) => [f,
    all(`.scan-face[data-face="${f}"] .tgrid > .cell`)[4].style.backgroundColor]));
  let mismatches = 0;
  NET.forEach((f, fi) => {
    all(`.scan-face[data-face="${f}"] .tgrid > .cell`).forEach((c, i) => {
      if (c.style.backgroundColor !== palette[FL[fi * 9 + i]]) mismatches++;
    });
  });
  assert.equal(mismatches, 0, 'all 54 stickers repainted from the validated layout');
  for (const f of NET) assert.equal(grid(f).style.transform, '', `${f}: the turn transform clears`);
});

// Without rotations (a painted cube, or an older panel bundle) the settle is an instant repaint —
// the animation is an explanation, never a dependency.
test('a scan-complete without rotations still settles the tiles, instantly', () => {
  const FL = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  const NET = ['U', 'R', 'F', 'D', 'L', 'B'];
  progress({ phase: 'scanning', message: 'x',
    captured: NET.map((f) => ({ face: f, colors: Array(9).fill(NET.indexOf(f)) })),
    live: null, device: null, confirm: null });
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: FL, valid: true, confidence: 1, lowConfidence: [] },
  }));
  const palette = Object.fromEntries(NET.map((f) => [f,
    all(`.scan-face[data-face="${f}"] .tgrid > .cell`)[4].style.backgroundColor]));
  let mismatches = 0;
  NET.forEach((f, fi) => {
    all(`.scan-face[data-face="${f}"] .tgrid > .cell`).forEach((c, i) => {
      if (c.style.backgroundColor !== palette[FL[fi * 9 + i]]) mismatches++;
    });
  });
  assert.equal(mismatches, 0);
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
  isAbsent($('#scanState'), 'the 54-char string belongs on the Cube screen, with its Copy button');
  assert.equal($('#scanCube').firstElementChild.getAttribute('facelets'), scrambled,
    'the 3D twin shows what was found, without re-rendering the screen');
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

// The centre sticker must show its TRUE colour.
//
// It is the one sticker whose colour is certain — it names the face, and the eight around it are
// read against it. An earlier version laid `inset 0 0 0 100px rgba(0,0,0,.3)` over it so the white
// rescan glyph stayed legible, which rendered every centre as a darkened version of itself: six
// faces showing a seventh and eighth colour the cube does not have.
//
// Asserted against the stylesheet text because the test DOM computes no styles. Measured in a real
// browser at the time of the fix: centre and edge resolve to the same rgb() on all six colours,
// and the glyph stays at 0.92 opacity carried by its own drop-shadow.
test('nothing paints over the centre sticker', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const centreRules = css
    .split('}')
    .filter((r) => /\.scan-face[^{]*nth-child\(5\)(?![^{]*\.ic)/.test(r.split('{')[0] ?? ''));
  assert.ok(centreRules.length > 0, 'the centre rules moved — update this test');
  for (const rule of centreRules) {
    assert.doesNotMatch(rule, /inset/, `an inset shadow tints the centre: ${rule.trim().slice(0, 90)}`);
    assert.doesNotMatch(rule, /background/, `a background overrides the read colour: ${rule.trim().slice(0, 90)}`);
  }
  // The glyph stays readable on all six by its own contrast, not by darkening the sticker.
  assert.match(css, /nth-child\(5\) > \.ic[^}]*drop-shadow/, 'the glyph needs its own halo');
});

// The handoff itself: does "Solve this cube" carry the CURRENT read across to the cube screen?
//
// This is the seam that a screen rename silently breaks. The button is a `data-go`, so retargeting
// it during the Home/viewer restructure changed where the scan lands without touching the code
// that produces the state — and nothing else in the suite followed the state across the jump.
test('Solve this cube hands the cube screen the arrangement that was scanned', async () => {
  // Same real `R U R' U'` state. cubejs runs here, so setFacelets derives a genuine setup alg.
  const scrambled = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  const { state } = await import('../lib/app.js');

  win.location.hash = '#/scan';
  await tick();
  await new Promise((r) => setTimeout(r, 50));
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: scrambled, valid: true, confidence: 1, lowConfidence: [] },
  }));
  assert.equal(state.cube.facelets, scrambled, 'the scan reaches shared state');
  assert.ok(state.cube.solvable, 'and is recognised as solvable, or the cube screen has nothing to walk');

  const solve = [...win.document.querySelectorAll('[data-go]')]
    .find((b) => b.textContent.includes('Solve this cube'));
  assert.ok(solve, 'the button is on the scan screen');
  solve.click();
  await tick();
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(win.location.hash, '#/home', 'it lands on the cube screen');
  assert.equal(state.cube.facelets, scrambled, 'and the state survived the navigation');

  // INITIAL STATE draws from the same string: each sticker carries its facelet letter as a class,
  // so the net can be read back and compared character for character.
  const net = [...win.document.querySelectorAll('#viewNet .sticker')]
    .map((e) => e.className.split(' ')[1]).join('');
  assert.equal(net, scrambled, 'the cube screen shows the arrangement that was scanned');
});

// The other half of the handoff: a CORRECTED read must be the one that travels.
//
// Corrections do not go through the app at all — clicking a swatch calls panel.setSticker(), the
// panel re-validates, and only a fresh scan-complete puts anything back into shared state. So the
// path is real but indirect, and "the cube screen solves the cube you scanned before you fixed it"
// is a failure with no error attached to it. This drives the panel the way a swatch click does.
test('a corrected sticker is what reaches the cube screen, not the original read', async () => {
  const first = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  // The same cube one more turn on: a different, still-solvable state, standing in for whatever
  // the panel re-validates to after a sticker is overruled.
  const corrected = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  const { state } = await import('../lib/app.js');

  win.location.hash = '#/scan';
  await tick();
  await new Promise((r) => setTimeout(r, 50));

  // Editing is gated on a side having been READ — a sticker nobody has seen has nothing to
  // correct. That state arrives via scan-progress, not scan-complete, so mark the sides first.
  progress({ phase: 'scanning', message: 'Got every side.', captured: FACES.map(face), live: null });
  assert.equal(all('.scan-face.done').length, 6, 'precondition: every side reads as captured');

  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: first, valid: true, confidence: 1, lowConfidence: [] },
  }));
  assert.equal(state.cube.facelets, first, 'the first read lands');

  // A swatch click ends in panel.setSticker(); the panel answers with a fresh scan-complete.
  const calls = [];
  panel().setSticker = (...args) => calls.push(args);
  const cell = $('.scan-face[data-face="U"] .tgrid > .cell:nth-child(1)');
  cell.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const swatch = $('.swatches button[data-colour="1"]'); // red
  assert.ok(swatch, 'the six-colour picker opened on a read side');
  swatch.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(calls.length, 1, 'the correction is handed to the panel, which owns validation');

  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: corrected, valid: true, confidence: 1, lowConfidence: [] },
  }));
  assert.equal(state.cube.facelets, corrected, 'the re-validated read replaces the first');

  [...win.document.querySelectorAll('[data-go]')]
    .find((b) => b.textContent.includes('Solve this cube'))
    .click();
  await tick();
  await new Promise((r) => setTimeout(r, 50));

  const net = [...win.document.querySelectorAll('#viewNet .sticker')]
    .map((e) => e.className.split(' ')[1]).join('');
  assert.equal(net, corrected, 'the cube screen shows the CORRECTED cube');
  assert.notEqual(net, first, 'and not the read it replaced');
});

// A camera scan with a smart cube connected does two jobs: it says where the cube is, and it
// repairs the cube's own tracking (the offset) without anyone solving anything. And when the
// scan CONTRADICTS a cube that was tracking, neither is believed — adopting the scan while
// saying "nothing was changed" would be untrue, and so would an enabled Solve button.
test('a scan agreeing with the connected cube is adopted, and trust follows', async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/scan';
  await tick();
  win.cubusFeed.useConnection(fakeConn());
  const S = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  win.cubusFeed.facelets(S); // the cube reports S — and the camera then reads exactly S
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: S, valid: true, confidence: 1, lowConfidence: [] },
  }));
  assert.equal(state.cube.trusted, true, 'the scan established trust');
  assert.equal(state.cube.source, 'camera');
  assert.equal(state.cube.facelets, S, 'and was adopted');
  assert.equal(state.cube.offset, null, 'agreement needs no correction');
  win.cubusFeed.useConnection(null);
  state.cube.trusted = false; state.cube.source = 'none'; state.cube.staleWhy = '';
  state.live = null; state.reported = null;
});

test('a scan contradicting a tracking cube adopts nothing and disables Solve', async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/scan';
  await tick();
  win.cubusFeed.useConnection(fakeConn());
  const S = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  win.cubusFeed.facelets(S);
  state.cube.trusted = true; state.cube.source = 'cube'; // the cube was tracking at S
  const before = state.cube.facelets;
  const OTHER = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: OTHER, valid: true, confidence: 1, lowConfidence: [] },
  }));
  assert.equal(state.cube.facelets, before, 'the contradicted scan is not adopted');
  assert.equal(state.cube.trusted, false, 'and nobody is trusted until one is confirmed');
  assert.equal($('#scanSolveBtn').disabled, true, 'Solve stays off a cube the screen refused');
  assert.match($('#scanHow').textContent, /One of the two is wrong/);
  assert.ok($('#scanHow').classList.contains('err'), 'a repair the scan contradicted was not said as trouble');
  win.cubusFeed.useConnection(null);
  state.cube.trusted = false; state.cube.source = 'none'; state.cube.staleWhy = '';
  state.live = null; state.reported = null;
});

// The other half of that refusal: WHICH trust it is about.
//
// `state.cube.trusted` is also true of a generated scramble — the die, the Timer, and the
// Scramble screen's hand-off all adopt one as `source: 'generated'`, which is perfect knowledge
// of a cube nobody has looked at. It says nothing whatever about whether this cube's reports are
// in step, and reading it as "the cube was tracking" refused the camera repair in the one
// situation the repair exists for: a cube that has drifted, on a screen where a scramble was
// rolled (found by audit, 2026-09-05).
test('a trusted generated scramble is not a tracking cube — the camera repair still runs', async () => {
  const { state } = await import('../lib/app.js');
  // A REAL re-entry, not just the hash: the screen above left its own `refused` flag standing,
  // and this test is about a scan the screen believes.
  win.cubusGo('scan');
  await tick();
  win.cubusFeed.useConnection(fakeConn());
  const S = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  win.cubusFeed.facelets(S); // the cube reports S, and nothing has ever confirmed that it is right
  // Exactly what adoptCube(target, { physical: false, source: 'generated' }) leaves behind.
  state.cube.trusted = true; state.cube.source = 'generated'; state.cube.isPhysical = false;
  // What the camera sees: the real cube, which is not where its own reports put it. That gap IS
  // the correction — refusing to derive it is refusing the repair.
  const REAL = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  assert.notEqual(REAL, state.live, 'precondition: the reading disagrees with what the cube reports');
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: REAL, valid: true, confidence: 1, lowConfidence: [] },
  }));

  assert.equal(state.cube.facelets, REAL, 'the scan was refused because a SCRAMBLE was trusted');
  assert.equal(state.cube.source, 'camera', 'and the camera never got to say where the cube is');
  assert.ok(state.cube.offset, 'the correction this whole reading exists to derive was never derived');
  assert.equal(state.cube.offsetFrom, 'scan');
  assert.equal($('#scanSolveBtn').disabled, false, 'a repaired cube is walkable');
  assert.match($('#scanHow').textContent, /back in step/i, 'and the repair is what the screen reports');

  win.cubusFeed.useConnection(null); // clears the offset with the chain it corrected
  state.cube.trusted = false; state.cube.source = 'none'; state.cube.staleWhy = '';
  state.live = null; state.reported = null;
});

// A refusal has to SURVIVE the next tick, and that is the whole of this test.
//
// The panel reports `complete` on every state change once it has a finished scan, and `complete`
// deliberately survives a camera reopen — that is what stops a reopened camera overwriting an
// accepted scan. So `solveBtn.disabled = !p.complete` handed the button straight back on the very
// next progress event, over a cube the screen had just said it did not believe. The flag is the
// screen's own, because the panel is right not to carry it: the panel judged the scan LEGAL, and
// what was refused is what the app made of it.
test('a refused scan keeps Solve off across every later progress event', async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/scan';
  await tick();
  win.cubusFeed.useConnection(fakeConn());
  const S = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  win.cubusFeed.facelets(S);
  state.cube.trusted = true; state.cube.source = 'cube'; // the cube was tracking at S
  const OTHER = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: OTHER, valid: true, confidence: 1, lowConfidence: [] },
  }));
  assert.equal($('#scanSolveBtn').disabled, true, 'precondition: the screen refused the reading');

  // Every shape of later report that still stands complete. Each of these re-enabled it.
  for (const detail of [
    { phase: 'done', complete: true, captured: FACES.map(face), device: null, message: '' },
    { phase: 'idle', complete: true, captured: FACES.map(face), device: { deviceId: 'x', label: 'Cam' }, message: '' },
    { phase: 'done', complete: true, captured: FACES.map(face), device: { deviceId: 'x', label: 'Cam' }, message: 'this cube is already scanned' },
  ]) {
    progress(detail);
    assert.equal($('#scanSolveBtn').disabled, true,
      `a "${detail.phase}" report handed Solve back over a cube the screen refused`);
  }

  // A CAPTURE reopens the verdict, and that is the event that clears it: there is a new reading
  // to judge, so the old refusal has nothing left to be about.
  progress({ phase: 'capturing', complete: false, captured: [], device: null, message: '' });
  assert.equal($('#scanSolveBtn').disabled, true, 'an incomplete scan has nothing to solve either');
  progress({ phase: 'done', complete: true, captured: FACES.map(face), device: null, message: '' });
  assert.equal($('#scanSolveBtn').disabled, false, 'and a fresh complete scan is solvable again');

  win.cubusFeed.useConnection(null);
  state.cube.trusted = false; state.cube.source = 'none'; state.cube.staleWhy = '';
  state.live = null; state.reported = null;
});

// A scan the SCANNER refused is a scan this screen must not offer to solve either — and here the
// standing `complete` belongs to an EARLIER, accepted scan, so nothing else would take it away.
test('a scan the scanner rejects takes Solve away too', async () => {
  win.location.hash = '#/scan';
  await tick();
  progress({ phase: 'done', complete: true, captured: FACES.map(face), device: null, message: '' });
  assert.equal($('#scanSolveBtn').disabled, false, 'precondition: a complete scan is solvable');
  panel().dispatchEvent(new win.CustomEvent('scan-invalid', { detail: { reason: 'not a cube' } }));
  assert.equal($('#scanSolveBtn').disabled, true, 'a rejected reading left Solve standing over the previous cube');
});

// ONE REFUSAL, TWO EVENTS — the shape `scan-invalid` gained on 2026-09-05, when the misread decode
// moved to a worker. The refusal is announced at once with `misreadCount: null` ("checking"), and
// announced again with the count when the decode lands, so a host never waits seconds for either.
// This screen only has to be indifferent to that, which is what makes the change safe here — but
// "indifferent" is a claim, and a listener that counted events or read the count as a number would
// break silently under exactly this sequence.
test('a refusal announced twice — checking, then counted — leaves Solve exactly as disabled', async () => {
  win.location.hash = '#/scan';
  await tick();
  // A capture re-opens the verdict, which is what clears the previous test's standing refusal.
  progress({ phase: 'capturing', complete: false, captured: [], device: null, message: '' });
  progress({ phase: 'done', complete: true, captured: FACES.map(face), device: null, message: '' });
  assert.equal($('#scanSolveBtn').disabled, false, 'precondition: a complete scan is solvable');
  const refuse = (detail) => panel().dispatchEvent(new win.CustomEvent('scan-invalid', { detail }));
  refuse({ reason: 'a colour was misread', valid: false, misreadCount: null });
  assert.equal($('#scanSolveBtn').disabled, true, 'the refusal must land before the count does');
  refuse({ reason: 'a colour was misread', valid: false, misreadCount: 2 });
  assert.equal($('#scanSolveBtn').disabled, true, 'the second announcement must not undo the first');
});

// The words the user actually sees while the decode runs, and after it answers. The panel owns
// both sentences; what is pinned here is that this screen renders the deferred one AS A SENTENCE
// (no count, no placeholder to substitute) and then replaces it with the counted one — the
// "at least N" wording rule intact, still arriving as a param rather than baked in.
test('the notice says it is checking, then says the count when it lands', () => {
  const report = (notice) => progress({ phase: 'scanning', message: 'Show any side to the camera.',
    captured: FACES.map(face), live: null, confirm: null, notice });
  report({ title: 'Not a solvable cube', tone: 'err',
    body: 'Working out how many stickers are wrong — that takes a moment on a badly-read cube.' });
  assert.equal($('#scanHowTitle').textContent, 'Not a solvable cube');
  assert.match($('#scanHow').textContent, /Working out how many stickers are wrong/);
  assert.doesNotMatch($('#scanHow').textContent, /%/, 'a checking sentence has no count to substitute');
  assert.doesNotMatch($('#scanHow').textContent, /at least/i, 'and claims no number while it has none');

  report({ title: 'More than one sticker looks wrong', tone: 'err',
    body: 'At least %1 stickers were misread, so there is no single sticker to point at.',
    params: [2] });
  assert.equal($('#scanHow').textContent,
    'At least 2 stickers were misread, so there is no single sticker to point at.');
});

// Auto-solve is a promise about a scan that was BELIEVED. Firing it on a refused reading walked
// the PREVIOUS cube behind a disabled Solve button — the navigation quietly overrode the refusal.
test('auto-solve fires only for a believed scan — a refused one stays put', async () => {
  const { state } = await import('../lib/app.js');
  win.location.hash = '#/settings';
  await tick();
  win.document.querySelector('[data-toggle="autosolve"]').click();
  win.location.hash = '#/scan';
  await tick();
  try {
    win.cubusFeed.useConnection(fakeConn());
    const S = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
    win.cubusFeed.facelets(S);
    state.cube.trusted = true; state.cube.source = 'cube'; // the cube was tracking at S
    const OTHER = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
    panel().dispatchEvent(new win.CustomEvent('scan-complete', {
      detail: { facelets: OTHER, valid: true, confidence: 1, lowConfidence: [] },
    }));
    await tick();
    assert.equal(win.location.hash, '#/scan', 'a refused scan must not be auto-solved');
    // The same reading, agreeing with the cube, IS believed — and honours the setting.
    panel().dispatchEvent(new win.CustomEvent('scan-complete', {
      detail: { facelets: S, valid: true, confidence: 1, lowConfidence: [] },
    }));
    await tick();
    assert.equal(win.location.hash, '#/home', 'a believed scan honours auto-solve');
  } finally {
    win.cubusFeed.useConnection(null);
    state.cube.trusted = false; state.cube.source = 'none'; state.cube.staleWhy = '';
    state.live = null; state.reported = null;
    win.location.hash = '#/settings';
    await tick();
    win.document.querySelector('[data-toggle="autosolve"]').click(); // back off — later tests assume it
    win.location.hash = '#/scan';
    await tick();
  }
});

// A static check, like the info-colour one: cascade mistakes leave every class-based test green.
test('the sticker hover ring yields to the editing halo in the cascade', () => {
  assert.ok(html.includes('.cell:not(:nth-child(5), .editing):hover'),
    'the hover selector must exclude .editing — the ring outweighs the halo otherwise');
});

// ---- the keyboard path -------------------------------------------------------------------------
//
// The 54 stickers were <i> elements with click handlers — pointer-only, the known debt the design
// README carried. They are buttons now, on ONE roving tab stop: Tab lands on the board once, the
// arrows walk the cells, Enter is the click the pointer would have made (a button's keyboard
// activation IS a click, so the delegated listener cannot tell the two apart), and the colour
// picker takes focus and hands it back. These pin the debt as PAID.

test('every sticker is a button with a name, and the board is a single tab stop', () => {
  const cells = all('.scan-face .cell');
  assert.equal(cells.length, 54);
  for (const c of cells) assert.equal(c.tagName, 'BUTTON', 'a sticker without a button is a sticker without a keyboard');
  assert.equal(cells.filter((c) => c.getAttribute('tabindex') === '0').length, 1,
    'ONE roving tab stop — 54 stops would make the board a chore to tab past');
  for (const c of cells) assert.ok(c.getAttribute('aria-label'), 'every cell carries a name');
  for (const t of all('.scan-face')) {
    assert.equal(t.getAttribute('role'), 'group', 'each side groups its nine stickers');
    assert.match(t.getAttribute('aria-label') ?? '', / side$/);
  }
});

test('the names carry the reading, and aria-disabled says what a press would do', () => {
  progress({ phase: 'scanning', message: '', captured: [face('R')], live: null, device: null, confirm: null });
  const rCells = all('.scan-face[data-face="R"] .tgrid > .cell');
  // A sticker is read as a COLOUR. "The Right side's colour" was the Western identity in a
  // sentence: it is red on every cube here, but blue is the back of most cubes and the bottom of
  // an older one, and the camera read a colour either way.
  assert.match(rCells[0].getAttribute('aria-label'), /Right side, sticker 1 — read as red/);
  assert.equal(rCells[0].getAttribute('aria-disabled'), 'false', 'a read sticker is correctable');
  assert.match(rCells[4].getAttribute('aria-label'), /Scan the Right side again/);
  assert.equal(rCells[4].getAttribute('aria-disabled'), 'false', 'a read centre re-reads its side');
  const uCells = all('.scan-face[data-face="U"] .tgrid > .cell');
  assert.match(uCells[0].getAttribute('aria-label'), /Up side, sticker 1 — not read yet/);
  assert.equal(uCells[0].getAttribute('aria-disabled'), 'true', 'a pending sticker refuses the press, and says so up front');
});

test('the arrows move the roving point by exactly one cell', () => {
  const roved = () => all('.scan-face .cell').find((c) => c.getAttribute('tabindex') === '0');
  const cells = all('.scan-face .cell');
  const before = roved();
  before.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const after = roved();
  assert.equal(cells.indexOf(after), cells.indexOf(before) + 1, 'ArrowRight walks one sticker');
  after.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(roved(), before, 'ArrowLeft walks back');
  before.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(cells.indexOf(roved()), cells.length - 1, 'End reaches the board’s last sticker');
  roved().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(cells.indexOf(roved()), 0, 'Home reaches the first');
});

test('activating a read sticker opens the picker with focus in it, and Escape hands focus back', () => {
  progress({ phase: 'scanning', message: '', captured: [face('R')], live: null, device: null, confirm: null });
  const cell = all('.scan-face[data-face="R"] .tgrid > .cell')[1];
  cell.click(); // the Enter path: keyboard activation of a button IS this click
  const pick = $('.swatches');
  assert.equal(pick.hidden, false, 'the picker opened');
  assert.ok(pick.contains(win.document.activeElement), 'focus moved into the picker — a keyboard user is not left stranded on the cell');
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(pick.hidden, true, 'Escape closes it');
  isSame(win.document.activeElement, cell, 'and hands focus back to the sticker that opened it');
});

// ---- the cube's colour arrangement, on the screen that reads it (ADR 0001) -------------------
//
// A tile is a POSITION and a capture is a COLOUR. On most cubes yellow is under white and the
// two coincide, which is exactly why the app assumed it for so long. These pin the cases where
// they come apart.

test('a scan that proves the Japanese colours moves the two tiles and is remembered', () => {
  // The blue capture belongs on the DOWN tile of a Japanese cube and the yellow one on the BACK
  // tile — the opposite of what the app assumed a moment earlier.
  const blue = { face: 'B', colors: Array(9).fill(5) };
  const yellow = { face: 'D', colors: Array(9).fill(3) };
  // 'scanning', not 'done': on 'done' the tiles deliberately leave their paint to the settle
  // turn, so that phase would assert nothing about which capture landed where.
  progress({
    phase: 'scanning', message: 'x', captured: [blue, yellow], live: null, confirm: null,
    scheme: 'japanese',
  });
  const down = all('.scan-face[data-face="D"] .tgrid > .cell');
  const back = all('.scan-face[data-face="B"] .tgrid > .cell');
  assert.equal(down[0].style.backgroundColor, NET_HEX.B, 'the DOWN tile shows the blue capture');
  assert.equal(back[0].style.backgroundColor, NET_HEX.D, 'and the BACK tile the yellow one');
  // …and the app remembers it, as evidence rather than as a preference.
  const stored = JSON.parse(win.localStorage.getItem('cubusSettings'));
  assert.equal(stored.scheme, 'japanese');
  assert.equal(stored.schemeSource, 'scan', 'a scan is evidence, and is recorded as such');
});

test('an undetermined scan changes nothing — it is not evidence', () => {
  const before = JSON.parse(win.localStorage.getItem('cubusSettings'));
  progress({
    phase: 'scanning', message: 'x', captured: [], live: null, confirm: null,
    scheme: 'undetermined',
  });
  const after = JSON.parse(win.localStorage.getItem('cubusSettings'));
  assert.equal(after.scheme, before.scheme, 'the state is known; the colours are not');
  assert.equal(after.schemeSource, before.schemeSource);
});

test('a refusal never establishes an arrangement', () => {
  const before = JSON.parse(win.localStorage.getItem('cubusSettings'));
  progress({
    phase: 'scanning', message: 'x', captured: [], live: null, confirm: null,
    notice: { title: 'Some stickers were misread', tone: 'err', body: 'b' },
  });
  const after = JSON.parse(win.localStorage.getItem('cubusSettings'));
  assert.equal(after.scheme, before.scheme);
  assert.equal(after.schemeSource, before.schemeSource);
});

// ---- what the screen leaves behind when it goes ------------------------------------------------
//
// A screen's listeners on `document` and on `navigator.mediaDevices` outlive its DOM unless the
// screen's abort signal takes them away, and an event already in flight at the scanner still lands
// after the navigation. Nothing on screen shows either mistake — the handlers run against a board
// that is no longer on the page — so each case keeps the OLD screen's parts, leaves, and asserts
// they heard nothing, after first proving on the live screen that the same event reaches them.
// Written before the screen is broken up into units (2026-09-13), so the units have to keep it.

/** Enter the scan screen fresh, from another one, and let it mount. */
const enterScan = async () => {
  win.cubusGo('viewer');
  await tick();
  win.location.hash = '#/scan';
  await tick();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(panel(), 'the scan screen mounted');
};
const leaveScan = async () => {
  win.cubusGo('viewer');
  await tick();
  assert.equal(panel(), null, 'the scan screen is gone');
};
/** A real cube: `alg` applied to a solved one, so cubejs accepts it and no search runs for ever. */
const cubeAfter = (alg) => {
  const c = new Cube();
  c.move(alg);
  return c.asString();
};

test('once the screen is gone, a click or an Escape on the page reaches none of its popovers', async () => {
  await enterScan();
  const camBtn = $('#scanCamBtn');
  const menu = $('.menu');
  camBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, false, 'the camera menu opened');
  win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, true, 'on the live screen, a click elsewhere closes the menu');
  camBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, false, 'opened again, to be left open');
  await leaveScan();
  win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(menu.hidden, false, "a click after leaving reached the old screen's camera menu");

  await enterScan();
  progress({ phase: 'scanning', message: '', captured: [face('R')], live: null, device: null, confirm: null });
  const pick = $('.swatches');
  const cell = () => all('.scan-face[data-face="R"] .tgrid > .cell')[1];
  cell().click();
  assert.equal(pick.hidden, false, 'the colour picker opened');
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(pick.hidden, true, 'on the live screen, Escape closes the picker');
  cell().click();
  assert.equal(pick.hidden, false, 'opened again, to be left open');
  await leaveScan();
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(pick.hidden, false, "an Escape after leaving reached the old screen's colour picker");
});

test('once the screen is gone, a camera coming or going no longer rebuilds its camera menu', async () => {
  // happy-dom has no mediaDevices, and the screen listens at mount, so the stand-in goes on first.
  const devices = new win.EventTarget();
  Object.defineProperty(win.navigator, 'mediaDevices', { value: devices, configurable: true });
  try {
    await enterScan();
    const old = panel();
    let asked = 0;
    old.cameras = async () => { asked += 1; return []; };
    devices.dispatchEvent(new win.Event('devicechange'));
    await tick();
    assert.equal(asked, 1, 'on the live screen, a device change asks the scanner for its cameras again');
    await leaveScan();
    devices.dispatchEvent(new win.Event('devicechange'));
    await tick();
    assert.equal(asked, 1, "a device change after leaving still drove the old screen's camera menu");
  } finally {
    delete win.navigator.mediaDevices;
  }
});

test('a scan that finishes after the screen is gone adopts nothing and moves no one', async () => {
  const { state } = await import('../lib/app.js');
  const live = cubeAfter('R U');
  const late = cubeAfter('F D');
  await enterScan();
  const old = panel();
  old.dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: live, valid: true, confidence: 1, lowConfidence: [] },
  }));
  assert.equal(state.cube.facelets, live, 'on the live screen, a finished scan is adopted');
  await leaveScan();
  const hash = win.location.hash;
  old.dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets: late, valid: true, confidence: 1, lowConfidence: [] },
  }));
  await tick();
  assert.equal(state.cube.facelets, live, 'a scan that landed after leaving was adopted as the cube in hand');
  assert.equal(win.location.hash, hash, 'a scan that landed after leaving navigated from a screen that is gone');
});

test('a scan that moves the colour arrangement says so once, and never over the scanner\'s notice', async () => {
  await enterScan();
  const title = () => $('#scanHowTitle').textContent;
  const body = () => $('#scanHow').textContent;
  const quiet = (message) => progress({ phase: 'scanning', message, captured: [], live: null, confirm: null });
  // A known starting belief, whatever the cases above left stored: settle on the Japanese colours
  // and let whatever that says pass.
  progress({ phase: 'scanning', message: 'x', captured: [], live: null, confirm: null, scheme: 'japanese' });
  quiet('x');

  progress({ phase: 'scanning', message: 'x', captured: [], live: null, confirm: null, scheme: 'western' });
  assert.equal(title(), 'Yellow under white', 'a scan that moved the belief says which colours it found');
  assert.match(body(), /^Your cube has yellow under white/);
  assert.ok($('#scanHow').classList.contains('ok'), 'and says it as good news');
  quiet('Show another side.');
  assert.equal(body(), 'Show another side.', 'the colour sentence was said twice');
  assert.equal(title(), 'How it works');

  progress({
    phase: 'scanning', message: 'x', captured: [], live: null, confirm: null, scheme: 'japanese',
    notice: { title: 'Hold it still', tone: 'info', body: 'Keep the side flat to the camera.' },
  });
  assert.equal(title(), 'Hold it still', "the colour sentence spoke over the scanner's notice");
  assert.equal(body(), 'Keep the side flat to the camera.');
  quiet('x');
  assert.equal(title(), 'Blue under white', 'a sentence a notice held back is said once the notice is gone');
  assert.match(body(), /^Your cube has blue under white/);
  quiet('Show another side.');
  assert.equal(title(), 'How it works', 'and it is said only that once');
});

// ---- the chip row, on the screen that draws it -------------------------------------------------
//
// stage-wiring.test.mjs reads the row's wiring as source, and stage-target.test.mjs drives its
// answers in a real browser. Neither pins, on this screen, what the row does when the scan under it
// stops being believed, or when a chip is pressed over a cube it was not drawn for. There is no
// worker here, so every question the row asks is refused and every chip is a dash — a state the row
// already has, and enough to hold what it does around its answers. The press that DOES walk comes
// first: it is what keeps the two presses that must not from passing over a click nothing heard.

/** A scan the screen believes, of the cube `alg` makes from solved, and the turns its row needs. */
const believedScan = async (alg = 'R U') => {
  const { settings } = await import('../lib/app-settings.js');
  assert.equal(Boolean(settings.autosolve), false, 'precondition: auto-solve is off, or a believed scan leaves the screen');
  const facelets = cubeAfter(alg);
  panel().dispatchEvent(new win.CustomEvent('scan-complete', {
    detail: { facelets, valid: true, confidence: 1, lowConfidence: [] },
  }));
  for (let i = 0; i < 5; i += 1) await tick();
  return facelets;
};

test('a believed scan draws the chip row; with nothing to ask, every chip is a dash and the row offers the whole solve', async () => {
  const { OFFERED_TARGETS } = await import('../lib/stage-targets.js');
  const { STAGE_COPY } = await import('../lib/stage-report.js');
  await enterScan();
  assert.equal($('#stageCard').hidden, true, 'no row before a scan: a number about a cube nobody has read is about nothing');
  await believedScan();
  assert.equal($('#stageCard').hidden, false, 'a believed scan draws the row');
  assert.deepEqual(all('.stage-chip').map((c) => c.dataset.target), OFFERED_TARGETS.map((x) => x.id),
    'one chip per offered target, in order');
  assert.deepEqual(all('.stage-chip .howfar').map((e) => e.textContent), OFFERED_TARGETS.map(() => '—'),
    'a question nobody could answer is a dash, never a number');
  assert.equal($('#stageSay').textContent, STAGE_COPY.offerSolve(), 'and the row offers the whole solve in its place');
});

test('a refusal takes the chip row away, whichever side of the scan refuses', async () => {
  await enterScan();
  await believedScan();
  assert.equal($('#stageCard').hidden, false, 'the row stands over a believed scan');
  panel().dispatchEvent(new win.CustomEvent('scan-invalid', { detail: {} }));
  assert.equal($('#stageCard').hidden, true, 'a scan the scanner refused kept the chip row on screen');
  await believedScan('F D');
  assert.equal($('#stageCard').hidden, false, 'the next believed scan draws it again');
  progress({ phase: 'scanning', message: 'x', captured: [face('R')], live: null, confirm: null, complete: false });
  assert.equal($('#stageCard').hidden, true, 'a scan that is no longer complete kept the chip row on screen');
});

test('a chip pressed on the row about the cube in hand takes its target to the cube screen', async () => {
  const { state } = await import('../lib/app.js');
  await enterScan();
  await believedScan();
  try {
    $('[data-target="two-layers"]').click();
    await tick();
    assert.equal(state.stageTarget, 'two-layers', 'the press carries its target');
    assert.equal(win.location.hash, '#/home', 'to the screen a walk lives on');
  } finally {
    // Off the cube screen before its walk is worked out, and the target back where the file expects it.
    win.cubusGo('viewer');
    await tick();
    state.stageTarget = 'solved';
  }
});

test('a chip pressed over a refused read walks nothing', async () => {
  const { state } = await import('../lib/app.js');
  await enterScan();
  await believedScan();
  const before = state.stageTarget;
  panel().dispatchEvent(new win.CustomEvent('scan-invalid', { detail: {} }));
  $('[data-target="two-layers"]').click();
  await tick();
  assert.equal(win.location.hash, '#/scan', 'a chip pressed over a refused read navigated');
  assert.equal(state.stageTarget, before, 'a chip pressed over a refused read set its target');
});

test('a chip pressed on a row about a cube that has since changed takes the row away instead of walking', async () => {
  const { state } = await import('../lib/app.js');
  const { adoptCube } = await import('../lib/cube-connection.js');
  await enterScan();
  await believedScan();
  const before = state.stageTarget;
  const card = $('#stageCard');
  // The subject replaced without the scan screen hearing of it: the call a smart cube's snapshot ends in.
  adoptCube(cubeAfter('F D'), { physical: true, source: 'cube' });
  $('[data-target="two-layers"]').click();
  await tick();
  assert.equal(win.location.hash, '#/scan', 'a chip about a cube nobody is holding navigated');
  assert.equal(state.stageTarget, before, 'a chip about a cube nobody is holding set its target');
  assert.equal(card.hidden, true, 'a row about a cube nobody is holding stayed on screen after a press');
});

// ---- the aside speaks the reader's language ----------------------------------------------------
//
// dev-docs/i18n.md lists the scan aside as wired: notices, completion copy, camera hints and
// titles. The repair's words were not — a title set as a raw literal, and the session's sentence
// written as it came — and nothing noticed, because English was right on screen and a raw string
// is invisible until a catalog exists. The first case proves the repair's words translate; the
// second holds every other write to the aside to the same rule, as router-wiring.test.mjs holds
// the Timer's say() calls.

test("the repair's words reach the aside in the reader's language — its title and its sentence both", async () => {
  const { state } = await import('../lib/app.js');
  const { registerLocale, setLocale } = await import('../lib/i18n.js');
  const S = 'UULUUFUUFRRUBRRURRFFDFFUFFFDDRDDDDDDBLLLLLLLLBRRBBBBBB';
  const OTHER = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  /** A scan that contradicts a cube tracking at S: the repair refuses, and the aside says so. */
  const contradict = async () => {
    await enterScan();
    win.cubusFeed.useConnection(fakeConn());
    try {
      win.cubusFeed.facelets(S);
      state.cube.trusted = true; state.cube.source = 'cube';
      panel().dispatchEvent(new win.CustomEvent('scan-complete', {
        detail: { facelets: OTHER, valid: true, confidence: 1, lowConfidence: [] },
      }));
      return { title: $('#scanHowTitle').textContent, body: $('#scanHow').textContent };
    } finally {
      win.cubusFeed.useConnection(null);
      state.cube.trusted = false; state.cube.source = 'none'; state.cube.staleWhy = '';
      state.live = null; state.reported = null;
    }
  };
  const english = await contradict();
  assert.match(english.body, /One of the two is wrong/, 'precondition: the contradiction was reported, in English');
  // The catalog is made from what the screen actually said, so no sentence is copied here to drift.
  registerLocale('qa', { [english.title]: '«title»', [english.body]: '«body»' });
  try {
    assert.equal(setLocale('qa'), true, 'precondition: the test catalog is active');
    const translated = await contradict();
    assert.equal(translated.title, '«title»', "the repair's title did not go through t()");
    assert.equal(translated.body, '«body»', "the repair's sentence did not go through t()");
  } finally {
    setLocale('en');
  }
});

test('every sentence the scan screen writes into its aside goes through t()', async () => {
  const { readdirSync } = await import('node:fs');
  const files = ['lib/screens/scan.js', ...readdirSync(new URL('../lib/screens/scan/', import.meta.url))
    .filter((f) => f.endsWith('.js')).map((f) => `lib/screens/scan/${f}`)];
  assert.ok(files.length >= 2, "precondition: the scan screen's own parts are read too");
  /** From `i`, past the string or template that opens there. */
  const pastQuote = (src, i) => {
    const q = src[i];
    let j = i + 1;
    while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  /** The right-hand side of an assignment whose `=` ends at `from`: up to its `;`, outside any
   *  bracket or string. */
  const rhsAt = (src, from) => {
    let depth = 0;
    for (let i = from; i < src.length;) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') { i = pastQuote(src, i); continue; }
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) depth -= 1;
      else if (c === ';' && depth === 0) return src.slice(from, i);
      i += 1;
    }
    throw new Error(`an assignment at ${from} never ends`);
  };
  /** The expression with every t(…) call replaced by a marker: what is inside one is translated
   *  by definition. */
  const withoutT = (expr) => {
    let s = expr;
    for (let at = s.search(/\bt\(/); at >= 0; at = s.search(/\bt\(/)) {
      let depth = 0;
      let i = at + 1;
      for (; i < s.length; i += 1) {
        if (s[i] === "'" || s[i] === '"' || s[i] === '`') { i = pastQuote(s, i) - 1; continue; }
        if (s[i] === '(') depth += 1;
        else if (s[i] === ')' && --depth === 0) break;
      }
      s = `${s.slice(0, at)}T${s.slice(i + 1)}`;
    }
    return s;
  };
  let seen = 0;
  const raw = [];
  for (const rel of files) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\b(sayTitle|say|hint|action)\.textContent = /g)) {
      seen += 1;
      const rhs = rhsAt(src, m.index + m[0].length);
      const left = withoutT(rhs).trim();
      // A sentence literal outside t(), or another module's words (a text, message, body, title
      // or label) read out and written as they came — the whole value, or one branch of a choice.
      // A read used only as a condition is not the value.
      const sentence = /['"`][A-Z]/.test(left);
      const handedOver = /^[\w$.?]+\.(text|message|body|title|label)$/.test(left)
        || /[?:]\s*[\w$.?]+\.(text|message|body|title|label)\b/.test(left);
      if (sentence || handedOver) raw.push(`${rel}: ${m[1]}.textContent = ${rhs.trim().slice(0, 80)}`);
    }
  }
  assert.ok(seen >= 20, `precondition: only ${seen} writes to the aside were found — the reader is looking in the wrong place`);
  assert.deepEqual(raw, [], `these writes to the scan screen's aside bypass t(): ${raw.join(' | ')}`);
});

// ---- the aside's quiet and toned paths ----------------------------------------------------------
//
// The card's words are pinned above for a notice, a finished scan and a camera error. A probe
// of the paths between them (2026-09-13, before the aside became its own unit) found four that
// nothing held: a report with nothing to say, the tone of a scan being checked, a notice's
// good-news tone, and the colour sentence waiting out a camera error. A fifth — the notice's
// action closing an open popover first — is not pinned, because it changes nothing observable:
// the click that runs it bubbles to the page's own listener, which closes the popover a moment
// later.

test('a report with nothing to say explains how the scan works, under "How it works"', async () => {
  await enterScan();
  progress({ phase: 'scanning', message: 'Show another side.', captured: [], live: null, confirm: null });
  assert.equal($('#scanHow').textContent, 'Show another side.', 'precondition: a message is said as it came');
  progress({ phase: 'scanning', message: '', captured: [], live: null, confirm: null });
  assert.match($('#scanHow').textContent, /no picture is kept/, 'a report with no message left the card saying nothing');
  assert.equal($('#scanHowTitle').textContent, 'How it works');
});

test('a scan being checked, or done, is said as good news — and scanning goes back to a plain voice', async () => {
  await enterScan();
  for (const phase of ['checking', 'done']) {
    progress({ phase, message: 'Checking…', captured: [], live: null, confirm: null });
    assert.ok($('#scanHow').classList.contains('ok'), `the ${phase} phase was not said as good news`);
  }
  progress({ phase: 'scanning', message: 'Show another side.', captured: [], live: null, confirm: null });
  assert.ok(!$('#scanHow').classList.contains('ok'), 'scanning kept the good-news tone');
});

test("a notice's tone is the card's tone — good news reads as good news", async () => {
  await enterScan();
  progress({ phase: 'scanning', message: '', captured: [], live: null, confirm: null,
    notice: { title: 'All six sides read', tone: 'ok', body: 'Checking the cube.' } });
  assert.ok($('#scanHow').classList.contains('ok'), 'a good-news notice was not said as one');
  assert.ok(!$('#scanHow').classList.contains('err'), 'and it is not said as an error');
});

test('the colour sentence waits out a camera error, and is said once the error has passed', async () => {
  await enterScan();
  const quiet = (message) => progress({ phase: 'scanning', message, captured: [], live: null, confirm: null });
  // A known starting belief, whatever the cases above left stored.
  progress({ phase: 'scanning', message: 'x', captured: [], live: null, confirm: null, scheme: 'japanese' });
  quiet('x');
  try {
    progress({ phase: 'error', message: 'Cannot start: Permission denied', captured: [], live: null, confirm: null,
      scheme: 'western' });
    assert.equal($('#scanHowTitle').textContent, 'Camera trouble', 'the colour sentence spoke over a camera error');
    assert.ok($('#scanHow').classList.contains('err'), 'and the error kept its tone');
    quiet('Show another side.');
    assert.equal($('#scanHowTitle').textContent, 'Yellow under white', 'a sentence an error held back is said once it has passed');
  } finally {
    progress({ phase: 'scanning', message: 'x', captured: [], live: null, confirm: null, scheme: 'japanese' });
    quiet('x');
  }
});

// ---- a scanner that never loads ----------------------------------------------------------------
//
// The screen waits 15 s for the scanner's bundle to register, then says it did not load and names
// the way out. A test cannot sit through that wait, so the clock is node:test's for this one case:
// the screen is on #/scan already, so go('scan') has no hash to change and mounts it again at
// once, and that mount's wait is the one the mocked clock runs out.

test('a scanner that never loads is said as trouble once its wait runs out, with the way out named', async () => {
  const { mock } = await import('node:test');
  await enterScan();
  const first = panel();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    win.cubusGo('scan');
    assert.ok(panel() && panel() !== first, 'precondition: the screen mounted again, under the mocked clock');
    assert.equal($('#scanHow').textContent, 'Loading the scanner…', 'precondition: the wait has begun');
    mock.timers.tick(15000);
    assert.equal($('#scanHowTitle').textContent, 'The scanner did not load', 'a scanner that never loaded was never said');
    assert.ok($('#scanHow').classList.contains('err'), 'a scanner that never loaded was not said as trouble');
    assert.match($('#scanHow').textContent, /Reloading the app/, 'and the way out is named');
  } finally {
    mock.timers.reset();
  }
});
