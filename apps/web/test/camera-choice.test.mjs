// Choosing a camera, through the scanner the app ships.
//
// test/scan-screen.test.mjs drives the scan screen with <ai-scan-panel> left inert and its methods
// replaced, so its camera cases pin the calls the menu makes and never what those calls do: none of
// them could see a chosen camera fail to open (found by audit, 2026-09-13). Here the vendored
// scanner (vendor/ai-scan-panel.js) is registered before the app draws a screen, and its detector
// is replaced through the scanner's own seam, `useDetector`, before the panel's autostart has run.
// A choice then goes through the scanner's start(), its fallback from a camera that will not open,
// and its reports; what is asserted is which camera the platform was asked for, which one is open,
// and what the screen says about it.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let win;
let settings;
const $ = (sel) => win.document.querySelector(sel);
const panel = () => $('#stage ai-scan-panel');

const CAMERAS = Object.freeze([
  { deviceId: 'builtin', label: 'MacBook Air Camera' },
  { deviceId: 'iphone', label: 'iPhone Camera' },
  { deviceId: 'virtual', label: 'Virtual Camera' },
]);
/** A frame with no cube in it: the scan goes on looking, and no clock runs out on the camera. */
const NO_CUBE = Object.freeze({ data: new Float32Array(10 * 9), anchors: 9, rows: 10 });

/** An error named the way getUserMedia names its refusals. */
const refusal = (name) => Object.assign(new Error(`${name} (test)`), { name });

/**
 * The platform's cameras, as the scanner's Detector seam reaches them. The last open to SETTLE
 * holds the camera, as in packages/cube-scanner's own fake detector: one kinder than the weakest
 * real detector could not show the scanner's ordering being needed.
 */
class FakeCameras {
  device = null;
  /** Every camera asked for, in order: its deviceId, or null for the platform's default. */
  asked = [];
  /** A deviceId, null for the default or '*' for every open, and the error that open throws. */
  refuse = new Map();
  #holds = new Map();

  async use(opts = {}) {
    const id = opts.deviceId ?? null;
    this.asked.push(id);
    await this.#holds.get(id);
    const err = this.refuse.get(id) ?? this.refuse.get('*');
    if (err) throw err;
    const found = id === null ? CAMERAS[0] : CAMERAS.find((d) => d.deviceId === id);
    if (!found) throw refusal('OverconstrainedError');
    this.device = found;
  }

  async load() {}

  async next() { return this.device ? NO_CUBE : null; }

  async cameras() { return CAMERAS; }

  stop() { this.device = null; }

