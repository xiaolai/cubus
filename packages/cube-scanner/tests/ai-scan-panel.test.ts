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

const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const TICK = 200; // TICK_MS_WEB — the fake detector registers as the 'web' runtime
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
  return { data, anchors };
}

/** A frame with nothing on it — decodes to zero detections, i.e. a NO_FACE abstention. */
const emptyTensor = (): ModelOutput => ({ data: new Float32Array((4 + 6) * 9), anchors: 9 });

class FakeDetector implements Detector {
  device: CameraDevice | null = null;
  output: ModelOutput | null = null;
  async use(_opts?: CameraOptions): Promise<void> {
    this.device = { deviceId: 'fake', label: 'Fake Camera' };
  }
  async load(): Promise<void> {}
  async next(): Promise<ModelOutput | null> {
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

/** Hold one face in front of the fake camera until it is captured (4 stable ticks), then remove it. */
async function show(colors: number[]): Promise<void> {
  fake.output = tensorFor(colors);
  // STABLE=3 identical reads plus STABLE_MS=500 of stillness: reads land at t+200/400/600/800,
  // and the 800 ms read is the first that is both 3-stable and 500 ms old — the 4th tick.
  await vi.advanceTimersByTimeAsync(TICK * 4);
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
  vi.useFakeTimers();
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
    await vi.advanceTimersByTimeAsync(TICK * 3); // 3 reads, but the streak is only 400 ms old
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
    expect(p.notice?.title).toMatch(/sticker looks wrong/i);
    expect(p.suspects).toContainEqual({ face: 'F', index: 0, to: F_TRUE });
    // The pin: a later tick's transient hint must not erase the notice — and with all six sides
    // in, the idle line offers a re-read, not "show any side" (there is no side left to show).
    fake.output = emptyTensor();
    await vi.advanceTimersByTimeAsync(TICK);
    fake.output = null;
    expect(last().message).toMatch(/re-read/);
    expect(last().notice?.title).toMatch(/sticker looks wrong/i);
    expect(last().captured).toHaveLength(6);
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

  it('toggling painting off and on keeps the sides already captured', async () => {
    const shown = facesOf(DEEP);
    await show(shown.U);
    await show(shown.R);
    panel.setPainting(true);
    expect(last().device).toBeNull();
    panel.setPainting(false);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(last().captured).toHaveLength(2);
  });
});
