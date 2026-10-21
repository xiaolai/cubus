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
    constructor() { this.y = cube.sphereY ?? -1; }
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
    const band = footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal, closest: () => 0,
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
    // ends 4px above the card's foot, so there is no room under it and the reserve the band asks for is what it needs;
    // the slot gives the reserve from the canvas's foot, as the card's padding does.
    const reserve = () => Number.parseFloat(h.card.style.getPropertyValue('--band-reserve')) || 0;
    h.win.HTMLElement.prototype.getBoundingClientRect = function rect() {
      const box = (top, height) => ({ top, left: 0, right: 0, width: 0, height, bottom: top + height });
      if (this.tagName === 'CANVAS') return box(0, 100 - reserve());
      if (this.classList.contains('card')) return { ...box(0, 1000), bottom: 104 };
      if (this.classList.contains('foot-band')) return box(0, this.textContent.includes(tallest) ? 80 : 20);
      return box(0, 0);
    };
    const cube = projectingCube(h.doc);
    h.card.querySelector('.slot').append(cube);
    const ctl = new AbortController();
    const states = followNoteSentences().map(({ text, info }) => [{ row: h.row, text, info }]);
    // The closest framing ends the sphere at the foot of the canvas it is asked about — the slot a reserve would leave
    // is that much shorter (lib/foot-band.js solves the reserve from it).
    const band = footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal, longest: () => states,
      closest: (el, at) => { const b = at ?? el.querySelector('canvas').getBoundingClientRect(); return b.top + b.height; } });
    band.remeasure();
    assert.equal(h.card.style.getPropertyValue('--band-reserve'), '80px',
      'the room under the cube is not kept for the tallest thing the follow-note can say');
    ctl.abort();
  } finally {
    h.win.close();
  }
});

// THE RESERVE IS THE SCREEN'S, NOT THE WALK'S (sweep 2026-10-20, A1). A turned-over walk is framed from further back, so
// its cube's sphere ends higher and the room under it is larger: the reserve sized by THAT camera was 39 px under a
// lesson on the iPhone SE against 48 under a Quick walk in the same card. MUST NOT: a reserve that follows the camera.
test('the reserve is sized by the closest framing, never by the camera the walk has now', () => {
  /** The reserve a band settles on for a cube whose camera ends its sphere at `sphereY` (NDC; -1 is the canvas foot). */
  const settle = (sphereY) => {
    const h = harness();
    try {
      // The card ends at 104 and its slot gives the reserve: the canvas is 0 to 100 less the reserve. The closest
      // framing's sphere ends at the canvas's foot; the camera the walk has now ends it at `sphereY`.
      const reserve = () => Number.parseFloat(h.card.style.getPropertyValue('--band-reserve')) || 0;
      h.win.HTMLElement.prototype.getBoundingClientRect = function rect() {
        const box = (top, height) => ({ top, left: 0, right: 0, width: 0, height, bottom: top + height });
        if (this.tagName === 'CANVAS') return box(0, 100 - reserve());
        if (this.classList.contains('card')) return { ...box(0, 1000), bottom: 104 };
        if (this.classList.contains('foot-band')) return box(0, 50);
        return box(0, 0);
      };
      const cube = projectingCube(h.doc);
      cube.sphereY = sphereY;
      h.card.querySelector('.slot').append(cube);
      const ctl = new AbortController();
      const band = footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal,
        closest: () => 100 - reserve(), longest: () => [[{ row: h.row, text: 'The longest thing this band can say.' }]] });
      band.remeasure();
      band.remeasure();
      const settled = reserve();
      ctl.abort();
      return settled;
    } finally {
      h.win.close();
    }
  };
  const upright = settle(-1);
  assert.equal(upright, 50, 'precondition: the reserve is what the band needs below the closest framing');
  // A walk that turns the cube over is framed from further back: its sphere ends at 60 of the canvas's 100.
  assert.equal(settle(-0.2), upright, 'the reserve followed the walk\'s camera');
});

