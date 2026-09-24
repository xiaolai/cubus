// @vitest-environment happy-dom
//
// The panel's capture-and-refusal policy, driven through the real element with a fake Detector
// and fake timers. The claims under test are the ones the scan screen's whole UX now rests on:
//
//   - a refusal KEEPS the six captures — restart() is the only thing that wipes a scan;
//   - the explanation of a refusal is a pinned `notice` that survives later ticks, instead of a
//     one-tick message the next camera hint overwrites;
//   - a confirmation that reads one sticker differently is still a usable rotation measurement
//     (the exact-match behaviour blamed the user's hold and, twice over, threw the scan away);
//   - with all six sides in, re-showing a side replaces its reading;
//   - a mis-held confirmation can cost looks but can never produce a wrong cube.
import Cube from 'cubejs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiScanResult, ColorFace } from '../src/ai-assemble.js';
import { rotateFace } from '../src/ai-assemble.js';
import type { CameraDevice, CameraOptions } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import { SOLVED_FACELETS } from '../src/facelet-cube.js';
import {
  adjacentIn,
  colourOf,
  colourOfSlot,
  holdOffset,
  positionOf,
  SCHEMES,
  type Scheme,
  slotOf,
} from '../src/scheme.js';
import { FACES, type Face, type Frame } from '../src/types.js';
import {
  AiScanPanel,
  classifyRefusal,
  type ScanCapture,
  type ScanNotice,
  type ScanProgress,
  seenIn,
  sideClaimed,
} from '../view/ai-scan-panel.js';
import { InferenceWorkerLostError } from '../view/inference-client.js';
import {
  handleMisreadRequest,
  type MisreadReply,
  type MisreadRequest,
} from '../view/misread-protocol.js';
import { CUBE_VISION, NativeDetector } from '../view/native-detector.js';
import { type ScanTrace, TRACE_KEY } from '../view/scan-trace.js';

// A SEAM ON THE ONE CALL THAT COSTS SECONDS, and a pass-through in every other respect.
//
// "The misread decode does not run on the calling thread" is otherwise unfalsifiable from outside
// the element: a refusal that decoded and threw the answer away paints exactly like one that never
// decoded at all — it just takes up to three seconds longer, which no assertion about the DOM can
// see. Counting the calls is the only way to state it, so the count is what is asserted.
const seam = vi.hoisted(() => ({
  decodes: 0,
  /**
   * A scripted assembler for ONE test, or null for the real one. The panel's reread adoption is
   * pinned against a script ("a reread adopts the look the assembler NAMED"), because the
   * reachable case needs a second look that is legal yet past tolerance from the first — a legal
   * cube one face away — which a search over 400 scrambles at random holds did not produce.
   */
  assembler: null as null | ((...args: unknown[]) => unknown),
}));
vi.mock('../src/ai-assemble.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai-assemble.js')>();
  return {
    ...actual,
    assembleColors: (...args: Parameters<typeof actual.assembleColors>) =>
      seam.assembler
        ? (seam.assembler(...args) as ReturnType<typeof actual.assembleColors>)
        : actual.assembleColors(...args),
  };
});
vi.mock('../src/misread-decode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/misread-decode.js')>();
  return {
    ...actual,
    diagnoseMisread: (...args: Parameters<typeof actual.diagnoseMisread>) => {
      seam.decodes++;
      return actual.diagnoseMisread(...args);
    },
    // The camera path's entry since ADR 0001 — one refusal, one decode as the panel counts them,
    // however many schemes the decoder walks inside.
    diagnoseAcrossSchemes: (...args: Parameters<typeof actual.diagnoseAcrossSchemes>) => {
      seam.decodes++;
      return actual.diagnoseAcrossSchemes(...args);
    },
  };
});

/**
 * A `Worker` that stays on this thread but answers with the code the real one runs.
 *
 * happy-dom has no `Worker`, so every other test in this file exercises the synchronous fallback —
 * which is the right default here and is why nothing else had to change. These install this to
 * take the other branch.
 */
class FakeWorker {
  static built: FakeWorker[] = [];
  static last(): FakeWorker {
    const w = FakeWorker.built[FakeWorker.built.length - 1];
    if (!w) throw new Error('the panel never built a worker');
    return w;
  }
  posted: MisreadRequest[] = [];
  private listeners: ((ev: unknown) => void)[] = [];
  constructor(readonly url: URL) {
    FakeWorker.built.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    if (type === 'message') this.listeners.push(fn);
  }
  postMessage(message: MisreadRequest): void {
    this.posted.push(structuredClone(message));
  }
  terminate(): void {}
  /** Deliver the answer to a posted request, whenever the test decides it lands. */
  answer(index = 0): void {
    const request = this.posted[index];
    if (!request) throw new Error(`nothing posted at ${index}`);
    this.deliver(structuredClone(handleMisreadRequest(request)));
  }
  /** Deliver a reply the test wrote itself — for the answers a real decode gives rarely. */
  deliver(reply: MisreadReply): void {
    for (const fn of this.listeners) fn({ data: reply });
  }
}

/** Put a worker on this page for the duration of one test. */
function withWorker(): void {
  FakeWorker.built = [];
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
}

const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
// TICK_FLOOR_MS. The cadence follows the runtime now — `max(60, last inference ms)` — and the fake
// detector answers instantly under fake timers, so every tick here lands on the floor.
/** A deeply scrambled cube: every side a mix, so a read of one cannot be mistaken for another. */
const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

/** `t` as a detection of a picture that size — what the native runtime reports alongside its boxes. */
const inPicture = (t: ModelOutput, width = 640, height = 480): ModelOutput => ({
  ...t,
  picture: { width, height },
});

/** `t` as a detection whose FRAME is a picture that size — the browser runtime's shape, pixels and all. */
const inFrame = (t: ModelOutput, width: number, height: number): ModelOutput => ({
  ...t,
  frame: { width, height, data: new Uint8ClampedArray(width * height * 4) },
});

/** A side with two of its stickers swapped: a reading no cube can have, for the refusal path. */
function malformed(colors: readonly number[]): number[] {
  const bad = [...colors];
  const other = [1, 2, 3, 5, 6, 7, 8].find((k) => bad[k] !== bad[0])!;
  [bad[0], bad[other]] = [bad[other]!, bad[0]!];
  return bad;
}

const TICK = 60;
/**
 * Ticks a face must be held for before it is captured, at the floor cadence.
 *
 * Both halves of the stillness gate, worked out rather than guessed: reads land at 60, 120, … so
 * on tick k the run is k reads old and (k-1)*60 ms old. STABLE=3 is satisfied at k=3; STABLE_MS=500
 * needs (k-1)*60 >= 500, i.e. k >= 9.34, so k=10 is the first tick that satisfies both. Advancing
 * EXACTLY this far is what lets `show()` stop feeding the face on the tick it is captured — a
 * generous over-advance leaves further ticks re-reading a side that is already filed, and the last
 * message is then "hold still" rather than the capture.
 */
const SETTLE_TICKS = 10;
const CHECK = 400; // > CHECK_BEAT_MS, enough to fire the deferred assembly

/** A facelet string → per-face 9 colour classes, canonical rotation. */
function facesOf(facelets: string): Record<Face, number[]> {
  const out = {} as Record<Face, number[]>;
  FACES.forEach((face, fi) => {
    out[face] = [...facelets.slice(fi * 9, fi * 9 + 9)].map((l) => LETTER_CLASS[l as Face]!);
  });
  return out;
}

/** Encode 9 colour classes as a raw detector output tensor laid out as a clean 3x3 grid. */
function tensorFor(colors: number[]): ModelOutput {
  const anchors = 9;
  const data = new Float32Array((4 + 6) * anchors);
  for (let a = 0; a < anchors; a++) {
    data[0 * anchors + a] = 100 + (a % 3) * 45; // cx
    data[1 * anchors + a] = 100 + Math.floor(a / 3) * 45; // cy
    data[2 * anchors + a] = 30; // w
    data[3 * anchors + a] = 30; // h
    data[(4 + colors[a]!) * anchors + a] = 0.9;
  }
  return { data, anchors, rows: 4 + 6 };
}

/** A frame with nothing on it — decodes to zero detections, i.e. a NO_FACE abstention. */
const emptyTensor = (): ModelOutput => ({
  data: new Float32Array((4 + 6) * 9),
  anchors: 9,
  rows: 4 + 6,
});

class FakeDetector implements Detector {
  device: CameraDevice | null = null;
  output: ModelOutput | null = null;
  /** Set to a pending promise to hold `use()` open — the only way to overlap two start()s. */
  hold: Promise<void> | null = null;
  /**
   * Deliberately does NOT abort a pending open when a later one starts.
   *
   * `WebDetector` does, which is why the shared-detector race is invisible through it — but that
   * is one implementation's courtesy, not the `Detector` contract, and `NativeDetector` has no
   * abort at all. A fake that is kinder than the weakest real implementation cannot catch the
   * bug, so this one is deliberately the weakest: the last `use()` to SETTLE wins.
   */
  async use(opts?: CameraOptions): Promise<void> {
    this.uses.push(opts);
    const gate = this.hold;
    if (gate) await gate;
    if (this.openError) throw this.openError;
    if (this.openFails === 'always') throw new Error('camera denied');
    if (this.openFails === 'pinned' && opts?.deviceId) throw new Error('that camera is gone');
    this.device = { deviceId: opts?.deviceId ?? 'fake', label: 'Fake Camera' };
  }
  /** A specific rejection from `use()` — the four DOMExceptions getUserMedia actually throws. */
  openError: Error | null = null;
  /** Set to a never-settling promise to model a model download that stalls. */
  loadHold: Promise<void> | null = null;
  async load(): Promise<void> {
    if (this.loadHold) await this.loadHold;
  }
  /** Set to make every `next()` throw — a model that failed to load, or a malformed tensor. */
  failWith: Error | null = null;
  /**
   * Set to a never-settling promise to model an inference that is LOST rather than slow.
   *
   * Not the same fake as `failWith`, and the difference is the point: a rejection is something the
   * loop can see, and a promise that never settles is not. It is what a native plugin call dropped
   * on the bridge, or a runtime worker that died mid-run, looks like from here.
   */
  nextHold: Promise<void> | null = null;
  /** Every `use()` call, so a test can see whether the pinned deviceId was dropped on retry. */
  uses: (CameraOptions | undefined)[] = [];
  /** Make `use()` throw — always, or only when a deviceId is pinned (an unplugged webcam). */
  openFails: 'never' | 'always' | 'pinned' = 'never';
  async next(): Promise<ModelOutput | null> {
    if (this.nextHold) await this.nextHold;
    if (this.failWith) throw this.failWith;
    return this.output;
  }
  /**
   * The frames this detector will hand over by id, as `NativeDetector.framePixels` does (D7).
   *
   * Absent entirely by default, which is how a runtime that cannot supply pixels behaves — and how
   * every test written before D7 must go on behaving. Set it and the detector grows the method.
   */
  pixels: Map<number, Frame> | null = null;
  /** Every id `framePixels` was asked for: the cost D7 pays is once per CAPTURED side, not per tick. */
  pixelAsks: number[] = [];
  framePixels?: (frameId: number) => Promise<Frame | null>;
  /** Hand frames over by id from here on, the way the native plugin does. */
  supplyPixels(frames: Map<number, Frame>): void {
    this.pixels = frames;
    this.framePixels = async (frameId: number) => {
      this.pixelAsks.push(frameId);
      return this.pixels?.get(frameId) ?? null;
    };
  }
  async cameras(): Promise<CameraDevice[]> {
    return this.device ? [this.device] : [];
  }
  stop(): void {
    this.device = null;
  }
}

let panel: AiScanPanel;
let fake: FakeDetector;
let events: ScanProgress[];
let completions: string[];

const last = (): ScanProgress => {
  const p = events[events.length - 1];
  if (!p) throw new Error('no scan-progress events yet');
  return p;
};

/** Hold one face in front of the fake camera until it settles, then remove it. See SETTLE_TICKS. */
async function show(colors: number[]): Promise<void> {
  fake.output = tensorFor(colors);
  await vi.advanceTimersByTimeAsync(TICK * SETTLE_TICKS);
  fake.output = null;
}

/** Show all six sides of `facelets`, each rotated by rots[i] as a user might hold it. */
async function showAll(facelets: string, rots: number[]): Promise<void> {
  const shown = facesOf(facelets);
  for (const [fi, face] of FACES.entries()) {
    await show(rotateFace(shown[face], rots[fi]!));
  }
  await vi.advanceTimersByTimeAsync(CHECK); // the deferred assembly after the sixth capture
}

/**
 * Answer every confirm request with a canonical capture of the asked side, optionally flipping
 * one sticker of the first answer (a detector misread) or mis-holding every answer by a quarter
 * turn (a user who ignores the instruction). Returns how many looks were spent.
 */
async function answerConfirms(
  facelets: string,
  opts: { flipFirst?: boolean; misHoldAll?: boolean } = {},
): Promise<number> {
  const canonical = facesOf(facelets);
  let looks = 0;
  for (let round = 0; round < 8 && last().phase === 'confirm'; round++) {
    const ask = last().confirm;
    if (!ask) break;
    // HELD AS ASKED (2026-09-20): the canonical capture turned by the hold's offset. Answering every
    // ask with the canonical capture was a mis-hold whenever the asked `up` was not the canonical
    // top — which never happened while a slot was looked at once, and happens on a second look.
    const offset = holdOffset(colourOfSlot(ask.face), colourOfSlot(ask.up), 'western') ?? 0;
    let colors = rotateFace([...canonical[ask.face]], offset);
    if (opts.misHoldAll) colors = rotateFace(colors, 1);
    if (opts.flipFirst && looks === 0) colors[0] = (colors[0]! + 1) % 6;
    looks++;
    await show(colors);
    await vi.advanceTimersByTimeAsync(CHECK);
  }
  return looks;
}

beforeEach(async () => {
  // `performance` is faked alongside the defaults, because the stillness gate measures elapsed
  // time with `performance.now()` — a monotonic clock, since "held still for 500 ms" is a claim
  // about elapsed time and `Date.now()` follows an NTP correction. Vitest's default `toFake` list
  // does not include it, so without this the gate reads a clock these tests never advance and no
  // side is ever captured. Faking it is also the more faithful harness: the test now drives the
  // same clock the panel reads.
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
  fake = new FakeDetector();
  events = [];
  completions = [];
  // Constructed directly: under fake timers, happy-dom's createElement() hands back a plain
  // HTMLElement instead of upgrading to the registered class.
  panel = new AiScanPanel();
  panel.setAttribute('headless', '');
  document.body.appendChild(panel);
  panel.useDetector(fake, 'web');
  panel.addEventListener('scan-progress', (e) => {
    events.push((e as CustomEvent<ScanProgress>).detail);
  });
  panel.addEventListener('scan-complete', (e) => {
    completions.push((e as CustomEvent<{ facelets: string }>).detail.facelets);
  });
  await panel.start();
});

afterEach(() => {
  panel.remove(); // disconnectedCallback stops the loop and the fake camera
  vi.useRealTimers();
  (globalThis as { Worker?: unknown }).Worker = undefined;
  FakeWorker.built = [];
});

/**
 * A frame like the ones the blue-logo cube actually produced: a few stickers well above the floor
 * and the rest of the face scored under it, so nothing fits.
 *
 * Built from the recording of 2026-09-23, where across 1,177 stuck ticks the most boxes surviving
 * isolation was eight and the median was five — and NO confidence floor from 0.25 down to 0.08
 * yielded a single readable face.
 */
function unreadableTensor(): ModelOutput {
  const anchors = 9;
  const data = new Float32Array((4 + 6) * anchors);
  for (let a = 0; a < anchors; a++) {
    data[0 * anchors + a] = 100 + (a % 3) * 45;
    data[1 * anchors + a] = 100 + Math.floor(a / 3) * 45;
    data[2 * anchors + a] = 30;
    data[3 * anchors + a] = 30;
    // Three stickers the scan can keep, six it cannot — the shape the real cube produced.
    data[(4 + 0) * anchors + a] = a < 3 ? 0.9 : 0.15;
  }
  return { data, anchors, rows: 4 + 6 };
}

