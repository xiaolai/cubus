// @vitest-environment happy-dom
//
// The replay harness: a recorded session driven through the REAL panel
// (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 0.2).
//
// A harness that re-implemented any stage would measure the re-implementation, and the six fixes in
// §1.1 were each judged on exactly that kind of stand-in. So the frames go in through `Detector` —
// the seam both shipped runtimes sit behind — and everything after it is the code the app runs.
//
// What is asserted here is the harness's own contract, not the scanner's: that a recording reaches
// the panel, that the cadence is genuinely a parameter, that one physical frame is served to the
// ticks it was served to and no more, and that the outcome it hands to `scoreSessions` describes
// the run that happened.

import Cube from 'cubejs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detection } from '../src/onnx-postprocess.js';
import { scoreSessions } from '../src/session-metrics.js';
import {
  parseSession,
  type RecordedFrame,
  type RecordedSession,
  SESSION_SCHEMA,
} from '../src/session-record.js';
import { FACES, type Face } from '../src/types.js';
import { frameTensor, RecordedDetector, replaySession } from '../view/session-replay.js';

const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

/** The nine detections of one side, laid out as a clean 3x3 grid — `tensorFor`'s geometry. */
function sideDetections(colors: readonly number[]): Detection[] {
  return colors.map((classId, a) => ({
    cx: 100 + (a % 3) * 45,
    cy: 100 + Math.floor(a / 3) * 45,
    w: 30,
    h: 30,
    classId,
    confidence: 0.9,
    scores: [0, 1, 2, 3, 4, 5].map((c) => (c === classId ? 0.9 : 0.001)),
  }));
}

const facesOf = (facelets: string): Record<Face, number[]> => {
  const out = {} as Record<Face, number[]>;
  FACES.forEach((face, fi) => {
    out[face] = [...facelets.slice(fi * 9, fi * 9 + 9)].map((l) => LETTER_CLASS[l as Face]!);
  });
  return out;
};

/**
 * A recording of a whole scan: each side held for `hold` frames at `stepMs`.
 *
 * Every frame gets its own id, as a camera delivering new pictures does — which is what the
 * stillness gate now requires to count them (D2).
 */
function recordedScan(facelets: string, hold = 12, stepMs = 60): RecordedSession {
  const sides = facesOf(facelets);
  const frames: RecordedFrame[] = [];
  let t = 0;
  let id = 0;
  for (const face of FACES) {
    for (let i = 0; i < hold; i++) {
      frames.push({ id: id++, t, served: 1, detections: sideDetections(sides[face]) });
      t += stepMs;
    }
  }
  return parseSession({
    schema: SESSION_SCHEMA,
    id: 'replay-1',
    startedAt: '2026-09-23T10:00:00Z',
    cube: 'a cube under test',
    conditions: {
      camera: 'built-in',
      lighting: 'daylight',
      handling: 'careful',
      state: 'scrambled',
    },
    model: { hash: 'abc', name: 'cubedet', runtime: 'apple' },
    truth: { facelets, source: 'manual-verified' },
    frames,
    decisions: [],
  });
}

/** Fake timers, and the advance the harness is driven by. */
const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'Date',
      'performance',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('a recorded session becomes a tensor the panel reads', () => {
  it('carries every candidate and every score into the model output', () => {
    // Re-running the panel's own decode on these boxes has to reproduce what was recorded, or the
    // replay is measuring a different frame from the one the session holds.
    const dets = sideDetections([0, 1, 2, 3, 4, 5, 0, 1, 2]);
    const out = frameTensor({ id: 0, t: 0, served: 1, detections: dets });
    expect(out.rows).toBe(10);
    expect(out.anchors).toBe(9);
    // Row-major, as `decodeDetections` reads it: row 0 is cx for every anchor.
    expect(Array.from(out.data.slice(0, 9))).toEqual(dets.map((d) => d.cx));
    // …and each class's row carries that class's score.
    for (const [a, d] of dets.entries()) {
      expect(out.data[(4 + d.classId) * 9 + a]).toBeCloseTo(0.9, 6);
    }
  });

  it('serves the frame that was in front of the camera, and says how often each was served', async () => {
    // The harness's own measurement of C3. A tick before the first frame gets null — what a camera
    // that has opened and delivered nothing returns — and a tick between frames gets the one that
    // is current, counted.
    let now = 0;
    const session = recordedScan(DEEP, 2, 100);
    const detector = new RecordedDetector(session, () => now);
    expect(detector.served.size).toBe(0);
    now = 0;
    expect(await detector.next()).not.toBeNull();
    now = 50; // still the first frame
    await detector.next();
    now = 100; // the second
    await detector.next();
    expect([...detector.served.entries()]).toEqual([
      [0, 2],
      [1, 1],
    ]);
  });
});

