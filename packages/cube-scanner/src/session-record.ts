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
  /** The file's sha256, lower-case hex. The identity; `name` is only for a person reading a listing. */
  hash: string;
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
  /** Every candidate at or above `NEAR_FLOOR_RECORD`, unrounded, each with all class scores. */
  detections: Detection[];
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
 * Something the panel decided, stamped with the frame it decided on.
 *
 * `frame` rather than a timestamp: a decision belongs to the evidence that caused it, and on a path
 * that re-serves frames a timestamp does not say which read was the cause.
 */
export interface RecordedDecision {
  frame: number;
  t: number;
  kind: 'captured' | 'held-back' | 'turned-away' | 'contest-resolved' | 'look-asked' | 'finished';
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
  decisions: RecordedDecision[];
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
  constructor(message: string) {
    super(message);
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

const num = (v: unknown, where: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SessionFormatError(`${where} must be a finite number`);
  }
  return v;
};

function parseDetection(v: unknown, where: string): Detection {
  if (!isRecord(v)) throw new SessionFormatError(`${where} must be an object`);
  const scores = v.scores;
  if (!Array.isArray(scores) || scores.length === 0) {
    // A recorded detection without its full score vector is the exact loss this format exists to
    // prevent (F4/P2): the five non-winning scores are what a whole-cube repair and any soft
    // accumulation read, and a corpus missing them cannot answer the questions it was built for.
    throw new SessionFormatError(`${where}.scores must list every class score`);
  }
  for (const [i, s] of scores.entries()) num(s, `${where}.scores[${i}]`);
  const classId = num(v.classId, `${where}.classId`);
  if (!Number.isInteger(classId) || classId < 0 || classId >= scores.length) {
    throw new SessionFormatError(`${where}.classId ${classId} is not a class of ${scores.length}`);
  }
  return {
    cx: num(v.cx, `${where}.cx`),
    cy: num(v.cy, `${where}.cy`),
    w: num(v.w, `${where}.w`),
    h: num(v.h, `${where}.h`),
    classId,
    confidence: num(v.confidence, `${where}.confidence`),
    scores: scores as number[],
  };
}

function parseFrame(
  v: unknown,
  where: string,
  previousId: number,
  previousT: number,
): RecordedFrame {
  if (!isRecord(v)) throw new SessionFormatError(`${where} must be an object`);
  const id = num(v.id, `${where}.id`);
  if (!Number.isInteger(id)) throw new SessionFormatError(`${where}.id must be an integer`);
  // MONOTONIC, AND CHECKED (§4.1). Ids and timestamps that merely LOOK monotonic are what made the
  // re-served native frame invisible in the first place; a corpus that admitted a repeat would let
  // the same defect back in through the measurement meant to catch it.
  if (id <= previousId) {
    throw new SessionFormatError(`${where}.id ${id} does not increase on ${previousId}`);
  }
  const t = num(v.t, `${where}.t`);
  if (t < previousT) throw new SessionFormatError(`${where}.t ${t} goes back before ${previousT}`);
  const served = v.served === undefined ? 1 : num(v.served, `${where}.served`);
  if (!Number.isInteger(served) || served < 1) {
    throw new SessionFormatError(`${where}.served must be a whole number of ticks, at least 1`);
  }
  const dets = v.detections;
  if (!Array.isArray(dets)) throw new SessionFormatError(`${where}.detections must be an array`);
  return {
    id,
    t,
    served,
    detections: dets.map((d, i) => parseDetection(d, `${where}.detections[${i}]`)),
    ...(v.inferMs === undefined ? {} : { inferMs: num(v.inferMs, `${where}.inferMs`) }),
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
  const parsedFrames: RecordedFrame[] = [];
  let lastId = Number.NEGATIVE_INFINITY;
  let lastT = Number.NEGATIVE_INFINITY;
  for (const [i, f] of frames.entries()) {
    const frame = parseFrame(f, `frames[${i}]`, lastId, lastT);
    lastId = frame.id;
    lastT = frame.t;
    parsedFrames.push(frame);
  }
  const ids = new Set(parsedFrames.map((f) => f.id));
  return {
    schema: SESSION_SCHEMA,
    id: str(value.id, 'id'),
    startedAt: str(value.startedAt, 'startedAt'),
    cube: str(value.cube, 'cube'),
    conditions: parseConditions(value.conditions, 'conditions'),
    model: {
      hash: str(model.hash, 'model.hash'),
      name: str(model.name, 'model.name'),
      runtime: str(model.runtime, 'model.runtime'),
    },
    truth: parseTruth(value.truth, 'truth'),
    frames: parsedFrames,
    decisions: decisions.map((d, i) => {
      const where = `decisions[${i}]`;
      if (!isRecord(d)) throw new SessionFormatError(`${where} must be an object`);
      const frame = num(d.frame, `${where}.frame`);
      // A decision pointing at a frame the session does not hold is a recording that lost frames
      // mid-write. Silently keeping it would leave the harness attributing a capture to nothing.
      if (!ids.has(frame)) {
        throw new SessionFormatError(`${where}.frame ${frame} is not a frame of this session`);
      }
      const kind = str(d.kind, `${where}.kind`);
      const kinds = [
        'captured',
        'held-back',
        'turned-away',
        'contest-resolved',
        'look-asked',
        'finished',
      ];
      if (!kinds.includes(kind)) {
        throw new SessionFormatError(
          `${where}.kind ${JSON.stringify(kind)} is not a decision kind`,
        );
      }
      return {
        frame,
        t: num(d.t, `${where}.t`),
        kind: kind as RecordedDecision['kind'],
        detail: isRecord(d.detail) ? { ...d.detail } : {},
      };
    }),
  };
}

/** How long the session ran, in milliseconds: its first frame to its last. */
export function sessionDurationMs(session: RecordedSession): number {
  const first = session.frames[0]!;
  const last = session.frames[session.frames.length - 1]!;
  return last.t - first.t;
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
 * How many TICKS the session served, which on a re-serving source is more than its frames.
 *
 * The gap between this and `frames.length` is exactly C3's size: the ticks that consumed a frame
 * already consumed. A design that accumulates evidence must count the frames, and a description of
 * how the old gate behaved must count the ticks, so both are available and neither is the default.
 */
export function sessionTicks(session: RecordedSession): number {
  return session.frames.reduce((n, f) => n + f.served, 0);
}
