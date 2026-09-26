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
import { colourOf } from '../src/scheme.js';
import {
  countInterventions,
  isWrongCube,
  reportsOnlyTheCube,
  scoreSessions,
} from '../src/session-metrics.js';
import {
  parseSession,
  type RecordedDetection,
  type RecordedFrame,
  type RecordedSession,
  SESSION_SCHEMA,
} from '../src/session-record.js';
import { FACES, type Face } from '../src/types.js';
import {
  frameTensor,
  namesTheSideInHand,
  namesTheWrongSide,
  RecordedDetector,
  replaySession,
  schemeShownIn,
  sideShownIn,
} from '../view/session-replay.js';

const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

/** The nine detections of one side, laid out as a clean 3x3 grid — `tensorFor`'s geometry. */
function sideDetections(colors: readonly number[]): RecordedDetection[] {
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
 *
 * `order` is the order the sides are SHOWN in, which matters to anything about a collision: which
 * of two sides claiming one colour arrives first decides which is filed. `read` is what the
 * detector makes of a side, so a centre a logo makes unreadable can be recorded as the thing it
 * actually reads — the `truth` stays the cube as it physically is, which is the whole point.
 */
function recordedScan(
  facelets: string,
  hold = 12,
  stepMs = 60,
  opts: {
    order?: readonly Face[];
    read?: (face: Face, colors: number[]) => number[];
    /** Per FRAME, where `read` is per face: for a side whose reading changes while it is held up. */
    readFrame?: (face: Face, i: number, colors: number[]) => number[];
    /**
     * Serve each distinct frame this many ticks, rather than once.
     *
     * What a still cube in front of a camera actually produces, and what the recorder writes down —
     * the distinction C3 is about. The frames are still DISTINCT, because a re-served frame cannot
     * settle a side at all (D2: `Stillness.offer` counts one physical frame once); what changes is
     * that the scan LOOKED far more often than the camera produced, which is exactly the gap
     * between `sessionTicks` and `sessionFps`.
     */
    servedEach?: number;
  } = {},
): RecordedSession {
  const sides = facesOf(facelets);
  const frames: RecordedFrame[] = [];
  let t = 0;
  let id = 0;
  for (const face of opts.order ?? FACES) {
    const colors = opts.read ? opts.read(face, [...sides[face]]) : sides[face];
    const served = opts.servedEach ?? 1;
    for (let i = 0; i < hold; i++) {
      const shown = opts.readFrame ? opts.readFrame(face, i, [...colors]) : colors;
      frames.push({
        id: id++,
        t,
        served,
        ...(served > 1 ? { lastT: t + (served - 1) * stepMs } : {}),
        detections: sideDetections(shown),
      });
      t += served * stepMs;
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
    // WESTERN BY CONSTRUCTION, and recorded rather than left for a harness to assume: `facesOf`
    // maps a facelet LETTER straight to a colour class, which is the Western identity. A truth with
    // no arrangement is a truth that cannot say which colour is in the middle of a side, and
    // `sideShownIn` abstains on one (ADR 0001).
    truth: { facelets, source: 'manual-verified', scheme: 'western' },
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
    expect(metrics.wrongSessions).toBe(0);
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
    expect(metrics.wrongSessions).toBe(0);
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

/**
 * The harness's own edges, from the second audit round (Codex, read-only, 2026-09-23). Each is a
 * way a corpus run could report a number about a scan it did not drive.
 */
describe('the harness refuses to run a replay it cannot drive', () => {
  it('rejects a tick that cannot advance the clock', async () => {
    // Zero or negative never advances `elapsed` and runs for ever; NaN compares false against the
    // deadline and skips the loop entirely, reporting a scan that was never driven as one that
    // captured nothing. Both reach here from a caller's argument and both look like a result.
    const session = recordedScan(DEEP, 4);
    for (const tickMs of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(replaySession(session, { advance, tickMs })).rejects.toThrow(RangeError);
    }
  });

  it('never runs past the deadline every uncaptured side is censored at', async () => {
    // The last tick used to overshoot, so a scan could complete AFTER the time the censoring is
    // measured against — a completion the numbers do not admit.
    const session = recordedScan(DEEP, 24, 60);
    const steps: number[] = [];
    const outcome = await replaySession(session, {
      advance: async (ms) => {
        steps.push(ms);
        await vi.advanceTimersByTimeAsync(ms);
      },
      tickMs: 250,
      deadlineMs: 900, // not a whole number of ticks
    });
    expect(steps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(outcome.deadlineMs);
    for (const side of outcome.sides) expect(side.capturedAt!).toBeLessThanOrEqual(900);
  });

  it('stamps a capture with the tick it happened on, not the one before it', async () => {
    // A capture fires DURING `advance`; stamping it with the elapsed time from before the tick
    // reports every side one tick early — and a side captured on the first tick would read as
    // captured at 0 ms, before the scan was driven at all.
    const session = recordedScan(DEEP, 24, 60);
    const outcome = await replaySession(session, { advance, tickMs: 60 });
    for (const side of outcome.sides) expect(side.capturedAt!).toBeGreaterThan(0);
  });

  it('takes the panel out of the document even when the replay throws', async () => {
    // A throw from `advance` would otherwise leave it mounted with its detector still held, and a
    // corpus run would accumulate one dead panel per session that failed.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = recordedScan(DEEP, 4);
    await expect(
      replaySession(session, {
        advance: async () => {
          throw new Error('the driver gave up');
        },
        tickMs: 60,
        host,
      }),
    ).rejects.toThrow('the driver gave up');
    expect(host.children).toHaveLength(0);
  });
});

describe('the harness measures what it says it measures', () => {
  it('drives the panel at the cadence it advertises, not at the panel’s own floor', async () => {
    // THE DEFECT: `tickMs` set only the size of the batch the faked timers were advanced by, while
    // the panel went on scheduling itself at its 60 ms floor — so `tickMs: 60` and `tickMs: 240`
    // ran the identical scan and differed only in how much simulated time passed per batch. The
    // three-cadence sweep the whole harness exists for (T1: the stillness gate's required run
    // length is a function of the frame rate) was one cadence measured three times.
    //
    // Measured two ways, because each answers half of it.
    //
    // (a) HOW OFTEN THE DETECTOR IS ASKED over a FIXED span. The deadline is the same for both and
    // short enough that neither scan finishes, so the only thing that can change the count is the
    // cadence reaching the scheduler. Under the old harness both counts were identical.
    const session = recordedScan(new Cube().move("R U R' U'").asString(), 12, 60);
    const asksOver = async (tickMs: number): Promise<number> => {
      const detector = new RecordedDetector(session);
      const outcome = await replaySession(session, { advance, tickMs, deadlineMs: 3000, detector });
      expect(outcome.completed, `${tickMs} ms finished, so the span is not fixed`).toBe(false);
      return [...detector.served.values()].reduce((a, b) => a + b, 0);
    };
    const fast = await asksOver(100);
    const slow = await asksOver(250);
    expect(slow, 'the slower cadence asked the detector just as often').toBeLessThan(fast);
    expect(fast / slow, 'the counts did not scale with the cadence').toBeGreaterThan(2);

    // (b) WHERE THE CAPTURES LAND: on the cadence's own grid, which cannot happen if the panel is
    // ticking at 60 ms whatever it was told.
    for (const tickMs of [100, 250]) {
      const outcome = await replaySession(session, { advance, tickMs, deadlineMs: 20_000 });
      expect(outcome.sides.length, `${tickMs} ms captured nothing to check`).toBeGreaterThan(0);
      for (const side of outcome.sides) {
        expect(side.capturedAt! % tickMs, `${tickMs} ms: ${side.face} off the grid`).toBe(0);
      }
    }
  });

  it('publishes the frame’s identity, so one frame cannot settle a side on its own', async () => {
    // D2 straight through the harness: without `frameId` the stillness gate counts every
    // re-serving of one recorded frame as a fresh observation, and a side is captured on a single
    // look while the gate reports a run of three — the very defect the seam was added to correct.
    const session = recordedScan(new Cube().move("R U R' U'").asString(), 12, 60);
    const detector = new RecordedDetector(session, () => 0);
    await detector.use();
    const out = await detector.next();
    expect(out?.frameId, 'the recorded frame id did not reach the panel').toBe(
      session.frames[0]!.id,
    );
  });

  it('refuses a deadline that cannot censor anything, before it mounts a panel', async () => {
    // NaN and a negative deadline skipped the driving loop entirely and reported a scan that was
    // never driven as one that captured nothing; Infinity let a scan that never completes run
    // until the process was killed. And the refusal has to come first, or it leaves a panel in the
    // document with its detector still held.
    const session = recordedScan(new Cube().asString(), 4, 60);
    for (const deadlineMs of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      await expect(
        replaySession(session, { advance, deadlineMs }),
        `${deadlineMs}`,
      ).rejects.toThrow(RangeError);
    }
    expect(
      document.body.querySelector('ai-scan-panel'),
      'a refusal left a panel mounted',
    ).toBeNull();
  });

  it('keeps the camera’s opening silence instead of deleting it', async () => {
    // Replay time used to start at the FIRST detector request with the first frame's timestamp
    // subtracted from every frame, so half a second of a camera that had opened and delivered
    // nothing simply vanished and every frame after it shifted by the same half second.
    const session = recordedScan(new Cube().asString(), 4, 60);
    const late = parseSession({
      ...JSON.parse(JSON.stringify(session)),
      frames: session.frames.map((f) => ({ ...f, t: f.t + 500 })),
    });
    const detector = new RecordedDetector(late, () => 0);
    await detector.use();
    expect(await detector.next(), 'the opening silence was skipped').toBeNull();
    const at = (ms: number) => new RecordedDetector(late, () => ms);
    const early = at(499);
    await early.use();
    expect(await early.next()).toBeNull();
    const onTime = at(500);
    await onTime.use();
    expect((await onTime.next())?.frameId).toBe(late.frames[0]!.id);
  });

  it('says whether it could answer a question about pixels at all', async () => {
    // The header claims the WHOLE pipeline is run, and without a resolver every pixel-dependent
    // path was silently skipped — a harness quietly not testing the thing it says it tests.
    const session = recordedScan(new Cube().asString(), 4, 60);
    expect((await replaySession(session, { advance })).pixelsAvailable).toBe(false);

    const withRefs = parseSession({
      ...JSON.parse(JSON.stringify(session)),
      frames: session.frames.map((f) => ({ ...f, pixels: `frame-${f.id}.png` })),
    });
    // Still false with references but no resolver: both halves are needed.
    expect((await replaySession(withRefs, { advance })).pixelsAvailable).toBe(false);

    const asked: string[] = [];
    const pixels = async (ref: string) => {
      asked.push(ref);
      return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    };
    const outcome = await replaySession(withRefs, { advance, pixels });
    expect(outcome.pixelsAvailable).toBe(true);

    // And the resolver is reached BY FRAME ID, through the detector's own seam.
    const detector = new RecordedDetector(withRefs, () => 0, pixels);
    await detector.use();
    expect(await detector.framePixels?.(withRefs.frames[0]!.id)).not.toBeNull();
    expect(asked.at(-1)).toBe(`frame-${withRefs.frames[0]!.id}.png`);
    expect(await detector.framePixels?.(9999), 'a frame it never recorded').toBeNull();
  });
});

describe('the instants the harness reports are instants, not intervals', () => {
  it('stamps a capture at the tick that made it, and at a frame the session actually holds', async () => {
    // WHAT WENT WRONG, MEASURED BY THE VERIFIER: a capture at 1,060 ms was reported as 1,200 ms.
    // Two things caused it and both had to change. The listener fires DURING `advance`, and the
    // driving loop\u2019s own counter had already been moved to the END of that batch by then; and a
    // batch was four of the panel\u2019s own ticks, because `tickMs` never reached the scheduler. The
    // stamp is read from the clock the panel reads now, and a batch is exactly one tick.
    //
    // The property that says so: every capture lands on a tick boundary AND within one tick of a
    // frame the recording holds. A batch endpoint four ticks wide satisfies neither.
    const session = recordedScan(new Cube().move("R U R' U'").asString(), 12, 60);
    const outcome = await replaySession(session, { advance, tickMs: 240, deadlineMs: 20_000 });
    expect(
      outcome.sides.length,
      'nothing was captured, so the case proves nothing',
    ).toBeGreaterThan(0);
    const frameTimes = session.frames.map((f) => f.t);
    for (const side of outcome.sides) {
      const at = side.capturedAt!;
      expect(at % 240, `${side.face} is not on a tick`).toBe(0);
      expect(at).toBeLessThanOrEqual(outcome.deadlineMs);
      const nearest = Math.min(...frameTimes.map((t) => Math.abs(t - at)));
      expect(nearest, `${side.face} at ${at} ms names no frame the recording holds`).toBeLessThan(
        240,
      );
    }
  });

  it('refuses to report a run whose clock never moved', async () => {
    // A caller that fakes timers WITHOUT faking the clock the panel reads would get a table of
    // identical timestamps that reads as an instantaneous scan. It is a broken harness, not a fast
    // one, and the run says so.
    const session = recordedScan(new Cube().asString(), 4, 60);
    await expect(
      replaySession(session, { advance, deadlineMs: 500, clock: () => 0 }),
    ).rejects.toThrow(/clock never advanced/);
  });

  it('a single repeated frame cannot settle a side, through the whole harness', async () => {
    // D2 end to end: the recorded frame's identity reaches the gate, so a source re-serving ONE
    // physical frame cannot satisfy "three identical reads spanning 500 ms" on its own. Built as a
    // session whose every frame carries the same id, which is what `served` describes on the
    // native path — sixteen ticks a second off one picture.
    const scan = recordedScan(new Cube().asString(), 12, 60);
    const oneFrame = parseSession({
      ...JSON.parse(JSON.stringify(scan)),
      frames: [
        {
          ...JSON.parse(JSON.stringify(scan.frames[0])),
          id: 0,
          t: 0,
          served: 200,
          lastT: 12_000,
        },
      ],
    });
    const outcome = await replaySession(oneFrame, { advance, tickMs: 60, deadlineMs: 12_000 });
    expect(outcome.sides, 'a side was captured from one re-served frame').toEqual([]);
    expect(outcome.completed).toBe(false);
  });
});

describe('the one ask a replay can answer (plan §6, item 1)', () => {
  // WHY THIS ASK AND NOT THE OTHERS. Frames are selected by recorded time alone, so a request for a
  // SIDE measures a policy against a fixed showing sequence — the 09-18 clip never returns to the
  // logo face after its fifth capture, and no harness can make it. An identity question is about a
  // capture the scan is already HOLDING, so answering it needs no frame the recording does not
  // contain: a scenario here is an experiment rather than a re-run.

  /**
   * A recording of the logo cube, shown in the order the question can be answered in.
   *
   * The YELLOW side first, read properly, so yellow is taken by the side it belongs to; then the
   * WHITE side, whose centre the detector reads as yellow. That is a collision with four slots
   * free, which is exactly what §5's question is for. (Shown the other way round it is the case
   * the 09-18 recording actually contains, and no answer §5 admits can place it — see
   * `real-clip.test.ts`.)
   */
  const logoScan = (): RecordedSession =>
    recordedScan(DEEP, 12, 60, {
      order: ['D', 'U', 'R', 'F', 'L', 'B'],
      read: (face, colors) => {
        if (face !== 'U') return colors;
        const cap = [...colors];
        cap[4] = LETTER_CLASS.D; // the logo's ink, read as the yellow side's colour
        return cap;
      },
    });

  it('asks, and with nobody to answer files five sides and reports no cube', async () => {
    const out = await replaySession(logoScan(), { advance });
    expect(out.identity).toHaveLength(1);
    expect(out.identity[0]?.claimed).toBe(LETTER_CLASS.D);
    expect(
      out.identity[0]?.answered,
      'a question nobody answered was recorded as a decision',
    ).toBeNull();
    expect(out.identity[0]?.right).toBeNull();
    expect(new Set(out.sides.map((s) => s.face)).size).toBe(5);
    expect(out.completed).toBe(false);
    expect(out.completedAt, 'a scan that never finished was given a finishing time').toBeNull();
  });

  it('answered from the truth, it completes — and says when', async () => {
    const session = logoScan();
    const out = await replaySession(session, {
      advance,
      answerIdentity: namesTheSideInHand(session),
    });
    expect(out.identity[0]?.answered).toBe(LETTER_CLASS.U);
    expect(out.identity[0]?.right).toBe(true);
    expect(out.completed).toBe(true);
    expect(out.reported).toBe(DEEP);
    // TIME TO COMPLETE, which the harness could not say at all: the timestamps belonged to
    // individual filings, and a scan that filed five sides quickly and never got the sixth looked
    // fast by every number the run produced.
    expect(out.completedAt).not.toBeNull();
    const lastSide = Math.max(...out.sides.map((s) => s.capturedAt ?? 0));
    expect(out.completedAt!).toBeGreaterThanOrEqual(lastSide);
    expect(out.completedAt!).toBeLessThanOrEqual(out.deadlineMs);
  });

  it('answered wrongly, it still never reports a cube that is not the cube', async () => {
    // THE GATE (§6). A person who names the wrong colour is a configuration, and no configuration
    // may report something that is not the cube. The scan may finish or refuse; it may not lie.
    const session = logoScan();
    const out = await replaySession(session, {
      advance,
      answerIdentity: namesTheWrongSide(session),
    });
    expect(
      out.identity[0]?.answered,
      'the wrong answer was never given, so this case tests nothing',
    ).not.toBe(LETTER_CLASS.U);
    expect(out.identity[0]?.right).toBe(false);
    expect(isWrongCube(out), 'a wrong answer produced a cube that is not the cube').toBe(false);
    expect(reportsOnlyTheCube(scoreSessions([out])).ok).toBe(true);
  });

  it('set aside, it is a decision and not an absence', async () => {
    const out = await replaySession(logoScan(), { advance, answerIdentity: () => 'skip' });
    expect(out.identity[0]?.answered).toBe('skip');
    expect(out.completed).toBe(false);
    // A skip and a question nobody looked at leave the same scan behind and are not the same act.
    const ignored = await replaySession(logoScan(), { advance });
    expect(countInterventions([out]).identitySkipped).toBe(1);
    expect(countInterventions([out]).identityIgnored).toBe(0);
    expect(countInterventions([ignored]).identitySkipped).toBe(0);
    expect(countInterventions([ignored]).identityIgnored).toBe(1);
  });

  it('records one question once, however many reports carry it', async () => {
    // The question rides on EVERY report while it stands — that is what a pinned question is — so
    // a harness that counted reports would make one question look like a hundred. The same mistake
    // `looksAsked` avoids, one field along.
    const out = await replaySession(logoScan(), { advance });
    const reportsWhileAsking = out.identity.length;
    expect(reportsWhileAsking).toBe(1);
  });

  it('a recorded silence is replayed as silence, not as the frame before it', async () => {
    // CODEX AUDIT, 2026-09-26. Only frames were written down, so a stretch in which the camera
    // produced NOTHING left no trace and this served the frame before it straight across the gap —
    // an unbroken run the live scan never had. Live the nulls broke the stillness run and nothing
    // was captured; replayed, the gate saw three identical reads and settled a side.
    //
    // NOT INFERRABLE FROM `served`, which counts how often the SCAN consumed a frame: a real camera
    // re-serves its last frame, so replaying faster than the recording must re-serve too. A first
    // attempt read the gap out of `served` and broke exactly that case.
    const sides = facesOf(DEEP);
    const frames: RecordedFrame[] = [];
    const blind: number[] = [];
    let id = 0;
    let t = 0;
    for (const face of FACES) {
      // Three good frames 100 ms apart — enough to settle — with a dead tick between each pair.
      for (let i = 0; i < 3; i++) {
        frames.push({ id: id++, t, served: 1, detections: sideDetections(sides[face]) });
        blind.push(t + 50);
        t += 100;
      }
      t += 400;
    }
    const base = recordedScan(DEEP, 1, 60);
    const quiet = parseSession({
      ...(JSON.parse(JSON.stringify(base)) as Record<string, unknown>),
      frames,
      blind,
    });
    const loud = parseSession({
      ...(JSON.parse(JSON.stringify(base)) as Record<string, unknown>),
      frames,
      blind: [],
    });
    const withSilence = await replaySession(quiet, { advance, tickMs: 50 });
    const without = await replaySession(loud, { advance, tickMs: 50 });
    expect(
      without.sides.length,
      'the case measures nothing unless the same frames settle WITHOUT the silence',
    ).toBeGreaterThan(0);
    expect(
      withSilence.sides.length,
      'a recorded silence was replayed as the frame before it',
    ).toBeLessThan(without.sides.length);
  });

  it('replays at the rate the scan LOOKED, not at the rate the camera gave new frames', async () => {
    // CODEX AUDIT, 2026-09-26. A camera that re-serves the same frame is the ordinary case — it is
    // the whole subject of C3 — and the default cadence came from `sessionFps`, which counts
    // DISTINCT frames. A session driven at 60 ms that saw one new frame per side therefore replayed
    // at hundreds of milliseconds a tick, and settled nothing a live scan settled.
    // Each side settles from distinct frames, but the scan LOOKED ten times per frame.
    const reserved = recordedScan(DEEP, 3, 60, { servedEach: 30 });
    const out = await replaySession(reserved, { advance });
    expect(out.sides.length, 'the replay ticked at the frame rate, so no side ever settled').toBe(
      FACES.length,
    );
  });

  it('one question stays one question when its capture is re-read slightly differently', async () => {
    // CODEX AUDIT, 2026-09-26. This keyed a question on its COLOURS, which stopped being a
    // question's identity on 2026-09-25: the panel now keeps a question across a re-settle of the
    // same side and REPLACES its capture (`openIdentity`), so one flickering outer sticker read as
    // a second question — the count inflated, and the policy asked to answer again for a question
    // the panel considers unchanged and whose earlier answer it would refuse as stale.
    const flickering = recordedScan(DEEP, 24, 60, {
      order: ['D', 'U', 'R', 'F', 'L', 'B'],
      read: (face, colors) => {
        if (face !== 'U') return colors;
        const cap = [...colors];
        cap[4] = LETTER_CLASS.D; // the logo's ink, read as the yellow side's colour
        return cap;
      },
      // PER FRAME, so the side settles once as read — raising the question — and then settles AGAIN
      // with one outer sticker different. Still `sameSide`, so the panel keeps the question it has.
      readFrame: (face, i, colors) => {
        if (face !== 'U' || i < 12) return colors;
        const cap = [...colors];
        cap[0] = (cap[0]! + 1) % 6;
        return cap;
      },
    });
    const asked: number[] = [];
    const out = await replaySession(flickering, {
      advance,
      answerIdentity: (ask) => {
        asked.push(ask.id);
        return null; // nobody answers; the question stands and is re-settled under it
      },
    });
    expect(new Set(asked).size, 'the panel raised more than one question').toBe(1);
    expect(out.identity, 'one question was recorded as two').toHaveLength(1);
  });

  it('counts what the PERSON did, not what the scan asked', async () => {
    // §6, item 3. `looksAsked` counts asks: an ask nobody answered and an ask answered are the same
    // number. These are the acts.
    const withPerson = logoScan();
    const answered = await replaySession(withPerson, {
      advance,
      answerIdentity: namesTheSideInHand(withPerson),
    });
    const alone = await replaySession(logoScan(), { advance });
    expect(countInterventions([answered]).acts).toBe(1);
    expect(
      countInterventions([alone]).acts,
      'a question nobody answered cost somebody an act',
    ).toBe(0);
    expect(countInterventions([alone]).identityAsked).toBe(1);
  });

  it('a scan with nothing to ask about costs nothing and finishes', async () => {
    // The ordinary cube, for contrast: no question, no acts, and a completion time.
    const plain = recordedScan(DEEP);
    const out = await replaySession(plain, {
      advance,
      answerIdentity: namesTheSideInHand(plain),
    });
    expect(out.identity).toEqual([]);
    expect(out.completed).toBe(true);
    expect(countInterventions([out]).acts).toBe(0);
    const m = scoreSessions([out]);
    expect(m.timeToCompleteMedianMs).toBe(out.completedAt);
    expect(m.interventions.acts).toBe(0);
  });

  it('a corpus of one finisher and one non-finisher censors the completion time', async () => {
    // Completion is censored exactly as a side is: the scan that did not finish is known to have
    // taken longer than its deadline, and nothing more. Dropping it would report the time of the
    // sessions that happened to work.
    const done = await replaySession(recordedScan(DEEP), { advance });
    const stuck = await replaySession(logoScan(), { advance });
    const m = scoreSessions([done, stuck]);
    expect(m.completed).toBe(1);
    expect(m.timeToCompleteMedianMs).toBe(done.completedAt);
    // Half the sessions finished, so the curve reaches 0.5 and no further: the p90 does not exist
    // in this record, and null says so rather than inventing one.
    expect(m.timeToCompleteP90Ms).toBeNull();
  });
});

describe('what a Codex audit of the harness found (2026-09-25)', () => {
  const logoScan = (): RecordedSession =>
    recordedScan(DEEP, 12, 60, {
      order: ['D', 'U', 'R', 'F', 'L', 'B'],
      read: (face, colors) => {
        if (face !== 'U') return colors;
        const cap = [...colors];
        cap[4] = LETTER_CLASS.D;
        return cap;
      },
    });

  it('a truth string is POSITIONAL, so the oracle needs the cube’s arrangement', () => {
    // ADR 0001's oldest trap, in a harness: `FACES.indexOf(letter)` maps a facelet letter to a
    // colour class through the WESTERN identity. On a Japanese cube the Down position wears blue
    // and the Back position yellow, so the same capture names a different colour — and a harness
    // that assumed one arrangement would score a correct scan of the other as a misread.
    /** The nine stickers at POSITION `face` of DEEP, as a camera would read them off a cube built
     *  to `scheme` — which is what a capture actually holds. */
    const asRead = (face: Face, scheme: 'western' | 'japanese'): number[] => {
      const at = FACES.indexOf(face) * 9;
      return [...DEEP.slice(at, at + 9)].map((l) => colourOf(l as Face, scheme));
    };
    // THE SAME PHYSICAL SIDE OF THE SAME CUBE, read off the two kinds of cube. Its centre is
    // yellow on one and blue on the other, and that is the whole of the trap.
    expect(sideShownIn(asRead('D', 'western'), DEEP, 'western')).toBe(colourOf('D', 'western'));
    expect(sideShownIn(asRead('D', 'japanese'), DEEP, 'japanese')).toBe(colourOf('D', 'japanese'));
    // …and read under the WRONG arrangement it does not name that side's colour.
    expect(sideShownIn(asRead('D', 'japanese'), DEEP, 'western')).not.toBe(
      colourOf('D', 'japanese'),
    );
    // WITH NO ARRANGEMENT RECORDED the reading usually settles it: a capture off a Western cube
    // matches a Western recolouring of the truth and, on most sides, nothing in a Japanese one, so
    // exactly one arrangement answers and that answer is a measurement rather than a guess.
    expect(sideShownIn(asRead('D', 'western'), DEEP)).toBe(colourOf('D', 'western'));
    expect(sideShownIn(asRead('D', 'japanese'), DEEP)).toBe(colourOf('D', 'japanese'));
    expect(sideShownIn(asRead('U', 'western'), DEEP)).toBe(colourOf('U', 'western'));
    // …and where neither arrangement can name it, null: a solid face of one colour is every
    // rotation of itself and several sides at once.
    expect(sideShownIn(Array(9).fill(colourOf('U', 'western')), DEEP)).toBeNull();
  });

  it('…and the arrangement can be measured from a whole drop of captures', () => {
    // Only the Down and Back positions differ between the two, so one side rarely separates them
    // and six together usually do. This is what lets a fixture that recorded no scheme be read
    // rather than assumed (`centre-collision.test.ts`).
    const sides = facesOf(DEEP);
    expect(
      schemeShownIn(
        FACES.map((f) => sides[f]),
        DEEP,
      ),
    ).toBe('western');
    expect(schemeShownIn([], DEEP), 'nothing cannot name an arrangement').toBeNull();
  });

  it('the wrong-answer scenario abstains rather than risk giving the right answer', () => {
    // It used to stand in `-1` for "the truth could not say", which makes EVERY choice eligible —
    // including the right one — so a wrong-answer run could quietly give the right answer and be
    // scored as a mistake.
    const unknowable = {
      id: 1,
      colors: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      claimed: 0,
      displaced: false,
      choices: [0, 1, 2],
    };
    const session = logoScan();
    expect(namesTheWrongSide(session)(unknowable)).toBeNull();
    // On a capture the truth CAN name, it gives a colour that is not the right one.
    const sides = facesOf(DEEP);
    const said = namesTheWrongSide(session)({
      id: 2,
      colors: sides.U,
      claimed: 0,
      displaced: false,
      choices: [0, 1, 2],
    });
    expect(said).not.toBeNull();
    expect(said).not.toBe(LETTER_CLASS.U);
  });

  it('a policy that throws fails the run instead of looking like nobody answered', async () => {
    // A policy runs inside a DOM listener, so a throw from it never reaches the promise: the record
    // stayed `answered: null` and a broken policy was indistinguishable from a person who did not
    // look — silently turning a correct-answer scenario into a no-answer one.
    const boom = new Error('the person fell over');
    await expect(
      replaySession(logoScan(), {
        advance,
        answerIdentity: () => {
          throw boom;
        },
      }),
    ).rejects.toThrow(/identity policy threw/);
    // …and the panel does not stay in the document over it.
    expect(document.body.querySelector('ai-scan-panel')).toBeNull();
  });

  it('a supplied detector may not silently swallow a supplied pixel resolver', async () => {
    // A caller passes its own detector to read `served` afterwards; passing `pixels` alongside used
    // to do nothing at all, and every pixel-dependent path was skipped in a harness whose purpose
    // is to exercise the pipeline.
    const session = recordedScan(DEEP);
    await expect(
      replaySession(session, {
        advance,
        detector: new RecordedDetector(session),
        pixels: async () => null,
      }),
    ).rejects.toThrow(/carry the pixel resolver on that detector/);
    // …and the refusal leaves nothing behind: thrown after the mount it left a dead panel in the
    // document, and a corpus run would accumulate one per refused call.
    expect(document.body.querySelector('ai-scan-panel')).toBeNull();
  });

  it('a policy that throws NULL still fails the run', async () => {
    // `throw null` is legal, so testing the stored error against null read a thrown null as "no
    // policy ran" and handed back a run scored as unanswered. What is being asked is "did it
    // throw", and only a flag says.
    await expect(
      replaySession(logoScan(), {
        advance,
        answerIdentity: () => {
          // A NON-ERROR THROW ON PURPOSE: the case exists because `throw null` is legal and was
          // read as "no policy ran".
          throw null;
        },
      }),
    ).rejects.toThrow(/identity policy threw/);
  });
});
