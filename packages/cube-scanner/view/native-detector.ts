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

/**
 * WHO HOLDS THE ONE NATIVE CAMERA — a module-level claim, because the camera is module-level.
 *
 * `open_camera` and `close_camera` name a device the PLUGIN owns, one per process. Every other
 * lifecycle rule in this package is about one detector's own resources — a `MediaStream`, an
 * `InferenceSession` — and can be settled inside the object that holds it. This one cannot: two
 * `NativeDetector`s are two JavaScript objects over one physical camera, so a `stop()` on either
 * closed whatever was open, including the other's.
 *
 * Two of them is not hypothetical, it is what the detector park produces (2026-09-05). `park()`
 * defers the hand-over while an open is still inside the platform — that deferral is itself a fix,
 * for the case where the SAME detector is handed on and killed by its predecessor's cleanup — so
 * during that window the page's slot is EMPTY. A panel re-mounting there builds a second
 * `NativeDetector`, opens the camera with it, and the abandoned open's cleanup then issues
 * `close_camera` and takes the lens out from under the new owner, whose panel reports a live camera
 * over a dead one. The deferral traded a same-object race for a same-DEVICE one.
 *
 * So a close is permitted from exactly two positions: the claim that opened what is open now, and
 * nobody — the latter kept because it is the pre-existing behaviour for a `stop()` that races its
 * own `open_camera` across the bridge, where the ordering the plugin applies is not ours to know.
 * A claim is taken when the open is ISSUED and not when it resolves, because the resolutions are
 * what can arrive out of order; the issue order is the order the plugin sees.
 */
let cameraClaim = 0;
let claims = 0;

/** May the attempt holding `claim` close the native camera? See `cameraClaim`. */
const mayClose = (claim: number): boolean => cameraClaim === 0 || cameraClaim === claim;

/**
 * THE CLOSE STILL CROSSING THE BRIDGE — because the claim rule rests on an ordering nothing
 * enforced (2026-09-05).
 *
 * `cameraClaim` is taken when an open is ISSUED, "because the issue order is the order the plugin
 * sees". That is true of two awaited calls and false of the one call this file makes
 * fire-and-forget: `close_camera` is issued and never waited for, and Tauri runs each command as
 * its own task, so a close issued before a newer open could still execute AFTER it. The lens then
 * goes out under an owner whose panel reports a live camera — the exact failure `cameraClaim` was
 * written to prevent, arriving underneath it. Reproduced with a delayed bridge.
 *
 * So the two directions are ordered against each other, and BOTH halves are needed — the first
 * attempt at this put only one in. An open waits for every close already crossing, and a close
 * issued while an open is in flight waits for that open. Waiting on the closes alone left the
 * other overtaking untouched; and waiting on a SNAPSHOT of `closing` left the first one alive too,
 * because a close added while an open sat in that wait was not in the promise being waited on — so
 * the open went out with a close still crossing, and that close came down on the camera the open
 * had just established. The COUNT, re-asked after every await, is what closes the hole; the
 * promise only says when to look again.
 *
 * WHAT AN OPEN WAITS FOR IS CLOSES THAT ARE CROSSING, never one that is merely HELD — and that
 * distinction is load-bearing rather than an optimisation. Waiting for held ones too builds
 * open → close → open, which is queueing opens behind opens with a step in between: a camera stuck
 * on an unanswered permission prompt held a close, and the close then held every later attempt, so
 * a re-mounted panel could not start its camera at all until the prompt was answered. That is the
 * exact fault the session's per-detector open chain exists to avoid, arriving transitively (the
 * park's own tests caught it). A held close needs no wait, because the CLAIM settles it: it re-asks
 * `mayClose` at the moment it is finally issued, and a newer attempt has taken the claim by then —
 * at ENTRY to `use()`, before any waiting — so it is dropped. The two rules meet with no gap
 * because incrementing the count and issuing the call happen in one synchronous block, and so do an
 * open's last count check and its own issue: a held close either goes out first and is counted, or
 * the open goes out first and the close is refused.
 *
 * Neither accumulator ever rejects, so a waiter cannot inherit the other side's failure:
 * `sendClose` reports a close's failure where it happens, `use()` reports an open's. A call that
 * never SETTLES does hold the other side up — the same shape of failure a hung `open_camera`
 * already produces, visible as a camera that will not start rather than one that dies mid-scan,
 * and the price of the ordering.
 */
