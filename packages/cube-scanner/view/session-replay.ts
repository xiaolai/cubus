/**
 * Run the WHOLE pipeline over a recorded session, at the cadence it was recorded at or at another
 * one, and report what happened (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 0.2).
 *
 * THE REAL PANEL, NOT A MODEL OF IT. The frames go in through `Detector`, the seam both shipped
 * runtimes sit behind, and everything after it — decode, NMS, nested-box removal, isolation, fit,
 * the stillness gate, filing, assembly — is the code the app runs. A harness that re-implemented
 * any of those would measure the re-implementation, and the six fixes in §1.1 were each judged on
 * exactly that kind of stand-in.
 *
 * CADENCE IS A PARAMETER BECAUSE IT CHANGES THE ANSWER (T1). The stillness gate needs an unbroken
 * run of max(3, ⌈0.5·fps⌉+1) reads, so the FASTER runtime needs the LONGER run: 4 frames at 5 fps,
 * 9 at 15.7, 16 at 30. A fix measured only at the cadence of the machine it was written on is not
 * measured. `tickMs` re-serves the same recording to the same pipeline at a different rate, and the
 * frames are placed by their recorded timestamps, so a slower tick sees fewer of them — which is
 * what a slower machine sees.
 *
 * THE CLOCK IS THE CALLER'S. Driving a scan in real time would make a corpus run take as long as
 * the scans did; every caller fakes timers. So `advance` is injected, and the blocking measurement
 * takes a SEPARATE real clock, because the faked one cannot see how long a tick actually took —
 * which is the one thing the blocking metric is for (A3: 606 ms of centre resolution on the UI
 * thread).
 */

import { rotateFace } from '../src/ai-assemble.js';
import type { CameraDevice } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import { type Colour, colourOf, SCHEMES, type Scheme } from '../src/scheme.js';
import type { IdentityAnswer, SessionOutcome, SideOutcome } from '../src/session-metrics.js';
import type { RecordedFrame, RecordedSession } from '../src/session-record.js';
import { sessionTickRate } from '../src/session-record.js';
import { FACES, type Face, type Frame } from '../src/types.js';
import {
  AiScanPanel,
  type IdentityRequest,
  type ScanCapture,
  type ScanProgress,
} from './ai-scan-panel.js';

/**
 * What a person does with the scan's identity question — the one interaction a replay can drive.
 *
 * A number ANSWERS with that colour, `'skip'` sets the question aside, and `null` leaves it
 * standing, which is a person who does not look. Three outcomes rather than two, because "nobody
 * answered" and "somebody decided to move on" are different behaviours to measure (§6, item 3).
 */
export type IdentityPolicy = (ask: IdentityRequest) => number | 'skip' | null;

/**
 * The nine stickers at POSITION `face` of a truth string, as the COLOURS a detector would emit.
 *
 * TWO CONVERSIONS, AND THEY ARE NOT THE SAME ONE (ADR 0001 §8.5, and a Codex audit caught this
 * reading them as one). A facelet string is POSITIONAL — its letters are U/R/F/D/L/B — and a
 * capture holds colour CLASSES. `FACES.indexOf(letter)` maps the two through the WESTERN identity,
 * which is right on a Western cube and wrong on a Japanese one, where the Down position wears blue
 * and the Back position yellow. A harness that quietly assumed one arrangement would score a
 * correct scan of the other as a misread.
 */
function sideOfTruth(truth: string, face: Face, scheme: Scheme): number[] {
  const at = FACES.indexOf(face) * 9;
  return [...truth.slice(at, at + 9)].map((letter) => colourOf(letter as Face, scheme));
}

/** The eight around the centre must reach this to name a side, and must beat the runner-up by
 *  `SHOWN_MARGIN`. Both are measured, not chosen: over the seven real collisions in
 *  `tests/fixtures/centre-collisions.ts` every true side scores 6 to 8 with the next best at 5 or
 *  under, and the worst case (cube E) is 6 against 3. A bar of 7 would refuse that one, and a
 *  margin of 1 would let a scrambled capture name a side on a coin-flip. */
export const SHOWN_MIN = 6;
export const SHOWN_MARGIN = 2;

