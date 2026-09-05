import { describe, expect, it } from 'vitest';
import { detectFace, preprocess } from '../src/onnx-detect.js';
import type { Frame } from '../src/types.js';

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

describe('preprocess', () => {
  it('letterboxes to imgsz×imgsz CHW float with grey padding', () => {
    const pre = preprocess(solidFrame(100, 50, [255, 0, 0]), 64); // wide → padded top/bottom
    expect(pre.imgsz).toBe(64);
    expect(pre.data.length).toBe(3 * 64 * 64);
    const plane = 64 * 64;
    expect(pre.data[0]).toBeCloseTo(114 / 255, 5); // (0,0) is in the pad band → grey 114
    const c = 32 * 64 + 32; // centre pixel sits inside the red image
    expect(pre.data[0 * plane + c]).toBeCloseTo(1, 1); // R ≈ 1
    expect(pre.data[1 * plane + c]).toBeCloseTo(0, 1); // G ≈ 0
  });

  // EVERY MALFORMED FRAME USED TO PRODUCE A TENSOR, and each of the three looked like an answer.
  // A camera that opens and delivers nothing is the case that matters most here: it fed 640x640 of
  // flat grey — the exact input the model is trained to abstain on — so the scanner sat on "Show
  // any side" with a live lens, and no layer downstream could tell it from a wall.
  it('refuses a frame with no pixels rather than making one out of grey', () => {
    expect(() => preprocess({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toThrow(
      /0x0 is not an image/,
    );
    expect(() => preprocess({ data: new Uint8ClampedArray(0), width: 4, height: 0 })).toThrow(
      /not an image/,
    );
    expect(() =>
      preprocess({ data: new Uint8ClampedArray(4 * 4 * 4), width: 4.5, height: 4 }),
    ).toThrow(/not an image/);
  });

  it('refuses a truncated buffer rather than reading NaNs off the end of it', () => {
    // Past the end an RGBA read is `undefined`, which normalises to NaN — and NaN compares false
    // against every confidence threshold downstream, so the stickers were dropped in silence.
    const short = solidFrame(8, 8, [10, 20, 30]);
    expect(() =>
      preprocess({ data: short.data.slice(0, 8 * 8 * 4 - 4), width: 8, height: 8 }),
    ).toThrow(/256 bytes, but this one holds 252/);
  });

  it('refuses an imgsz that is not a whole number of pixels', () => {
    const frame = solidFrame(8, 8, [10, 20, 30]);
    expect(() => preprocess(frame, 0)).toThrow(/not a positive whole number/);
    expect(() => preprocess(frame, 63.5)).toThrow(/not a positive whole number/);
  });
});

describe('detectFace (injected run)', () => {
  it('runs the full path: preprocess → run → decode → grid-fit a 3x3 face', async () => {
    const colors = [0, 1, 2, 3, 4, 5, 0, 1, 2];
    const anchors = 9;
    const nc = 6;
    const out = new Float32Array((4 + nc) * anchors);
    const set = (row: number, a: number, v: number) => {
      out[row * anchors + a] = v;
    };
    for (let a = 0; a < 9; a++) {
      const r = Math.floor(a / 3);
      const c = a % 3;
      set(0, a, 100 + c * 45);
      set(1, a, 100 + r * 45);
      set(2, a, 30);
      set(3, a, 30);
      set(4 + colors[a]!, a, 0.9);
    }
    const run = async () => ({ data: out, anchors, rows: 4 + nc });
    const res = await detectFace(solidFrame(200, 200, [128, 128, 128]), run);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.face.colors).toEqual(colors);
  });
});
