// Browser bridge: load the ONNX sticker detector with onnxruntime-web and expose it as the
// `RunModel` that cube-scanner's pure `detectFace()` injects. This view module is the ONE
// place the wasm runtime is imported, so `src/` stays dependency-free and Node-testable.
//
// Usage in a panel:
//   const run = await createModelRunner('./vendor/cube-yolo.onnx');
//   const fit = await detectFace(frame, run);           // DetectResult (face.rgb sampled) | abstain
//   // …collect 6 faces' fit.face.rgb in URFDLB order, then:
//   const result = assemble(rgbFaces);                  // relative classify + validated ScanResult

import * as ort from 'onnxruntime-web';
import type { RunModel } from '../src/onnx-detect.js';

export interface ModelRunnerOptions {
  /** onnxruntime-web execution providers, in preference order. wasm is the safe default. */
  executionProviders?: ort.InferenceSession.ExecutionProviderConfig[];
}

/**
 * Load the YOLOv11 model once and return a reusable RunModel. The detect output tensor is
 * [1, 4+numClasses, anchors]; we hand back its flat data + the anchor count (its last dim)
 * for `decodeDetections`. Create one runner and reuse it across every frame — session
 * creation is the expensive part.
 */
export async function createModelRunner(
  modelUrl: string,
  opts: ModelRunnerOptions = {},
): Promise<RunModel> {
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: opts.executionProviders ?? ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error('model has no input/output tensor');

  return async (input, imgsz) => {
    const tensor = new ort.Tensor('float32', input, [1, 3, imgsz, imgsz]);
    const result = await session.run({ [inputName]: tensor });
    const out = result[outputName];
    if (!out) throw new Error(`model produced no '${outputName}' output`);
    const anchors = out.dims[out.dims.length - 1] ?? 0;
    return { data: out.data as Float32Array, anchors };
  };
}
