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
import { SessionRecorder, worthRecording } from '../view/session-recorder.js';

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
    rec.begin({
      id: 's1',
      cube: 'logo-white-centre',
      conditions: {
        camera: 'built-in',
        lighting: 'daylight',
        handling: 'careful',
        state: 'scrambled',
      },
      model: { hash: 'abc', name: 'cubedet', runtime: 'apple' },
    });
    rec.frame([det()], { frameId: 10 });
    now = 60;
    rec.frame([det()], { frameId: 10 }); // the SAME picture, a second tick
    now = 120;
    rec.frame([det()], { frameId: 10 }); // and a third
    now = 180;
    rec.frame([det({ classId: 1 })], { frameId: 11 });
    rec.decision('captured', { face: 'U' });

    const session = rec.finish({ facelets: DEEP, source: 'smart-cube' })!;
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
    expect(rec.finish({ facelets: SOLVED, source: 'smart-cube' })).toBeNull();
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
    rec.begin({
      id: 's2',
      cube: 'worn',
      conditions: { camera: 'iphone', lighting: 'dim', handling: 'careless', state: 'near-solved' },
      model: { hash: 'abc', name: 'cubedet', runtime: 'web' },
    });
    rec.frame([det()], { frameId: 1 });
    rec.decision('captured', { face: 'U' }); // against frame 1, which is about to fall off
    for (const id of [2, 3, 4]) {
      now += 60;
      rec.frame([det()], { frameId: id });
    }
    const session = rec.finish({ facelets: DEEP, source: 'manual-verified' })!;
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
