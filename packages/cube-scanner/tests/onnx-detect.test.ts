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
