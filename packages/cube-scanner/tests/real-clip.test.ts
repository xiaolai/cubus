// @vitest-environment happy-dom
//
// A REAL SCAN, REPLAYED. Twenty seconds of a person at a desk showing all six sides of a cube whose white
// centre carries a blue logo, recorded 2026-09-18 on the camera the desktop app uses, then read by the
// shipped detector frame by frame. Released 0.6.0 captured NOTHING from it: a box on something in the
// room behind broke the grid on three frames in four, and the logo made the white side a second yellow.
//
// The fixture is what the detector saw and nothing else — for each of the 612 frames, the boxes the
// app's own decode keeps (position, size, and the six colour scores), after its NMS and nested-box
// removal. Re-running those on boxes already through them changes nothing, so the panel reads exactly
// what it read live. There is no image in it.
//
// It drives the real panel, on the panel's own clock, the way the other panel tests do: the only
// difference is that the frames are real.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraDevice } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import { AiScanPanel, type ScanCapture, type ScanProgress } from '../view/ai-scan-panel.js';
import { schemeShownIn } from '../view/session-replay.js';

// A path, not `new URL(…, import.meta.url)`: under happy-dom the module's URL is not a file URL.
const clip = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'logo-cube-clip.json'), 'utf8'),
) as { fps: number; frames: number[][][] };

const frames: ModelOutput[] = clip.frames.map((dets) => {
  const anchors = Math.max(dets.length, 1);
  const data = new Float32Array(10 * anchors);
  dets.forEach((row, a) => {
    for (let k = 0; k < 10; k++) data[k * anchors + a] = row[k]!;
  });
  return { data, anchors, rows: 10 };
});
const CLIP_MS = (frames.length / clip.fps) * 1000;
const TICK = 60;

/** The recorded frames as a camera: whichever frame was on screen when the panel asks. */
class ClipDetector implements Detector {
  device: CameraDevice | null = null;
  private t0: number | null = null;
  async use(): Promise<void> {
    this.device = { deviceId: 'clip', label: 'Recorded clip' };
  }
  async load(): Promise<void> {}
  async next(): Promise<ModelOutput | null> {
    const now = performance.now();
    if (this.t0 === null) this.t0 = now;
    return frames[Math.floor(((now - this.t0) / 1000) * clip.fps)] ?? null;
  }
  async cameras(): Promise<CameraDevice[]> {
    return this.device ? [this.device] : [];
  }
  stop(): void {
    this.device = null;
  }
}

let panel: AiScanPanel;
let events: ScanProgress[];
let completions: string[];
/** Each `scan-capture`, with the sides the LATEST report held when it arrived — the announcement is
 *  queued after the filing report, so the report it belongs to is the last one sent, not the next. */
let captures: { faces: (string | null)[]; detail: ScanCapture }[];
/** Every identity question the run raised, in order, with what was answered to it. */
let asked: {
  id: number;
  claimed: number;
  displaced: boolean;
  choices: number[];
  answered: number | null;
}[];
const last = () => events[events.length - 1]!;

beforeEach(() => {
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
});

afterEach(() => {
  panel.remove();
  vi.useRealTimers();
});

/**
 * Drive the whole clip through the real panel, and answer the scan's identity question the way
 * `answer` says — or leave it standing, which is a person who does not answer.
 *
 * CALLED BY EACH TEST rather than from a hook, because what the person does is the variable: the
 * clip is the same twenty seconds either way, and a hook cannot be told which run this is.
 */
async function runClip(
  answer?: (ask: { claimed: number; displaced: boolean; choices: number[] }) => number | null,
): Promise<void> {
  events = [];
  completions = [];
  captures = [];
  asked = [];
  panel = new AiScanPanel();
  panel.setAttribute('headless', '');
  document.body.appendChild(panel);
  panel.useDetector(new ClipDetector(), 'native');
  panel.addEventListener('scan-progress', (e) => {
    const p = (e as CustomEvent<ScanProgress>).detail;
    events.push(p);
    // THE PERSON, standing in. A question is answered ONCE — `answerIdentity` clears it, and a
    // report during that call would otherwise re-enter here — and answering `null` is the person
    // who cannot name the colour, which leaves the question standing exactly as it would be.
    if (!p.identity || !answer) return;
    // KEYED ON THE QUESTION'S ID, not on the colour it is about. Since an answer naming a held
    // colour takes that side back and asks about IT, two questions in one run can share a
    // `claimed` — and keying on the colour answered the first and silently swallowed the second.
    const ask = {
      id: p.identity.id,
      claimed: p.identity.claimed,
      displaced: p.identity.displaced,
      choices: [...p.identity.choices],
    };
    if (asked.some((a) => a.id === ask.id && a.answered !== null)) return;
    const said = answer(ask);
    asked.push({ ...ask, answered: said });
    if (said !== null) panel.answerIdentity(said);
  });
  panel.addEventListener('scan-capture', (e) =>
    captures.push({
      faces: last().captured.map((c) => c.face),
      detail: (e as CustomEvent<ScanCapture>).detail,
    }),
  );
  panel.addEventListener('scan-complete', (e) =>
    completions.push((e as CustomEvent<{ facelets: string }>).detail.facelets),
  );
  await panel.start();
  for (let t = 0; t < CLIP_MS + 1500; t += TICK) await vi.advanceTimersByTimeAsync(TICK);
}

