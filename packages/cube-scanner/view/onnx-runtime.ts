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
import { DETECT_ROWS, IMG_SIZE } from '../src/onnx-detect.js';

type Ort = typeof ortNs;

/** One runtime per URL, however many runners. Cached so a second panel does not fetch 400kB again.
 *
 * Keyed BY URL, not a single slot: the previous version cached the first load and then handed that
 * same module to every later caller whatever URL they asked for, so a second panel pointed at a
 * different vendor directory silently got the first one's runtime.
 *
 * A rejection is evicted rather than kept, so a caller that retries is not handed the original
 * error by THIS map.
 *
 * That is the whole of what the eviction buys, and it is worth being precise about: the browser
 * keeps its own module map, keyed by URL, and a failed dynamic import stays failed there. So a
 * retry of the SAME url generally re-raises the same failure no matter what this map does, and
 * recovery really does need a reload. What the eviction prevents is the narrower case that is
 * still worth preventing — a caller retrying with a URL the module map never cached, and every
 * later caller of a url whose first import failed for a reason outside the module system. */
const ortByUrl = new Map<string, Promise<Ort>>();

/**
 * Session creation is serialised per runtime module, because `ort.env` is GLOBAL to it.
 *
 * Providers, thread count, proxy and wasmPaths are written onto the one `ort.env` object and read
 * by onnxruntime when the session is created. Two runners created concurrently against the same
 * runtime therefore interleave: the second overwrites `proxy` and `numThreads` while the first is
 * still in `InferenceSession.create`, and the first session comes up with the second's settings —
 * a GPU runner that quietly took the wasm runner's proxy, or the reverse, with nothing to show for
 * it but a latency that is wrong by an order of magnitude.
 *
 * A chain rather than a lock because the whole critical section is one await. It does not stop a
 * caller reconfiguring the runtime for a LATER session, which is legitimate; it stops two of them
 * being half-applied at once.
 *
 * It is NOT what makes the wasm fallback work, though this note used to say so. `proxy` is read
 * when the backend initialises, not per session, so the two proxy modes are separate module
 * instances — see `runtimeUrl`. What is left for this chain to protect is `numThreads` and
 * `wasmPaths`, which two concurrent runners in the SAME mode can still half-apply to each other.
 */
const configuring = new WeakMap<Ort, Promise<unknown>>();

function serialise<T>(ort: Ort, work: () => Promise<T>): Promise<T> {
  const next = (configuring.get(ort) ?? Promise.resolve()).then(work, work);
  // Kept whatever the outcome, so one failed creation does not wedge the queue behind a rejection.
  configuring.set(
    ort,
    next.catch(() => {}),
  );
  return next;
}
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

/**
 * The runtime URL to import for a given PROXY MODE — the two modes cannot share one module.
 *
 * `ort.env` is per module instance, and onnxruntime reads `proxy` when it initialises its wasm
 * backend — once, not per session. So a module that has created a session with `proxy: false`
 * cannot be given a proxied one afterwards: the flag flips, the worker is never spawned, and the
 * next `InferenceSession.create` fails with `no available backend found. ERR: [wasm] Error: worker
 * not ready`. MEASURED, in Chromium against this vendored runtime.
 *
 * That makes `proxy` part of a module's IDENTITY, not a setting on it, and this function is where
 * that is expressed. Keying it here rather than at the one call site that first needed it is the
 * difference between fixing an instance and fixing the class: the timed GPU→wasm fallback is only
 * ONE way to reach the mode change. A panel rebuilt after the GPU went away, a second panel on a
 * machine whose adapter is now refused, any caller asking for `['wasm']` after a GPU session — all
 * of them flipped the flag on a module that had already initialised, and all of them killed the
 * scanner outright rather than slowing it.
 *
 * Only the PROXIED mode is marked, so the direct path keeps the exact URL it ships with today. A
 * query rather than a fragment, because the module map keys on the whole URL and the fragment is
 * the part a browser is entitled to ignore. It costs at most one extra request for a ~0.1 MB
 * loader — the multi-megabyte .wasm is fetched through `wasmPaths` and is unaffected.
 */