/**
 * Which side of `truth` a capture SHOWS, by its eight, or null when the truth cannot say.
 *
 * THE TRUTH DECIDES, NEVER THE SCAN. Whether an answer was right is a fact about the cube, and
 * asking the scanner would be selecting a test's ground truth with the thing under test. The eight
 * only, up to rotation: the centre is the sticker under discussion, and the camera cannot see which
 * way up a side was held.
 *
 * WHY IT CAN ANSWER NULL AT ALL. A person holding the cube can always name the colour in front of
 * them; this stands in for them from numbers, and numbers can be short of an answer. Two sides of
 * one cube can share their eight exactly — after `U D R L F B` the white and yellow sides do — and
 * a capture that matches two of them says nothing about which was in the hand. `IdentityAnswer.right`
 * then reports "the truth could not say", which is not a wrong answer and is not counted as one.
 *
 * ONE IMPLEMENTATION, because two would drift: `centre-collision.test.ts` asks the same question of
 * a photo drop, and a second copy of this rule there would make the two experiments incomparable.
 */
export function sideShownIn(
  colors: readonly number[],
  truth: string,
  scheme?: Scheme,
): Colour | null {
  if (scheme) return shownUnder(colors, truth, scheme);
  // NO SCHEME RECORDED, which `SessionTruth.scheme` allows on purpose — ADR 0001 makes the scheme a
  // third ambiguity dimension, and a corpus that filled it in by assumption would score a correct
  // scan wrong on the cubes where both arrangements read alike.
  //
  // THE READING USUALLY SETTLES IT ITSELF. A capture taken off a Western cube matches a Western
  // recolouring of the truth and, on most sides, nothing at all in a Japanese one — so trying both
  // and taking the answer when exactly ONE arrangement produces it is not a guess, it is the
  // measurement. Where both produce one they must agree; where they disagree, the truth genuinely
  // cannot name the colour in the middle of the side in hand and null says so.
  const answers = SCHEMES.map((s) => shownUnder(colors, truth, s)).filter((c) => c !== null);
  if (answers.length === 0) return null;
  return answers.every((c) => c === answers[0]) ? answers[0]! : null;
}

/**
 * How many of the EIGHT around the centre two readings share, at the best of the four rotations.
 *
 * `rotateFace` rather than a quarter-turn table written out here: the repository has one, it is the
 * one every other rotation in the scanner goes through, and a second copy is a second place for the
 * cube to change shape. The centre is left out because it is the sticker under discussion.
 */
function ringAgreement(colors: readonly number[], want: readonly number[]): number {
  const ring = (v: readonly number[]): number[] => v.filter((_, i) => i !== 4);
  const b = ring(want);
  let best = 0;
  for (let k = 0; k < 4; k++) {
    const a = ring(rotateFace(colors, k));
    best = Math.max(best, a.filter((c, i) => c === b[i]).length);
  }
  return best;
}

/** `sideShownIn` under one arrangement: which COLOUR the side in hand wears, or null. */
function shownUnder(colors: readonly number[], truth: string, scheme: Scheme): Colour | null {
  const scores = FACES.map((f) => ringAgreement(colors, sideOfTruth(truth, f, scheme)));
  const sorted = [...scores].sort((a, b) => b - a);
  const best = sorted[0]!;
  if (best < SHOWN_MIN || best - sorted[1]! < SHOWN_MARGIN) return null;
  const winners = FACES.filter((_, i) => scores[i] === best);
  // THE ANSWER IS A COLOUR, never a position: `answerIdentity` takes the colour in the middle of
  // the side the person is holding, and which position wears it is the arrangement's business.
  return winners.length === 1 ? colourOf(winners[0]!, scheme) : null;
}

/**
 * Which arrangement a whole DROP of captures is of, measured — or null where the readings do not
 * say clearly enough to act on.
 *
 * WHY IT IS ASKED OF THE WHOLE DROP. Only the Down and Back positions differ between the two
 * arrangements, so one side rarely separates them; six sides together usually do, and a corpus
 * entry that records no `truth.scheme` (which `SessionTruth` allows on purpose — ADR 0001 makes the
 * scheme a third ambiguity dimension) can be measured rather than assumed. The margin is per
 * capture, so it does not grow with the number of sides and a near-tie stays a near-tie.
 */
export function schemeShownIn(
  captures: readonly (readonly number[])[],
  truth: string,
): Scheme | null {
  if (captures.length === 0) return null;
  const total = (scheme: Scheme): number =>
    captures.reduce(
      (sum, colors) =>
        sum + Math.max(...FACES.map((f) => ringAgreement(colors, sideOfTruth(truth, f, scheme)))),
      0,
    );
  const western = total('western');
  const japanese = total('japanese');
  const margin = SHOWN_MARGIN * captures.length;
  if (Math.abs(western - japanese) < margin) return null;
  return western > japanese ? 'western' : 'japanese';
}

