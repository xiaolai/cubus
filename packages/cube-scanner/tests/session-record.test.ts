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
  type Corpus,
  cubesOf,
  describeCorpus,
  HANDLING_NEEDED,
  HELDOUT_FRACTION,
  hashCube,
  loadCorpus,
  MIN_CAMERAS,
  sessionsIn,
  splitOf,
} from '../src/corpus.js';
import type { Detection } from '../src/onnx-postprocess.js';
import {
  censoredQuantile,
  countInterventions,
  isWrongCube,
  newlyWrongCubes,
  newlyWrongSessions,
  noRegression,
  passesStageGate,
  reportsOnlyTheCube,
  type SessionOutcome,
  type SideOutcome,
  scoreSessions,
  survivalCurve,
  wrongCubeRateBound,
} from '../src/session-metrics.js';
import {
  DECISION_KINDS,
  isDecisionKind,
  parseSession,
  type RecordedSession,
  SESSION_SCHEMA,
  SessionFormatError,
  sessionDurationMs,
  sessionFps,
  sessionTicks,
} from '../src/session-record.js';
import { FACES, type Face } from '../src/types.js';
import { traceEnabled } from '../view/scan-trace.js';
import {
  DECISION_CAPACITY,
  recordEnabled,
  SessionRecorder,
  worthRecording,
} from '../view/session-recorder.js';

const SOLVED = new Cube().asString();
const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

/**
 * A detection that AGREES WITH ITSELF unless a case deliberately makes it disagree.
 *
 * The scores follow the class and its confidence, because the format now checks that they do: a
 * recording whose `classId` names a class its scores do not favour replays as different evidence
 * from the evidence it was accepted as (`session-replay` rebuilds detections from the scores). The
 * helper used to carry a fixed `[0.9, 0, …]` through every `classId` override, so most of this
 * file's fixtures were exactly the inconsistency the check exists to refuse. Passing `scores`
 * explicitly still overrides, which is how the negative cases are written.
 */
const det = (over: Partial<Detection> = {}): Detection => {
  const base = { cx: 100, cy: 100, w: 20, h: 20, classId: 0, confidence: 0.9, ...over };
  return {
    ...base,
    scores:
      over.scores ?? [0, 1, 2, 3, 4, 5].map((c) => (c === base.classId ? base.confidence : 0)),
  };
};

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
    expect(() => parseSession(short)).toThrow(/all 6 finite class scores/);
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

  it('is frozen all the way down, so a validated corpus cannot be edited afterwards', () => {
    // CODEX AUDIT, 2026-09-26. `loadCorpus` froze each session ONE LEVEL, while the comment beside
    // it said the freeze exists because "a corpus is handed to scripts" and the type is erased at
    // runtime. The truth a session is scored against, and every recorded tick, sat one level down
    // and stayed writable — so a script could edit the instrument after it had been validated and
    // every later number would be measured against the edit.
    const corpus = loadCorpus([entry('a', 'worn')]);
    const session = corpus.sessions[0]!;
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.truth), 'the truth was left writable').toBe(true);
    // Strict mode: writing to a frozen object throws rather than failing quietly.
    expect(() => {
      (session.truth as { facelets: string }).facelets = 'bad';
    }).toThrow();
    expect(Object.isFrozen(session.frames), 'the frame list was left writable').toBe(true);
    const frame = session.frames[0];
    if (frame) expect(Object.isFrozen(frame), 'a recorded frame was left writable').toBe(true);
    expect(Object.isFrozen(session.conditions), 'the conditions were left writable').toBe(true);
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

describe('the split is pinned, not merely self-consistent', () => {
  // WHAT THE OLD CASE PROVED, AND WHAT IT DID NOT. It called `splitOf` twice and compared the
  // answers — which passes for ANY pure function, including one whose constants someone changed.
  // Reversing the comparison at the end of `splitOf`, or swapping the FNV offset for the prime,
  // leaves it green while every cube moves across the boundary and every number ever measured
  // against the corpus silently becomes incomparable with the next one. That is the exact failure
  // this split exists to prevent, so the values are written down.
  const PINNED: [string, number, 'train' | 'heldout'][] = [
    ['logo-white-centre', 1371102498, 'heldout'],
    ['worn', 1620630079, 'train'],
    ['stickerless', 3882546469, 'train'],
    ['today', 1107522238, 'heldout'],
    ['black-body', 2960906003, 'train'],
  ];

  it('hashes and assigns these names to these sides, by literal value', () => {
    for (const [cube, hash, side] of PINNED) {
      expect(hashCube(cube), `${cube}'s hash moved`).toBe(hash);
      expect(splitOf(cube), `${cube} changed sides`).toBe(side);
    }
    // Both sides are represented, or "every cube is on one side" would also satisfy the pins.
    expect(new Set(PINNED.map(([, , s]) => s)).size).toBe(2);
  });

  it('keeps every cube where it was as sessions, cubes and orderings change', () => {
    const cond = (camera: string, lighting: string, handling: string) =>
      ({ camera, lighting, handling, state: 'scrambled' }) as never;
    const of = (id: string, cube: string) => ({
      source: `${id}.json`,
      value: sessionValue({ id, cube, conditions: cond('built-in', 'daylight', 'careful') }),
    });
    const first = loadCorpus([of('a', 'worn'), of('b', 'logo-white-centre')]);
    const membership = (c: Corpus) =>
      Object.fromEntries(cubesOf(c).map((cube) => [cube, splitOf(cube)]));
    const before = membership(first);

    // A second sitting of an existing cube, a brand-new cube, and the whole list reversed.
    const grown = loadCorpus([
      of('e', 'black-body'),
      of('c', 'worn'),
      of('b', 'logo-white-centre'),
      of('a', 'worn'),
    ]);
    const after = membership(grown);
    for (const [cube, side] of Object.entries(before)) {
      expect(after[cube], `${cube} moved when the corpus grew`).toBe(side);
    }
    expect(cubesOf(grown)).toEqual(['black-body', 'logo-white-centre', 'worn']);
    expect(
      sessionsIn(grown, 'heldout')
        .map((x) => x.id)
        .sort(),
    ).toEqual(['b']);
    expect(
      sessionsIn(grown, 'train')
        .map((x) => x.id)
        .sort(),
    ).toEqual(['a', 'c', 'e']);
  });
});

