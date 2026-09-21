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

import { type CameraDevice, type CameraOptions, facingOf } from '../src/camera.js';
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
 *
 * THE NAMES ARE SENT IN snake_case AND ARRIVE IN TWO SPELLINGS (2026-09-20, audit 1.6). A Rust
 * `invoke_handler` (Apple, Windows) matches a command verbatim, so `open_camera` is `fn
 * open_camera`. The Android plugin registers no Rust handler, so the call takes Tauri's mobile
 * fallback, which camel-cases the name before handing it to Kotlin (`heck::AsLowerCamelCase`,
 * tauri-2.11.5/src/webview/mod.rs ~1891) — so `open_camera` there is `fun openCamera`, and a
 * Kotlin method spelled `open_camera` is one nothing can reach. Nothing here changes for that;
 * this file keeps sending what the ACL names (crates/cube-vision/build.rs).
 *
 * WHAT IS AND IS NOT PROVEN ABOUT THAT (corrected 2026-09-21).
 * `apps/web/test/native-plugin-commands.test.mjs` reads every name this file sends and every
 * `@Command` the Kotlin plugin declares, and requires them to pair under the camel-casing rule AS
 * THAT TEST SPELLS IT — a copy
 * of `heck`'s rule, applied to source text. It drives no Tauri dispatch, and it would not go red on
 * its own if a Tauri upgrade changed how the mobile fallback spells a command: the version the rule
 * was read from is pinned only by `Cargo.lock`, so a bump of `tauri` there is the moment to re-read
 * `run_command` and re-check the rule. That the commands are reachable on a device is a claim only
 * an Android run can make, and none has yet (`VisionPlugin.kt`'s own note; the native path there is
 * behind a flag until one does).
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
 * `sendClose` reports a close's failure where it happens, `use()` reports an open's.
 *
 * TWO OPENS ARE NOT ORDERED, AND AN ABANDONED ONE THAT LANDS LATE PUTS THINGS RIGHT (2026-09-21).
 * Two opens issued while the first was still inside the platform are two Tauri tasks with no order
 * between them: the plugin can run the NEWER first and the older second, and the older's camera
 * then replaces the newer's — with the claim held by the newer attempt, so the older, on finding
 * itself cancelled, is refused the close that would have put it right (`mayClose`), and the lens
 * the plugin holds is on a device its owner never asked for. The claim rule's "the issue order is
 * the order the plugin sees" is only true of calls awaited one after another — and these must NOT
 * be: the park's hand-over window makes a second `NativeDetector` ordinary, and a re-mounted panel
 * has to start its camera while the abandoned open before it sits on an unanswered permission
 * prompt (`detector-park.test.ts`, "a re-mount inside the deferred park"). Queueing opens behind
 * opens is the fault the paragraph above refuses, arriving directly.
 *
 * So the order is recovered after the fact instead (`newest`, `repairIfOvertaken`). The bridge
 * answers in the order the plugin finished, and a plugin runs its opens one at a time under its
 * state lock (the Swift lock; Android's main executor), so an abandoned open that LANDS after the
 * newest open has already landed is one that RAN after it: the lens is on this attempt's device.
 * It re-issues the newest owner's open, which puts that owner's device back — one extra open on a
 * rare path, tracked like any other so a close issued meanwhile waits for it. On the same device
 * the repair is a re-open of what is already open, which is what a cancelled open landing late has
 * always amounted to here.
 *
 * A CLOSE THAT NEVER SETTLES IS GIVEN UP ON (2026-09-21, `CLOSE_TIMEOUT_MS`). It used to hold
 * `closesOut` above zero for the life of the page, and every later `use()` waited on it for ever:
 * a plugin that dropped one `close_camera` was a scanner that could never start again. After the
 * limit the close is presumed lost, said so on the console, and taken out of the count; an open may
 * then go out. Should that close land late after all, it can shut the camera the open established
 * — and that is caught where a dead camera is always caught, by the ticks that stop delivering
 * (`tickFail`, "Try Start again"), which is a recovery, where the wait had none. An OPEN that never
 * settles is not bounded the same way, on purpose: a permission prompt is an open that legitimately
 * settles only when the person answers it.
 */
let closing: Promise<unknown> = Promise.resolve();
/** How many closes are crossing the bridge right now — the question an open re-asks after each await. */
let closesOut = 0;
/** Every open still crossing the bridge, so a close cannot be issued underneath one. */
let opening: Promise<unknown> = Promise.resolve();
/** How many opens are in flight; `opening` is only worth reading while this is above zero. */
let opensOut = 0;
/**
 * How long a `close_camera` may go unanswered before it stops holding the bridge (see `closing`).
 * Generous: a close is a device release, milliseconds on every platform measured, and the cost of
 * a wrong guess here is one late close on a camera a later open has already established.
 */
export const CLOSE_TIMEOUT_MS = 10_000;

/**
 * The newest open ISSUED — whose claim, what it asked for, and whether it has landed — so an older
 * open landing after it can tell that it overtook it and put the newest owner's device back
 * (`repairIfOvertaken`; see `closing`, "two opens are not ordered"). Cleared when that open fails,
 * because there is then no camera of its to restore.
 */
let newest: { claim: number; opts: CameraOptions; landed: boolean } | null = null;

/**
 * Wait until no close is crossing the bridge, re-asking the count after every await — `closing`
 * names only the closes outstanding when it was read, and one added during the wait is not in the
 * promise being waited on. `abandoned` is asked after each await so an attempt cancelled while it
 * waited opens nothing at all. Opens are deliberately NOT waited for (see `closing`).
 */
async function awaitClosesLanded(abandoned: () => void): Promise<void> {
  while (closesOut > 0) {
    await closing;
    abandoned();
  }
}

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
    // Whether this attempt's open has been sent: an abort before that has overtaken nothing.
    let issued = false;
    const abort = (): never => {
      // Close what we are abandoning — unless a LATER open has taken the camera, in which case the
      // lens on now is not the one this attempt opened… unless it IS, because this open ran after
      // that later one (see `closing`, "two opens are not ordered"), which is put right here.
      this.closeCamera(claim);
      if (issued) this.repairIfOvertaken(claim);
      throw new DOMException('camera open superseded', 'AbortError');
    };
    // A close still crossing the bridge lands FIRST, or it lands on this open's camera (see
    // `closing`). The wait terminates because a close can only be ADDED by a `stop()` or an
    // abandoned attempt, one that cancels THIS attempt takes it out through `abort()` on the very
    // next check, and a close that never lands is bounded (`CLOSE_TIMEOUT_MS`). Awaited ONLY when
    // there is something to wait for: an open with a quiet bridge is issued in the same turn it
    // always was, which the claim rule and every caller that stops it in that turn rely on.
    if (closesOut > 0) {
      await awaitClosesLanded(() => {
        if (cancelled()) abort();
      });
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
      issued = true;
      newest = { claim, opts, landed: false };
      trackOpen(sent);
      await sent;
      // `newest` may be NULL here (2026-09-21, on verification): a newer open that FAILED while this
      // one was crossing cleared it in its own catch, and this landing then read `.claim` off
      // nothing — a TypeError where a cancelled attempt owes its caller an AbortError.
      if (newest?.claim === claim) newest.landed = true;
    } catch (err) {
      // Nothing was opened, so nothing is closed — but the claim was taken on the way in and a
      // claim held by an attempt that failed would refuse every later `stop()` the right to close
      // the camera. Given back, and only if it is still ours; and there is no camera of ours for
      // an older open landing late to restore.
      if (cameraClaim === claim) cameraClaim = 0;
      if (newest?.claim === claim) newest = null;
      throw err;
    }
    if (cancelled()) abort();
    // Learn which camera actually opened — a host that shows no preview needs it, and a Continuity
    // Camera or a virtual one is indistinguishable from the built-in otherwise.
    let info: CameraDevice | null;
    try {
      info = nativeDevice(await this.invoke(`${P}current_camera`));
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
  /** Bumped by `dispose()`, so a load still crossing the bridge cannot mark the model loaded after it. */
  private loadGeneration = 0;

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    // The plugin finds and compiles the bundled model itself; the panel only waits and reports.
    const generation = this.loadGeneration;
    this.loading = this.invoke(`${P}load_model`, { computeUnits: this.computeUnits })
      .then(() => {
        // A `dispose()` while this crossed has moved on: the plugin compiled, but this detector
        // no longer claims it, and the next `load()` asks the plugin afresh (see `dispose`).
        if (generation === this.loadGeneration) this.loaded = true;
      })
      .finally(() => {
        if (generation === this.loadGeneration) this.loading = null;
      });
    return this.loading;
  }

  async next(): Promise<ModelOutput | null> {
    // ArrayBuffer on Apple, `{ tensor }` on Android — see decodeTensorResponse for why the two
    // platforms cannot agree on this one shape. CHECKED AT THE BRIDGE (2026-09-21): a reply of any
    // other shape used to become `''`, which is Android's "no frame yet", so a plugin answering
    // with nothing at all — a missing key, a number, a null — read as a camera that was warming up
    // for as long as anyone waited, and `tickFail` never fired because every tick "answered".
    const reply = await this.invoke(`${P}next_detection`);
    if (reply instanceof ArrayBuffer) return decodeTensorResponse(reply);
    if (reply !== null && typeof reply === 'object' && 'tensor' in reply) {
      const { tensor } = reply as { tensor: unknown };
      if (typeof tensor === 'string') return decodeTensorResponse(tensor);
      throw new Error(`cube-vision: next_detection answered with a ${typeof tensor} tensor`);
    }
    throw new Error(
      `cube-vision: next_detection answered with ${reply === null ? 'null' : `a ${typeof reply}`}, not a tensor`,
    );
  }

  async cameras(): Promise<CameraDevice[]> {
    return nativeCameras(await this.invoke(`${P}list_cameras`));
  }

  stop(): void {
    this.opening++; // supersede an open still in flight — see `use`
    this.dev = null;
    this.closeCamera(this.claim);
  }

  /**
   * Release the camera AND forget the model, so the next `load()` asks the plugin to build it again.
   *
   * ADDED 2026-09-21, for the panel's recovery from an inference that never settled: `tickFail`
   * disposes the detector and clears `modelLoaded`, so that Start builds a fresh session — which it
   * did for `WebDetector` and not here, because this class had no `dispose()` and its `load()` then
   * answered "already loaded" without crossing the bridge. The wedged plugin session was kept, and
   * every Start after a timeout was the same fifteen seconds and the same notice. The model lives in
   * the plugin, so what is released here is this side's CLAIM on it: `load_model` is sent again,
   * and the plugin replaces what it holds (each platform's `load_model` builds anew). Not a
   * tombstone, exactly as `Detector.dispose` says: a `load()` or `use()` after this is a new caller.
   */
  dispose(): void {
    this.stop();
    this.loadGeneration++;
    this.loaded = false;
    this.loading = null;
  }

  /**
   * This attempt's open has landed, cancelled — and if the NEWEST open had already landed by then,
   * this one ran after it and the lens is on this attempt's device, not its owner's: re-issue that
   * owner's open (see `closing`, "two opens are not ordered"). Nothing to do when the newest is
   * still in flight (it lands after, and so ran after), when the newest is this attempt, or when
   * the newest owner has since let the claim go (its `stop()` closed what it held).
   */
  private repairIfOvertaken(claim: number): void {
    const owner = newest;
    if (!owner || owner.claim === claim || !owner.landed || cameraClaim !== owner.claim) return;
    const sent = this.invoke(`${P}open_camera`, { deviceId: owner.opts.deviceId ?? null });
    trackOpen(sent);
    void sent.then(
      () => {},
      (err: unknown) => {
        console.warn(
          '[cubus] the native camera could not be reopened for its owner after an abandoned open landed late',
          err,
        );
      },
    );
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
    // Counted out when it settles — or when it has gone unanswered past the limit, whichever is
    // first, and only once (see `closing`, "a close that never settles").
    let counted = false;
    const countOut = (): void => {
      if (counted) return;
      counted = true;
      closesOut--;
      if (closesOut === 0) closing = Promise.resolve(); // collapsed as in `trackOpen`
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(
          `[cubus] the native camera's close_camera did not answer within ${Math.round(CLOSE_TIMEOUT_MS / 1000)} seconds — presumed lost; a later open no longer waits for it`,
        );
        resolve();
      }, CLOSE_TIMEOUT_MS);
    });
    const settled = sent.then(() => {
      clearTimeout(timer);
    });
    closing = Promise.all([closing, Promise.race([settled, gaveUp]).then(countOut)]);
  }
}