/**
 * The recorded detections of one frame as the tensor a detector hands over.
 *
 * The recording keeps candidates from BEFORE non-maximum suppression (see `session-recorder.ts`),
 * so re-running the panel's own decode, NMS and nested-box removal on them reproduces the set the
 * scan actually had — rather than a set already thinned by a different threshold, which is the trap
 * the 09-18 clip fixture sits in and the reason it cannot answer a question about NMS.
 */
export function frameTensor(frame: RecordedFrame, numClasses = 6): ModelOutput {
  const rows = 4 + numClasses;
  const anchors = Math.max(frame.detections.length, 1);
  const data = new Float32Array(rows * anchors);
  frame.detections.forEach((d, a) => {
    data[0 * anchors + a] = d.cx;
    data[1 * anchors + a] = d.cy;
    data[2 * anchors + a] = d.w;
    data[3 * anchors + a] = d.h;
    const scores = d.scores ?? [];
    for (let c = 0; c < numClasses; c++) data[(4 + c) * anchors + a] = scores[c] ?? 0;
  });
  return { data, anchors, rows };
}

/**
 * A recorded session as a `Detector`: whichever frame was in front of the camera when asked.
 *
 * `seen` counts how many ticks each frame was served to — the harness's own measurement of C3, and
 * the thing that makes "how many DISTINCT frames did this decision rest on" answerable at all. A
 * tick that arrives before the first recorded frame gets null, which is what a camera that has
 * opened but delivered nothing returns.
 */
export class RecordedDetector implements Detector {
  device: CameraDevice | null = null;
  /** Frame id → how many ticks were served it. Read after a replay. */
  readonly served = new Map<number, number>();
  /** Frame id → its recorded pixel reference, for a replay given a resolver. */
  private readonly pixelRef = new Map<number, string>();

  /**
   * The replay's clock, in session milliseconds from zero.
   *
   * Assignable because `replaySession` OWNS the clock: a caller that builds its own detector — to
   * read `served` afterwards — cannot know the elapsed time of a run that has not started, and a
   * detector left on a clock of its own returned the first frame for ever.
   */
  clock: () => number;

  constructor(
    private readonly session: RecordedSession,
    now: () => number = () => performance.now(),
    /**
     * Where a frame's recorded pixels can be fetched from, by the reference the session stores.
     *
     * WITHOUT ONE THE PIXEL PATHS NEVER RUN, and the header's "whole pipeline" was overstated for
     * exactly that reason: the panel's sticker-pixel probe asks the detector for the frame, this
     * detector had no way to answer, and so every recovery built on pixels was silently skipped in
     * a harness whose purpose is to exercise the pipeline. A replay without a resolver still runs;
     * it reports `pixelsAvailable: false` rather than implying it tested something it did not.
     */
    private readonly pixels?: (ref: string) => Promise<Frame | null>,
  ) {
    this.clock = now;
    for (const f of session.frames) if (f.pixels !== undefined) this.pixelRef.set(f.id, f.pixels);
  }

  /** Whether this replay can answer a question about pixels at all. */
  get pixelsAvailable(): boolean {
    return this.pixels !== undefined && this.pixelRef.size > 0;
  }

  /**
   * The frame's own pixels, by the id `next()` published — the same seam the native runtime uses.
   *
   * Absent without a resolver, on purpose: `Detector.framePixels` is optional, and a method that
   * always answered null would make a runtime that cannot serve pixels indistinguishable from one
   * whose frames simply have none.
   */
  framePixels?: (frameId: number) => Promise<Frame | null>;

  async use(): Promise<void> {
    this.device = { deviceId: `replay:${this.session.id}`, label: this.session.conditions.camera };
    if (this.pixels) {
      const fetch = this.pixels;
      this.framePixels = async (frameId: number): Promise<Frame | null> => {
        const ref = this.pixelRef.get(frameId);
        return ref === undefined ? null : await fetch(ref);
      };
    }
  }

  async load(): Promise<void> {}

  /**
   * How far through the recording the last call got.
   *
   * A CURSOR, not a rescan. Time only moves forward across a replay, so the frame in front of the
   * camera can only be at or after the last one — scanning from the start on every tick makes a
   * corpus run quadratic in the session's length, and a session is thousands of frames. The cursor
   * is reset whenever the clock is seen to go BACKWARDS, so a caller that rewinds gets a correct
   * answer rather than a silently stale one: this class is public, and "only ever called with
   * increasing time" is an assumption about callers rather than something it can check once.
   */
  private cursor = -1;

