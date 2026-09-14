// The cube screen's die on its own — lib/screens/cube/die.js.
//
// The press was closure state inside the cube screen's mount, reachable only by booting the whole
// app and pressing it. A probe of that (2026-09-14, before the die became its own unit) mutated
// the press's paths against every suite that presses it, and found most of them held by nothing:
// a press before the solver is ready, a roll that lands after its screen has gone, a roll with no
// cube in it, the count as the place a failure is said, a solve that outlives its screen, and the
// order a press works in. Here every service is a fake, and each case decides when a roll and a
// solve answer.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Window } from 'happy-dom';

import { createDie } from '../lib/screens/cube/die.js';

const { document } = new Window();
const settle = () => new Promise((r) => { setTimeout(r, 0); });
const NO_SCRAMBLE = 'a scramble could not be rolled (test)';

/**
 * A cube screen's die, built over fakes that record what they were asked.
 *
 * `count` draws the solution card's count, as a walking screen has; `ready` is whether the solver
 * has loaded; `screen` and `app` replace any part of either half.
 */
function world({ scrambling = false, count = false, ready = true, screen: screenOver = {}, app: appOver = {} } = {}) {
  const root = document.createElement('div');
  root.innerHTML = `${count ? '<span id="moveCount"></span>' : ''}<span id="rollSay"></span><button id="randCube"></button>`;
  const log = [];
  let gone = false;
  const signal = new AbortController().signal;
  const screen = {
    root, scrambling, signal, stale: () => gone,
    takeNewSubject: () => { log.push('take'); return null; },
    ...screenOver,
  };
  const app = {
    WALK_FAILURES: { 'no scramble': NO_SCRAMBLE },
    solverReady: () => ready,
    randomScramble: async (opts) => { log.push(['roll', opts?.signal === signal]); return { facelets: 'ROLLED', alg: 'R U' }; },
    deriveCube: async (opts) => { log.push(['solve', opts?.signal === signal]); },
    adoptCube: (facelets, how) => { log.push(['adopt', facelets, how]); },
    putInPlay: (rolled) => { log.push(['in play', rolled.alg]); },
    parkRoll: (rolled) => { log.push(['parked', rolled.alg]); },
    ...appOver,
  };
  createDie(screen, app);
  const die = root.querySelector('#randCube');
  return {
    die,
    log,
    /** Press the die, and hand back the press itself so a case can await its end. */
    press: () => die.onclick(),
    /** Navigate away: the screen's generation check starts answering that it is stale. */
    leave: () => { gone = true; },
    $: (sel) => root.querySelector(sel),
  };
}

test('a die handed a service that is not one is refused when it is built, by name', () => {
  const root = document.createElement('div');
  const screen = { root, scrambling: false, signal: null, stale: () => false, takeNewSubject: () => null };
  const app = {
    WALK_FAILURES: {}, solverReady: () => true, randomScramble: async () => null, deriveCube: async () => {},
    adoptCube: () => {}, putInPlay: () => {},
  };
  assert.throws(() => createDie(screen, app), { name: 'TypeError', message: /`parkRoll` must be a function/ },
    'a die with no way to park a roll was built, and would fail at the press instead');
  assert.throws(() => createDie({ ...screen, takeNewSubject: undefined }, { ...app, parkRoll: () => {} }),
    { name: 'TypeError', message: /`takeNewSubject` must be a function/ });
});

test('on Home a press rolls a cube, adopts it as a generated one, solves it, and only then takes it', async () => {
  const w = world();
  await w.press();
  assert.deepEqual(w.log, [
    ['roll', true],
    ['in play', 'R U'],
    ['adopt', 'ROLLED', { physical: false, source: 'generated', setupAlg: 'R U' }],
    ['solve', true],
    'take',
  ], 'the press worked out of order, or without the screen\'s signal on its searches');
  assert.equal(w.die.disabled, false, 'and the die comes back');
});

test('on Scramble a press rolls and solves nothing itself: the walk it takes is the roll', async () => {
  const w = world({ scrambling: true });
  await w.press();
  assert.deepEqual(w.log, ['take'], 'Scramble adopted a cube of its own before taking the walk');
});