/**
 * The cameras the plugin lists, each checked as `nativeDevice` checks the one that is open — an
 * array, and every entry a camera with an id, because the list crossed a bridge and used to be
 * trusted through a cast: a malformed entry then failed later, in a host's menu, away from the
 * boundary that let it in (audit, 2026-09-21).
 */
export function nativeCameras(raw: unknown): CameraDevice[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `cube-vision: list_cameras answered with ${raw === null ? 'null' : `a ${typeof raw}`}, not a list`,
    );
  }
  return raw.map((entry, i) => {
    const device = nativeDevice(entry);
    if (device === null) throw new Error(`cube-vision: list_cameras entry ${i} is not a camera`);
    return device;
  });
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
 * Decode the plugin's tensor response, little-endian, in one of two shapes:
 *
 * - version 1: `int32 rows, int32 anchors`, then `rows*anchors` f32;
 * - version 2 (2026-09-19): `int32 -2, int32 rows, int32 anchors, int32 width, int32 height`, then the
 *   same f32s — `width`×`height` being the camera picture the tensor was letterboxed from (after any
 *   rotation), which is how the scan screen places each sticker in the picture
 *   (dev-docs/scan-guidance-plan.md 5).
 *
 * The version is a NEGATIVE first word because a row count never is, so the two cannot be mistaken
 * for each other, and an unknown version is refused rather than read as a row count. Both are
 * accepted because a plugin moves to version 2 when its platform can be built and tested: Apple
 * has, and Windows writes the same bytes through the same Rust encoder (`crates/cube-vision/src/
 * wire.rs`, 2026-09-21 — unverified on a Windows device); Android keeps version 1 until it can be
 * (dev-docs/scan-guidance-plan.md 5). `0`
 * anchors means "no frame yet" → null, which the panel treats as a tick to skip. Exported so a test
 * can pin the wire format without a plugin.
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
  if (buf === null) return null;
  // A version marker is read as soon as there is a word to read: a short response that STARTS a
  // version 2 header is a bridge disagreement, not the idle "no frame yet" a short version 1 one is.
  const versioned = buf.byteLength >= 4 && new Int32Array(buf, 0, 1)[0]! < 0;
  if (!versioned && buf.byteLength < 8) return null;
  const { rows, anchors, headerBytes, picture } = tensorHeader(buf);
  // "No frame yet", in either version: both counts zero, and `tensorHeader` has refused every
  // shape between that and a frame.
  if (anchors === 0) return null;
  const count = rows * anchors;
  const need = headerBytes + count * 4;
  // Fail loud on a malformed response rather than letting the Float32Array constructor throw an
  // opaque RangeError: the plugin promised EXACTLY `count` floats after its header. Shorter, the two
  // sides of the bridge have disagreed and the read cannot be trusted; LONGER is the same
  // disagreement, and used to be read anyway — the surplus silently dropped, so a header that
  // under-counted its own payload produced a tensor read off the wrong offsets with nothing
  // reporting it (audit, 2026-09-21). The arithmetic is checked first: two int32s multiply past
  // what a double counts exactly, and a length that cannot be represented cannot be compared.
  if (!Number.isSafeInteger(need)) {
    throw new Error(`cube-vision tensor: a ${rows}×${anchors} header names a length no buffer has`);
  }
  if (buf.byteLength !== need) {
    throw new Error(
      `cube-vision tensor is ${buf.byteLength} bytes, need ${need} for ${rows}×${anchors}`,
    );
  }
  const data = new Float32Array(buf, headerBytes, count);
  // `rows` is CARRIED, not discarded. It was read off the header, used for one length check and
  // thrown away, so the one runtime that crosses a bridge was the one with no assertion that the
  // tensor is this model's detect head: a re-exported or transposed model reached
  // `decodeDetections` and was read off stale offsets. `fitFromOutput` is where that is now
  // refused, for every runtime at once.
  return picture ? { data, anchors, rows, picture } : { data, anchors, rows };
}

