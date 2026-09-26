/**
 * A recorded scan session: what the camera delivered, what the model said about it, what the panel
 * decided, and — entered by a person from an independent source — what the cube ACTUALLY was.
 *
 * WHY THIS EXISTS (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 0). Six fixes for one
 * logo-centre cube were each judged on unit tests and on a single 91.5%-success clip, because
 * nothing measured real scans end to end (P1). A heuristic added at the layer a report exposed is
 * not a measurement, and five of them in a row is how the history went. This is the foundation the
 * audit puts under every later change: a failure becomes a recorded session, and a change is judged
 * on the held-out part of the corpus.
 *
 * THE TRUTH IS NEVER THE DETECTOR'S (§4.1). `source` cannot say `detector` — the type forbids it —
 * because a corpus whose labels come from the thing being measured measures nothing. It is a smart
 * cube's own report or a person's verified manual entry, entered once per session.
 *
 * WHAT A TRACE COULD NOT DO, AND THIS CAN (P2/D9). The scan trace rounds its boxes, caps them at
 * sixteen, carries scores only for the centre probe, and holds no pixels, so a bug report could not
 * become a replayable case and no camera or model experiment could be replayed at all. Here the
 * detections are UNROUNDED with every class score, uncapped above a low floor, and the pixels are
 * addressable. The cost is size, which is why `NEAR_FLOOR_RECORD` exists and why pixels are a
 * side-car reference rather than inline bytes.
 */

import { isStructurallyValid } from './facelet-cube.js';
import { NUM_COLORS } from './nine-of-each.js';
import type { Detection } from './onnx-postprocess.js';

/**
 * The format's version, stamped on every session and checked on load.
 *
 * A corpus outlives the code that reads it — that is its whole point — so a reader that met a
 * session it does not understand must say so rather than interpret it loosely. Bump this whenever a
 * field's MEANING changes, never for an added optional field.
 */
export const SESSION_SCHEMA = 'cubus-scan-session/1' as const;

/**
 * The lowest score a candidate is recorded at.
 *
 * Deliberately far below `MIN_STICKER_CONFIDENCE` (0.25), because the audit's central finding is
 * that the pipeline discards the evidence it later needs: today's stuck session had a centre
 * scoring 0.20–0.25 on 177 frames, and a recording made at the scan's own threshold would not
 * contain the very frames the failure is made of. Below 0.05 is noise the model emits everywhere,
 * and keeping it would multiply a session's size for nothing.
 */
export const NEAR_FLOOR_RECORD = 0.05;

/** Where a session's ground truth came from. The detector is not an option — see the file header. */
export type TruthSource =
  /** A connected smart cube reported its own state. */
  | 'smart-cube'
  /** A person read the cube and entered it, then verified the entry against the cube again. */
  | 'manual-verified';

/** What the cube in the recording actually was. */
export interface SessionTruth {
  /** Kociemba facelet string, URFDLB order, 54 chars. */
  facelets: string;
  source: TruthSource;
  /**
   * Which colour scheme the physical cube is built to, when the recorder knew it.
   *
   * Absent rather than guessed: ADR 0001 makes the scheme a third ambiguity dimension of the
   * scan's search and never a verdict the scan always reaches, so a corpus that filled this in by
   * assumption would score a correct scan wrong on the cubes where both schemes read alike.
   */
  scheme?: 'western' | 'japanese';
}

/** Which model produced a session's detections, so a re-run can tell like from like. */
export interface ModelIdentity {
  /**
   * WHICH model this is: the file's sha256 in lower-case hex, or another identifier the runtime can
   * guarantee is stable for one model and DIFFERENT for another.
   *
   * ABSENT WHERE THE RUNTIME CANNOT SAY, and that is the whole correction (2026-09-25). This was
   * required, so the panel filled it with `'unknown'` on every native recording — and `'unknown'`
   * is not an identity, it is two different models recording as the same one. The corpus asks this
   * field exactly one question, "were these two sessions read by the same thing?", and a fabricated
   * answer to it is worse than no answer: no answer is visible, and a wrong one is not.
   */
  hash?: string;
  /**
   * WHERE the model was loaded from — a URL, usually — when the runtime knows.
   *
   * Separate from `hash` because it answers a weaker question. Replacing a model's contents at the
   * same URL leaves this identical, so a location is provenance and not identity; recording it as
   * identity was how the two came to be confused.
   */
  source?: string;
  name: string;
  /** `'web'` (onnxruntime), `'apple'`, `'windows'`, `'android'` — which runtime produced the output. */
  runtime: string;
}

