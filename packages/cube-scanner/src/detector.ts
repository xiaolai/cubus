// The seam every capture-and-inference runtime sits behind.
//
// The scan loop used to wire three concrete things together itself — `openCamera()` → `grab()` →
// `preprocess()` → the injected wasm `run()` — which meant a native camera or a native model would
// have had to be threaded through the panel as a fourth and fifth thing. Instead the panel consumes
// ONE interface: "give me the raw model output for a fresh frame". Where the frame came from and
// what ran the model is the implementation's business.
//
// Two implementations satisfy it, and both must, or the desktop and web builds stop being one app:
//   - `WebDetector`   (view/web-detector.ts) — getUserMedia + `preprocess()` + onnxruntime-web.
//   - `NativeDetector` (view/native-detector.ts) — one Tauri plugin call per frame; the camera,
//     the letterbox and the model all run native and only the output tensor crosses the bridge.
//
// Everything downstream of `next()` — `decodeDetections` → `nms` → `fitFace` → `assembleColors` —
// stays in TypeScript as the single post-processing implementation the invariant tests cover.

import type { CameraDevice, CameraOptions } from './camera.js';

/**
 * The raw detect-head output for one frame: `[4 + numClasses, anchors]`, row-major, boxes in the
 * model's 640×640 input space — exactly what `decodeDetections` parses, from every runtime.
 */
export interface ModelOutput {
  data: Float32Array;
  anchors: number;
  /**
   * The tensor's ROW count, carried so `fitFromOutput` can refuse a head that is not this model's.
   *
   * Required, not optional, and that is the whole value of it. The web runtime already checked
   * this inside `validatedRun` (515002d); the native path decoded `rows` out of the plugin's
   * header and threw it away, so a transposed or re-exported model reached `decodeDetections` and
   * was read off stale offsets — a cube nobody held, with nothing anywhere reporting a problem.
   * Making it part of the shared seam is what puts BOTH runtimes behind one assertion.
   */
  rows: number;
}

/** The two getters a browser detector is built from — and can be re-pointed at (see `retarget`). */
export interface DetectorSource {
  video: () => HTMLVideoElement;
  modelUrl: () => string;
}

export interface Detector {
  /**
   * Open a camera. An empty `opts` means the platform default. Rejects if the camera cannot be
   * opened — a pinned `deviceId` that has gone away rejects too, so a caller can choose to fall back.
   * A `stop()` while this is pending releases the stream the moment it arrives and rejects with an
   * AbortError, so no camera is ever left running with nothing to read it.
   */
  use(opts?: CameraOptions): Promise<void>;
  /**
   * Load (or compile) the model, once. Deliberately separate from `use()`: the camera opens FIRST,
   * so a slow or failed model load never leaves the scanner without a camera — and the host can say
   * "loading the model" rather than "opening the camera" while it waits.
   */
  load(): Promise<void>;
  /**
   * The model output for a fresh frame, or `null` when there is no frame to read yet (a camera that
   * has opened but not delivered a frame). Rejects on a real failure, never on "not yet".
   */
  next(): Promise<ModelOutput | null>;
  /** The selectable cameras. Labels may be empty until permission has been granted. */
  cameras(): Promise<CameraDevice[]>;
  /** The camera in use, or null when none is open. A host that shows no preview needs it. */
  readonly device: CameraDevice | null;
  /**
   * WHICH model is loaded right now — the string `load()` was given — or null when none is.
   *
   * The detector is the only thing that knows, and that is the whole reason this is on the seam.
   * Everything else has to ask its OWNER, which answers with the model the owner is asking for NOW:
   * an attribute changed between the load and the disconnect made `CameraSession.park()` file
   * model A under model B's name, and the next mount asking for B was told it was already loaded
   * and scanned on A. Reproduced. A flag with no subject cannot be checked; this is the subject.
   *
   * Optional, and `undefined` means "this runtime does not answer to a URL" rather than "nothing is
   * loaded" — the native plugin resolves and compiles the bundled model itself, so its identity is
   * not a URL and a caller must fall back to the label its owner uses. `null` is the negative
   * answer, and the two are deliberately different values.
   */
  readonly loadedModel?: string | null;
  /**
   * What the loaded model was asked to run ON, by name — `['webgpu', 'wasm']`, `['wasm']`. Null
   * until the model has loaded, and absent entirely where the runtime does not publish one (the
   * native plugin compiles for CoreML/LiteRT and offers no such list).
   *
   * The provider list as REQUESTED, never a claim about which provider executed each node —
   * `ModelRunner.providers` documents that distinction and this is the same value.
   */
  readonly providers?: readonly string[] | null;
  /**
   * Point this detector at a different owner's `<video>` and model URL.
   *
   * Only a detector that is REUSED across owners needs it, which is exactly what the page-level
   * park makes possible (`pickDetector`). The getters are captured at construction, so a parked
   * detector handed to a second `<ai-scan-panel>` would otherwise keep driving the first panel's
   * detached video element — a camera reading a DOM node nobody can see.
   *
   * Optional because the native detector owns no DOM and resolves its own model.
   */
  retarget?(source: DetectorSource): void;
  /** Release the camera. The model stays loaded; a later `use()` reopens. Safe to call repeatedly. */
  stop(): void;
  /**
   * Release EVERYTHING, including the model, and invalidate every load still in flight.
   *
   * Distinct from `stop()` on purpose, and the distinction is the whole point: `stop()` runs at the
   * start of every `use()`, so releasing the session there would recompile the model on every
   * camera switch. This runs only where a detector is genuinely discarded — replaced by an
   * injection, or built by a probe that lost its race. Those sites called `stop()`, which left the
   * old detector's inference session holding its wasm heap or its GPU device for the life of the
   * page.
   *
   * IT IS NOT A TOMBSTONE (corrected 2026-09-05; this said "the detector is unusable afterwards",
   * which `WebDetector` has never implemented and a test forbids). What it invalidates is
   * everything the detector was holding or about to install — the session, and the loads that were
   * out when it ran, which release themselves rather than landing on a detector nobody holds. A
   * call made AFTER it is a NEW caller, not a stale queue: `load()` starts a real load and `use()`
   * opens a camera, exactly as on a fresh instance. The distinction is load-bearing rather than
   * permissive — the disposal paths and the re-use paths overlap by construction at the park, so a
   * `dispose()` that refused afterwards would turn "the panel came back" into "the scanner is
   * dead". Pinned by `tests/web-detector.test.ts` ("still starts a load asked for AFTER a
   * dispose").
   *
   * Optional because not every detector owns anything a `stop()` does not already release.
   */
  dispose?(): void;
}
