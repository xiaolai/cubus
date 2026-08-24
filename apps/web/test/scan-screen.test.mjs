// The Camera scan screen: the camera opens with the screen, and the six-face scan happens on the
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

test('the pane offers a camera picker, and a webcam button that always stays', () => {
  const cam = $('#scanCam');
  assert.ok(cam, 'there must be a way to change camera');
  // The button is the camera's status light and the way back from a refusal, so it is never
  // conditional — unlike the picker beside it.
  assert.ok($('#scanCamBtn'), 'the webcam button must be present');
  assert.equal(cam.options[0].value, '', 'the first option means "let the platform choose"');
  assert.equal(cam.options[0].textContent, 'Default camera');
});

test('the picker names the camera that actually answered', async () => {
  panel().cameras = async () => [
    { deviceId: 'builtin', label: 'MacBook Air Camera' },
    { deviceId: 'iphone', label: 'iPhone Camera' }, // a Continuity Camera, the case that started this
  ];
  progress({ phase: 'scanning', message: 'Show any side to the camera — held flat and centred.',
    captured: [], live: null, device: { deviceId: 'builtin', label: 'MacBook Air Camera' } });
  await tick();
  const cam = $('#scanCam');
  assert.deepEqual([...cam.options].map((o) => o.textContent),
    ['Default camera', 'MacBook Air Camera', 'iPhone Camera']);
  assert.equal(cam.value, 'builtin', 'the live camera must be the one shown as selected');
  assert.ok($('.scan-cam').classList.contains('pick'), 'two cameras — the choice must be offered');
});

test('the picker hides when there is only one camera and nothing pinned', async () => {
  const cam = $('#scanCam');
  cam.value = ''; // "Default camera" — hand the choice back to the platform
  cam.dispatchEvent(new win.Event('change'));
  assert.equal(panel().hasAttribute('device-id'), false, 'choosing the default must clear the pin');
  panel().cameras = async () => [{ deviceId: 'solo', label: 'MacBook Air Camera' }];
  progress({ phase: 'scanning', message: 'Show any side to the camera — held flat and centred.',
    captured: [], live: null, device: { deviceId: 'solo', label: 'MacBook Air Camera' } });
  await tick();
  assert.ok(!$('.scan-cam').classList.contains('pick'), 'one camera and no pin — nothing to choose');
  assert.ok($('#scanCamBtn'), 'but the webcam button stays');
});

test('a live camera missing from the list falls back to Default rather than rendering blank', async () => {
  panel().cameras = async () => [{ deviceId: 'a', label: 'Camera A' }, { deviceId: 'b', label: 'Camera B' }];
  progress({ phase: 'scanning', message: 'Show any side to the camera — held flat and centred.',
    captured: [], live: null, device: { deviceId: 'not-in-the-list', label: 'Ghost' } });
  await tick();
  const cam = $('#scanCam');
  assert.equal(cam.value, '', 'an unknown value selects nothing and the control renders empty');
  assert.equal(cam.selectedOptions[0].textContent, 'Default camera');
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

test('the centre sticker is not correctable — it names the face', () => {
  const calls = [];
  panel().setSticker = (...args) => calls.push(args);
  all('.scan-face[data-face="R"] .tile > i')[4].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true, 'no picker for the centre');
  assert.deepEqual(calls, []);
});

test('a side with nothing read yet has nothing to correct', () => {
  all('.scan-face[data-face="B"] .tile > i')[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal($('.swatches').hidden, true);
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