describe('the corpus describes the floor it was written against', () => {
  const entryWith = (
    id: string,
    cube: string,
    camera: string,
    lighting: string,
    handling: string,
  ) => ({
    source: `${id}.json`,
    value: sessionValue({
      id,
      cube,
      conditions: { camera, lighting, handling, state: 'scrambled' } as never,
    }),
  });
  const CUBES = ['logo-white-centre', 'worn', 'stickerless', 'today', 'black-body'];
  const LIGHTS = ['daylight', 'tungsten', 'overcast'];
  const CAMERAS = ['built-in', 'usb-c', 'phone'];
  /** A corpus meeting every floor, which each case below then removes one condition from. */
  const complete = (over: { cameras?: string[]; handling?: string[] } = {}) => {
    const cameras = over.cameras ?? CAMERAS;
    const handling = over.handling ?? [...HANDLING_NEEDED];
    return loadCorpus(
      CUBES.map((cube, i) =>
        entryWith(
          `s${i}`,
          cube,
          cameras[i % cameras.length]!,
          LIGHTS[i % LIGHTS.length]!,
          handling[i % handling.length]!,
        ),
      ),
    );
  };

  it('names a missing camera and missing handling, which it used to promise and not check', () => {
    // Five cubes, three lightings, one camera, careful only — and this reported `shortfalls: []`
    // until 2026-09-25, reading as a corpus that met a floor it had never measured.
    const thin = complete({ cameras: ['built-in'], handling: ['careful'] });
    const cover = describeCorpus(thin);
    expect(cover.cubes).toBe(5);
    expect(cover.lightings).toHaveLength(3);
    expect(cover.shortfalls.join(' ')).toMatch(new RegExp(`1 of ${MIN_CAMERAS} cameras`));
    expect(cover.shortfalls.join(' ')).toMatch(/no careless handling/);
  });

  it('drops each of those shortfalls when the condition is actually there', () => {
    const cover = describeCorpus(complete());
    expect(cover.cameras).toHaveLength(3);
    expect(cover.handling.sort()).toEqual([...HANDLING_NEEDED].sort());
    expect(cover.shortfalls.join(' ')).not.toMatch(/cameras/);
    expect(cover.shortfalls.join(' ')).not.toMatch(/handling/);
    // Still honest about the one floor this fixture cannot meet without a person and a camera.
    expect(cover.shortfalls.join(' ')).toMatch(/no session carries pixels/);
  });

  it('reports an empty TRAIN side, not only an empty held-out one', () => {
    // `fraction = 1` holds every cube out and used to report no shortfall at all: a corpus with
    // nothing to develop against measures as little as one with nothing to test on.
    const all = describeCorpus(complete(), 1);
    expect(all.heldOutCubes).toBe(5);
    expect(all.shortfalls.join(' ')).toMatch(/every cube is held out/);
    const none = describeCorpus(complete(), 0);
    expect(none.heldOutCubes).toBe(0);
    expect(none.shortfalls.join(' ')).toMatch(/no cube is held out/);
  });

  it('checks the fraction on an EMPTY corpus, which used to skip the check entirely', () => {
    // The check lived inside `splitOf`, and every caller reached it through a filter callback — so
    // with no sessions the callback never ran and a NaN fraction passed silently.
    const empty = loadCorpus([]);
    expect(() => sessionsIn(empty, 'train', Number.NaN)).toThrow(RangeError);
    expect(() => describeCorpus(empty, Number.NaN)).toThrow(RangeError);
    expect(() => describeCorpus(empty, 2)).toThrow(RangeError);
    expect(describeCorpus(empty).shortfalls.join(' ')).toMatch(/0 of 5 cubes/);
  });

  it('hands back a corpus nothing can edit under a measurement', () => {
    // It used to carry `sessions` AND a `byCube` index, both mutable and both public: clearing the
    // first left coverage reporting zero sessions and five cubes. The index is gone — grouping is
    // derived — and what remains is frozen down to the `cube` field the index went stale on.
    const corpus = complete();
    expect(Object.isFrozen(corpus)).toBe(true);
    expect(Object.isFrozen(corpus.sessions)).toBe(true);
    expect(() => {
      (corpus.sessions as RecordedSession[]).length = 0;
    }).toThrow(TypeError);
    expect(() => {
      (corpus.sessions[0] as { cube: string }).cube = 'somebody-else';
    }).toThrow(TypeError);
    expect(describeCorpus(corpus).sessions).toBe(5);
  });
});

