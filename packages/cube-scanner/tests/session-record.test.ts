// Stage 0's instrument: the recorded-session format, the recorder that produces one, the corpus
// that holds them, and the arithmetic every later stage is gated on
// (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4).
//
// The assertions here are mostly about what must NOT be possible, because an instrument that reads
// a malformed entry as a slightly different measurement is worse than one that refuses — and the
// whole reason this exists is that six fixes in a row were judged on unit tests and one lucky clip.

import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import {
  describeCorpus,
  HELDOUT_FRACTION,
  hashCube,
  loadCorpus,
  sessionsIn,
  splitOf,
} from '../src/corpus.js';
import type { Detection } from '../src/onnx-postprocess.js';
import {
  censoredQuantile,
  isWrongCube,
  passesStageGate,
  type SessionOutcome,
  scoreSessions,
  wrongCubeRateBound,
} from '../src/session-metrics.js';
import {
  parseSession,
  type RecordedSession,
  SESSION_SCHEMA,
  SessionFormatError,
  sessionFps,
  sessionTicks,
} from '../src/session-record.js';
import { traceEnabled } from '../view/scan-trace.js';
import { recordEnabled, SessionRecorder, worthRecording } from '../view/session-recorder.js';

const SOLVED = new Cube().asString();
const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

const det = (over: Partial<Detection> = {}): Detection => ({
  cx: 100,
  cy: 100,
  w: 20,
  h: 20,
  classId: 0,
  confidence: 0.9,
  scores: [0.9, 0, 0, 0, 0, 0],
  ...over,
});

function sessionValue(over: Partial<RecordedSession> = {}): unknown {
  return {
    schema: SESSION_SCHEMA,
    id: 'sitting-1',
    startedAt: '2026-09-23T10:00:00Z',
    cube: 'logo-white-centre',
    conditions: {
      camera: 'built-in',
      lighting: 'daylight',
      handling: 'careful',
      state: 'scrambled',
    },
    model: { hash: 'abc123', name: 'cubedet', runtime: 'apple' },
    truth: { facelets: DEEP, source: 'manual-verified' },
    frames: [
      { id: 0, t: 0, served: 1, detections: [det()] },
      { id: 1, t: 60, served: 3, detections: [det({ classId: 2 })] },
    ],
    decisions: [{ frame: 1, t: 60, kind: 'captured', detail: { face: 'U' } }],
    ...over,
  };
}