/**
 * One recorded frame: its identity, when it arrived, and everything the model said about it.
 *
 * `id` IS THE IDENTITY, AND IT IS THE POINT (D2). The native camera serves the same physical frame
 * on every tick for up to a second, and nothing downstream could tell a re-served frame from a new
 * one — so one frame supplied several "reads" of the stillness gate, and any accumulation built on
 * top would have counted it several times over. A recording that could not distinguish them would
 * bake that defect into the corpus, so the id comes from the SOURCE and is monotonic per session,
 * and `served` says how many ticks consumed it.
 */
/**
 * A detection AS RECORDED: `Detection` with its scores made required.
 *
 * `Detection.scores` is optional because a detection can be built by hand; a RECORDED one cannot
 * be, and the parser has always refused a short or missing vector. Saying it in the type is what
 * stops the two boundaries drifting: ingestion asserted the scores were there while export
 * substituted `[]` for a missing one, so one half of the recorder believed something the other
 * half quietly worked around.
 */
export type RecordedDetection = Detection & { scores: number[] };

/**
 * Whether a detection carries the full, finite score vector the format requires.
 *
 * SHARED WITH THE RECORDER ON PURPOSE (2026-09-25). `worthRecording` checked only that `scores` was
 * not `undefined`, so an empty, short, oversized or NaN-carrying vector passed it and produced a
 * recording `parseSession` then refused — a recorder able to write a file no reader loads. One
 * predicate, used at both ends, is the only way those two cannot come to disagree.
 */
export const hasFullScores = (d: Detection): d is RecordedDetection =>
  Array.isArray(d.scores) && d.scores.length === NUM_COLORS && d.scores.every(Number.isFinite);

export interface RecordedFrame {
  /** Monotonic within the session, assigned by the frame source, never by the tick loop. */
  id: number;
  /** Milliseconds since the session began, on a monotonic clock. */
  t: number;
  /**
   * How many scan ticks were served this one frame. 1 on a source that never repeats itself;
   * more on the native path, where `Camera.latestFrame()` re-serves until a new frame arrives.
   */
  served: number;
  /**
   * When this frame was last served, in the same milliseconds as `t`. Absent for a frame served
   * once, where it would equal `t`.
   *
   * WITHOUT IT A SESSION CAN HAVE NO DURATION (2026-09-25). `t` is when a frame was FIRST seen, and
   * a source that re-serves its last frame — which the native camera does for up to a second, and
   * the browser's `<video>` does whenever the loop outruns the stream — writes no new frame while
   * it does so. A frame first seen at 0 and still being served at 10,000 ms exported as a session
   * whose first and last frame were the same one, so `sessionDurationMs` was 0, `sessionFps` was
   * null, and a replay took its deadline from a session that appeared to last no time at all —
   * with a decision recorded at 10,000 ms sitting inside it.
   */
  lastT?: number;
  /** Every candidate at or above `NEAR_FLOOR_RECORD`, unrounded, each with all class scores. */
  detections: RecordedDetection[];
  /** How long the model took on this frame, in milliseconds. */
  inferMs?: number;
  /**
   * Where the frame's pixels are, relative to the session file's folder — a PNG per frame, or a
   * video plus a frame index. Absent for a session recorded without pixels, which can still answer
   * every question about the decision layers and none about the camera or the model.
   */
  pixels?: string;
}

/**
 * Every decision kind the format admits — the ONE list, which the type and the parser both read.
 *
 * It used to be written twice: a union on `RecordedDecision.kind` and a string array inside
 * `parseSession`, with a cast between them. Two lists of the same thing drift, and the cast is what
 * made the drift invisible — a kind added to the union and not to the array parsed as invalid,
 * a kind added to the array and not to the union parsed into a value the type says cannot exist.
 *
 * `'loop-restarted'` is the scan loop starting again WITHIN one sitting — a refusal, a correction,
 * a reconnect, a camera reopened. It exists because the recording used to be thrown away at each of
 * those: `loop()` called `begin()`, which clears every frame and decision, so re-showing one side
 * turned a recording of fifty frames into a recording of none while four captures stood. The
 * evidence LEADING UP to a refusal is the evidence a refusal has to be explained from, so the
 * restart is now an event inside the recording rather than the end of it.
 *
 * `'held-back'` and `'contest-resolved'` are HISTORICAL and nothing emits them any more: they
 * belonged to the centre resolution, removed 2026-09-23. They stay because this is a stored
 * format — a recording made before that date carries them, and a parser that refused one would
 * make an existing corpus entry unreadable, which is a worse fault than an unused member. Nothing
 * downstream may treat either as a side.
 */