describe('ai-scan-panel — a scan that reads nothing stops asking for patience', () => {
  // MEASURED, on a cube this actually happened to: 108 seconds, 1,552 frames, ZERO captures, and
  // "hold still" on screen throughout. The detector found two or three of the face's nine stickers,
  // and no threshold recovers the rest — so the fix is not another way to arbitrate readings that do
  // not exist, it is to stop spending the person's time.

  it('says the cube is not being read, and offers painting, once the bound passes', async () => {
    fake.output = unreadableTensor();
    // Well inside the bound: still the ordinary idle line, because a scan that has barely begun is
    // not stuck and saying so would be wrong far more often than right.
    await vi.advanceTimersByTimeAsync(3000);
    expect(last().message).not.toMatch(/isn.t being read/i);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(last().message).toMatch(/isn.t being read/i);
    expect(last().message.toLowerCase()).toContain('paint');
    // And nothing was captured on the way — the point is that this fires WITHOUT a capture.
    expect(last().captured).toHaveLength(0);
  });

  it('never fires while a scan is making progress', async () => {
    // THE DIFFERENCE BETWEEN MEASURING PROGRESS AND MEASURING TIME. This scan runs far longer than
    // the bound in total, but never goes longer than the bound WITHOUT a capture — so it must stay
    // quiet throughout. A clock that ran from the start of the scan instead of from the last
    // capture would interrupt a working scan of a slow cube, which is the failure this guards.
    const shown = facesOf(DEEP);
    let elapsed = 0;
    for (const face of FACES.slice(0, 3)) {
      await show(shown[face]);
      // Long enough that the total passes the bound several times over, short enough that no single
      // gap between captures does.
      fake.output = unreadableTensor();
      await vi.advanceTimersByTimeAsync(8_000);
      elapsed += 8_000;
      expect(last().message, `after ${elapsed} ms of scanning, still making progress`).not.toMatch(
        /isn.t being read/i,
      );
    }
    expect(elapsed).toBeGreaterThan(20_000);
  });

  it('keeps quiet when there is nothing in front of the camera', async () => {
    // An empty frame is not a stall, it is an empty frame. Without this the same sentence fires at
    // an empty room and tells someone who put the cube down that their cube cannot be read.
    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(last().message).not.toMatch(/isn.t being read/i);
  });

  it('retracts nothing on a frame or two of nothing, but stops once the cube is put down', async () => {
    fake.output = unreadableTensor();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(last().message).toMatch(/isn.t being read/i);
    // The cube is put down: the claim stops, because there is no longer a cube to make it about.
    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(last().message).not.toMatch(/isn.t being read/i);
  });

  it('says something different about a cube than about a side', async () => {
    // Nothing captured is a statement about the CUBE. With sides already in, the same sentence
    // would be false — and discouraging about a scan that is largely done.
    fake.output = unreadableTensor();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(last().message).toContain('This cube');
  });
});

describe('ai-scan-panel — capture and settle', () => {
  // A deep scramble reads uniquely, so six sides held any way up settle with no extra look.

  it('captures six sides held any way up and completes with the true cube', async () => {
    await showAll(DEEP, [1, 2, 3, 0, 1, 2]);
    expect(completions).toEqual([DEEP]);
    expect(last().phase).toBe('done');
    // The camera is released on done, so a host stops showing a live lens.
    expect(last().device).toBeNull();
  });

  it('settles its captures into canonical rotation, so a later click means the sticker it shows', async () => {
    await showAll(DEEP, [1, 2, 3, 0, 1, 2]);
    const canonical = facesOf(DEEP);
    for (const c of last().captured) {
      expect(c.colors).toEqual(canonical[c.face]);
    }
  });

  it('a face is not captured until it has been still for both 3 reads and 500 ms', async () => {
    fake.output = tensorFor(facesOf(DEEP).U);
    // Nine reads at the floor cadence: the count is long satisfied and the clock is 480 ms — which
    // is the half that decides. With the tick following the runtime rather than pinned at 200 ms,
    // it is the CLOCK that gates on every machine and the count is only a floor.
    await vi.advanceTimersByTimeAsync(TICK * (SETTLE_TICKS - 1));
    expect(last().captured).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().captured).toHaveLength(1);
  });
});

