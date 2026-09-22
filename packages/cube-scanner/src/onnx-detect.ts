// Browser glue for the AI-scan path, kept dependency-free so the core stays pure and
// Node-testable: `preprocess` is a pure letterbox+normalize, and the model run itself is
// INJECTED by the panel (which owns onnxruntime-web). That way cube-scanner never imports
// a heavy wasm runtime, and the whole path is exercised in tests with a fake `run`.

import { DETECT_ROWS, NUM_CLASSES } from './detect-head.js';
import type { ModelOutput } from './detector.js';
// `IMG_SIZE`, `preprocess` and `Preprocessed` live in `letterbox.ts` since 2026-09-20, beside the
// arithmetic they are built on, so the letterbox worker's bundle carries the letterbox and nothing
// of the detect head. Re-exported here because this is where every caller has always found them.
import { IMG_SIZE, type Preprocessed, preprocess } from './letterbox.js';
import {
  type Detection,
  decodeDetections,
  dropNested,
  type FitResult,
  fitFace,
  MIN_STICKER_CONFIDENCE,
  nms,
} from './onnx-postprocess.js';
import type { Frame } from './types.js';

// And `NUM_CLASSES` and `DETECT_ROWS` live in `detect-head.ts` since 2026-09-22, so the inference
// worker's bundle can check a model's output shape without carrying this module's decoder. All five
// are re-exported here because this is where every caller has always found them.
export { DETECT_ROWS, IMG_SIZE, NUM_CLASSES, type Preprocessed, preprocess };

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
  return fitFace(detectionsFromOutput(output, opts), opts.minConf ?? MIN_STICKER_CONFIDENCE);
}

/**
 * The boxes `fitFromOutput` fits a face to: decode → NMS → drop nested, after the row check.
 *
 * Split out for the scan trace, which must see exactly the boxes the scan saw. A trace that
 * re-derived them would be a second implementation of this tail, and the day the two disagreed it
 * would describe a scan that never happened — the one thing a diagnostic cannot be allowed to do.
 */
export function detectionsFromOutput(output: ModelOutput, opts: DetectOptions = {}): Detection[] {
  const {
    numClasses = NUM_CLASSES,
    confThreshold = MIN_STICKER_CONFIDENCE,
    iouThreshold = 0.45,
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
  return dropNested(
    nms(decodeDetections(output.data, numClasses, output.anchors, confThreshold), iouThreshold),
  );
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
