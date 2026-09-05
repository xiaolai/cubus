import type { Detector, DetectorSource } from '../src/detector.js';
import { CUBE_VISION, type Invoke, NativeDetector } from './native-detector.js';
import { WebDetector } from './web-detector.js';

/** Which inference backend a panel ended up on. */
export type ScanRuntime = 'native' | 'web';

/** A chosen detector, and what a later owner needs to know about it. */
export interface DetectorChoice {
  detector: Detector;
  runtime: ScanRuntime;
  /** True once this detector's model is loaded — carried with it, so a re-mount does not reload. */
  modelLoaded: boolean;
  /**
   * WHICH model `modelLoaded` is about, or null when nothing is loaded.
   *
   * The flag alone is a claim with no subject, and a parked detector is precisely where the
   * subject can change: `pickDetector` re-points it at the NEW owner's `modelUrl`, so a panel
   * asking for model B was handed a detector whose flag said "loaded" about model A — and the
   * panel then skipped `load()` and scanned with the previous owner's model, reporting nothing
   * unusual. The URL travels with the flag so the claim can be checked.
   */
  modelUrl: string | null;
}

/**
 * THE PAGE'S ONE DETECTOR, parked between `<ai-scan-panel>` mounts.
 *
 * A detector owns an InferenceSession — a wasm heap or a GPU device — plus a 1–5 s model load, and
 * every visit to the scan screen built a fresh one: `stage.innerHTML` is replaced, the old panel
 * disconnects, a new panel connects, and the old session was never released by anything. The page
 * accumulated one live session per visit.
 *
 * The fix is the `<cubus-cube>` rule, which the app already applies to the WebGL context for
 * exactly this reason: park one instance between renders rather than rebuilding it. So:
 *
 *   - `pickDetector` hands out the parked one when there is one, re-pointed at the new owner's
 *     `<video>` and model URL (`Detector.retarget`) — a detector still driving the previous
 *     panel's detached shadow root is a camera nobody can see.
 *   - `parkDetector` takes it back when the owner disconnects, stopping the CAMERA and keeping the
 *     MODEL. That is the whole distinction `Detector.stop` and `Detector.dispose` exist to draw.
 *   - Exactly ONE is kept. While it is lent out the slot is null, so a second panel alive at the
 *     same time gets a detector of its own rather than fighting over one camera — and that one is
 *     disposed when it is handed back, because a quiet session leak is worse than a rebuild. This
 *     is the same rule `<cubus-cube>` states as "a detached, unparked cube releases itself".
 *   - Nothing is parked automatically. An injected detector (`CameraSession.use`, the test seam)
 *     belongs to its caller and must never reach a page-wide slot, so the session tracks which of
 *     the two it holds and only offers the one that came from here.
 */
let parked: DetectorChoice | null = null;

/**
 * Give the page's detector back, or dispose it if the slot is already taken.
 *
 * `stop()` and not `dispose()`: the camera is released and the compiled model is kept, which is
 * the entire point of parking. The only thing parking may cost is a lens left on.
 */
export function parkDetector(choice: DetectorChoice): void {
  choice.detector.stop();
  if (parked && parked.detector !== choice.detector) {
    choice.detector.dispose?.();
    return;
  }
  parked = choice;
}

/** What the page is keeping, or null while it is lent out. Reading it never takes it. */
export function parkedDetector(): DetectorChoice | null {
  return parked;
}

/**
 * Release the page's parked detector, model and all. The next scan builds a fresh one.
 *
 * For a host that genuinely wants the memory back — and for tests, which must not carry one
 * page's session into the next case.
 */
export function disposeParkedDetector(): void {
  const kept = parked;
  parked = null;
  kept?.detector.dispose?.();
  kept?.detector.stop();
}

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: Invoke } };
}

/**
 * Is this rejection just "there is no such command here"?
 *
 * Tauri rejects an unregistered command with a string naming it, and that — the plugin simply not
 * being in this build — is the only quiet case.
 *
 * `not allowed` is deliberately NOT here, though it is the neighbouring wording and the first
 * version of this matched it. It means the command EXISTS and the capability file withholds it,
 * which on the platforms that ship the plugin is a broken configuration, not an unsupported
 * platform: `cube-vision:default` grants `probe`, so a build that gets this has lost its
 * permissions and would fall silently to wasm forever. Quieting it would hide exactly the failure
 * this branch exists to surface.
 *
 * Deliberately narrow for the same reason: a wording this does not recognise is treated as a real
 * failure, so the worst a future Tauri release can do is make a working build noisy.
 */