describe('ai-scan-panel — a refusal keeps the captures', () => {
  const TRUTH = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();
  /** What the misread sticker (Front side, index 0) really is on TRUTH. */
  const F_TRUE = facesOf(TRUTH).F[0]!;

  /** Scan all six sides with one sticker of the Front side misread. */
  async function scanWithMisread(): Promise<number[]> {
    const shown = facesOf(TRUTH);
    const bad = [...shown.F];
    bad[0] = (bad[0]! + 1) % 6; // one flipped sticker — the classic red/orange misread
    for (const face of FACES) {
      await show(face === 'F' ? bad : shown[face]);
    }
    await vi.advanceTimersByTimeAsync(CHECK);
    return bad;
  }

  it('refuses without wiping, marks the suspect sticker, and pins the explanation', async () => {
    await scanWithMisread();
    expect(completions).toEqual([]);
    const p = last();
    expect(p.captured).toHaveLength(6); // the user's work survives the refusal
    expect(p.notice?.title).toMatch(/check the marked sticker/i);
    expect(p.suspects).toContainEqual({ face: 'F', index: 0, to: F_TRUE });
    // The pin: a later tick's transient hint must not erase the notice — and with all six sides
    // in, the idle line offers a re-read, not "show any side" (there is no side left to show).
    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(TICK);
    fake.output = null;
    expect(last().message).toMatch(/re-read/);
    expect(last().notice?.title).toMatch(/check the marked sticker/i);
    expect(last().captured).toHaveLength(6);
  });

  it('the marked sticker is offered for checking, never asserted to be wrong', async () => {
    // A decoded distance of 1 says the READING is one change from legal. It does not say one
    // sticker was misread: a reading two stickers from your cube can sit one from a legal cube you
    // never held, and the decoder then names — uniquely, unanswerably — a sticker you read
    // correctly. `ai-assemble.test.ts` measures exactly that pair of cubes.
    //
    // No code can tell the two cases apart, so the copy carries the difference. Both halves are
    // asserted: the claim that IS proven must be made, and the claim that is not must be absent.
    await scanWithMisread();
    const body = last().notice?.body ?? '';
    expect(body).toMatch(/would make this a solvable cube/i); // proven
    expect(body).toMatch(/check it against your cube/i); // and who decides
    expect(body).toMatch(/read correctly/i); // and why they have to
    // The tip that ended this notice promised a hold would settle the scan; the assembly never
    // prefers the hold a side was shown in (dev-docs/scan-guidance-plan.md §1.1).
    expect(body).not.toMatch(/settles itself|edge colours/i);
    expect(body).toMatch(/show that side again to re-read it\.$/);
    for (const claim of [
      /this sticker is wrong/i,
      // Lookbehind, because the body's own disclosure contains the phrase inside "when MORE THAN
      // one sticker is misread" — which is the opposite claim and the whole point of the sentence.
      /(?<!more than )one sticker (was|is) (misread|wrong)/i,
      /pick the right colour/i, // the app does not know the right colour, only a colour that fits
    ]) {
      expect(body).not.toMatch(claim);
    }
    expect(last().notice?.title ?? '').not.toMatch(/looks wrong/i);
  });

  it('a tapped correction on the suspect completes the scan', async () => {
    await scanWithMisread();
    panel.setSticker('F', 0, F_TRUE);
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(completions).toEqual([TRUTH]);
  });

  it('re-showing a side replaces its reading and completes the scan', async () => {
    await scanWithMisread();
    await show(facesOf(TRUTH).F); // the same side again, read right this time
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(completions).toEqual([TRUTH]);
  });

  it('restart() is the only wipe', async () => {
    await scanWithMisread();
    expect(last().captured).toHaveLength(6);
    panel.restart();
    expect(last().captured).toHaveLength(0);
  });

  // Two legal cubes are never closer than three stickers, so past ONE misread the nearest legal
  // cube need not be the user's — pointing would sometimes accuse a sticker that was read right.
  // The count is still provable, so the count is what gets said. dev-docs/misread-decoding.md.
  it('with more than one sticker wrong it states the count and accuses nothing', async () => {
    const shown = facesOf(TRUTH);
    const badF = [...shown.F];
    badF[0] = (badF[0]! + 1) % 6;
    const badR = [...shown.R];
    badR[2] = (badR[2]! + 2) % 6;
    for (const face of FACES) {
      await show(face === 'F' ? badF : face === 'R' ? badR : shown[face]);
    }
    await vi.advanceTimersByTimeAsync(CHECK);

    const p = last();
    expect(completions).toEqual([]);
    expect(p.captured).toHaveLength(6); // still never wiped
    expect(p.suspects).toEqual([]); // nothing is accused…
    expect(p.notice?.title).toBe('Some stickers were misread');
    expect(p.notice?.body).toContain('%1'); // …and the count arrives as a param, not baked in
    expect(p.notice?.params?.[0]).toBeGreaterThanOrEqual(2);
    // Never the old singular, which asserted exactly what the decoder had just ruled out.
    expect(p.notice?.body).not.toMatch(/A sticker was misread somewhere/);
    expect(p.notice?.body).not.toMatch(/Tap any sticker/);
    // With no sticker to point at, the instruction is the one the user can follow: start over,
    // with the button in the card. "Show those sides again" named sides the decoder had just
    // said it could not name, and the orientation tip was about a different problem (2026-09-06).
    expect(p.notice?.body).toMatch(
      /^At least %1 stickers do not fit a real cube — too many to tell which\. Start the scan over/,
    );
    expect(p.notice?.body).toMatch(/Show one side to the camera to re-read just that side\.$/);
    expect(p.notice?.body).not.toMatch(/Show those sides|edge colours|settles itself/);
    // What the evidence says about light is that WARM light confuses red and orange; nothing
    // measured a tilt, so "held flat" is gone (dev-docs/scan-guidance-plan.md §1.1).
    expect(p.notice?.body).toContain(
      'Start the scan over in whiter light; red and orange are the colours it confuses most.',
    );
    expect(p.notice?.body).not.toMatch(/held flat|more light/);
    expect(p.notice?.action).toEqual({ label: 'Start over', kind: 'restart' });
    // The transient line keeps the refusal's verdict and takes the notice's advice — never
    // "fix a sticker" under a notice that says start over.
    expect(p.message).toMatch(/isn't a solvable cube yet — start the scan over/);
    expect(p.message).not.toMatch(/fix a sticker/);
  });
});

describe('ai-scan-panel — confirmations', () => {
  // One turn from solved: the case six unoriented photos genuinely cannot determine.
  const ONE_TURN = new Cube().move('U').asString();

  it('asks for one more look and pins the ask as a notice', async () => {
    await showAll(ONE_TURN, [0, 0, 0, 0, 0, 0]);
    const p = last();
    expect(p.phase).toBe('confirm');
    expect(p.confirm).not.toBeNull();
    expect(p.notice?.title).toBe('One more look');
    // The body says what IS known and what is not. The old "Several readings of this cube fit
    // what the camera saw" read as a failed scan to a user whose colours were all right
    // (2026-09-06): it never said the colours were read, nor which sides were undetermined, nor
    // that the picture is the sides as held rather than one of the readings.
    expect(p.notice?.body).toMatch(
      /^Every side's colours are read\. This cube fits them (two|three|four|five|six|seven|eight|nine|ten|\d+) ways — the [A-Z]+(, [A-Z]+)* (and [A-Z]+ sides could each|side could) have been held more than one way up — and the picture shows the sides as they were held, not which of the \w+ it is\. Show the [A-Z]+ side again, with [A-Z]+ facing up\.$/,
    );
    expect(p.notice?.body).not.toMatch(/Several readings/);
    // The ask survives the cube leaving the frame — keeping its phase, and with an idle line that
    // repeats WHICH side is wanted rather than contradicting the ask with "show any side".
    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(TICK);
    fake.output = null;
    expect(last().phase).toBe('confirm');
    expect(last().notice?.title).toBe('One more look');
    expect(last().message).toMatch(/Looking for the [A-Z]+ side/);
  });

  it('recovers the true cube when the looks are answered honestly', async () => {
    await showAll(ONE_TURN, [0, 0, 0, 0, 0, 0]);
    const looks = await answerConfirms(ONE_TURN);
    expect(looks).toBeGreaterThan(0);
    expect(completions).toEqual([ONE_TURN]);
  });

  it('a confirmation with one misread sticker is still a rotation measurement, not a mis-hold', async () => {
    // The exact-match behaviour called this "held the wrong way up", asked again, and after a
    // second disagreement threw all six captures away — measured at a 2% per-sticker misread,
    // that wiped 11% of once-turned scans; at 10% it wiped two thirds.
    await showAll(ONE_TURN, [0, 0, 0, 0, 0, 0]);
    await answerConfirms(ONE_TURN, { flipFirst: true });
    expect(completions).toEqual([ONE_TURN]);
  });

  it('mis-held looks can cost the scan, never the captures, and never a wrong cube', async () => {
    await showAll(ONE_TURN, [0, 0, 0, 0, 0, 0]);
    await answerConfirms(ONE_TURN, { misHoldAll: true });
    // Refusing is fine; returning someone else's cube is not, and the board must survive.
    for (const done of completions) expect(done).toBe(ONE_TURN);
    expect(last().captured).toHaveLength(6);
  });
});

describe('ai-scan-panel — a finished scan is a state, not a moment', () => {
  it('reports complete, and a reopened camera guides instead of nagging for sides', async () => {
    await showAll(DEEP, [0, 0, 0, 0, 0, 0]);
    expect(last().phase).toBe('done');
    expect(last().complete).toBe(true);
    // Reopen the camera over the finished scan — exactly what picking a camera from the host's
    // menu does. The old state machine relaunched a hungry scan loop here and nagged "show any
    // side to the camera" over a complete cube.
    await panel.start();
    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(TICK);
    fake.output = null;
    expect(last().complete).toBe(true);
    expect(last().captured).toHaveLength(6);
    expect(last().message).toMatch(/Scan finished — start the scan over/);
  });

  it('a side held in view of a reopened camera is NOT re-captured into the accepted scan', async () => {
    await showAll(DEEP, [0, 0, 0, 0, 0, 0]);
    await panel.start();
    // The cube drifting through the frame — being picked up to solve, not to re-scan. Feed a side
    // that reads differently from what was accepted; silently replacing it would corrupt the scan.
    const changed = [...facesOf(DEEP).F];
    changed[0] = (changed[0]! + 1) % 6;
    await show(changed);
    expect(last().complete).toBe(true);
    expect(last().captured.find((c) => c.face === 'F')?.colors).toEqual(facesOf(DEEP).F);
    expect(last().message).toMatch(/already scanned/);
    expect(completions).toEqual([DEEP]); // no second, mutated delivery
  });

  it('names the last missing sides instead of only counting them', async () => {
    const shown = facesOf(DEEP);
    for (const face of ['U', 'R', 'F', 'D'] as const) await show(shown[face]);
    // Re-showing a captured side while two are missing names the two, by colour.
    await show(shown.U);
    expect(last().message).toMatch(/still need ORANGE and BLUE/);
    await show(shown.L);
    expect(last().message).toMatch(/Still to show: BLUE/);
  });
});

describe('ai-scan-panel — captures survive mode and camera changes', () => {
  it('start() — a camera switch — keeps the sides already captured', async () => {
    const shown = facesOf(DEEP);
    await show(shown.U);
    await show(shown.R);
    expect(last().captured).toHaveLength(2);
    await panel.start();
    expect(last().captured).toHaveLength(2);
  });

  it('a camera switch during the checking beat does not swallow the check', async () => {
    // THE SCAN THAT CANNOT BE FINISHED OR RECOVERED. The sixth capture stops the loop and schedules
    // the assembly one beat later; the check was guarded on the CAMERA's epoch, so anything that
    // touched the camera inside those 350 ms cancelled it and put nothing in its place. Switching
    // cameras is exactly that — and the state it leaves is a trap: six sides on screen, `complete`
    // never set, and no way back, because re-showing a side whose reading is unchanged is answered
    // with "that side reads the same as before". A check is a computation over the six faces; the
    // camera has already said everything it has to say about them.
    const shown = facesOf(DEEP);
    for (const face of FACES) await show(shown[face]);
    expect(last().captured).toHaveLength(6);
    expect(last().phase).toBe('checking');

    panel.setAttribute('device-id', 'the-other-camera');
    await panel.start(); // the host switches cameras inside the beat
    await vi.advanceTimersByTimeAsync(CHECK);

    expect(completions).toHaveLength(1);
    expect(last().complete).toBe(true);
  });

  it('a painted cube one sticker from legal marks it, and offers the colour', async () => {
    // The claim: decodeMisread's guarantee is about the COLOURING, not about who produced it, so a
    // painted cube gets the same pointing a scanned one does. Before this, painting threw the
    // diagnosis away and said "tap stickers until every colour appears nine times" — advice that
    // cannot succeed here, since these counts are already nine each.
    panel.setPainting(true);
    const truth = facesOf(DEEP);
    for (const f of FACES)
      for (let i = 0; i < 9; i++) if (i !== 4) panel.setSticker(f, i, truth[f]![i]!);

    // Now break exactly one sticker, which is the only distance a repair is unique at.
    const invalid: AiScanResult[] = [];
    panel.addEventListener('scan-invalid', (e) =>
      invalid.push((e as CustomEvent<AiScanResult>).detail),
    );
    const was = truth.U[0]!;
    panel.setSticker('U', 0, (was + 1) % 6);
    const p = last();
    expect(p.suspects).toContainEqual({ face: 'U', index: 0, to: was });
    expect(p.notice?.body ?? '').not.toMatch(/nine|count/i); // never the advice that cannot work
    // The public event is not allowed to depend on which mode the user is in. It fired for a
    // refused scan and not for a refused painting, so a host listening for it saw half the story.
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.valid).toBe(false);
  });

  it('editing an accepted painting into an invalid one takes the verdict back', async () => {
    // A finished scan is a state, and painting had no way to leave it. `scheduleCheck` clears
    // `finished` on the camera path because a capture re-decides the verdict; a paint stroke
    // re-decides it just the same and cleared everything EXCEPT that. So breaking an accepted
    // painting emitted 'scan-invalid' while still reporting complete: true, and the host's Solve
    // button stayed lit over a cube the panel had that instant refused.
    panel.setPainting(true);
    const truth = facesOf(DEEP);
    for (const f of FACES)
      for (let i = 0; i < 9; i++) if (i !== 4) panel.setSticker(f, i, truth[f]![i]!);
    expect(last().complete).toBe(true);

    const invalid: AiScanResult[] = [];
    panel.addEventListener('scan-invalid', (e) =>
      invalid.push((e as CustomEvent<AiScanResult>).detail),
    );
    panel.setSticker('U', 0, (truth.U![0]! + 1) % 6);
    expect(invalid).toHaveLength(1);
    expect(last().complete).toBe(false); // refused and complete cannot both be true

    // And putting it back re-accepts it, so the flag is a state and not a one-way door.
    panel.setSticker('U', 0, truth.U![0]!);
    expect(last().complete).toBe(true);
  });

  it('states only what the decoder proves when more than one sticker is wrong', async () => {
    // The wording bug duplication caused: painting claimed "more than one wrong sticker has more
    // than one possible repair", which is stronger than anything proved. The guarantee is that
    // above distance one the nearest legal cube need not be the USER'S — a given input may still
    // have a unique nearest repair. Both modes share one sentence now, so they cannot drift again.
    panel.setPainting(true);
    const truth = facesOf(DEEP);
    for (const f of FACES)
      for (let i = 0; i < 9; i++) if (i !== 4) panel.setSticker(f, i, truth[f]![i]!);
    // Two stickers that are genuinely a different colour — swapping equal ones is a no-op, and
    // setSticker returns early on it, which is how this test first passed while changing nothing.
    const a = truth.U![0]!;
    panel.setSticker('U', 0, (a + 1) % 6);
    panel.setSticker('U', 1, (truth.U![1]! + 1) % 6); // two wrong: nothing may be accused
    const p = last();
    expect(p.suspects).toEqual([]);
    expect(p.notice?.body ?? '').toMatch(/no single sticker to point at/);
    expect(p.notice?.body ?? '').not.toMatch(/more than one possible repair/);
    expect(p.notice?.params?.[0]).toBeGreaterThanOrEqual(2); // the count rides in params, not the string
  });

  it('a scan loop that keeps failing says so instead of looping in silence', async () => {
    // The blanket `catch {}` here commented that it was the camera warming up, and swallowed
    // everything: a model that failed to load, a malformed native tensor, a post-processing defect.
    // The scanner looped forever showing "hold still" and the fail-loud rule was suspended for the
    // app's most important surface. The distinction is DURATION, not exception type.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.failWith = new Error('malformed tensor');
    await vi.advanceTimersByTimeAsync(TICK * 3); // under TICK_FAIL_MS: still patient
    expect(last().phase).not.toBe('error');
    await vi.advanceTimersByTimeAsync(3000); // past it: now it must speak
    expect(last().phase).toBe('error');
    // The cause must survive somewhere. The notice tells the user what to do; only this carries
    // the underlying error to whoever has to fix it.
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0]?.[1] ?? '')).toMatch(/malformed tensor/);
    logged.mockRestore();
    expect(last().notice?.title ?? '').toMatch(/stopped/i);
    // And it stopped: a loop that keeps throwing must not keep throwing.
    const after = events.length;
    await vi.advanceTimersByTimeAsync(TICK * 5);
    expect(events.length).toBe(after);
  });

  it('a tick that ANSWERS and then cannot be read still reaches the fatal threshold', async () => {
    // THE CLOCK WAS CLEARED BEFORE THE FRAME WAS PROCESSED. `next()` resolving was treated as the
    // whole of a healthy tick, so the failure clock was reset and only THEN was the frame decoded
    // — and `readFrame` is where the post-processing tail lives, which throws on a head with the
    // wrong row count and on a native tensor that disagrees with its own header. Every such frame
    // therefore started a FRESH failure run, so a scanner throwing on every single frame never
    // reached TICK_FAIL_MS: it reported a transient error forever, over a working camera. The one
    // failure with no way out was the one the fatal threshold exists for. Existing coverage only
    // ever rejected `next()`, which never reaches the reset at all.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A tensor the detector HANDS BACK happily, and that post-processing refuses: nine rows, not
    // the ten a six-class detect head produces.
    fake.output = { data: new Float32Array(9 * 9), anchors: 9, rows: 9 };
    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(last().phase).not.toBe('error'); // still patient, as for any other transient
    await vi.advanceTimersByTimeAsync(3000);
    expect(last().phase).toBe('error');
    expect(last().notice?.title ?? '').toMatch(/stopped/i);
    expect(String(logged.mock.calls[0]?.[1] ?? '')).toMatch(/9 rows/);
    logged.mockRestore();
  });

  it('a brief camera hiccup is still forgiven, and forgotten once a tick succeeds', async () => {
    // The other half of the same claim: if this were a plain counter the transient case would
    // eventually trip it too, and the fix would have traded a silent failure for a false alarm.
    //
    // The gap between the two hiccups is deliberately LONGER than TICK_FAIL_MS. It used to be
    // 400 ms, and with a total elapsed time under 3 s this test could not fail however stale the
    // failure clock was — while the clock was only ever cleared where a BRAND NEW face was filed,
    // so an abstaining tick like this one left it standing. A healthy minute of scanning followed
    // by one hiccup then read as three seconds of solid failure and killed the scanner.
    fake.failWith = new Error('camera not ready');
    await vi.advanceTimersByTimeAsync(TICK * 4);
    fake.failWith = null;
    fake.output = emptyTensor(); // healthy, but abstaining — no face, nothing captured
    await vi.advanceTimersByTimeAsync(10_000);
    expect(last().phase).not.toBe('error');
    fake.failWith = new Error('camera not ready again');
    await vi.advanceTimersByTimeAsync(TICK * 4); // the clock restarted at the healthy tick
    expect(last().phase).not.toBe('error');
  });

  it('a frame that never arrives is not a cube held still', async () => {
    // `output === null` means the camera has opened but produced no frame. An ABSTAINING frame
    // already reset the streak; a MISSING one did not, so identical reads either side of a stall
    // satisfied both the count and the duration with nothing observed in between — the one thing
    // the duration half of the gate exists to refuse.
    const shown = facesOf(DEEP);
    fake.output = tensorFor(shown.U);
    await vi.advanceTimersByTimeAsync(TICK * (SETTLE_TICKS - 1)); // one tick short of settling
    expect(last().captured).toHaveLength(0);
    fake.output = null; // the camera stalls
    await vi.advanceTimersByTimeAsync(TICK);
    fake.output = tensorFor(shown.U); // the same read comes back
    await vi.advanceTimersByTimeAsync(TICK * (SETTLE_TICKS - 1));
    // The run restarted at the first read AFTER the stall, so it is 480 ms old, not 1140.
    expect(last().captured).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TICK); // and one more tick does settle it
    expect(last().captured).toHaveLength(1);
  });

  it('start() refuses while painting, and painting hides the button that would call it', async () => {
    // setPainting's own comment calls the modes "exclusive by nature, not by policy" — and nothing
    // enforced it. stop() re-revealed the Start button, so painting offered the one control that
    // could overwrite the stickers the user had just authored.
    panel.setPainting(true);
    expect(last().device).toBeNull();
    await panel.start();
    expect(last().device).toBeNull(); // no camera, whatever pressed it
    expect(last().phase).toBe('painting');
  });

  it('an element removed before its autostart fires never opens the camera', async () => {
    // connectedCallback defers start() by a microtask so a host attaching a listener in the same
    // block does not miss the first report. Remove the element in that window and the microtask
    // still ran: disconnectedCallback stopped a scan that had not begun, and then it began — on a
    // detached element, with no host and nothing to show a lens in.
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    solo.setAttribute('autostart', '');
    const det = new FakeDetector();
    solo.useDetector(det, 'web');
    document.body.appendChild(solo); // queues the autostart microtask
    solo.remove(); // ...and leaves before it runs
    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(det.device).toBeNull(); // the camera was never opened
  });

  it('a report published after stop() does not claim a live camera face', async () => {
    await show(facesOf(DEEP).U);
    expect(last().live).not.toBeNull();
    panel.setPainting(true); // calls stop(), then reports immediately
    expect(last().live).toBeNull();
  });

  it('a pinned camera that has gone away falls back, and keeps the pin', async () => {
    // A webcam unplugged, or a Continuity Camera whose phone wandered off. Dead-ending on an
    // exact-deviceId constraint that can no longer be satisfied is the worst available answer, and
    // the pin is deliberately KEPT so the preferred camera is picked up the moment it returns.
    // None of this had a test: every branch of start() except the happy path was unverified.
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    solo.setAttribute('device-id', 'the-good-one');
    const det = new FakeDetector();
    det.openFails = 'pinned';
    solo.useDetector(det, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    await solo.start();

    expect(det.uses[0]?.deviceId).toBe('the-good-one'); // asked for the pinned one first
    expect(det.uses[1]?.deviceId).toBeUndefined(); // then any camera at all
    expect(solo.getAttribute('device-id')).toBe('the-good-one'); // and the pin survives
    expect(seen.at(-1)?.device).not.toBeNull(); // a camera IS open
    solo.remove();
  });

  it('a camera that will not open at all says why, and re-offers Start', async () => {
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const det = new FakeDetector();
    det.openFails = 'always';
    solo.useDetector(det, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    await solo.start();

    const end = seen.at(-1);
    expect(end?.phase).toBe('error');
    expect(end?.device).toBeNull();
    // The message must carry the underlying reason: "cannot start" alone tells a user nothing they
    // can act on, and a denied permission and an absent device need different answers from them.
    expect(JSON.stringify(end?.message ?? '')).toMatch(/camera denied/);
    solo.remove();
  });

  it('a start superseded while opening releases the camera it opened', async () => {
    // stop() during the open bumps the generation, so the stream this attempt obtained belongs to
    // nobody. Left alone it lingers — a live camera with no panel showing it, which on a laptop is
    // an indicator light the user cannot explain.
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const det = new FakeDetector();
    solo.useDetector(det, 'web');
    document.body.appendChild(solo);
    const opening = solo.start();
    solo.stop(); // supersede it mid-flight
    await opening;
    expect(det.device).toBeNull(); // the orphaned stream was released
    solo.remove();
  });

  it('painting drops the captures whose rotation was never settled, and names them', async () => {
    // THE MODE BOUNDARY. This test used to assert the opposite — that a toggle keeps every capture
    // — and that was the bug rather than the contract. Painting edits stickers BY INDEX, and a
    // camera capture is at whatever rotation the side was held at, so index i of what is stored is
    // not the sticker the user is looking at. `assemblePainted` searches no rotations by design,
    // so it then judged a 90°-off capture as authored-in-place and invented a misread count for a
    // cube with nothing wrong with it.
    const shown = facesOf(DEEP);
    await show(shown.U);
    await show(shown.R);
    expect(last().captured).toHaveLength(2);
    panel.setPainting(true);
    expect(last().device).toBeNull();
    expect(last().captured).toHaveLength(0);
    // Named, not silently discarded: the user showed those sides and is owed the reason.
    expect(last().notice?.body ?? '').toMatch(/which way up/i);
    expect(last().notice?.params?.[0]).toMatch(/WHITE/);
    expect(last().notice?.params?.[0]).toMatch(/RED/);
  });

  it('a finished scan is settled, so painting over it keeps every side', async () => {
    // The other half, and the common path: scan, then hand-fix one sticker. `finishAccepted` turns
    // every capture into canonical rotation, so there is nothing unsettled left to drop and the
    // rule above costs the user nothing here.
    await showAll(DEEP, [1, 2, 3, 0, 1, 2]);
    expect(last().complete).toBe(true);
    panel.setPainting(true);
    expect(last().captured).toHaveLength(6);
    expect(last().notice).toBeNull();
  });

  it('a start superseded while opening does not close the camera the newer one opened', async () => {
    // The detector is ONE object shared by every attempt, so `detector.stop()` closes whatever is
    // open now — not "this attempt's camera", which does not exist. A superseded attempt tidying
    // up therefore shut off the lens a newer attempt had just been granted: reachable whenever a
    // start is superseded while it waits on a permission prompt, and invisible afterwards because
    // the panel reports a camera it no longer has.
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const det = new FakeDetector();
    solo.useDetector(det, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );

    solo.setAttribute('device-id', 'camera-A');
    let openFirst = (): void => {};
    det.hold = new Promise<void>((res) => {
      openFirst = () => res();
    });
    const first = solo.start(); // blocks inside detector.use()
    await vi.advanceTimersByTimeAsync(0);
    det.hold = null;
    solo.setAttribute('device-id', 'camera-B');
    const second = solo.start(); // supersedes it, and opens for real

    // The superseded open lands while the newer one is queued behind it. Opens are SERIALISED for
    // exactly this reason: `use()` mutates the shared detector's camera, so without a queue the
    // winner is whichever settles last rather than whichever is current, and the panel ends up
    // reporting camera-B over a detector left holding camera-A.
    openFirst();
    await Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(0);

    // WHICH camera, not merely that there is one — asserting non-nullness passes with the wrong
    // one, which is the entire failure.
    expect(det.device?.deviceId).toBe('camera-B');
    expect(seen.at(-1)?.device?.deviceId).toBe('camera-B');
    solo.remove();
  });

  it('a scanner that gave up leaves a working way back on', async () => {
    // Not headless: the notice says "Try Start again", and only a drawn panel can be wrong about
    // whether that button exists. It said it while Start was hidden — start() hides it the moment
    // the camera opens — so the one instruction the fatal path gives had nothing behind it.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const drawn = new AiScanPanel();
    const det = new FakeDetector();
    drawn.useDetector(det, 'web');
    document.body.appendChild(drawn);
    const seen: ScanProgress[] = [];
    drawn.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    await drawn.start();
    const startBtn = drawn.shadowRoot?.getElementById('start') as HTMLButtonElement;
    expect(startBtn.hidden).toBe(true); // scanning: no Start on offer

    det.failWith = new Error('malformed tensor');
    await vi.advanceTimersByTimeAsync(4000);
    expect(seen.at(-1)?.phase).toBe('error');
    expect(seen.at(-1)?.notice?.body ?? '').toMatch(/Try Start again/);
    expect(startBtn.hidden).toBe(false);
    expect(startBtn.disabled).toBe(false);
    // And the camera is released, not left live under a dead loop.
    expect(seen.at(-1)?.device).toBeNull();
    expect(det.device).toBeNull();

    // Pressing it works: the failure clock does not survive into the new loop.
    det.failWith = null;
    await drawn.start();
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(seen.at(-1)?.phase).toBe('scanning');
    logged.mockRestore();
    drawn.remove();
  });

  it('an inference that rejects after the scan ended says nothing', async () => {
    // The success path has always rejected a stale frame; the failure path did not. A `next()`
    // that rejects after stop() — or after painting is switched on — restarted the failure clock
    // and could report an error over a panel that had moved on.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Wind the failure clock up to just under TICK_FAIL_MS, so the late rejection is the one that
    // would tip it over. Anything less and the test passes with or without the guard, because a
    // first failure never reports — which is exactly how this went unnoticed.
    fake.failWith = new Error('camera not ready');
    await vi.advanceTimersByTimeAsync(2600);
    expect(last().phase).not.toBe('error');

    let failLate = (): void => {};
    fake.next = () =>
      new Promise((_res, rej) => {
        failLate = () => rej(new Error('landed too late'));
      });
    await vi.advanceTimersByTimeAsync(TICK); // one tick is now in flight
    panel.setPainting(true); // the scan is over; the camera is released
    await vi.advanceTimersByTimeAsync(1000); // now past TICK_FAIL_MS since the first failure
    const after = events.length;
    failLate();
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(events.length).toBe(after); // not one word about it
    expect(last().phase).toBe('painting');
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('ai-scan-panel — a camera that answers but never delivers', () => {
  it('gives up on a camera that is open and frameless, instead of idling forever', async () => {
    // `next()` resolving to `null` means "open, no frame yet" — genuinely transient for a tick or
    // two while a video element gets its dimensions. A camera that never delivers answers `null`
    // for as long as the screen is open, and `null` was treated as proof that the scanner works:
    // it CLEARED the failure clock. So the one failure that needs no exception to happen was the
    // one failure nothing watched, and the panel sat on "Show any side" with the lens on.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.output = null; // open, and frameless, for good
    await vi.advanceTimersByTimeAsync(TICK * 10);
    expect(last().phase).not.toBe('error'); // under TICK_FAIL_MS: still patient
    await vi.advanceTimersByTimeAsync(3000);
    expect(last().phase).toBe('error');
    // The existing copy, which was already describing this case while being unreachable from it.
    expect(last().notice?.body ?? '').toMatch(/opened but no frame could be read/i);
    expect(last().device).toBeNull(); // and the lens is off, not left on under a dead loop
    logged.mockRestore();
  });

  it('a frameless run that ends is forgotten, so one stall never kills a later scan', async () => {
    // The other half: the clock must be a claim about a RUN of frameless ticks, not a total. Its
    // neighbour clock had exactly this bug — cleared in only one branch — and a healthy minute of
    // scanning followed by one hiccup then read as three seconds of solid failure.
    const shown = facesOf(new Cube().move('R U').asString());
    fake.output = null;
    await vi.advanceTimersByTimeAsync(2900);
    fake.output = tensorFor(shown.U); // a frame arrives
    await vi.advanceTimersByTimeAsync(TICK);
    fake.output = null;
    await vi.advanceTimersByTimeAsync(2900);
    expect(last().phase).not.toBe('error');
  });
});

describe('ai-scan-panel — an inference that is lost rather than slow', () => {
  // INFERENCE_TIMEOUT_MS and TICK_FAIL_MS, written out because neither is exported and both are
  // load-bearing for the arithmetic below: the deadline abandons a wait, and two abandoned waits
  // in a row are what the failure clock then reports on.
  const DEADLINE = 15_000;

  it('a hung next() does not wedge every later tick, and a restart recovers', async () => {
    // The busy guard used to be a bare flag, so an inference that never settles left it set for the
    // life of the page: every later tick returned at the first line, both failure clocks stopped
    // advancing because only a tick that gets somewhere touches them, and stop() + start() could
    // not recover — the flag outlived the scan it belonged to. The panel sat on its last message
    // with the lens on, which is a hung app rather than a slow one.
    fake.nextHold = new Promise<void>(() => {}); // lost on the bridge, not merely slow
    fake.output = tensorFor(facesOf(DEEP).U);
    await vi.advanceTimersByTimeAsync(TICK * SETTLE_TICKS);
    expect(last().captured).toHaveLength(0); // nothing can be read while it hangs

    // The user's move, and it has to work.
    fake.nextHold = null;
    panel.stop();
    await panel.start();
    await show(facesOf(DEEP).U);
    expect(last().captured).toHaveLength(1);
  });

  it('reports a runtime that has gone silent, rather than waiting on it forever', async () => {
    // Fail loud. The deadline ABANDONS THE WAIT, not the inference, and its rejection joins the
    // same failure clock every other tick error does — so a wedged runtime ends in the notice that
    // was written for exactly this and offers a way back on, instead of in silence.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.nextHold = new Promise<void>(() => {});
    // One deadline is patience, not a verdict: the first abandoned wait only starts the clock.
    await vi.advanceTimersByTimeAsync(DEADLINE + TICK);
    expect(last().phase).not.toBe('error');
    // The second lands more than TICK_FAIL_MS later, and that is the report.
    await vi.advanceTimersByTimeAsync(DEADLINE + TICK);
    expect(last().phase).toBe('error');
    expect(last().notice?.title).toMatch(/scanner stopped/i);
    expect(last().device).toBeNull(); // and the lens is off, not left on under a dead loop
    logged.mockRestore();
  });

  it('a frame that could not be read breaks the stillness run', async () => {
    // Stillness is a claim about what was watched CONTINUOUSLY. Every other way a tick ends with no
    // usable read resets the run — a frameless tick, an abstain, a bad geometry — but a frame that
    // THREW left it standing, so two matching reads, a failure, and more matching reads satisfied
    // both halves of the capture gate over an observation with a hole in it.
    const U = facesOf(DEEP).U;
    fake.output = tensorFor(U);
    await vi.advanceTimersByTimeAsync(TICK * 2); // two matching reads
    fake.failWith = new Error('the frame could not be read');
    await vi.advanceTimersByTimeAsync(TICK); // …and one that threw
    fake.failWith = null;
    // Far enough that an UNBROKEN hold would have captured: SETTLE_TICKS reads from the first one.
    await vi.advanceTimersByTimeAsync(TICK * (SETTLE_TICKS - 3));
    expect(last().captured).toHaveLength(0);
    // Recovery takes a fresh continuous hold — 500 ms measured from the first read AFTER the gap.
    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(last().captured).toHaveLength(1);
    fake.output = null;
  });
});

describe('ai-scan-panel — what it says when things go wrong', () => {
  /** A camera rejection with the name getUserMedia actually uses. */
  const refuse = async (name: string): Promise<ScanProgress> => {
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const det = new FakeDetector();
    det.openError = new DOMException('Permission denied', name);
    solo.useDetector(det, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    await solo.start();
    solo.remove();
    const end = seen.at(-1);
    if (!end) throw new Error('no report');
    return end;
  };

  it('turns each way a camera refuses into something a child can do', async () => {
    // "Cannot start: The request is not allowed by the user agent or the platform in the current
    // context" is the browser's own sentence, and it was shown verbatim. It names no action, and
    // the four causes need four different ones — which is exactly what the raw string hides. The
    // NAME is the specified part, so the name is what is mapped.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await refuse('NotAllowedError')).message).toMatch(/Allow the camera/i);
    expect((await refuse('NotFoundError')).message).toMatch(/No camera was found/i);
    expect((await refuse('NotReadableError')).message).toMatch(/Another app is using the camera/i);
    expect((await refuse('OverconstrainedError')).message).toMatch(/default one/i);
    for (const name of ['NotAllowedError', 'NotFoundError'] as const) {
      const end = await refuse(name);
      expect(end.phase).toBe('error');
      expect(end.notice?.title ?? '').toMatch(/camera did not open/i);
      expect(end.message).not.toMatch(/Cannot start:/);
    }
    // The browser's own words are not thrown away — they are the only record of which cause it
    // was, and they go where whoever has to fix it will look.
    expect(warned).toHaveBeenCalled();
    warned.mockRestore();
  });

  it('takes a camera-failure notice down once a retry actually works', async () => {
    // A notice stands until the situation changes, and a working scanner IS the situation
    // changing — but nothing cleared these. A user who pressed Start again, got their camera and
    // watched the scan run was still reading "The camera did not open" under a live preview: the
    // transient line said one thing and the pinned sentence the opposite.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const det = new FakeDetector();
    det.openError = new DOMException('Permission denied', 'NotAllowedError');
    solo.useDetector(det, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    await solo.start();
    expect(seen.at(-1)?.notice?.title ?? '').toMatch(/camera did not open/i);

    det.openError = null; // the user allowed it, and pressed Start again
    await solo.start();
    expect(seen.at(-1)?.notice).toBeNull();
    expect(seen.at(-1)?.phase).toBe('scanning');
    solo.remove();
    warned.mockRestore();
  });

  it('takes "The scanner stopped" down when Start brings the scanner back', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.failWith = new Error('malformed tensor');
    await vi.advanceTimersByTimeAsync(3500);
    expect(last().notice?.title ?? '').toMatch(/stopped/i);

    fake.failWith = null;
    await panel.start();
    expect(last().notice).toBeNull();
    expect(last().phase).not.toBe('error');
    logged.mockRestore();
  });

  it('a restart does NOT take capture guidance down — only a camera failure', async () => {
    // The other half, and the reason the clear is by identity rather than by a flag: a refusal's
    // explanation and a confirm request are about the CUBE, and reopening the camera (a camera
    // switch, a correction after a finished scan) must not wipe what the user still has to act on.
    const TRUTH = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();
    const shown = facesOf(TRUTH);
    const bad = [...shown.F];
    bad[0] = (bad[0]! + 1) % 6;
    for (const face of FACES) await show(face === 'F' ? bad : shown[face]);
    await vi.advanceTimersByTimeAsync(CHECK);
    const pinned = last().notice?.title ?? '';
    expect(pinned).toMatch(/sticker/i);

    await panel.start();
    expect(last().notice?.title).toBe(pinned);
  });

  it('keeps the raw message for a rejection it does not recognise', async () => {
    // Deliberately narrow: a wording nobody predicted must reach a person intact rather than be
    // flattened into a guess about which of four things happened.
    const end = await refuse('SomeFutureError');
    expect(end.message).toMatch(/Cannot start: Permission denied/);
  });

  it('says the model is slow, then stops waiting for one that never arrives', async () => {
    // A multi-megabyte fetch is allowed to take a while; it is not allowed to take forever with
    // nothing said and nothing to press. There was no notice and no bound at all.
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const det = new FakeDetector();
    det.loadHold = new Promise<void>(() => {}); // a download that stalls for good
    solo.useDetector(det, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    const starting = solo.start();

    await vi.advanceTimersByTimeAsync(9000);
    expect(seen.at(-1)?.phase).toBe('loading');
    expect(seen.at(-1)?.notice?.title ?? '').toMatch(/taking a while/i);
    // …and the camera is already open behind it, which is the whole point of camera-first.
    expect(det.device).not.toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    await starting;
    expect(seen.at(-1)?.phase).toBe('error');
    expect(seen.at(-1)?.message).toMatch(/did not load within/i);
    // A remedy, and one of them needs no model at all.
    expect(seen.at(-1)?.notice?.title).toMatch(/did not load/i);
    expect(seen.at(-1)?.notice?.body ?? '').toMatch(/paint the cube by hand/i);
    solo.remove();
  });

  it('takes the slow-load notice down once the model arrives', async () => {
    // A notice stands until the situation changes, and a finished load IS the situation changing.
    // Leaving it up means a working scanner explaining that it is still downloading.
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const det = new FakeDetector();
    let arrive = (): void => {};
    det.loadHold = new Promise<void>((res) => {
      arrive = () => res();
    });
    solo.useDetector(det, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    const starting = solo.start();
    await vi.advanceTimersByTimeAsync(9000);
    expect(seen.at(-1)?.notice?.title ?? '').toMatch(/taking a while/i);
    arrive();
    await starting;
    await vi.advanceTimersByTimeAsync(TICK);
    expect(seen.at(-1)?.notice).toBeNull();
    expect(seen.at(-1)?.phase).toBe('scanning');
    solo.remove();
  });

  it('a load abandoned by a restart says nothing over the scan that replaced it', async () => {
    // The notice is the panel's ONE pinned sentence, and `loadModel` wrote to it with no
    // generation check at all — the only place in start() that did. An abandoned load settles up
    // to a minute later, so "The model did not load" landed on top of whatever the CURRENT state
    // was saying: here, a scanner that is running.
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const stalled = new FakeDetector();
    stalled.loadHold = new Promise<void>(() => {}); // never arrives
    solo.useDetector(stalled, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    const abandoned = solo.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.at(-1)?.phase).toBe('loading');

    // The user gives up and starts again on a detector whose model is there. Frames arrive with no
    // readable side in them, so the scan simply runs.
    const working = new FakeDetector();
    working.output = emptyTensor();
    solo.useDetector(working, 'web');
    await solo.start();
    expect(seen.at(-1)?.phase).toBe('scanning');
    expect(seen.at(-1)?.notice).toBeNull();

    // …and a minute later the abandoned load gives up. Its verdict is about a scan that is over.
    await vi.advanceTimersByTimeAsync(61_000);
    await abandoned;
    await vi.advanceTimersByTimeAsync(TICK);
    expect(seen.at(-1)?.notice).toBeNull();
    expect(seen.at(-1)?.phase).toBe('scanning');
    solo.remove();
  });

  it('a load abandoned mid-flight does not mark the REPLACEMENT detector’s model loaded', async () => {
    // `modelLoaded` was set before the generation was checked, so a superseded attempt could mark
    // the session's model loaded — and `useDetector` may have put a DIFFERENT detector there in
    // the meantime, whose model has never been compiled. The next start then skipped the load
    // entirely and the tick loop asked an unloaded runtime for frames.
    const solo = new AiScanPanel();
    solo.setAttribute('headless', '');
    const first = new FakeDetector();
    let arrive = (): void => {};
    first.loadHold = new Promise<void>((res) => {
      arrive = () => res();
    });
    solo.useDetector(first, 'web');
    document.body.appendChild(solo);
    const seen: ScanProgress[] = [];
    solo.addEventListener('scan-progress', (e) =>
      seen.push((e as CustomEvent<ScanProgress>).detail),
    );
    const abandoned = solo.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.at(-1)?.phase).toBe('loading');

    // A different detector is injected — the native host's path, and the test seam's — and ITS
    // model is still compiling. It would answer `next()` perfectly happily if anything asked.
    const replacement = new FakeDetector();
    replacement.loadHold = new Promise<void>(() => {});
    replacement.output = tensorFor(facesOf(DEEP).U);
    solo.useDetector(replacement, 'web');

    // The abandoned load finishes. Nothing it says is about the session that replaced it.
    arrive();
    await abandoned;

    const starting = solo.start();
    await vi.advanceTimersByTimeAsync(TICK * SETTLE_TICKS);
    // Still waiting on the replacement's own model — not scanning, and certainly not capturing a
    // side read through a runtime that has never loaded one.
    expect(seen.at(-1)?.phase).toBe('loading');
    expect(seen.at(-1)?.captured ?? []).toHaveLength(0);
    // Leave nothing pending: the load times out on its own and re-offers Start.
    await vi.advanceTimersByTimeAsync(61_000);
    await starting;
    solo.remove();
  });
});

describe('ai-scan-panel — an instruction survives the camera reopening', () => {
  it('names the side it wants after a finished scan released the camera', async () => {
    // `rescanFace` is what a tap on a CENTRE sticker does — a centre cannot be recoloured, so the
    // side is read again. After a finished scan the camera is off, and `loop()` handled that by
    // reopening and DROPPING the words it was given. So the one instruction the user needed was
    // replaced by "Opening the camera…" and then by the generic idle line: the app asked for
    // nothing, and the tap looked like it had done nothing.
    await showAll(DEEP, [0, 0, 0, 0, 0, 0]);
    expect(last().phase).toBe('done');
    expect(last().device).toBeNull();

    panel.rescanFace('L');
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().message).toMatch(/Show the ORANGE side again/);
    expect(last().device).not.toBeNull(); // and the camera really did come back
  });

  it('drops the pending instruction when the scan is thrown away', async () => {
    await showAll(DEEP, [0, 0, 0, 0, 0, 0]);
    panel.rescanFace('L');
    panel.restart();
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(last().message).not.toMatch(/Show the ORANGE side again/);
  });
});

describe('ai-scan-panel — a settled scan is not re-solved', () => {
  // One turn from solved: the case six unoriented photos cannot determine, so the first pass costs
  // confirmations. Once they are spent the rotations are KNOWN, and a later correction must not
  // spend them again.
  const ONE_TURN = new Cube().move('U').asString();

  it('a correction after a settle never re-asks for looks', async () => {
    await showAll(ONE_TURN, [0, 0, 0, 0, 0, 0]);
    await answerConfirms(ONE_TURN);
    expect(completions).toEqual([ONE_TURN]);

    const truth = facesOf(ONE_TURN);
    const was = truth.F[1]!;
    panel.setSticker('F', 1, (was + 1) % 6); // break it…
    await vi.advanceTimersByTimeAsync(CHECK);
    const askedWhileBroken = events.some((e) => e.phase === 'confirm' && e.confirm !== null);
    panel.setSticker('F', 1, was); // …and put it back
    await vi.advanceTimersByTimeAsync(CHECK);

    expect(completions).toEqual([ONE_TURN, ONE_TURN]);
    expect(last().phase).toBe('done');
    // The searches that used to happen: the rotations were solved once and thrown away, so every
    // re-check re-ran the 4^6 search over captures it had already settled and asked to be shown a
    // side again — for an orientation nobody had lost.
    const asksAfterSettle = events
      .slice(events.findIndex((e) => e.phase === 'done'))
      .filter((e) => e.confirm !== null);
    expect(asksAfterSettle).toEqual([]);
    expect(askedWhileBroken).toBe(true); // the first pass really did need looks
  });
});

describe('ai-scan-panel — a sticker that will not settle is named', () => {
  /** Show the U side with its top-right sticker alternating between colour classes `a` and `b`. */
  const flickerBetween = async (a: number, b: number) => {
    const face = [...facesOf(DEEP).U];
    for (let i = 0; i < 12; i++) {
      face[2] = i % 2 === 0 ? a : b;
      fake.output = tensorFor(face);
      await vi.advanceTimersByTimeAsync(TICK);
    }
  };

  it('says which sticker keeps changing, and between which two colours, instead of repeating "hold still"', async () => {
    // The gate keys on all nine colours, so ONE sticker flickering between red and orange — the
    // detector's known weak pair — means no run ever completes and the side is never captured.
    // That was a dead end with no message: "hold still" for as long as the user was willing.
    await flickerBetween(1, 4); // red, orange
    expect(last().captured).toHaveLength(0); // it genuinely never settles
    expect(last().message).toBe(
      'Reading a side — the top right sticker keeps changing between RED and ORANGE. Whiter light on it helps tell them apart.',
    );
    fake.output = null;
  });

  it('a read whose centre is not a colour claims no side', () => {
    // The rule the "couldn't read this side's centre" report rests on, asked of the rule itself: a
    // fitted centre is always a colour class, so no camera reaches the branch, and the test for it
    // used to call a private method to get there (audit, 2026-09-19).
    const read = [...facesOf(DEEP).U];
    expect(sideClaimed(read)).toBe('U');
    for (const centre of [9, -1, 6, Number.NaN]) {
      const notAColour = [...read];
      notAColour[4] = centre;
      expect(sideClaimed(notAColour), `centre ${centre}`).toBeUndefined();
    }
    expect(sideClaimed([])).toBeUndefined();
  });

  it('adds the light remark only for a pair the light is known to confuse', async () => {
    // Orange read as yellow followed the light (AGENTS.md, 0.6.1); white against blue has no such
    // evidence, so it gets the measured half of the sentence and nothing more — never a promise
    // that steadier hands or more light "will settle it".
    await flickerBetween(3, 4); // yellow, orange
    expect(last().message).toMatch(
      /between YELLOW and ORANGE\. Whiter light on it helps tell them apart\.$/,
    );
    fake.output = null;
    await vi.advanceTimersByTimeAsync(TICK * 3);
    await flickerBetween(0, 5); // white, blue
    expect(last().message).toBe(
      'Reading a side — the top right sticker keeps changing between WHITE and BLUE.',
    );
    expect(last().message).not.toMatch(/light|steadier|settle/i);
    fake.output = null;
  });

  it('stays quiet when the whole face changes — that is a cube being turned', async () => {
    const a = facesOf(DEEP).U;
    const b = facesOf(DEEP).R;
    for (let i = 0; i < 12; i++) {
      fake.output = tensorFor(i % 2 === 0 ? a : b);
      await vi.advanceTimersByTimeAsync(TICK);
    }
    expect(last().message).toMatch(/hold still/i);
    expect(last().message).not.toMatch(/keeps changing colour/i);
    fake.output = null;
  });
});

describe('ai-scan-panel — the two voices agree about the same refusal', () => {
  // A cube whose readings no further look can split: the confirmations run out before the
  // ambiguity does, and `assembleColors` says so instead of promising a deciding look.
  const TOO_SYMMETRIC = new Cube().move('U D R L F B').asString();

  it('an ambiguous cube is not called unsolvable', async () => {
    // The pinned notice said "This cube reads the same several ways… turn any one face"; the
    // transient line under it said "That isn't a solvable cube yet — fix a sticker, or show a side
    // again" — for a cube that IS solvable, every reading of which is solvable, three lines below
    // the sentence saying so. One sentence for every branch is how that happened.
    await showAll(TOO_SYMMETRIC, [0, 0, 0, 0, 0, 0]);
    await answerConfirms(TOO_SYMMETRIC);
    expect(completions).toEqual([]);
    expect(last().notice?.title).toBe('Too symmetric to tell');
    expect(last().message).toMatch(/reads the same several ways/i);
    expect(last().message).toMatch(/turn any one face/i);
    expect(last().message).not.toMatch(/isn't a solvable cube/i);
    expect(last().captured).toHaveLength(6); // and the work survives, as every refusal must
  });

  it('a genuine misread still says so', async () => {
    // The other branch, unchanged: the wording is per-refusal, not one line dressed differently.
    const truth = facesOf(new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString());
    const badF = [...truth.F];
    badF[0] = (badF[0]! + 1) % 6;
    const badR = [...truth.R];
    badR[2] = (badR[2]! + 2) % 6;
    for (const face of FACES) {
      await show(face === 'F' ? badF : face === 'R' ? badR : truth[face]);
    }
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(last().message).toMatch(/isn't a solvable cube yet/i);
    expect(last().message).not.toMatch(/reads the same several ways/i);
  });
});

// ---------------------------------------------------------------------------------------------
describe('ai-scan-panel — the misread count arrives after the refusal, not before it', () => {
  const TRUTH = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();
  const F_TRUE = facesOf(TRUTH).F[0]!;

  /** Show all six sides with `n` stickers of the Front side read as a colour they are not. */
  async function scanMisreading(n: number): Promise<void> {
    const shown = facesOf(TRUTH);
    const bad = [...shown.F];
    for (let i = 0; i < n; i++) bad[i] = (bad[i]! + 1) % 6;
    for (const face of FACES) await show(face === 'F' ? bad : shown[face]);
    await vi.advanceTimersByTimeAsync(CHECK);
  }

  it('publishes the refusal without decoding anything on this thread', async () => {
    // THE POINT OF THE WHOLE CHANGE. Before this, `decodeMisread` ran between the sixth capture and
    // the frame that explains the refusal — 52-125 ms on an easy scramble and up to 3.0 s when its
    // node budget is exhausted, all of it on the page's thread, with the board frozen.
    withWorker();
    const invalid: AiScanResult[] = [];
    panel.addEventListener('scan-invalid', (e) =>
      invalid.push((e as CustomEvent<AiScanResult>).detail),
    );
    const before = seam.decodes;
    await scanMisreading(1);

    // Not "few decodes", none: a decode that ran and was discarded blocks exactly as long.
    expect(seam.decodes).toBe(before);
    // The refusal is out, and says what it can — which is that it is checking, and NOT a count.
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.misreadCount).toBeNull();
    expect(invalid[0]!.suspects).toBeUndefined();
    expect(last().suspects).toEqual([]);
    expect(last().notice?.body ?? '').toMatch(/working out how many stickers are wrong/i);
    // `null` must never be read as zero or as "nothing can be said": both of those are sentences
    // this panel has, and neither is true here.
    expect(last().notice?.body ?? '').not.toMatch(/too much of the cube/i);
    expect(last().notice?.params).toBeUndefined();
    // And the work went somewhere: one request, carrying this reading and its rotation status.
    const worker = FakeWorker.last();
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]!.fixedRotation).toBe(false);
    expect(worker.posted[0]!.faces.F!.colors[0]).toBe((F_TRUE + 1) % 6);
  });

  it('refines the notice, and re-announces the refusal, when the count lands', async () => {
    withWorker();
    const invalid: AiScanResult[] = [];
    panel.addEventListener('scan-invalid', (e) =>
      invalid.push((e as CustomEvent<AiScanResult>).detail),
    );
    await scanMisreading(1);
    FakeWorker.last().answer();

    // The public event carries the same null-then-value shape the field does, so a host learns the
    // count on the channel it learned the refusal on rather than having to watch two.
    expect(invalid).toHaveLength(2);
    expect(invalid[1]!.misreadCount).toBe(1);
    expect(invalid[1]!.suspects).toContainEqual({ face: 'F', index: 0, to: F_TRUE });
    // And the words are the ones a decided count earns — the proven wording, unchanged.
    expect(last().notice?.title).toMatch(/check the marked sticker/i);
    expect(last().suspects).toContainEqual({ face: 'F', index: 0, to: F_TRUE });
  });

  it('states the count and accuses nothing when the answer is more than one', async () => {
    withWorker();
    await scanMisreading(2);
    expect(last().notice?.body ?? '').toMatch(/working out how many/i);
    FakeWorker.last().answer();
    expect(last().notice?.title).toBe('Some stickers were misread');
    expect(last().notice?.params?.[0]).toBeGreaterThanOrEqual(2);
    expect(last().suspects).toEqual([]);
  });

  it('stops saying it is checking when the decode answers that it cannot say', async () => {
    // THE TRAP `null` EXISTS TO CREATE, and the one this was found failing on while measuring.
    // A decode that exhausts its 20M-node backstop answers with nothing at all — which is a real
    // answer ("the search could not tell") and NOT the deferred state. Spreading an empty
    // diagnosis over a result still carrying `misreadCount: null` leaves the marker standing, so
    // the panel says "working out how many stickers are wrong" for the rest of the session about
    // a question that will never be answered any further.
    withWorker();
    await scanMisreading(1);
    const worker = FakeWorker.last();
    // Reply as an exhausted search does: the epoch, and no claim.
    const epoch = worker.posted[0]!.epoch;
    worker.deliver({ epoch, diagnosis: {} });

    expect(last().notice?.body ?? '').not.toMatch(/working out how many/i);
    expect(last().notice?.title).toMatch(/doesn.t read as a solvable cube/i);
    expect(last().notice?.body ?? '').toMatch(/too much of the cube was read wrong/i);
    expect(last().suspects).toEqual([]);
  });

  it('drops an answer about a reading that is no longer on screen', async () => {
    // The decode can take seconds, and the scan does not stop while it runs. An answer that lands
    // after a correction describes a cube nobody is looking at — and it would land as a COUNT,
    // over a reading the user may have just fixed.
    withWorker();
    await scanMisreading(1);
    const stale = FakeWorker.last();
    // The user fixes the sticker: the reading changes, and the verdict is re-opened.
    panel.setSticker('F', 0, F_TRUE);
    await vi.advanceTimersByTimeAsync(CHECK);
    const settled = last();

    stale.answer(0); // the old decode finally finishes
    expect(last()).toBe(settled); // …and nothing at all was said about it
  });

  it('says nothing over a camera failure that landed while the decode was out', async () => {
    // The diagnosis outlives its subject by design, and every site that re-decides a reading bumps
    // the epoch so a late answer is dropped. A FATAL CAMERA FAILURE was not one of those sites —
    // and it is the one that hurts most, because the answer republishes at phase 'scanning' with a
    // notice about stickers. Landing after `tickFail` it replaced "The scanner stopped" with an
    // instruction to show a side again, over a camera this panel had just closed and a loop that
    // is no longer running: the user is told to do something the scanner cannot receive.
    withWorker();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await scanMisreading(1);
    expect(last().notice?.body ?? '').toMatch(/working out how many/i);
    const worker = FakeWorker.last();
    expect(worker.posted).toHaveLength(1);

    // The camera dies while the decode is out.
    fake.failWith = new Error('malformed tensor');
    await vi.advanceTimersByTimeAsync(3500);
    expect(last().phase).toBe('error');
    expect(last().notice?.title ?? '').toMatch(/stopped/i);

    const stopped = last();
    worker.answer(0); // …and only now does the count arrive
    expect(last()).toBe(stopped); // nothing was said at all
    expect(last().notice?.title ?? '').toMatch(/stopped/i);
    expect(last().phase).toBe('error');
    logged.mockRestore();
  });

  it('says nothing over a camera that would not REOPEN while the decode was out', async () => {
    // THE SIBLING SITE, left out when the case above was fixed. `tickFail` drops the diagnosis
    // because it closes the camera; `startFailed` pins its own sentence and does not — and the
    // reading has not changed, so the epoch cannot tell. The answer therefore republished at phase
    // 'scanning' with a notice about stickers, replacing "The camera did not open" over a device
    // that is null: the user is told to show a side again by a scanner with no camera at all.
    withWorker();
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await scanMisreading(1);
    expect(last().notice?.body ?? '').toMatch(/working out how many/i);
    const worker = FakeWorker.last();

    // The user switches camera, or presses Start again, and this time it is refused.
    fake.openError = new DOMException('Permission denied', 'NotAllowedError');
    await panel.start();
    expect(last().phase).toBe('error');
    expect(last().notice?.title ?? '').toMatch(/camera did not open/i);

    const failed = last();
    worker.answer(0); // …and only now does the count arrive
    expect(last()).toBe(failed); // nothing was said at all
    expect(last().notice?.title ?? '').toMatch(/camera did not open/i);
    warned.mockRestore();
  });

  it('answers with the count in one go where the page has no worker', async () => {
    // No `Worker` at all — a webview that forbids one, or this very test environment. The panel
    // must still get the whole diagnosis, in the same tick, exactly as it did before the decode
    // moved: one refusal event carrying the count, and no second one.
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe('undefined');
    const invalid: AiScanResult[] = [];
    panel.addEventListener('scan-invalid', (e) =>
      invalid.push((e as CustomEvent<AiScanResult>).detail),
    );
    const before = seam.decodes;
    await scanMisreading(1);
    expect(seam.decodes).toBe(before + 1);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.misreadCount).toBe(1);
    expect(last().notice?.title).toMatch(/check the marked sticker/i);
    expect(last().notice?.body ?? '').not.toMatch(/working out how many/i);
  });

  it('defers a refused PAINTING the same way, and asks about it as painted', async () => {
    // Painting refuses through its own path and had the same block — worse, since it lands between
    // a tap and the tile changing colour, and since once the sixth side exists EVERY stroke
    // re-checks the whole cube. And its decode must be told the rotations are known, or it answers
    // "0 misreads" about a cube the painted validator has just refused.
    withWorker();
    panel.setPainting(true);
    const truth = facesOf(TRUTH);
    for (const f of FACES)
      for (let i = 0; i < 9; i++) if (i !== 4) panel.setSticker(f, i, truth[f]![i]!);
    const before = seam.decodes;
    panel.setSticker('U', 0, (truth.U![0]! + 1) % 6);

    expect(seam.decodes).toBe(before);
    expect(last().notice?.body ?? '').toMatch(/working out how many/i);
    const worker = FakeWorker.last();
    // ONE decode is out and the rest of the strokes collapsed into the latest ask — a queue of
    // obsolete decodes is what `MisreadDecoder` refuses to build (see misread-worker.test.ts), and
    // it is this path that reaches it: once the sixth side exists every stroke re-checks the cube.
    const running = worker.posted.length - 1;
    // An earlier stroke's answer, arriving late, must say nothing about this reading…
    const settled = last();
    worker.answer(running);
    expect(last()).toBe(settled);
    // …and answering it is what sends this stroke's own ask, which must be told the rotations are
    // known or the decode answers "0 misreads" about a cube the painted validator has refused.
    const mine = worker.posted.length - 1;
    expect(mine).toBeGreaterThan(running);
    expect(worker.posted[mine]!.fixedRotation).toBe(true);
    worker.answer(mine);
    expect(last().suspects).toContainEqual({ face: 'U', index: 0, to: truth.U![0]! });
  });
});

describe('ai-scan-panel — the colour scheme is the scan’s to decide (ADR 0001)', () => {
  /** The U-layer edge 3-cycle: valid under both schemes as two different cubes. */
  const CYCLE = 'UFUUUUUUURRRFRRRRRFBFFFUFFFDDDDDDDDDLLLLLLLLLBRBBBBBBB';

  /** The six sides of a cube in state `facelets` PAINTED IN `scheme`, by position, canonical. */
  const sidesOf = (facelets: string, scheme: Scheme): Record<Face, number[]> => {
    const out = {} as Record<Face, number[]>;
    FACES.forEach((position, fi) => {
      out[position] = [...facelets.slice(fi * 9, fi * 9 + 9)].map((l) =>
        colourOf(l as Face, scheme),
      );
    });
    return out;
  };

  /** Show all six sides of a cube of `scheme`, each turned as a user might hold it. */
  async function showAllAs(facelets: string, scheme: Scheme, rots: number[]): Promise<void> {
    const sides = sidesOf(facelets, scheme);
    for (const [fi, position] of FACES.entries()) {
      await show(rotateFace(sides[position], rots[fi]!));
    }
    await vi.advanceTimersByTimeAsync(CHECK);
  }

  /** Answer every confirm request the way a cube of `scheme` is physically held for it. */
  async function answerAs(facelets: string, scheme: Scheme): Promise<number> {
    const sides = sidesOf(facelets, scheme);
    let looks = 0;
    for (let round = 0; round < 8 && last().phase === 'confirm'; round++) {
      const ask = last().confirm;
      if (!ask) break;
      const position = positionOf(colourOfSlot(ask.face), scheme);
      const offset = holdOffset(colourOfSlot(ask.face), colourOfSlot(ask.up), scheme);
      if (offset === null)
        throw new Error(`asked for an impossible hold: ${ask.face} with ${ask.up} up`);
      looks++;
      await show(rotateFace(sides[position], offset));
      await vi.advanceTimersByTimeAsync(CHECK);
    }
    return looks;
  }

  it('reads a Japanese cube, files each side by its colour, and the verdict names the scheme', async () => {
    const verdicts: (string | undefined)[] = [];
    panel.addEventListener('scan-complete', (e) =>
      verdicts.push((e as CustomEvent<AiScanResult>).detail.scheme),
    );
    await showAllAs(DEEP, 'japanese', [1, 2, 3, 0, 1, 2]);
    expect(completions).toEqual([DEEP]);
    expect(verdicts).toEqual(['japanese']);
    expect(last().scheme).toBe('japanese');
    // The blue capture sits in slot B and the yellow one in slot D — slots are colours, and
    // the host is told through `scheme` that on this cube blue is the bottom.
    const captured = new Map(last().captured.map((c) => [c.face, c.colors]));
    expect(captured.get('B')?.[4]).toBe(5);
    expect(captured.get('D')?.[4]).toBe(3);
    // Sides are named by colour in every sentence: the blue side of this cube is not "Back".
    expect(events.some((e) => /Got the BLUE side/.test(e.message))).toBe(true);
    expect(events.some((e) => /Back side/.test(e.message))).toBe(false);
  });

  it('a Western verdict says so, a solved cube is undetermined, and a restart forgets it', async () => {
    expect(last().scheme).toBeNull();
    await showAll(DEEP, [0, 0, 0, 0, 0, 0]);
    expect(last().scheme).toBe('western');
    panel.restart();
    expect(last().scheme).toBeNull();
    await showAll(SOLVED_FACELETS, [1, 2, 3, 0, 1, 2]);
    expect(completions).toEqual([DEEP, SOLVED_FACELETS]);
    expect(last().scheme).toBe('undetermined');
  });

  it('a refusal never sets the scheme', async () => {
    const sides = sidesOf(DEEP, 'japanese');
    const bad = [...sides.F];
    bad[0] = (bad[0]! + 1) % 6;
    for (const position of FACES) await show(position === 'F' ? bad : sides[position]);
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(completions).toEqual([]);
    expect(last().scheme).toBeNull();
    // …and the floor it reports is the honest one for THIS cube, not the Western filing's.
    expect(last().notice?.title).toMatch(/check the marked sticker/i);
    expect(last().suspects).toEqual([{ face: 'F', index: 0, to: sides.F[0] }]);
  });

  it('two readings that differ only by scheme: the looks are answered, then the turn instruction', async () => {
    await showAllAs(CYCLE, 'western', [0, 0, 0, 0, 0, 0]);
    // A look IS asked for: one that could separate them, held a way both kinds of cube can obey.
    // (A look can eliminate a scheme in general — see ai-assemble.test.ts — so the scanner tries
    // before it gives up.) Here the truthful answers fit both readings, and it says so.
    expect(last().phase).toBe('confirm');
    const ask = last().confirm;
    expect(ask).not.toBeNull();
    for (const scheme of SCHEMES) {
      expect(adjacentIn(colourOfSlot(ask!.face), colourOfSlot(ask!.up), scheme)).toBe(true);
    }
    const looks = await answerAs(CYCLE, 'western');
    expect(looks).toBeGreaterThan(0);
    expect(completions).toEqual([]);
    expect(last().phase).toBe('scanning');
    expect(last().notice?.title).toMatch(/which colour is under white/i);
    expect(last().notice?.body).toMatch(/turn any one face/i);
    // One turn later the same cube reads decisively, as itself.
    panel.restart();
    const turned = Cube.fromString(CYCLE).move('R').asString();
    await showAllAs(turned, 'western', [0, 0, 0, 0, 0, 0]);
    expect(completions).toEqual([turned]);
    expect(last().scheme).toBe('western');
  });

  it('paints by position under the host’s assumed scheme, and the painting carries its scheme', async () => {
    const verdicts: (string | undefined)[] = [];
    panel.addEventListener('scan-complete', (e) =>
      verdicts.push((e as CustomEvent<AiScanResult>).detail.scheme),
    );
    panel.setAttribute('scheme', 'japanese');
    panel.setPainting(true);
    // A host draws the Down tile and knows that on a Japanese cube it shows the BLUE capture, so
    // it calls with the slot — the panel speaks slots in every mode. One stroke creates a
    // blue-centred side seeded blue, with the painted sticker where it was tapped.
    panel.setSticker('B', 0, 3);
    const seeded = last().captured.find((c) => c.face === 'B');
    expect(seeded?.colors[4]).toBe(5);
    expect(seeded?.colors[0]).toBe(3);
    expect(last().captured.find((c) => c.face === 'D')).toBeUndefined();
    // Paint the whole of DEEP as a Japanese cube, tile by tile — and it is accepted as that.
    const sides = sidesOf(DEEP, 'japanese');
    for (const position of FACES) {
      // The host's own mapping: this position's tile shows the capture of the colour the
      // arrangement paints there.
      const slot = slotOf(colourOf(position, 'japanese'));
      sides[position].forEach((colour, i) => {
        if (i !== 4) panel.setSticker(slot, i, colour);
      });
    }
    expect(completions).toEqual([DEEP]);
    expect(verdicts).toEqual(['japanese']);
    expect(last().scheme).toBe('japanese');
  });

  it('swapping a painting’s centres re-decides it under the arrangement it now has', async () => {
    panel.setPainting(true);
    const sides = sidesOf(DEEP, 'western');
    for (const position of FACES) {
      const slot = slotOf(colourOf(position, 'western'));
      sides[position].forEach((colour, i) => {
        if (i !== 4) panel.setSticker(slot, i, colour);
      });
    }
    expect(completions).toEqual([DEEP]);
    expect(last().scheme).toBe('western');
    const refusals: number[] = [];
    panel.addEventListener('scan-invalid', () => refusals.push(1));
    // Declared Japanese, the same stickers are not a legal cube — a Western painting re-filed
    // with blue under white never is once it is scrambled — and the panel says what changed.
    panel.setPaintScheme('japanese');
    expect(refusals).toHaveLength(1);
    expect(last().complete).toBe(false);
    expect(events.some((e) => /Centres swapped — BLUE is under WHITE now/.test(e.message))).toBe(
      true,
    );
    // And back again, it is the accepted Western cube once more.
    panel.setPaintScheme('western');
    expect(completions).toEqual([DEEP, DEEP]);
    expect(last().scheme).toBe('western');
  });

  it('a correction never turns the host’s assumption into a verdict', async () => {
    // A solved cube is one state under both arrangements, so the scan reports 'undetermined' and
    // the app paints it in whatever it assumes. Correcting a sticker re-checks the cube IN PLACE
    // — under that same assumption — so the check can only ever hand the assumption back. Taking
    // it as an answer would promote a setting to a proven fact about the cube in the hand: tap a
    // sticker, tap it back, and an unknown cube would come back "proven Western" (found by audit,
    // 2026-09-07). The state is re-decided; the arrangement is not.
    for (const assumed of ['western', 'japanese'] as const) {
      panel.restart();
      panel.setAttribute('scheme', assumed);
      await showAllAs(SOLVED_FACELETS, assumed, [0, 0, 0, 0, 0, 0]);
      expect(last().scheme).toBe('undetermined');
      const sides = sidesOf(SOLVED_FACELETS, assumed);
      // Break it, and put it back exactly as it was.
      panel.setSticker('U', 0, (sides.U[0]! + 1) % 6);
      await vi.advanceTimersByTimeAsync(CHECK);
      expect(last().complete).toBe(false);
      expect(last().scheme).toBe('undetermined'); // a refusal establishes nothing either
      panel.setSticker('U', 0, sides.U[0]!);
      await vi.advanceTimersByTimeAsync(CHECK);
      expect(last().complete).toBe(true);
      expect(last().scheme).toBe('undetermined');
    }
  });

  it('a corrected sticker on an accepted Japanese scan is checked in place under its own scheme', async () => {
    await showAllAs(DEEP, 'japanese', [0, 1, 2, 3, 0, 1]);
    expect(completions).toEqual([DEEP]);
    const sides = sidesOf(DEEP, 'japanese');
    // Corrupt one sticker of the blue side (slot B, the bottom of this cube): refused, with the
    // pointer in slot coordinates and the floor of one that the Japanese filing gives.
    panel.setSticker('B', 0, (sides.D[0]! + 1) % 6);
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(completions).toEqual([DEEP]);
    expect(last().complete).toBe(false);
    expect(last().suspects).toEqual([{ face: 'B', index: 0, to: sides.D[0] }]);
  });
});

describe('ai-scan-panel — the scan trace', () => {
  // The trace exists to explain a scan that will not settle, so the three things worth pinning are
  // that it is silent when off, that it records what actually happened when on, and — the one that
  // matters most — that turning it on does not change the scan it is watching.
  const traceOf = () => (globalThis as { __cubusScanTrace?: ScanTrace }).__cubusScanTrace;
  const ALL_WHITE = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  /** A face with its centre scored just under the scan's threshold — how a logo reads. */
  const logoCentre = (): ModelOutput => {
    const t = tensorFor(ALL_WHITE);
    t.data[(4 + 0) * t.anchors + 4] = 0.18; // anchor 4 is the centre cell, class 0 is white
    return t;
  };

  beforeEach(() => {
    delete (globalThis as { __cubusScanTrace?: ScanTrace }).__cubusScanTrace;
  });
  afterEach(() => {
    localStorage.removeItem(TRACE_KEY);
    delete (globalThis as { __cubusScanTrace?: ScanTrace }).__cubusScanTrace;
  });

  it('records nothing and publishes nothing with the switch off', async () => {
    // beforeEach started this scan with the switch off, which is how every other case runs.
    fake.output = logoCentre();
    await vi.advanceTimersByTimeAsync(TICK * 3);
    await show(ALL_WHITE);
    expect(traceOf()).toBeUndefined();
  });

  it('records every tick with how it ended, the centre it saw, and the words on screen', async () => {
    localStorage.setItem(TRACE_KEY, '1');
    panel.restart(); // the switch is read when a loop starts
    fake.output = logoCentre();
    await vi.advanceTimersByTimeAsync(TICK * 3);
    await show(ALL_WHITE);

    const trace = traceOf();
    expect(trace).toBeDefined();
    const ticks = trace!.dump();
    // A LOGO CENTRE STILL ABSTAINS FOR THE FIRST COUPLE OF SECONDS, and that is the design rather
    // than the old behaviour surviving: reading a side from its EIGHT is a fallback for when nine
    // have genuinely stopped coming (`PARTIAL_AFTER_MS`), because a side whose centre the detector
    // can see must be captured with it and shown on its own tile. Firing immediately, that path
    // caught any side during the moment its centre flickered and filed it unnamed — which has no
    // tile until six resolve, so several sides went quiet at once on a live scan.
    //
    // The eight-sticker capture itself is covered where it can actually be reached: see
    // "a face is read from its eight even with clutter in frame", which holds the face past the
    // window. This case is the three ticks before it.
    const logo = ticks.filter((r) => r.outcome === 'abstain');
    expect(logo.length).toBeGreaterThanOrEqual(3);
    for (const r of logo) {
      expect(r.reason).toBe('PARTIAL_FACE');
      expect(r.kept).toBe(8);
      // The answer the logo case needs, from the running panel: seen at the centre, as white,
      // scored too low to keep.
      expect(r.centre).toMatchObject({ found: true, cls: 0, conf: 0.18, kept: false });
      // Only the idle line: the side IS in view, so telling the person to frame it would be false.
      expect(r.line).toBe('Show any side to the camera.');
    }
    // And a whole-face read is untouched: a real centre, no sentinel.
    const whole = ticks.filter((r) => r.kept === 9);
    expect(whole.length).toBeGreaterThan(0);
    for (const r of whole) expect(r.colors?.[4]).toBe(0);
    const settled = ticks.find((r) => r.outcome === 'settled' && r.kept === 9);
    expect(settled).toMatchObject({ colors: ALL_WHITE, kept: 9, near: 0 });
    // A settled read is the tenth identical one, and the run before it says so.
    expect(ticks.filter((r) => r.outcome === 'reading').map((r) => r.run)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    for (const r of ticks) {
      expect(typeof r.inferMs).toBe('number');
      expect(typeof r.line).toBe('string');
      // Every tick names how it ended. The wiring records a missing one as an error that says so;
      // none may appear, or a path through readFrame has stopped reporting.
      expect(r.error).toBeUndefined();
    }
  });

  it('captures the same side on the same tick with the switch on as with it off', async () => {
    // Off: the side is filed on exactly the SETTLE_TICKS-th tick.
    await show(ALL_WHITE);
    const offCapture = last().captured.map((c) => c.face);
    expect(offCapture).toContain('U');

    // On, from a clean scan: the same frames give the same capture on the same tick — not one
    // earlier, not one later. The trace reads the verdict through the scan's own functions, so
    // any difference here would mean watching the scan had changed it.
    localStorage.setItem(TRACE_KEY, '1');
    panel.restart();
    fake.output = tensorFor(ALL_WHITE);
    await vi.advanceTimersByTimeAsync(TICK * (SETTLE_TICKS - 1));
    expect(last().captured.map((c) => c.face)).not.toContain('U');
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().captured.map((c) => c.face)).toEqual(offCapture);
  });
});

describe('ai-scan-panel — a capture is announced once; a read under way is a state', () => {
  // A host that plays a sound or moves a picture on "a side was saved" needs the MOMENT, once. It
  // cannot diff `captured` for it: a re-read replaces a side without changing the count, and a settled
  // read can still be refused. And "reading" must never look like "saved" — so the read under way is
  // a separate state that promises nothing (dev-docs/scan-guidance-plan.md 3.1).
  const ONE_TURN = new Cube().move('U').asString();
  let captures: ScanCapture[];
  beforeEach(() => {
    captures = [];
    panel.addEventListener('scan-capture', (e) =>
      captures.push((e as CustomEvent<ScanCapture>).detail),
    );
  });

  it('announces each new side once, and nothing for a settled read it refuses', async () => {
    const f = facesOf(DEEP);
    await show(f.U); // held for ten ticks: settled once, then re-read as "already have" every tick after
    await show(f.R);
    await show(f.U); // settles again, and is refused: already have it
    expect(captures).toEqual([
      { kind: 'side', face: 'U', sides: 1 },
      { kind: 'side', face: 'R', sides: 2 },
    ]);
    expect(last().message).toMatch(/Already have/);
    // Said structurally too, so a host that speaks it never parses the sentence.
    expect(last().shownAgain).toBe(true);
    expect(events.filter((e) => e.shownAgain).every((e) => /^Already have/.test(e.message))).toBe(
      true,
    );
    expect(events.some((e) => e.shownAgain && e.captured.length !== 2)).toBe(false);
  });

  it('announces a re-read as a re-read, and the look a confirm asked for as a confirm', async () => {
    const f = facesOf(DEEP);
    const bad = malformed(f.F);
    for (const face of FACES) await show(face === 'F' ? bad : f[face]);
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(completions).toEqual([]); // precondition: refused
    captures.length = 0;
    await show(f.F);
    expect(captures).toEqual([{ kind: 'reread', face: 'F', sides: 6 }]);

    panel.restart();
    await vi.advanceTimersByTimeAsync(TICK);
    await showAll(ONE_TURN, [0, 0, 0, 0, 0, 0]);
    expect(last().phase).toBe('confirm'); // precondition: one more look is needed
    const ask = last().confirm!;
    captures.length = 0;
    await answerConfirms(ONE_TURN);
    expect(captures[0]).toEqual({ kind: 'confirm', face: ask.face, sides: 6 });
    expect(captures.every((c) => c.kind === 'confirm')).toBe(true);
  });

  it('reports the read under way, and forgets it on every failed fit and every capture', async () => {
    const f = facesOf(DEEP);
    fake.output = tensorFor(f.U);
    await vi.advanceTimersByTimeAsync(TICK * 2);
    const reading = last().settling;
    expect(reading).not.toBeNull();
    expect(reading).toMatchObject({ needed: 3, neededMs: 500 });
    expect(reading!.run).toBeGreaterThanOrEqual(1);
    expect(last().captured).toHaveLength(0); // reading is not saved
    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().settling).toBeNull();
    await show(f.U);
    expect(captures).toHaveLength(1);
    const atCapture = events.findIndex((e) => e.captured.length === 1);
    expect(events[atCapture]!.settling).toBeNull();
  });
});

describe('ai-scan-panel — where each sticker sits in the camera picture', () => {
  // The boxes of every frame, placed in the picture the camera took rather than the model's padded
  // square, so a host can draw where the cube is and what is being read — including while no side
  // fits, which is when `live` is empty and exactly when someone needs to see it
  // (dev-docs/scan-guidance-plan.md 4.1).
  /** A detector output that also says what picture it came from — as the browser runtime's does. */
  it('places every box in the picture and marks the nine the face was fitted to', async () => {
    const f = facesOf(DEEP);
    fake.output = inFrame(tensorFor(f.U), 640, 480);
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect([last().seen!.width, last().seen!.height]).toEqual([640, 480]);
    const seen = last().seen!.stickers;
    expect(seen).toHaveLength(9);
    expect(seen.every((b) => b.inFace)).toBe(true);
    // tensorFor's first box is 30 wide at (100, 100) in the 640 square; a 640×480 picture is padded
    // 80 above and below, so in the picture it is at (100, 20).
    expect(seen[0]!.colour).toBe(f.U[0]);
    expect(seen[0]!.x).toBeCloseTo(100 / 640, 6);
    expect(seen[0]!.y).toBeCloseTo(20 / 480, 6);
    expect(seen[0]!.w).toBeCloseTo(30 / 640, 6);
    expect(seen[0]!.h).toBeCloseTo(30 / 480, 6);
    fake.output = null;
  });

  it('reports the boxes while no side fits, none of them as a face', async () => {
    const f = facesOf(DEEP);
    const eight = tensorFor(f.U);
    eight.data[(4 + f.U[8]!) * eight.anchors + 8] = 0; // the ninth sticker is not found
    // 640×480: a 4:3 picture, where the whole grid is inside the frame, so every box the detector
    // found is reported. (What happens to a box in a LETTERBOX's padding is `seenIn`'s own case
    // below — this one would report eight either way, and claiming otherwise here made it look
    // tested when it was not; audit, 2026-09-19.)
    fake.output = inFrame(eight, 640, 480);
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(last().live).toBeNull();
    expect(last().seen!.stickers).toHaveLength(8);
    expect(last().seen!.stickers.some((b) => b.inFace)).toBe(false);
    fake.output = null;
  });

  it('places boxes from a native picture size, with no pixels crossing', async () => {
    // The native plugins never hand the frame over; since wire version 2 the Apple plugin says the
    // picture's size, and that is all placing a box needs (dev-docs/scan-guidance-plan.md 5).
    fake.output = { ...tensorFor(facesOf(DEEP).U), picture: { width: 640, height: 480 } };
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect([last().seen!.width, last().seen!.height]).toEqual([640, 480]);
    expect(last().seen!.stickers[0]!.y).toBeCloseTo(20 / 480, 6);
    fake.output = null;
  });

  it('is empty for a frame with nothing found, and null with no picture to place boxes in', async () => {
    fake.output = inFrame(emptyTensor(), 640, 480);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().seen).toEqual({ width: 640, height: 480, stickers: [] });
    fake.output = tensorFor(facesOf(DEEP).U); // the native path: a tensor and no picture size
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().seen).toBeNull();
    fake.output = null;
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(last().seen).toBeNull(); // no frame is no observation
  });
});

