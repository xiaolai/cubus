// lib/foot-band.js: the band's measurements SETTLE (dev-docs/practice-redesign-plan.md E12.8).
//
// A version of the band asked the camera on every animation frame for as long as the page lived. In a browser that is
// a cost; in happy-dom it is a process that never ends: every whole-app suite in check:fast (die-press, hold-wiring,
// reconnect-flow, scan-screen, scramble-handoff, shapes-screen) spun at 10% CPU for three hours until it was killed.
// These cases hold the two ways a measurement can feed itself: the camera watch must stop on its own, and a reserve
// that keeps moving must throw rather than spin.
//
// The frames are driven by hand — `requestAnimationFrame` queues, `flush` runs one frame — so "it stops" is a count
// of frames, never a wait on a clock.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';

import { ORIENTATIONS } from '../lib/cube-orientation.js';
import { RESERVE_FITS_MOST, footBand } from '../lib/foot-band.js';
import { t as say } from '../lib/i18n.js';
import { holdSentence } from '../lib/solving-hold.js';
import { FOLLOW_SAYS, followNoteSentences } from '../lib/walk-follow.js';

/** A window whose frames run only when `flush` says, and whose ResizeObservers are inert. */
function harness() {
  const win = new Window();
  const queue = new Map();
  let next = 1;
  win.requestAnimationFrame = (fn) => { const id = next++; queue.set(id, fn); return id; };
  win.cancelAnimationFrame = (id) => { queue.delete(id); };
  win.ResizeObserver = class { observe() {} disconnect() {} };
  /** Run one frame: every callback queued before it. Returns how many ran. */
  const flush = () => {
    const due = [...queue.entries()];
    queue.clear();
    for (const [, fn] of due) fn(0);
    return due.length;
  };
  const doc = win.document;
  doc.body.innerHTML = `<div class="cols walking" style="--foot-band: band"><div class="card primary"><div class="slot"></div>
    <div class="row" role="status" hidden></div></div></div>`;
  const host = doc.querySelector('.cols');
  const card = doc.querySelector('.card');
  const row = doc.querySelector('.row');
  return { win, doc, host, card, row, queue, flush };
}

/** A stand-in for `<cubus-cube>`: a camera the band can ask, which never moves unless the case moves it. */
function standInCube(doc, { moving = false } = {}) {
  const el = doc.createElement('div');
  el.append(doc.createElement('canvas'));
  el.camera = { position: { x: 0, y: 0, z: 10 }, projectionMatrix: { elements: [1, 0, 0, 0, 0, 1] }, aspect: 1 };
  el.animating = moving;
  return el;
}

/** A stand-in cube whose sphere's bottom the band can project: the bottom of its canvas, wherever that is drawn. */
function projectingCube(doc) {
  const cube = standInCube(doc);
  const Vec = class {
    constructor() { this.y = -1; }
    applyMatrix4() { return this; }
    applyQuaternion() { return this; }
    addScaledVector() { return this; }
    project() { return this; }
  };
  cube.camera = { ...cube.camera, constructor: Vec, quaternion: {}, updateMatrixWorld() {} };
  cube.camera.position = new Vec();
  cube.camera.position.x = 0; cube.camera.position.z = 10;
  cube.root = { updateMatrixWorld() {}, matrixWorld: { getMaxScaleOnAxis: () => 1 } };
  return cube;
}

test('the camera is watched for a few frames after something that can move it, and then not at all', () => {
  const h = harness();
  try {
    const cube = standInCube(h.doc);
    h.card.querySelector('.slot').append(cube);
    const ctl = new AbortController();
    footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal });
    // Something that can move the camera: a row coming into the band.
    h.row.hidden = false;
    return Promise.resolve().then(() => {
      let frames = 0;
      while (h.flush() > 0) {
        frames += 1;
        assert.ok(frames < 20, 'the camera watch is still asking after 20 frames of a camera that never moved');
      }
      assert.equal(h.queue.size, 0, 'a frame is still queued once the camera has stood still');
      ctl.abort();
    });
  } finally {
    h.win.close();
  }
});