/**
 * The cube as it physically was, reached two ways that share nothing but the detector: this fixture
 * completes to it on its own, and the full-precision replay of the same clip reached it after the one
 * tap the scan asked for (U, sticker 3, to yellow). The two runs file different frames, so agreeing on
 * one cube is agreement about the cube, not about a frame.
 */
const TRUTH = 'RLFDUDFBUFLLRRFUBFUULFFULBRDRBRDLUDDBRRLLUBFBDUDDBFRBL';
/** URFDLB, for reading one side out of `TRUTH`. */
const CLIP_FACES = 'URFDLB';

describe('a real scan of a cube with a logo on its white centre', () => {
  it('captures the five sides whose centres it can read \u2014 and not the logo side', async () => {
    await runClip();
    // WHAT THE REMOVAL COSTS, ON THE VERY CLIP IT WAS BUILT FOR (2026-09-23, the owner's call).
    //
    // This case asserted all six. The white side of this cube has a blue logo printed on its centre,
    // and the detector reads that centre as anything but white — yellow on every frame of this clip,
    // blue and green on later recordings of the same cube. Five fixes over ten days existed to place
    // it anyway: the side was held UNNAMED and `resolveCentres` gave it the slot left over at six.
    //
    // That machinery is gone. A side is its centre; a centre that cannot be read names nothing, and
    // nothing is filed. So this clip now ends at FIVE, and the sixth side is the person's to paint.
    // The number is here rather than in prose because it is the price of the decision, and a later
    // change that makes the white side readable again should have to come here and say so.
    expect(
      last()
        .captured.map((c) => c.face)
        .sort(),
    ).toEqual(['B', 'D', 'F', 'L', 'R']);
  });

  it('does not finish: the logo face was shown too early for the sixth-side rule', async () => {
    await runClip();
    // NOT A LIMIT OF THE RULE — A LIMIT OF THIS RECORDING (2026-09-24). Since the sixth side became
    // determined, a face whose centre collides IS filed when exactly one slot is free. Traced
    // against this clip: the logo face settles at 6.4 s with only TWO sides held, so four slots are
    // free, the sixth is not determined, and refusing is right. The fifth side lands at 17.0 s and
    // the person never returns to the logo face before the clip ends.
    //
    // That is why the scan asks for the missing side BY NAME once five are in ("still need WHITE"):
    // it is what puts the logo face last in the ordinary flow, where its centre need not be read.
    // The clip is 20 seconds and the scan makes progress throughout it, so the stall bound
    // (12 s without a capture, `ai-scan-panel.test.ts`) is not what ends this — the clip simply runs
    // out. What matters here is that five sides produce no cube: there is no path from an incomplete
    // scan to a completion, and the sixth side is the person's to paint or to show again.
    expect(completions).toEqual([]);
  });

  it('never tells the person to fit the side in the frame, and never ends the scan', async () => {
    await runClip();
    expect(events.some((e) => /whole side in the frame/i.test(e.message))).toBe(false);
    expect(events.some((e) => e.notice?.action?.kind === 'restart')).toBe(false);
  });

  it('never reports a cube that is not the cube', async () => {
    await runClip();
    // The whole of D1's purpose, as a standing assertion on a real recording: whatever the scan
    // does here, it does not complete with something that is not TRUTH.
    for (const facelets of completions) expect(facelets).toBe(TRUTH);
  });

  it('announces every side it files, once, as it files it', async () => {
    await runClip();
    // A host plays its capture sound on this event, so it must match the filing exactly: every side
    // filed is announced, the count rises by one each time, and each announcement names a side that
    // is in the report it arrived with. An announcement for a side filed under no name is no longer
    // possible — a capture the panel cannot name is refused rather than held.
    expect(captures.map((c) => c.detail.sides)).toEqual([1, 2, 3, 4, 5]);
    expect(captures.every((c) => c.detail.kind === 'side')).toBe(true);
    // Each announcement names a side filed AT THAT MOMENT: in the report it arrived with, and not in
    // the one before it. Sides stay filed for the rest of the scan, so "it is in the list" alone
    // passes for an announcement naming a side filed three captures ago (audit, 2026-09-19).
    let before: (string | null)[] = [];
    for (const { faces, detail } of captures) {
      expect(detail.face, 'a capture was announced with no side named').not.toBeNull();
      expect(faces, `${detail.face} was announced but not filed`).toContain(detail.face);
      expect(before, `${detail.face} was announced again`).not.toContain(detail.face);
      before = faces;
    }
    const named = captures.flatMap((c) => (c.detail.face ? [c.detail.face] : [])).sort();
    expect(named).toEqual(['B', 'D', 'F', 'L', 'R']);
  });
});

