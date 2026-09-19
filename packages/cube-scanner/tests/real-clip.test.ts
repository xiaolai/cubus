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
import { rotateFace } from '../src/facelet-cube.js';
import { AiScanPanel, type ScanCapture, type ScanProgress } from '../view/ai-scan-panel.js';

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
const last = () => events[events.length - 1]!;

beforeEach(async () => {
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
  events = [];
  completions = [];
  captures = [];
  panel = new AiScanPanel();
  panel.setAttribute('headless', '');
  document.body.appendChild(panel);
  panel.useDetector(new ClipDetector(), 'native');
  panel.addEventListener('scan-progress', (e) =>
    events.push((e as CustomEvent<ScanProgress>).detail),
  );
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
});

afterEach(() => {
  panel.remove();
  vi.useRealTimers();
});

/**
 * The cube as it physically was, reached two ways that share nothing but the detector: this fixture
 * completes to it on its own, and the full-precision replay of the same clip reached it after the one
 * tap the scan asked for (U, sticker 3, to yellow). The two runs file different frames, so agreeing on
 * one cube is agreement about the cube, not about a frame.
 */
const TRUTH = 'RLFDUDFBUFLLRRFUBFUULFFULBRDRBRDLUDDBRRLLUBFBDUDDBFRBL';

describe('a real scan of a cube with a logo on its white centre', () => {
  const W = 0;
  const Y = 3;
  const B = 5;

  it('captures all six sides from the clip — 0.6.0 captured none', () => {
    expect(
      last()
        .captured.map((c) => c.face)
        .sort(),
    ).toEqual(['B', 'D', 'F', 'L', 'R', 'U']);
  });

  it('files the logo side as WHITE, though its centre read as yellow on every frame', () => {
    // The logo side's stickers as read — white, blue, green / blue, (white), yellow / green, orange,
    // red — at whatever turn it was filed; a capture's rotation is the assembly's to settle.
    const logo = [W, B, 2, B, W, Y, 2, 4, 1];
    const white = last().captured.find((c) => c.face === 'U')!;
    expect([0, 1, 2, 3].some((k) => rotateFace(logo, k).join() === white.colors.join())).toBe(true);
  });

  it('never tells the person to fit the side in the frame, and never ends the scan', () => {
    expect(events.some((e) => /whole side in the frame/i.test(e.message))).toBe(false);
    expect(events.some((e) => e.notice?.action?.kind === 'restart')).toBe(false);
  });

  it('finishes with the cube as it physically was', () => {
    expect(completions).toEqual([TRUTH]);
  });

  it('announces every side it files, once, as it files it', () => {
    // A host plays its capture sound on this event, so it must match the filing exactly: six sides
    // filed, six announcements counting 1…6, and each named one already in the report that follows.
    // The logo side is among them, announced before it could be named — its centre read as yellow,
    // the colour another side had already claimed (dev-docs/scan-guidance-plan.md 3.1).
    expect(captures.map((c) => c.detail.sides)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(captures.every((c) => c.detail.kind === 'side')).toBe(true);
    // Each announcement names a side filed AT THAT MOMENT: in the report it arrived with, and not in
    // the one before it. Sides stay filed for the rest of the scan, so "it is in the list" alone
    // passes for an announcement naming a side filed three captures ago (audit, 2026-09-19).
    let before: (string | null)[] = [];
    for (const { faces, detail } of captures) {
      if (detail.face) {
        expect(faces, `${detail.face} was announced but not filed`).toContain(detail.face);
        expect(before, `${detail.face} was announced again`).not.toContain(detail.face);
      } else {
        // Filed unnamed: held and counted, but not in the named list — and neither is the side whose
        // centre colour it collided with, which is why the two counts can differ by more than one.
        expect(faces.length, 'an unnamed capture was announced with every side named').toBeLessThan(
          detail.sides,
        );
      }
      before = faces;
    }
    const named = captures.flatMap((c) => (c.detail.face ? [c.detail.face] : [])).sort();
    expect(named).toEqual(['B', 'D', 'F', 'L', 'R']); // the one filed unnamed is the white side
  });
});