test('a press before the solver has loaded does nothing at all', async () => {
  const w = world({ ready: false });
  await w.press();
  assert.deepEqual(w.log, [], 'a press before the solver loaded went on to roll');
  assert.equal(w.die.disabled, false, 'and it held the die');
});

test('the press is held from the press until the new subject is on screen, and a second press rolls nothing', async () => {
  let landed;
  const w = world({ screen: { takeNewSubject: () => { w.log.push('take'); return new Promise((r) => { landed = r; }); } } });
  const pressed = w.press();
  assert.equal(w.die.disabled, true, 'the die stayed live across the roll it started');
  await w.press();
  await settle();
  assert.ok(w.log.includes('take'), 'precondition: the new subject is being taken');
  assert.equal(w.die.disabled, true, 'the die came back before the walk it rolled was on screen');
  landed();
  await pressed;
  assert.equal(w.log.filter((e) => e[0] === 'roll').length, 1, 'a held press rolled a second cube');
  assert.equal(w.die.disabled, false, 'and the die comes back once it is');
});

test('a roll that lands after its screen has gone is parked, never adopted, and nothing is taken', async () => {
  let answer;
  const w = world({ app: { randomScramble: () => new Promise((r) => { answer = r; }) } });
  const pressed = w.press();
  w.leave();
  answer({ facelets: 'LATE', alg: 'F2' });
  await pressed;
  assert.deepEqual(w.log, [['parked', 'F2']], 'a roll nobody is waiting for was adopted, or thrown away');
});

test('a roll that fails is said in the count while there is one, and on the die\'s own line while there is not', async (t) => {
  t.mock.method(console, 'error', () => {});
  const refused = { app: { randomScramble: async () => { throw new Error('test: the pool is gone'); } } };
  const walking = world({ count: true, ...refused });
  await walking.press();
  assert.equal(walking.$('#moveCount').textContent, NO_SCRAMBLE, 'a screen with a count said the failure somewhere else');
  assert.equal(walking.$('#rollSay').textContent, '', 'and said it twice');
  const solved = world(refused);
  await solved.press();
  assert.equal(solved.$('#rollSay').textContent, NO_SCRAMBLE, 'a screen with no count failed in silence');
  assert.deepEqual(solved.log, [], 'and a failed roll adopted, solved or took something');
  assert.equal(solved.die.disabled, false, 'and it left the die that retries it');
});

test('a roll that fails after its screen has gone says nothing on it', async (t) => {
  t.mock.method(console, 'error', () => {});
  let refuse;
  const w = world({ app: { randomScramble: () => new Promise((_, reject) => { refuse = reject; }) } });
  const pressed = w.press();
  w.leave();
  refuse(new Error('test: called off'));
  await pressed;
  assert.equal(w.$('#rollSay').textContent, '', 'a failure landing after the screen went was said on it');
});

test('a roll with no cube in it is said, and nothing is adopted', async (t) => {
  t.mock.method(console, 'error', () => {});
  const w = world({ app: { randomScramble: async () => ({ facelets: null, alg: '' }) } });
  await w.press();
  assert.equal(w.$('#rollSay').textContent, NO_SCRAMBLE, 'an empty roll went unsaid');
  assert.deepEqual(w.log, [], 'an empty roll was put in play or adopted');
});

test('a press whose screen goes while its cube is being solved takes nothing', async () => {
  let solved;
  const w = world({ app: { deriveCube: () => new Promise((r) => { solved = r; }) } });
  const pressed = w.press();
  await settle();
  assert.deepEqual(w.log.at(-1)[0], 'adopt', 'precondition: the cube is adopted and being solved');
  w.leave();
  solved();
  await pressed;
  assert.ok(!w.log.includes('take'), 'a screen that had gone was handed the new subject');
});

test('a solve that fails still takes the cube, and only a search called off goes unlogged', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const failing = (name) => world({ app: { deriveCube: async () => { throw Object.assign(new Error('test'), { name }); } } });
  const called = failing('AbortError');
  await called.press();
  assert.equal(warned.mock.callCount(), 0, 'a search the teardown called off was logged as a failure');
  assert.equal(called.log.at(-1), 'take', 'a solve that did not answer swallowed the cube it was for');
  const broken = failing('Error');
  await broken.press();
  assert.equal(warned.mock.callCount(), 1, 'a solve that failed went unlogged');
  assert.equal(broken.log.at(-1), 'take');
});