describe('ai-scan-panel — what the camera showed is forgotten on every path that stops watching', () => {
  // `live`, `seen` and the read under way are one observation, forgotten together
  // (`forgetObservation`). Each path below once kept part of it (audit, 2026-09-19).
  it('painting after a camera stop carries no boxes and no read in progress', async () => {
    fake.output = inPicture(tensorFor(facesOf(DEEP).U));
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(last().seen).not.toBeNull();
    expect(last().settling).not.toBeNull();
    fake.output = null;
    panel.setPainting(true);
    expect(last().phase).toBe('painting');
    expect(last().seen).toBeNull();
    expect(last().settling).toBeNull();
    expect(last().live).toBeNull();
    panel.setPainting(false);
  });

  it('a camera that stops delivering withdraws the last frame with a report', async () => {
    fake.output = inPicture(tensorFor(facesOf(DEEP).U));
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(last().seen).not.toBeNull();
    const before = events.length;
    fake.output = null;
    await vi.advanceTimersByTimeAsync(TICK);
    expect(events.length).toBeGreaterThan(before); // said, not left standing
    expect(last().seen).toBeNull();
    expect(last().settling).toBeNull();
    const after = events.length;
    await vi.advanceTimersByTimeAsync(TICK * 3);
    // SAID ONCE: three more ticks over nothing send nothing. `every(e => e.seen === null)` passed
    // just as well over three fresh reports a second (audit, 2026-09-19).
    expect(events.length).toBe(after);
  });

  it('every kind of capture leaves no read in progress behind it', async () => {
    const f = facesOf(DEEP);
    const bad = malformed(f.F);
    const settlingAtCapture: Record<string, ScanProgress['settling'] | undefined> = {};
    panel.addEventListener('scan-capture', (e) => {
      const kind = (e as CustomEvent<ScanCapture>).detail.kind;
      queueMicrotask(() => {
        settlingAtCapture[kind] ??= last().settling;
      });
    });
    for (const face of FACES) await show(face === 'F' ? bad : f[face]);
    await vi.advanceTimersByTimeAsync(CHECK);
    await show(f.F); // a re-read of the refused side
    expect(settlingAtCapture.side).toBeNull();
    expect(settlingAtCapture.reread).toBeNull();
    // And the look a confirm asked for.
    panel.restart();
    await vi.advanceTimersByTimeAsync(TICK);
    const ONE_TURN = new Cube().move('U').asString();
    await showAll(ONE_TURN, [0, 0, 0, 0, 0, 0]);
    expect(last().phase).toBe('confirm'); // precondition
    await answerConfirms(ONE_TURN);
    expect(settlingAtCapture.confirm).toBeNull();
  });

  it('says a side shown again after a refusal is a repeat, and a nested report is not stamped', async () => {
    const f = facesOf(DEEP);
    const bad = malformed(f.F);
    for (const face of FACES) await show(face === 'F' ? bad : f[face]);
    await vi.advanceTimersByTimeAsync(CHECK);
    let nested: ScanProgress | null = null;
    let armed = true;
    panel.addEventListener('scan-progress', (e) => {
      if (armed && (e as CustomEvent<ScanProgress>).detail.shownAgain) {
        armed = false;
        panel.setPainting(true); // reports from inside the listener
        nested = last();
        panel.setPainting(false);
      }
    });
    await show(bad); // the identical reading again
    expect(events.some((e) => e.shownAgain && /reads the same as before/.test(e.message))).toBe(
      true,
    );
    expect(nested).not.toBeNull();
    expect(nested!.shownAgain).toBe(false);
  });
});

