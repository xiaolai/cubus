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
  // an "Opening the camera…" it cannot deliver.
  assert.equal($('#scanMsg').textContent, 'Loading the scanner…');
});

test('the six sides start pending, with nothing captured', () => {
  const tiles = all('.scan-face');
  assert.equal(tiles.length, 6);
  assert.deepEqual(tiles.map((t) => t.dataset.face), FACES);
  assert.equal(tiles.filter((t) => t.classList.contains('done')).length, 0);
  assert.equal($('#scanCount').textContent, '0 / 6 sides');
  assert.equal($('#scanBar').style.width, '0%');
});

test('progress marks exactly the captured sides and moves the count', () => {
  progress({ phase: 'scanning', message: 'Got the Front side — 2/6. Show another side…',
    captured: [face('R'), face('F')], live: null });
  const done = all('.scan-face').filter((t) => t.classList.contains('done'));
  assert.deepEqual(done.map((t) => t.dataset.face), ['R', 'F']);
  assert.equal($('#scanCount').textContent, '2 / 6 sides');
  assert.equal($('#scanBar').style.width, `${(2 / 6) * 100}%`);
  assert.equal($('#scanMsg').textContent, 'Got the Front side — 2/6. Show another side…');
});

test('the live 3x3 is the viewfinder: lit while a side is in view, dim when it is not', () => {
  progress({ phase: 'scanning', message: 'Reading a side — hold still…',
    captured: [face('R'), face('F')], live: Array(9).fill(0) });
  assert.ok($('#scanLive').classList.contains('reading'));
  progress({ phase: 'scanning', message: 'Show any side to the camera — point a side at the camera…',
    captured: [face('R'), face('F')], live: null });
  assert.ok(!$('#scanLive').classList.contains('reading'));
});

test('a restart un-captures the sides again rather than leaving them marked done', () => {
  progress({ phase: 'scanning', message: 'Show any side to the camera — held flat and centred.',
    captured: [], live: null });
  assert.equal(all('.scan-face.done').length, 0);
  assert.equal($('#scanCount').textContent, '0 / 6 sides');
});

test('a failure surfaces on the screen and offers a retry', () => {
  progress({ phase: 'error', message: 'Cannot start: Permission denied', captured: [], live: null });
  assert.ok($('#scanMsg').classList.contains('err'), 'an error must read as one');
  assert.equal($('#scanMsg').textContent, 'Cannot start: Permission denied');
  assert.equal($('#scanRedo').textContent, 'Try again');
});

// Which camera answered matters more here than anywhere, because the pane shows no picture: a
// Continuity Camera (an iPhone) or a virtual camera looks exactly like a broken one.
test('a stored camera choice is pinned as an attribute, not a property', () => {
  // An attribute survives the custom-element upgrade; a property set before it would be clobbered
  // by the element's own class field, and the pin would silently do nothing.
  assert.equal(panel().getAttribute('device-id'), 'stored-cam');
});

test('the pane offers a camera picker', () => {
  const cam = $('#scanCam');
  assert.ok(cam, 'there must be a way to change camera');
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
  assert.equal($('.scan-cam').hidden, false, 'two cameras — the choice must be offered');
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
  assert.equal($('.scan-cam').hidden, true, 'one camera and no pin — nothing to choose between');
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
