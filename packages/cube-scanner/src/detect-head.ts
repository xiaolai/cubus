// The shape of the detector's output, and nothing else.
//
// Its own module since 2026-09-22 so that the inference worker (`view/inference-worker.ts`) can hold
// a model to this shape without carrying the decoder behind it: `onnx-detect.ts` imports the whole
// post-processing tail, and a bundle that imported these two numbers from there would be built from
// every file of it. Re-exported from `onnx-detect.ts`, where every caller has always found them —
// the arrangement `letterbox.ts` already has for `IMG_SIZE`.

/**
 * How many colour classes the detector distinguishes — one per cube face, 0 white … 5 blue, matching
 * `ml/data.yaml`. Named because it was a bare `6` default in `onnx-detect.ts`, which meant the ONE number
 * that decides how the output tensor is indexed had no name to be checked against anywhere else.
 */
export const NUM_CLASSES = 6;

/**
 * Rows in a detector detect head: four box coordinates, then one score per class. This is the exact
 * height the output tensor must have, and `createModelRunner` refuses anything else — a tensor with
 * a different row count is a different model, and decoding it would read the cube off stale offsets.
 */
export const DETECT_ROWS = 4 + NUM_CLASSES;
