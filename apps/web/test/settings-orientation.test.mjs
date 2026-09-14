// The Settings screen's window-orientation row, driven directly
// (lib/screens/settings/window-orientation.js): the pills ask the Rust side which shape the window
// is, and tell it which to become. Nothing boots lib/app.js.
//
// A stand-in window keeps its shape the way lib.rs does — a set changes it when it is asked — and
// every answer waits until the case releases it, in the order the case chooses. What these pin
// (the 2026-09-13 audit):
//   * an answer that lands late cannot leave the pills naming a shape the window no longer has:
//     the pills are out of reach while a request is out, the read at mount included;
//   * a request that fails is said on the row, and leaves the pills pressable.

import assert from 'node:assert/strict';
import { test, before } from 'node:test';

import { Window } from 'happy-dom';

const tick = () => new Promise((r) => setTimeout(r, 0));

let win;
let wireOrientation;

before(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const k of ['window', 'document']) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  ({ wireOrientation } = await import('../lib/screens/settings/window-orientation.js'));
});

/** The row as Settings draws it. */
const drawRow = () => {
  win.document.body.innerHTML = `<div id="orientationPills">${['landscape', 'portrait']
    .map((o) => `<button class="pill" id="setOrientation-${o}" data-set-orientation="${o}" aria-pressed="false">${o}</button>`)
    .join('')}</div>`;
  return win.document.querySelector('#orientationPills');
};
const pill = (o) => win.document.querySelector(`[data-set-orientation="${o}"]`);
const pressedShapes = () => [...win.document.querySelectorAll('[data-set-orientation]')]
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.setOrientation);

/** A window whose shape a set changes at once, and whose answers wait for the case. */
const standIn = (shape) => {
  const w = {
    shape,
    out: [],
    invoke: (cmd, args) => {
      if (cmd === 'set_orientation') w.shape = args.orientation;
      const answer = w.shape;
      return new Promise((resolve, reject) => { w.out.push({ cmd, answer, resolve, reject }); });
    },
    release: async (i) => { w.out[i].resolve(w.out[i].answer); await tick(); },
  };
  win.__TAURI__ = { core: { invoke: w.invoke } };
  return w;
};

test('a press while the first read is out cannot leave the pills naming a shape the window is not', async () => {
  const w = standIn('landscape');
  wireOrientation(drawRow());
  assert.equal(w.out.length, 1, 'precondition: the row asked which shape the window is');
  pill('portrait').click();
  await tick();
  // Newest first: the order a slow read and a quick write can land in.
  for (let i = w.out.length - 1; i >= 0; i -= 1) await w.release(i);
  assert.deepEqual(pressedShapes(), [w.shape], 'the pills name a shape the window does not have');
});

test('a second press while the first is out cannot leave the pills naming a shape the window is not', async () => {
  const w = standIn('landscape');
  wireOrientation(drawRow());
  await w.release(0);
  assert.deepEqual(pressedShapes(), ['landscape'], 'precondition: the read marked the shape');
  pill('portrait').click();
  await tick();
  pill('landscape').click();
  await tick();
  for (let i = w.out.length - 1; i >= 1; i -= 1) await w.release(i);
  assert.deepEqual(pressedShapes(), [w.shape], 'the pills name a shape the window does not have');
});

test('a request that fails is said on the row, and leaves the pills pressable', async (t) => {
  t.mock.method(console, 'error', () => {});
  const w = standIn('landscape');
  const row = drawRow();
  wireOrientation(row);
  assert.ok(pill('landscape').disabled && pill('portrait').disabled,
    'the pills could be pressed before the window had said which shape it is');
  w.out[0].reject(new Error('no window (test)'));
  await tick();
  assert.match(row.title, /no window/, 'the failure was not said on the row');
  assert.ok(!pill('landscape').disabled && !pill('portrait').disabled, 'a failed read left the row out of reach for good');
});