  /** The same cursor over `blind`, for the same reason: time only moves forward across a replay. */
  private blindCursor = -1;

  async next(): Promise<ModelOutput | null> {
    // THE REPLAY'S CLOCK IS THE SESSION'S CLOCK, from zero (2026-09-25). Time used to start at the
    // FIRST REQUEST and have the first frame's timestamp subtracted from every frame, which threw
    // away the camera's opening delay: a session whose first frame was recorded at 500 ms — half a
    // second of a camera that had opened and delivered nothing — replayed with that frame available
    // on the very first tick, and every frame after it shifted by the same half second. A recording
    // that lost its opening frames to the capacity replays as the silence it actually was, and
    // `recording.framesDropped` is what says why.
    const elapsed = this.clock();
    const frames = this.session.frames;
    const due = (i: number): boolean => frames[i]!.t <= elapsed;
    if (this.cursor >= 0 && !due(this.cursor)) {
      this.cursor = -1;
      this.blindCursor = -1; // a caller that rewound; both cursors are about the same clock
    }
    while (this.cursor + 1 < frames.length && due(this.cursor + 1)) this.cursor += 1;
    if (this.cursor < 0) return null;
    const current = frames[this.cursor]!;
    // …UNLESS THE RECORDING SAYS THE CAMERA HAD FALLEN SILENT SINCE (Codex audit, 2026-09-26).
    // `blind` is every tick that asked for a frame and got none. Serving the previous frame across
    // one replays an observation the scan never made: frames at 0/100/200/1000 ms with null ticks
    // between captured nothing live and captured at 500 ms here, because the gate saw an unbroken
    // run of three. A `blind` newer than the current frame means the last thing that happened was
    // nothing, and nothing is what this answers. Absent `blind` is an older recording that knows
    // nothing about silence, and is replayed exactly as it always was.
    const blind = this.session.blind;
    if (blind !== undefined) {
      while (this.blindCursor + 1 < blind.length && blind[this.blindCursor + 1]! <= elapsed) {
        this.blindCursor += 1;
      }
      if (this.blindCursor >= 0 && blind[this.blindCursor]! > current.t) return null;
    }
    this.served.set(current.id, (this.served.get(current.id) ?? 0) + 1);
    // THE IDENTITY TRAVELS (D2). Without it the stillness gate counts every re-serving of one
    // recorded frame as a fresh observation — a side captured on a single look while the gate
    // reports a run of three, which is the very defect `frameId` was added to the seam to correct.
    // A replay that dropped it could not reproduce the behaviour it exists to measure.
    return { ...frameTensor(current), frameId: current.id };
  }

  async cameras(): Promise<CameraDevice[]> {
    return this.device ? [this.device] : [];
  }

  stop(): void {
    this.device = null;
  }
}

