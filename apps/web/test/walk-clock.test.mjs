// The clock a walk plays on — plan item 6.5.
//
// Every case here is about the one decision this module makes: is the next stop due NOW, or when the
// element says the turn in flight has landed? Getting that wrong is not a subtle mispacing — waiting
// on a completion that is never coming is a Play button that does nothing, and not waiting is a walk
// that runs to the end in one synchronous burst.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWalkClock } from '../lib/walk-clock.js';

/** An element that is turning, or is not. Landing is the SCREEN's word, not the element's — the clock
 *  takes no listener of its own (see the module header), so every case here lands it by hand the way the
 *  presenter's one step listener does. */
const fakeCube = () => ({ animating: false });

test('with nothing in flight the next stop is due now, not at a landing that will never come', () => {
  const cube = fakeCube();
  const timers = [];
  const { schedule } = createWalkClock(cube, { setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  let ticks = 0;
  schedule(() => { ticks += 1; }, 900);
  assert.deepEqual(timers.map((t) => t.ms), [900], 'a still cube did not take the gap it was given');
  timers[0].fn();
  assert.equal(ticks, 1);
});

test('with a turn in flight the next stop waits for it to land — the speed menu keeps its meaning', () => {
  // The whole reason this exists: `play({ every })` on a metronome would start the next stop over the
  // top of a turn the renderer is still animating at the speed the child chose.
  const cube = fakeCube();
  const timers = [];
  const { schedule, landed } = createWalkClock(cube, { setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  cube.animating = true;
  let ticks = 0;
  schedule(() => { ticks += 1; }, 900);
  assert.deepEqual(timers, [], 'a turning cube was paced by a timer beside its own animation');
  assert.equal(ticks, 0, 'the next stop was asked for while the last was still turning');
  landed();
  assert.equal(ticks, 1, 'the stop never came when the turn landed');
});

test('a cancelled tick does not fire when the turn it was waiting on lands', () => {
  // Pausing mid-turn. The turn still lands — a paused cube is a settled one — and what must NOT
  // happen is the walk taking another step on the way past.
  const cube = fakeCube();
  const { schedule, landed } = createWalkClock(cube, { setTimer: () => 0 });
  cube.animating = true;
  let ticks = 0;
  const handle = schedule(() => { ticks += 1; }, 900);
  schedule.cancel(handle);
  landed();
  assert.equal(ticks, 0, 'a cancelled walk took one more step when the turn under it landed');
});

test('a cancelled timer is cleared, so a still cube does not tick after a pause either', () => {
  const cube = fakeCube();
  const cleared = [];
  const { schedule } = createWalkClock(cube, { setTimer: () => 7, clearTimer: (id) => cleared.push(id) });
  schedule.cancel(schedule(() => {}, 900));
  assert.deepEqual(cleared, [7]);
});

test('a tick that asks for another does not run inside its own landing', () => {
  // The walk would otherwise finish in one synchronous burst instead of playing: each stop's callback
  // registers the next, and a landing that iterated the live set would run every one of them.
  const cube = fakeCube();
  const { schedule, landed } = createWalkClock(cube, { setTimer: (fn) => { fn(); return 0; } });
  let ticks = 0;
  const tick = () => { ticks += 1; if (ticks < 5) { cube.animating = true; schedule(tick, 0); } };
  cube.animating = true;
  schedule(tick, 0);
  landed();
  assert.equal(ticks, 1, 'one landing played more than one stop');
  landed();
  assert.equal(ticks, 2, 'the walk stopped playing after its first landing');
});

test('afterTurn runs at once when nothing is turning, and at the landing when something is', () => {
  // Repeat: both halves are stop commands, and a stop command settles whatever group is in flight, so
  // asking for both in one breath snaps the undo and animates only the redo.
  const cube = fakeCube();
  const { afterTurn, landed } = createWalkClock(cube, { setTimer: () => 0 });
  let ran = 0;
  afterTurn(() => { ran += 1; });
  assert.equal(ran, 1, 'a press on a still cube waited for a turn that was never going to start');

  cube.animating = true;
  afterTurn(() => { ran += 1; });
  assert.equal(ran, 1, 'the second half of a repeat was asked for over the first');
  landed();
  assert.equal(ran, 2);
});

test('an element that is not a renderer never waits: it will never report a landing', () => {
  // The vendored bundle has not upgraded the tag — which this repo has shipped more than once. There
  // is no `animating`, no event, and nothing to wait for.
  const { schedule, afterTurn } = createWalkClock({}, { setTimer: (fn) => { fn(); return 0; } });
  let ran = 0;
  afterTurn(() => { ran += 1; });
  schedule(() => { ran += 1; }, 900);
  assert.equal(ran, 2, 'a press on an inert element waited forever');
});

test('the clock takes no listener of its own — the screen has the only one', () => {
  // `<cubus-cube>` is parked and re-used between screens, and `screen-swap.test.mjs` asserts that one
  // step event reaches EXACTLY ONE handler — which is how a listener left behind by an earlier visit is
  // caught at all. A second legitimate one hides the next leak inside a number that is already 2.
  const seen = [];
  createWalkClock({ animating: false, addEventListener: (type) => seen.push(type) });
  assert.deepEqual(seen, [], `the clock subscribed to ${seen.join(', ')} instead of being told`);
});
