// The letterbox, forward and back, through real pixels (src/letterbox.ts).
//
// The inverse, `toFrameBox`, and the forward fit in `preprocess` now share one arithmetic, so checking
// one against the other with that arithmetic would prove nothing. This checks them through the IMAGE:
// a bright block is painted at a known place in a picture of an awkward shape, `preprocess` resamples
// it into the model's square, the block is found there, and `toFrameBox` must bring it back to where it
// was painted. Portrait and landscape, odd sizes, and a square — the shapes a camera actually hands over.
import { describe, expect, it } from 'vitest';
import { letterboxOf } from '../src/letterbox.js';
import { IMG_SIZE, preprocess } from '../src/onnx-detect.js';
import { toFrameBox } from '../src/sticker-pixels.js';

/** A `w`×`h` black picture with a white block `size` wide centred at (cx, cy). */
function pictureWithBlock(w: number, h: number, cx: number, cy: number, size: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = Math.abs(x + 0.5 - cx) <= size / 2 && Math.abs(y + 0.5 - cy) <= size / 2;
      data.set([on ? 255 : 0, on ? 255 : 0, on ? 255 : 0, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

/** The centre of the bright pixels in a preprocessed tensor's first channel. */
function brightCentre(tensor: Float32Array, imgsz: number): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < imgsz; y++) {
    for (let x = 0; x < imgsz; x++) {
      if (tensor[y * imgsz + x]! > 0.75) {
        sx += x + 0.5;
        sy += y + 0.5;
        n++;
      }
    }
  }
  if (n === 0) throw new Error('the block did not survive the letterbox');
  return [sx / n, sy / n];
}

/**
 * The fixtures, with the letterbox each one implies written out by hand: the scale is the square over
 * the longer side, the scaled size is that rounded, and the padding is what is left, halved and
 * floored. Numbers, not a formula — a formula here would be the implementation's own, and a shared
 * mistake would cancel out on both sides (audit, 2026-09-19).
 */
const FIXTURES = [
  { w: 1280, h: 720, box: { scale: 0.5, newW: 640, newH: 360, padX: 0, padY: 140 } },
  { w: 720, h: 1280, box: { scale: 0.5, newW: 360, newH: 640, padX: 140, padY: 0 } },
  { w: 641, h: 479, box: { scale: 640 / 641, newW: 640, newH: 478, padX: 0, padY: 81 } },
  { w: 479, h: 641, box: { scale: 640 / 641, newW: 478, newH: 640, padX: 81, padY: 0 } },
  { w: 720, h: 480, box: { scale: 640 / 720, newW: 640, newH: 427, padX: 0, padY: 106 } },
  { w: 500, h: 500, box: { scale: 640 / 500, newW: 640, newH: 640, padX: 0, padY: 0 } },
] as const;

/** Where the three painted blocks sit, as a fraction of the picture. */
const SPOTS = [
  [0.2, 0.3],
  [0.75, 0.6],
  [0.5, 0.9],
] as const;

describe('the letterbox, forward through preprocess and back through toFrameBox', () => {
  it('pads the short side and centres the picture, at every shape a camera hands over', () => {
    for (const { w, h, box } of FIXTURES) {
      expect(letterboxOf(w, h, IMG_SIZE), `${w}×${h}`).toEqual(box);
    }
  });

  for (const { w, h, box } of FIXTURES) {
    it(`${w}×${h}: a block lands where the letterbox says, and comes back where it was painted`, () => {
      const block = Math.round(Math.max(w, h) / 12);
      for (const [fx, fy] of SPOTS) {
        const cx = Math.round(w * fx);
        const cy = Math.round(h * fy);
        const { data } = preprocess(pictureWithBlock(w, h, cx, cy, block), IMG_SIZE);
        const [lx, ly] = brightCentre(data, IMG_SIZE);
        // WHERE IN THE MODEL'S SQUARE, against the hand-written letterbox above: measured, the
        // resampling moves a block's centre by at most 0.28 of a model pixel, so a third of one is a
        // bound the picture's own noise fits inside and a one-pixel padding slip does not.
        expect(
          Math.abs(lx - (cx * box.scale + box.padX)),
          `${w}×${h} (${cx},${cy}) across`,
        ).toBeLessThanOrEqual(0.35);
        expect(
          Math.abs(ly - (cy * box.scale + box.padY)),
          `${w}×${h} (${cx},${cy}) down`,
        ).toBeLessThanOrEqual(0.35);
        // …and back, in picture pixels. All FOUR numbers: the width and height a box comes back with
        // are what every sticker is then sampled from (audit, 2026-09-19).
        const [bx, by, bw, bh] = toFrameBox([lx, ly, 40, 24], { width: w, height: h }, IMG_SIZE);
        const tolerance = 0.35 / box.scale;
        expect(Math.abs(bx - cx), `${w}×${h} back across`).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(by - cy), `${w}×${h} back down`).toBeLessThanOrEqual(tolerance);
        expect(bw).toBeCloseTo(40 / box.scale, 6);
        expect(bh).toBeCloseTo(24 / box.scale, 6);
      }
    });
  }
});