describe('the recorded-session format refuses what it cannot measure over', () => {
  it('parses a well-formed session, and counts frames apart from ticks', () => {
    const s = parseSession(sessionValue());
    expect(s.frames).toHaveLength(2);
    // The gap between these two IS C3's size: the ticks that consumed a frame already consumed.
    expect(sessionTicks(s)).toBe(4);
    expect(sessionFps(s)).toBeCloseTo(1 / 0.06, 5);
  });

  it('refuses a schema it does not understand rather than interpreting it loosely', () => {
    expect(() => parseSession(sessionValue({ schema: 'cubus-scan-session/2' as never }))).toThrow(
      SessionFormatError,
    );
  });

  it('refuses a truth that came from the detector, whatever it is called', () => {
    // A corpus labelled by the thing being measured measures nothing (§4.1). The type forbids it
    // and so does the parser, because a corpus is loaded by scripts from files on disk.
    for (const source of ['detector', 'scan', '']) {
      expect(() =>
        parseSession(sessionValue({ truth: { facelets: DEEP, source: source as never } })),
      ).toThrow(/smart-cube|non-empty/);
    }
  });

  it('refuses a truth that is not a well-formed cube', () => {
    // Scored against, a malformed truth would mark every scan of it wrong and the bug would look
    // like a detector regression.
    const notACube = `${DEEP.slice(0, 53)}U`;
    expect(() =>
      parseSession(sessionValue({ truth: { facelets: notACube, source: 'smart-cube' } })),
    ).toThrow(/well-formed cube/);
  });

  it('refuses frame ids that do not increase, and timestamps that go backwards', () => {
    // Ids that merely LOOK monotonic are what made the re-served native frame invisible in the
    // first place; a corpus that admitted a repeat would let the same defect back in through the
    // measurement meant to catch it.
    const repeated = sessionValue({
      frames: [
        { id: 0, t: 0, served: 1, detections: [] },
        { id: 0, t: 60, served: 1, detections: [] },
      ] as never,
    });
    expect(() => parseSession(repeated)).toThrow(/does not increase/);
    const backwards = sessionValue({
      frames: [
        { id: 0, t: 60, served: 1, detections: [] },
        { id: 1, t: 10, served: 1, detections: [] },
      ] as never,
    });
    expect(() => parseSession(backwards)).toThrow(/goes back before/);
  });

  it('refuses a detection recorded without its full score vector', () => {
    // The five non-winning scores are what a whole-cube repair and any soft accumulation read
    // (F4/P2); a corpus missing them cannot answer the questions it was built for.
    const short = sessionValue({
      frames: [{ id: 0, t: 0, served: 1, detections: [{ ...det(), scores: undefined }] }] as never,
    });
    expect(() => parseSession(short)).toThrow(/every class score/);
  });

  it('refuses a decision pointing at a frame the session does not hold', () => {
    const orphan = sessionValue({
      decisions: [{ frame: 99, t: 10, kind: 'captured', detail: {} }] as never,
    });
    expect(() => parseSession(orphan)).toThrow(/not a frame of this session/);
  });
});

describe('the recorder produces sessions the reader accepts', () => {
  it('records distinct frames once and counts the ticks a re-served one was served to', () => {
    // D2 through the instrument: the native camera serves its cached frame for up to a second, and
    // a recording that could not distinguish them would bake that defect into the corpus.
    let now = 0;
    const rec = new SessionRecorder(
      100,
      () => now,
      () => '2026-09-23T10:00:00Z',
    );
    rec.begin({ id: 's1', model: { hash: 'abc', name: 'cubedet', runtime: 'apple' } });
    rec.frame([det()], { frameId: 10 });
    now = 60;
    rec.frame([det()], { frameId: 10 }); // the SAME picture, a second tick
    now = 120;
    rec.frame([det()], { frameId: 10 }); // and a third
    now = 180;
    rec.frame([det({ classId: 1 })], { frameId: 11 });
    rec.decision('captured', { face: 'U' });

    const session = rec.finish({
      cube: 'logo-white-centre',
      conditions: {
        camera: 'built-in',
        lighting: 'daylight',
        handling: 'careful',
        state: 'scrambled',
      },
      truth: { facelets: DEEP, source: 'smart-cube' },
    })!;
    expect(session.frames.map((f) => [f.id, f.served])).toEqual([
      [10, 3],
      [11, 1],
    ]);
    // And it round-trips through the reader, which is the only claim that matters.
    expect(() => parseSession(JSON.parse(JSON.stringify(session)))).not.toThrow();
    expect(sessionTicks(session)).toBe(4);
  });

  it('keeps candidates far below the scan’s own threshold', () => {
    // Today's stuck session had a centre scoring 0.20–0.25 on 177 frames. A recording made at
    // MIN_STICKER_CONFIDENCE would not contain the frames the failure is made of.
    const kept = worthRecording([
      det({ confidence: 0.22 }),
      det({ confidence: 0.06 }),
      det({ confidence: 0.01 }),
    ]);
    expect(kept.map((d) => d.confidence)).toEqual([0.22, 0.06]);
  });

  it('drops a detection with no scores rather than writing a session no reader will load', () => {
    expect(worthRecording([{ ...det(), scores: undefined }])).toEqual([]);
  });

  it('hands back nothing when there is nothing that could be a corpus entry', () => {
    const rec = new SessionRecorder();
    expect(
      rec.finish({
        cube: 'worn',
        conditions: {
          camera: 'built-in',
          lighting: 'daylight',
          handling: 'careful',
          state: 'scrambled',
        },
        truth: { facelets: SOLVED, source: 'smart-cube' },
      }),
    ).toBeNull();
  });

  it('prunes decisions whose frames the capacity dropped', () => {
    // A long sitting is exactly when the oldest frames go, and `parseSession` refuses a decision
    // pointing at one — a recorder must not be able to produce a file it cannot produce.
    let now = 0;
    const rec = new SessionRecorder(
      2,
      () => now,
      () => '2026-09-23T10:00:00Z',
    );
    rec.begin({ id: 's2', model: { hash: 'abc', name: 'cubedet', runtime: 'web' } });
    rec.frame([det()], { frameId: 1 });
    rec.decision('captured', { face: 'U' }); // against frame 1, which is about to fall off
    for (const id of [2, 3, 4]) {
      now += 60;
      rec.frame([det()], { frameId: id });
    }
    const session = rec.finish({
      cube: 'worn',
      conditions: { camera: 'iphone', lighting: 'dim', handling: 'careless', state: 'near-solved' },
      truth: { facelets: DEEP, source: 'manual-verified' },
    })!;
    expect(rec.size.framesDropped).toBe(2);
    expect(session.decisions).toEqual([]);
    expect(() => parseSession(JSON.parse(JSON.stringify(session)))).not.toThrow();
  });
});