export const DECISION_KINDS = [
  'captured',
  'held-back',
  'turned-away',
  'contest-resolved',
  'look-asked',
  'loop-restarted',
  'finished',
] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];

/** The guard the parser narrows through, so no cast stands between the check and the type. */
export const isDecisionKind = (v: unknown): v is DecisionKind =>
  typeof v === 'string' && (DECISION_KINDS as readonly string[]).includes(v);

/**
 * Something the panel decided, stamped with the frame it decided on.
 *
 * `frame` rather than a timestamp: a decision belongs to the evidence that caused it, and on a path
 * that re-serves frames a timestamp does not say which read was the cause.
 */
export interface RecordedDecision {
  frame: number;
  t: number;
  kind: DecisionKind;
  detail: Record<string, unknown>;
}

/** One recorded scan, start to finish. */
export interface RecordedSession {
  schema: typeof SESSION_SCHEMA;
  /** Stable across re-recordings of the same sitting; the corpus's held-out unit together with `cube`. */
  id: string;
  /** ISO 8601, for a person reading a listing. Never used for arithmetic — `frames[].t` is. */
  startedAt: string;
  /**
   * Which physical cube this is, e.g. `'logo-white-centre'`. THE HELD-OUT UNIT (§4.3): whole cubes
   * are held out, not frames, because frames within a session are strongly correlated (the clip
   * measured P(next fit ok | ok) = 0.971) and a split that mixed them would report a score the next
   * real cube does not reproduce.
   */
  cube: string;
  /** How the sitting was set up, for slicing the corpus by condition. Free-form by design. */
  conditions: SessionConditions;
  model: ModelIdentity;
  truth: SessionTruth;
  frames: RecordedFrame[];
  /**
   * Milliseconds at which a tick asked for a frame and got NONE, ascending.
   *
   * THE SILENCE IS PART OF THE RECORDING (Codex audit, 2026-09-26). Only frames were written down,
   * so a stretch in which the camera produced nothing — where the live scan's `next()` answered
   * null and the stillness run broke — left no trace at all, and a replay served the previous frame
   * across the gap as though it had never happened. Valid frames at 0/100/200/1000 ms with null
   * ticks between them captured NOTHING live and captured at 500 ms on replay: the harness invented
   * an uninterrupted observation, in the direction that flatters the pipeline.
   *
   * It cannot be inferred from `served`. That counts how often the SCAN consumed a frame, which is
   * a fact about the scan's cadence — a real camera re-serves its last frame, so replaying faster
   * than the recording must re-serve too, and a first attempt that read a gap out of `served` broke
   * exactly that (`is driven at the cadence it is given`). Absent on a recording made before this
   * existed, which reads as "nothing known about silence" rather than "there was none".
   */
  blind?: number[];
  decisions: RecordedDecision[];
  /**
   * What the recorder could not keep — absent on a recording that lost nothing.
   *
   * IT HAS TO SURVIVE EXPORT, which it did not until 2026-09-25: the recorder counted dropped
   * frames and substituted ids in `size`, and then handed over a session carrying neither. A
   * recording whose beginning fell off the capacity, or whose ids are the recorder's ordinals
   * rather than the camera's, looks exactly like a clean one — and the first is a time-to-side
   * measured from nowhere while the second makes every question about frame identity a question
   * about the wrong numbering.
   */
  recording?: RecordingLosses;
}

/** What a recording lost, all counts, all optional-by-absence rather than by zero. */
export interface RecordingLosses {
  /** Frames the capacity dropped from the FRONT: the recording began later than the scan did. */
  framesDropped: number;
  /** Frames whose id is the recorder's ordinal because the source's did not increase. */
  renumbered: number;
  /** Decisions dropped with their frames, or by the decision bound. */
  decisionsDropped: number;
}

