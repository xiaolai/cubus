// `Detector` for the browser: getUserMedia + the pure `preprocess()` + onnxruntime-web (wasm).
//
// This is today's scan path, unchanged in behaviour, composed behind the seam: it owns the
// `FrameSource` the camera hands back and the `RunModel` the runtime hands back, and nothing else.
// It is the implementation every build has — the Tauri shells on Windows and Linux run it too, and
// the browser build is the dev and test surface for everything downstream of `next()`.

import {
  type CameraOptions,
  FrameNotReadyError,
  type FrameSource,
  listCameras,
  openCamera,
} from '../src/camera.js';
import type { Detector, DetectorSource, ModelOutput } from '../src/detector.js';
import { preprocess } from '../src/onnx-detect.js';
import { createModelRunner, type ModelRunner } from './onnx-runtime.js';

export class WebDetector implements Detector {
  private source: FrameSource | null = null;
  private run: ModelRunner | null = null;
  /** The model URL `run` was built for — see `load`. */
  private loadedUrl: string | null = null;
  /** A `load()` still in flight, so a second caller waits on it rather than building a rival. */
  private loading: Promise<void> | null = null;
  /** Which model URL that in-flight load is building — see `load`. */
  private loadingUrl: string | null = null;
  /**
   * Bumped by `dispose()`, so a load still in flight cannot install its runner afterwards.
   *
   * A discarded detector that adopts a late runner holds an InferenceSession — a wasm heap or a GPU
   * device — that nothing can reach to release, which is the leak the whole park exists to close.
   * It is reachable exactly where the park is: a panel that disconnects during the 1-5 s model load
   * and a detector that loses the park race are both disposed with a load out.
   */
  private loadGeneration = 0;
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
    private video: () => HTMLVideoElement,
    private modelUrl: () => string,
  ) {}

  get device() {
    return this.source?.device ?? null;
  }

  /**
   * The provider list the loaded runner was created with, or null before the model has loaded.
   *
   * What was ASKED FOR, which is what the timing fallback changes — never a claim about which
   * provider executed each node. `ModelRunner.providers` documents the distinction at length.
   * A provider may be given as an object with a name, so it is reduced to names here.
   */
  get providers(): readonly string[] | null {
    const run = this.run;
    if (!run) return null;
    return run.providers.map((p) => (typeof p === 'string' ? p : p.name));
  }

  /**
   * Point this detector at a different owner's `<video>` and model URL.
   *
   * The park (see `pickDetector`) hands one detector to a second `<ai-scan-panel>` so the page
   * keeps ONE InferenceSession across screen visits — and the getters this was built with close
   * over the FIRST panel's shadow root. Without this the reused detector would open a camera into
   * a detached video element nobody can see, which is a scan that works everywhere except on
   * screen. `load()` notices the model URL changing on its own.
   */
  retarget(source: DetectorSource): void {
    this.video = source.video;
    this.modelUrl = source.modelUrl;
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

  /**
   * Load the model, ONCE per model URL.
   *
   * Two guards, and both are the same lesson from different directions — a session is the most
   * expensive thing this class owns, so nothing may build a second one by accident:
   *
   *   - IN FLIGHT. `if (this.run) return` only catches a load that has FINISHED. Two overlapping
   *     calls — the panel's slow-load timeout abandoning the wait and the user pressing Start —
   *     both saw a null `run` and both created a session, and the first one to finish was then
   *     unreachable for the life of the page.
   *   - PER URL. A parked detector can be handed to an owner with a different `modelUrl`, and
   *     returning early there would silently keep serving the previous owner's model. The old
   *     runner is released before the new one is built.
   *
   * AND THE TWO HAVE TO BE ASKED TOGETHER (2026-09-05). The in-flight guard answered every caller
   * with the pending promise whatever URL they had asked for, so the per-URL rule held only when
   * nothing overlapped: `retarget()` to model B while A was still loading resolved SUCCESSFULLY
   * with A installed, and `loadedUrl` then said A while the owner believed B. Reachable through the
   * park, which is where a detector changes owner and model URL at once. A different URL waits for
   * the load in flight and then starts its own — and re-asks, since by then the answer may have
   * arrived or the target may have moved again.
   */
  async load(): Promise<void> {
    const modelUrl = this.modelUrl();
    if (this.run && this.loadedUrl === modelUrl) return;
    if (this.loading) {
      if (this.loadingUrl === modelUrl) return this.loading;
      // Someone else's model is loading. Wait it out rather than racing it — two sessions being
      // created at once is the thing both guards exist to prevent — and its failure is not ours.
      await this.loading.catch(() => {});
      return this.load();
    }
    const pending = this.loadModel(modelUrl).finally(() => {
      // Only if it is still OURS: a later load may already have replaced it.
      if (this.loading === pending) {
        this.loading = null;
        this.loadingUrl = null;
      }
    });
    this.loading = pending;
    this.loadingUrl = modelUrl;
    return pending;
  }

  private async loadModel(modelUrl: string): Promise<void> {
    const generation = this.loadGeneration;
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
    const run = await createModelRunner(modelUrl, { wasmPaths, ortUrl });
    if (generation !== this.loadGeneration) {
      // Disposed while this was out. Installing the runner now would put a live InferenceSession on
      // a detector nobody holds, which is the leak with no way back — so it is released here and
      // the caller is told the load "finished" with nothing installed, exactly as `dispose()` left
      // it. Fire-and-forget for the reason `dispose` is: teardown is synchronous and a failed
      // release is not something a caller can act on.
      void run.dispose().catch(() => {});
      return;
    }
    const previous = this.run;
    this.run = run;
    this.loadedUrl = modelUrl;
    if (previous) void previous.dispose().catch(() => {});
  }

  async next(): Promise<ModelOutput | null> {
    if (!this.source) throw new Error('no camera open — call use() first');
    if (!this.run) throw new Error('model not loaded — call load() first');
    let frame: ReturnType<FrameSource['grab']>;
    try {
      frame = this.source.grab();
    } catch (err) {
      // EXACTLY the "no frame yet" case, and nothing else. A bare `catch { return null }` turned
      // every failure here into "try again next tick": a canvas that could not be allocated, a
      // `getImageData` refused by a tainted or oversized surface, a video element the owner
      // detached. The scanner then idled forever on "Show any side" with a camera that was never
      // going to deliver — the fail-loud rule suspended for the app's most important surface.
      if (err instanceof FrameNotReadyError) return null;
      throw err;
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
    // Everything a load in flight was about to install is stale from here — see `loadGeneration`.
    // The pending promise is forgotten too, so a `load()` after a `dispose()` starts a real one
    // rather than being answered by a load that will install nothing.
    this.loadGeneration++;
    this.loading = null;
    this.loadingUrl = null;
    const run = this.run;
    this.run = null;
    this.loadedUrl = null;
    void run?.dispose().catch(() => {});
  }
}
