import { describe, expect, it } from 'vitest';
import { INNER, medianLab, stickerLab, toFrameBox } from '../src/sticker-pixels';
import type { Frame } from '../src/types';

/** A frame painted by a function of position, in RGBA. */
function frameOf(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('medianLab', () => {
  // Reference values for sRGB under D65, the same ones any colour library prints.
  it.each([
    { name: 'white', rgb: [255, 255, 255] as const, lab: [100, 0, 0] },
    { name: 'red', rgb: [255, 0, 0] as const, lab: [53.24, 80.09, 67.2] },
    { name: 'green', rgb: [0, 255, 0] as const, lab: [87.73, -86.18, 83.18] },
    { name: 'blue', rgb: [0, 0, 255] as const, lab: [32.3, 79.19, -107.86] },
  ])('converts $name the way every other implementation does', ({ rgb, lab }) => {
    const frame = frameOf(10, 10, () => [...rgb] as [number, number, number]);
    const got = medianLab(frame, [0, 0, 10, 10])!;
    for (const [i, want] of lab.entries()) expect(got[i]).toBeCloseTo(want, 1);
  });

  it('reads the middle of a sticker, not its border', () => {
    // A black border two pixels wide around a red sticker: the median of the middle is the red.
    const frame = frameOf(20, 20, (x, y) =>
      x < 2 || y < 2 || x >= 18 || y >= 18 ? [0, 0, 0] : [255, 0, 0],
    );
    const [L, a, b] = medianLab(frame, [0, 0, 20, 20])!;
    expect(L).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.2, 1);
    // And the guarantee that makes that work: the sampled window is the inner fraction.
    expect(INNER).toBeLessThan(0.9);
  });

  it('refuses a box that lands off the frame', () => {
    const frame = frameOf(8, 8, () => [10, 10, 10]);
    expect(medianLab(frame, [-50, -50, 4, 4])).toBeNull();
  });
});

describe('toFrameBox', () => {
  it('undoes the letterbox the detector saw', () => {
    // A 1280x720 frame letterboxed into 640: scale 0.5, and the pad is vertical only.
    const frame = frameOf(4, 4, () => [0, 0, 0]);
    const wide = { ...frame, width: 1280, height: 720 };
    const scale = 640 / 1280;
    const padY = Math.floor((640 - Math.round(720 * scale)) / 2);
    const [x, y, w, h] = toFrameBox([100, 100 + padY, 50, 50], wide, 640);
    expect(x).toBeCloseTo(200, 6);
    expect(y).toBeCloseTo(200, 6);
    expect(w).toBeCloseTo(100, 6);
    expect(h).toBeCloseTo(100, 6);
  });
});

describe('stickerLab', () => {
  it('gives one triple per sticker, or nothing when one cannot be read', () => {
    const frame = frameOf(64, 64, () => [200, 30, 30]);
    const boxes = Array.from({ length: 9 }, (_, i) => [i * 6, i * 6, 6, 6] as const);
    expect(stickerLab(frame, boxes, 64)).toHaveLength(9);
    expect(stickerLab(frame, [[-90, -90, 4, 4]], 64)).toBeNull();
  });
});
