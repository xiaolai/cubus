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
  /** When set, what `optimal_prepare` waits on: table generation is minutes, not a reply. */
  prepareGate: null,
  proving: null,
  statuses: [],
  answer: null,
  cancelFails: 0,
  proveArgs: null,
  listeners: new Map(),
};
const invoke = (cmd, args) => {
  native.calls.push(cmd);
  if (cmd === 'optimal_prepare') {
    return native.prepareGate ? native.prepareGate.promise.then(() => 'preparing') : Promise.resolve('preparing');
  }
  if (cmd === 'optimal_status') {
    if (native.statuses.length) return Promise.resolve(native.statuses.shift());
    return native.statusGate ? native.statusGate.promise.then(() => 'ready') : Promise.resolve('ready');
  }
  if (cmd === 'optimal_prove') {
    native.proveArgs = args;
    if (native.answer) return Promise.resolve(native.answer(args));
    native.proving = deferred();
    return native.proving.promise;
  }
  if (cmd === 'optimal_cancel') {
    if (native.cancelFails > 0) { native.cancelFails -= 1; return Promise.reject(new Error('ipc down (test)')); }
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
  win.__TAURI__ = {
    core: { invoke },
    event: {
      listen: async (name, cb) => {
        native.listeners.set(name, cb);
        return () => { if (native.listeners.get(name) === cb) native.listeners.delete(name); };
      },
    },
  };
});