describe('seenIn — boxes placed in the picture', () => {
  const det = (cx: number, cy: number, w: number, h: number) => ({
    cx,
    cy,
    w,
    h,
    classId: 1,
    confidence: 0.9,
  });
  const output = {
    data: new Float32Array(0),
    anchors: 0,
    rows: 10,
    picture: { width: 640, height: 480 },
  };

  it('marks a face box by all four numbers, not by its corner alone', () => {
    const corner = (d: ReturnType<typeof det>) => [d.cx - d.w / 2, d.cy - d.h / 2, d.w, d.h];
    const faceBox = det(100, 100, 30, 30); // top-left (85, 85)
    const trap = det(110, 110, 50, 50); // top-left (85, 85) as well, and a different size
    const seen = seenIn(output, [faceBox, trap], [corner(faceBox)])!;
    expect(seen.stickers.map((s) => s.inFace)).toEqual([true, false]);
  });

  it('does not report a box centred in the letterbox padding', () => {
    // A 640×480 picture is padded 80 above and below; y = 30 is padding, y = 100 is picture.
    const seen = seenIn(output, [det(320, 30, 20, 20), det(320, 100, 20, 20)], undefined)!;
    expect(seen.stickers).toHaveLength(1);
    expect(seen.stickers.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1)).toBe(true);
  });
});

