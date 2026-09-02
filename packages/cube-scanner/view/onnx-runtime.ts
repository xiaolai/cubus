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
  /**
   * onnxruntime-web execution providers, in preference order. Defaults to {@link preferredProviders},
   * which asks the browser for a GPU adapter and falls back to wasm when there is none.
   */
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
  /**
   * wasm threads to ask for. Defaults to {@link defaultThreadCount}. Only honoured when the page
   * is cross-origin isolated — without SharedArrayBuffer the runtime has no threads to give,
   * whatever it is asked for, so the default clamps itself to 1 there.
   */
  numThreads?: number;
  /**
   * Run one throwaway inference before handing the runner back. Default true.
   *
   * The GPU path compiles a compute shader per op-and-shape on its FIRST run, not at session
   * creation: measured 4.2 s on a real GPU against 15 ms for every run after it. Without this the
   * frame that pays for that is the user's first, in the middle of a scan, and it looks exactly
   * like a scanner that has hung. Doing it here moves the cost inside the panel's own "loading the
   * model…" state, which is a wait the app already explains. It is cheap on the wasm path too
   * (a first run is ~1.5x a warm one), so it is not conditional on which provider won.
   */
  warmUp?: boolean;
}

/**
 * Which providers to ask for, in order: the GPU if the browser has one, then wasm.
 *
 * ASKED, not assumed. `navigator.gpu` merely existing is not enough — `requestAdapter()` resolves
 * to null on a machine whose GPU is blocklisted or unavailable, and onnxruntime given `webgpu` with
 * no adapter behind it does not fail fast. Listing wasm second is a real fallback rather than
 * decoration: onnxruntime walks the list.
 *
 * Deliberately async, and deliberately not cached here: a caller creating one runner per session
 * asks once, and pinning the answer for the page's life would outlive a GPU that went away.
 */
export async function preferredProviders(): Promise<
  ortNs.InferenceSession.ExecutionProviderConfig[]
