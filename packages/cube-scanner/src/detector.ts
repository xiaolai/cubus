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
  /** Release the camera. The model stays loaded; a later `use()` reopens. Safe to call repeatedly. */
  stop(): void;
  /**
   * Release EVERYTHING, including the model. The detector is unusable afterwards.
   *
   * Distinct from `stop()` on purpose, and the distinction is the whole point: `stop()` runs at the
   * start of every `use()`, so releasing the session there would recompile the model on every
   * camera switch. This runs only where a detector is genuinely discarded — replaced by an
   * injection, or built by a probe that lost its race. Those sites called `stop()`, which left the
   * old detector's inference session holding its wasm heap or its GPU device for the life of the
   * page.
   *
   * Optional because not every detector owns anything a `stop()` does not already release.
   */
  dispose?(): void;
}