describe('ai-scan-panel — round-2 audit: listeners that act, ticks that fail', () => {
  it('a listener that restarts the scan on a capture event wins, and nothing after it claims the side', async () => {
    // The event used to go out in the middle of the capture path, which then carried on over the
    // state the listener had just cleared and reported a side the scan no longer held.
    let restarted = false;
    panel.addEventListener('scan-capture', () => {
      if (!restarted) {
        restarted = true;
        panel.restart();
      }
    });
    await show(facesOf(DEEP).U);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(restarted).toBe(true);
    expect(last().captured).toHaveLength(0);
    expect(last().sides).toBe(0);
    let after = -1;
    events.forEach((e, k) => {
      if (e.captured.length === 0 && e.sides === 0 && /Show any side/.test(e.message)) after = k;
    });
    // Found, before anything is said about what came after it: at -1 the slice below is the LAST
    // report alone, and would pass over a "Got the…" in between (audit, 2026-09-19).
    expect(after, 'the restart never reported a scan starting over').toBeGreaterThanOrEqual(0);
    expect(events.slice(after).some((e) => /Got the/.test(e.message))).toBe(false);
  });

  // The announcement waits for the capture path to finish; a listener to that path's OWN report can
  // restart the scan, stop it, switch to painting or take the side back in between, and a chime for a
  // moment that is gone is a lie (round-3 audit). One case per action, so a failure names the action
  // (audit, 2026-09-19).
  const CHANGES: Record<string, () => void> = {
    'restarting the scan': () => panel.restart(),
    'stopping the scanner': () => panel.stop(),
    'switching to painting': () => panel.setPainting(true),
    'taking the side back': () => panel.rescanFace('U'),
  };

  for (const [name, change] of Object.entries(CHANGES)) {
    it(`a capture is not announced when a listener answers its report by ${name}`, async () => {
      const announced: ScanCapture[] = [];
      panel.addEventListener('scan-capture', (e) =>
        announced.push((e as CustomEvent<ScanCapture>).detail),
      );
      let acted = false;
      panel.addEventListener('scan-progress', (e) => {
        if (!acted && (e as CustomEvent<ScanProgress>).detail.sides === 1) {
          acted = true;
          change();
        }
      });
      await show(facesOf(DEEP).U);
      await vi.advanceTimersByTimeAsync(TICK);
      expect(acted, 'the listener never saw the side it was waiting for').toBe(true);
      expect(announced, 'a capture was announced over it').toEqual([]);
    });
  }

  it('and with nothing in between, a capture is announced as usual', async () => {
    const announced: ScanCapture[] = [];
    panel.addEventListener('scan-capture', (e) =>
      announced.push((e as CustomEvent<ScanCapture>).detail),
    );
    await show(facesOf(DEEP).R);
    expect(announced).toEqual([{ kind: 'side', face: 'R', sides: 1 }]);
  });

  it('a failed inference withdraws the boxes and the read with the waiting line, not the last one', async () => {
    fake.output = inPicture(tensorFor(facesOf(DEEP).U));
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(last().message).toMatch(/Reading a side/);
    expect(last().seen).not.toBeNull();
    fake.failWith = new Error('a transient inference failure');
    await vi.advanceTimersByTimeAsync(TICK);
    fake.failWith = null;
    expect(last().seen).toBeNull();
    expect(last().settling).toBeNull();
    expect(last().message).toBe('Show any side to the camera.');
    fake.output = null;
  });

  it('a missing frame withdraws with the waiting line — "Reading a side" does not stand over nothing', async () => {
    fake.output = inPicture(tensorFor(facesOf(DEEP).U));
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(last().message).toMatch(/Reading a side/);
    fake.output = null;
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().message).toBe('Show any side to the camera.');
  });
});