> {
  const gpu = (globalThis.navigator as { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)
    ?.gpu;
  if (!gpu) return ['wasm'];
  try {
    return (await gpu.requestAdapter()) ? ['webgpu', 'wasm'] : ['wasm'];
  } catch {
    // A browser that throws rather than resolving null still has no GPU for our purposes.
    return ['wasm'];
  }
}

/** Is the GPU the provider that actually won? Decides the proxy rule — see createModelRunner. */
const usesGpu = (eps: readonly ortNs.InferenceSession.ExecutionProviderConfig[]): boolean =>
  eps.some((e) => (typeof e === 'string' ? e : e.name) === 'webgpu');

/**
 * How many wasm threads to ask onnxruntime for.
 *
 * 1 unless the page is cross-origin isolated, because threads need SharedArrayBuffer and
 * `crossOriginIsolated` is the browser's own answer about whether it has one. Guessing from the
 * headers we *meant* to send would be wrong in exactly the case that matters — an embedder that
 * strips them, a file:// page, an engine without SAB.
 *
 * When it is isolated: measured on this model (640x640, median of 10-12 runs, one page, nothing
 * else running) —
 *
 *     threads      1       2      4      6      8
 *     WebKit    2.8fps   5.6    7.5    8.1   11.3    (8 cores)
 *     Chromium  5.0      5.5    7.6    9.5    7.2    (10 cores)
 *
 * WebKit keeps gaining up to the core count; Chromium peaks at 6 and REGRESSES at 8. So 6 is the
 * ceiling rather than the core count: it is Chromium's best, 72% of WebKit's best, and — the
 * part the benchmark could not see — it leaves cores for the two things running alongside it in
 * the real app, the camera pipeline and the 3D renderer. `cores - 2` for the same reason, and it
 * is what gives a phone thermal headroom rather than pinning every core to inference.
 */
export function defaultThreadCount(
  isolated: boolean = typeof globalThis.crossOriginIsolated === 'boolean'
    ? globalThis.crossOriginIsolated
    : false,
  cores: number = globalThis.navigator?.hardwareConcurrency ?? 1,
): number {
  if (!isolated) return 1;
  return Math.max(1, Math.min(cores - 2, 6));
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
  // wasmPaths resolves INCONSISTENTLY across onnxruntime-web — the .wasm against the document but
  // the dynamically-imported .mjs glue against this bundle — so callers should pass an ABSOLUTE
  // directory URL (see the option's JSDoc). The default './' below is a bare fallback and is
  // unreliable when the bundle and page live in different folders. Whatever URL is used must be a
  // fetch-capable origin: under a plain file:// page pass an https CDN, since file:// can't fetch
  // a local .wasm.
  const ort = await loadOrt(opts.ortUrl ?? './ort.mjs');
  // This was a hard 1, with the note "so no SharedArrayBuffer / cross-origin-isolation headers
  // are needed" — true when written, and it meant every non-Apple build ran a THREADED runtime
  // on one core: measured at 297 ms per inference in WebKit and 234 ms in Chromium, 3-4 fps.
  // apps/web/serve.mjs and tauri.conf.json now send COOP/COEP, so the page can be isolated and
  // the threads asked for here are real. It still falls back to 1 wherever it is not.
  const executionProviders = opts.executionProviders ?? (await preferredProviders());
  const gpu = usesGpu(executionProviders);
  ort.env.wasm.numThreads = opts.numThreads ?? defaultThreadCount();
  // Off the main thread. A single run of this model is ~400ms of straight-line wasm and the scan
  // loop fires one every 200ms, so on the page's own thread the UI is blocked essentially all the
  // time the camera is open — a click on the sidebar is not handled until the run finishes.
  // proxy:true moves session creation and every run() into a worker onnxruntime spawns itself.
  // proxy and threads are independent: proxy moves the work off the page's thread, threads
  // decide how many cores do it. Both are wanted, and proxy still works with numThreads 1.
  //
  // OFF for the GPU path, and that is not a compromise. The proxy exists because a ~200 ms wasm run
  // on the page's thread blocks the UI essentially all the time the camera is open. A GPU run is
  // 15 ms — a fifth of one 60 Hz frame, and an order of magnitude inside the 200 ms tick — so the
  // reason for the worker is gone, while keeping it means the GPU device has to be reached from a
  // worker that onnxruntime spawns for its own purposes. The cheaper arrangement is also the
  // simpler one here.
  ort.env.wasm.proxy = !gpu;
  ort.env.wasm.wasmPaths = opts.wasmPaths ?? './';

  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders,
    graphOptimizationLevel: 'all',
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error('model has no input/output tensor');

  const run: RunModel = async (input, imgsz) => {
    const tensor = new ort.Tensor('float32', input, [1, 3, imgsz, imgsz]);
    const result = await session.run({ [inputName]: tensor });
    const out = result[outputName];
    if (!out) throw new Error(`model produced no '${outputName}' output`);
    const anchors = out.dims[out.dims.length - 1] ?? 0;
    return { data: out.data as Float32Array, anchors };
  };

  // See `warmUp`. The size is read off the model rather than assumed, so a re-exported model at a
  // different resolution warms the shape it will actually be asked for — warming the wrong one
  // would compile a set of shaders nothing then uses, which is the failure that still looks fine.
  if (opts.warmUp ?? true) {
    const meta = session.inputMetadata?.[0];
    // `inputMetadata` is a union — a non-tensor input has no shape at all — so it is narrowed
    // rather than indexed hopefully. A dynamic axis comes back as a string or -1, which is not a
    // size to warm, hence the positive-number test and the 640 the model is exported at.
    const dims = meta?.isTensor ? meta.shape : undefined;
    const h = dims?.[2];
    const side = typeof h === 'number' && h > 0 ? h : 640;
    await run(new Float32Array(3 * side * side), side);
  }
  return run;
}