export const runtimeUrl = (url: string, proxied: boolean): string => {
  if (!proxied) return url;
  const [addr = '', hash = ''] = url.split(/(?=#)/, 2);
  return `${addr}${addr.includes('?') ? '&' : '?'}cubus-runtime=proxied${hash}`;
};

/**
 * The SECOND way to get a distinct module instance: a sibling FILE, `ort.mjs` → `ort.proxied.mjs`.
 *
 * `runtimeUrl`'s query string is verified against `apps/web/serve.mjs`, which serves any path with
 * a query. It is NOT verified against the Tauri asset protocol on Windows, Linux and Android — the
 * three targets where wasm is the only path, so the proxied module is the ONLY module they load —
 * and a protocol handler that resolves a request by its path alone answers 404 for a name it has
 * never seen. That would not be a slow scanner, it would be no scanner: `createModelRunner`
 * rejects, `load()` rejects, and the panel reports a model that will not load.
 *
 * A different FILE cannot be misread by any protocol, and it is a byte-identical copy of the same
 * loader — `apps/web/copy-ort.mjs` publishes both from one source, so they cannot drift. The query
 * form is still tried FIRST, because it is the arrangement measured to work in both engines and it
 * costs no extra file; this is the fallback for the hosts where it does not.
 *
 * Query and fragment are carried across, since a caller may cache-bust with either.
 */
export const proxiedSiblingUrl = (url: string): string => {
  const match = /^([^?#]*?)([^/?#]+)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match) return url;
  const [, dir = '', file = '', query = '', hash = ''] = match;
  const dot = file.lastIndexOf('.');
  const named = dot > 0 ? `${file.slice(0, dot)}.proxied${file.slice(dot)}` : `${file}.proxied`;
  return `${dir}${named}${query}${hash}`;
};

/**
 * Load the runtime module for a proxy mode, with the sibling-file fallback behind it.
 *
 * The original rejection is what escapes when BOTH fail: a caller told "ort.proxied.mjs not found"
 * would go looking for a file the app has never depended on, when what actually happened is that
 * the primary URL did not load.
 */
async function loadRuntime(ortUrl: string, proxied: boolean): Promise<Ort> {
  if (!proxied) return loadOrt(ortUrl);
  try {
    return await loadOrt(runtimeUrl(ortUrl, true));
  } catch (err) {
    const sibling = proxiedSiblingUrl(ortUrl);
    if (sibling === ortUrl) throw err;
    try {
      const ort = await loadOrt(sibling);
      console.info(
        `[cubus] the runtime's query-string identity did not load here — using ${sibling} instead`,
      );
      return ort;
    } catch {
      throw err;
    }
  }
}

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
  /**
   * How long a warmed GPU run may take before the wasm runtime is used instead, in ms. Defaults to
   * {@link GPU_BUDGET_MS}. Only consulted when the providers were chosen HERE and the GPU won —
   * see the timing check in {@link createModelRunner}.
   *
   * A public option for the same reason `executionProviders` is one: it is the seam a test drives
   * the branch through, and a test that instead had to make a fake model take 400 ms would be a
   * test that sleeps.
   */
  gpuBudgetMs?: number;
}

/**
 * How long a warmed GPU run may take before it is not worth having. See the timing check in
 * {@link createModelRunner} for the measurements this sits between.
 */
export const GPU_BUDGET_MS = 400;

/**
 * How many timed runs the GPU verdict rests on. The BEST of them is what counts — see the timing
 * check in {@link createModelRunner} for why a single sample is a claim about a moment rather than
 * about a provider.
 */
export const GPU_PROBE_RUNS = 2;

/**
 * What {@link createModelRunner} actually returns: the bare `RunModel` `detectFace` wants, with the
 * lifecycle and provenance a caller that OWNS the runner needs.
 *
 * Declared rather than left implicit. The return type used to be plain `RunModel`, so `dispose` was
 * invisible to TypeScript and `WebDetector` reached it through a hand-written cast — a cast being
 * the shape of "the type is lying", and the reason `providers` would otherwise have been unusable
 * from typed code the moment it was added.
 */
export type ModelRunner = RunModel & {
  /** Release the session's wasm heap or GPU device. Idempotence is onnxruntime's to define. */
  dispose(): Promise<void>;
  /**
   * The provider list this runner was CREATED WITH — which is what the timing fallback changes and
   * what a caller can therefore learn something from.
   *
   * It is not a claim about which provider executed each node, and must not be read as one:
   * onnxruntime assigns nodes to the first provider in the list that can take them, and exposes no
   * API for what it decided. `['webgpu', 'wasm']` here means the GPU was asked for first and ran
   * this model inside {@link GPU_BUDGET_MS} — a strong signal, and still not the same statement.
   */
  providers: readonly ortNs.InferenceSession.ExecutionProviderConfig[];
};

/**
 * The shape of a `GPUAdapter` this module reads. Structural rather than the `@webgpu/types`
 * dependency, because three properties do not justify a dep — and because the two spellings below
 * have to be optional anyway: `isFallbackAdapter` moved from the adapter onto `adapter.info`
 * between WebGPU drafts, and browsers ship both.
 */
interface AdapterLike {
  isFallbackAdapter?: boolean;
  info?: {
    isFallbackAdapter?: boolean;
    vendor?: string;
    architecture?: string;
    description?: string;
  };
}

/**
 * Names of CPU rasterisers that answer `requestAdapter()` as though they were graphics hardware.
 *
 * The flag is the primary signal and this list is the backstop, in that order — see
 * `softwareAdapter`. Matched against `vendor`, `architecture` and `description`, all lowercased,
 * because which field carries the name differs by browser: Chromium reports SwiftShader as
 * `architecture`, Mesa reports lavapipe/llvmpipe as `vendor` on Linux, and Windows' WARP and Basic
 * Render Driver land in `description`.
 */
const SOFTWARE_RENDERERS = [
  'swiftshader',
  'llvmpipe',
  'lavapipe',
  'softpipe',
  'warp',
  'basic render',
  'microsoft basic',
];

/**
 * Is this "GPU" a CPU pretending to be one?
 *
 * MEASURED, and the reason this function exists. On the shipped code, one page, this model:
 *
 *     provider                              model load     per frame
 *     webgpu, real GPU (Chromium/WebKit)       0.4-2.0 s      20 ms
 *     wasm, 6 threads, proxy                   0.8 s          57 ms
 *     webgpu, SwiftShader                     86.3 s        6184 ms
 *
 * So a software adapter is not a slower GPU, it is a 100x REGRESSION against the wasm path the same
 * machine would otherwise have taken — and `requestAdapter()` hands one out without being asked
 * whenever the real GPU is blocklisted, its driver is broken, or the app is running in a VM or over
 * a remote desktop. `preferredProviders` used to accept any non-null adapter, so those machines
 * silently moved from ~200 ms a frame to six seconds, which is exactly what a scanner that has
 * stopped working looks like.
 *
 * `isFallbackAdapter` is the browser's own answer to this question and is checked first; the name
 * list behind it exists because that flag is not universally set (WARP in particular), and guessing
 * at names alone would be the fragile half of this on its own. Neither is load-bearing by itself:
 * `createModelRunner` also TIMES the provider it chose, which is what covers a rasteriser calling
 * itself something new.
 */
function softwareAdapter(adapter: AdapterLike): boolean {
  if (adapter.isFallbackAdapter === true || adapter.info?.isFallbackAdapter === true) return true;
  const info = adapter.info;
  if (!info) return false;
  const text = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`
    .toLowerCase()
    .trim();
  if (text.length === 0) return false;
  return SOFTWARE_RENDERERS.some((name) => text.includes(name));
}

/**
 * Which providers to ask for, in order: the GPU if the browser has one, then wasm.
 *
 * ASKED, not assumed. `navigator.gpu` merely existing is not enough — `requestAdapter()` resolves
 * to null on a machine whose GPU is blocklisted or unavailable, and onnxruntime given `webgpu` with
 * no adapter behind it does not fail fast. Listing wasm second is a real fallback rather than
 * decoration: onnxruntime walks the list.
 *
 * ASKED WHAT IT IS, too, and not only whether it is there. An adapter that is a CPU rasteriser is
 * far slower than the wasm path it displaces — see `softwareAdapter` for the measurements — so a
 * non-null answer is necessary and not sufficient.
 *
 * Deliberately async, and deliberately not cached here: a caller creating one runner per session
 * asks once, and pinning the answer for the page's life would outlive a GPU that went away.
 *
 * The wasm fallback is EXERCISED BY REAL HARDWARE, not only by the stubbed test below it. On a
 * Windows laptop with hybrid graphics, Chromium's GPU process dies at startup (`exit_code=34`), so
 * `requestAdapter()` resolves null for every power preference — high-performance AND low-power,
 * measured — even though the machine has two working GPUs and one of them is driving the panel.
 * A build that assumed a GPU from the hardware present would have picked `webgpu` there and sat in
 * session creation. Asking, and believing the answer, is what makes that machine merely slower
 * instead of broken.
 */
export async function preferredProviders(): Promise<
  ortNs.InferenceSession.ExecutionProviderConfig[]
> {
  const gpu = (
    globalThis.navigator as { gpu?: { requestAdapter(): Promise<AdapterLike | null> } } | undefined
  )?.gpu;
  if (!gpu) return ['wasm'];
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return ['wasm'];
    if (softwareAdapter(adapter)) {
      // Loud, because "this machine has no usable GPU" and "this machine is slow" are different
      // facts and only one of them is worth investigating. The user sees nothing either way — the
      // scan still works, on the path that is actually faster here.
      console.info(
        '[cubus] WebGPU offers only a software adapter — using the wasm runtime instead',
      );
      return ['wasm'];
    }
    return ['webgpu', 'wasm'];
  } catch {
    // A browser that throws rather than resolving null still has no GPU for our purposes.
    return ['wasm'];
  }
}

/**
 * Is the GPU the provider that actually won? Decides the proxy rule — see createModelRunner.
 *
 * The FIRST entry, not "webgpu appears somewhere". onnxruntime walks the list in order and the
 * first provider that can take a node gets it, so `['wasm', 'webgpu']` runs on wasm — and
 * answering true there turned the proxy OFF for a wasm session, putting a ~200 ms run back on the
 * page's thread, which is the one arrangement this whole flag exists to prevent. `preferredProviders`
 * never produces that order, but `opts.executionProviders` is a public option and a test seam.
 *
 * WOULD run, and that is the limit of what this can say. It reads the list as REQUESTED, before any
 * session exists, because that is when the proxy decision has to be made — and onnxruntime exposes
 * no API for which provider it actually assigned each node to. So a `webgpu` that fails to
 * initialise leaves wasm running unproxied on the page's thread, and nothing here can tell. What
 * covers that is the timing probe in `createModelRunner`, which measures behaviour instead of
 * asking; `ModelRunner.providers` is documented in the same terms, and must not be read as a
 * statement about what executed.
 *
 * Exported so a test can pin the rule without a runtime, the same reason `decodeTensorResponse` is.
 */
export const usesGpu = (
  eps: readonly ortNs.InferenceSession.ExecutionProviderConfig[],
): boolean => {
  const first = eps[0];
  if (first === undefined) return false;
  return (typeof first === 'string' ? first : first.name) === 'webgpu';
};

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
 * Did the WebGPU backend actually take the work, after a session that asked for it?
 *
 * The question `usesGpu` cannot answer. That one reads the REQUESTED list before any session
 * exists, because the proxy decision has to be made then — so if onnxruntime quietly assigns the
 * graph to wasm instead, wasm runs UNPROXIED on the page's thread, which is the one arrangement the
 * proxy exists to prevent, and the app reports a GPU while the UI stutters.
 *
 * `ort.env.webgpu.device` is the signal, and it is MEASURED rather than assumed, because it is not
 * documented API. Against this vendored runtime, immediately after `InferenceSession.create`:
 *
 *     session asked for            Chromium   WebKit
 *     ['webgpu', 'wasm'], real GPU   set        set
 *     ['wasm']                       unset      unset
 *
 * Both engines, same answer, and the key does not exist at all until a WebGPU session is created.
 *
 * A missing `env.webgpu` OBJECT means no signal rather than a negative one — a different
 * onnxruntime build, or one of the wasm-only entrypoints — and this returns true there, because
 * acting on the absence of a signal would downgrade every machine on a runtime that simply does not
 * publish it. The check can only ever cost a false GPU, never a false wasm.
 *
 * (`ort.env.webgpu.profiling.ondata` was the other candidate and does not work: assignable on this
 * build, and zero events fire during a genuine 87 ms GPU run in both engines. Believing it would
 * have downgraded every healthy GPU there is.)
 */
function gpuTookTheWork(ort: Ort): boolean {
  const webgpu = (ort.env as { webgpu?: { device?: unknown } }).webgpu;
  if (typeof webgpu !== 'object' || webgpu === null) return true;
  return Boolean(webgpu.device);
}

/**
 * Everything after this point owns the session, so any failure must release it before the error
 * escapes — a thrown error leaves the caller no handle to release it with, and the session is
 * holding either a wasm heap or a GPU device for the life of the page.
 *
 * A wrapper rather than a `try` at each site, because it was three sites and covered two: the
 * warm-up released, the timing probe released, and the input/output-name check between them —
 * added first and never revisited — threw over a live session. One boundary cannot be
 * inconsistent with itself, which is the whole reason this is a function.
 */
async function owning<T>(session: ortNs.InferenceSession, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (err) {
    await session.release().catch(() => {});
    throw err;
  }
}

/**
 * The input side length the model asks for, or {@link IMG_SIZE} when it will not say.
 *
 * `inputMetadata` is a union — a non-tensor input has no shape at all — so it is narrowed rather
 * than indexed hopefully. A dynamic axis comes back as a string or -1, which is not a size to warm,
 * hence the positive-number test and `IMG_SIZE`, the SAME constant `preprocess` defaults to: a
 * re-export at another resolution must not warm one shape and then be fed another.
 */
function inputSide(session: ortNs.InferenceSession): number {
  const meta = session.inputMetadata?.[0];
  const dims = meta?.isTensor ? meta.shape : undefined;
  const h = dims?.[2];
  return typeof h === 'number' && h > 0 ? h : IMG_SIZE;
}

/**
 * Wrap one session as the validated `RunModel` `detectFace` injects.
 *
 * The validation is the point, and it is about SHAPE and not only about size. `decodeDetections`
 * reads this tensor as `[1, 4+classes, anchors]` and indexes it arithmetically, so a model whose
 * output is a different type or layout produces silent nonsense — boxes computed off whatever the
 * bytes happened to mean — rather than an error. That is the failure this project treats as worse
 * than a crash: a misread is a wrong cube, and a wrong cube is a beginner solving something that is
 * not in their hands.
 */
function validatedRun(
  ort: Ort,
  session: ortNs.InferenceSession,
  inputName: string,
  outputName: string,
): RunModel {
  return async (input, imgsz) => {
    const tensor = new ort.Tensor('float32', input, [1, 3, imgsz, imgsz]);
    const result = await session.run({ [inputName]: tensor });
    const out = result[outputName];
    if (!out) throw new Error(`model produced no '${outputName}' output`);
    if (out.type !== 'float32' || !(out.data instanceof Float32Array)) {
      throw new Error(`model output '${outputName}' is ${out.type}, not float32`);
    }
    const shape = `[${out.dims.join(', ')}]`;
    // RANK AND ORDER, not "the last dimension is positive and the length divides by it".
    //
    // That weaker test accepted a TRANSPOSED head. `[1, 8400, 10]` has a positive last dim and a
    // length divisible by it, so it passed — and was then decoded as 8400 rows of 10 anchors,
    // which is not an error anywhere downstream, just a cube read off the wrong axis. The two
    // legal-looking layouts are told apart by the one property that cannot be a coincidence here:
    // a detect head is `4 + numClasses` rows (10 for this model) against thousands of anchors, so
    // rows are always the SMALLER axis by orders of magnitude.
    if (out.dims.length !== 3 || out.dims[0] !== 1) {
      throw new Error(
        `model output '${outputName}' has dims ${shape}, not the [1, rows, anchors] a detect head produces`,
      );
    }
    const rows = out.dims[1] ?? 0;
    const anchors = out.dims[2] ?? 0;
    if (!Number.isInteger(rows) || !Number.isInteger(anchors) || rows <= 0 || anchors <= 0) {
      throw new Error(`model output '${outputName}' has dims ${shape}, which has no anchor axis`);
    }
    // The EXACT row count, not merely "rows are the smaller axis". `decodeDetections` reads four
    // box coordinates and then one score per class at fixed offsets into this tensor, so 9 rows or
    // 11 rows is not a near-miss — it is a different model, decoded against stale offsets, and the
    // result is a cube nobody held. Checking orientation alone still let `[1, 9, 8400]` through.
    if (rows !== DETECT_ROWS) {
      const why =
        rows >= anchors
          ? ` — ${rows} rows against ${anchors} anchors is the transpose of a detect head`
          : '';
      throw new Error(
        `model output '${outputName}' has dims ${shape}: ${rows} rows, not the ${DETECT_ROWS} a ${DETECT_ROWS - 4}-class detect head produces${why}`,
      );
    }
    if (out.data.length !== rows * anchors) {
      throw new Error(
        `model output '${outputName}' holds ${out.data.length} floats, not the ${rows * anchors} its dims ${shape} promise`,
      );
    }
    // `rows` rides along so `fitFromOutput` can make the SAME assertion for the native plugin,
    // which has no `validatedRun` of its own. Checked twice, deliberately: this one names the
    // model and the tensor that produced it, which is what a person debugging an export needs.
    return { data: out.data, anchors, rows };
  };
}

/**
 * Load the YOLOv11 model once and return a reusable runner. The detect output tensor is
 * [1, 4+numClasses, anchors]; we hand back its flat data + the anchor count for `decodeDetections`.
 * Create one runner and reuse it across every frame — session creation is the expensive part.
 */
export async function createModelRunner(
  modelUrl: string,
  opts: ModelRunnerOptions = {},
): Promise<ModelRunner> {
  // Whether the provider list is OURS or the caller's decides one thing below: a list we chose may
  // be revised when it turns out slow, and a list we were handed may not. An explicit
  // `executionProviders` is a request to run on that provider — the cross-provider agreement test
  // passes `['webgpu']` precisely to measure it — and silently answering with a different one would
  // make that test assert nothing on a slow machine.
  const chosenHere = opts.executionProviders === undefined;
  const executionProviders = opts.executionProviders ?? (await preferredProviders());
  const gpu = usesGpu(executionProviders);

  // wasmPaths resolves INCONSISTENTLY across onnxruntime-web — the .wasm against the document but
  // the dynamically-imported .mjs glue against this bundle — so callers should pass an ABSOLUTE
  // directory URL (see the option's JSDoc). The default './' below is a bare fallback and is
  // unreliable when the bundle and page live in different folders. Whatever URL is used must be a
  // fetch-capable origin: under a plain file:// page pass an https CDN, since file:// can't fetch
  // a local .wasm.
  const ortUrl = opts.ortUrl ?? './ort.mjs';
  // The proxy mode picks the module, because it cannot be changed on one — see `runtimeUrl`, and
  // `proxiedSiblingUrl` for the fallback when a host cannot serve the query form.
  const ort = await loadRuntime(ortUrl, !gpu);

  const session = await serialise(ort, async () => {
    // This was a hard 1, with the note "so no SharedArrayBuffer / cross-origin-isolation headers
    // are needed" — true when written, and it meant every non-Apple build ran a THREADED runtime
    // on one core: measured at 297 ms per inference in WebKit and 234 ms in Chromium, 3-4 fps.
    // apps/web/serve.mjs and tauri.conf.json now send COOP/COEP, so the page can be isolated and
    // the threads asked for here are real. It still falls back to 1 wherever it is not.
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

    return ort.InferenceSession.create(modelUrl, {
      executionProviders,
      graphOptimizationLevel: 'all',
    });
  });

  return owning(session, async (): Promise<ModelRunner> => {
    // THE GPU HAS TO HAVE TAKEN IT. Asking for `webgpu` turned the proxy off; if onnxruntime then
    // assigned the graph to wasm anyway, that wasm is running on the page's own thread — worse than
    // either honest path, and invisible to the timing probe below, which sees a perfectly ordinary
    // sub-budget wasm run and keeps it. Checked before the warm-up, so the shader compilation this
    // would otherwise pay for is never started.
    if (gpu && chosenHere && !gpuTookTheWork(ort)) {
      console.info(
        '[cubus] WebGPU did not take this model — using the wasm runtime, off the page thread',
      );
      await session.release().catch(() => {});
      return createModelRunner(modelUrl, { ...opts, executionProviders: ['wasm'] });
    }
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) throw new Error('model has no input/output tensor');
    const run = validatedRun(ort, session, inputName, outputName);

    const side = inputSide(session);
    // A BUFFER PER PROBE, deliberately, though these three runs want the same zeros.
    //
    // The proxied path TRANSFERS the input's ArrayBuffer to onnxruntime's worker, which DETACHES it
    // here — a reused buffer comes back with length 0 and the next run dies on
    // `Tensor's size(1228800) does not match data length(0)`. Measured against this vendored
    // runtime. Zero-filling 4.9 MB is a calloc and happens at most three times per model load, so
    // the saving was never worth owning a detachment bug.
    const probe = (): Promise<unknown> => run(new Float32Array(3 * side * side), side);

    // See `warmUp`. The size is read off the model rather than assumed, so a re-exported model at a
    // different resolution warms the shape it will actually be asked for — warming the wrong one
    // would compile a set of shaders nothing then uses, which is the failure that still looks fine.
    if (opts.warmUp ?? true) {
      await probe();

      // A GPU WE CHOSE IS TIMED, and dropped if it is not one.
      //
      // `softwareAdapter` reads what the browser SAYS the adapter is; this reads what it does, and
      // the second is what the app actually cares about. It is the class fix behind that name list:
      // whatever a rasteriser calls itself, and however new it is, a provider that cannot run this
      // model inside the budget is one the wasm path beats — so the same measurement that exposed
      // SwiftShader covers the next one without knowing its name.
      //
      // AFTER the warm-up, so it times a run and not a shader compilation, and only when the
      // warm-up actually ran (`warmUp: false` would leave the first run carrying that cost and read
      // as a catastrophe on healthy hardware).
      //
      // The BEST of two samples, not one. A single sample is a claim about a moment: a page that is
      // backgrounded, a GC pause, or another tab taking the GPU can make one run arbitrarily slow,
      // and the penalty here is permanent for the runner's life. Taking the minimum asks "can this
      // provider do it at all", which is the actual question — a rasteriser's best run is still
      // thousands of milliseconds, so the margin below survives it intact.
      //
      // That margin is enormous on purpose — measured on this model: 20 ms on a real GPU in both
      // engines, 57 ms for 6-thread wasm, 6184 ms on SwiftShader. Anything between 400 ms and those
      // extremes is a machine where neither path is good, and rebuilding there costs more than it
      // saves.
      // A HIDDEN PAGE IS NOT EVIDENCE. Both samples can land inside one throttled stretch — a
      // backgrounded tab, a locked screen — and the penalty here is permanent for the runner's
      // life, so the honest move is to decline to judge rather than to judge on bad data. Keeping
      // the GPU is the right default when declining: it was chosen because the adapter is real and
      // not a rasteriser, which is a fact this timing cannot improve on.
      //
      // Checked AROUND EACH SAMPLE and again before the verdict, not once on the way in. A single
      // check before the loop only rules out a page that was already hidden — the page can go
      // hidden during the first awaited probe, which is precisely when a tab is likely to be
      // backgrounded, and then both samples are throttled and the downgrade is permanent anyway.
      const hidden = (): boolean => globalThis.document?.visibilityState === 'hidden';
      if (gpu && chosenHere && !hidden()) {
        let best = Number.POSITIVE_INFINITY;
        let watched = true;
        for (let i = 0; i < GPU_PROBE_RUNS && watched; i++) {
          const started = performance.now();
          await probe();
          if (hidden()) watched = false;
          else best = Math.min(best, performance.now() - started);
        }
        const budget = opts.gpuBudgetMs ?? GPU_BUDGET_MS;
        if (watched && !hidden() && best > budget) {
          console.info(
            `[cubus] the GPU ran this model in ${Math.round(best)} ms — slower than the wasm runtime, so using that instead`,
          );
          // Released BEFORE the rebuild, not after: two live sessions is the one arrangement that
          // can fail for want of memory on the machine least able to spare it.
          await session.release().catch(() => {});
          // The SAME ortUrl: asking for wasm changes the proxy mode, and `runtimeUrl` turns that
          // into a different module by itself. Nothing here needs to know that it did.
          return createModelRunner(modelUrl, { ...opts, executionProviders: ['wasm'] });
        }
      }
    }

    // The session is reachable for release. `RunModel` is a bare function by design — `detectFace`
    // takes it and knows nothing about runtimes — so the handles are attached rather than wrapping
    // it, which keeps every existing caller working while giving the ones that own the lifecycle a
    // way to end it. Without this each rebuilt scan panel left a session behind holding its wasm
    // heap or its GPU device, for the life of the page.
    return Object.assign(run, {
      dispose: () => session.release(),
      providers: executionProviders,
    });
  });
}