// THE RESERVE IS SOLVED IN ONE FIT, NOT STEPPED TO OVER FRAMES (CI 39607667813, 2026-10-21). The canvas's aspect changes
// with its height, so where the fit ends the sphere is not a straight line in the reserve: one linear step a frame
// undershot, and on the iPhone SE a Quick walk was drawn with 26px kept and a 304px cube, then 168ms later with 48 and
// 220. Modelled here: the sphere ends at a share of the canvas that grows as the canvas gets shorter. MUST NOT: a
// reserve that a second fit changes, once the first has been taken.
test('the first fit takes the whole reserve: a later fit, once the slot has its size, changes nothing', () => {
  const h = harness();
  try {
    const reserve = () => Number.parseFloat(h.card.style.getPropertyValue('--band-reserve')) || 0;
    h.win.HTMLElement.prototype.getBoundingClientRect = function rect() {
      const box = (top, height) => ({ top, left: 0, right: 0, width: 0, height, bottom: top + height });
      if (this.tagName === 'CANVAS') return box(0, 100 - reserve());
      if (this.classList.contains('card')) return { ...box(0, 1000), bottom: 104 };
      if (this.classList.contains('foot-band')) return box(0, 50);
      return box(0, 0);
    };
    // The closest framing in a canvas `height` tall ends its sphere at 0.6 of it, and 0.003 further down for every px
    // the canvas is shorter than 100. The band needs 50 and keeps 4 clear, within the half px every fit allows: a canvas
    // of 74px ends the sphere at 50.17, so the least reserve is 26. One linear step from 0 asks for 17.
    const sphereAt = (b) => b.top + b.height * (0.6 + 0.003 * (100 - b.height));
    const cube = projectingCube(h.doc);
    h.card.querySelector('.slot').append(cube);
    const ctl = new AbortController();
    const band = footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal,
      closest: (el, at) => sphereAt(at ?? el.querySelector('canvas').getBoundingClientRect()),
      longest: () => [[{ row: h.row, text: 'The longest thing this band can say.' }]] });
    band.remeasure();
    const first = reserve();
    band.remeasure();
    band.remeasure();
    assert.equal(reserve(), first, `the reserve moved after the first fit: ${first}px, then ${reserve()}px`);
    assert.equal(first, 26, 'the first fit did not take the least reserve that holds the band');
    ctl.abort();
  } finally {
    h.win.close();
  }
});

// A CARD THAT CHANGES SIZE IS FITTED IN THE SAME TURN (CI 39607667813, 2026-10-21). A card's resize was fitted on the
// next frame, to let the renderer fit its camera first; but the reserve is solved from the closest framing, worked out
// here, and in that frame the page was drawn with the old card's reserve — on the iPhone SE a Quick walk arrived with
// 25px kept where 47 were needed, and its cube shrank 243 → 221 a frame later. MUST NOT: a card resize that leaves the
// reserve as it was until a frame has passed.
test('a card that changes size has its reserve fitted before any frame is drawn', () => {
  const h = harness();
  try {
    const observers = [];
    h.win.ResizeObserver = class { constructor(cb) { this.cb = cb; this.els = []; observers.push(this); } observe(el) { this.els.push(el); } disconnect() {} };
    const reserve = () => Number.parseFloat(h.card.style.getPropertyValue('--band-reserve')) || 0;
    let cardBottom = 104;
    h.win.HTMLElement.prototype.getBoundingClientRect = function rect() {
      const box = (top, height) => ({ top, left: 0, right: 0, width: 0, height, bottom: top + height });
      if (this.tagName === 'CANVAS') return box(0, cardBottom - 4 - reserve());
      if (this.classList.contains('card')) return { ...box(0, cardBottom), bottom: cardBottom };
      if (this.classList.contains('foot-band')) return box(0, 50);
      return box(0, 0);
    };
    const cube = projectingCube(h.doc);
    h.card.querySelector('.slot').append(cube);
    const ctl = new AbortController();
    // The sphere ends 0.8 of the way down its canvas: a band of 50 needs 37px of a 104px card and 42 of an 84px one.
    footBand({ host: h.host, card: h.card, cube: () => cube, rows: [h.row], signal: ctl.signal,
      closest: (el, at) => { const b = at ?? el.querySelector('canvas').getBoundingClientRect(); return b.top + 0.8 * b.height; },
      longest: () => [[{ row: h.row, text: 'The longest thing this band can say.' }]] });
    const cardWatch = observers.find((o) => o.els.includes(h.card));
    assert.ok(cardWatch, 'precondition: the band watches its card');
    // An observer reports once as it starts observing; then every frame queued runs.
    cardWatch.cb([]);
    while (h.flush()) { /* settle */ }
    assert.equal(reserve(), 37, 'precondition: the band settled on the 104px card');
    cardBottom = 84;
    cardWatch.cb([]);
    assert.equal(reserve(), 42, `the card shrank and the reserve is still ${reserve()}px until a frame has passed`);
    ctl.abort();
  } finally {
    h.win.close();
  }
});
