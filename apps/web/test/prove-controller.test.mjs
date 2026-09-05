// The native proof's lifecycle, and the one thing two proofs share: the buttons.
//
// `runProof` is one press's whole story — the readiness wait, the table generation, the proof, and
// exactly one cleanup path in a `finally`. That cleanup hid the stop button and cleared its
// handler unconditionally, and a proof's cleanup can land long AFTER a newer proof has taken those
// controls over: a status reply that arrives late, a retarget that replaces the walk, a press on
// the new one. The old proof then reached its `finally` and disarmed the new proof's stop — minutes
// to hours of native work with nothing on screen able to end it (found by audit, 2026-09-05).
//
// Driven through the real screen, with a fake native side whose replies this file controls. The
// command surface is installed AFTER boot on purpose: `capability()` asks for it on every call, so
// the proof seam sees a desktop while nothing else in the app is told it is running under Tauri.

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** A promise this file decides the fate of. The whole point of the fixture: the two proofs have to
 *  finish in the wrong order, because that is the ordering the defect lives in. */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

let win;
const $ = (sel) => win.document.querySelector(sel);

/** Poll until `fn()` is true. A press of the die is a real search, on this thread. */
const waitFor = async (fn, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await settle(20);
  }
  return false;
};

/** The fake native side. `statusGate`, when set, is what `optimal_status` waits on — that is the
 *  late reply. `optimal_prove` never settles unless a cancel arrives, which is what a long proof
 *  looks like from here. */
const native = {
  calls: [],
  statusGate: null,
  proving: null,
};
const invoke = (cmd) => {
  native.calls.push(cmd);
  if (cmd === 'optimal_status') {
    return native.statusGate ? native.statusGate.promise.then(() => 'ready') : Promise.resolve('ready');
  }
  if (cmd === 'optimal_prove') {
    native.proving = deferred();
    return native.proving.promise;
  }
  if (cmd === 'optimal_cancel') {
    native.proving?.reject(new Error('optimal: cancelled'));
    native.proving = null;
    return Promise.resolve();
  }
  return Promise.resolve(null);
};

const proveBtn = () => $('#proveBtn');
const cancelBtn = () => $('#proveCancel');

/** Roll a new subject on Home and wait until its walk offers a proof.
 *
 *  The DIE's own release is waited for, not only the button. One press produces TWO walk loads —
 *  adopting the cube refreshes the screen, and the press's own solve refreshes it again — and the
 *  second one issues a cancel that lands wherever it lands. Returning at the first proof button
 *  put that cancel between the next proof's request and the native side, which the queue then
 *  correctly refused: a test that raced the app instead of driving it. */
const newWalkWithProof = async () => {
  const die = $('#randCube');
  assert.ok(die, 'precondition: the dev die is on the solve screen');
  die.click();
  const ready = await waitFor(() =>
    !$('#randCube').disabled && proveBtn() && !proveBtn().hidden && !proveBtn().disabled);
  assert.ok(ready, 'no walk offered a proof — the capability gate or the die is not wired here');
  await settle(60); // and let the press's last refresh finish before anything else is asked for
};

before(async () => {
  win = new Window({
    // The platform pin, which is what makes the desktop-only gate deterministic rather than a
    // question about whichever user-agent the harness reports.
    url: 'http://localhost/?platform=macos#/home',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      fetch: { disableSameOriginPolicy: true },
    },
  });
  win.document.write(html);
  win.localStorage.setItem('cubusSettings', JSON.stringify({
    theme: 'auto', palette: 'muted', autosolve: false, cameraId: '', navHidden: [],
    navDefaults: 99, devRandCube: true, language: '', dragRotate: false, solveTier: 'twenty',
    proveMinimum: true,
  }));
  for (const k of [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'customElements', 'HTMLElement', 'CustomEvent',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  ]) {
    Object.defineProperty(globalThis, k, { value: win[k], writable: true, configurable: true });
  }
  await import('../lib/app.js');
  await tick();
  await settle(1500); // the solver loads in the background, and the die does nothing without it
  win.__TAURI__ = { core: { invoke }, event: { listen: async () => () => {} } };
});

// A proof that is still waiting holds a 1 Hz repaint, and that interval keeps Node alive. Ended
// here rather than left to the assertions: a FAILING run is exactly the run in which the stop
// button no longer works, and a test file that hangs when it fails reports nothing at all.
after(async () => {
  native.proving?.reject(new Error('optimal: cancelled'));
  native.proving = null;
  await settle(100); // the app's own cleanup runs off that rejection
});

test('the desktop gate is what draws the affordance at all', async () => {
  assert.equal(win.document.documentElement.dataset.platform, 'macos', 'the platform pin did not take');
  await newWalkWithProof();
  assert.equal(proveBtn().hidden, false);
  assert.equal(cancelBtn().hidden, true, 'the stop is drawn only once a proof is actually waiting');
});

test('a superseded proof releases its own timers and leaves the running proof its stop', async () => {
  await newWalkWithProof();

  // Proof A: held at the readiness reply, which is an ordinary await like any other.
  const heldStatus = deferred();
  native.statusGate = heldStatus;
  proveBtn().click();
  await settle(50);
  assert.ok(native.calls.includes('optimal_status'), 'precondition: proof A reached the native side');

  // The subject changes underneath it — a retarget, exactly as pressing the die does. A's walk is
  // gone; the button comes back for the new one.
  native.statusGate = null; // the next proof's readiness answers at once
  await newWalkWithProof();

  // Proof B: the one that is actually running now.
  proveBtn().click();
  await settle(400); // past PROOF_WAIT_VISIBLE_MS, so the stop is on screen
  assert.equal(cancelBtn().hidden, false, 'precondition: proof B is waiting and offers its stop');
  assert.equal(typeof cancelBtn().onclick, 'function', 'precondition: proof B wired its stop');
  assert.ok(native.calls.includes('optimal_prove'), 'precondition: proof B reached the native side');

  // And now A's late reply lands. It is superseded — its walk is gone — so it writes nothing and
  // goes straight to its cleanup. That cleanup is the whole test.
  heldStatus.resolve();
  await settle(150);

  assert.equal(cancelBtn().hidden, false,
    'the superseded proof hid the running proof\'s stop — the proof cannot be called off');
  assert.equal(typeof cancelBtn().onclick, 'function',
    'the superseded proof cleared the running proof\'s stop handler');

  // The functional half: pressing it must actually reach the native side and end proof B.
  const before = native.calls.length;
  cancelBtn().click();
  assert.ok(native.calls.slice(before).includes('optimal_cancel'), 'the stop no longer stops anything');
  assert.equal(cancelBtn().textContent, 'stopping…');
  await settle(150);
  // Stopping is a choice, not a failure: the affordance comes back saying what it said before.
  assert.equal(proveBtn().textContent, 'prove the minimum');
  assert.equal(proveBtn().disabled, false);
  assert.equal(cancelBtn().hidden, true, 'and the stop goes away with the proof it belonged to');
});

test('nothing but the proof seam was driven through the injected command surface', () => {
  assert.deepEqual(
    [...new Set(native.calls)].sort(),
    ['optimal_cancel', 'optimal_prove', 'optimal_status'],
    'the fixture drove a command this test does not model',
  );
});