/** The conditions a session was recorded under — what the corpus is sliced by (§4.3). */
export interface SessionConditions {
  /** `'built-in'`, `'external-webcam'`, `'iphone'` … */
  camera: string;
  /** `'daylight'`, `'indoor-warm'`, `'dim'` … */
  lighting: string;
  /** How the cube was handled: a person taking care, or one not. */
  handling: 'careful' | 'careless';
  /** Roughly how far from solved the cube was. `'scrambled'` or `'near-solved'`. */
  state: 'scrambled' | 'near-solved';
  /** Anything else worth knowing, in one line. */
  note?: string;
}

/**
 * Why a candidate session is not one.
 *
 * Loud and specific, because a corpus is loaded by scripts and a malformed entry that loaded
 * "mostly" would silently change a measurement rather than fail it — the failure mode this whole
 * stage exists to remove.
 */
export class SessionFormatError extends Error {
  // `options` so a wrapper can keep what it wrapped: `loadCorpus` adds the source file's name to a
  // refusal, and without a cause the original — which names the field — was gone.
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionFormatError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, where: string): string => {
  if (typeof v !== 'string' || v.length === 0) {
    throw new SessionFormatError(`${where} must be a non-empty string`);
  }
  return v;
};

/**
 * An ISO 8601 instant, checked. It labels a sitting for a person reading a listing and is never
 * used for arithmetic — but a corpus that admits `"yesterday"` cannot be sorted, filtered by date,
 * or matched against the notes taken beside it, which is most of what a label is for.
 */
/**
 * `YYYY-MM-DDTHH:MM:SS[.sss](Z|±HH:MM)` — the grammar, spelled out because `Date.parse` does not
 * enforce one.
 *
 * WHAT IT LET THROUGH, measured: `"1"` (a year, parsed as 2001) and `"2026-02-30T10:00:00Z"` (a
 * date that does not exist). It also accepts a zone-free stamp, which means a different instant
 * depending on the machine that reads it — in a corpus whose whole purpose is that two runs
 * describe the same thing.
 */
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const timestamp = (v: unknown, where: string): string => {
  const text = str(v, where);
  const m = ISO_INSTANT.exec(text);
  const refuse = (): never => {
    throw new SessionFormatError(
      `${where} must be an ISO 8601 instant with a timezone, got ${JSON.stringify(text)}`,
    );
  };
  if (!m) refuse();
  const [year, month, day, hour, minute, second] = m!.slice(1, 7).map(Number) as number[];
  const zone = m![7]!;
  // The calendar itself. `setUTCFullYear` rather than `Date.UTC`, which maps a two-digit year into
  // the 1900s and would refuse a perfectly good year 0026.
  const probe = new Date(0);
  probe.setUTCFullYear(year!, month! - 1, day!);
  const realDate =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month! - 1 &&
    probe.getUTCDate() === day;
  // SECOND 60 IS REFUSED, and admitting it was a regression this check introduced (2026-09-25).
  // `Date.parse` rejects it, so widening the grammar to "a leap second is a real instant" made the
  // format accept MORE than the loose check it replaced — and `12:34:60Z` is not a leap second in
  // any case: they fall only at 23:59:60 UTC, on announced dates, and no camera clock reports one.
  // A validator that is looser than what it replaced is worse than the thing it replaced.
  const realClock = hour! <= 23 && minute! <= 59 && second! <= 59;
  const realZone =
    zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59);
  if (!(realDate && realClock && realZone)) refuse();
  return text;
};

const num = (v: unknown, where: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SessionFormatError(`${where} must be a finite number`);
  }
  return v;
};

/** A finite number at or above `least` — elapsed times and durations, which cannot run backwards. */
const atLeast = (v: unknown, where: string, least: number): number => {
  const n = num(v, where);
  if (n < least) throw new SessionFormatError(`${where} ${n} is below ${least}`);
  return n;
};

/** A finite number strictly above zero — a box side, which has no meaning at or below it. */
const positive = (v: unknown, where: string): number => {
  const n = num(v, where);
  if (n <= 0) throw new SessionFormatError(`${where} ${n} is not a positive length`);
  return n;
};

/**
 * A whole number JavaScript can still count with.
 *
 * `Number.isInteger` is not that test: it accepts 1e308, and two frames each claiming to have been
 * served 1e308 ticks made `sessionTicks` return `Infinity` — a measurement with no error in it
 * anywhere, just a corpus that had quietly stopped being countable.
 */