export interface ReplayOptions {
  /** How often the panel is ticked, in ms. Defaults to the session's own recorded cadence. */
  tickMs?: number;
  /**
   * How long the replay runs before the scan is called unfinished, in ms.
   *
   * Every uncaptured side is censored AT this time, so it is part of every number the run reports
   * and must be stated rather than defaulted silently per caller. Defaults to the session's own
   * length plus two seconds — long enough for a scan that was going to finish to finish.
   */
  deadlineMs?: number;
  /** Advance the caller's (usually faked) timers. The harness never sleeps on its own. */
  advance: (ms: number) => Promise<void>;
  /**
   * A clock that is NOT faked, for measuring how long each tick really blocked.
   *
   * Omitted means the run reports no blocking spans at all, rather than spans taken off a faked
   * clock — which would read as zero and pass a gate that exists to catch a frozen UI.
   *
   * WHAT THE SPAN IS, EXACTLY, AND WHAT IT RESTS ON (2026-09-25). It is the real time one TICK took
   * — one, since `tickFloorMs` now makes the panel's cadence the replay's, where a span used to
   * cover as many of the panel's own 60 ms ticks as fitted in a batch and changing the batch size
   * changed the number. It is a blocking measure only because the caller's clock is faked: nothing
   * inside a tick can then wait on real time, so what the real clock records is the work. A caller
   * whose `advance` really sleeps gets a span that includes the sleep, and this measurement is not
   * for them. It is still not a long-task measurement — the microtask turns between the panel's
   * awaits are in it — so it bounds the thread's occupancy from ABOVE, which is the safe direction
   * for a gate that exists to catch 606 ms of it.
   */
  realNow?: () => number;
  /** Where the panel is mounted. Defaults to `document.body`. */
  host?: HTMLElement;
  /** Resolve a frame's recorded pixels — see `RecordedDetector`'s constructor. */
  pixels?: (ref: string) => Promise<Frame | null>;
  /**
   * The caller's FAKED clock, in milliseconds — what the panel itself reads.
   *
   * This is what stamps a capture at the moment it happened rather than at the end of the batch it
   * happened in. `elapsed` cannot do that: it is the driving loop's own counter, and a listener
   * fires DURING `advance`, at which point the counter has already been moved to wherever the batch
   * ends. Reading the same clock the panel reads gives the real instant, because the caller's
   * `advance` moves that clock and nothing else does.
   *
   * Defaults to `performance.now`, which is what every caller here fakes. A caller whose `advance`
   * does not move it gets a clock that never advances, and the run says so rather than reporting
   * every capture at zero — see `replaySession`.
   */
  clock?: () => number;
  /**
   * The detector to drive the panel with, when the caller wants to read it afterwards.
   *
   * Built here by default. A caller supplying one gets its `served` map back, which is how "did the
   * cadence actually reach the scheduler" is asked — the question `tickMs` could not answer while
   * it only sized the advance batch.
   */
  detector?: RecordedDetector;
  /**
   * What the person does with the scan's identity question (§6, item 1).
   *
   * THE ONE ASK A REPLAY CAN ANSWER, and the reason it is worth having. Frames are selected by
   * recorded time alone, so a request for a SIDE measures a policy against a fixed showing sequence
   * and nothing else — the 09-18 clip never returns to the logo face after the fifth capture. An
   * identity question is different in kind: it is about a capture the scan is already HOLDING, so
   * answering it needs no frame the recording does not contain, and a scenario here is a real
   * experiment rather than a re-run of one.
   *
   * Absent means nobody answers, which is a scenario too: it is what the scan does alone.
   */
  answerIdentity?: IdentityPolicy;
}

/**
 * The person who names the side actually in hand, read off the session's truth — the CORRECT-ANSWER
 * scenario §6 asks for, written once so every caller runs the same one.
 *
 * TAKES THE SESSION, not a bare truth string (Codex audit, 2026-09-25). Naming a side means naming
 * a COLOUR, and which colour a position wears is the cube's arrangement — so the truth and the
 * arrangement have to travel together or a caller can pair one cube's facelets with another's
 * scheme and be scored against a cube that does not exist.
 *
 * It answers null where the right colour is not among the choices, and that is not a refusal to
 * play: §5's question names the FREE slots, so when the true side's colour is already held — the
 * held side being the misread one — there is no right answer to give. The 09-18 clip is exactly
 * that case, and a policy that answered anyway would record a wrong answer as a right one.
 */
export function namesTheSideInHand(session: RecordedSession): IdentityPolicy {
  const { facelets, scheme } = session.truth;
  return (ask) => {
    const colour = sideShownIn(ask.colors, facelets, scheme);
    if (colour === null) return null;
    return ask.choices.includes(colour) ? colour : null;
  };
}

/**
 * The person who names a side that is NOT the one in hand — the WRONG-ANSWER scenario.
 *
 * The first free colour that is not the right one, so it is DETERMINISTIC: a scenario that picked
 * at random would make "no configuration reports a cube that is not the cube" a claim about a seed.
 *
 * IT ABSTAINS WHERE THE TRUTH CANNOT NAME THE SIDE (Codex audit, 2026-09-25). It used to stand in
 * `-1` for "unknown", which makes every choice eligible — including the right one — so a
 * wrong-answer scenario could quietly give the RIGHT answer and still be scored as a mistake. A
 * scenario that cannot guarantee a wrong answer must give none; a caller that needs one asserts
 * `identityWrong` rather than trusting the name of this function.
 */
export function namesTheWrongSide(session: RecordedSession): IdentityPolicy {
  const { facelets, scheme } = session.truth;
  return (ask) => {
    const right = sideShownIn(ask.colors, facelets, scheme);
    if (right === null) return null;
    return ask.choices.find((c) => c !== right) ?? null;
  };
}

/** The options as the run actually uses them, every default resolved and every value checked. */
interface Replay {
  tickMs: number;
  deadlineMs: number;
  host: HTMLElement;
}