describe('ai-scan-panel — the audit of 2026-09-20 (dev-docs/scanner-audit-2026-09-20.md)', () => {
  it('§1.7: a side shown again with two stickers read differently is the same side, not a collision', async () => {
    const shown = facesOf(DEEP);
    await show(shown.U);
    expect(last().sides).toBe(1);
    const again = [...shown.U];
    again[0] = (again[0]! + 1) % 6;
    again[8] = (again[8]! + 2) % 6;
    await show(again);
    expect(last().sides).toBe(1);
    expect(last().captured.map((c) => c.face)).toEqual(['U']);
    expect(last().message).toMatch(/Already have/);
  });

  it('§2.4: a captured side left in view is answered once per settle, not once per tick', async () => {
    const shown = facesOf(DEEP);
    await show(shown.U);
    const before = events.length;
    fake.output = tensorFor(shown.U);
    await vi.advanceTimersByTimeAsync(TICK * 40);
    fake.output = null;
    const repeats = events.slice(before).filter((p) => /Already have/.test(p.message)).length;
    expect(repeats).toBeGreaterThan(0);
    expect(repeats).toBeLessThanOrEqual(5);
  });

  it('§1.4: after a repair-assembled scan, a correction re-checks the colours that were ACCEPTED', async () => {
    // Two stickers read narrowly wrong (0.40 against 0.38 for the truth) and the count repair puts
    // them right; the captures kept here used to be the misread ones, so tapping any sticker wrong
    // and back again ended in a refusal of the cube on the board.
    const shown = facesOf(DEEP);
    const narrow = (colors: number[], wrongAt: number[]): ModelOutput => {
      const t = tensorFor(colors);
      const anchors = 9;
      for (const a of wrongAt) {
        const truth = colors[a]!;
        const wrong = (truth + 1) % 6;
        t.data[(4 + truth) * anchors + a] = 0.38;
        t.data[(4 + wrong) * anchors + a] = 0.4;
      }
      return t;
    };
    fake.output = narrow(shown.U, [0, 8]);
    await vi.advanceTimersByTimeAsync(TICK * SETTLE_TICKS);
    fake.output = null;
    for (const f of FACES) if (f !== 'U') await show(shown[f]);
    await vi.advanceTimersByTimeAsync(CHECK);
    // ONE LOOK FIRST (D1, 2026-09-23). A repaired sticker is a colour nobody observed, so the scan
    // names it and asks for the side again instead of accepting the cube. Answering the ask — the
    // same side, held as asked, read right this time — is what adopts the repair, and only then
    // does §1.4's property have anything to be about.
    expect(last().confirm?.face, 'the repair was accepted without a look').toBe('U');
    await answerConfirms(DEEP);
    expect(completions).toEqual([DEEP]);
    // Wrong, then back to what the board shows: the second re-check must accept, not refuse.
    panel.setSticker('R', 1, (shown.R[1]! + 1) % 6);
    await vi.advanceTimersByTimeAsync(CHECK);
    panel.setSticker('R', 1, shown.R[1]!);
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(completions.at(-1)).toBe(DEEP);
    expect(last().complete).toBe(true);
  });

  it('scan-complete says where the cube came from: camera, correction, painted', async () => {
    const origins: string[] = [];
    panel.addEventListener('scan-complete', (e) => {
      origins.push((e as CustomEvent<{ origin: string }>).detail.origin);
    });
    await showAll(DEEP, [0, 0, 0, 0, 0, 0]);
    const shown = facesOf(DEEP);
    panel.setSticker('R', 1, (shown.R[1]! + 1) % 6);
    await vi.advanceTimersByTimeAsync(CHECK);
    panel.setSticker('R', 1, shown.R[1]!);
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(origins).toEqual(['camera', 'correction']);
    panel.restart();
    panel.setPainting(true);
    for (const f of FACES) {
      for (let i = 0; i < 9; i++) if (i !== 4) panel.setSticker(f, i, shown[f][i]!);
    }
    expect(origins.at(-1)).toBe('painted');
  });

  it('§2.14: sides handed back together are named together when the camera reopens', async () => {
    await showAll(DEEP, [0, 0, 0, 0, 0, 0]);
    expect(last().phase).toBe('done'); // the camera is released on 'done'
    panel.rescanFace('L');
    panel.rescanFace('B');
    await vi.advanceTimersByTimeAsync(TICK);
    const said = events.map((p) => p.message).filter((m) => /read fresh/.test(m));
    expect(said.at(-1)).toMatch(/ORANGE and BLUE sides again/);
  });

  it('the headless template shows no picture: a 1px host, clipped, pointer-events none, and a laid-out video', () => {
    // D2: no camera picture is ever shown. The template is the whole of that promise for a headless
    // host, and nothing pinned it (verification gap, §2.16).
    const html = panel.shadowRoot?.innerHTML ?? '';
    expect(html).toMatch(/<video[^>]*playsinline/);
    expect(html).toMatch(/width:\s*1px;\s*height:\s*1px/);
    expect(html).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(html).toMatch(/pointer-events:\s*none/);
    expect(html).not.toMatch(/display:\s*none/);
  });
});