const whole = (v: unknown, where: string, least: number): number => {
  const n = num(v, where);
  if (!Number.isSafeInteger(n) || n < least) {
    throw new SessionFormatError(`${where} must be a whole number of at least ${least}, got ${n}`);
  }
  return n;
};

function parseDetection(v: unknown, where: string): RecordedDetection {
  if (!isRecord(v)) throw new SessionFormatError(`${where} must be an object`);
  const scores = v.scores;
  // EXACTLY the six, FINITE, and asked through `hasFullScores` — the same predicate the recorder
  // filters with, so the two ends of the format cannot come to disagree about what a recordable
  // detection is (2026-09-25; it was the same rule written out twice). A recorded detection
  // without its full score vector is the loss this format exists to prevent (F4/P2) — the five
  // non-winning scores are what a whole-cube repair and any soft accumulation read. A SHORT vector
  // is worse than a missing one: the replay writes a six-row tensor, so a four-long vector is
  // silently zero-filled and a longer one truncated, and the session would replay as evidence
  // nobody recorded.
  if (!hasFullScores({ scores } as Detection)) {
    throw new SessionFormatError(
      `${where}.scores must list all ${NUM_COLORS} finite class scores, got ${
        Array.isArray(scores) ? scores.length : typeof scores
      }`,
    );
  }
  const kept = (scores as number[]).map((x, i) => num(x, `${where}.scores[${i}]`));
  const classId = whole(v.classId, `${where}.classId`, 0);
  if (classId >= kept.length) {
    throw new SessionFormatError(`${where}.classId ${classId} is not a class of ${kept.length}`);
  }
  // THE WINNER MUST BE THE WINNER, AND ITS CONFIDENCE MUST BE ITS SCORE (2026-09-25).
  //
  // The shape checks passed a detection whose `classId` named a class the scores did not favour,
  // and that is not a harmless inconsistency here: `session-replay` reconstructs detections from
  // the SCORES, so a recording accepted with a disagreeing `classId` replays as different evidence
  // from the evidence it was accepted as. Every producer resolves a tie the same way —
  // `decodeDetections` compares with a strict `>`, so the LOWEST index attaining the maximum wins —
  // and writing that rule down here is what makes the two halves of the corpus agree.
  let winner = 0;
  for (let c = 1; c < kept.length; c++) if (kept[c]! > kept[winner]!) winner = c;
  if (classId !== winner) {
    throw new SessionFormatError(
      `${where}.classId ${classId} is not the class its scores favour (${winner})`,
    );
  }
  const confidence = num(v.confidence, `${where}.confidence`);
  if (confidence !== kept[classId]) {
    throw new SessionFormatError(
      `${where}.confidence ${confidence} is not its class's score ${kept[classId]}`,
    );
  }
  return {
    cx: num(v.cx, `${where}.cx`),
    cy: num(v.cy, `${where}.cy`),
    // A BOX WITH NO AREA IS NOT EVIDENCE. `decodeDetections` already refuses one at the tensor —
    // every geometric check downstream compares against a width, and a negative one passes them
    // the way a NaN does.
    w: positive(v.w, `${where}.w`),
    h: positive(v.h, `${where}.h`),
    classId,
    confidence,
    // `kept`, not `scores`: the parsed session owns its evidence. Holding the caller's array meant
    // mutating the input after parsing changed what had been validated — a probe injected a `NaN`
    // that way, into numbers the parser had already certified finite.
    scores: kept,
  };
}

/**
 * MONOTONIC, AND CHECKED (§4.1). Ids and timestamps that merely LOOK monotonic are what made the
 * re-served native frame invisible in the first place; a corpus that admitted a repeat would let
 * the same defect back in through the measurement meant to catch it.
 *
 * And the times are ELAPSED times, so they start at zero: `t` is measured from the recording's
 * start and `inferMs` is a duration. A negative one is not an early frame or a fast inference, it
 * is a clock that was read wrong — and it passes straight through an average.
 */
function checkChronology(
  where: string,
  id: number,
  t: number,
  previousId: number,
  previousT: number,
): void {
  if (id <= previousId) {
    throw new SessionFormatError(`${where}.id ${id} does not increase on ${previousId}`);
  }
  if (t < previousT) throw new SessionFormatError(`${where}.t ${t} goes back before ${previousT}`);
}

