// `Detector` for the browser: getUserMedia + the pure `preprocess()` + onnxruntime-web (wasm).
//
// This is today's scan path, unchanged in behaviour, composed behind the seam: it owns the
// `FrameSource` the camera hands back and the `RunModel` the runtime hands back, and nothing else.
// It is the implementation every build has — the Tauri shells on Windows and Linux run it too, and
// the browser build is the dev and test surface for everything downstream of `next()`.

import { type CameraOptions, type FrameSource, listCameras, openCamera } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import { preprocess } from '../src/onnx-detect.js';
import { type ModelRunner, createModelRunner } from './onnx-runtime.js';

export class WebDetector implements Detector {
  private source: FrameSource | null = null;
  private run: ModelRunner | null = null;
  private opening: AbortController | null = null;

  /**
   * @param video   returns the element the stream plays into — a getter, not the element itself, so
   *                the detector survives the owner re-rendering its DOM (a custom element rebuilds
   *                its shadow root on every reconnect) and always drives the CURRENT `<video>`. A
   *                display:none video stops delivering frames in some browsers, so the owner keeps
   *                it laid out.
   * @param modelUrl read at `load()` time, so a host may set it after construction.
   */
  constructor(
    private readonly video: () => HTMLVideoElement,
    private readonly modelUrl: () => string,
  ) {}

  get device() {
    return this.source?.device ?? null;
  }

  async use(opts: CameraOptions = {}): Promise<void> {
    this.stop();
    const opening = new AbortController();
    this.opening = opening;
    try {
      // openCamera releases the stream itself when the signal fires, even if it arrives afterwards.
      const source = await openCamera(this.video(), opts, opening.signal);
      this.source = source;
    } finally {
      if (this.opening === opening) this.opening = null;
    }
  }

  async load(): Promise<void> {
    if (this.run) return;
    const modelUrl = this.modelUrl();
    // onnxruntime-web resolves wasmPaths inconsistently: the .wasm relative to the document, but the
    // dynamically-imported .mjs glue relative to THIS bundle (…/vendor/) — so a relative "./vendor/"
    // doubles into "/vendor/vendor/…mjs" and a relative "./" puts the .wasm at the page root (404).
    // An ABSOLUTE URL sidesteps both, being used as-is whatever the base. Point it at the model's
    // own directory (both the model and runtime live there).
    const wasmPaths = new URL(modelUrl.replace(/[^/]+$/, '') || './', document.baseURI).href;
    // The runtime itself lives beside the wasm, as its own module. It must NOT be bundled in here:
    // onnxruntime spawns its inference worker from its own import.meta.url, so a bundled copy would
    // make that worker load the panel — which registers a custom element and dies in a worker,
    // taking inference back onto the main thread with it.
    const ortUrl = `${wasmPaths}ort.mjs`;
    this.run = await createModelRunner(modelUrl, { wasmPaths, ortUrl });
  }

  async next(): Promise<ModelOutput | null> {
    if (!this.source) throw new Error('no camera open — call use() first');
    if (!this.run) throw new Error('model not loaded — call load() first');
    let frame: ReturnType<FrameSource['grab']>;
    try {
      frame = this.source.grab();
    } catch {
      return null; // the camera has opened but has no dimensions yet — a frame will come
    }
    const pre = preprocess(frame);
    return this.run(pre.data, pre.imgsz);
  }

  cameras() {
    return listCameras();
  }

  stop(): void {
    this.opening?.abort();
    this.opening = null;
    this.source?.stop();
    this.source = null;
  }

  dispose(): void {
    this.stop();
    // Fire-and-forget because disposal happens on teardown paths that are synchronous, and a
    // failed release is not something a caller can act on.
    //
    // No cast here any more: `createModelRunner` DECLARES what it returns (`ModelRunner`), so the
    // handle is part of the type rather than something this file asserts into existence. The cast
    // it replaces also carried an optional `dispose?`, which described a runner this field can no
    // longer hold.
    const run = this.run;
    this.run = null;
    void run?.dispose().catch(() => {});
  }
}