/**
 * The defaults resolved and the numbers CHECKED, before anything is mounted.
 *
 * Both of these bound the driving loop and both arrive from a caller's argument, so both can turn
 * a replay into something that looks like a result and is not. A zero or negative tick never
 * advances `elapsed` and runs for ever; a NaN compares false against the deadline and skips the
 * loop entirely, reporting a scan that was never driven as one that captured nothing; an infinite
 * deadline lets a scan that never completes run until the process is killed. Checked BEFORE the
 * panel is mounted, so a refusal cannot leave one in the document.
 */
function resolveReplay(session: RecordedSession, options: ReplayOptions): Replay {
  // THE TICK RATE, NOT THE FRAME RATE (Codex audit, 2026-09-26). A replay reproduces how often the
  // scan LOOKED, and a camera that re-serves a frame is the ordinary case — `sessionFps` counts
  // distinct frames, so a session served ten ticks per frame replayed ten times too slowly and
  // captured nothing a live scan captured.
  const rate = sessionTickRate(session);
  const tickMs = options.tickMs ?? (rate && rate > 0 ? Math.max(1, Math.round(1000 / rate)) : 60);
  if (!(Number.isFinite(tickMs) && tickMs > 0)) {
    throw new RangeError(`a replay tick of ${tickMs} ms cannot drive a scan`);
  }
  const last = session.frames[session.frames.length - 1]!;
  // From ZERO, like the replay clock, and from the last SERVING rather than the last new frame: a
  // session whose final frame was re-served for ten seconds was observed for those ten seconds.
  const deadlineMs = options.deadlineMs ?? (last.lastT ?? last.t) + 2000;
  if (!(Number.isFinite(deadlineMs) && deadlineMs > 0)) {
    throw new RangeError(`a replay deadline of ${deadlineMs} ms cannot censor anything`);
  }
  return { tickMs, deadlineMs, host: options.host ?? document.body };
}

/**
 * What a replay watched the panel do, gathered from its own events.
 *
 * Its own unit because `replaySession` was three jobs in one function — resolving options, wiring
 * listeners, and driving the clock — and the listeners are the half with state in them.
 */
class Watcher {
  readonly sides: SideOutcome[] = [];
  /** Every identity question raised, with what the policy did about it. */
  readonly identity: IdentityAnswer[] = [];
  /**
   * What a caller's policy threw, kept so the run can fail on it.
   *
   * A POLICY RUNS INSIDE A DOM LISTENER (Codex audit, 2026-09-25), so a throw from it never
   * reaches the promise `replaySession` returns: the record stays `answered: null` and a broken
   * policy is indistinguishable from a person who did not look — silently turning a
   * correct-answer scenario into a no-answer one and scoring it as a result.
   */
  policyError: unknown = null;
  /**
   * Whether the policy threw at all — a FLAG, because `policyError` cannot answer it.
   *
   * `throw null` and `throw undefined` are legal, so testing the error against null read a thrown
   * null as "no policy ran" and handed back a run scored as unanswered (the verifier caught this in
   * the first version of this guard). What is being asked is "did it throw", and only a flag says.
   */
  policyThrew = false;
  reported: string | null = null;
  completed = false;
  /** When the cube was reported, or null for a scan that did not finish (§6, item 2). */
  completedAt: number | null = null;
  looksAsked = 0;
  private confirming = false;
  /** The question standing right now, as `colors.join()` — so one question is recorded once. */
  /** The id of the question already recorded, or null. See `onIdentity`. */
  private asking: number | null = null;

  constructor(
    panel: AiScanPanel,
    /** The replay's elapsed milliseconds AT THE MOMENT the event fires — see `replaySession`. */
    private readonly at: () => number,
    /** What the person does about an identity question; absent means nobody is there to answer. */
    policy: IdentityPolicy | undefined,
    /** The session's independently entered truth — what decides whether an answer was right. */
    truth: string,
    /** Which arrangement that truth is written for, when the recorder knew it; both are tried
     *  otherwise, and an answer is scored only where they agree (`sideShownIn`). */
    scheme: Scheme | undefined,
  ) {
    panel.addEventListener('scan-capture', (e) => {
      const detail = (e as CustomEvent<ScanCapture>).detail;
      // EVERY FILING, WITH ITS KIND. A confirm or a re-shown side is a filing too, and this list is
      // a log of them rather than a set of sides: `observationsOf` in `session-metrics.ts` is the
      // one place that turns filings into one observation per face. Dropping a re-look here instead
      // would throw away when the side was actually settled, which is the number being measured.
      this.sides.push({ face: detail.face, kind: detail.kind, capturedAt: this.at() });
    });
    panel.addEventListener('scan-progress', (e) => {
      const detail = (e as CustomEvent<ScanProgress>).detail;
      // A LOOK IS AN EDGE, NOT A STATE. `confirm` stays set for every report while the scan waits,
      // so counting reports would count one request a hundred times and make "looks asked" a
      // measure of how long the wait was. The transition from no-request to request is the ask.
      const asking = detail.confirm !== null;
      if (asking && !this.confirming) this.looksAsked += 1;
      this.confirming = asking;
      this.onIdentity(panel, detail.identity, policy, truth, scheme);
    });
    panel.addEventListener('scan-complete', (e) => {
      this.reported = (e as CustomEvent<{ facelets: string }>).detail.facelets;
      this.completed = true;
      this.completedAt = this.at();
    });
  }