describe('the harness drives the real panel', () => {
  it('replays a whole scan and reports what happened', async () => {
    const session = recordedScan(DEEP);
    const outcome = await replaySession(session, { advance, tickMs: 60 });
    expect(outcome.sessionId).toBe('replay-1');
    expect(outcome.cube).toBe('a cube under test');
    expect(outcome.truth).toBe(DEEP);
    // Six sides filed, each with the time it was captured at — which is what the censored
    // time-to-side is computed from.
    expect(outcome.sides).toHaveLength(6);
    for (const side of outcome.sides) expect(side.capturedAt).not.toBeNull();
    expect(outcome.completed).toBe(true);
    expect(outcome.reported).toBe(DEEP);
    // And it scores: a run that finished with the right cube is neither incomplete nor wrong.
    const metrics = scoreSessions([outcome]);
    expect(metrics.completionRate).toBe(1);
    expect(metrics.wrongCubes).toBe(0);
    expect(metrics.sidesCensored).toBe(0);
    // Never zero, however clean the run — a finite corpus bounds a rate and cannot prove it absent.
    expect(metrics.wrongCubeRateUpperBound).toBeGreaterThan(0);
  });

  it('censors the sides a deadline cut off rather than inventing times for them', async () => {
    // A replay stopped early is exactly the shape of today's stuck session: some sides captured,
    // the rest unknown. The outcome must say so, and `scoreSessions` must not average over the
    // sides that happened to work.
    const session = recordedScan(DEEP);
    const outcome = await replaySession(session, { advance, tickMs: 60, deadlineMs: 900 });
    expect(outcome.completed).toBe(false);
    expect(outcome.reported).toBeNull();
    expect(outcome.sides.length).toBeLessThan(6);
    const metrics = scoreSessions([outcome]);
    expect(metrics.sidesCensored).toBe(6 - outcome.sides.length);
    expect(metrics.completionRate).toBe(0);
    // Incomplete is not WRONG: a change that refuses everything must not score as one that fixed it.
    expect(metrics.wrongCubes).toBe(0);
  });

  it('is driven at the cadence it is given, not the one it was recorded at', async () => {
    // T1: the gate needs an unbroken run of max(3, ceil(0.5*fps)+1) reads, so the FASTER runtime
    // needs the LONGER run — 4 frames at 5 fps, 9 at 15.7, 16 at 30. A fix measured only at the
    // cadence of the machine it was written on is not measured, which is why this is a parameter.
    //
    // The cadence is visible in the times the outcome reports: every capture lands on a tick, so a
    // run driven at 240 ms cannot report one at 90 ms. Asserted exactly rather than by a difference
    // in outcome, which two cadences that both happen to succeed do not produce.
    const session = recordedScan(DEEP, 24, 60);
    const slow = await replaySession(session, { advance, tickMs: 240 });
    for (const side of slow.sides) expect(side.capturedAt! % 240).toBe(0);
    const fast = await replaySession(session, { advance, tickMs: 30 });
    expect(fast.sides.some((side) => side.capturedAt! % 240 !== 0)).toBe(true);
  });

  it('defaults to the cadence the session was recorded at', async () => {
    // A recording of 60 ms frames replays at 60 ms unless a caller says otherwise, so "replay it as
    // it happened" needs no arithmetic at the call site.
    const session = recordedScan(DEEP, 24, 60);
    const outcome = await replaySession(session, { advance });
    for (const side of outcome.sides) expect(side.capturedAt! % 60).toBe(0);
  });

  it('reports no blocking spans at all rather than spans off a faked clock', async () => {
    // A faked clock reads every tick as zero, which would pass a gate that exists to catch a frozen
    // UI (A3: 606 ms of centre resolution on the page's thread). Omitted means unmeasured.
    const session = recordedScan(DEEP, 4);
    const outcome = await replaySession(session, { advance, tickMs: 60, deadlineMs: 600 });
    expect(outcome.blockingMs).toEqual([]);
    expect(scoreSessions([outcome]).blockingMaxMs).toBeNull();
  });
});

describe('the detector reads a long session without rescanning it', () => {
  it('answers correctly when the clock rewinds, not just when it advances', async () => {
    // The cursor is an optimisation — time only moves forward across a replay, so scanning from the
    // start on every tick makes a corpus run quadratic in the session's length. This class is
    // public, so "only ever called with increasing time" is an assumption about callers rather than
    // something it can check once: a clock that goes backwards must get the right frame, not a
    // stale one the cursor happened to be parked on.
    let now = 0;
    const session = recordedScan(DEEP, 3, 100);
    const detector = new RecordedDetector(session, () => now);
    now = 0;
    await detector.next(); // frame 0
    now = 250;
    await detector.next(); // frame 2
    now = 100; // …and back
    await detector.next();
    expect([...detector.served.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });
});