test('while the cube is moving the camera is watched, and never past a bound', () => {
  const h = harness();
  try {
    const cube = standInCube(h.doc, { moving: true }); // a cube that never stops moving
    h.card.querySelector('.slot').append(cube);
    const ctl = new AbortController();
    footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal });
    h.row.hidden = false;
    return Promise.resolve().then(() => {
      let frames = 0;
      while (h.flush() > 0) {
        frames += 1;
        if (frames > 2000) break;
      }
      assert.ok(frames > 20, `precondition: a moving cube is watched (${frames} frames)`);
      assert.ok(frames <= 1000, `the camera watch ran ${frames} frames for a cube that never stopped — it must end`);
      assert.equal(h.queue.size, 0, 'a frame is still queued after the bound');
      ctl.abort();
    });
  } finally {
    h.win.close();
  }
});

test('a reserve that keeps moving while the card keeps its size throws — it never spins quietly', () => {
  const h = harness();
  try {
    // The band needs 50px; the card is 1000px tall; the camera answers as if the cube never got any smaller, so every
    // fit asks for more. That is a measurement feeding itself, and it must be loud.
    h.win.HTMLElement.prototype.getBoundingClientRect = function rect() {
      const band = this.classList.contains('foot-band');
      const card = this.classList.contains('card');
      const height = band ? 50 : card ? 1000 : 0;
      return { top: 0, left: 0, right: 0, width: 0, height, bottom: card ? 0 : height };
    };
    const cube = projectingCube(h.doc);
    h.card.querySelector('.slot').append(cube);
    const ctl = new AbortController();
    const band = footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal,
      longest: () => [[{ row: h.row, text: 'The longest thing this band can say.' }]] });
    let thrown = null;
    for (let i = 0; i <= RESERVE_FITS_MOST + 2 && !thrown; i++) {
      try { band.remeasure(); } catch (e) { thrown = e; }
    }
    assert.ok(thrown, `the reserve moved ${RESERVE_FITS_MOST + 2} times without the card changing size, and nothing was said`);
    assert.match(thrown.message, /feeding itself/);
    ctl.abort();
  } finally {
    h.win.close();
  }
});

// THE HOLD SENTENCES ARE LAID OUT EVERY ONE (lib/walk-follow.js, E12.8). A hold sentence is many words, and a wider one
// is not always a taller one, because words wrap where they break; so the follow-note hands the band all 24, never the
// longest. These two cases hold that without a browser's widths: at today's widths no hold sentence is taller than the
// room, so the geometry gate alone passes with only the longest offered.

const HOLDS = [...new Set(ORIENTATIONS.map((h) => holdSentence(h)))];

test('the follow-note offers the band every hold sentence, whatever "longest" is measured by', () => {
  assert.equal(HOLDS.length, 24, `precondition: ${HOLDS.length} distinct hold sentences, not 24`);
  const want = HOLDS.map((h) => say(FOLLOW_SAYS.mismatch.text, h)).sort();
  for (const [name, widthOf] of [['characters', undefined], ['shortest is widest', (s) => -s.length], ['all one width', () => 1]]) {
    const got = followNoteSentences(widthOf ? { widthOf } : {}).filter((s) => s.key === 'mismatch').map((s) => s.text).sort();
    assert.deepEqual(got, want, `measured by ${name}: the band is not offered every hold sentence`);
  }
});

test('the band keeps the room for the tallest hold sentence when it is the SHORTEST by characters', () => {
  const tallest = HOLDS.reduce((a, b) => (b.length < a.length ? b : a));
  assert.ok(HOLDS.some((h) => h.length > tallest.length), 'precondition: the hold sentences are not all one length');
  const h = harness();
  try {
    // The probe band is 80px tall laying out the shortest hold sentence and 20px for anything else. The cube's canvas
    // ends 4px above the card's foot, so there is no room under it and the reserve the band asks for is what it needs.
    h.win.HTMLElement.prototype.getBoundingClientRect = function rect() {
      const box = (top, height) => ({ top, left: 0, right: 0, width: 0, height, bottom: top + height });
      if (this.tagName === 'CANVAS') return box(0, 100);
      if (this.classList.contains('card')) return { ...box(0, 1000), bottom: 104 };
      if (this.classList.contains('foot-band')) return box(0, this.textContent.includes(tallest) ? 80 : 20);
      return box(0, 0);
    };
    const cube = projectingCube(h.doc);
    h.card.querySelector('.slot').append(cube);
    const ctl = new AbortController();
    const states = followNoteSentences().map(({ text, info }) => [{ row: h.row, text, info }]);
    const band = footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal, longest: () => states });
    band.remeasure();
    assert.equal(h.card.style.getPropertyValue('--band-reserve'), '80px',
      'the room under the cube is not kept for the tallest thing the follow-note can say');
    ctl.abort();
  } finally {
    h.win.close();
  }
});