  /**
   * One report's identity question: record it once, and let the policy act.
   *
   * KEYED ON THE QUESTION'S ID, not on "a question is open" and not on its capture. The question
   * rides on EVERY report while it stands — that is what a pinned question is — so counting reports
   * would make one question look like a hundred, the same mistake `looksAsked` avoids one line
   * above.
   *
   * IT USED TO KEY ON THE COLOURS, and that stopped being the identity of a question on 2026-09-25,
   * when the panel began preserving a question across a re-settle of the same side while REPLACING
   * its capture (`openIdentity`). One flickering sticker then read as a second question here: the
   * count was inflated and the policy was asked to answer again, for a question the panel considers
   * unchanged and whose earlier answer it would refuse as stale (Codex audit, 2026-09-26).
   *
   * THE POLICY RUNS ONCE PER QUESTION, for the same reason and one more: `answerIdentity` reports,
   * so the listener re-enters here inside the call. Recording before acting is what makes that
   * re-entry see a question it already knows about.
   */
  private onIdentity(
    panel: AiScanPanel,
    ask: IdentityRequest | null,
    policy: IdentityPolicy | undefined,
    truth: string,
    scheme: Scheme | undefined,
  ): void {
    if (!ask) {
      this.asking = null;
      return;
    }
    if (ask.id === this.asking) return;
    this.asking = ask.id;
    const record: IdentityAnswer = {
      askedAt: this.at(),
      claimed: ask.claimed,
      choices: [...ask.choices],
      answered: null,
      right: null,
    };
    this.identity.push(record);
    if (!policy) return;
    let said: number | 'skip' | null;
    try {
      said = policy(ask);
    } catch (err) {
      // Kept rather than rethrown here: this is a listener, and a throw from one is swallowed by
      // the dispatch. `replaySession` fails on it once the drive loop is out of the way, so the
      // panel is unmounted first and the failure still reaches the caller.
      this.policyError = err;
      this.policyThrew = true;
      return;
    }
    record.answered = said;
    if (said === 'skip') {
      panel.skipIdentity();
      return;
    }
    if (said === null) return;
    // WAS IT RIGHT? Asked of the TRUTH and of the capture's own eight — never of the scanner, whose
    // reading is the thing being measured. Null is "the truth could not say", which is not a wrong
    // answer: two sides of one cube can share their eight exactly.
    const shown = sideShownIn(ask.colors, truth, scheme);
    record.right = shown === null ? null : shown === said;
    panel.answerIdentity(said);
  }
}

/**
 * Drive the clock one tick at a time until the deadline or until the scan finishes.
 *
 * Its own unit since 2026-09-25 — `replaySession` was 83 lines at complexity 13, doing option
 * normalisation, DOM lifecycle, event aggregation, clock driving and result construction. This is
 * the clock-driving third, and it is the only part with a loop in it.
 *
 * THE STEP IS CLIPPED TO THE DEADLINE, or the last tick overshoots it and a scan can complete after
 * the time every uncaptured side is censored at — a completion the numbers do not admit.
 */
async function drive(run: {
  tickMs: number;
  deadlineMs: number;
  advance: (ms: number) => Promise<void>;
  realNow?: () => number;
  done: () => boolean;
  spent: (step: number) => void;
  blockingMs: number[];
}): Promise<void> {
  let elapsed = 0;
  while (elapsed < run.deadlineMs && !run.done()) {
    const step = Math.min(run.tickMs, run.deadlineMs - elapsed);
    elapsed += step;
    run.spent(step);
    const before = run.realNow?.();
    await run.advance(step);
    if (before !== undefined && run.realNow) run.blockingMs.push(run.realNow() - before);
  }
}

/**
 * Replay one recorded session and report how it went.
 *
 * The panel is driven headless: the host draws from `scan-progress`, so nothing here depends on
 * layout, and a corpus run is not a rendering benchmark.
 */