function absentCommand(err: unknown): boolean {
  const text = typeof err === 'string' ? err : ((err as Error)?.message ?? '');
  return /not found|unknown command/i.test(text);
}

/**
 * Choose the inference backend: the native plugin if it answers, the browser otherwise.
 *
 * Separated from the panel because the choice needs nothing the panel has except two getters, and
 * mixing it in made a 900-line class one function longer for no reason. Everything else in the
 * camera lifecycle reports progress, draws buttons and consults scan state; this only answers a
 * question and hands back an object.
 *
 * The ONLY requirement for the native path is that the plugin answers its probe with `true`. It
 * resolves its own model, so no JS path API is involved — depending on one is what used to drop the
 * desktop app silently onto the wasm runtime.
 *
 * The getters are lazy on purpose. The video element does not exist until the panel has rendered,
 * and the model URL can be set by an attribute after construction, so taking either by value here
 * would capture whatever happened to be true at selection time.
 */
export async function pickDetector(opts: DetectorSource): Promise<DetectorChoice> {
  // The page already has one, and it is not in use: take it, and point it at this owner. The
  // probe is not repeated either — which runtime this build has cannot change between two mounts
  // of the same element on the same page.
  const kept = parked;
  if (kept) {
    parked = null;
    kept.detector.retarget?.(opts);
    // THE MODEL IS ONLY LOADED IF IT IS THIS OWNER'S MODEL. `retarget` has just changed which URL
    // the detector answers for, so carrying the flag across unchecked told the new panel its model
    // was ready when what is compiled is the PREVIOUS owner's. `load()` was then skipped and the
    // scan ran on the wrong model, which produces readings rather than errors.
    //
    // Compared as the STRINGS the two owners' `modelUrl` getters produce, not as resolved URLs:
    // this module runs where there may be no document to resolve against, and the two failures are
    // not symmetrical. A false MISMATCH costs one call to an idempotent `load()` that returns at
    // once; a false MATCH is the wrong model, silently. String equality can only produce the first.
    const wanted = opts.modelUrl();
    if (kept.modelLoaded && kept.modelUrl !== wanted) {
      return { detector: kept.detector, runtime: kept.runtime, modelLoaded: false, modelUrl: null };
    }
    return kept;
  }
  const invoke = (globalThis as TauriGlobal).__TAURI__?.core?.invoke;
  if (invoke) {
    try {
      // `=== true`, not truthiness. `invoke` is typed to return `unknown` because it crosses a
      // bridge, and every non-empty string and every object is truthy — so a plugin answering
      // "false", or an error object some shell serialises instead of rejecting, would put the app
      // on a native path whose commands then fail one frame at a time. Only the one answer the
      // plugin promises counts as yes.
      if ((await invoke(`${CUBE_VISION}probe`)) === true) {
        return {
          detector: new NativeDetector(invoke),
          runtime: 'native',
          modelLoaded: false,
          modelUrl: null,
        };
      }
    } catch (err) {
      // The browser path is what every build has, so falling through is always right. But
      // "no plugin on this platform" and "the plugin is installed and broken" used to be the same
      // silence, and this project's rule is fail loud: a native build that has quietly demoted
      // itself to wasm has to be findable without a debugger. The user sees nothing either way —
      // the scan still works, just slower.
      //
      // The two get different volumes, because they are different facts. The Windows and Linux
      // desktop shells deliberately ship WITHOUT this plugin, so an unknown-command rejection
      // there is the design working, and warning about it on every launch would teach whoever
      // reads that console to skip the line that matters. Anything else — a registered plugin
      // that threw, a permission the capability file was supposed to grant — is the case worth
      // shouting about, so it stays a warning. See `absentCommand` for where the line is.
      (absentCommand(err) ? console.info : console.warn)(
        `[cubus] no native cube-vision runtime — using the browser one${absentCommand(err) ? '' : ' after an unexpected failure'}`,
        err,
      );
    }
  }
  return {
    detector: new WebDetector(opts.video, opts.modelUrl),
    runtime: 'web',
    modelLoaded: false,
    modelUrl: null,
  };
}
