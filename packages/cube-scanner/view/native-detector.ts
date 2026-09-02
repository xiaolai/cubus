// `Detector` for the native desktop/mobile builds: one Tauri plugin call per frame.
//
// Camera capture, the byte-exact letterbox and the CoreML/LiteRT model all run native, behind the
// `cube-vision` plugin (crates/cube-vision). The RGBA frame NEVER crosses the bridge — only the raw
// output tensor (~170 KB fp16) returns, which is the whole efficiency argument (the IPC spike
// measured that at ≤1 ms, against 4.9 MB of CHW floats a wasm-model-fed-by-native-camera would ship).
// Everything after `next()` — decode → NMS → fitFace → assembleColors — is the same TypeScript the
// browser build runs, so the two builds stay one app.
//
// This module is only ever constructed when `__TAURI__` is present AND the plugin answers its probe
// (see ai-scan-panel's selectDetector); the browser build never loads it.

import type { CameraDevice, CameraOptions } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';

/** The sliver of the Tauri API this needs — typed here so the scanner package takes no Tauri dep. */
export type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** CoreML compute units, matching the plugin's mapping (0 = all, 1 = cpu, 2 = cpu+gpu, 3 = cpu+ANE). */
export enum ComputeUnits {
  All = 0,
  CpuOnly = 1,
  CpuAndGpu = 2,
  CpuAndNeuralEngine = 3,
}

/**
 * The plugin's command namespace. Exported because `pickDetector` probes the SAME plugin before
 * this class is ever constructed, and a rename that reached only one of the two would leave the
 * probe answering for a plugin whose commands no longer exist.
 */
export const CUBE_VISION = 'plugin:cube-vision|';
const P = CUBE_VISION;

export class NativeDetector implements Detector {
  private dev: CameraDevice | null = null;
  private loaded = false;
  /** Bumped by `stop()`, so an open still crossing the bridge knows it has been cancelled. */
  private opening = 0;

  /**
   * @param invoke        the Tauri `invoke` (from `window.__TAURI__.core`). This is the ONLY thing
   *                      required to select the native path — the model is resolved by the plugin
   *                      itself (Rust `resolve_model_path`), not here, because the JS `path` API is
   *                      not always exposed or permitted and depending on it silently dropped the
   *                      whole app to the wasm runtime.
   * @param computeUnits  CoreML compute units; `All` lets CoreML schedule across ANE/GPU/CPU, which
   *                      the compute-unit bench found fastest and fully ANE-resident for this model.
   */
  constructor(
    private readonly invoke: Invoke,
    private readonly computeUnits: ComputeUnits = ComputeUnits.All,
  ) {}

  get device(): CameraDevice | null {
    return this.dev;
  }

  /**
   * Open a camera, and abandon the attempt if `stop()` lands while it is still crossing the bridge.
   *
   * The cancellation is not decoration: `Detector.use` DOCUMENTS that a `stop()` while it is
   * pending releases the camera and rejects, and `WebDetector` has always honoured it through an
   * AbortController, so callers were written against a contract only one implementation kept. This
   * one used to resume after a `stop()` and set `dev` again — reopening a camera the caller had
   * released, which on the panel's painting path meant the lens stayed on while the app reported
   * no camera at all.
   *
   * A counter rather than an AbortController, because there is nothing to abort: the plugin call
   * is already gone. What can be done is refuse to INSTALL its result, and close the camera it
   * opened behind us, which is what `close_camera` here is for.
   */
  async use(opts: CameraOptions = {}): Promise<void> {
    const attempt = ++this.opening;
    const cancelled = (): boolean => attempt !== this.opening;
    const abort = (): never => {
      // The camera may already be open on the plugin side; close what we are abandoning.
      void this.invoke(`${P}close_camera`).catch(() => {});
      throw new DOMException('camera open superseded', 'AbortError');
    };
    // `facingMode` is meaningless natively (the plugin selects by deviceId or the platform default);
    // a pinned deviceId is honoured, everything else opens the default camera.
    await this.invoke(`${P}open_camera`, { deviceId: opts.deviceId ?? null });
    if (cancelled()) abort();
    // Learn which camera actually opened — a host that shows no preview needs it, and a Continuity
    // Camera or a virtual one is indistinguishable from the built-in otherwise.
    const info = (await this.invoke(`${P}current_camera`)) as CameraDevice | null;
    if (cancelled()) abort();
    this.dev = info ?? { deviceId: opts.deviceId ?? '', label: 'Camera' };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    // The plugin finds and compiles the bundled model itself; the panel only waits and reports.
    await this.invoke(`${P}load_model`, { computeUnits: this.computeUnits });
    this.loaded = true;
  }

  async next(): Promise<ModelOutput | null> {
    const buf = (await this.invoke(`${P}next_detection`)) as ArrayBuffer;
    return decodeTensorResponse(buf);
  }

  async cameras(): Promise<CameraDevice[]> {
    return (await this.invoke(`${P}list_cameras`)) as CameraDevice[];
  }

  stop(): void {
    this.opening++; // supersede an open still in flight — see `use`
    this.dev = null;
    // Fire-and-forget: releasing the camera must not make stop() async (the panel calls it from
    // synchronous teardown). A failure here only means the camera closes a tick later.
    void this.invoke(`${P}close_camera`).catch(() => {});
  }
}

/**
 * Decode the plugin's tensor response: `int32 rows, int32 anchors` (little-endian) then
 * `rows*anchors` f32. A header of `0` anchors means "no frame yet" → null, which the panel treats as
 * a tick to skip. Exported so a test can pin the wire format without a running plugin.
 */
export function decodeTensorResponse(buf: ArrayBuffer): ModelOutput | null {
  if (buf.byteLength < 8) return null;
  const header = new Int32Array(buf, 0, 2);
  const rows = header[0]!;
  const anchors = header[1]!;
  if (anchors <= 0 || rows <= 0) return null;
  const count = rows * anchors;
  // Fail loud on a malformed response rather than letting the Float32Array constructor throw an
  // opaque RangeError: the plugin promised `count` floats after the 8-byte header, so if the buffer
  // is shorter the two sides of the bridge have disagreed and the read cannot be trusted.
  if (buf.byteLength < 8 + count * 4) {
    throw new Error(
      `cube-vision tensor is ${buf.byteLength} bytes, need ${8 + count * 4} for ${rows}×${anchors}`,
    );
  }
  const data = new Float32Array(buf, 8, count);
  return { data, anchors };
}