function parseFrame(
  v: unknown,
  where: string,
  previousId: number,
  previousT: number,
): RecordedFrame {
  if (!isRecord(v)) throw new SessionFormatError(`${where} must be an object`);
  const id = whole(v.id, `${where}.id`, 0);
  const t = atLeast(v.t, `${where}.t`, 0);
  checkChronology(where, id, t, previousId, previousT);
  const served = v.served === undefined ? 1 : whole(v.served, `${where}.served`, 1);
  // A frame served once was last served when it was first seen, so the field is absent; one served
  // more than once must say when, or the session's duration stops at its last NEW frame.
  const lastT = v.lastT === undefined ? undefined : atLeast(v.lastT, `${where}.lastT`, t);
  if (lastT !== undefined && served === 1) {
    throw new SessionFormatError(`${where}.lastT is on a frame served once, where it is just .t`);
  }
  const dets = v.detections;
  if (!Array.isArray(dets)) throw new SessionFormatError(`${where}.detections must be an array`);
  return {
    id,
    t,
    served,
    ...(lastT === undefined ? {} : { lastT }),
    detections: dets.map((d, i) => parseDetection(d, `${where}.detections[${i}]`)),
    ...(v.inferMs === undefined ? {} : { inferMs: atLeast(v.inferMs, `${where}.inferMs`, 0) }),
    ...(v.pixels === undefined ? {} : { pixels: str(v.pixels, `${where}.pixels`) }),
  };
}

function parseTruth(v: unknown, where: string): SessionTruth {
  if (!isRecord(v)) throw new SessionFormatError(`${where} must be an object`);
  const facelets = str(v.facelets, `${where}.facelets`);
  // The truth is checked as a CUBE, not as a string. A corpus entry that is not a well-formed cube
  // would score every scan of it wrong, and the bug would look like a detector regression.
  if (!isStructurallyValid(facelets)) {
    throw new SessionFormatError(`${where}.facelets is not a well-formed cube`);
  }
  const source = str(v.source, `${where}.source`);
  if (source !== 'smart-cube' && source !== 'manual-verified') {
    throw new SessionFormatError(
      `${where}.source must be 'smart-cube' or 'manual-verified' — a corpus labelled by the ` +
        'detector measures the detector against itself',
    );
  }
  const scheme = v.scheme;
  if (scheme !== undefined && scheme !== 'western' && scheme !== 'japanese') {
    throw new SessionFormatError(`${where}.scheme must be 'western' or 'japanese' when present`);
  }
  return { facelets, source, ...(scheme === undefined ? {} : { scheme }) };
}

function parseConditions(v: unknown, where: string): SessionConditions {
  if (!isRecord(v)) throw new SessionFormatError(`${where} must be an object`);
  const handling = str(v.handling, `${where}.handling`);
  if (handling !== 'careful' && handling !== 'careless') {
    throw new SessionFormatError(`${where}.handling must be 'careful' or 'careless'`);
  }
  const state = str(v.state, `${where}.state`);
  if (state !== 'scrambled' && state !== 'near-solved') {
    throw new SessionFormatError(`${where}.state must be 'scrambled' or 'near-solved'`);
  }
  return {
    camera: str(v.camera, `${where}.camera`),
    lighting: str(v.lighting, `${where}.lighting`),
    handling,
    state,
    ...(v.note === undefined ? {} : { note: str(v.note, `${where}.note`) }),
  };
}

/**
 * The frames, in order, and countable in aggregate.
 *
 * The total matters on its own: `served` is a per-frame count and `sessionTicks` adds them up, so
 * two frames each within the safe range can still sum past it. A session whose ticks cannot be
 * counted is refused here rather than measured into an `Infinity` downstream, where nothing would
 * look like an error.
 */
function parseFrames(frames: readonly unknown[]): RecordedFrame[] {
  const out: RecordedFrame[] = [];
  let lastId = Number.NEGATIVE_INFINITY;
  let lastT = Number.NEGATIVE_INFINITY;
  let ticks = 0;
  for (const [i, f] of frames.entries()) {
    const frame = parseFrame(f, `frames[${i}]`, lastId, lastT);
    lastId = frame.id;
    // The LAST serving: a frame still being served when the next one arrives would otherwise let
    // the two overlap, and the overlap is exactly the span this field exists to make visible.
    lastT = frame.lastT ?? frame.t;
    ticks += frame.served;
    if (!Number.isSafeInteger(ticks)) {
      throw new SessionFormatError(
        `frames[${i}].served takes the session past ${Number.MAX_SAFE_INTEGER} ticks`,
      );
    }
    out.push(frame);
  }
  return out;
}