describe('ai-scan-panel — the audit fixes of 2026-09-21', () => {
  it('a reread adopts the look the assembler NAMED and lets the other looks at that side go', async () => {
    // With two looks at R on record, the assembler names the FIRST as the one that disagrees. The
    // panel used to adopt the LAST and keep both: the named look then went on disagreeing with
    // the adopted one, round after round, until the six-round cap refused the scan with a
    // "checking again" that never checked. Scripted, so the naming is exercised exactly (the
    // assembler's own naming is pinned in ai-assemble.test.ts); every branch below is the answer
    // a real assembler gives for that state of the looks and the reading.
    const shown = facesOf(DEEP);
    const C = shown.R; // the camera's capture of R
    const A = rotateFace([...C], 1); // the first look: R held another way up
    const B = [...A];
    for (const i of [0, 1, 2, 3]) B[i] = (B[i]! + 1) % 6; // the second look: four stickers off
    const key = (c: readonly number[]) => c.join();
    const reading = (colors: readonly number[]) =>
      key(colors) === key(C)
        ? 'C'
        : key(colors) === key(A)
          ? 'A'
          : key(colors) === key(B)
            ? 'B'
            : '?';
    const calls: string[] = [];
    seam.assembler = (faces, _threshold, confirmed) => {
      const r = reading((faces as Record<Face, ColorFace>).R.colors);
      const looks = (confirmed as Record<string, unknown[]> | undefined)?.R ?? [];
      calls.push(`${looks.length}:${r}`);
      const refused = { valid: false, facelets: '' };
      if (looks.length === 0)
        return { ...refused, ambiguous: true, confirm: { face: 'R', up: 'U' } };
      if (looks.length === 1 && r === 'C') {
        return { ...refused, ambiguous: true, confirm: { face: 'R', up: 'F' } };
      }
      if (looks.length === 1 && r === 'A') {
        return { valid: true, facelets: DEEP, confidence: 1, rotations: [0, 0, 0, 0, 0, 0] };
      }
      if (looks.length === 2 && r === 'C') {
        return { ...refused, reread: 'R', rereadLook: 0, confirm: { face: 'R', up: 'U' } };
      }
      if (looks.length === 2 && r === 'A') {
        return { ...refused, reread: 'R', rereadLook: 1, confirm: { face: 'R', up: 'F' } };
      }
      // The reading is B (or anything else): the first look disagrees with it.
      return { ...refused, reread: 'R', rereadLook: 0, confirm: { face: 'R', up: 'U' } };
    };
    const invalids: AiScanResult[] = [];
    panel.addEventListener('scan-invalid', (e) => {
      invalids.push((e as CustomEvent<AiScanResult>).detail);
    });
    try {
      await showAll(DEEP, [0, 0, 0, 0, 0, 0]);
      expect(last().confirm).toEqual({ face: 'R', up: 'U' });
      await show(A);
      await vi.advanceTimersByTimeAsync(CHECK);
      expect(last().confirm).toEqual({ face: 'R', up: 'F' });
      await show(B);
      await vi.advanceTimersByTimeAsync(CHECK);
      // Look 0 (A) adopted as the reading, look 1 (B) let go as one that disagrees with it, and the
      // next round accepted — never a "checking again" handed to the host as the verdict.
      expect(calls).toEqual(['0:C', '1:C', '2:C', '1:A']);
      expect(invalids.every((r) => r.reread === undefined)).toBe(true);
      expect(completions).toEqual([DEEP]);
    } finally {
      seam.assembler = null;
    }
  });

  it('a second look read wrong by four stickers ends in a refusal of the cube, and a re-show recovers', async () => {
    // The garbage look is adopted (it was taken under instruction), the cube it makes is not a
    // legal one, and the ordinary way out — show the side again — finishes the scan. The reread
    // never reaches the host as a verdict on this path either.
    const truth = new Cube().move("L R' F' B").asString();
    const invalids: AiScanResult[] = [];
    panel.addEventListener('scan-invalid', (e) => {
      invalids.push((e as CustomEvent<AiScanResult>).detail);
    });
    await showAll(truth, [0, 2, 1, 2, 2, 0]);
    const canonical = facesOf(truth);
    const asked: string[] = [];
    while (asked.length < 3 && last().phase === 'confirm') {
      const ask = last().confirm!;
      asked.push(`${ask.face}/${ask.up}`);
      const offset = holdOffset(colourOfSlot(ask.face), colourOfSlot(ask.up), 'western') ?? 0;
      const colors = rotateFace([...canonical[ask.face]], offset);
      if (asked.length === 3) for (const i of [0, 1, 2, 3]) colors[i] = (colors[i]! + 1) % 6;
      await show(colors);
      await vi.advanceTimersByTimeAsync(CHECK);
    }
    expect(asked).toEqual(['R/U', 'L/U', 'R/F']);
    expect(invalids.length).toBeGreaterThan(0);
    expect(invalids.every((r) => r.reread === undefined)).toBe(true);
    // The way out is the ordinary one: show the side again, and the scan finishes.
    await show(rotateFace([...canonical.R], 2));
    await vi.advanceTimersByTimeAsync(CHECK);
    await answerConfirms(truth);
    expect(completions).toEqual([truth]);
  });
});

describe('ai-scan-panel — a wedged native session is rebuilt on Start (2026-09-21)', () => {
  const DEADLINE = 15_000;
  /** A version-1 tensor as the plugin sends it: int32 rows, int32 anchors, then the floats, little-endian. */
  const wire = (t: ModelOutput): ArrayBuffer => {
    const buf = new ArrayBuffer(8 + t.data.length * 4);
    const view = new DataView(buf);
    view.setInt32(0, t.rows, true);
    view.setInt32(4, t.anchors, true);
    t.data.forEach((x, i) => {
      view.setFloat32(8 + i * 4, x, true);
    });
    return buf;
  };

  it('after the inference deadline stops the scan, Start compiles the model again and reads frames', async () => {
    // The recovery disposed the detector and cleared the model flag — and `NativeDetector` had no
    // dispose(), so its load() answered "already loaded" without crossing the bridge and every
    // Start after a timeout kept the wedged plugin session: the same fifteen seconds, the same
    // notice, until a reload. The real detector over a bridge whose first session never answers.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let loads = 0;
    const invoke = async (cmd: string): Promise<unknown> => {
      const name = cmd.replace(CUBE_VISION, '');
      if (name === 'load_model') loads++;
      if (name === 'current_camera') return { deviceId: 'native-1', label: 'Native' };
      if (name === 'next_detection') {
        if (loads < 2) await new Promise<void>(() => {}); // the first session's inference is lost
        return wire(tensorFor(facesOf(DEEP).U));
      }
      return null;
    };
    panel.stop();
    panel.useDetector(new NativeDetector(invoke), 'native');
    await panel.start();
    expect(loads).toBe(1);
    await vi.advanceTimersByTimeAsync(DEADLINE + TICK);
    await vi.advanceTimersByTimeAsync(DEADLINE + TICK);
    expect(last().phase).toBe('error');
    expect(last().notice?.title).toMatch(/scanner stopped/i);

    await panel.start();
    expect(loads).toBe(2); // a fresh session, not the wedged one
    await vi.advanceTimersByTimeAsync(TICK * SETTLE_TICKS);
    expect(last().captured).toHaveLength(1);
    logged.mockRestore();
  });
});

describe('ai-scan-panel — a lost inference worker is rebuilt on Start (2026-09-22)', () => {
  it('after the worker dies the scan stops, and Start loads the model again and reads frames', async () => {
    // The browser runtime runs in a worker the page owns, so it can be released — and so it can be
    // lost. Every frame asked of a lost worker fails with the same name, and the recovery is the
    // one a wedged runtime gets: the scan stops with a way back, and Start builds the model again.
    // Without that, `modelLoaded` stayed true, Start skipped the load, and every Start ended in the
    // same three seconds of failures over a worker that no longer existed.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    class LosingDetector extends FakeDetector {
      loads = 0;
      disposed = 0;
      lost = false;
      override async load(): Promise<void> {
        this.loads++;
        this.lost = false;
      }
      dispose(): void {
        this.disposed++;
        this.stop();
      }
      override async next(): Promise<ModelOutput | null> {
        if (this.lost)
          throw new InferenceWorkerLostError('the inference worker failed: out of memory');
        return super.next();
      }
    }
    const det = new LosingDetector();
    det.output = tensorFor(facesOf(DEEP).U);
    panel.stop();
    panel.useDetector(det, 'web');
    await panel.start();
    expect(det.loads).toBe(1);
    det.lost = true;
    await vi.advanceTimersByTimeAsync(3000 + TICK * 3); // TICK_FAIL_MS of lost frames
    expect(last().phase).toBe('error');
    expect(det.disposed).toBe(1);

    await panel.start();
    expect(det.loads).toBe(2); // a new worker, not the lost one
    await vi.advanceTimersByTimeAsync(TICK * SETTLE_TICKS);
    expect(last().captured).toHaveLength(1);
    logged.mockRestore();
  });
});

describe('classifyRefusal — the notice and the line say the same thing (2026-09-21)', () => {
  const refused = (extra: Partial<AiScanResult>): AiScanResult =>
    ({ valid: false, facelets: '', ...extra }) as AiScanResult;

  it('takes the misread notice first, and lets its action choose the line', () => {
    const notice: ScanNotice = { title: 'Some stickers were misread', tone: 'err', body: 'x' };
    expect(classifyRefusal(refused({}), notice)).toEqual({
      notice,
      line: "That isn't a solvable cube yet — fix a sticker, or show a side again.",
    });
    const restart = { ...notice, action: { label: 'Start over', kind: 'restart' as const } };
    expect(classifyRefusal(refused({ ambiguous: true }), restart).line).toMatch(
      /start the scan over/,
    );
  });

  it('names each category by the most specific fact the assembler established', () => {
    // TWO CATEGORIES FEWER SINCE 2026-09-23. "Some middle stickers kept changing" and "Two sides
    // read the same centre" were set by `resolveCentres` and by nothing else; with the resolution
    // gone nothing can produce either, so they were deleted rather than left as branches no input
    // reaches and only a hand-built result object could test.
    const say = (extra: Partial<AiScanResult>) => classifyRefusal(refused(extra), null);
    expect(say({ schemeAmbiguous: true, ambiguous: true }).notice.title).toBe(
      'Which colour is under white?',
    );
    expect(say({ ambiguous: true }).notice.title).toBe('Too symmetric to tell');
    expect(say({}).notice.title).toBe("That doesn't read as a solvable cube");
  });

  it('a cube that reads several ways is never called unsolvable on the line', () => {
    const say = (extra: Partial<AiScanResult>) => classifyRefusal(refused(extra), null).line;
    expect(say({ ambiguous: true })).not.toMatch(/solvable/);
    expect(say({ schemeAmbiguous: true, ambiguous: true })).not.toMatch(/solvable/);
  });
});

describe('ai-scan-panel — the card says one thing long enough to read it (2026-09-24)', () => {
  // MEASURED BEFORE IT WAS BUILT, over seventeen recorded sessions replayed through this panel: the
  // caption changed 810 times, the median one lasting 120 ms and 83% of them under half a second.
  // Nobody reads a sentence in 120 ms. The dominant cause was a fit succeeding and failing on
  // alternate frames, which made "Reading a side" and "Show any side to the camera." alternate at
  // the tick rate — 532 of those short runs between them, and to the person holding the cube they
  // are ONE situation. Remembering a fit for half a second took the pair to 62, the run count to
  // 365 and the median to 360 ms.
  //
  // WHAT IS NOT FIXED HERE, and was tried and taken out rather than left half-built: about forty
  // captions the person most needs to read — "Got the YELLOW side — 1/6…", "Already have the BLUE
  // side…" — still last under half a second, because the next tick's caption replaces them. Making
  // the tick defer to those needs `idleLine` split first: it returns ambient commentary AND the
  // confirm ask, the finished line and the stall, and a blunt hold suppressed all four.

  it('a fit that drops out for one frame does not flip the caption', async () => {
    const shown = facesOf(DEEP);
    // Two ticks of a face, then ONE empty frame, then the face again — the dropout that used to
    // read as "the cube went away" and print the idle line for a single frame.
    fake.output = tensorFor(shown.U);
    await vi.advanceTimersByTimeAsync(TICK * 2);
    const reading = last().message;
    expect(reading, 'precondition: a fitted face says it is reading').toMatch(/Reading a side/);

    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().message, 'one dropped frame changed the caption').toBe(reading);

    // …and putting the cube down for longer than the grace DOES fall back, or the caption would be
    // a claim about a cube nobody is holding.
    await vi.advanceTimersByTimeAsync(700);
    expect(last().message).not.toMatch(/Reading a side/);
  });

  it('continues a reading caption but never revives one over what came after it', async () => {
    // THE CONDITION THAT MAKES THE GRACE SAFE. Without it the grace painted "Reading a side" back
    // over the caption a capture had just written: a filed side is followed at once by frames that
    // fit nothing while the cube is still in view, and every one of them was inside the window. The
    // same overwrote the ask for one more look and the finished line — four cases in this file.
    const shown = facesOf(DEEP);
    await show(shown.U);
    const said = last().message;
    expect(said, 'precondition: a capture says which side it got').toMatch(/Got the/i);

    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().message, 'the grace revived "Reading a side" over a capture').not.toMatch(
      /Reading a side/,
    );
  });

  it('holding the caption never holds the REPORT: the tiles and the count stay current', async () => {
    // The words are the only thing the grace touches. A report whose side count or captured list
    // lagged with the sentence would be the fix creating a worse bug than the one it closes.
    const shown = facesOf(DEEP);
    await show(shown.U);
    await show(shown.R);
    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().sides).toBe(2);
    expect(
      last()
        .captured.map((c) => c.face)
        .sort(),
    ).toEqual(['R', 'U']);
  });
});

describe('ai-scan-panel — the sixth side is determined, so its centre is not read (2026-09-24)', () => {
  // THE OWNER'S CALL, from a photograph rather than a statistic. Most speedcubes print a logo across
  // the white centre cap, and the app samples a sticker's inner 60% — which on such a cap is mostly
  // ink. Measured on a GAN cube through the app's own detector: all EIGHT ring stickers read
  // correctly and the cap read BLUE at 0.37, where real blue stickers on that same face read
  // 0.65–0.78. So the face is identified by its eight, and the sixth slot is arithmetic: one centre
  // of each colour means five held leaves the sixth determined.

  it('files a face whose centre collides, when it is the only side left', async () => {
    const shown = facesOf(DEEP);
    // Five sides by their own centres, the ordinary way.
    for (const f of ['R', 'F', 'D', 'L', 'B'] as Face[]) await show(shown[f]);
    expect(last().sides).toBe(5);

    // The sixth is U, and its centre reads as a colour already held — a logo cap. Its eight stand.
    const logoCap = [...shown.U];
    logoCap[4] = colourOfSlot('B'); // the cap's ink, not the cube's colour
    await show(logoCap);

    expect(last().sides, 'the determined sixth side was refused').toBe(6);
    expect(
      last()
        .captured.map((c) => c.face)
        .sort(),
    ).toEqual(['B', 'D', 'F', 'L', 'R', 'U']);
    await vi.advanceTimersByTimeAsync(CHECK);
    // And the cube it completes with is the real one: the centre came from the slot, the eight from
    // the camera, and the assembler checked it as it checks any other reading.
    expect(completions).toEqual([DEEP]);
  });

  it('still refuses a collision while more than one side is missing', async () => {
    // The rule is arithmetic, not a preference: with two slots free the sixth is NOT determined and
    // nothing here can say which of the two readings is the misread one.
    const shown = facesOf(DEEP);
    for (const f of ['R', 'F', 'D', 'L'] as Face[]) await show(shown[f]);
    expect(last().sides).toBe(4);
    const logoCap = [...shown.U];
    logoCap[4] = colourOfSlot('L');
    await show(logoCap);
    expect(last().sides, 'a collision was filed with two slots still free').toBe(4);
    expect(last().message).toMatch(/Two sides are reading as/);
  });

  it('never invents a cube: a sixth side that does not assemble is still refused', async () => {
    // The centre is taken from the slot, but everything else is still checked. A face whose EIGHT
    // are wrong cannot be rescued by knowing which slot it belongs in, and must not be.
    const shown = facesOf(DEEP);
    for (const f of ['R', 'F', 'D', 'L', 'B'] as Face[]) await show(shown[f]);
    const rubbish = [...shown.U];
    for (const i of [0, 1, 2, 3, 5]) rubbish[i] = (rubbish[i]! + 1) % 6;
    rubbish[4] = colourOfSlot('B');
    await show(rubbish);
    await vi.advanceTimersByTimeAsync(CHECK);
    expect(completions, 'a cube was completed from eight wrong stickers').toEqual([]);
  });
});
