// The letterbox: how a camera picture of any shape is fitted into the model's square, and the way
// back (2026-09-19).
//
// ONE place for the arithmetic, because it was written out twice — the forward fit in `preprocess`
// and the inverse in `toFrameBox` — and a third copy was about to be added for the boxes the scan
// screen draws. Two copies of one formula agree only until one of them is edited. Every native
// runtime letterboxes the same way (Swift `Letterbox.swift`, Kotlin `VisionPlugin.kt`), which
// `ml/golden_frames.py` holds byte-exact; this is the JavaScript side of that contract.
//
// `preprocess` — the forward fit applied to pixels — moved in here from `onnx-detect.ts` on
// 2026-09-20 so that the letterbox worker's bundle is this file and nothing else of the detector:
// it is a pure letterbox+normalize, and the model run is injected by whoever holds the runtime.

import type { Frame } from './types.js';

/** How a `width`×`height` picture sits in an `imgsz` square: scaled to fit, centred, the rest padded. */
export interface Letterbox {
  scale: number;
  /** The picture's size once scaled, in whole pixels. */
  newW: number;
  newH: number;
  /** The padding before it, in whole pixels (the remainder goes after). */
  padX: number;
  padY: number;
}

export function letterboxOf(width: number, height: number, imgsz: number): Letterbox {
  const scale = imgsz / Math.max(width, height);
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  return {
    scale,
    newW,
    newH,
    padX: Math.floor((imgsz - newW) / 2),
    padY: Math.floor((imgsz - newH) / 2),
  };
}

export const IMG_SIZE = 640;
const PAD = 114 / 255; // grey 114, normalized — the pad the model was trained with (ml/cube_infer.py PAD)

export interface Preprocessed {
  data: Float32Array; // CHW RGB, [0,1], length 3*imgsz*imgsz
  imgsz: number;
}

/**
 * Letterbox an RGBA frame to imgsz×imgsz (aspect-preserving, grey pad) and emit a CHW RGB
 * float tensor in [0,1] — the exact input the detector was trained on. Bilinear resample so
 * it matches the training-time resize, which is `letterbox` in ml/cube_infer.py and is the
 * one definition both this and ml/cubedet read. Pure: no canvas, no DOM.
 *
 * IT REFUSES A FRAME IT CANNOT READ, rather than producing a tensor from one (2026-09-05). Every
 * malformed input had an answer that looked like an answer: a 0×0 frame ran no loop at all and
 * came back as 640×640 of flat grey — the exact input the model is trained to ABSTAIN on, so it
 * abstained, and a camera delivering nothing was indistinguishable from a camera pointed at a
 * wall. A buffer shorter than `width*height*4` read `undefined` past its end and normalised it to
 * NaN, which compares false against every confidence threshold downstream and so was silently
 * dropped rather than reported. A non-integer or non-positive `imgsz` produced a tensor of the
 * wrong length, which `validatedRun` then blamed on the model.
 *
 * The bar is the project's: an unreadable scan surfaces where it happens. This is the seam every
 * browser frame passes through, and it is the last place that still knows the frame is a frame.
 *
 * The refusals live in `validatedFrame` (2026-09-21) so that this function is the resample and
 * nothing else; the loop below is byte for byte what it was, which `letterbox-parity.test.ts`
 * and the golden gate hold it to.
 */
export function preprocess(frame: Frame, imgsz: number = IMG_SIZE): Preprocessed {
  const { src, w, h } = validatedFrame(frame, imgsz);
  const { scale, newW, newH, padX, padY } = letterboxOf(w, h, imgsz);
  const plane = imgsz * imgsz;
  const out = new Float32Array(3 * plane).fill(PAD);

  for (let y = 0; y < newH; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    const oy = y + padY;
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const o = oy * imgsz + (x + padX);
      for (let ch = 0; ch < 3; ch++) {
        const p00 = src[(y0 * w + x0) * 4 + ch]!;
        const p01 = src[(y0 * w + x1) * 4 + ch]!;
        const p10 = src[(y1 * w + x0) * 4 + ch]!;
        const p11 = src[(y1 * w + x1) * 4 + ch]!;
        const top = p00 + (p01 - p00) * fx;
        const bot = p10 + (p11 - p10) * fx;
        out[ch * plane + o] = (top + (bot - top) * fy) / 255;
      }
    }
  }
  return { data: out, imgsz };
}

/**
 * The frame's pixels and whole-pixel dimensions, or a refusal naming what is wrong with them —
 * the three checks `preprocess` documents, in the order it made them. A caller that reaches the
 * resample has an image of `w`×`h` pixels whose buffer is exactly that long.
 */
export function validatedFrame(
  frame: Frame,
  imgsz: number,
): { src: Uint8ClampedArray; w: number; h: number } {
  const { data: src, width: w, height: h } = frame;
  if (!Number.isInteger(imgsz) || imgsz <= 0) {
    throw new Error(`preprocess: imgsz ${imgsz} is not a positive whole number of pixels`);
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error(`preprocess: a frame of ${w}x${h} is not an image`);
  }
  if (src.length !== w * h * 4) {
    throw new Error(
      `preprocess: a ${w}x${h} RGBA frame is ${w * h * 4} bytes, but this one holds ${src.length}`,
    );
  }
  return { src, w, h };
}