/**
 * Parse and CHECK one recorded session, or throw `SessionFormatError` saying exactly what is wrong.
 *
 * Every field is checked, including the ones a happy path would never read: a corpus is the
 * instrument every later measurement is taken with, and an instrument that reads a malformed entry
 * as a slightly different measurement is worse than one that refuses.
 */
export function parseSession(value: unknown): RecordedSession {
  if (!isRecord(value)) throw new SessionFormatError('a session must be an object');
  if (value.schema !== SESSION_SCHEMA) {
    throw new SessionFormatError(
      `schema ${JSON.stringify(value.schema)} is not ${SESSION_SCHEMA} — this reader cannot ` +
        'interpret it, and guessing would corrupt the measurement',
    );
  }
  const model = value.model;
  if (!isRecord(model)) throw new SessionFormatError('model must be an object');
  const frames = value.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new SessionFormatError('frames must be a non-empty array');
  }
  const decisions = value.decisions === undefined ? [] : value.decisions;
  if (!Array.isArray(decisions)) throw new SessionFormatError('decisions must be an array');
  const parsedFrames = parseFrames(frames);
  return {
    schema: SESSION_SCHEMA,
    id: str(value.id, 'id'),
    startedAt: timestamp(value.startedAt, 'startedAt'),
    cube: str(value.cube, 'cube'),
    conditions: parseConditions(value.conditions, 'conditions'),
    model: {
      name: str(model.name, 'model.name'),
      runtime: str(model.runtime, 'model.runtime'),
      ...(model.hash === undefined ? {} : { hash: str(model.hash, 'model.hash') }),
      ...(model.source === undefined ? {} : { source: str(model.source, 'model.source') }),
    },
    truth: parseTruth(value.truth, 'truth'),
    frames: parsedFrames,
    decisions: parseDecisions(decisions, parsedFrames),
    ...(value.blind === undefined ? {} : { blind: parseBlind(value.blind) }),
    ...(value.recording === undefined ? {} : { recording: parseLosses(value.recording) }),
  };
}

/**
 * The times a tick got no frame, ascending and whole.
 *
 * SORTED HERE RATHER THAN TRUSTED, because a replay walks it with a cursor and an out-of-order entry
 * would silently skip a gap. Absent is "nothing known about silence"; present and empty is "there
 * was none", and the two are deliberately different.
 */
function parseBlind(v: unknown): number[] {
  if (!Array.isArray(v)) throw new SessionFormatError('blind must be an array');
  const out = v.map((t, i) => whole(t, `blind[${i}]`, 0));
  return out.sort((a, b) => a - b);
}

/** What the recording lost. Absent means nothing was lost; present means all three counts are. */
function parseLosses(v: unknown): RecordingLosses {
  if (!isRecord(v)) throw new SessionFormatError('recording must be an object');
  return {
    framesDropped: whole(v.framesDropped, 'recording.framesDropped', 0),
    renumbered: whole(v.renumbered, 'recording.renumbered', 0),
    decisionsDropped: whole(v.decisionsDropped, 'recording.decisionsDropped', 0),
  };
}

/**
 * Deep, so the parsed session OWNS its evidence.
 *
 * The copy used to be one level, over a value typed `Record<string, unknown>` whose actual callers
 * supply arrays — `{ face, colors }` — so mutating a caller's array after parsing changed recorded
 * history, and mutating an exported one changed what a later export said. `structuredClone` is the
 * platform's own deep copy and handles the cycles a hand-written one would recurse forever on; a
 * value it cannot clone is a value that was never recordable, and saying so is the point.
 */
export function cloneDetail(
  detail: Record<string, unknown>,
  where: string,
): Record<string, unknown> {
  try {
    return structuredClone(detail);
  } catch (cause) {
    throw new SessionFormatError(`${where} holds a value that cannot be recorded`, { cause });
  }
}

/**
 * The decisions, each against the frame it names and the decision before it.
 *
 * Lifted out of `parseSession` (2026-09-25) — it was a 36-line callback inside a 77-line function,
 * which put "is this one record valid" and "is this collection ordered" in the same place, and the
 * second of those was not being asked at all.
 */