describe('a malformed entry and a broken parser are different findings', () => {
  it('names the file, keeps the field, and keeps the original as the cause', () => {
    const bad = { source: 'sitting-7.json', value: { schema: 'cubus-scan-session/2' } };
    let thrown: unknown;
    try {
      loadCorpus([bad]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SessionFormatError);
    expect(String(thrown)).toContain('sitting-7.json');
    expect((thrown as Error).cause).toBeInstanceOf(SessionFormatError);
    expect(String((thrown as Error).cause)).not.toContain('sitting-7.json');
  });

  it('does not disguise an unexpected failure as malformed data', () => {
    // A parser defect used to arrive as a `SessionFormatError` naming a file that was perfectly
    // good, with the original type and stack gone — so the corpus took the blame for the code.
    const boom = new TypeError('the parser fell over');
    const exploding = {
      source: 'sitting-8.json',
      value: {
        get schema(): string {
          throw boom;
        },
      },
    };
    let thrown: unknown;
    try {
      loadCorpus([exploding]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(SessionFormatError);
    expect(String(thrown)).toContain('sitting-8.json');
    expect((thrown as Error).cause).toBe(boom);
  });
});

describe('the measurements every later stage is gated on', () => {
  // A FACE EACH, because `sides` is keyed by face: the metrics normalise one observation per face
  // so that a re-shown side is an extra LOOK and not an extra side. Six entries all called 'U' —
  // which this helper used to produce — now describe one side captured and five never obtained,
  // which is what such a list actually says.
  const side = (
    capturedAt: number | null,
    face: Face = 'U',
    kind: SideOutcome['kind'] = 'side',
  ) => ({ face, kind, capturedAt });
  const outcome = (over: Partial<SessionOutcome> = {}): SessionOutcome => ({
    sessionId: 's',
    cube: 'worn',
    deadlineMs: 30000,
    completed: true,
    reported: DEEP,
    truth: DEEP,
    completedAt: 6000,
    sides: FACES.map((face, i) => side(1000 + i * 1000, face)),
    looksAsked: 0,
    identity: [],
    blockingMs: [],
    pixelsAvailable: false,
    ...over,
  });

  it('censors a scan that never finished instead of dropping it or counting the deadline', () => {
    // TIME-TO-SIDE IS NOT TIME-TO-COMPLETION (plan §6, item 2), and the harness had only the first:
    // a scan that filed five sides quickly and never obtained the sixth looked fast by every number
    // the run produced. A non-finisher is right-censored at its deadline, exactly as a side is.
    const done = outcome({ completedAt: 6000 });
    const stuck = outcome({ sessionId: 't', completed: false, reported: null, completedAt: null });
    expect(scoreSessions([done]).timeToCompleteMedianMs).toBe(6000);
    const m = scoreSessions([done, stuck]);
    expect(m.timeToCompleteMedianMs, 'the finisher decides the median where half finished').toBe(
      6000,
    );
    // Half the sessions finished, so the curve reaches 0.5 and no further: the p90 does not exist
    // in this record, and null says so rather than quoting the largest number there is.
    expect(m.timeToCompleteP90Ms).toBeNull();
    // Counting a non-finisher AS its deadline would invent a completion that never happened.
    expect(m.timeToCompleteMedianMs).not.toBe(stuck.deadlineMs);
  });

  it('counts the acts a PERSON performed, never the asks the scan made', () => {
    // plan §6, item 3. `looksAsked` counts asks: an ask nobody answered and an ask answered are the
    // same number, a mistaken answer is invisible, and so is a side shown again to recover from one.
    const ask = (answered: number | 'skip' | null, right: boolean | null = null) => ({
      askedAt: 1000,
      claimed: 3,
      choices: [0, 1, 2],
      answered,
      right,
    });
    const acts = countInterventions([
      outcome({
        looksAsked: 4,
        sides: [
          ...FACES.map((face, i) => side(1000 + i * 1000, face)),
          side(9000, 'U', 'reread'),
          side(9500, 'R', 'confirm'),
        ],
        identity: [ask(0, true), ask(1, false), ask('skip'), ask(null)],
      }),
    ]);
    expect(acts.looksAsked, 'the asks are still reported, they are just not the cost').toBe(4);
    expect(acts.looksGiven).toBe(1);
    expect(acts.rereads).toBe(1);
    expect(acts.identityAsked).toBe(4);
    expect(acts.identityAnswered).toBe(2);
    expect(acts.identityWrong).toBe(1);
    expect(acts.identitySkipped).toBe(1);
    expect(acts.identityIgnored, 'a question nobody looked at was counted as a decision').toBe(1);
    // The acts: one look given, two questions answered, one set aside, one side shown again. The
    // four asks are what the scan did, and nobody had to do anything about one of them.
    expect(acts.acts).toBe(5);
    expect(scoreSessions([outcome()]).interventions.acts).toBe(0);
  });

  it('"the truth could not say" is not a wrong answer', () => {
    // Two sides of one cube can share their eight exactly, so the oracle that decides whether an
    // answer was right can be short of an answer itself. Counting that as a mistake would blame the
    // person for a property of the cube.
    const acts = countInterventions([
      outcome({ identity: [{ askedAt: 0, claimed: 3, choices: [0], answered: 0, right: null }] }),
    ]);
    expect(acts.identityAnswered).toBe(1);
    expect(acts.identityWrong).toBe(0);
  });

  it('a corpus that reports a cube that is not the cube fails the gate, new or not', () => {
    // THE GATE (plan §6): no configuration may report a cube that is not the cube. It is not the
    // same promise as "no NEW wrong cubes" — a corpus that has always misread one cube passes the
    // regression check every time and fails this until that cube is read right.
    const clean = scoreSessions([outcome()]);
    expect(reportsOnlyTheCube(clean).ok).toBe(true);
    const wrong = scoreSessions([outcome({ reported: SOLVED })]);
    const gate = reportsOnlyTheCube(wrong);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/reported a cube that is not the cube: s/);
    // …and a stage cannot be accepted over it, however much else improved.
    const better = scoreSessions([outcome({ reported: SOLVED }), outcome({ sessionId: 't' })]);
    const worse = scoreSessions([outcome({ completed: false, reported: null, completedAt: null })]);
    expect(passesStageGate(worse, better).reasons.join(' ')).toMatch(/not the cube/);
    // The regression check alone does NOT catch it, which is why the two are separate.
    expect(noRegression(wrong, wrong).ok, 'a standing wrong cube is not a regression').toBe(true);
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
      sides: FACES.slice(0, 5).map((face, i) => side(1000 + i * 1000, face)),
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

  it('separates "nothing got worse" from "this is an improvement"', () => {
    // THE TWO ARE NOT THE SAME GATE, and one function used to be both (2026-09-25). It was
    // documented as "completion up, p90 down" and implemented as "completion not down, p90 not up",
    // so identical metrics passed it — as did two empty corpora, and two runs neither of which
    // reached a p90 at all. A change that measured nothing satisfied the acceptance criteria for a
    // stage. The regression check is real and is kept; it is just not acceptance.
    const before = scoreSessions([outcome(), outcome({ sessionId: 't', cube: 'logo' })]);
    const worse = scoreSessions([
      outcome({ completed: false, reported: null }),
      outcome({ sessionId: 't', cube: 'logo' }),
    ]);
    expect(
      noRegression(before, before).ok,
      'a refactor that moves nothing is not a regression',
    ).toBe(true);
    expect(passesStageGate(before, before).ok, 'unchanged metrics were accepted as a stage').toBe(
      false,
    );
    expect(passesStageGate(before, before).reasons.join(' ')).toMatch(/completion did not rise/);
    expect(passesStageGate(scoreSessions([]), scoreSessions([])).reasons.join(' ')).toMatch(
      /no sessions in it/,
    );

    const fell = noRegression(before, worse);
    expect(fell.ok).toBe(false);
    expect(fell.reasons.join(' ')).toMatch(/completion fell/);

    // A NEWLY wrong cube is a failure on its own, however fast the scan got — and it is the
    // IDENTITIES that answer it. Repairing one cube while breaking another leaves the count alone.
    const wrong = scoreSessions([
      outcome({ reported: SOLVED }),
      outcome({ sessionId: 't', cube: 'logo' }),
    ]);
    expect(noRegression(before, wrong).reasons.join(' ')).toMatch(/newly read wrong: worn/);
    const swapped = scoreSessions([
      outcome({ reported: DEEP }),
      outcome({ sessionId: 't', cube: 'logo', reported: SOLVED }),
    ]);
    expect(wrong.distinctWrongCubes, 'the counts are equal, which is the trap').toBe(
      swapped.distinctWrongCubes,
    );
    expect(newlyWrongCubes(wrong, swapped)).toEqual(['logo']);
    expect(noRegression(wrong, swapped).ok, 'a cube was newly broken and the gate passed').toBe(
      false,
    );

    // AND AT THE SESSION UNIT, which the cube set cannot see: two sittings of ONE cube, the change
    // repairing the first and breaking the second, leaves `wrongCubeNames` exactly as it was.
    const firstBroken = scoreSessions([
      outcome({ sessionId: 'one', reported: SOLVED }),
      outcome({ sessionId: 'two' }),
    ]);
    const secondBroken = scoreSessions([
      outcome({ sessionId: 'one' }),
      outcome({ sessionId: 'two', reported: SOLVED }),
    ]);
    expect(
      secondBroken.wrongCubeNames,
      'the cube set moved, so this is not the case being pinned',
    ).toEqual(firstBroken.wrongCubeNames);
    expect(newlyWrongCubes(firstBroken, secondBroken), 'the cube set cannot see it').toEqual([]);
    expect(newlyWrongSessions(firstBroken, secondBroken)).toEqual(['two']);
    expect(
      noRegression(firstBroken, secondBroken).ok,
      'a sitting that used to read right now reads wrong, and the gate passed',
    ).toBe(false);
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
    expect(rec.size).toEqual({
      frames: 3,
      decisions: 0,
      framesDropped: 0,
      renumbered: 0,
      decisionsDropped: 0,
    });
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
      completedAt: 500,
      reported: DEEP,
      truth: DEEP,
      sides: [],
      looksAsked: 0,
      identity: [],
      blockingMs,
      pixelsAvailable: false,
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
        completedAt: 500,
        reported: DEEP,
        truth: DEEP,
        sides: [],
        looksAsked: 0,
        identity: [],
        blockingMs: many,
        pixelsAvailable: false,
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
      completedAt: 500,
      reported: SOLVED,
      truth: DEEP,
      sides: [],
      looksAsked: 0,
      identity: [],
      blockingMs: [],
      pixelsAvailable: false,
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
    expect(m.wrongSessions).toBe(2); // two wrong SESSIONS, reported as such
    expect(m.distinctWrongCubes).toBe(1); // …and one wrong CUBE, named separately
    expect(m.wrongCubeNames).toEqual(['logo-white-centre']);
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

/**
 * The format's and the corpus's edges, from the second audit round (Codex, read-only, 2026-09-23).
 * Every one is a way an instrument could report a measurement it did not take.
 */
describe('the format refuses evidence it would have to invent', () => {
  it('requires all six class scores, not merely some', () => {
    // A SHORT vector is worse than a missing one: the replay writes a six-row tensor, so four
    // scores are silently zero-filled and eight truncated — the session would replay as evidence
    // nobody recorded.
    for (const scores of [
      [0.9, 0, 0, 0],
      [0.9, 0, 0, 0, 0, 0, 0],
    ]) {
      const short = sessionValue({
        frames: [{ id: 0, t: 0, served: 1, detections: [{ ...det(), scores }] }] as never,
      });
      expect(() => parseSession(short)).toThrow(/all 6 finite class scores/);
    }
  });

  it('refuses a decision whose detail is present and is not an object', () => {
    // Replacing it with `{}` hides a corrupt recording behind a decision that reads as ordinary.
    const bad = sessionValue({
      decisions: [{ frame: 1, t: 60, kind: 'captured', detail: 'U' }] as never,
    });
    expect(() => parseSession(bad)).toThrow(/detail must be an object/);
    // An ABSENT detail is a decision that carried none, and is fine.
    const none = sessionValue({ decisions: [{ frame: 1, t: 60, kind: 'captured' }] as never });
    expect(parseSession(none).decisions[0]!.detail).toEqual({});
  });

  it('requires a timestamp that can actually be read as one', () => {
    // It labels a sitting and is never used for arithmetic — but a corpus that admits "yesterday"
    // cannot be sorted, filtered by date, or matched against the notes taken beside it.
    expect(() => parseSession(sessionValue({ startedAt: 'yesterday' }))).toThrow(/ISO 8601/);
    expect(() => parseSession(sessionValue({ startedAt: '2026-09-23T10:00:00Z' }))).not.toThrow();
  });
});

describe('the corpus refuses a split that is not one', () => {
  it('rejects a held-out fraction that is not between 0 and 1', () => {
    // NaN compares false against everything and would put every cube in `train`; a negative one
    // does the same; above 1 holds everything out. All three look like a split and measure nothing.
    for (const bad of [Number.NaN, -0.1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => splitOf('worn', bad), `${bad}`).toThrow(RangeError);
    }
    expect(() => splitOf('worn', 0)).not.toThrow();
    expect(() => splitOf('worn', 1)).not.toThrow();
  });

  it('counts a session as pixel-replayable only when EVERY frame has pixels', () => {
    // A session with pixels on a handful of frames cannot be re-read by another detector, and
    // counting it would report a corpus as ready for the experiment pixels are kept for.
    const withPixels = (n: number) =>
      sessionValue({
        id: `p${n}`,
        cube: `cube-${n}`,
        frames: [
          { id: 0, t: 0, served: 1, detections: [det()], pixels: 'f0.png' },
          {
            id: 1,
            t: 60,
            served: 1,
            detections: [det()],
            ...(n === 2 ? { pixels: 'f1.png' } : {}),
          },
        ] as never,
      });
    const corpus = loadCorpus([
      { source: 'a.json', value: withPixels(1) },
      { source: 'b.json', value: withPixels(2) },
    ]);
    expect(describeCorpus(corpus).withPixels).toBe(1);
  });
});

describe('every invariant the format states, refused by name', () => {
  // TABLE-DRIVEN BECAUSE THE GAPS WERE THE POINT (2026-09-25). The suite tested a hand-picked few
  // of these and left the rest to be read in the source: nonfinite numbers, out-of-range class ids,
  // impossible tick counts, unknown schemes and unknown decision kinds all had a refusal in the
  // parser and nothing that asked for it. A refusal nothing asks for is a refusal that can be
  // deleted by accident — and this parser IS the instrument, so a rule it stops enforcing changes
  // every measurement taken afterwards without changing a single number in a test.
  const frames = (...over: Record<string, unknown>[]) =>
    over.map((o, i) => ({ id: i, t: i * 60, served: 1, detections: [det()], ...o }));

  const REFUSALS: [string, unknown, RegExp][] = [
    // Numbers that are not numbers.
    [
      'a NaN box coordinate',
      sessionValue({ frames: frames({ detections: [det({ cx: Number.NaN })] }) } as never),
      /cx must be a finite number/,
    ],
    [
      'an infinite frame time',
      sessionValue({ frames: frames({ t: Number.POSITIVE_INFINITY }) } as never),
      /t must be a finite number/,
    ],
    [
      'a NaN score',
      sessionValue({
        frames: frames({ detections: [det({ scores: [Number.NaN, 0, 0, 0, 0, 0] })] }),
      } as never),
      // Through the SHARED predicate now — the recorder filters on the same one, so the two ends
      // of the format cannot come to disagree about what a recordable detection is.
      /all 6 finite class scores/,
    ],

    // Class ids, against the vector they are supposed to name.
    [
      'a class id past the vector',
      sessionValue({
        frames: frames({ detections: [det({ classId: 9, scores: [0, 0, 0, 0, 0, 0] })] }),
      } as never),
      /is not a class of 6/,
    ],
    [
      'a negative class id',
      sessionValue({ frames: frames({ detections: [det({ classId: -1 })] }) } as never),
      /classId must be a whole number/,
    ],
    [
      'a fractional class id',
      sessionValue({ frames: frames({ detections: [det({ classId: 1.5 })] }) } as never),
      /classId must be a whole number/,
    ],
    [
      'a class its own scores do not favour',
      sessionValue({
        frames: frames({
          detections: [det({ classId: 2, confidence: 0.1, scores: [0.9, 0, 0.1, 0, 0, 0] })],
        }),
      } as never),
      /is not the class its scores favour \(0\)/,
    ],
    [
      'a confidence that is not its class’s score',
      sessionValue({
        frames: frames({
          detections: [det({ classId: 0, confidence: 0.5, scores: [0.9, 0, 0, 0, 0, 0] })],
        }),
      } as never),
      /is not its class's score/,
    ],

    // Boxes with no area — the shape every geometric check downstream compares against.
    [
      'a zero-width box',
      sessionValue({ frames: frames({ detections: [det({ w: 0 })] }) } as never),
      /w 0 is not a positive length/,
    ],
    [
      'a negative-height box',
      sessionValue({ frames: frames({ detections: [det({ h: -20 })] }) } as never),
      /h -20 is not a positive length/,
    ],

    // Counts.
    [
      'a frame served zero times',
      sessionValue({ frames: frames({ served: 0 }) } as never),
      /served must be a whole number of at least 1/,
    ],
    [
      'a fractional tick count',
      sessionValue({ frames: frames({ served: 1.5 }) } as never),
      /served must be a whole number of at least 1/,
    ],
    [
      'a tick count outside the safe range',
      sessionValue({ frames: frames({ served: 1e308 }) } as never),
      /served must be a whole number of at least 1/,
    ],
    [
      'a total tick count outside the safe range',
      sessionValue({ frames: frames({ served: 2 ** 52 }, { served: 2 ** 52 }) } as never),
      /past 9007199254740991 ticks/,
    ],
    [
      'a frame id outside the safe range',
      sessionValue({ frames: frames({ id: 0 }, { id: 1e308 }) } as never),
      /id must be a whole number/,
    ],

    // Times that could not have happened.
    [
      'a negative frame time',
      sessionValue({ frames: frames({ t: -1 }) } as never),
      /t -1 is below 0/,
    ],
    [
      'a negative inference duration',
      sessionValue({ frames: frames({ inferMs: -5 }) } as never),
      /inferMs -5 is below 0/,
    ],
    [
      'a decision before the frame that caused it',
      sessionValue({
        frames: frames({}, {}),
        decisions: [{ frame: 1, t: 5, kind: 'captured', detail: {} }],
      } as never),
      /is before frame 1 at 60/,
    ],
    [
      'decisions that run backwards',
      sessionValue({
        frames: frames({}, {}),
        decisions: [
          { frame: 1, t: 100, kind: 'captured', detail: {} },
          { frame: 1, t: 90, kind: 'finished', detail: {} },
        ],
      } as never),
      /goes back before 100/,
    ],

    // Names the format knows.
    [
      'a colour scheme it does not know',
      sessionValue({
        truth: { facelets: DEEP, source: 'manual-verified', scheme: 'martian' },
      } as never),
      /scheme must be 'western' or 'japanese'/,
    ],
    [
      'a decision kind it does not know',
      sessionValue({ decisions: [{ frame: 1, t: 60, kind: 'shrugged', detail: {} }] } as never),
      /is not a decision kind/,
    ],

    // Timestamps — a label a corpus is sorted and matched by.
    ['a year on its own', sessionValue({ startedAt: '1' }), /ISO 8601 instant with a timezone/],
    [
      'a date that does not exist',
      sessionValue({ startedAt: '2026-02-30T10:00:00Z' }),
      /ISO 8601 instant with a timezone/,
    ],
    [
      'a month that does not exist',
      sessionValue({ startedAt: '2026-13-01T10:00:00Z' }),
      /ISO 8601 instant with a timezone/,
    ],
    [
      'an hour that does not exist',
      sessionValue({ startedAt: '2026-09-23T25:00:00Z' }),
      /ISO 8601 instant with a timezone/,
    ],
    [
      'no timezone at all',
      sessionValue({ startedAt: '2026-09-23T10:00:00' }),
      /ISO 8601 instant with a timezone/,
    ],
    [
      'an impossible offset',
      sessionValue({ startedAt: '2026-09-23T10:00:00+99:00' }),
      /ISO 8601 instant with a timezone/,
    ],
  ];

  for (const [what, value, why] of REFUSALS) {
    it(`refuses ${what}`, () => {
      expect(() => parseSession(value)).toThrow(SessionFormatError);
      expect(() => parseSession(value)).toThrow(why);
    });
  }

  it('still accepts the instants that are real, offsets and leap seconds included', () => {
    for (const good of [
      '2026-09-23T10:00:00Z',
      '2026-09-23T10:00:00.123Z',
      '2028-02-29T10:00:00Z', // a real leap day
      '2026-09-23T10:00:00+05:30',
    ]) {
      expect(() => parseSession(sessionValue({ startedAt: good })), good).not.toThrow();
    }
    // Beside them, the 29th of a February that has none — so the case cannot pass by accepting
    // everything, which is precisely how the old `Date.parse` check passed.
    expect(() => parseSession(sessionValue({ startedAt: '2026-02-29T10:00:00Z' }))).toThrow(
      SessionFormatError,
    );
  });

  it('owns its evidence: editing the input afterwards changes nothing parsed', () => {
    // A probe injected a `NaN` this way, into numbers the parser had already certified finite.
    const scores = [0.9, 0, 0, 0, 0, 0];
    const detail = { colors: [0, 1, 2] };
    const value = sessionValue({
      frames: [{ id: 0, t: 0, served: 1, detections: [{ ...det(), scores }] }],
      decisions: [{ frame: 0, t: 0, kind: 'captured', detail }],
    } as never);
    const parsed = parseSession(value);
    scores[0] = Number.NaN;
    detail.colors[0] = 99;
    expect(parsed.frames[0]!.detections[0]!.scores![0]).toBe(0.9);
    expect(
      (parsed.decisions[0]!.detail.colors as number[])[0],
      'the detail was one level deep',
    ).toBe(0);
  });

  it('keeps the historical kinds readable, because a stored format cannot drop a member', () => {
    // `held-back` and `contest-resolved` belonged to the centre resolution, removed 2026-09-23.
    // A recording made before that date still has to load, or an existing corpus entry is lost.
    for (const kind of DECISION_KINDS) {
      const value = sessionValue({ decisions: [{ frame: 1, t: 60, kind, detail: {} }] } as never);
      expect(() => parseSession(value), kind).not.toThrow();
    }
    expect(DECISION_KINDS).toContain('held-back');
    expect(DECISION_KINDS).toContain('contest-resolved');
    expect(isDecisionKind('shrugged')).toBe(false);
  });
});

describe('the recorder is bounded, owns its evidence, and cannot emit what no reader loads', () => {
  const END = {
    cube: 'logo-white-centre',
    conditions: {
      camera: 'built-in',
      lighting: 'daylight',
      handling: 'careful' as const,
      state: 'scrambled' as const,
    },
    truth: { facelets: DEEP, source: 'smart-cube' as const },
  };
  /** A recorder on a driven clock, so every timing claim below is exact rather than approximate. */
  function recorder(capacity = 100) {
    let now = 0;
    const rec = new SessionRecorder(
      capacity,
      () => now,
      () => '2026-09-23T10:00:00Z',
    );
    rec.begin({ id: 's1', model: { hash: 'abc', name: 'cubedet', runtime: 'apple' } });
    return {
      rec,
      at: (t: number) => {
        now = t;
      },
    };
  }

  it('refuses a capacity that is not one, at the door', () => {
    // Zero and negative discard every frame as it arrives; NaN and Infinity disable eviction and
    // the bound is simply gone; a fraction rounds to a capacity nobody asked for. All four look
    // like a working recorder from outside.
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(() => new SessionRecorder(bad), `${bad}`).toThrow(RangeError);
    }
    expect(() => new SessionRecorder(1)).not.toThrow();
  });

  it('drops a decision with the frame it rested on, rather than holding it for ever', () => {
    // MEASURED: with a capacity of 2 the recorder held 99 decisions for 2 frames. `finish()`
    // filtered them out of the EXPORT, which is exactly why the growth was invisible.
    const { rec, at } = recorder(2);
    for (let i = 0; i < 50; i++) {
      at(i * 60);
      rec.frame([det()], { frameId: i });
      rec.decision('turned-away', { why: i });
    }
    expect(rec.size.frames).toBe(2);
    expect(rec.size.decisions, 'decisions outlived every frame they rested on').toBe(2);
    expect(rec.size.decisionsDropped).toBe(48);
    const session = rec.finish(END)!;
    expect(session.decisions).toHaveLength(2);
    expect(session.recording?.decisionsDropped).toBe(48);
  });

  it('bounds decisions taken against ONE frame, which frame eviction cannot', () => {
    // A scan abstaining on a re-served frame writes a decision a tick and adds no frame at all, so
    // the frame bound never fires. Two mechanisms, because there are two ways to grow.
    const { rec, at } = recorder(100);
    at(0);
    rec.frame([det()], { frameId: 1 });
    for (let i = 0; i < DECISION_CAPACITY + 25; i++) rec.decision('turned-away', { i });
    expect(rec.size.frames).toBe(1);
    expect(rec.size.decisions).toBe(DECISION_CAPACITY);
    expect(rec.size.decisionsDropped).toBe(25);
  });

  it('carries what it lost into the exported session, and back through the reader', () => {
    // `size` told a developer watching; the export dropped it. A recording whose beginning fell off
    // the capacity looks exactly like a clean one, and its time-to-side is measured from nowhere.
    const { rec, at } = recorder(2);
    at(0);
    rec.frame([det()], { frameId: 5 });
    at(60);
    rec.frame([det()], { frameId: 3 }); // goes backwards: renumbered
    at(120);
    rec.frame([det()], { frameId: 9 });
    at(180);
    rec.frame([det()], { frameId: 11 }); // pushes the first out
    const session = rec.finish(END)!;
    expect(session.recording).toEqual({ framesDropped: 2, renumbered: 1, decisionsDropped: 0 });
    const back = parseSession(JSON.parse(JSON.stringify(session)));
    expect(back.recording, 'the losses did not survive serialisation').toEqual(session.recording);
    // A recording that lost nothing says nothing, rather than carrying three zeroes.
    const clean = recorder(100);
    clean.at(0);
    clean.rec.frame([det()], { frameId: 1 });
    expect(clean.rec.finish(END)!.recording).toBeUndefined();
  });

  it('keeps the time a re-served final frame was still being served', () => {
    // MEASURED: a frame first seen at 0 and still served at 10,000 ms exported with duration 0 —
    // and `sessionFps` null — with a decision recorded at 10,000 ms sitting inside it.
    const { rec, at } = recorder();
    at(0);
    rec.frame([det()], { frameId: 1 });
    at(10_000);
    rec.frame([det()], { frameId: 1 });
    rec.decision('captured', { face: 'U' });
    const session = rec.finish(END)!;
    expect(session.frames).toHaveLength(1);
    expect(session.frames[0]!.served).toBe(2);
    expect(session.frames[0]!.lastT).toBe(10_000);
    expect(sessionDurationMs(session), 'the session reported no duration at all').toBe(10_000);
    expect(parseSession(JSON.parse(JSON.stringify(session))).frames[0]!.lastT).toBe(10_000);
  });

  it('records no detection whose score vector the reader would refuse', () => {
    // "Has scores" was the whole test, so an empty, short, oversized or NaN-carrying vector was
    // recorded and the reader then refused the file — a recorder able to write what nothing loads.
    const bad = [[], [0.9, 0, 0, 0], [0.9, 0, 0, 0, 0, 0, 0], [Number.NaN, 0, 0, 0, 0, 0]];
    for (const scores of bad) {
      expect(worthRecording([det({ scores })]), JSON.stringify(scores)).toEqual([]);
    }
    expect(worthRecording([det()])).toHaveLength(1);
  });

  it('does not alias its caller, in either direction', () => {
    const { rec, at } = recorder();
    const scores = [0.9, 0, 0, 0, 0, 0];
    const detail = { colors: [0, 1, 2] };
    const model = { hash: 'abc', name: 'cubedet', runtime: 'apple' };
    const start = { id: 's1', model };
    const rec2 = new SessionRecorder(
      100,
      () => 0,
      () => '2026-09-23T10:00:00Z',
    );
    rec2.begin(start);
    // Provenance that can be edited after the fact is not provenance.
    start.id = 'someone-else';
    model.hash = 'a-different-model';
    rec2.frame([det()], { frameId: 1 });
    const other = rec2.finish(END)!;
    expect(other.id).toBe('s1');
    expect(other.model.hash).toBe('abc');

    at(0);
    rec.frame([det({ scores })], { frameId: 1 });
    rec.decision('captured', detail);
    const session = rec.finish(END)!;
    scores[0] = 0.1;
    detail.colors[0] = 99;
    expect(session.frames[0]!.detections[0]!.scores[0]).toBe(0.9);
    expect((session.decisions[0]!.detail.colors as number[])[0]).toBe(0);
    // And the other way: editing what was handed out must not change a later export.
    (session.decisions[0]!.detail.colors as number[])[1] = 77;
    expect((rec.finish(END)!.decisions[0]!.detail.colors as number[])[1]).toBe(1);
  });

  it('refuses to hand over a session the reader would not accept', () => {
    // The documented truth/provenance check was documented and not performed: this surface is
    // reached from the developer console, where TypeScript protects nobody.
    const { rec, at } = recorder();
    at(0);
    rec.frame([det()], { frameId: 1 });
    expect(() =>
      rec.finish({ ...END, truth: { facelets: 'not a cube', source: 'smart-cube' } }),
    ).toThrow(SessionFormatError);
    expect(() =>
      rec.finish({ ...END, truth: { facelets: DEEP, source: 'detector' as never } }),
    ).toThrow(/measures the detector against itself/);
    expect(() => rec.finish({ ...END, cube: '' })).toThrow(SessionFormatError);
    expect(rec.finish(END)).not.toBeNull();
  });
});

describe('the arithmetic every gate is written on, at the places it was wrong', () => {
  const side = (capturedAt: number | null, face: Face, kind: SideOutcome['kind'] = 'side') => ({
    face,
    kind,
    capturedAt,
  });
  const outcome = (over: Partial<SessionOutcome> = {}): SessionOutcome => ({
    sessionId: 's',
    cube: 'worn',
    deadlineMs: 30000,
    completed: true,
    reported: DEEP,
    truth: DEEP,
    completedAt: 6000,
    sides: FACES.map((face, i) => side(1000 + i * 1000, face)),
    looksAsked: 0,
    identity: [],
    blockingMs: [],
    pixelsAvailable: false,
    ...over,
  });

  it('reaches the quantile it computes, instead of stepping past it', () => {
    // MEASURED: ten sides captured at 1…10 ms left survival holding 0.10000000000000002 after the
    // ninth while `1 - 0.9` evaluates to 0.09999999999999998, so the p90 skipped its own answer
    // and reported 10. Nine captures and one later censor reported `null` — "this corpus cannot
    // reach a p90" — for a corpus that reaches it comfortably. A gate is written on these numbers.
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => ({ time: t, captured: true }));
    expect(censoredQuantile(ten, 0.9)).toBe(9);
    expect(censoredQuantile(ten, 0.5)).toBe(5);
    const nineAndACensor = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => ({ time: t, captured: true })),
      { time: 50, captured: false },
    ];
    expect(censoredQuantile(nineAndACensor, 0.9)).toBe(9);
    // And it still answers null where the data genuinely cannot reach it — the tolerance must not
    // have turned "out of reach" into a number.
    expect(
      censoredQuantile(
        [
          { time: 1, captured: true },
          { time: 9, captured: false },
        ],
        0.9,
      ),
    ).toBeNull();
  });

  it('refuses a timestamp that would hang it for ever', () => {
    // NOT A HYPOTHETICAL: the inner loop advances while the next time EQUALS the current one, and
    // nothing equals NaN — so `i` never moved, the outer loop never ended, and a corpus run with
    // one bad timestamp simply never returned. Reproduced in a subprocess that had to be killed.
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => survivalCurve([{ time, captured: true }]), `${time}`).toThrow(RangeError);
      expect(() => censoredQuantile([{ time, captured: true }], 0.5), `${time}`).toThrow(
        RangeError,
      );
    }
  });

  it('counts one observation per FACE, so a second look is not a second side', () => {
    // MEASURED: five faces plus one reread scored as six captured sides, zero censored, and a
    // reachable p90 — for a scan that never obtained its sixth side at all.
    const reread = outcome({
      completed: false,
      reported: null,
      sides: [
        ...FACES.slice(0, 5).map((face, i) => side(1000 + i * 1000, face)),
        side(6000, 'U'), // the same side, looked at again
      ],
    });
    const m = scoreSessions([reread]);
    expect(m.sidesCaptured, 'a second look was counted as a side').toBe(5);
    expect(m.sidesCensored, 'the side never obtained was not censored').toBe(1);
    expect(m.timeToSideP90Ms, 'a p90 was reported for a corpus that cannot reach one').toBeNull();
  });

  it('times a re-looked side by the reading it KEPT, not the one that was replaced', () => {
    const revised = outcome({
      sides: [
        ...FACES.map((face, i) => side(1000 + i * 1000, face)),
        side(20_000, 'U'), // U was wrong at 1000 and settled at 20000
      ],
    });
    const m = scoreSessions([revised]);
    expect(m.sidesCaptured).toBe(6);
    expect(m.sidesCensored).toBe(0);
    expect(m.timeToSideP90Ms).toBe(20_000);
  });

  it('bounds the wrong-cube rate against an independently written binomial tail', () => {
    // NOT AGAINST ITSELF. Every existing case asserted that one call exceeded another call of the
    // same function, which an incorrect bound satisfies as happily as a correct one. This checks
    // the defining property with exact integer coefficients — a different formula from the
    // implementation's logarithms — plus the two closed forms the bound has.
    const C = (n: number, k: number): number => {
      let c = 1;
      for (let j = 1; j <= k; j++) c = (c * (n - k + j)) / j;
      return c;
    };
    const tail = (p: number, wrong: number, n: number): number => {
      let sum = 0;
      for (let k = 0; k <= wrong; k++) sum += C(n, k) * p ** k * (1 - p) ** (n - k);
      return sum;
    };
    for (const [wrong, n, alpha] of [
      [1, 10, 0.05],
      [2, 10, 0.05],
      [3, 40, 0.05],
      [1, 60, 0.01],
      [7, 25, 0.1],
    ] as const) {
      const bound = wrongCubeRateBound(wrong, n, alpha);
      expect(tail(bound, wrong, n), `${wrong}/${n} at ${alpha}`).toBeCloseTo(alpha, 10);
      expect(bound).toBeGreaterThan(wrong / n);
      expect(bound).toBeLessThan(1);
    }
    // The closed forms, which need no bisection at all.
    expect(wrongCubeRateBound(1, 2)).toBeCloseTo(Math.sqrt(0.95), 12);
    expect(wrongCubeRateBound(0, 60)).toBeCloseTo(1 - 0.05 ** (1 / 60), 12);
    expect(wrongCubeRateBound(3, 3), 'every trial failed, so nothing is ruled out').toBe(1);
    expect(wrongCubeRateBound(0, 0), 'no trials bound nothing').toBe(1);
  });

  it('refuses statistical inputs that are not statistics', () => {
    // `wrongCubeRateBound(-1, 60)` returned about −0.0167: a negative probability, reported as a
    // rate a gate could be written on.
    expect(() => wrongCubeRateBound(-1, 60)).toThrow(RangeError);
    expect(() => wrongCubeRateBound(1.5, 60)).toThrow(RangeError);
    expect(() => wrongCubeRateBound(61, 60)).toThrow(RangeError);
    expect(() => wrongCubeRateBound(1, -60)).toThrow(RangeError);
    for (const alpha of [0, 1, -0.1, 1.5, Number.NaN]) {
      expect(() => wrongCubeRateBound(1, 60, alpha), `${alpha}`).toThrow(RangeError);
    }
  });
});
