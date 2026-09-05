import type { CameraDevice, CameraOptions } from '../src/camera.js';
import type { Detector } from '../src/detector.js';
import { parkDetector, pickDetector, type ScanRuntime } from './pick-detector.js';

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
 * Every generation bump is also an epoch bump, and never the other way round. A new attempt means
 * a different camera is about to answer, so a frame from the old one is exactly as stale as a
 * frame from a stopped loop — that asymmetry used to be real, and it let an inference in flight
 * across a camera switch file a capture from the camera being switched away from. Mixing the two
 * up produces bugs that need a race to reproduce, which is exactly the kind this project cannot
 * test for from the outside — so they are named, and their rules live here rather than being
 * spelled out at each of the twenty sites that used to consult them.
 */
export class CameraSession {
  private detectorPromise: Promise<Detector> | null = null;
  private detector: Detector | null = null;
  /**
   * Did this session's detector come from `pickDetector`, i.e. may it go back to the page's park?
   *
   * An INJECTED one may not. `use()` is the test seam and the native host's, and a fake handed in
   * by one case must never reach a page-wide slot where the next case would be given it — the
   * failure mode is a suite that passes alone and fails in a file.
   */
  private parkable = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private epoch = 0;
  /** Bumped by `use()`, so an injection beats a probe that is still in flight. See `use`. */
  private detectorChoice = 0;
  /** The `detector.use()` still in flight, so the next one queues behind it. See `open`. */
  private opening: Promise<unknown> | null = null;

  /** Which backend was chosen. Read by the panel purely to report it. */
  runtime: ScanRuntime | null = null;
  /** The open camera, or null. Null is also how the panel knows to stop showing a lens. */
  device: CameraDevice | null = null;
  /** The model is loaded once per detector and survives a stop()/start(). */
  modelLoaded = false;