describe('the corpus holds out whole cubes', () => {
  const entry = (id: string, cube: string, lighting = 'daylight') => ({
    source: `${id}.json`,
    value: sessionValue({
      id,
      cube,
      conditions: {
        camera: 'built-in',
        lighting,
        handling: 'careful',
        state: 'scrambled',
      } as never,
    }),
  });

  it('splits on the cube’s name alone, so adding a session never moves an existing cube', () => {
    // Every number ever measured against the corpus becomes incomparable with the next one if the
    // boundary moves under it.
    const before = ['logo-white-centre', 'worn', 'stickerless', 'today', 'black-body'].map((c) => [
      c,
      splitOf(c),
    ]);
    expect(before.map(([c]) => splitOf(c as string))).toEqual(before.map(([, s]) => s));
    expect(hashCube('worn')).toBe(hashCube('worn'));
    expect(hashCube('worn')).not.toBe(hashCube('logo-white-centre'));
  });

  it('refuses two recordings claiming to be the same sitting', () => {
    // Counting both would weight one sitting twice in every average and in the wrong-cube bound.
    expect(() => loadCorpus([entry('s1', 'worn'), entry('s1', 'stickerless')])).toThrow(
      /already used by/,
    );
  });

  it('names its own shortfalls rather than letting a run imply more than it measured', () => {
    const corpus = loadCorpus([entry('a', 'worn'), entry('b', 'logo-white-centre')]);
    const cover = describeCorpus(corpus);
    expect(cover.cubes).toBe(2);
    expect(cover.shortfalls.join(' ')).toMatch(/2 of 5 cubes/);
    expect(cover.shortfalls.join(' ')).toMatch(/lighting conditions/);
    expect(cover.shortfalls.join(' ')).toMatch(/no session carries pixels/);
    // And the split is over cubes, not sessions.
    expect(sessionsIn(corpus, 'train').length + sessionsIn(corpus, 'heldout').length).toBe(2);
    expect(HELDOUT_FRACTION).toBeGreaterThan(0);
  });
});