  /** Hold the open of `id` until the function this returns is called. */
  hold(id) {
    let release;
    this.#holds.set(id, new Promise((resolve) => { release = resolve; }));
    return () => { this.#holds.delete(id); release(); };
  }
}

/** Every report the mounted scanner has made: its phase, and the camera it said was open. */
let reports = [];

/**
 * Wait up to two seconds for `ready` — the scanner's answer arriving, never the claim a case goes
 * on to assert. It does not throw: an answer that never comes is said by the assertions after it.
 */
const until = async (ready) => {
  const end = Date.now() + 2000;
  while (!ready() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
};
/** The scanner has answered what was asked after report `since`: a camera running, or an error. */
const answered = (since) => () => reports.slice(since)
  .some((r) => r.phase === 'error' || (r.phase === 'scanning' && r.device !== null));

/**
 * Draw the scan screen again, its scanner opening `cameras`, and wait for the default camera.
 *
 * The address is already #/scan, so go() draws the screen at once rather than on a hashchange, and
 * the detector is in place before the autostart the panel's connect queued has run.
 */
const mountWith = async (cameras) => {
  assert.equal(win.location.hash, '#/scan', 'precondition: the screen would be drawn on a hashchange');
  settings.cameraId = ''; // no stored choice, so the autostart asks for the platform's default
  win.cubusGo('scan');
  panel().useDetector(cameras, 'web');
  reports = [];
  panel().addEventListener('scan-progress', (e) => {
    reports.push({ phase: e.detail.phase, device: e.detail.device?.deviceId ?? null });
  });
  await until(answered(0), 'the scanner opened its first camera');
  assert.deepEqual(cameras.asked, [null], 'precondition: the autostart opened the default camera, once');
};

const openMenu = async () => {
  $('#scanCamBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
};
const choose = (id) => {
  $(`.menu [data-value="${id}"]`).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
};
const ticked = () => [...win.document.querySelectorAll('.menu [aria-checked="true"]')].map((b) => b.textContent);

before(async () => {
  win = new Window({
    url: 'http://localhost/#/scan',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'customElements', 'HTMLElement', 'CustomEvent', 'requestAnimationFrame',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../vendor/ai-scan-panel.js');
  // The screen drawn at boot opens the platform's own cameras, which this window has none of; the
  // first case draws it again over a detector of its own, so what the boot says is not this file's.
  const { warn } = console;
  console.warn = () => {};
  try {
    await import('../lib/app.js');
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    console.warn = warn;
  }
  ({ settings } = await import('../lib/app-settings.js'));
});

after(async () => {
  win.cubusGo('home'); // the scanner's loop and its camera leave with the screen
  await tick();
  await win.happyDOM.close();
});

test('choosing a camera opens that camera, and the screen names and ticks it as the one running', async () => {
  const cameras = new FakeCameras();
  await mountWith(cameras);
  await openMenu();
  const since = reports.length;
  choose('iphone');
  await until(answered(since), 'the scanner answered the choice');
  assert.deepEqual(cameras.asked.slice(1), ['iphone'], 'the scanner did not ask the platform for the chosen camera');
  assert.equal(cameras.device?.deviceId, 'iphone', 'the camera open is not the one that was chosen');
  assert.equal($('#scanCamBtn').title, 'iPhone Camera — camera and scan', 'the webcam button does not name the camera now running');
  await openMenu();
  assert.deepEqual(ticked(), ['iPhone Camera'], 'the menu does not tick the camera now running');
});

test('choosing a camera while painting opens that camera once, as painting ends', async () => {
  const cameras = new FakeCameras();
  await mountWith(cameras);
  $('#scanPaintBtn').click();
  assert.equal(cameras.device, null, 'precondition: painting released the camera');
  await openMenu();
  const since = reports.length;
  choose('iphone');
  await until(answered(since), 'the scanner answered the choice');
  assert.equal($('#scanPaintBtn').title, 'Paint the cube by hand instead of scanning it', 'choosing a camera left painting on');
  assert.deepEqual(cameras.asked.slice(1), ['iphone'], 'leaving painting did not open the chosen camera, exactly once');
  assert.equal(cameras.device?.deviceId, 'iphone', 'the camera open after painting is not the one chosen');
});

test('a chosen camera that will not open falls back to the default, keeps the choice, and ticks the camera that answered', async () => {
  const cameras = new FakeCameras();
  cameras.refuse.set('iphone', refusal('NotReadableError'));
  await mountWith(cameras);
  await openMenu();
  const since = reports.length;
  choose('iphone');
  await until(answered(since), 'the scanner answered the choice');
  assert.deepEqual(cameras.asked.slice(1), ['iphone', null], 'the scanner did not fall back to the default camera');
  assert.equal(cameras.device?.deviceId, 'builtin', 'no camera is open after the fallback');
  assert.equal(panel().getAttribute('device-id'), 'iphone', 'the choice was dropped, so it is not tried again when it returns');
  assert.equal($('#scanCamBtn').title, 'MacBook Air Camera — camera and scan', 'the webcam button does not name the camera that answered');
  await openMenu();
  assert.deepEqual(ticked(), ['MacBook Air Camera'], 'the tick is not on the camera that answered');
});

test('a camera that refuses outright leaves the webcam button dark, and no rejection goes unhandled', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const cameras = new FakeCameras();
  await mountWith(cameras);
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(String(reason)); };
  process.on('unhandledRejection', onUnhandled);
  try {
    cameras.refuse.set('*', refusal('NotAllowedError'));
    await openMenu();
    const since = reports.length;
    choose('iphone');
    await until(answered(since), 'the scanner answered the choice');
    await tick();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, [], 'a refused open escaped as an unhandled rejection');
  assert.equal(cameras.device, null, 'a camera is open after every open was refused');
  assert.ok(!$('.scan-cam').classList.contains('on'), 'the lens reads as live over a camera that refused');
  assert.match($('#scanCamBtn').title, /click to turn it on/, 'the webcam button does not say the camera is off');
  assert.equal($('#scanHowTitle').textContent, 'The camera did not open', "the scanner's refusal is not said in the aside");
});

test('two cameras chosen in quick succession leave the second open, and the first is never shown as running', async () => {
  const cameras = new FakeCameras();
  await mountWith(cameras);
  const releaseFirst = cameras.hold('iphone');
  await openMenu();
  const since = reports.length;
  choose('iphone'); // its open waits on the platform…
  await tick();
  await openMenu();
  choose('virtual'); // …and is overtaken before it lands
  releaseFirst();
  await until(() => reports.slice(since).some((r) => r.phase === 'scanning' && r.device !== null),
    'a camera answered');
  await tick();
  assert.deepEqual(cameras.asked.slice(1), ['iphone', 'virtual'], 'the platform was not asked for both cameras, in order');
  assert.equal(cameras.device?.deviceId, 'virtual', 'the overtaken choice, landing late, holds the camera');
  assert.deepEqual(reports.slice(since).filter((r) => r.device === 'iphone'), [], 'the overtaken choice was reported as the camera running');
  assert.equal($('#scanCamBtn').title, 'Virtual Camera — camera and scan', 'the webcam button does not name the last camera chosen');
  assert.equal(JSON.parse(win.localStorage.getItem('cubusSettings')).cameraId, 'virtual', 'the stored choice is not the last one made');
  await openMenu();
  assert.deepEqual(ticked(), ['Virtual Camera'], 'the tick is not on the last camera chosen');
});