/**
 * The header of a tensor response, in either wire version. A version 2 header either says "no frame
 * yet" — zero anchors, and no picture — or carries a frame AND the positive size of the picture it
 * came from; a frame with no size, or a size with no frame, is the two sides of the bridge
 * disagreeing, and is refused rather than read as a frame nobody can place (audit, 2026-09-19).
 */
function tensorHeader(buf: ArrayBuffer): {
  rows: number;
  anchors: number;
  headerBytes: number;
  picture?: { width: number; height: number };
} {
  const first = new Int32Array(buf, 0, 1)[0]!;
  if (first >= 0) {
    const [rows, anchors] = new Int32Array(buf, 0, 2);
    // The same two shapes version 2 admits, and nothing between (2026-09-21): a frame, both
    // counts positive; or "no frame yet", both zero. Rows with no anchors, or anchors with no rows,
    // used to read as an idle tick — a plugin whose model produced no head, or whose contract had
    // broken, looked like a camera warming up for as long as anyone watched.
    if (rows! > 0 && anchors! > 0) return { rows: rows!, anchors: anchors!, headerBytes: 8 };
    if (rows === 0 && anchors === 0) return { rows: 0, anchors: 0, headerBytes: 8 };
    throw new Error(
      `cube-vision tensor: a version 1 header of ${rows}×${anchors} is neither a frame nor "no frame"`,
    );
  }
  if (first !== -2) throw new Error(`cube-vision tensor: unknown wire version ${-first}`);
  if (buf.byteLength < 20) {
    throw new Error(`cube-vision tensor: a version 2 header is 20 bytes, got ${buf.byteLength}`);
  }
  const header = new Int32Array(buf, 0, 5);
  const [rows, anchors, width, height] = [header[1]!, header[2]!, header[3]!, header[4]!];
  // Exactly two shapes, and nothing between them: a frame, every number positive; or "no frame
  // yet", every number zero. A zero row count beside anchors, a negative anything, a size with no
  // frame or a frame with no size is the two sides disagreeing (audit, 2026-09-19).
  if (rows > 0 && anchors > 0 && width > 0 && height > 0) {
    return { rows, anchors, headerBytes: 20, picture: { width, height } };
  }
  if (rows === 0 && anchors === 0 && width === 0 && height === 0) {
    return { rows, anchors, headerBytes: 20 };
  }
  throw new Error(
    `cube-vision tensor: a version 2 header of ${rows}×${anchors} with a ${width}×${height} picture is neither a frame nor "no frame"`,
  );
}

/**
 * The camera the plugin says is open, as a `CameraDevice` — checked, because it crossed a bridge.
 * `facing` is kept only when it names one of the two directions (the Apple plugin reports
 * AVFoundation's position); anything else means the plugin did not say, which is what a desktop
 * webcam's `unspecified` is.
 */
export function nativeDevice(raw: unknown): CameraDevice | null {
  if (raw === null || raw === undefined) return null;
  const r = raw as Partial<Record<keyof CameraDevice, unknown>>;
  if (typeof r.deviceId !== 'string')
    throw new Error('cube-vision: current_camera answered with no deviceId');
  const facing = facingOf(r.facing);
  return {
    deviceId: r.deviceId,
    label: typeof r.label === 'string' && r.label ? r.label : 'Camera',
    ...(facing ? { facing } : {}),
  };
}
