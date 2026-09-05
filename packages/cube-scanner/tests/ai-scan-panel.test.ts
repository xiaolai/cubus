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
import { rotateFace } from '../src/ai-assemble.js';
import type { AiScanResult } from '../src/ai-assemble.js';
import type { CameraDevice, CameraOptions } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import { FACES, type Face } from '../src/types.js';
import { AiScanPanel, type ScanProgress } from '../view/ai-scan-panel.js';
import {
  type MisreadReply,
  type MisreadRequest,
  handleMisreadRequest,
} from '../view/misread-protocol.js';

// A SEAM ON THE ONE CALL THAT COSTS SECONDS, and a pass-through in every other respect.
//
// "The misread decode does not run on the calling thread" is otherwise unfalsifiable from outside
// the element: a refusal that decoded and threw the answer away paints exactly like one that never
// decoded at all — it just takes up to three seconds longer, which no assertion about the DOM can
// see. Counting the calls is the only way to state it, so the count is what is asserted.
const seam = vi.hoisted(() => ({ decodes: 0 }));
vi.mock('../src/misread-decode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/misread-decode.js')>();
  return {
    ...actual,
    diagnoseMisread: (...args: Parameters<typeof actual.diagnoseMisread>) => {
      seam.decodes++;
      return actual.diagnoseMisread(...args);
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

/** Encode 9 colour classes as a raw YOLO output tensor laid out as a clean 3x3 grid. */
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
  /** Every `use()` call, so a test can see whether the pinned deviceId was dropped on retry. */
  uses: (CameraOptions | undefined)[] = [];
  /** Make `use()` throw — always, or only when a deviceId is pinned (an unplugged webcam). */
  openFails: 'never' | 'always' | 'pinned' = 'never';
  async next(): Promise<ModelOutput | null> {
    if (this.failWith) throw this.failWith;
    return this.output;
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
    let colors = [...canonical[ask.face]];
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

describe('ai-scan-panel — capture and settle', () => {
  // A deep scramble reads uniquely, so six sides held any way up settle with no extra look.
  const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

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
    expect(p.notice?.title).toBe('More than one sticker looks wrong');
    expect(p.notice?.body).toContain('%1'); // …and the count arrives as a param, not baked in
    expect(p.notice?.params?.[0]).toBeGreaterThanOrEqual(2);
    // Never the old singular, which asserted exactly what the decoder had just ruled out.
    expect(p.notice?.body).not.toMatch(/A sticker was misread somewhere/);
    expect(p.notice?.body).not.toMatch(/Tap any sticker/);
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
  const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

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
  const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

  it('start() — a camera switch — keeps the sides already captured', async () => {
    const shown = facesOf(DEEP);
    await show(shown.U);
    await show(shown.R);
    expect(last().captured).toHaveLength(2);
    await panel.start();
    expect(last().captured).toHaveLength(2);
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
});

describe('ai-scan-panel — an instruction survives the camera reopening', () => {
  const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

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
  const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

  it('says which sticker keeps changing instead of repeating "hold still"', async () => {
    // The gate keys on all nine colours, so ONE sticker flickering between red and orange — the
    // detector's known weak pair — means no run ever completes and the side is never captured.
    // That was a dead end with no message: "hold still" for as long as the user was willing.
    const face = [...facesOf(DEEP).U];
    const other = (face[2]! + 1) % 6;
    for (let i = 0; i < 12; i++) {
      face[2] = i % 2 === 0 ? facesOf(DEEP).U[2]! : other;
      fake.output = tensorFor(face);
      await vi.advanceTimersByTimeAsync(TICK);
    }
    expect(last().captured).toHaveLength(0); // it genuinely never settles
    expect(last().message).toMatch(/top right sticker keeps changing colour/i);
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
    expect(last().notice?.title).toBe('More than one sticker looks wrong');
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
    const asked = FakeWorker.last().posted.length; // the half-painted strokes asked too
    panel.setSticker('U', 0, (truth.U![0]! + 1) % 6);

    expect(seam.decodes).toBe(before);
    expect(last().notice?.body ?? '').toMatch(/working out how many/i);
    const worker = FakeWorker.last();
    expect(worker.posted).toHaveLength(asked + 1);
    const mine = worker.posted.length - 1;
    expect(worker.posted[mine]!.fixedRotation).toBe(true);
    // An earlier stroke's answer, arriving late, must say nothing about this reading.
    const settled = last();
    worker.answer(0);
    expect(last()).toBe(settled);
    worker.answer(mine);
    expect(last().suspects).toContainEqual({ face: 'U', index: 0, to: truth.U![0]! });
  });
});