describe('the identity question on this clip, and why it cannot rescue it (plan §5)', () => {
  // §5 EXPECTED THIS CLIP TO COMPLETE WITH THE TRUE CUBE ONCE THE QUESTION WAS ANSWERED. Executed,
  // it does not, and the reason is worth more than the expectation was: ON THIS RECORDING THE LOGO
  // SIDE IS SHOWN FIRST. Its cap reads YELLOW, yellow is free at 720 ms, so it is filed under
  // yellow by its own centre with no collision to ask about — the ordering `fileLastSide`'s comment
  // already names as its stated limit, here on the very clip the plan was written for.
  //
  // The collision at 6.4 s is therefore raised about the REAL yellow side, whose colour is already
  // taken. §5's question names the FREE slots, so the one answer that would place it correctly is
  // not among them, and nothing a person can say here puts this cube together.
  //
  // MEASURED, NOT ARGUED, against the clip's own TRUTH and up to rotation (the camera cannot see
  // which way up a side was held). The two cases below are the evidence; the third is the promise
  // that holds through all of it.
  const WHITE = 0;
  const YELLOW = 3;
  const QUARTER = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  const truthOf = (f: string): number[] =>
    [...TRUTH.slice(CLIP_FACES.indexOf(f) * 9, CLIP_FACES.indexOf(f) * 9 + 9)].map((c) =>
      CLIP_FACES.indexOf(c),
    );
  /** How many of the EIGHT around the centre agree, at the best of the four rotations. The centre
   *  is left out on purpose: it is the one sticker under discussion. */
  const ringAgreement = (read: readonly number[], want: readonly number[]): number => {
    const ring = (v: readonly number[]): number[] => v.filter((_, i) => i !== 4);
    let best = 0;
    let turned = [...read];
    for (let k = 0; k < 4; k++) {
      const a = ring(turned);
      const b = ring(want);
      best = Math.max(best, a.filter((c, i) => c === b[i]).length);
      turned = QUARTER.map((i) => turned[i]!);
    }
    return best;
  };

  it('files the white side under YELLOW before any question can be asked', async () => {
    await runClip();
    // The first capture of the whole clip, and it is the logo side wearing another side's name.
    expect(captures[0]?.detail.face).toBe('D');
    expect(captures[0]?.detail.by).toBe('centre');
    const filedAsYellow = last().captured.find((c) => c.face === 'D')!;
    expect(
      ringAgreement(filedAsYellow.colors, truthOf('U')),
      'the first capture is not the white side',
    ).toBe(7);
    expect(ringAgreement(filedAsYellow.colors, truthOf('D'))).toBeLessThan(7);
  });

  it('so the question is asked about the real yellow side, and yellow IS on offer', async () => {
    await runClip((ask) => (ask.choices.includes(WHITE) ? WHITE : null));
    expect(asked.map((a) => a.claimed)).toEqual([YELLOW]);
    // THE ANSWER THAT IS RIGHT IS ON OFFER (owner's call, 2026-09-25). Yellow is held — by the
    // white side — and it is offered anyway, because a question that will not take its own true
    // answer is worse than no question. This run declines it and names WHITE instead, which is the
    // free-slot answer the old rule forced; the run below takes it.
    expect(asked[0]?.choices).toContain(YELLOW);
    expect(asked[0]?.displaced).toBe(false);
    // And the capture the question is about really is the yellow side, exactly.
    const answeredInto = last().captured.find((c) => c.face === 'U')!;
    expect(answeredInto.by).toBe('assigned');
    expect(
      ringAgreement(answeredInto.colors, truthOf('D')),
      'the question is not about the yellow side',
    ).toBe(8);
  });

  it('and answering with the held colour takes the white side back, finishing the true cube', async () => {
    // THE ORDERING §5's ACCEPTANCE COULD NOT REACH, now that it can be answered. On this clip the
    // logo side is shown FIRST and takes yellow's slot by its own centre, so the question is raised
    // about the REAL yellow side — whose honest answer the free-colours-only list refused, leaving
    // the person to skip and elimination to file the two swapped. Naming yellow takes the white
    // side back and asks about THAT reading, and the second answer puts it where it belongs.
    const said: number[] = [];
    await runClip((ask) => {
      const pick = ask.displaced ? WHITE : YELLOW;
      if (!ask.choices.includes(pick)) return null;
      said.push(pick);
      return pick;
    });
    expect(said, 'the two answers the cure takes').toEqual([YELLOW, WHITE]);
    expect(asked.map((a) => a.displaced)).toEqual([false, true]);
    // The displaced question may NOT be answered with the colour just given away, or the two
    // readings could trade it for ever.
    expect(asked[1]?.choices).not.toContain(YELLOW);
    expect(last().sides).toBe(6);
    // EVERY SIDE IS NOW IN ITS TRUE SLOT — the swap this ordering used to produce is gone. Five are
    // the truth exactly; the white side is one sticker short, which is the detector misreading the
    // logo face and not a placement at all. Under the old rule the same clip put white in yellow's
    // slot and yellow in white's (the test above), so this is the measured difference the owner's
    // call buys.
    for (const c of last().captured) {
      expect(
        ringAgreement(c.colors, truthOf(c.face)),
        `the ${c.face} slot does not hold the ${c.face} side`,
      ).toBeGreaterThanOrEqual(7);
    }
    const white = last().captured.find((c) => c.face === 'U')!;
    expect(white.by).toBe('assigned');
    expect(ringAgreement(white.colors, truthOf('U')), 'the logo face read clean').toBe(7);
    // AND STILL NO CUBE, for a reason that is now about one sticker rather than two whole sides:
    // the reading is not the cube, so it is refused and the scan asks for that side again. The
    // whole-cube promise is doing its job; "completes" was never the thing to gate on (§6).
    expect(completions).toEqual([]);
    expect(last().message).toContain('re-read just that side');
  });

  it('reaches six sides where it reached five — and still reports no cube', async () => {
    // The dead end is gone: the capture is kept, placed, and the scan runs on to six. The cube it
    // would make is not this cube, so it is refused — which is the whole-cube promise doing exactly
    // its job, and is why "completes" was never the thing to gate on.
    await runClip((ask) => ask.choices[0] ?? null);
    expect(last().sides).toBe(6);
    expect(completions).toEqual([]);
  });

  it('no answer, right or wrong, reports a cube that is not the cube', async () => {
    // THE GATE §6 STATES, over every answer the question admits: no configuration may report a cube
    // that is not the cube. Every free colour is tried, one run each.
    for (const pick of [0, 1, 2, 3, 4, 5]) {
      await runClip((ask) => (ask.choices.includes(pick) ? pick : null));
      for (const facelets of completions) expect(facelets).toBe(TRUTH);
      panel.remove();
    }
  });

  it('a question nobody answers leaves the scan exactly where it was', async () => {
    // Skipping costs nothing but the side — §2's third objection is that a scan taxed for a fault
    // some cubes have is worse than the fault. Five sides, no cube, no restart offered.
    await runClip(() => null);
    expect(
      asked.length,
      'the question was never raised, so this case tests nothing',
    ).toBeGreaterThan(0);
    expect(
      last()
        .captured.map((c) => c.face)
        .sort(),
    ).toEqual(['B', 'D', 'F', 'L', 'R']);
    expect(completions).toEqual([]);
    expect(events.some((e) => e.notice?.action?.kind === 'restart')).toBe(false);
  });
});

describe('which arrangement this cube is, measured (2026-09-25)', () => {
  it('reads as WESTERN with a clear margin, which is what licenses the corpus entry', () => {
    // A truth string is POSITIONAL and a capture holds colour CLASSES; on a Western cube the two
    // map through the identity and on a Japanese one the Down and Back positions swap their
    // colours. `tests/fixtures/corpus.ts` records this sitting as Western, and a fixture's claim
    // about a cube nobody here can look at has to be checked against the readings.
    return runClip().then(() => {
      const captures = last().captured.map((c) => c.colors);
      expect(captures.length, 'precondition: the clip captured sides to measure').toBe(5);
      expect(schemeShownIn(captures, TRUTH)).toBe('western');
    });
  });
});
