import { describe, expect, it } from 'vitest';
import { assemble } from '../src/assemble.js';
import { type RunModel, detectFace, preprocess, sampleMedianRgb } from '../src/onnx-detect.js';
import { FACES, type Face, type Frame, type RGB } from '../src/types.js';

function solidFrame(w: number, h: number, rgb: [number, number, number]): Frame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

/** A fake model run: 9 anchors in a fixed 3x3 grid, with the given per-sticker DETECTOR classes.
 *  On a 640×640 frame the letterbox is identity, so anchor (cx,cy) maps straight to frame pixels. */
function gridRun(detectorClasses: number[], nc = 6, anchors = 9): RunModel {
  const out = new Float32Array((4 + nc) * anchors);
  const set = (row: number, a: number, v: number) => {
    out[row * anchors + a] = v;
  };
  for (let a = 0; a < 9; a++) {
    const r = Math.floor(a / 3);
    const c = a % 3;
    set(0, a, 100 + c * 45); // cx
    set(1, a, 100 + r * 45); // cy
    set(2, a, 30); // w
    set(3, a, 30); // h
    set(4 + detectorClasses[a]!, a, 0.9);
  }
  return async () => ({ data: out, anchors });
}

describe('preprocess', () => {
  it('letterboxes to imgsz×imgsz CHW float with grey padding, and reports scale/pad', () => {
    const pre = preprocess(solidFrame(100, 50, [255, 0, 0]), 64); // wide → padded top/bottom
    expect(pre.imgsz).toBe(64);
    expect(pre.data.length).toBe(3 * 64 * 64);
    expect(pre.scale).toBeCloseTo(0.64, 5);
    expect(pre.padX).toBe(0);
    expect(pre.padY).toBe(16); // (64 - 32) / 2
    const plane = 64 * 64;
    expect(pre.data[0]).toBeCloseTo(114 / 255, 5); // (0,0) is in the pad band → grey 114
    const c = 32 * 64 + 32; // centre pixel sits inside the red image
    expect(pre.data[0 * plane + c]).toBeCloseTo(1, 1); // R ≈ 1
    expect(pre.data[1 * plane + c]).toBeCloseTo(0, 1); // G ≈ 0
  });
});

describe('sampleMedianRgb', () => {
  it('returns the median colour of a box centre, clamped to frame bounds', () => {
    const f = solidFrame(50, 50, [10, 220, 130]);
    expect(sampleMedianRgb(f, 25, 25, 20, 20)).toEqual([10, 220, 130]);
    // A box partly off-frame still samples the in-bounds pixels (mid-grey only if fully off).
    expect(sampleMedianRgb(f, 25, 25, 200, 200)).toEqual([10, 220, 130]);
  });
});

describe('detectFace (injected run)', () => {
  it('runs the full path: preprocess → run → decode → grid-fit → sample colours', async () => {
    const colors = [0, 1, 2, 3, 4, 5, 0, 1, 2];
    const run = gridRun(colors);
    const res = await detectFace(solidFrame(640, 640, [128, 128, 128]), run);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.face.colors).toEqual(colors); // detector class kept (live preview / prior)
      expect(res.face.rgb).toHaveLength(9);
    }
  });

  it('samples each sticker TRUE pixel colour, independent of the detector class', async () => {
    const red: RGB = [200, 50, 40];
    const run = gridRun([4, 4, 4, 4, 4, 4, 4, 4, 4]); // detector wrongly says every sticker is orange
    const res = await detectFace(solidFrame(640, 640, red), run);
    expect(res.ok).toBe(true);
    if (res.ok) {
      for (const s of res.face.rgb) {
        expect(s[0]).toBeGreaterThan(150); // sampled the red pixels…
        expect(s[1]).toBeLessThan(100); // …not the (wrong) orange class
      }
    }
  });

  // The core of the relative-colour fix: the FINAL colour comes from the sampled RGB classified
  // vs the cube's own centres, so a scan is a valid solved cube even when the detector's absolute
  // class is wrong for every sticker (the red↔orange "colour drifting" failure mode).
  it('yields a valid cube via RELATIVE colour even when the detector class is wrong', async () => {
    const COLORS: Record<Face, RGB> = {
      U: [246, 247, 248], // white
      R: [208, 32, 42], // red
      F: [4, 158, 74], // green
      D: [255, 212, 0], // yellow
      L: [255, 106, 0], // orange
      B: [0, 87, 200], // blue
    };
    const run = gridRun([4, 4, 4, 4, 4, 4, 4, 4, 4]); // detector calls EVERY sticker orange
    const rgbFaces = {} as Record<Face, RGB[]>;
    for (const f of FACES) {
      const res = await detectFace(solidFrame(640, 640, COLORS[f]), run);
      expect(res.ok).toBe(true);
      if (res.ok) rgbFaces[f] = res.face.rgb;
    }
    const result = assemble(rgbFaces);
    expect(result.valid).toBe(true);
    expect(result.facelets).toBe('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
  });
});
