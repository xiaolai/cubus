// Browser glue for the AI-scan path, kept dependency-free so the core stays pure and
// Node-testable: `preprocess` is a pure letterbox+normalize, and the model run itself is
// INJECTED by the panel (which owns onnxruntime-web). That way cube-scanner never imports
// a heavy wasm runtime, and the whole path is exercised in tests with a fake `run`.

import type { ModelOutput } from './detector.js';
import { type FitResult, decodeDetections, fitFace, nms } from './onnx-postprocess.js';
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

/** The injected model call: input CHW tensor → flat output tensor + its anchor count. */
export type RunModel = (input: Float32Array, imgsz: number) => Promise<ModelOutput>;

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
  const { numClasses = 6, confThreshold = 0.25, iouThreshold = 0.45, minConf = 0.25 } = opts;
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
