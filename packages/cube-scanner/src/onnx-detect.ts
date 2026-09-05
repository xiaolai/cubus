// Browser glue for the AI-scan path, kept dependency-free so the core stays pure and
// Node-testable: `preprocess` is a pure letterbox+normalize, and the model run itself is
// INJECTED by the panel (which owns onnxruntime-web). That way cube-scanner never imports
// a heavy wasm runtime, and the whole path is exercised in tests with a fake `run`.

import type { ModelOutput } from './detector.js';
import {
  decodeDetections,
  type FitResult,
  fitFace,
  MIN_STICKER_CONFIDENCE,
  nms,
} from './onnx-postprocess.js';
import type { Frame } from './types.js';

export const IMG_SIZE = 640;
const PAD = 114 / 255; // Ultralytics letterbox pad colour (grey 114), normalized

export interface Preprocessed {
  data: Float32Array; // CHW RGB, [0,1], length 3*imgsz*imgsz
  imgsz: number;
}

/**
 * Letterbox an RGBA frame to imgsz×imgsz (aspect-preserving, grey pad) and emit a CHW RGB
 * float tensor in [0,1] — the exact input Ultralytics YOLO expects. Bilinear resample so
 * it matches the training-time resize. Pure: no canvas, no DOM.
 */
export function preprocess(frame: Frame, imgsz: number = IMG_SIZE): Preprocessed {
  const { data: src, width: w, height: h } = frame;
  const scale = imgsz / Math.max(w, h);
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((imgsz - newW) / 2);
  const padY = Math.floor((imgsz - newH) / 2);
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
 * How many colour classes the detector distinguishes — one per cube face, 0 white … 5 blue, matching
 * `ml/data.yaml`. Named here because it was a bare `6` default below, which meant the ONE number
 * that decides how the output tensor is indexed had no name to be checked against anywhere else.
 */
export const NUM_CLASSES = 6;

/**
 * Rows in a YOLO detect head: four box coordinates, then one score per class. This is the exact
 * height the output tensor must have, and `createModelRunner` refuses anything else — a tensor with
 * a different row count is a different model, and decoding it would read the cube off stale offsets.
 */
export const DETECT_ROWS = 4 + NUM_CLASSES;

/** The injected model call: input CHW tensor → flat output tensor + its anchor count. */
export type RunModel = (input: Float32Array, imgsz: number) => Promise<ModelOutput>;

/** Re-exported beside its two consumers: `fitFromOutput` defaults both thresholds to it. */
export { MIN_STICKER_CONFIDENCE } from './onnx-postprocess.js';

export interface DetectOptions {
  numClasses?: number;
  confThreshold?: number;
  iouThreshold?: number;
  minConf?: number;
}

/**
 * Decode a raw model output into a face fit: decode → NMS → fit the front 3x3 grid. This is the
 * post-processing tail shared by every runtime — the browser's wasm `run()` and the native plugin
 * both hand back the same `{ data, anchors }`, and it is turned into a FaceFit (or an abstention:
 * NO_FACE / PARTIAL_FACE / BAD_GEOMETRY) by this one implementation, which the invariant tests cover.
 */
export function fitFromOutput(output: ModelOutput, opts: DetectOptions = {}): FitResult {
  const {
    numClasses = NUM_CLASSES,
    confThreshold = MIN_STICKER_CONFIDENCE,
    iouThreshold = 0.45,
    minConf = MIN_STICKER_CONFIDENCE,
  } = opts;
  // THE ROW COUNT, at the seam both runtimes pass through.
  //
  // `decodeDetections` reads four box coordinates and then one score per class at FIXED offsets
  // into this tensor, so a head with a different row count is a different model decoded against
  // stale offsets — and the result is not an error anywhere downstream, just a cube read off the
  // wrong axis. The browser runtime has checked this since 515002d, inside `validatedRun`; the
  // native plugin decoded `rows` out of its own header and discarded it, so the one path that
  // crosses a bridge was the one path with no check. Asserting here covers both, and covers any
  // runtime added later for free.
  const expected = 4 + numClasses;
  if (output.rows !== expected) {
    // Rows are the SMALLER axis by orders of magnitude in a real detect head, so a row count at or
    // above the anchor count names the likeliest cause rather than leaving it to be guessed at.
    const why =
      output.rows >= output.anchors
        ? ` — ${output.rows} rows against ${output.anchors} anchors is the transpose of a detect head`
        : '';
    throw new Error(
      `model output has ${output.rows} rows, not the ${expected} a ${numClasses}-class detect head produces${why}`,
    );
  }
  const dets = nms(
    decodeDetections(output.data, numClasses, output.anchors, confThreshold),
    iouThreshold,
  );
  return fitFace(dets, minConf);
}

/**
 * One face detection over an injected `run`: preprocess → run model → `fitFromOutput`. Kept as the
 * composed convenience the tests exercise; the panel drives the two halves through a `Detector`.
 * Returns a FaceFit or an abstention (NO_FACE / PARTIAL_FACE / BAD_GEOMETRY).
 */
export async function detectFace(
  frame: Frame,
  run: RunModel,
  opts: DetectOptions = {},
): Promise<FitResult> {
  const pre = preprocess(frame);
  return fitFromOutput(await run(pre.data, pre.imgsz), opts);
}
