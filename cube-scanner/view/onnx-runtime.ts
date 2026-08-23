// Browser bridge: load the ONNX sticker detector with onnxruntime-web and expose it as the
// `RunModel` that cube-scanner's pure `detectFace()` injects. This view module is the ONE
// place the wasm runtime is imported, so `src/` stays dependency-free and Node-testable.
//
// Usage in a panel:
//   const run = await createModelRunner('./vendor/cube-yolo.onnx');
//   const fit = await detectFace(frame, run);           // FaceFit | abstain
//   // …collect 6 faces in URFDLB order, then:
//   const result = assembleColors(faces);               // validated ScanResult

import * as ort from 'onnxruntime-web';
import type { RunModel } from '../src/onnx-detect.js';

export interface ModelRunnerOptions {
  /** onnxruntime-web execution providers, in preference order. wasm is the safe default. */
  executionProviders?: ort.InferenceSession.ExecutionProviderConfig[];
  /** Folder holding onnxruntime-web's .wasm/.mjs, resolved relative to this bundle. Default './'. */
  wasmPaths?: string;
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
  // Run single-threaded so no SharedArrayBuffer / cross-origin-isolation headers are needed.
  // Load the wasm from the version-matched CDN: under Electron's file:// origin Chromium CANNOT
  // fetch() a local .wasm (the .mjs imports fine, but the wasm binary fetch is blocked), whereas an
  // https fetch IS allowed — which is exactly how this app already loads esm.sh / cubing.net. Pin
  // the version to onnxruntime-web in package.json. For a fully-offline build, serve the app over
  // http(s) (or a custom protocol) instead of file:// and pass opts.wasmPaths = './' (vendored wasm).
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths =
    opts.wasmPaths ?? 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';

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
