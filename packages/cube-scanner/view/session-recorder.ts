/**
 * Record a live scan into a `RecordedSession` — the corpus's only source
 * (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 0.1).
 *
 * WHAT IT KEEPS THAT THE TRACE COULD NOT (P2/D9). `ScanTrace` rounds its boxes, caps them at
 * sixteen, carries scores only for the centre probe, and holds no pixels — so a bug report could
 * not become a replayable case, and no camera or model experiment could be replayed at all. This
 * keeps every candidate above a low floor, unrounded, with all six class scores, the frame's own
 * identity, and a reference to its pixels where a caller supplies them.
 *
 * OFF UNLESS ASKED FOR, exactly as the trace is: `localStorage.cubusScanRecord = '1'`, read when a
 * scan loop starts so it is switched on for the next side shown and never mid-frame. Nothing leaves
 * the machine — there is no upload and no file, only memory a developer reads and exports.
 *
 * THE TRUTH IS NOT RECORDED HERE, AND THAT IS THE POINT. `finish()` takes it as an argument,
 * because a corpus labelled by the thing being measured measures nothing (§4.1): it comes from a
 * smart cube's own report or a person's verified manual entry, and the type in
 * `session-record.ts` refuses any other provenance. A session whose truth was never supplied is
 * not a corpus entry and `finish()` says so rather than inventing one.
 */

import type { Detection } from '../src/onnx-postprocess.js';
import {
  type ModelIdentity,
  NEAR_FLOOR_RECORD,
  type RecordedDecision,
  type RecordedFrame,
  type RecordedSession,
  SESSION_SCHEMA,
  type SessionConditions,
  type SessionTruth,
} from '../src/session-record.js';

/** The switch, in localStorage. Its own key, so a trace and a recording are independent. */
export const RECORD_KEY = 'cubusScanRecord';

/**
 * Frames kept. A session is minutes, not hours: at the native path's ~16 ticks a second this is
 * about four minutes of scanning, the same span `TRACE_CAPACITY` covers, and a recording left on
 * is bounded rather than a leak. A session that runs past it keeps its NEWEST frames, and
 * `framesDropped` says how many it lost — a corpus entry that silently began in the middle would
 * report a time-to-side measured from nowhere.
 */
export const RECORD_CAPACITY = 4000;