describe('the measurements every later stage is gated on', () => {
  const side = (capturedAt: number | null) => ({ face: 'U', capturedAt });
  const outcome = (over: Partial<SessionOutcome> = {}): SessionOutcome => ({
    sessionId: 's',
    cube: 'worn',
    deadlineMs: 30000,
    completed: true,
    reported: DEEP,
    truth: DEEP,
    sides: [0, 1, 2, 3, 4, 5].map((i) => side(1000 + i * 1000)),
    looksAsked: 0,
    blockingMs: [],
    ...over,
  });

  it('a scan that never reported is incomplete, not wrong', () => {
    // Conflating the two would let a change that refuses everything score as one that fixed it.
    expect(isWrongCube(outcome({ reported: null, completed: false }))).toBe(false);
    expect(isWrongCube(outcome({ reported: SOLVED }))).toBe(true);
  });

  it('censors a side that was never captured instead of dropping it or counting the deadline', () => {
    // Dropping it reports the time of the sessions that happened to work — the number that made
    // every previous fix look fine. Counting it AS the deadline invents a completion.
    const stuck = outcome({
      completed: false,
      reported: null,
      sides: [side(1000), side(2000), side(3000), side(4000), side(5000)],
    });
    const m = scoreSessions([stuck]);
    expect(m.sidesCaptured).toBe(5);
    expect(m.sidesCensored).toBe(1);
    expect(m.completionRate).toBe(0);
  });

  it('answers null for a quantile the data cannot reach', () => {
    // THE RESULT, not a gap. With a third of sides never captured a p90 does not exist in the
    // record, and any number returned for it would be invented.
    const obs = [
      { time: 100, captured: true },
      { time: 200, captured: true },
      { time: 999, captured: false },
      { time: 999, captured: false },
    ];
    expect(censoredQuantile(obs, 0.5)).toBe(200);
    expect(censoredQuantile(obs, 0.9)).toBeNull();
  });

  it('never reports a wrong-cube rate of zero', () => {
    // "Zero wrong cubes" invites the reading that the rate is zero, and a finite corpus cannot say
    // that. Sixty clean independent sessions still allow just under 4.9% — the audit's own figure.
    expect(wrongCubeRateBound(0, 60)).toBeCloseTo(0.0487, 4);
    expect(wrongCubeRateBound(0, 1)).toBeCloseTo(0.95, 6);
    expect(wrongCubeRateBound(1, 60)).toBeGreaterThan(wrongCubeRateBound(0, 60));
    expect(scoreSessions([outcome()]).wrongCubeRateUpperBound).toBeGreaterThan(0);
  });

  it('gates on completion up, p90 down, and no new wrong cubes', () => {
    const before = scoreSessions([outcome(), outcome({ sessionId: 't', cube: 'logo' })]);
    const worse = scoreSessions([
      outcome({ completed: false, reported: null }),
      outcome({ sessionId: 't', cube: 'logo' }),
    ]);
    expect(passesStageGate(before, before).ok).toBe(true);
    const fell = passesStageGate(before, worse);
    expect(fell.ok).toBe(false);
    expect(fell.reasons.join(' ')).toMatch(/completion fell/);
    // A wrong cube is a gate failure on its own, however fast the scan got.
    const wrong = scoreSessions([
      outcome({ reported: SOLVED }),
      outcome({ sessionId: 't', cube: 'logo' }),
    ]);
    expect(passesStageGate(before, wrong).reasons.join(' ')).toMatch(/wrong cubes rose/);
  });

  it('treats a p90 that was reachable and no longer is as a regression', () => {
    // Null is not a free pass in either direction.
    const reachable = scoreSessions([outcome()]);
    const unreachable = scoreSessions([
      outcome({ sides: [side(1000), side(null), side(null), side(null), side(null), side(null)] }),
    ]);
    expect(reachable.timeToSideP90Ms).not.toBeNull();
    expect(unreachable.timeToSideP90Ms).toBeNull();
    expect(passesStageGate(reachable, unreachable).reasons.join(' ')).toMatch(
      /p90 time-to-side was reachable before/,
    );
  });
});

