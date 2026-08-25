// Browser bridge: load the ONNX sticker detector with onnxruntime-web and expose it as the
// `RunModel` that cube-scanner's pure `detectFace()` injects. This view module is the ONE
// place the wasm runtime is imported, so `src/` stays dependency-free and Node-testable.
//
// Usage in a panel:
//   const run = await createModelRunner('./vendor/cube-yolo.onnx');
//   const fit = await detectFace(frame, run);           // FaceFit | abstain
//   // …collect 6 faces in URFDLB order, then:
//   const result = assembleColors(faces);               // validated ScanResult

// TYPE-ONLY. The runtime is loaded from a URL at call time (see `loadOrt`) so that esbuild leaves
// it out of the panel bundle — which is the whole reason inference can run off the main thread.
import type * as ortNs from 'onnxruntime-web';
import type { RunModel } from '../src/onnx-detect.js';

type Ort = typeof ortNs;

/** One runtime per URL, however many runners. Cached so a second panel does not fetch 400kB again.
 *
 * Keyed BY URL, not a single slot: the previous version cached the first load and then handed that
 * same module to every later caller whatever URL they asked for, so a second panel pointed at a
 * different vendor directory silently got the first one's runtime.
 *
 * A rejection is evicted rather than kept. A cached failed promise makes the first network blip
 * permanent for the life of the page — every retry returns the original error, and the scanner can
 * never recover without a reload. */
const ortByUrl = new Map<string, Promise<Ort>>();
const loadOrt = (url: string): Promise<Ort> => {
  let pending = ortByUrl.get(url);
  if (!pending) {
    // A dynamic import of a VARIABLE: esbuild cannot resolve it, so it stays a real runtime import
    // and onnxruntime is fetched as its own module. Written as a static specifier it would be
    // inlined, and `import.meta.url` inside it would then name the panel bundle.
    pending = (import(/* @vite-ignore */ url) as Promise<Ort>).catch((err) => {
      ortByUrl.delete(url);
      throw err;
    });
    ortByUrl.set(url, pending);
  }
  return pending;
};

export interface ModelRunnerOptions {
  /** onnxruntime-web execution providers, in preference order. wasm is the safe default. */
  executionProviders?: ortNs.InferenceSession.ExecutionProviderConfig[];
  /**
   * URL of the folder holding onnxruntime-web's .wasm/.mjs. Relative values resolve
   * inconsistently — the .wasm resolves against the document but the dynamically-imported
   * .mjs glue against this bundle — so callers should pass an ABSOLUTE directory URL. Default './'.
   */
  wasmPaths?: string;
  /**
   * URL of the onnxruntime ESM module (apps/web vendors it as `vendor/ort.mjs`). It must be a
   * separate file, not bundled with the caller: onnxruntime spawns its proxy worker from its own
   * `import.meta.url`, so a bundled copy makes the worker load the CALLER instead of the runtime.
   */
  ortUrl?: string;
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
  // wasmPaths resolves INCONSISTENTLY across onnxruntime-web — the .wasm against the document but
  // the dynamically-imported .mjs glue against this bundle — so callers should pass an ABSOLUTE
  // directory URL (see the option's JSDoc). The default './' below is a bare fallback and is
  // unreliable when the bundle and page live in different folders. Whatever URL is used must be a
  // fetch-capable origin: under a plain file:// page pass an https CDN, since file:// can't fetch
  // a local .wasm.
  const ort = await loadOrt(opts.ortUrl ?? './ort.mjs');
  ort.env.wasm.numThreads = 1;
  // Off the main thread. A single run of this model is ~400ms of straight-line wasm and the scan
  // loop fires one every 200ms, so on the page's own thread the UI is blocked essentially all the
  // time the camera is open — a click on the sidebar is not handled until the run finishes.
  // proxy:true moves session creation and every run() into a worker onnxruntime spawns itself.
  // It needs no cross-origin isolation: that is threads, and numThreads stays 1.
  ort.env.wasm.proxy = true;
  ort.env.wasm.wasmPaths = opts.wasmPaths ?? './';

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