/** Whether the switch is on. A storage that throws (a locked-down page) is simply "off". */
export function recordEnabled(
  store: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): boolean {
  try {
    return store?.getItem(RECORD_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The detections worth recording: everything at or above `NEAR_FLOOR_RECORD`, each with its full
 * score vector.
 *
 * Far below the scan's own `MIN_STICKER_CONFIDENCE` on purpose. Today's stuck session had a centre
 * scoring 0.20–0.25 on 177 frames, so a recording made at the scan's threshold would not contain
 * the very frames the failure is made of — which is the discarded-evidence pattern §0.2 names,
 * repeated in the instrument built to measure it.
 *
 * A detection without its scores is DROPPED rather than recorded short: `parseSession` refuses one,
 * and a recorder that wrote them would produce sessions no reader will load.
 */
export function worthRecording(dets: readonly Detection[]): Detection[] {
  return dets
    .filter((d) => d.confidence >= NEAR_FLOOR_RECORD && d.scores !== undefined)
    .map((d) => ({ ...d, scores: [...(d.scores as number[])] }));
}

/**
 * What `begin()` needs, which is exactly what the SCAN knows: which sitting this is and what model
 * is running.
 *
 * The cube, the conditions and the truth are NOT here, because the scan does not know them — a
 * person does. They are supplied at `finish()`, which is also where the truth's provenance is
 * checked. Asking the panel for them at `begin()` would mean inventing placeholders, and a corpus
 * entry labelled `cube: 'unknown'` is worse than no entry: it looks like a measurement.
 */
export interface RecordingStart {
  id: string;
  model: ModelIdentity;
}

/** What a PERSON supplies when a recording is exported. See the file header on the truth. */
export interface RecordingEnd {
  cube: string;
  conditions: SessionConditions;
  truth: SessionTruth;
}

export class SessionRecorder {
  private start: RecordingStart | null = null;
  private startedAt = '';
  private t0 = 0;
  private readonly frames: RecordedFrame[] = [];
  private readonly decisions: RecordedDecision[] = [];
  private dropped = 0;
  /** The id of the last frame recorded, so a re-served one is counted rather than duplicated. */
  private lastId: number | null = null;
  /** Frames whose source id could not be used because it did not increase — see `frame`. */
  private renumbered = 0;

  constructor(
    private readonly capacity: number = RECORD_CAPACITY,
    private readonly clock: () => number = () => performance.now(),
    private readonly wall: () => string = () => new Date().toISOString(),
  ) {}

  /** A scan loop started: every frame until the next `begin` belongs to it. */
  begin(start: RecordingStart): void {
    this.start = start;
    this.startedAt = this.wall();
    this.t0 = this.clock();
    this.frames.length = 0;
    this.decisions.length = 0;
    this.dropped = 0;
    this.lastId = null;
    this.renumbered = 0;
  }

  /**
   * How many frames this recording holds, how many the capacity dropped, and how many carry the
   * recorder's own ordinal because the source's id did not increase (see `frame`).
   *
   * `renumbered` above zero means the recording's ids are not the camera's, so questions about
   * frame identity — how many DISTINCT frames a decision rested on — are answered about the
   * recorder's numbering rather than the camera's. Reported rather than hidden, because a silent
   * substitution here would look exactly like a clean recording.
   */
  get size(): { frames: number; framesDropped: number; renumbered: number } {
    return {
      frames: this.frames.length,
      framesDropped: this.dropped,
      renumbered: this.renumbered,
    };
  }

  /**
   * Record one tick's detections.
   *
   * `frameId` is the identity D2 put on the seam. A tick served a frame ALREADY RECORDED does not
   * add a second entry — it increments that frame's `served`, which is the one number that makes
   * "how many DISTINCT frames did this decision rest on" answerable at all. A source that cannot
   * identify its frames passes `undefined`, and then every tick is a frame, because that is
   * genuinely all such a source knows.
   */
  frame(
    dets: readonly Detection[],
    options: { frameId?: number; inferMs?: number; pixels?: string } = {},
  ): void {
    if (!this.start) return;
    const { frameId, inferMs, pixels } = options;
    const last = this.frames[this.frames.length - 1];
    if (frameId !== undefined && last && frameId === this.lastId) {
      last.served += 1;
      return;
    }
    // The id is the SOURCE's where it has one, and the frame's ordinal where it does not.
    // `parseSession` requires it to increase, and a source with no identity would otherwise record
    // every frame as the same one.
    //
    // A SOURCE WHOSE IDS GO BACKWARDS STILL PRODUCES A READABLE RECORDING. The browser's identity
    // is the video's presentation time, which restarts at zero when a stream is replaced; a scan
    // that switched camera mid-recording would otherwise write a session `parseSession` refuses —
    // and a recording nobody can load is a recording that did not happen. The frame is kept, with
    // the recorder's own ordinal standing in for an identity the source contradicted. It is not
    // silent: `renumbered` counts it, so a session whose ids were not the camera's says so.
    const next = last ? last.id + 1 : 0;
    const supplied = frameId !== undefined && (!last || frameId > last.id);
    if (frameId !== undefined && !supplied) this.renumbered += 1;
    const id = supplied ? (frameId as number) : next;
    this.lastId = supplied ? (frameId as number) : null;
    this.frames.push({
      id,
      t: Math.round(this.clock() - this.t0),
      served: 1,
      detections: worthRecording(dets),
      ...(inferMs === undefined ? {} : { inferMs: Math.round(inferMs * 10) / 10 }),
      ...(pixels === undefined ? {} : { pixels }),
    });
    if (this.frames.length > this.capacity) {
      this.frames.shift();
      this.dropped += 1;
    }
  }

  /**
   * Record something the panel decided, against the frame it decided on.
   *
   * Dropped when no frame has been recorded yet: `parseSession` refuses a decision pointing at a
   * frame the session does not hold, and a recording that wrote one would be a corpus entry no
   * reader will load — a recorder must not be able to produce a file it cannot produce.
   */
  decision(kind: RecordedDecision['kind'], detail: Record<string, unknown> = {}): void {
    const last = this.frames[this.frames.length - 1];
    if (!this.start || !last) return;
    this.decisions.push({
      frame: last.id,
      t: Math.round(this.clock() - this.t0),
      kind,
      detail: { ...detail },
    });
  }

  /**
   * The finished session, with the cube, the conditions and the truth a PERSON supplied — or null
   * when there is nothing to hand over.
   *
   * Null rather than a partial session for the two cases that cannot be a corpus entry: no
   * recording was begun, and no frame was ever recorded. Both would parse as malformed, and a
   * recorder that emits something a reader refuses is worse than one that says it has nothing.
   *
   * Decisions pointing at frames the capacity has since dropped are pruned here, for the same
   * reason: `parseSession` refuses them, and a long sitting is exactly when the oldest frames go.
   */
  finish(end: RecordingEnd): RecordedSession | null {
    if (!this.start || this.frames.length === 0) return null;
    const ids = new Set(this.frames.map((f) => f.id));
    return {
      schema: SESSION_SCHEMA,
      id: this.start.id,
      startedAt: this.startedAt,
      cube: end.cube,
      conditions: { ...end.conditions },
      model: { ...this.start.model },
      truth: { ...end.truth },
      frames: this.frames.map((f) => ({ ...f, detections: f.detections.map((d) => ({ ...d })) })),
      decisions: this.decisions
        .filter((d) => ids.has(d.frame))
        .map((d) => ({ ...d, detail: { ...d.detail } })),
    };
  }
}