describe('a recording stays readable when the source contradicts itself', () => {
  it('renumbers a frame whose id does not increase, and says it did', () => {
    // The browser's frame identity is the video's presentation time, which restarts at zero when a
    // stream is replaced — so a scan that switched camera mid-recording would write a session
    // `parseSession` refuses, and a recording nobody can load is a recording that did not happen.
    // The frame is kept under the recorder's own ordinal, and `renumbered` says the ids are no
    // longer the camera's: a silent substitution would look exactly like a clean recording.
    let now = 0;
    const rec = new SessionRecorder(
      100,
      () => now,
      () => '2026-09-23T10:00:00Z',
    );
    rec.begin({ id: 's3', model: { hash: 'abc', name: 'cubedet', runtime: 'web' } });
    rec.frame([det()], { frameId: 5000 });
    now = 60;
    rec.frame([det()], { frameId: 12 }); // the stream restarted its clock
    now = 120;
    rec.frame([det()], { frameId: 40 }); // …and carries on from there
    const session = rec.finish({
      cube: 'worn',
      conditions: { camera: 'built-in', lighting: 'dim', handling: 'careful', state: 'scrambled' },
      truth: { facelets: DEEP, source: 'manual-verified' },
    })!;
    expect(rec.size.renumbered).toBe(2);
    expect(session.frames.map((f) => f.id)).toEqual([5000, 5001, 5002]);
    // The only claim that matters: a reader still accepts it.
    expect(() => parseSession(JSON.parse(JSON.stringify(session)))).not.toThrow();
  });

  it('counts nothing as renumbered on a source whose ids behave', () => {
    let now = 0;
    const rec = new SessionRecorder(
      100,
      () => now,
      () => '2026-09-23T10:00:00Z',
    );
    rec.begin({ id: 's4', model: { hash: 'abc', name: 'cubedet', runtime: 'apple' } });
    for (const id of [3, 3, 4, 9]) {
      rec.frame([det()], { frameId: id });
      now += 60;
    }
    expect(rec.size).toEqual({ frames: 3, framesDropped: 0, renumbered: 0 });
  });
});

describe('a handed-out session does not alias the recorder', () => {
  it('copies the scores too, so a caller that normalises them changes nothing', () => {
    const now = 0;
    const rec = new SessionRecorder(
      100,
      () => now,
      () => '2026-09-23T10:00:00Z',
    );
    rec.begin({ id: 's5', model: { hash: 'abc', name: 'cubedet', runtime: 'apple' } });
    rec.frame([det()], { frameId: 1 });
    const end = {
      cube: 'worn',
      conditions: {
        camera: 'built-in' as const,
        lighting: 'daylight',
        handling: 'careful' as const,
        state: 'scrambled' as const,
      },
      truth: { facelets: DEEP, source: 'manual-verified' as const },
    };
    const first = rec.finish(end)!;
    first.frames[0]!.detections[0]!.scores![0] = 0.123;
    const second = rec.finish(end)!;
    expect(second.frames[0]!.detections[0]!.scores![0]).toBe(0.9);
  });
});

/**
 * What an independent audit found in this module on 2026-09-23 (Codex, read-only), each pinned so
 * it cannot come back quietly.
 */
