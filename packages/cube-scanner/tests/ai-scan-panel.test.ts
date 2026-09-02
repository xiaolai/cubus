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
    if (this.openFails === 'always') throw new Error('camera denied');
    if (this.openFails === 'pinned' && opts?.deviceId) throw new Error('that camera is gone');
    this.device = { deviceId: opts?.deviceId ?? 'fake', label: 'Fake Camera' };
  }
  async load(): Promise<void> {}
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
    await vi.advanceTimersByTimeAsync(TICK * 3); // 3 reads, only 400 ms of stillness — not yet
    expect(last().captured).toHaveLength(0);
    fake.output = null; // the camera stalls
    await vi.advanceTimersByTimeAsync(TICK);
    fake.output = tensorFor(shown.U); // the same read comes back
    await vi.advanceTimersByTimeAsync(TICK * 3);
    // The run restarted at the first read AFTER the stall, so this is 400 ms old, not 1200.
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