function parseDecisions(
  decisions: readonly unknown[],
  frames: readonly RecordedFrame[],
): RecordedDecision[] {
  const at = new Map(frames.map((f) => [f.id, f]));
  let previousT = Number.NEGATIVE_INFINITY;
  return decisions.map((d, i) => {
    const where = `decisions[${i}]`;
    if (!isRecord(d)) throw new SessionFormatError(`${where} must be an object`);
    const frame = num(d.frame, `${where}.frame`);
    // A decision pointing at a frame the session does not hold is a recording that lost frames
    // mid-write. Silently keeping it would leave the harness attributing a capture to nothing.
    const on = at.get(frame);
    if (!on) {
      throw new SessionFormatError(`${where}.frame ${frame} is not a frame of this session`);
    }
    const kind = str(d.kind, `${where}.kind`);
    if (!isDecisionKind(kind)) {
      throw new SessionFormatError(`${where}.kind ${JSON.stringify(kind)} is not a decision kind`);
    }
    // A DECISION CANNOT PRECEDE ITS OWN CAUSE, and decisions cannot run backwards against each
    // other. Both were unchecked, and either one turns the timing distributions the whole harness
    // is gated on into arithmetic over impossible events.
    const t = atLeast(d.t, `${where}.t`, 0);
    if (t < on.t) {
      throw new SessionFormatError(`${where}.t ${t} is before frame ${frame} at ${on.t}`);
    }
    if (t < previousT) {
      throw new SessionFormatError(`${where}.t ${t} goes back before ${previousT}`);
    }
    previousT = t;
    // An ABSENT detail is a decision that carried none; a detail that is present and is not an
    // object is a corrupt recording, and replacing it with `{}` would hide that behind a
    // decision that reads as ordinary.
    if (d.detail !== undefined && !isRecord(d.detail)) {
      throw new SessionFormatError(`${where}.detail must be an object when present`);
    }
    return {
      frame,
      t,
      kind,
      detail: isRecord(d.detail) ? cloneDetail(d.detail, `${where}.detail`) : {},
    };
  });
}

/** How long the session ran, in milliseconds: its first frame to its last. */
export function sessionDurationMs(session: RecordedSession): number {
  const first = session.frames[0]!;
  const last = session.frames[session.frames.length - 1]!;
  // The last SERVING, not the last new frame: a source that re-serves its final frame goes on
  // observing the cube without writing anything, and a session that ended that way used to report
  // a duration of zero with decisions recorded seconds into it.
  return (last.lastT ?? last.t) - first.t;
}

/**
 * Frames per second, measured over the frames HELD rather than over the session's span.
 *
 * The distinction is the scan trace's (`ScanTrace.summary`), and it was a real defect there: a
 * ring that dropped its oldest frames, divided by the whole session's age, reported 6.6 ticks a
 * second for a scanner running at 14.
 */
export function sessionFps(session: RecordedSession): number | null {
  const span = sessionDurationMs(session) / 1000;
  if (span <= 0) return null;
  return (session.frames.length - 1) / span;
}

/**
 * How many TICKS A SECOND the session was driven at — what a replay has to reproduce.
 *
 * NOT `sessionFps`, WHICH COUNTS DISTINCT FRAMES (Codex audit, 2026-09-26). A camera that re-serves
 * the same frame is the ordinary case — that is the whole subject of C3 — so on a session whose
 * frames were each served ten times, `sessionFps` reports a tenth of the real cadence and a replay
 * defaulting to it ticks ten times too slowly. Measured shape: frames at 0/600/1200 ms, each served
 * ten times at 60 ms, gives a default tick of 870 ms and a replay that captures nothing, where the
 * recorded 60 ms captures at 1200 ms. The two counts have always both been here, with the comment
 * below saying neither is the default; this names which one a REPLAY means.
 */
export function sessionTickRate(session: RecordedSession): number | null {
  const span = sessionDurationMs(session) / 1000;
  if (span <= 0) return null;
  const ticks = sessionTicks(session);
  return ticks > 1 ? (ticks - 1) / span : null;
}

/**
 * How many TICKS the session served, which on a re-serving source is more than its frames.
 *
 * The gap between this and `frames.length` is exactly C3's size: the ticks that consumed a frame
 * already consumed. A design that accumulates evidence must count the frames, and a description of
 * how the old gate behaved must count the ticks, so both are available and neither is the default.
 */
export function sessionTicks(session: RecordedSession): number {
  return session.frames.reduce((n, f) => n + f.served, 0);
}