describe('the measurements answer correctly at their edges', () => {
  it('takes a quantile by nearest rank, so a p99 is not the maximum', () => {
    // `floor(q*n)` lands on index 99 of 100 — the largest value, which is the one thing a p99
    // exists to exclude. This is a number a gate is written on.
    const outcome = (blockingMs: number[]): SessionOutcome => ({
      sessionId: 's',
      cube: 'worn',
      deadlineMs: 1000,
      completed: true,
      reported: DEEP,
      truth: DEEP,
      sides: [],
      looksAsked: 0,
      blockingMs,
    });
    const spans = Array.from({ length: 100 }, (_, i) => i + 1); // 1…100
    const m = scoreSessions([outcome(spans)]);
    expect(m.blockingMaxMs).toBe(100);
    expect(m.blockingP99Ms).toBe(99);
  });

  it('takes the largest span without spreading it into an argument list', () => {
    // A corpus run collects one span per tick per session; spreading tens of thousands of them
    // into `Math.max(...)` throws a RangeError, so the measurement would die exactly where it is
    // needed. Driven at a size past the limit rather than argued about.
    const many = Array.from({ length: 200_000 }, (_, i) => i % 977);
    const m = scoreSessions([
      {
        sessionId: 's',
        cube: 'worn',
        deadlineMs: 1000,
        completed: true,
        reported: DEEP,
        truth: DEEP,
        sides: [],
        looksAsked: 0,
        blockingMs: many,
      },
    ]);
    expect(m.blockingMaxMs).toBe(976);
  });

  it('bounds the wrong-cube rate over CUBES that were wrong, not sessions', () => {
    // The bound is taken over independent cubes, so a cube that failed twice is one failing cube.
    // Counting wrong SESSIONS against distinct cubes can make the numerator exceed the
    // denominator, which collapses the bound to 1 — "we can say nothing" about a corpus that says
    // plenty.
    const wrongTwice = (id: string): SessionOutcome => ({
      sessionId: id,
      cube: 'logo-white-centre',
      deadlineMs: 1000,
      completed: true,
      reported: SOLVED,
      truth: DEEP,
      sides: [],
      looksAsked: 0,
      blockingMs: [],
    });
    const right = (id: string, cube: string): SessionOutcome => ({
      ...wrongTwice(id),
      cube,
      reported: DEEP,
    });
    const m = scoreSessions([
      wrongTwice('a'),
      wrongTwice('b'),
      right('c', 'worn'),
      right('d', 'stickerless'),
    ]);
    expect(m.cubes).toBe(3);
    expect(m.wrongCubes).toBe(2); // two wrong SESSIONS, reported as such
    // …but one wrong CUBE of three, so the bound is a real bound rather than the useless 1.
    expect(m.wrongCubeRateUpperBound).toBeLessThan(1);
    expect(m.wrongCubeRateUpperBound).toBeCloseTo(wrongCubeRateBound(1, 3), 10);
  });
});

describe('the recorder switch and its frame identity at their edges', () => {
  it('is off, not fatal, on a page where reading storage throws', () => {
    // The read used to sit in a DEFAULT ARGUMENT, evaluated before the body — so the documented
    // "a storage that throws is simply off" was untrue of the commonest way for one to throw, and
    // the exception escaped and took the scan loop with it.
    const throwing = {
      getItem() {
        throw new Error('storage is denied on this page');
      },
    };
    expect(recordEnabled(throwing)).toBe(false);
    expect(traceEnabled(throwing)).toBe(false);
  });

  it('still counts a re-served frame after one had to be renumbered', () => {
    // `lastId` answers "is this the frame I recorded last?", which is a question about the SOURCE's
    // numbering. Forgetting it on a renumber meant every later re-serve was recorded as a new
    // frame — the ordinary case on the native path, sixteen ticks a second.
    let now = 0;
    const rec = new SessionRecorder(
      100,
      () => now,
      () => '2026-09-23T10:00:00Z',
    );
    rec.begin({ id: 's6', model: { hash: 'abc', name: 'cubedet', runtime: 'apple' } });
    rec.frame([det()], { frameId: 900 });
    now = 60;
    rec.frame([det()], { frameId: 5 }); // the source restarted: renumbered to 901
    now = 120;
    rec.frame([det()], { frameId: 5 }); // …and the SAME frame served again
    now = 180;
    rec.frame([det()], { frameId: 5 });
    expect(rec.size.frames).toBe(2);
    expect(rec.size.renumbered).toBe(1);
    const session = rec.finish({
      cube: 'worn',
      conditions: {
        camera: 'built-in',
        lighting: 'daylight',
        handling: 'careful',
        state: 'scrambled',
      },
      truth: { facelets: DEEP, source: 'manual-verified' },
    })!;
    expect(session.frames.map((f) => [f.id, f.served])).toEqual([
      [900, 1],
      [901, 3],
    ]);
  });
});
