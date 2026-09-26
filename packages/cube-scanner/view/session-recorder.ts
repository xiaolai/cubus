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
  cloneDetail,
  hasFullScores,
  type ModelIdentity,
  NEAR_FLOOR_RECORD,
  parseSession,
  type RecordedDecision,
  type RecordedDetection,
  type RecordedFrame,
  type RecordedSession,
  type RecordingLosses,
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

/**
 * Decisions kept, bounded on its own.
 *
 * FRAME EVICTION IS NOT A BOUND ON DECISIONS (2026-09-25). Dropping a frame used to leave its
 * decisions in the list for ever — `finish()` filtered them out of the EXPORT and the recorder
 * itself went on holding them, so a recording with a capacity of 2 held 99 decisions for 2 frames.
 * And decisions recorded against ONE frame are not bounded by frames at all: a scan that abstains
 * on the same re-served frame writes a decision a tick without ever adding a frame. Two mechanisms,
 * so both are needed. Far above any real sitting: a whole scan is tens of decisions.
 */
export const DECISION_CAPACITY = 2000;

/** Whether the switch is on. A storage that throws (a locked-down page) is simply "off". */
export function recordEnabled(store?: Pick<Storage, 'getItem'>): boolean {
  try {
    // READ INSIDE THE TRY, not as a default argument. A default is evaluated at the call, BEFORE
    // the body runs, and `globalThis.localStorage` is a getter that THROWS on a page where storage
    // is denied — a sandboxed iframe, a browser set to block it. So the documented "a storage that
    // throws is simply off" was not true of the commonest way for one to throw: the exception
    // escaped this function entirely and took the scan loop with it.
    const storage = store ?? globalThis.localStorage;
    return storage?.getItem(RECORD_KEY) === '1';
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
 * A detection without the FULL score vector is DROPPED rather than recorded short: `parseSession`
 * refuses one, and a recorder that wrote them would produce sessions no reader will load. The test
 * is `hasFullScores`, the format's own — checking only that `scores` was not `undefined` let an
 * empty, short, oversized or NaN-carrying vector through, which is the same defect one step later.
 */
export function worthRecording(dets: readonly Detection[]): RecordedDetection[] {
  return dets
    .filter((d): d is RecordedDetection => d.confidence >= NEAR_FLOOR_RECORD && hasFullScores(d))
    .map(cloneDetection);
}

/** The one snapshot of a detection, used wherever one crosses into or out of a recording. */
const cloneDetection = (d: RecordedDetection): RecordedDetection => ({
  ...d,
  scores: [...d.scores],
});

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
  private frames: RecordedFrame[] = [];
  private decisions: RecordedDecision[] = [];
  private dropped = 0;
  private decisionsDropped = 0;
  /** The id of the last frame recorded, so a re-served one is counted rather than duplicated. */
  private lastId: number | null = null;
  /** When a tick got no frame at all. See `blind()`. */
  private blindTicks: number[] = [];
  /** Frames whose source id could not be used because it did not increase — see `frame`. */
  private renumbered = 0;

  constructor(
    private readonly capacity: number = RECORD_CAPACITY,
    private readonly clock: () => number = () => performance.now(),
    private readonly wall: () => string = () => new Date().toISOString(),
  ) {
    // A CAPACITY THAT IS NOT ONE FAILS SILENTLY IN FOUR DIFFERENT WAYS, all of them looking like a
    // working recorder: zero and negative discard every frame as it arrives, `NaN` and `Infinity`
    // disable eviction entirely and the bound this class exists for is gone, and a fraction rounds
    // to a capacity nobody asked for. It is a constructor argument, so it is checked at the door.
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(`a recording capacity of ${capacity} is not a whole number of frames`);
    }
  }

  /**
   * End the sitting without exporting it — the scan was thrown away, so the recording is too.
   *
   * Distinct from `begin()`, which starts the next one: a recorder that is neither running nor
   * holding a finished sitting is what "no scan is being recorded" looks like, and `loop()` reads
   * `active` to decide whether it is restarting a loop or starting a sitting.
   */
  abandon(): void {
    this.start = null;
    this.frames = [];
    this.decisions = [];
  }

  /** Whether a recording is under way — so a caller can restart a loop without restarting one. */
  get active(): boolean {
    return this.start !== null;
  }

  /** A scan SITTING started: every frame until the next `begin` belongs to it. */
  begin(start: RecordingStart): void {
    // SNAPSHOT, NOT THE CALLER'S OBJECT. Holding it meant a later edit to `start.id` or
    // `start.model.hash` changed the exported session's identity or its model provenance — and
    // provenance that can be changed after the fact is not provenance. Copying at export was too
    // late: the recording had already been made under whatever the caller said next.
    this.start = { id: start.id, model: { ...start.model } };
    this.startedAt = this.wall();
    this.t0 = this.clock();
    this.frames = [];
    this.decisions = [];
    this.dropped = 0;
    this.decisionsDropped = 0;
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
  get size(): { frames: number; decisions: number } & RecordingLosses {
    return {
      frames: this.frames.length,
      decisions: this.decisions.length,
      framesDropped: this.dropped,
      renumbered: this.renumbered,
      decisionsDropped: this.decisionsDropped,
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
  /**
   * A tick asked for a frame and got none.
   *
   * THE SILENCE IS PART OF THE RECORDING (Codex audit, 2026-09-26). Only frames were written down,
   * so a stretch where the camera produced nothing left no trace and a replay served the frame
   * before it straight across the gap — inventing an unbroken run the live scan never had, and
   * capturing a side the live scan did not. Bounded like the frames, and by the same capacity: a
   * camera that never delivers must not grow this without limit.
   */
  blind(): void {
    if (!this.start) return;
    this.blindTicks.push(Math.round(this.clock() - this.t0));
    while (this.blindTicks.length > this.capacity) this.blindTicks.shift();
  }

  frame(
    dets: readonly Detection[],
    options: { frameId?: number; inferMs?: number; pixels?: string } = {},
  ): void {
    if (!this.start) return;
    const { frameId, inferMs, pixels } = options;
    const now = Math.round(this.clock() - this.t0);
    const last = this.frames[this.frames.length - 1];
    if (frameId !== undefined && last && frameId === this.lastId) {
      last.served += 1;
      // WHEN IT WAS LAST SERVED, which the count alone does not say. A final frame re-served for
      // ten seconds used to export as a session whose first and last frame were the same one, so
      // its duration was zero — with decisions recorded ten seconds into it.
      last.lastT = now;
      return;
    }
    this.keep(
      {
        id: this.identify(frameId, last),
        t: now,
        served: 1,
        detections: worthRecording(dets),
        ...(inferMs === undefined ? {} : { inferMs: Math.round(inferMs * 10) / 10 }),
        ...(pixels === undefined ? {} : { pixels }),
      },
      frameId,
    );
  }

  /**
   * The id this frame will be recorded under.
   *
   * The id is the SOURCE's where it has one, and the frame's ordinal where it does not.
   * `parseSession` requires it to increase, and a source with no identity would otherwise record
   * every frame as the same one.
   *
   * A SOURCE WHOSE IDS GO BACKWARDS STILL PRODUCES A READABLE RECORDING. The browser's identity
   * is the video's presentation time, which restarts at zero when a stream is replaced; a scan
   * that switched camera mid-recording would otherwise write a session `parseSession` refuses —
   * and a recording nobody can load is a recording that did not happen. The frame is kept, with
   * the recorder's own ordinal standing in for an identity the source contradicted. It is not
   * silent: `renumbered` counts it, so a session whose ids were not the camera's says so.
   */
  private identify(frameId: number | undefined, last: RecordedFrame | undefined): number {
    const supplied = frameId !== undefined && (!last || frameId > last.id);
    if (frameId !== undefined && !supplied) this.renumbered += 1;
    return supplied ? frameId : last ? last.id + 1 : 0;
  }

  /**
   * Put a frame in the bounded buffer, and take out whatever no longer fits — the frame AND the
   * decisions that rested on it.
   *
   * A DECISION OUTLIVING ITS FRAME IS A LEAK, not a tidiness problem: nothing else ever removed
   * one, so a long sitting grew decisions without bound while its frames stayed at the capacity —
   * 99 decisions held for 2 frames, measured. `finish()` filtered the EXPORT, which is why the
   * growth was invisible from outside.
   */
  private keep(frame: RecordedFrame, frameId: number | undefined): void {
    // THE SOURCE'S id IS REMEMBERED EVEN WHEN IT WAS NOT USED. `lastId` answers "is this the frame
    // I recorded last?", which is a question about the SOURCE's numbering, not about the id this
    // recorder assigned. Forgetting it on a renumber meant a re-served frame straight after one —
    // the ordinary case on the native path, sixteen ticks a second — was recorded as a new frame
    // every time, and `served` never counted past one for the rest of the recording.
    this.lastId = frameId ?? null;
    this.frames.push(frame);
    while (this.frames.length > this.capacity) {
      const gone = this.frames.shift()!;
      this.dropped += 1;
      const kept = this.decisions.filter((d) => d.frame !== gone.id);
      this.decisionsDropped += this.decisions.length - kept.length;
      this.decisions = kept;
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
    // ITS OWN BOUND. Frame eviction cannot bound these: a scan abstaining on one re-served frame
    // writes a decision a tick and adds no frame at all. Oldest first, as the frames are.
    if (this.decisions.length >= DECISION_CAPACITY) {
      this.decisions.shift();
      this.decisionsDropped += 1;
    }
    this.decisions.push({
      frame: last.id,
      t: Math.round(this.clock() - this.t0),
      kind,
      // DEEP. The copy was one level over a value typed `Record<string, unknown>` whose actual
      // callers supply arrays (`{ face, colors }`), so a caller that reused its array changed
      // recorded history after the fact.
      detail: cloneDetail(detail, 'decision.detail'),
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
    const lost = this.dropped + this.renumbered + this.decisionsDropped;
    // THROUGH THE READER, which is what makes the documented checks real (2026-09-25). This method
    // promised a truth with the right provenance and a well-formed cube, and enforced neither — it
    // is reached from the developer console, where TypeScript protects nobody, so a malformed
    // facelet string, a missing truth or a detector-derived source were all returned as a session
    // and only refused later by whoever tried to load the file. `parseSession` also deep-copies
    // every array it validates, so the session handed out cannot alias the recorder's: one
    // implementation of the copy, not a second one here that could come to disagree with it.
    return parseSession({
      schema: SESSION_SCHEMA,
      id: this.start.id,
      startedAt: this.startedAt,
      cube: end.cube,
      conditions: { ...end.conditions },
      model: { ...this.start.model },
      truth: { ...end.truth },
      frames: this.frames,
      // Present even when empty, so a recording made by this version says "no silence observed"
      // rather than "nothing known about silence" — the two are different to a replay.
      blind: this.blindTicks,
      decisions: this.decisions,
      // WHAT THE RECORDING LOST TRAVELS WITH IT. `size` reported these to a developer watching and
      // the export dropped them, so a recording whose beginning fell off the capacity — or whose
      // ids are this recorder's ordinals rather than the camera's — arrived looking clean.
      ...(lost === 0
        ? {}
        : {
            recording: {
              framesDropped: this.dropped,
              renumbered: this.renumbered,
              decisionsDropped: this.decisionsDropped,
            },
          }),
    });
  }
}