export async function replaySession(
  session: RecordedSession,
  options: ReplayOptions,
): Promise<SessionOutcome> {
  const { tickMs, deadlineMs, host } = resolveReplay(session, options);
  // A SUPPLIED DETECTOR USED TO SWALLOW A SUPPLIED RESOLVER (Codex audit, 2026-09-25). A caller
  // passes its own detector to read `served` afterwards, and passing `pixels` alongside it then did
  // nothing at all: `pixelsAvailable` came back false and every pixel-dependent path was skipped in
  // a harness whose purpose is to exercise the pipeline — the exact silent gap the resolver's own
  // comment exists to prevent. Refused, loudly, rather than honoured halfway.
  //
  // BEFORE THE PANEL IS MOUNTED, like `resolveReplay`'s own checks and for its reason: a refusal
  // thrown after the mount leaves a dead panel in the document, and a corpus run would accumulate
  // one per refused call (the verifier caught this in the first version of the guard).
  if (options.detector && options.pixels) {
    throw new RangeError(
      'a replay given its own detector must carry the pixel resolver on that detector, not in `pixels`',
    );
  }

  const panel = new AiScanPanel();
  panel.setAttribute('headless', '');
  // THE CADENCE THE OPTION NAMES, ACTUALLY DELIVERED. The panel schedules its own ticks at
  // `tickFloorMs`, so advancing faked timers in batches of `tickMs` used to change only how much
  // simulated time passed per batch while inference went on happening every 60 ms — `tickMs: 60`
  // and `tickMs: 240` ran the identical scan. The cadence sweep is the harness's whole reason for
  // existing (T1: the stillness gate's required run length is a function of the frame rate).
  panel.tickFloorMs = tickMs;
  host.appendChild(panel);

  const blockingMs: number[] = [];
  let elapsed = 0;
  // THE CLOCK THE PANEL ITSELF READS, ZEROED HERE. A listener fires DURING `advance`, and the
  // driving loop's own counter has already been moved to the end of that batch by then — so every
  // capture was stamped at the batch's endpoint, and a capture that really happened at 1,060 ms
  // was reported as 1,200 ms with 240 ms batches. Reading the faked clock inside the listener is
  // the only thing that gives the instant rather than the interval.
  const clock = options.clock ?? ((): number => performance.now());
  const origin = clock();
  // …and if that clock does not move, say so instead of reporting every capture at zero. A caller
  // whose `advance` fakes timers without faking `performance` would otherwise get a table of
  // identical timestamps that looks like an instantaneous scan.
  let moved = false;
  const at = (): number => {
    const now = clock() - origin;
    if (now > 0) moved = true;
    return now;
  };
  const watcher = new Watcher(
    panel,
    at,
    options.answerIdentity,
    session.truth.facelets,
    session.truth.scheme,
  );
  const detector = options.detector ?? new RecordedDetector(session, at, options.pixels);
  detector.clock = at;

  // A `try`/`finally` around everything that runs with the panel mounted: a throw from `start()`
  // or from the caller's `advance` would otherwise leave it in the document with its detector still
  // held, and a corpus run would accumulate one dead panel per session that failed.
  try {
    panel.useDetector(detector, 'native');
    await panel.start();

    await drive({
      tickMs,
      deadlineMs,
      advance: options.advance,
      realNow: options.realNow,
      done: () => watcher.completed,
      spent: (step) => {
        elapsed += step;
      },
      blockingMs,
    });
  } finally {
    panel.remove();
  }

  // A BROKEN POLICY IS A BROKEN RUN, said before any number is handed back: a scenario whose person
  // threw answered nothing, and reporting that as "nobody answered" would score it as a result.
  if (watcher.policyThrew) {
    throw new Error(`the replay's identity policy threw: ${String(watcher.policyError)}`, {
      cause: watcher.policyError,
    });
  }
  if (elapsed > 0 && !moved) {
    throw new Error(
      'the replay clock never advanced: `advance` must move the clock the panel reads, or pass `clock`',
    );
  }

  return {
    sessionId: session.id,
    cube: session.cube,
    deadlineMs,
    completed: watcher.completed,
    completedAt: watcher.completedAt,
    reported: watcher.reported,
    truth: session.truth.facelets,
    sides: watcher.sides,
    looksAsked: watcher.looksAsked,
    identity: watcher.identity,
    blockingMs,
    pixelsAvailable: detector.pixelsAvailable,
  };
}
