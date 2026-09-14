// The Timer's scramble requests on their own — lib/screens/timer/scramble-request.js.
//
// A roll is a real Kociemba search in the solver pool, so presses overlap and answer in either
// order, and the screen can go while one is out. Inline in the Timer's mount that order could be
// driven only through the real solver, which chooses it: an older answer landing after a newer
// one, and a failure landing after a newer press, were never pinned, and the roll was handed no way
// to be called off (verification, 2026-09-14). Here the roll is a fake, and each case decides when
// every press answers.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { blockAt } from './app-source.mjs';
import { createScrambleRequests } from '../lib/screens/timer/scramble-request.js';

const settle = () => new Promise((r) => { setTimeout(r, 0); });
const cube = (alg) => ({ facelets: `STATE ${alg}`, alg });

/**
 * One Timer's requests, over a roll that waits for the case: `out[i]` is press i's roll, with the
 * signal it was handed and the means to answer or fail it. `log` is everything the screen was told.
 */
function world({ ready = true, loads = true } = {}) {
  const out = [];
  const log = [];
  let live = true;
  let busy = false;
  let solverReady = ready;
  const requests = createScrambleRequests({
    roll: ({ signal }) => new Promise((resolve, reject) => { out.push({ signal, resolve, reject }); }),
    park: (rolled) => { log.push(['parked', rolled?.alg || null]); },
    ready: () => solverReady,
    load: async () => { if (loads) solverReady = true; return loads; },
    live: () => live,
    busy: () => busy,
    onWaiting: () => { log.push(['waiting']); },
    onLoadFailed: () => { log.push(['load failed']); },
    onRolled: (rolled) => { log.push(['rolled', rolled.alg]); },
    onFailed: (err) => { log.push(['failed', err ? err.message : null]); },
  });
  return {
    requests, out, log,
    leave: () => { live = false; },
    startClock: () => { busy = true; },
  };
}

test('every roll is handed a way to be called off, and a newer press calls the older one off', async () => {
  const w = world();
  void w.requests.request();
  void w.requests.request();
  await settle();
  assert.equal(w.out.length, 2, 'precondition: both presses rolled');
  assert.deepEqual(w.out.map((r) => r.signal?.aborted), [true, false],
    'the older search was left running for nobody, or the newer one was called off with it');
});

test('the newest press is the one shown, whichever order the two answer in', async () => {
  for (const order of [[1, 0], [0, 1]]) {
    const w = world();
    void w.requests.request();
    void w.requests.request();
    await settle();
    for (const i of order) {
      w.out[i].resolve(cube(i === 0 ? 'OLDER' : 'NEWER'));
      await settle();
    }
    assert.deepEqual(w.log.filter(([what]) => what === 'rolled'), [['rolled', 'NEWER']],
      `answered ${order.join(' then ')}: the older roll was shown`);
    assert.ok(w.log.some(([what, alg]) => what === 'parked' && alg === 'OLDER'),
      `answered ${order.join(' then ')}: a cube already rolled was thrown away rather than kept`);
  }
});

test('an older press that fails after a newer one says nothing about it', async () => {
  const w = world();
  void w.requests.request();
  void w.requests.request();
  await settle();
  w.out[0].reject(new Error('the older search gave up (test)'));
  await settle();
  w.out[1].resolve(cube('NEWER'));
  await settle();
  assert.deepEqual(w.log, [['rolled', 'NEWER']], 'a failure nobody was waiting for was said');
});

test('an empty roll is said, and nothing is put in play', async () => {
  const w = world();
  void w.requests.request();
  await settle();
  w.out[0].resolve({ facelets: '', alg: '' });
  await settle();
  assert.deepEqual(w.log, [['failed', null]], 'an empty roll was shown, or went unsaid');
});

test('a roll that throws is said, with what went wrong', async () => {
  const w = world();
  void w.requests.request();
  await settle();
  w.out[0].reject(new Error('eight escalations (test)'));
  await settle();
  assert.deepEqual(w.log, [['failed', 'eight escalations (test)']]);
});

// Disposed ALONE: the screen's teardown runs while its root can still read as the screen on show,
// so what it answers must land nowhere on the strength of the disposal itself.
test('leaving the screen calls the roll off, and what it answers lands nowhere', async () => {
  for (const answer of ['a cube', 'a failure']) {
    const w = world();
    void w.requests.request();
    await settle();
    w.requests.dispose();
    assert.equal(w.out[0].signal.aborted, true, `${answer}: the search went on for a screen that had gone`);
    if (answer === 'a cube') w.out[0].resolve(cube('LATE'));
    else w.out[0].reject(new Error('late (test)'));
    await settle();
    assert.deepEqual(w.log.filter(([what]) => what !== 'parked'), [], `${answer}: it was said on a screen that had gone`);
  }
});

test('a press while a solve is being timed rolls nothing, and a roll that lands on one is parked', async () => {
  const running = world();
  running.startClock();
  void running.requests.request();
  await settle();
  assert.equal(running.out.length, 0, 'a press rolled a scramble under a running solve');

  const w = world();
  void w.requests.request();
  await settle();
  w.startClock();
  w.out[0].resolve(cube('DURING'));
  await settle();
  assert.deepEqual(w.log, [['parked', 'DURING']], 'a roll that landed under a running solve was shown');
});

test('a solver still loading is waited for and then rolled from; one that never loads is said about the app', async () => {
  const loads = world({ ready: false });
  void loads.requests.request();
  await settle();
  await settle();
  assert.deepEqual(loads.log, [['waiting']], 'the wait was not said');
  assert.equal(loads.out.length, 1, 'the solver loaded and nothing was rolled');

  const never = world({ ready: false, loads: false });
  void never.requests.request();
  await settle();
  await settle();
  assert.deepEqual(never.log, [['waiting'], ['load failed']], 'a solver that did not load left the screen waiting');
  assert.equal(never.out.length, 0);

  const gone = world({ ready: false });
  void gone.requests.request();
  gone.leave();
  await settle();
  await settle();
  assert.equal(gone.out.length, 0, 'a load that landed after the screen went rolled for it anyway');
});

// The wiring, read from the Timer: what these cases pin is the Timer's only if it builds its
// requests on the roll itself, and calls them off with the screen.
test('the Timer rolls through these requests, and calls them off with the screen', () => {
  const timer = readFileSync(new URL('../lib/screens/timer.js', import.meta.url), 'utf8');
  const built = blockAt(timer, 'createScrambleRequests({');
  assert.match(built, /\broll: randomScramble,/, 'the Timer wraps its roll, and a wrapper can drop the signal');
  assert.match(built, /\bpark: parkRoll,/);
  assert.match(blockAt(built, 'onLoadFailed: () =>'), /solver did not load/,
    'a solver that never loads must be said about the app, not the cube');
  assert.match(blockAt(timer, 'hooks.cleanup = () =>'), /requests\.dispose\(\)/,
    'leaving the Timer leaves its roll running');
});