  /**
   * Begin an attempt, superseding every earlier one AND every frame in flight. Hold the token and
   * check `current()`.
   */
  beginAttempt(): number {
    this.epoch++;
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

  /**
   * Inject a detector — the tests' seam, and the native host's.
   *
   * Retires whatever was there: a replaced detector may hold a live camera, and dropping the
   * reference would leak it with nothing able to close it. The choice is versioned so a
   * `pickDetector` probe still in flight cannot resolve afterwards and overwrite the injection —
   * the panel calls `useDetector` before `start()`, but nothing stopped a host doing it in the
   * other order, and the loser of that race was silent.
   *
   * It ABANDONS the scan, and says so here because it cannot restart one: a `start()` in flight
   * finds itself superseded and returns, the loop stops, and no frame from the old detector can
   * still land. A caller injecting mid-scan owns calling `start()` afterwards. Doing it for them
   * would mean this method deciding a camera should be open, which is the panel's call and not
   * the session's — the session never speaks.
   */
  use(detector: Detector, runtime: ScanRuntime): void {
    // Unconditionally, including when the SAME detector is handed back. `use()` is a reset — it
    // clears `device` and `modelLoaded` — so skipping the release for a re-injection left the
    // session reporting no camera over one that was still open, which is the leak this line is
    // here to prevent in the first place.
    //
    // A DIFFERENT detector is discarded outright and gets `dispose()`, which releases its model
    // too; the same one handed back is only stopped, because disposing it would throw away the
    // very session the caller is re-injecting.
    if (this.detector && this.detector !== detector) this.detector.dispose?.();
    this.detector?.stop();
    // A different detector is a different camera and a different model, so everything measured
    // against the old one is stale: the attempt that is opening it, the inference in flight over
    // it, and the loop asking for more. Stopping the old detector without saying so left
    // `freshFrame` true for a frame the REPLACED detector produced, which then landed as part of
    // the new one's session.
    this.generation++;
    this.epoch++;
    this.stopLoop();
    this.detectorChoice++;
    this.detector = detector;
    this.parkable = false; // the caller's object, never the page's — see `parkable`
    this.detectorPromise = Promise.resolve(detector);
    this.runtime = runtime;
    this.modelLoaded = false;
    this.device = null;
  }

  /**
   * Hand the detector back to the page, so the next mount reuses its session and its model.
   *
   * Called when the OWNER goes away — `<ai-scan-panel>`'s disconnectedCallback — and not from
   * `close()`, which runs on every `stop()` and would give the detector away while the same panel
   * still intends to scan with it. `parkDetector` stops the camera; the model survives.
   *
   * The session forgets it either way: a parked detector is no longer this session's to drive, and
   * a later `ensureDetector()` must ask the page for one afresh rather than resolve a promise
   * holding the one it gave back.
   */
  park(): void {
    this.close();
    const detector = this.detector;
    const parkable = this.parkable;
    this.detector = null;
    this.detectorPromise = null;
    this.parkable = false;
    const runtime = this.runtime;
    const modelLoaded = this.modelLoaded;
    this.modelLoaded = false;
    if (detector && parkable && runtime) parkDetector({ detector, runtime, modelLoaded });
  }

  /**
   * The detector, chosen once and kept for the session's life, so the model survives a stop()/
   * start() and the native probe runs only once. Cached as a promise because the choice is async.
   */
  ensureDetector(video: () => HTMLVideoElement, modelUrl: () => string): Promise<Detector> {
    if (this.detectorPromise === null) {
      const choice = this.detectorChoice;
      this.detectorPromise = pickDetector({ video, modelUrl }).then(
        ({ detector, runtime, modelLoaded }) => {
          // A `use()` landed while the probe was out: the injection wins, and the detector this
          // probe built is released rather than left holding whatever it opened.
          if (choice !== this.detectorChoice) {
            // This one lost and is thrown away, so its model goes with it.
            detector.dispose?.();
            detector.stop();
            return this.detector ?? detector;
          }
          this.detector = detector;
          this.parkable = true;
          this.runtime = runtime;
          // A parked detector arrives with its model already compiled, and says so — otherwise
          // every re-mount reported "loading the model…" and crossed the bridge again for a load
          // both implementations would only short-circuit.
          this.modelLoaded = modelLoaded;
          return detector;
        },
      );
    }
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
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Start ticking, and supersede every frame in flight. Replaces any existing loop rather than
   * running two.
   *
   * The invalidation belongs HERE and not at the call site. It used to be a separate
   * `dropFramesInFlight()` the one caller had to remember alongside this, which is a two-call
   * protocol enforced by nothing: a second caller restarting the loop directly would make an
   * inference from the previous loop pass `freshFrame` again the instant the new timer existed.
   *
   * A RE-ARMED TIMEOUT, not an interval, because the cadence is a function rather than a constant:
   * the panel ticks as fast as the runtime it actually got can answer, and that is known only
   * after the first inference. `setInterval` fixes its period when it is created, so following a
   * measurement would have meant tearing the loop down and rebuilding it on every change — which
   * bumps the epoch, and an epoch bump mid-scan discards the inference in flight.
   *
   * Re-armed BEFORE the tick runs, so a `stopLoop()` from inside the tick — `scheduleCheck` does
   * exactly that — clears the timer that was just set instead of being overwritten by it.
   */
  beginLoop(delay: number | (() => number), tick: () => void): void {
    this.stopLoop();
    this.epoch++;
    const next = typeof delay === 'function' ? delay : (): number => delay;
    const arm = (): void => {
      this.timer = setTimeout(
        () => {
          arm();
          tick();
        },
        Math.max(1, next()),
      );
    };
    arm();
  }

  /** Supersede everything in flight, stop ticking, and release the camera. */
  close(): void {
    this.generation++;
    this.epoch++;
    this.stopLoop();
    this.releaseCamera();
  }

  /**
   * Open a camera, preferring `deviceId` but never dead-ending on it.
   *
   * `token` is the caller's attempt. A superseded attempt does NOT clean up after itself: whoever
   * bumped the generation — a newer `start()`, or `close()` — has already called `releaseCamera()`,
   * and this detector is SHARED, so a late `stop()` here would close the camera the newer attempt
   * has just opened. Rethrowing is the whole of the correct behaviour.
   *
   * Opens are SERIALISED, and that is what makes the rule above safe. `use()` mutates the shared
   * detector's camera, so two of them in flight race to be last, and the loser is whichever
   * happens to settle later — not whichever is current. `WebDetector` hides this by aborting a
   * pending open when the next one starts; `NativeDetector` did not until it was made to, and the
   * `Detector` contract is what says it must, so the ordering cannot rest on it.
   *
   * A CHAIN, not a barrier. The first attempt at this snapshotted the pending open and awaited it,
   * which serialises two attempts and not three: with A pending, B and C both snapshot A, so both
   * start the moment A settles and race each other exactly as before. Measured — three opens
   * arriving A, B, C and settling A, C, B left the detector on B while C was current. Each link
   * has to queue behind the ACTUAL latest, which means assigning the new tail before awaiting it.
   *
   * Serialising is also what lets a superseded attempt clean up after itself again. Its `stop()`
   * used to close whatever camera was open — including a newer attempt's — because the two ran
   * concurrently. Inside the chain nothing else is running: the next link starts after this one
   * returns, so releasing here can only release what THIS attempt opened, and not doing it leaves
   * a camera live with nothing showing it. That is what `stop()` during an open used to do — the
   * panel released the camera, the pending open then settled and reopened it, and painting ran
   * with the lens on and the app reporting no device.
   */
  async open(
    detector: Detector,
    opts: CameraOptions,
    token: number,
  ): Promise<{ fellBack: boolean }> {
    const run = async (): Promise<{ fellBack: boolean }> => {
      try {
        await detector.use(opts);
        return { fellBack: false };
      } catch (err) {
        // A pinned camera can simply go away — a webcam unplugged, or a Continuity Camera whose
        // phone wandered off. Falling back beats dead-ending on an exact-deviceId constraint that
        // can no longer be satisfied. The pin is deliberately KEPT by the caller, so the preferred
        // camera is picked up again the moment it returns.
        if (opts.deviceId === undefined || !this.current(token)) throw err;
        // Everything EXCEPT the pin is carried over. Rebuilding the options from `facingMode`
        // alone silently dropped a caller's width/height, so the fallback camera opened at a
        // different resolution than the one that was asked for. Written as a rest so a field added
        // to CameraOptions is carried by default rather than needing this line edited too.
        const { deviceId: _dropped, ...fallback } = opts;
        await detector.use(fallback);
        return { fellBack: true };
      } finally {
        // Inside the chain, so the next link has not started. See the note above.
        if (!this.current(token)) detector.stop();
      }
    };
    // Whatever the previous link did, and whether it threw: this is an ordering constraint, not a
    // dependency. The tail is published BEFORE it is awaited, so the link after this one queues
    // behind this one rather than behind the same predecessor.
    const chained = (this.opening ?? Promise.resolve()).then(run, run);
    this.opening = chained.then(
      () => undefined,
      () => undefined,
    );
    return chained;
  }
}
