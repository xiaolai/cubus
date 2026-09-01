import type { CameraDevice, CameraOptions } from '../src/camera.js';
import type { Detector } from '../src/detector.js';
import { type ScanRuntime, pickDetector } from './pick-detector.js';

/**
 * The camera's lifecycle, and the two counters that keep a stale one from speaking.
 *
 * IT NEVER SPEAKS. Every method returns a fact or nothing; not one of them reports progress, draws
 * a button, or reads scan state. That is the whole seam: the panel asked for this to be extracted
 * once before and the honest answer was no, because a collaborator needing nine callbacks into its
 * host is the same coupling with an interface bolted on. Returning results as DATA and letting the
 * panel turn them into words is what makes the boundary real.
 *
 * The two counters are the reason this is an object rather than a handful of fields, and they are
 * easy to confuse because both are monotonic integers guarding "is this still valid":
 *
 *   - GENERATION supersedes an ATTEMPT. Opening a camera is async and interruptible — a stop(), a
 *     restart, or a second start while the first is still awaiting a permission prompt. The late
 *     attempt must not install its camera over the new one, and must release the stream it opened
 *     rather than leave a live camera behind with nothing showing it.
 *   - EPOCH supersedes a FRAME. An inference already in flight when the loop stops must not land
 *     afterwards and file a capture into a scan that has moved on or ended.
 *
 * Both are bumped by close(); only generation is bumped by beginAttempt(). Mixing them up produces
 * bugs that need a race to reproduce, which is exactly the kind this project cannot test for from
 * the outside — so they are named, and their rules live here rather than being spelled out at each
 * of the twenty sites that used to consult them.
 */
export class CameraSession {
  private detectorPromise: Promise<Detector> | null = null;
  private detector: Detector | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private epoch = 0;

  /** Which backend was chosen. Read by the panel purely to report it. */
  runtime: ScanRuntime | null = null;
  /** The open camera, or null. Null is also how the panel knows to stop showing a lens. */
  device: CameraDevice | null = null;
  /** The model is loaded once per detector and survives a stop()/start(). */
  modelLoaded = false;

  /** Begin an attempt, superseding every earlier one. Hold the token and check `current()`. */
  beginAttempt(): number {
    return ++this.generation;
  }

  /** Is the attempt holding this token still the one that should finish? */
  current(token: number): boolean {
    return token === this.generation;
  }

  /** The token an in-flight inference must still match when it returns. */
  frameEpoch(): number {
    return this.epoch;
  }

  /** May a frame from `epoch` still be acted on? False once the loop stopped or the scan moved on. */
  freshFrame(epoch: number): boolean {
    return epoch === this.epoch && this.timer !== null;
  }

  /** The detector, if one has been chosen. */
  get chosen(): Detector | null {
    return this.detector;
  }

  /** Inject a detector — the tests' seam, and the native host's. */
  use(detector: Detector, runtime: ScanRuntime): void {
    this.detector = detector;
    this.detectorPromise = Promise.resolve(detector);
    this.runtime = runtime;
  }

  /**
   * The detector, chosen once and kept for the session's life, so the model survives a stop()/
   * start() and the native probe runs only once. Cached as a promise because the choice is async.
   */
  ensureDetector(video: () => HTMLVideoElement, modelUrl: () => string): Promise<Detector> {
    this.detectorPromise ??= pickDetector({ video, modelUrl }).then(({ detector, runtime }) => {
      this.detector = detector;
      this.runtime = runtime;
      return detector;
    });
    return this.detectorPromise;
  }

  /** Release the camera, keeping the detector (and therefore the loaded model). */
  releaseCamera(): void {
    this.detector?.stop();
    this.device = null;
  }

  /** Stop ticking. Does not touch the camera — `restart` keeps the lens alive on purpose. */
  stopLoop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Start ticking. Replaces any existing loop rather than running two. */
  beginLoop(ms: number, tick: () => void): void {
    this.stopLoop();
    this.timer = setInterval(tick, ms);
  }

  /** True while the loop is running — the panel's guard against acting on a stopped scan. */
  get looping(): boolean {
    return this.timer !== null;
  }

  /** Supersede everything in flight, stop ticking, and release the camera. */
  close(): void {
    this.generation++;
    this.epoch++;
    this.stopLoop();
    this.releaseCamera();
  }

  /** Supersede in-flight FRAMES only — a restart keeps the camera but must drop stale inferences. */
  dropFramesInFlight(): void {
    this.epoch++;
  }

  /** Open a camera, preferring `deviceId` but never dead-ending on it. */
  async open(
    detector: Detector,
    opts: CameraOptions,
    token: number,
  ): Promise<{ fellBack: boolean }> {
    try {
      await detector.use(opts);
      return { fellBack: false };
    } catch (err) {
      // A pinned camera can simply go away — a webcam unplugged, or a Continuity Camera whose
      // phone wandered off. Falling back beats dead-ending on an exact-deviceId constraint that
      // can no longer be satisfied. The pin is deliberately KEPT by the caller, so the preferred
      // camera is picked up again the moment it returns.
      if (opts.deviceId === undefined || !this.current(token)) throw err;
      await detector.use({ facingMode: opts.facingMode });
      return { fellBack: true };
    }
  }
}
