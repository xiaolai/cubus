// The drill engine against a REAL cube's reports (dev-docs/algorithm-drill-v2-plan.md WI-14).
//
// Every other drill test feeds reports a generator makes, checked against cubejs. This one feeds what a GAN
// 16 ui actually sent on 2026-10-17 (test/fixtures/hardware/gan16ui-2026-10-17.mjs), at the times it sent
// them, and it is where the engine's two timing constants stop being guesses: the cue window must outlast
// every gap the cube left between the two faces of a slice, and the gesture limit must hold every set of
// four the owner made. Both are asserted as RELATIONS to the recording, so a later change to either
// constant that the recording does not support fails here, with the measurement in the message.
//
// One cube and one person. A cube that does not number its turns has not been recorded yet, so nothing here
// speaks for one.

import assert from 'node:assert/strict';
import test from 'node:test';

import { SOLVED, toFacelets } from '../lib/cube-pieces.js';
import { CUE_WINDOW_MS, GESTURE_MS, createDrillEngine } from '../lib/drill/engine.js';
import { GAN16UI_SESSION as SESSION } from './fixtures/hardware/gan16ui-2026-10-17.mjs';

const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
const at = (serial, from = 0) => SESSION.findIndex((r, i) => i >= from && r.serial === serial);

/** The reports from serial `first` to serial `last` inclusive, across the 255 → 0 wrap. */
function run(first, last) {
  const i = at(first);
  const j = at(last, i);
  assert.ok(i >= 0 && j >= i, `the recording has no run ${first}..${last}`);
  return SESSION.slice(i, j + 1);
}

/** The gaps, on the cube's clock, between the two faces of every slice in the slice runs. */
function sliceGaps() {
  const gaps = [];
  for (const [first, last] of [[28, 43], [50, 89], [90, 133], [134, 183]]) {
    const r = run(first, last);
    for (let k = 0; k < r.length - 1;) {
      if (OPPOSITE[r[k].notation[0]] === r[k + 1].notation[0]) {
        gaps.push(r[k + 1].cubeTimestamp - r[k].cubeTimestamp);
        k += 2;
      } else k += 1;
    }
  }
  return gaps;
}

/** An engine driven at the recording's own pace: each report arrives its host-clock gap after the last. */
function replay(alg, reports) {
  let clock = 0;
  let id = 0;
  const timers = new Map();
  const sounds = [];
  const events = [];
  const engine = createDrillEngine({
    alg,
    numbersMoves: true,
    setTimer: (fn, ms) => { id += 1; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimer: (h) => { timers.delete(h); },
    now: () => clock,
    sound: (name) => sounds.push(name),
    onEvent: (e) => events.push(e),
  });
  const advance = (ms) => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      clock = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    clock = until;
  };
  engine.start({ facelets: toFacelets(SOLVED) });
  let last = reports[0].timestamp;
  for (const r of reports) {
    advance(r.timestamp - last);
    last = r.timestamp;
    engine.report({ ...r });
  }
  advance(CUE_WINDOW_MS * 10);
  return { sounds, events, done: events.filter((e) => e.type === 'done') };
}

test('the recording is one unbroken stream: every report numbered and stamped, no turn lost', () => {
  assert.equal(SESSION.length, 341);
  for (let k = 1; k < SESSION.length; k++) {
    assert.equal(SESSION[k].serial, (SESSION[k - 1].serial + 1) & 0xff, `a turn went missing before report ${k}`);
    assert.ok(Number.isFinite(SESSION[k].cubeTimestamp), `report ${k} has no cube clock`);
  }
});

test('the cue window outlasts every gap the cube left between the two faces of a slice', () => {
  const gaps = sliceGaps();
  assert.ok(gaps.length >= 70, `only ${gaps.length} slices found in the slice runs`);
  const worst = Math.max(...gaps);
  // Measured 2026-10-17: 75 slices, median 8 ms, worst 41 ms. The window must clear the worst with room to
  // spare — at least twice it — or a slice's first face would sound a wrong turn on a slower cube.
  assert.ok(CUE_WINDOW_MS >= 2 * worst,
    `CUE_WINDOW_MS is ${CUE_WINDOW_MS} ms, and a recorded slice left ${worst} ms between its faces`);
});

test('the gesture limit holds every four identical turns the owner made', () => {
  const fours = run(184, 229);
  assert.ok(fours.every((r) => r.notation === fours[0].notation), 'the gesture run is one face, one way');
  const spans = [];
  for (let k = 0; k + 3 < fours.length; k++) spans.push(fours[k + 3].cubeTimestamp - fours[k].cubeTimestamp);
  // Measured 2026-10-17: every window of four, median 741 ms, worst 1453 ms — sets made "quickly".
  const worst = Math.max(...spans);
  assert.ok(GESTURE_MS >= worst, `GESTURE_MS is ${GESTURE_MS} ms, and four recorded turns took ${worst} ms`);
});

test("seven recorded Sunes complete seven reps, never sound a wrong turn, and time on the cube's clock", () => {
  const reports = run(232, 31);
  assert.equal(reports.length, 56, 'seven Sunes of eight reports each, the half turn as two');
  const { sounds, done } = replay("R U R' U R U2 R'", reports);
  assert.equal(done.length, 7, `the engine finished ${done.length} reps, not 7`);
  assert.equal(sounds.filter((s) => s === 'off').length, 0, 'a correct Sune sounded a wrong turn');
  // Each rep's time is the cube's clock from its first report to its last — never the host's.
  const want = [0, 1, 2, 3, 4, 5, 6].map((k) => reports[8 * k + 7].cubeTimestamp - reports[8 * k].cubeTimestamp);
  const got = done.map((e) => e.result.ms);
  assert.ok(done.every((e) => e.result.clean), 'a correct Sune was recorded as not clean');
  assert.deepEqual(got, want, `the reps were timed ${JSON.stringify(got)}, the cube says ${JSON.stringify(want)}`);
});

test('recorded half turns and slices never sound a wrong turn', () => {
  // R2 ten times, then the slice runs: each one repeated reps of one algorithm, in whatever hold the hands
  // were in. A half turn's first quarter, and a slice's first face, must never be called wrong.
  for (const [alg, first, last, reps] of [['R2', 8, 27, 10], ['M', 50, 89, 20], ['M', 90, 133, 22], ['M', 134, 183, 25]]) {
    const { sounds, done } = replay(alg, run(first, last));
    assert.equal(sounds.filter((s) => s === 'off').length, 0, `${alg} over serials ${first}..${last} sounded a wrong turn`);
    assert.equal(done.length, reps, `${alg} over serials ${first}..${last}: ${done.length} reps, not ${reps}`);
  }
});