let closing: Promise<unknown> = Promise.resolve();
/** How many closes are crossing the bridge right now — the question an open re-asks after each await. */
let closesOut = 0;
/** Every open still crossing the bridge, so a close cannot be issued underneath one. */
let opening: Promise<unknown> = Promise.resolve();
/** How many opens are in flight; `opening` is only worth reading while this is above zero. */
let opensOut = 0;

/** Record an open crossing the bridge, so a close issued meanwhile is ordered behind it. */
function trackOpen(sent: Promise<unknown>): void {
  opensOut++;
  const settled = (): void => {
    opensOut--;
    // Collapsed once the bridge is quiet, so a session does not accumulate one retained promise
    // per camera start. Safe because every waiter re-reads the accumulator only after re-asking
    // the count, and a settled promise is what it would have awaited anyway.
    if (opensOut === 0) opening = Promise.resolve();
  };
  // Both outcomes, in the SAME turn the call settles: `use()`'s abort path closes the camera the
  // instant its open lands, and a decrement one microtask later would send that close down the
  // deferred path to wait for an open that is already over.
  opening = Promise.all([opening, sent.then(settled, settled)]);
}

export class NativeDetector implements Detector {
  private dev: CameraDevice | null = null;
  private loaded = false;
  /** Bumped by `stop()`, so an open still crossing the bridge knows it has been cancelled. */
  private opening = 0;
  /** This detector's most recent claim on the one native camera — see `cameraClaim`. */
  private claim = 0;

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
    // Claimed BEFORE the call goes out, so the claims are in the order the plugin receives the
    // opens rather than the order they happen to resolve in. See `cameraClaim`.
    const claim = ++claims;
    this.claim = claim;
    cameraClaim = claim;
    const abort = (): never => {
      // Close what we are abandoning — unless a LATER open has taken the camera, in which case the
      // lens on now is not the one this attempt opened.
      this.closeCamera(claim);
      throw new DOMException('camera open superseded', 'AbortError');
    };
    // A close still crossing the bridge lands FIRST, or it lands on this open's camera (see
    // `closing`). Asked as a COUNT, and asked AGAIN after every await: `closing` names only the
    // closes outstanding at the moment it was read, so one added during the wait is not in it, and
    // an open that waited on that single snapshot went out with a close still crossing. The loop
    // ends only with the bridge carrying no close at all — and runs zero times for an open with
    // nothing to wait for, which is therefore issued in the same turn it always was. It terminates
    // because a close can only be ADDED by a `stop()` or an abandoned attempt, and one that cancels
    // THIS attempt takes it out through `abort()` on the very next check.
    while (closesOut > 0) {
      await closing;
      if (cancelled()) abort();
    }
    // The claim belongs to the open being ISSUED, and after a wait of unknown length THIS is the
    // issue. It was taken at entry so that a close arriving mid-wait cannot claim the camera this
    // attempt is already committed to opening; it is re-asserted here because a close that DID
    // land in between gave `cameraClaim` back to nobody, which would leave the camera about to be
    // opened closable by any stale handle.
    cameraClaim = claim;
    // `facingMode` is meaningless natively (the plugin selects by deviceId or the platform default);
    // a pinned deviceId is honoured, everything else opens the default camera.
    try {
      const sent = this.invoke(`${P}open_camera`, { deviceId: opts.deviceId ?? null });
      trackOpen(sent);
      await sent;
    } catch (err) {
      // Nothing was opened, so nothing is closed — but the claim was taken on the way in and a
      // claim held by an attempt that failed would refuse every later `stop()` the right to close
      // the camera. Given back, and only if it is still ours.
      if (cameraClaim === claim) cameraClaim = 0;
      throw err;
    }
    if (cancelled()) abort();
    // Learn which camera actually opened — a host that shows no preview needs it, and a Continuity
    // Camera or a virtual one is indistinguishable from the built-in otherwise.
    let info: CameraDevice | null;
    try {
      info = (await this.invoke(`${P}current_camera`)) as CameraDevice | null;
    } catch (err) {
      // THE CAMERA IS OPEN AND THE CALLER IS ABOUT TO BE TOLD IT IS NOT (2026-09-05). Only the
      // metadata read failed, so the lens is on with nothing reading it and no handle anywhere
      // able to release it: `use()` rejects, `device` stays null, and the panel reports no camera
      // over a live one — which is precisely what the whole claim mechanism exists to make
      // impossible, reached through the one call between the open and the install.
      this.dev = null;
      this.closeCamera(claim);
      throw err;
    }
    if (cancelled()) abort();
    this.dev = info ?? { deviceId: opts.deviceId ?? '', label: 'Camera' };
  }

  /**
   * Compile the model, ONCE.
   *
   * Two guards for one rule. `loaded` covers a second call after the first finished — which the
   * page-level detector park makes ordinary, since a re-mounted panel asks its parked detector to
   * load again and must not pay for a second CoreML/LiteRT compile. `loading` covers two calls
   * that OVERLAP, which the panel's slow-load timeout can produce: without it both crossed the
   * bridge and the plugin compiled twice.
   */
  private loading: Promise<void> | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    // The plugin finds and compiles the bundled model itself; the panel only waits and reports.
    this.loading = this.invoke(`${P}load_model`, { computeUnits: this.computeUnits })
      .then(() => {
        this.loaded = true;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  async next(): Promise<ModelOutput | null> {
    // ArrayBuffer on Apple, `{ tensor }` on Android — see decodeTensorResponse for why the two
    // platforms cannot agree on this one shape.
    const reply = (await this.invoke(`${P}next_detection`)) as ArrayBuffer | { tensor?: string };
    return decodeTensorResponse(reply instanceof ArrayBuffer ? reply : (reply?.tensor ?? ''));
  }

  async cameras(): Promise<CameraDevice[]> {
    return (await this.invoke(`${P}list_cameras`)) as CameraDevice[];
  }

  stop(): void {
    this.opening++; // supersede an open still in flight — see `use`
    this.dev = null;
    this.closeCamera(this.claim);
  }

  /**
   * Close the one native camera, if this claim is entitled to. See `cameraClaim`.
   *
   * Fire-and-forget, because releasing the camera must not make `stop()` async — the panel calls it
   * from synchronous teardown, and there is nothing a caller could do with the answer. Not
   * fire-and-FORGET, though, which is what it was: the close joins `closing`, so the next open
   * waits for it rather than overtaking it.
   */
  private closeCamera(claim: number): void {
    if (!mayClose(claim)) return;
    // The claim is given back FIRST, before this close can fail or be held back: `mayClose` admits
    // anyone once `cameraClaim` is 0, so whatever becomes of it the plugin is left closable by the
    // next `stop()` or `use()`.
    cameraClaim = 0;
    // ISSUED IN THIS TURN while the bridge carries no open, exactly as it always was — the panel
    // tears down synchronously and a close deferred by even a microtask is a close that has not
    // happened yet when the element is gone. While an open IS in flight it is the overtaking in the
    // other direction: each Tauri command is its own task, so a close issued now could execute
    // after that open and take the lens out from under it, and `stop()` racing its own
    // `open_camera` is the ordinary way to reach that. One snapshot of `opening` is enough, because
    // an open issued after this point is one the claim rule refuses this close on (see `closing`).
    if (opensOut > 0) {
      void opening.then(() => {
        this.sendClose(claim);
      });
      return;
    }
    this.sendClose(claim);
  }

  /**
   * Issue `close_camera` for `claim` — unless the claim has moved on while this close was held.
   *
   * A close that WAITED is a close whose reason may have expired: an attempt that claimed the
   * camera meanwhile is about to own the lens, and sending this one now would be the very
   * overtaking the wait exists to prevent, arriving one step later. Dropping it is safe because
   * the claim was given back on the way in — the new owner's own `stop()` closes what it opened.
   *
   * The count and the call go out together, in one synchronous block, because that is what leaves
   * no window for an open to check the count and be issued in between.
   *
   * A FAILURE IS SAID OUT LOUD (2026-09-05). This used to swallow it under the note that "the
   * camera closes a tick later", which nothing implemented — nothing retries, so a rejected
   * `close_camera` is a lens left on for the life of the process with no error anywhere. What IS
   * true is that the claim is given back first, so the plugin is left closable: `mayClose` admits
   * anyone once `cameraClaim` is 0, and the next `stop()` or `use()` issues a close that can
   * succeed. That is the recovery, and it is worth nothing unless somebody knows to look, hence
   * the warning.
   */
  private sendClose(claim: number): void {
    if (!mayClose(claim)) return;
    closesOut++;
    const sent = this.invoke(`${P}close_camera`).then(
      () => {},
      (err: unknown) => {
        console.warn(
          '[cubus] the native camera did not close — the lens may still be on until something opens or closes it again',
          err,
        );
      },
    );
    closing = Promise.all([
      closing,
      sent.then(() => {
        closesOut--;
        if (closesOut === 0) closing = Promise.resolve(); // collapsed as in `trackOpen`
      }),
    ]);
  }
}

/** Base64 → ArrayBuffer, or null for the empty string. Kept here beside its only caller. */
function base64ToBuffer(b64: string): ArrayBuffer | null {
  if (b64.length === 0) return null;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Decode the plugin's tensor response: `int32 rows, int32 anchors` (little-endian) then
 * `rows*anchors` f32. A header of `0` anchors means "no frame yet" → null, which the panel treats as
 * a tick to skip. Exported so a test can pin the wire format without a running plugin.
 */
export function decodeTensorResponse(input: ArrayBuffer | string): ModelOutput | null {
  // TWO shapes, because the two native plugin APIs cannot produce the same one. Tauri's Rust
  // commands can return a raw `Response`, so Apple hands back an ArrayBuffer and nothing is
  // copied. Tauri's ANDROID plugin API is JSON only — `invoke.resolve(JSObject)` — so there is no
  // way to return bytes, and the Kotlin side base64-encodes instead.
  //
  // Base64 and not the hex this project uses on the BLE boundary, and the difference is deliberate
  // rather than an oversight: hex was chosen there against a JSON number array and costs 2x, which
  // is nothing on a 20-byte cube packet. This tensor is ~170 KB EVERY FRAME, where hex would cost
  // 340 KB against base64's 227 KB. The encoding follows the payload, and the reason is written
  // down here so the next reader does not "fix" the inconsistency.
  //
  // An empty string is the Android plugin's "camera open, no frame yet" — the same null the Apple
  // path expresses with a short buffer, and what the panel treats as a tick to skip.
  const buf = typeof input === 'string' ? base64ToBuffer(input) : input;
  if (buf === null || buf.byteLength < 8) return null;
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
  // `rows` is CARRIED, not discarded. It was read off the header, used for one length check and
  // thrown away, so the one runtime that crosses a bridge was the one with no assertion that the
  // tensor is this model's detect head: a re-exported or transposed model reached
  // `decodeDetections` and was read off stale offsets. `fitFromOutput` is where that is now
  // refused, for every runtime at once.
  return { data, anchors, rows };
}
