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
  assert.equal(sug[0].dataset.face, 'B', 'colour class 5 is Back/blue');
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
  assert.equal($('#scanState'), null, 'the 54-char string belongs on the Cube screen, with its Copy button');
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
  const swatch = $('.swatches button[data-face="R"]');
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
  win.cubusFeed.useConnection({ requestBattery: async () => ({ level: 60 }) });
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
  win.cubusFeed.useConnection({ requestBattery: async () => ({ level: 60 }) });
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
  win.cubusFeed.useConnection(null);
  state.cube.trusted = false; state.cube.source = 'none'; state.cube.staleWhy = '';
  state.live = null; state.reported = null;
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
    win.cubusFeed.useConnection({ requestBattery: async () => ({ level: 60 }) });
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
  assert.match(rCells[0].getAttribute('aria-label'), /Right side, sticker 1 — read as the Right side’s colour/);
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
  assert.equal(win.document.activeElement, cell, 'and hands focus back to the sticker that opened it');
});