// A proof that is still waiting holds a 1 Hz repaint, and that interval keeps Node alive. Ended
// here rather than left to the assertions: a FAILING run is exactly the run in which the stop
// button no longer works, and a test file that hangs when it fails reports nothing at all.
after(async () => {
  native.proving?.reject(new Error('optimal: cancelled'));
  native.proving = null;
  await settle(100); // the app's own cleanup runs off that rejection
  // And off the walk. A waiting state a proof left repainting after it ended clears itself on its
  // next tick once its walk has gone — the leftover the rejection above cannot reach, and the one a
  // failing run of the instant-proof case leaves (that run hung, 2026-09-14).
  win.cubusGo('settings');
  await settle(1100);
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

test('a stop the native side did not take comes back, and a second press stops the proof', async () => {
  await newWalkWithProof();
  proveBtn().click();
  await settle(400);
  assert.equal(cancelBtn().hidden, false, 'precondition: the stop is on screen');
  native.cancelFails = 1;
  cancelBtn().click();
  await settle(50);
  assert.equal(cancelBtn().disabled, false, 'a failed stop stayed disabled while the proof runs on');
  assert.match(cancelBtn().textContent, /try again/);
  cancelBtn().click();
  await settle(150);
  assert.equal(native.proving, null, 'the second press did not reach the native side');
  assert.equal(proveBtn().textContent, 'prove the minimum');
});

test('a contour reported by another proof is not this cube\'s lower bound', async () => {
  await newWalkWithProof();
  native.proveArgs = null;
  proveBtn().click();
  await settle(400);
  const contour = native.listeners.get('optimal-proof-progress');
  assert.equal(typeof contour, 'function', 'precondition: the proof listens for its contours');
  contour({ payload: { proof: -1, ruled_out: 17 } });
  assert.doesNotMatch(proveBtn().textContent, /at least 18/, 'another proof\'s contour became this cube\'s lower bound');
  const mine = native.proveArgs?.proof;
  assert.ok(Number.isInteger(mine), 'the request carries no number for its contours to echo');
  contour({ payload: { proof: mine, ruled_out: 11 } });
  assert.match(proveBtn().textContent, /^at least 12 · /);
  cancelBtn().click();
  await settle(150);
});

test('tables built on the first press: the proof starts once they are ready', async () => {
  await newWalkWithProof();
  native.statuses = ['cold', 'preparing', 'ready'];
  native.proving = null;
  proveBtn().click();
  await settle(50);
  native.listeners.get('optimal-progress')?.({ payload: { stage: 'corners', done: 1, total: 4 } });
  assert.equal(proveBtn().textContent, 'corners 25%', 'generation is the wait with a denominator');
  assert.ok(await waitFor(() => native.proving !== null, 3000), 'the proof never started once the tables were ready');
  cancelBtn().click();
  await settle(150);
  assert.equal(native.listeners.has('optimal-progress'), false, 'the generation heartbeat was never let go');
});

test('a generation that died in another call ends the press as a failure, not a proof', async () => {
  await newWalkWithProof();
  native.statuses = ['cold', 'cold'];
  const before = native.calls.length;
  proveBtn().click();
  assert.ok(await waitFor(() => proveBtn().textContent === 'could not prove', 3000), 'a dead generation was polled on');
  assert.equal(native.calls.slice(before).includes('optimal_prove'), false, 'a proof started without tables');
  assert.equal(proveBtn().disabled, false);
  assert.equal(native.listeners.has('optimal-progress'), false, 'the heartbeat was kept after the failure');
});

test('leaving during generation starts no proof, and lets the heartbeat go', async () => {
  await newWalkWithProof();
  native.statuses = ['cold', 'preparing', 'ready'];
  const before = native.calls.length;
  proveBtn().click();
  await settle(50);
  win.cubusGo('settings');
  await settle(800);
  assert.equal(native.calls.slice(before).includes('optimal_prove'), false, 'a proof started for a walk nobody sees');
  assert.equal(native.listeners.has('optimal-progress'), false, 'the heartbeat outlived the screen');
  win.cubusGo('home');
  await settle(300);
});

test('a proved cube shown again keeps its sentence and is not offered the proof again', async () => {
  await newWalkWithProof();
  const { state } = await import('../lib/app.js');
  native.answer = () => ({ length: state.cube.moves.length, solution: state.cube.solution, nodes: 1, millis: 1, tables_persisted: true });
  proveBtn().click();
  await settle(200);
  native.answer = null;
  assert.match($('#moveCount').textContent, /— proved the minimum$/, 'precondition: the proof was said');
  win.cubusGo('settings');
  await settle(50);
  win.cubusGo('home');
  assert.ok(await waitFor(() => /\d/.test($('#moveCount')?.textContent ?? '')), 'Home drew no count');
  await settle(300);
  assert.match($('#moveCount').textContent, /— proved the minimum$/, 'the same cube, shown again, lost its proof');
  assert.equal(proveBtn().hidden, true, 'and hours of search were offered for an answer already held');
});

// Every case above lets table generation answer at once, and it is minutes. Held open, the
// heartbeat it listens to outlived the walk it was for until the tables were done, whether a new
// cube replaced the walk or the screen was left (verification, 2026-09-14).
test('a walk that goes while its tables are being built lets their heartbeat go at once', async () => {
  for (const [how, leave, back] of [
    ['a new cube on the screen', () => newWalkWithProof(), async () => {}],
    ['the screen left', async () => { win.cubusGo('settings'); await settle(50); },
      async () => { win.cubusGo('home'); await settle(300); }],
  ]) {
    await newWalkWithProof();
    native.statuses = ['cold'];
    const held = deferred();
    native.prepareGate = held;
    proveBtn().click();
    await settle(50);
    try {
      assert.ok(native.listeners.has('optimal-progress'), `${how}: precondition: the press is waiting on the tables`);
      await leave();
      assert.equal(native.listeners.has('optimal-progress'), false,
        `${how}: the heartbeat outlived its walk, until the tables were done`);
    } finally {
      native.prepareGate = null;
      held.resolve();
      native.statuses = [];
      await settle(700); // the old press polls once more, and ends
      await back();
    }
  }
});

// The same for a proof: leaving calls it off, but a stop the native side does not take leaves it
// running for hours, and its contour listener with it (verification, 2026-09-14).
test('a walk that goes while its proof runs lets its contours go at once, even when the stop does not take', async () => {
  await newWalkWithProof();
  proveBtn().click();
  await settle(400);
  try {
    assert.ok(native.listeners.has('optimal-proof-progress'), 'precondition: the proof listens for its contours');
    native.cancelFails = 1; // the stop that leaving sends is refused
    win.cubusGo('settings');
    await settle(50);
    assert.equal(native.listeners.has('optimal-proof-progress'), false,
      'the contour listener outlived its walk, for as long as the proof runs');
  } finally {
    native.cancelFails = 0;
    native.proving?.reject(new Error('optimal: cancelled'));
    native.proving = null;
    await settle(100);
    win.cubusGo('home');
    await settle(300);
  }
});

// Only the LAST proof was held: proving one cube and then another, and showing the first again,
// dropped its sentence and offered the search again (verification, 2026-09-14).
test('every proved cube keeps its sentence when it is shown again, not only the last one proved', async () => {
  const { state } = await import('../lib/app.js');
  const { adoptCube } = await import('../lib/cube-connection.js');
  const { deriveCube } = await import('../lib/cube-subject.js');
  const { refreshScreen } = await import('../lib/screen-shell.js');
  const proveThisCube = async () => {
    await newWalkWithProof();
    native.answer = () => ({ length: state.cube.moves.length, solution: state.cube.solution, nodes: 1, millis: 1, tables_persisted: true });
    proveBtn().click();
    await settle(200);
    native.answer = null;
    assert.match($('#moveCount').textContent, /— proved the minimum$/, 'precondition: the proof was said');
    return { facelets: state.cube.facelets, setupAlg: state.cube.setupAlg };
  };
  const first = await proveThisCube();
  const second = await proveThisCube();
  assert.notEqual(second.facelets, first.facelets, 'precondition: two different cubes were proved');
  adoptCube(first.facelets, { physical: false, source: 'generated', setupAlg: first.setupAlg });
  await deriveCube();
  refreshScreen();
  assert.ok(await waitFor(() => state.cube.facelets === first.facelets), 'precondition: the first cube is the subject again');
  await settle(300);
  assert.match($('#moveCount').textContent, /— proved the minimum$/, 'the first cube, shown again, lost its proof to the second');
  assert.equal(proveBtn().hidden, true, 'and the search was offered again for an answer already held');
});

// Proofs are kept, but saying one sat inside the gate that also asks whether the OFFER is on:
// turning "Offer to prove the minimum" off turned "4 — proved the minimum" back into "4". The
// setting decides whether a proof is offered, not whether one already held is said (found by
// verification, 2026-09-14).
test('a proof already held is still said when the offer to prove is turned off', async () => {
  const { state } = await import('../lib/app.js');
  const { settings } = await import('../lib/app-settings.js');
  await newWalkWithProof();
  native.answer = () => ({ length: state.cube.moves.length, solution: state.cube.solution, nodes: 1, millis: 1, tables_persisted: true });
  proveBtn().click();
  await settle(200);
  native.answer = null;
  assert.match($('#moveCount').textContent, /— proved the minimum$/, 'precondition: the proof was said');
  settings.proveMinimum = false;
  try {
    win.cubusGo('settings');
    await settle(50);
    win.cubusGo('home');
    assert.ok(await waitFor(() => /\d/.test($('#moveCount')?.textContent ?? '')), 'Home drew no count');
    await settle(300);
    assert.match($('#moveCount').textContent, /— proved the minimum$/, 'turning the offer off unsaid a proof already held');
    assert.equal(proveBtn().hidden, true, 'and the offer came back while it was turned off');
    // And a cube with no proof held is not offered one while the offer is off.
    const before = state.cube.facelets;
    $('#randCube').click();
    assert.ok(await waitFor(() => state.cube.facelets !== before && !$('#randCube').disabled), 'precondition: a new cube was rolled');
    await settle(300);
    assert.equal(proveBtn().hidden, true, 'a cube with no proof held was offered one while the offer was off');
  } finally {
    settings.proveMinimum = true;
  }
});

// PROOF_WAIT_VISIBLE_MS promises a press looks instant when the proof is: no wait, no clock and no
// stop for a proof that answers under it. Nothing held the promise (verification, 2026-09-14).
test('a proof that answers at once never shows its wait or its stop', async () => {
  const { state } = await import('../lib/app.js');
  await newWalkWithProof();
  const seen = [];
  const watch = new win.MutationObserver(() => {
    seen.push(`${proveBtn()?.textContent} | stop ${cancelBtn()?.hidden ? 'hidden' : 'shown'}`);
  });
  watch.observe($('#stage'), { subtree: true, childList: true, characterData: true, attributes: true });
  native.answer = () => ({ length: state.cube.moves.length, solution: state.cube.solution, nodes: 1, millis: 1, tables_persisted: true });
  try {
    proveBtn().click();
    await settle(400); // past the moment a wait would have shown
  } finally {
    native.answer = null;
    watch.disconnect();
  }
  assert.ok(seen.length > 0, 'precondition: the press changed the screen');
  assert.deepEqual(seen.filter((s) => /proving|at least|stop shown/.test(s)), [], 'an instant proof flashed its wait or its stop');
});

test('nothing but the proof seam was driven through the injected command surface', () => {
  assert.deepEqual(
    [...new Set(native.calls)].sort(),
    ['optimal_cancel', 'optimal_prepare', 'optimal_prove', 'optimal_status'],
    'the fixture drove a command this test does not model',
  );
});
