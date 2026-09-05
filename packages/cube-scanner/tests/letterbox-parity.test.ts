// THE THIRD SIDE OF THE LETTERBOX CONTRACT.
//
// `preprocess()` is reproduced in Rust (`crates/cube-vision/src/windows.rs`), in Kotlin
// (`gen/android/app/src/test/java/im/cubus/app/LetterboxParityTest.kt`) and in Python
// (`ml/cube_infer.py`). Two of those pin ten sampled values and a checksum "produced by running
// `preprocess`", and both took the numbers from a run somebody did once. Nothing pinned the
// TypeScript itself — so an edit to `preprocess()` left Kotlin and Rust agreeing with each other
// and with a version of the app that no longer existed, and the way that shows up is a fraction of
// a pixel everywhere, which reads as a model that has quietly got worse.
//
// The fixture and the expected values are DELIBERATELY duplicated from those two tests rather than
// derived here. Deriving them would make this a test of `preprocess` against itself, which is
// exactly the failure it exists to prevent — three implementations agreeing with themselves. These
// are literals, and a change to any implementation makes one of the three go red.
//
// The values are exact, not approximate. Both sides compute in double and round once, on the store
// to f32; Kotlin computing in Float instead moved index 576960 from 0.23291667 to 0.23291671, and
// that is the whole failure mode this catches.

import { describe, expect, it } from 'vitest';
import { IMG_SIZE, preprocess } from '../src/onnx-detect.js';
import type { Frame } from '../src/types.js';

const W = 97;
const H = 43;

/** The same deterministic frame `fixture()` builds in windows.rs and `sample()` in the Kotlin. */
function fixture(): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      data[o] = (x * 7 + y * 13) % 256;
      data[o + 1] = (x * 31 + y * 5 + 77) % 256;
      data[o + 2] = (x * 17 + y * 23 + 191) % 256;
      data[o + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

/** (CHW index, value) — three samples per plane inside the image band, one in the pad. */
const EXPECTED: readonly (readonly [number, number])[] = [
  [128_100, 0.5527696013450623],
  [192_320, 0.2329166680574417],
  [256_600, 0.16269607841968536],
  [537_700, 0.14213235676288605],
  [601_920, 0.4771813750267029],
  [666_200, 0.9138235449790955],
  [947_300, 0.32084253430366516],
  [1_011_520, 0.5639828443527222],
  [1_075_800, 0.744497537612915],
  [6_410, 0.4470588266849518],
];

/** The position-weighted checksum both native tests compute, over the CHW order. */
const CHECKSUM = 291_823.35534517275;

describe('preprocess — the letterbox every implementation must reproduce', () => {
  const out = preprocess(fixture()).data;

  it('produces the tensor the native implementations are pinned against', () => {
    expect(out.length).toBe(3 * IMG_SIZE * IMG_SIZE);
    for (const [index, want] of EXPECTED) {
      // Exact. A fraction of a pixel everywhere is the way a letterbox drifts, and it is
      // indistinguishable from a worse model unless the comparison is exact.
      expect(out[index]).toBe(Math.fround(want));
    }
  });

  it('agrees on the checksum, which is what catches a shifted row or channel', () => {
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += (out[i]! * ((i % 97) + 1)) / 97;
    expect(Math.abs(sum - CHECKSUM)).toBeLessThan(1e-3);
  });

  it('pads with Ultralytics grey, which is what the model was trained on', () => {
    // Row 10 is above the image band for a 97x43 source scaled to 640 wide (284 tall, pad 178) —
    // the same probe the Kotlin test makes, in CHW rather than NHWC.
    expect(out[10 * IMG_SIZE + 10]).toBe(Math.fround(114 / 255));
  });
});
