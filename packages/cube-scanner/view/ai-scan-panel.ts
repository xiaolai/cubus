// <ai-scan-panel> — the cube scanner: show the six sides in ANY order and each is captured
// automatically. Driven by the YOLOv11 sticker detector, robust where the old classical HSV path
// failed (red↔orange under lighting). It is the only scanner (the OpenCV path was removed).
//
// Capture and inference sit behind ONE seam, the `Detector`: the panel asks it for the model's
// output for a fresh frame and does not know or care whether a browser (getUserMedia + onnxruntime-
// web, off the main thread) or a native plugin produced it. `makeDetector()` is the single place
// that choice is made. Everything after `next()` — decode → NMS → fitFace → assembleColors — is
// this file's, shared by every runtime. Each face is read as 9 colour classes; the model ABSTAINS
// on a frame that isn't a clean single face. A face's CENTRE colour is its identity (centres never
// move), so a stable read is filed under the face it belongs to — no fixed order, no per-side
// confirm. After all six, `assembleColors` runs the dual verifier. Emits 'scan-complete' (valid
// cube) / 'scan-invalid' (the scan is refused but NOT thrown away — see below).
//
// A refusal keeps the captures. The six sides are the user's work, and every way out of a refusal
// needs them: tap a sticker to correct it (suspects mark where a misread most likely is), show a
// side again to replace its reading, or press restart — the ONLY thing that wipes a scan. The old
// behaviour reset everything and explained why in a message the next tick overwrote, which read as
// the app breaking; now the explanation is a `notice` that rides on every progress report and
// stays until the situation changes, while the transient per-tick hints stay in `message`.
//
// Attributes:
//   autostart — open the camera as soon as the element connects, with no click.
//   device-id — pin a specific camera (from `cameras()`); re-read on every start().
//   facing    — 'user' | 'environment'. UNSET by default, on purpose: see CameraOptions.
//   headless  — draw nothing at all: the host draws the scan from the 'scan-progress' events
//               this emits on every state change, and the element only owns the camera, the
//               model and the capture state machine. The <video> is still laid out (clipped to
//               1px), because a display:none video stops delivering frames in some browsers.
//
// Browser shell — verified by typecheck + esbuild bundle, exercised manually in the app.

import {
  type AiScanResult,
  type ColorFace,
  type ConfirmRequest,
  type StickerSuspect,
  assembleColors,
  assemblePainted,
  rotateFace,
} from '../src/ai-assemble.js';
import type { CameraDevice } from '../src/camera.js';
import type { Detector } from '../src/detector.js';
import { fitFromOutput } from '../src/onnx-detect.js';
import type { FitReason } from '../src/onnx-postprocess.js';
import { FACES, type Face } from '../src/types.js';
import { type Invoke, NativeDetector } from './native-detector.js';
import { WebDetector } from './web-detector.js';

/** Which runtime is actually doing inference — surfaced so "am I on the fast path?" is answerable. */
export type ScanRuntime = 'native' | 'web';

/** The window globals the desktop shell injects (`withGlobalTauri`). Absent in the browser build.
 *  Only `core.invoke` is needed — the native model is resolved by the plugin, not via the JS path API. */
interface TauriGlobal {
  __TAURI__?: {
    core?: { invoke?: Invoke };
  };
}

const GUIDE: Record<Face, { color: string; name: string; swatch: string }> = {
  U: { color: 'WHITE', name: 'Up', swatch: '#f6f7f8' },
  R: { color: 'RED', name: 'Right', swatch: '#d0202a' },
  F: { color: 'GREEN', name: 'Front', swatch: '#049e4a' },
  D: { color: 'YELLOW', name: 'Down', swatch: '#ffd400' },
  L: { color: 'ORANGE', name: 'Left', swatch: '#ff6a00' },
  B: { color: 'BLUE', name: 'Back', swatch: '#0057c8' },
};
/** Colour-class index → swatch, DERIVED from GUIDE so the face/colour map has one source
 *  (class i ↔ FACES[i], 0 white … 5 blue — matching ml/data.yaml). */
const CLASS_SWATCH = FACES.map((f) => GUIDE[f].swatch);
/** What is wrong with the frame in view, as a standalone sentence appended to the idle line.
 *  NO_FACE adds nothing: the idle line already says what to show, and "show any side to the
 *  camera — point a side at the camera" was the tautology this replaces. */
const FRAME_HINT: Record<FitReason, string> = {
  NO_FACE: '',
  PARTIAL_FACE: ' Get the whole side in the frame.',
  BAD_GEOMETRY: ' Hold it flatter and steadier.',
};
// The capture cadence, per runtime. On the web the ~400 ms wasm run dominates, so 200 ms (~5 fps) is
// as fast as it goes; native inference is ~1.5 ms on the ANE, so a 200 ms tick would waste all that
// headroom and leave the scan feeling no faster — 60 ms (~16 fps) lets the native speed actually show
// while staying comfortably inside the camera's frame rate and the ANE's budget.
const TICK_MS_WEB = 200;
const TICK_MS_NATIVE = 60;
const STABLE = 3; // identical reads in a row before we auto-capture a face
// A face must also have held still this long. Counting reads alone made the stillness bar depend
// on the tick rate: 3 web reads span ~1.2 s, but 3 native reads span 180 ms — fast enough to
// capture a cube still being turned into position. Time is what stillness is, so require both.
const STABLE_MS = 500;
// The beat between "captured/corrected" and the verdict. Assembly itself is ~5 ms; this exists so
// the capture that triggered the check — the sixth tile going green, a corrected sticker — paints
// before any refusal lands. Everything used to run in one task, so the browser painted once,
// after the wipe: the user showed a sixth side and watched the board go blank, unexplained.
const CHECK_BEAT_MS = 350;
const OPENING = 'Show any side to the camera — held flat and centred.';
const PAINTING = 'Painting by hand — tap any sticker and pick its colour.';
// A permission prompt can sit unanswered for a long time, and a host that never answers one
// (a WKWebView with no camera entitlement, say) looks identical from here: getUserMedia simply
// never settles. After this long, stop showing 'Opening the camera…' as if it were progress.
const SLOW_OPEN_MS = 8000;
const SLOW_OPEN = 'The camera has not opened. Allow camera access for this app, then try again.';
const PINNED_GONE = 'The camera you chose is unavailable — using the default one.';

/** Where a scan is. Coarse on purpose: enough for a host to style around, no more. */
export type ScanPhase =
  | 'starting'
  | 'loading'
  | 'scanning'
  | 'painting'
  | 'confirm'
  | 'checking'
  | 'done'
  | 'error';

/** One captured side: which face it turned out to be, and the 9 colours read off it. */
export interface CapturedFace {
  face: Face;
  /** 9 colour-class indices in reading order; class i ↔ FACES[i]. */
  colors: number[];
}

/**
 * The pinned half of what the scanner has to say: what it needs from the user and why, standing
 * until the situation changes. Distinct from `message`, which is the transient per-tick line
 * ("hold still…", "show the whole face…") that used to overwrite refusal explanations within one
 * tick — 60 ms on the native path — which is exactly how a refused scan came to look like a crash.
 */
export interface ScanNotice {
  /** Short heading, e.g. "One more look". */
  title: string;
  /** A finished sentence or two, safe to show verbatim. */
  body: string;
  tone: 'info' | 'ok' | 'err';
}

/**
 * `scan-progress` detail — everything a host needs to draw the scan itself. Emitted on every
 * state change, so a headless host is never left guessing what the scanner is doing.
 */
export interface ScanProgress {
  phase: ScanPhase;
  /** A finished sentence, safe to show verbatim. */
  message: string;
  /** Sides captured so far, in URFDLB order. */
  captured: CapturedFace[];
  /** The 9 colour classes in view right now, or null when no clean side is. */
  live: number[] | null;
  /** The camera actually in use, or null before one opens. A host showing no preview needs it. */
  device: CameraDevice | null;
  /**
   * Set while the scan is waiting for one specific side, held a specific way up, to settle a
   * reading it cannot settle alone. Null at every other moment.
   */
  confirm: ConfirmRequest | null;
  /**
   * Which runtime is doing inference — 'native' (the desktop CoreML plugin, ~1.5 ms) or 'web' (the
   * onnxruntime-web wasm model, ~400 ms), or null before one is chosen. A host can show it so the
   * fast path is visible rather than guessed at.
   */
  runtime: ScanRuntime | null;
  /** The pinned explanation/instruction, or null when nothing needs saying beyond `message`. */
  notice: ScanNotice | null;
  /** Stickers a colour misread most plausibly landed on — tap targets; empty otherwise. */
  suspects: StickerSuspect[];
  /**
   * The scan has delivered a valid cube and stands finished — a state, not the 'done' moment: it
   * stays true while the user looks the result over, even if the camera is reopened. The host
   * owns what to say over it ("press Solve this cube" names the HOST's button), which is why this
   * is a flag rather than panel copy.
   */
  complete: boolean;
}

const TEMPLATE = `
<style>
  :host { display: block; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #e6edf3; }
  .stage { position: relative; aspect-ratio: 1; background: #000; border-radius: 12px; overflow: hidden; }
  .stage.flash { animation: cap .5s ease; }
  @keyframes cap {
    0% { box-shadow: inset 0 0 0 0 rgba(63,185,80,0); }
    30% { box-shadow: inset 0 0 0 6px #3fb950; }
    100% { box-shadow: inset 0 0 0 0 rgba(63,185,80,0); }
  }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .status { margin: 12px 0 4px; min-height: 22px; } .status b { color: #fff; }
  .dots { display: flex; gap: 6px; margin: 8px 0; }
  .dots span { width: 26px; height: 14px; border-radius: 3px; border: 1px solid rgba(0,0,0,.4); opacity: .28; }
  .dots span.done { opacity: 1; box-shadow: 0 0 0 2px rgba(63,185,80,.45); }
  .preview { display: none; grid-template-columns: repeat(3, 36px); gap: 4px; margin: 10px 0; }
  .preview[data-show='1'] { display: grid; }
  .preview i { width: 36px; height: 36px; border-radius: 6px; border: 1px solid rgba(0,0,0,.4); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
  button { font: inherit; border: 0; border-radius: 7px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
  button.primary { background: #58a6ff; color: #06122b; }
  button.ghost { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
  button[hidden] { display: none; }
  .err { color: #f85149; } .ok { color: #3fb950; } .muted { color: #8b949e; }
</style>
<div class="stage"><video id="video" playsinline muted></video></div>
<div class="dots" id="dots"></div>
<div class="status" id="status">Click <b>Start camera</b>, then show each side to the camera.</div>
<div class="preview" id="preview"></div>
<div class="row">
  <button class="primary" id="start">Start camera</button>
  <button class="ghost" id="restart" hidden>Start over</button>
</div>
`;

// Headless: the host draws the scan from 'scan-progress'; this element only owns the camera.
// The <video> stays laid out — a display:none video stops delivering frames in some browsers —
// so it is clipped to a 1px box instead of hidden.
const HEADLESS_TEMPLATE = `
<style>
  :host {
    position: fixed; left: 0; top: 0; width: 1px; height: 1px;
    overflow: hidden; clip-path: inset(50%); pointer-events: none;
  }
</style>
<video id="video" playsinline muted></video>
`;

export class AiScanPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  /** Model URL; the app can override before the element renders. */
  modelUrl = './vendor/cube-yolo.onnx';

  /**
   * The capture-and-inference seam. One instance for the element's life: it survives a reconnect
   * (which rebuilds the shadow DOM) so the model is not re-downloaded, and it drives whichever
   * `<video>` is current because it holds a getter, not the element. Web today; Phase 2 chooses a
   * NativeDetector here when the desktop shell's plugin answers.
   */
  private detector: Detector | null = null;
  /** Caches the one-time async detector choice (native vs web); see ensureDetector. */
  private detectorPromise: Promise<Detector> | null = null;
  /** Which runtime the chosen detector uses; drives the tick cadence and rides on every report. */
  private runtime: ScanRuntime | null = null;
  /** True once the model has loaded, so a re-`start()` doesn't re-report 'loading' or reload it. */
  private modelLoaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startGen = 0;
  private busy = false;
  /** `headless`: draw nothing, and let the host draw from 'scan-progress'. */
  private headless = false;

  private readonly faces = {} as Record<Face, ColorFace>;
  private lastColors = '';
  private stableCount = 0;
  /** When the current identical-read streak began; captures need STABLE reads AND STABLE_MS. */
  private stableSince = 0;
  private live: number[] | null = null;
  private device: CameraDevice | null = null;
  /** Captures known to be in canonical rotation, from answering a `confirm` request. */
  private confirmed: Partial<Record<Face, ColorFace>> = {};
  private awaiting: ConfirmRequest | null = null;
  /** Hand-painting mode: the camera is off and every non-centre sticker is settable. */
  private painting = false;
  /** Contradictory confirmations this scan; past one, the notice starts offering restart too. */
  private mismatches = 0;
  private scanEpoch = 0; // bumped by loop()/stop(); rejects stale in-flight inferences
  /**
   * The scan reached a valid cube and delivered it. A finished scan is a state, not a moment:
   * the camera can be reopened over it (picking a camera from the host's menu does exactly that),
   * and without this flag the loop would hungrily nag "show a side" over a complete cube — and a
   * side idly held in view would REPLACE part of an accepted scan. While finished, ticks guide
   * instead of capture; any re-check (a correction, a rescan, a restart) clears it.
   */
  private finished = false;
  /** The pinned explanation riding on every report; null when nothing needs saying. */
  private notice: ScanNotice | null = null;
  /** Where a colour misread most plausibly is; rides on every report so a host can mark them. */
  private suspects: StickerSuspect[] = [];
  /** The pending deferred assembly (see CHECK_BEAT_MS); epoch-guarded and cleared on stop(). */
  private checkTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.headless = this.hasAttribute('headless');
    this.root.innerHTML = this.headless ? HEADLESS_TEMPLATE : TEMPLATE;
    if (!this.headless) {
      this.buildDots();
      this.buildPreview();
      this.maybe<HTMLButtonElement>('start')?.addEventListener('click', () => void this.start());
      this.maybe<HTMLButtonElement>('restart')?.addEventListener('click', () => this.restart());
    }
    // Deferred by a microtask on purpose: a host that inserts this element and attaches its
    // 'scan-progress' listener in the same synchronous block would otherwise miss the very
    // first report, because connectedCallback runs during the insertion.
    if (this.hasAttribute('autostart')) queueMicrotask(() => void this.start());
  }

  disconnectedCallback(): void {
    this.stop();
  }

  /** Release the camera + stop the loop. Safe repeatedly and before first render. The detector
   *  itself is kept, so the loaded model survives a stop()/start() (only the camera is released). */
  stop(): void {
    this.startGen++;
    this.scanEpoch++;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.detector?.stop();
    this.device = null;
    const start = this.maybe<HTMLButtonElement>('start');
    if (start) {
      start.disabled = false;
      start.hidden = false;
    }
    const restart = this.maybe<HTMLButtonElement>('restart');
    if (restart) restart.hidden = true;
  }

  private el<T extends HTMLElement>(id: string): T {
    const node = this.root.getElementById(id);
    if (!node) throw new Error(`ai-scan-panel: missing #${id}`);
    return node as T;
  }
  /** Same lookup, but tolerant: headless renders none of the status/preview chrome. */
  private maybe<T extends HTMLElement>(id: string): T | null {
    return this.root.getElementById(id) as T | null;
  }

  /**
   * Open the camera and begin scanning. Public so a host can autostart it, or retry an error.
   * Deliberately does NOT clear captured sides: switching cameras mid-scan, or reopening after
   * painting, must not cost the user the sides they already showed. `restart()` is the wipe.
   */
  async start(): Promise<void> {
    const startBtn = this.maybe<HTMLButtonElement>('start');
    if (startBtn) startBtn.disabled = true;
    const gen = ++this.startGen;
    this.report('starting', 'Opening the camera…');
    // Release any camera a prior attempt left open (e.g. a failed model load under the
    // camera-first design) before opening a fresh one, so streams can't accumulate.
    this.detector?.stop();
    this.device = null;
    // Choosing the detector is async on the first call (it probes for the native plugin); a stop()
    // during that probe supersedes this attempt, so re-check the generation before going on.
    const detector = await this.ensureDetector();
    if (gen !== this.startGen) {
      detector.stop();
      return;
    }
    // Deliberately does NOT abort the open: a user answering a permission prompt slowly must not
    // be cut off. It only stops the silence — and a late grant still resolves, reports 'scanning'
    // and overwrites this. Cleared in the finally below, so it can only fire while still opening.
    const slowOpen = setTimeout(() => {
      if (gen === this.startGen && this.device === null) {
        this.report('error', this.tinted('err', SLOW_OPEN));
      }
    }, SLOW_OPEN_MS);
    let fellBack = false;
    try {
      // Camera FIRST — it must never wait on the model download. The model loads over the network,
      // so gating the camera behind it means a slow/failed/offline load leaves a dead panel with no
      // camera at all. Open the camera, THEN load the model behind the live preview.
      const facing = this.getAttribute('facing');
      const facingMode = facing === 'user' || facing === 'environment' ? facing : undefined;
      const pinned = this.getAttribute('device-id') || undefined;
      try {
        await detector.use({ deviceId: pinned, facingMode });
      } catch (err) {
        // A pinned camera can simply go away — a webcam unplugged, or a Continuity Camera whose
        // phone wandered off. Falling back beats dead-ending on an exact-deviceId constraint that
        // can no longer be satisfied. The pin is deliberately KEPT, so the preferred camera is
        // picked up again the moment it returns.
        if (pinned === undefined || gen !== this.startGen) throw err;
        fellBack = true;
        await detector.use({ facingMode });
      }
      // Cancelled (stop()/restart bumped the generation) while opening → the detector's stream is
      // orphaned; release it here rather than letting it linger behind a superseded start.
      if (gen !== this.startGen) {
        detector.stop();
        return;
      }
      this.device = detector.device;
      if (startBtn) startBtn.hidden = true;
      if (!this.modelLoaded) {
        this.report('loading', 'Camera ready — loading the model…');
        // The detector owns the model: for the browser that is onnxruntime-web (loaded as its own
        // module, off the main thread); for the native builds it is the plugin. Either way the
        // panel only waits for load() and reports progress — the wasm-path and worker subtleties
        // live in WebDetector, behind the seam.
        await detector.load();
        this.modelLoaded = true;
        if (gen !== this.startGen) return; // stop() already released the camera
      }
      // A camera reopening mid-flow (after painting, after a done-scan correction) resumes where
      // the scan was: a pending confirm request keeps its phase and its ask.
      const phase = this.awaiting ? 'confirm' : 'scanning';
      const opening = this.awaiting ? this.confirmWords(this.awaiting) : [OPENING];
      if (fellBack) this.loop(phase, this.tinted('err', PINNED_GONE), ' ', ...opening);
      else this.loop(phase, ...opening);
    } catch (err) {
      if (gen !== this.startGen) {
        detector.stop(); // orphaned camera on a cancelled attempt
        return;
      }
      // Keep the camera preview alive (camera-first) but re-offer Start so the user can retry.
      if (startBtn) {
        startBtn.hidden = false;
        startBtn.disabled = false;
      }
      this.report(
        'error',
        this.tinted('err', `Cannot start: ${String((err as Error)?.message ?? err)}`),
      );
    } finally {
      clearTimeout(slowOpen);
    }
  }

  /**
   * The detector, chosen once and kept for the element's life (so the model survives a stop()/
   * start(), and so the probe runs only once). Cached as a promise because the choice is async — it
   * asks the plugin whether it is there.
   */
  private ensureDetector(): Promise<Detector> {
    this.detectorPromise ??= this.selectDetector();
    return this.detectorPromise;
  }

  /**
   * Adopt a ready Detector and skip the async probe. A test seam: driving the full capture loop
   * in a DOM test needs a fake detector in place before start(), and the probe would race it.
   * Production hosts never call this — the panel chooses its own detector.
   */
  useDetector(detector: Detector, runtime: ScanRuntime): void {
    this.detector = detector;
    this.detectorPromise = Promise.resolve(detector);
    this.runtime = runtime;
  }

  /**
   * Pick the detector for this environment. Native when the desktop shell's `cube-vision` plugin
   * answers its probe — `__TAURI__` present AND the probe resolves truthy; the browser's WebDetector
   * otherwise, which is also what Windows and Linux get (their Tauri build ships no native backend,
   * so the probe fails and they fall back exactly as the accepted platform table says). Nothing else
   * in the panel changes with the choice — that is the whole point of the seam. The video is passed
   * as a getter so the detector survives a reconnect that rebuilds the shadow DOM.
   */
  private async selectDetector(): Promise<Detector> {
    const invoke = (globalThis as TauriGlobal).__TAURI__?.core?.invoke;
    // The ONLY requirement for the native path is that the plugin answers its probe. It resolves its
    // own model, so no JS path API is involved — depending on one is what used to drop the desktop
    // app silently onto the wasm runtime.
    if (invoke) {
      try {
        if (await invoke('plugin:cube-vision|probe')) {
          this.detector = new NativeDetector(invoke);
          this.runtime = 'native';
          this.announceRuntime();
          return this.detector;
        }
      } catch {
        // Plugin absent or errored — fall through to the browser path, which every build has.
      }
    }
    this.detector = new WebDetector(
      () => this.el<HTMLVideoElement>('video'),
      () => this.modelUrl,
    );
    this.runtime = 'web';
    this.announceRuntime();
    return this.detector;
  }

  /** Say which runtime won, once, on the console — so "is it on the fast native path?" has an
   *  answer without a debugger. The same fact rides on every 'scan-progress' event as `runtime`. */
  private announceRuntime(): void {
    const where =
      this.runtime === 'native'
        ? 'native (CoreML on the ANE, ~1.5 ms/frame)'
        : 'web (wasm model, ~400 ms/frame)';
    console.info(`[cubus] scanner runtime: ${where}`);
  }

  private reset(): void {
    this.lastColors = '';
    this.stableCount = 0;
    this.stableSince = 0;
    this.live = null;
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    for (const f of FACES) delete (this.faces as Partial<Record<Face, ColorFace>>)[f];
    this.buildDots();
  }

  /**
   * (Re)start the capture loop. `opening` replaces the standard prompt, so a message explaining
   * why we are starting over survives instead of being overwritten within one tick.
   */
  private loop(phase: ScanPhase, ...opening: (string | Node)[]): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.scanEpoch++;
    this.showPreview(null);
    this.stableCount = 0;
    this.lastColors = '';
    const restart = this.maybe<HTMLButtonElement>('restart');
    if (restart) restart.hidden = false;
    // Asking for a side with no camera open is a promise nothing can keep — and it reads exactly
    // like a scan that is working, because the ticks just return. Reachable when a host stays on
    // the screen after a scan finishes (the camera is released on 'done') and a correction then
    // needs another look. Reopen the camera rather than dead-ending: start() keeps the captures
    // and resumes this loop — including a pending confirm — once the camera answers.
    if (this.device === null) {
      void this.start();
      return;
    }
    this.report(phase, ...(opening.length > 0 ? opening : [OPENING]));
    // Tick as fast as the chosen runtime can keep up: native inference frees the cadence the wasm run
    // used to cap. The busy guard in onTick still prevents overlap if a frame ever runs long.
    const tick = this.runtime === 'native' ? TICK_MS_NATIVE : TICK_MS_WEB;
    this.timer = setInterval(() => void this.onTick(), tick);
  }

  private stopLoop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async onTick(): Promise<void> {
    if (this.busy || this.device === null || !this.detector || !this.modelLoaded) return;
    this.busy = true;
    const epoch = this.scanEpoch;
    try {
      const output = await this.detector.next();
      // Reject a stale result: stop()/restart() between grab and here bumps scanEpoch, so an
      // in-flight inference can't bleed into a new scan (or land after the loop was stopped).
      if (this.scanEpoch !== epoch || this.timer === null) return;
      if (output === null) return; // camera opened but no frame yet — try again next tick
      const fit = fitFromOutput(output);
      if (!fit.ok) {
        this.stableCount = 0;
        this.lastColors = '';
        this.showPreview(null);
        // Keep the confirm phase while a confirm is pending: reporting 'scanning' here used to
        // flip the host back to its idle heading the moment the cube left the frame — which it
        // always does, because the user is turning it to find the side that was asked for.
        this.report(
          this.awaiting ? 'confirm' : 'scanning',
          this.idleLine() + FRAME_HINT[fit.reason],
        );
        return;
      }
      // Require a few identical reads in a row AND a real stretch of wall-clock stillness, so we
      // never capture a blurred / moving frame — on the 60 ms native tick, reads alone span 180 ms.
      const key = fit.face.colors.join(',');
      if (key === this.lastColors) {
        this.stableCount += 1;
      } else {
        this.stableCount = 1;
        this.stableSince = Date.now();
      }
      this.lastColors = key;
      this.showPreview(fit.face.colors);
      if (this.stableCount < STABLE || Date.now() - this.stableSince < STABLE_MS) {
        this.report(this.awaiting ? 'confirm' : 'scanning', 'Reading a side — hold still…');
        return;
      }
      // A face's CENTRE colour is its identity (centres never move): colour class i ↔ FACES[i].
      // So sides can be shown in any order — file each stable read under the face it belongs to.
      const centre = fit.face.colors[4];
      const face = centre === undefined ? undefined : FACES[centre];
      // While confirming, only the side we asked for counts, and it is taken as a CANONICAL
      // capture rather than filed as a new face: its rotation is the whole point of asking.
      if (this.awaiting) {
        if (face !== this.awaiting.face) {
          this.report('confirm', ...this.confirmWords(this.awaiting));
          return;
        }
        this.confirmed[face] = fit.face;
        this.awaiting = null;
        this.flash();
        this.scheduleCheck(this.tinted('ok', 'Got it — checking…'));
        return;
      }
      if (face === undefined) {
        this.report('scanning', this.tinted('err', "Couldn't read the centre — hold it steadier."));
        return;
      }
      // A finished scan captures nothing: the cube in view is most likely just being picked up —
      // to be solved, not re-scanned — and silently replacing part of an ACCEPTED scan because a
      // side drifted through the frame would be the worst kind of helpfulness.
      if (this.finished) {
        this.report(
          'scanning',
          'This cube is already scanned — tap a sticker to fix one, or start the scan over for a different cube.',
        );
        return;
      }
      if (this.faces[face]) {
        // With all six sides in, the loop only runs because the scan was refused — so a re-shown
        // side is a correction: replace its reading and check again. A read identical to the one
        // already filed would re-run the same refusal forever, so it just restates the options.
        if (this.capturedFaces().length >= FACES.length) {
          if (key === this.faces[face].colors.join(',')) {
            this.report(
              'scanning',
              'The ',
              this.bold(GUIDE[face].name),
              ' side reads the same as before — tap a sticker to fix it, or show another side.',
            );
            return;
          }
          this.faces[face] = fit.face;
          this.confirmed = {};
          this.mismatches = 0;
          this.buildDots();
          this.flash();
          this.scheduleCheck(this.tinted('ok', `Re-read the ${GUIDE[face].name} side — checking…`));
          return;
        }
        const named = this.missingSides();
        this.report(
          'scanning',
          'Already have the ',
          this.bold(GUIDE[face].name),
          named ? ` side — still need ${named}.` : ' side — show a different one.',
        );
        return;
      }
      this.capture(face, fit.face);
    } catch {
      // camera not ready (0x0) — try again next tick
    } finally {
      this.busy = false;
    }
  }

  /** File a freshly-recognised face under its own letter, then keep scanning (or finish at six). */
  private capture(face: Face, read: ColorFace): void {
    this.faces[face] = read;
    this.stableCount = 0;
    this.lastColors = '';
    this.buildDots();
    this.flash();
    const done = this.capturedFaces().length;
    if (done >= FACES.length) {
      this.scheduleCheck(this.tinted('ok', 'All six sides captured — checking…'));
      return;
    }
    // Name the last sides rather than only counting them: "5/6" makes a child inspect six tiles
    // for the gap, while "show YELLOW" is the answer itself.
    const named = this.missingSides();
    this.report(
      'scanning',
      'Got the ',
      this.bold(GUIDE[face].name),
      ` side — ${done}/6. ${named ? `Still to show: ${named}.` : 'Show another side…'}`,
    );
  }

  /**
   * Stop the loop, report 'checking', and run the assembly one beat later (CHECK_BEAT_MS), so the
   * capture or correction that triggered the check paints before any verdict replaces it. Clears
   * the pinned notice: whatever it explained is being re-decided right now. Epoch-guarded, so a
   * restart or navigation during the beat cancels the stale check.
   */
  private scheduleCheck(...opening: (string | Node)[]): void {
    this.stopLoop();
    this.showPreview(null);
    this.finished = false; // whatever was settled is being re-decided
    this.notice = null;
    this.suspects = [];
    this.report('checking', ...opening);
    const epoch = this.scanEpoch;
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      if (epoch === this.scanEpoch) this.assemble();
    }, CHECK_BEAT_MS);
  }

  /** The sides captured so far, in URFDLB order — the shape hosts draw progress from. */
  private capturedFaces(): CapturedFace[] {
    const out: CapturedFace[] = [];
    for (const face of FACES) {
      const read = this.faces[face];
      if (read) out.push({ face, colors: [...read.colors] });
    }
    return out;
  }

  /**
   * Correct one sticker of an already-captured side, and re-check the cube. The detector is good,
   * not perfect — held-out colour accuracy is ~90%, and orange and white are its weak classes —
   * so a scan can fail on a single misread sticker that a person can see at a glance.
   *
   * Only a side already READ can be corrected — there is nothing to overrule otherwise. `index` is
   * into the capture as shown, which is what a host displays, so a click maps straight through.
   * The centre is not correctable: a face's centre colour is its identity, and changing one would
   * rename the face rather than fix it.
   *
   * Any confirmations already gathered are dropped, because they were answers about a reading
   * that no longer exists.
   */
  setSticker(face: Face, index: number, colour: number): void {
    if (!Number.isInteger(index) || index < 0 || index > 8 || index === 4) return;
    if (!Number.isInteger(colour) || colour < 0 || colour >= FACES.length) return;
    // Outside painting, only a side the camera has actually read can be corrected. Hand-building
    // one the scanner never saw is a different act with a different failure mode — nine guesses
    // instead of one correction — and it would let a stray tap turn an unscanned tile into a face
    // the camera then refuses to read. Correcting a reading is the job; supplying one is not.
    // Painting is where supplying one IS the job, so there the side is created on first touch,
    // starting from its own centre colour.
    let read = this.faces[face];
    if (read === undefined) {
      if (!this.painting) return;
      read = {
        colors: Array<number>(9).fill(FACES.indexOf(face)),
        confidence: Array<number>(9).fill(1),
      };
      this.faces[face] = read;
      this.buildDots();
    } else if (read.colors[index] === colour) {
      return;
    }
    read.colors[index] = colour;
    read.confidence[index] = 1; // a person looked at it, which beats the detector's guess
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.notice = null;
    this.suspects = [];
    const done = this.capturedFaces().length;
    if (this.painting) {
      // Every stroke is checked, and only a finished cube is acted on. Half-painted states are
      // invalid by definition, so reporting each one as a failure would be noise, not news — but
      // once all six sides ARE painted, silence stops being kindness: say what still blocks it.
      if (done === FACES.length) {
        const result = assemblePainted(this.faces);
        if (result.valid) {
          this.finish(result);
          return;
        }
        this.notice = {
          title: 'Not solvable yet',
          tone: 'info',
          body: `${result.reason ?? 'Not a legal cube yet'} — tap stickers until every colour appears nine times.`,
        };
      }
      this.report(
        'painting',
        `Painted the ${GUIDE[face].name} side — ${done}/${FACES.length} sides.`,
      );
      return;
    }
    if (done < FACES.length) {
      this.report('scanning', `Corrected the ${GUIDE[face].name} side. Show another side…`);
      return;
    }
    this.scheduleCheck(this.tinted('ok', 'Corrected — checking…'));
  }

  /**
   * Turn hand-painting on or off. The two are exclusive by nature, not by policy: painting means
   * the user is authoring the cube, and a camera that kept reading would overwrite what they typed
   * in. So turning it on releases the camera, and turning it off opens it again from scratch.
   */
  setPainting(on: boolean): void {
    if (on === this.painting) return;
    this.painting = on;
    this.notice = null; // whichever mode's guidance was pinned, the mode it spoke to is over
    this.suspects = [];
    if (on) {
      this.stop(); // stop() clears the device, so a host stops showing a live lens
      this.report('painting', PAINTING);
      return;
    }
    void this.start();
  }

  /**
   * Forget one side's reading so the camera can read it again — the sensible thing for a centre
   * sticker to do, since a centre cannot be colour-corrected without renaming the face.
   *
   * Every confirmation gathered so far answered a question about a reading that included this
   * side, so they go too. The capture loop is restarted, because it stops once six sides are in
   * and dropping one means there is something to look for again.
   */
  rescanFace(face: Face): void {
    if (!this.faces[face]) return;
    delete (this.faces as Partial<Record<Face, ColorFace>>)[face];
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    this.buildDots();
    // loop() reopens the camera itself when it is dark, keeping the other five sides.
    this.loop('scanning', `Show the ${GUIDE[face].color} side again — it will be read fresh.`);
  }

  /**
   * The selectable cameras. Labels are only filled in once camera permission has been granted,
   * so a host gets named entries by calling this after the first successful start().
   */
  async cameras(): Promise<CameraDevice[]> {
    return (await this.ensureDetector()).cameras();
  }

  /**
   * Throw the whole scan away and scan afresh — the ONLY thing that clears captured sides.
   * Public for host UIs; with the camera dark it is also the way back on, so a host needs just
   * this one call behind its restart control.
   */
  restart(): void {
    this.reset();
    if (this.painting) {
      this.report('painting', PAINTING);
      return;
    }
    this.loop('scanning'); // reopens the camera itself when it is dark
  }

  /** Brief green border pulse on the stage to confirm a capture. */
  private flash(): void {
    const stage = this.root.querySelector('.stage');
    if (!(stage instanceof HTMLElement)) return;
    stage.classList.remove('flash');
    void stage.offsetWidth; // force reflow so the animation restarts on rapid captures
    stage.classList.add('flash');
  }

  /** "Show the GREEN side again, with WHITE facing up." — the whole instruction, as nodes. */
  private confirmWords(req: ConfirmRequest): (string | Node)[] {
    return [
      'Show the ',
      this.bold(GUIDE[req.face].color),
      ' side again, with ',
      this.bold(GUIDE[req.up].color),
      ' facing up.',
    ];
  }

  /** The same instruction as a plain sentence, for the pinned notice. */
  private confirmSentence(req: ConfirmRequest): string {
    return `Show the ${GUIDE[req.face].color} side again, with ${GUIDE[req.up].color} facing up.`;
  }

  /**
   * The waiting-for-input line, matched to where the scan actually is. One generic "show any
   * side" for every state was how a finished scan kept being nagged for sides, and how the ask
   * for one SPECIFIC side got contradicted the moment the cube left the frame.
   */
  private idleLine(): string {
    if (this.awaiting) {
      return `Looking for the ${GUIDE[this.awaiting.face].color} side — hold it with ${GUIDE[this.awaiting.up].color} up.`;
    }
    if (this.finished) return 'Scan finished — start the scan over to read a different cube.';
    if (this.capturedFaces().length >= FACES.length) {
      return 'Show a side to the camera to re-read it.';
    }
    return 'Show any side to the camera.';
  }

  /** "YELLOW and BLUE" — the sides still to show, named once there are few enough to name. */
  private missingSides(): string | null {
    const missing = FACES.filter((f) => !this.faces[f]);
    if (missing.length === 0 || missing.length > 2) return null;
    return missing.map((f) => GUIDE[f].color).join(' and ');
  }

  /** Read the six faces (plus any confirmations) into a cube, and act on what comes back. */
  private assemble(): void {
    let result: AiScanResult;
    // A `reread` means a confirmation disagreed with its first capture about colours: adopt the
    // fresh, deliberately-held look as that side's reading and check again. Each adoption pins its
    // side at distance 0, so this settles within six rounds; the cap is a backstop, not a path.
    for (let round = 0; ; round++) {
      try {
        result = assembleColors(this.faces, undefined, this.confirmed);
      } catch (err) {
        // Six well-formed faces should never throw — but if they do, never freeze on "checking…"
        // and never destroy the captures over it: say so and keep scanning.
        const why = String((err as Error)?.message ?? err);
        this.notice = {
          title: 'Something went wrong',
          tone: 'err',
          body: `Couldn't check the scan (${why}). Show a side again to retry, or start the scan over.`,
        };
        this.loop('scanning', this.tinted('err', 'Couldn’t check the scan — see the note.'));
        return;
      }
      const face = result.reread;
      const fresh = face === undefined ? undefined : this.confirmed[face];
      if (face === undefined || fresh === undefined || round >= FACES.length) {
        this.finish(result);
        return;
      }
      this.faces[face] = fresh;
    }
  }

  private finish(result: AiScanResult): void {
    this.stopLoop();
    this.showPreview(null);
    this.suspects = result.suspects ?? [];
    if (result.valid && result.lowConfidence.length === 0) {
      // Settle the captures into canonical rotation. The host repaints its tiles from the
      // validated string after the settle, so from here on a click on sticker i must mean index i
      // of what is stored — without this, correcting a side captured 90° off edited the wrong
      // sticker and turned a good scan invalid.
      const rots = result.rotations;
      if (rots) {
        FACES.forEach((f, fi) => {
          const read = this.faces[f];
          const k = rots[fi] ?? 0;
          if (read && k !== 0) {
            this.faces[f] = {
              colors: rotateFace(read.colors, k),
              confidence: rotateFace(read.confidence, k),
            };
          }
        });
      }
      this.confirmed = {};
      this.awaiting = null;
      this.mismatches = 0;
      this.finished = true;
      this.notice = null;
      // Release the camera BEFORE reporting, so the 'done' report carries device: null and a host
      // that stays on the scan screen stops showing a live lens over a finished scan.
      this.stop();
      this.report('done', this.tinted('ok', 'Scan complete — solvable cube captured.'));
      this.dispatchEvent(new CustomEvent<AiScanResult>('scan-complete', { detail: result }));
      return;
    }
    if (result.confirm && result.reread === undefined) {
      if (result.mismatch) {
        // The looks genuinely contradict each other about the HOLD (colour disagreements were
        // already resolved as rereads), and which look lied is not knowable — so drop them all
        // and ask again. The captures stay: they were never the problem. Past the first
        // contradiction the notice also names the way out a user may prefer.
        this.confirmed = {};
        this.mismatches++;
        this.awaiting = result.confirm;
        this.notice = {
          title: 'Those looks disagree',
          tone: 'err',
          body: `One of them was held a different way up. ${this.confirmSentence(result.confirm)}${
            this.mismatches >= 2
              ? " Each tile's edge colours show which way up to hold that side — or start the scan over."
              : ''
          }`,
        };
        this.loop(
          'confirm',
          this.tinted('err', 'Those two looks disagree. '),
          ...this.confirmWords(result.confirm),
        );
        return;
      }
      this.awaiting = result.confirm;
      this.notice = {
        title: 'One more look',
        tone: 'info',
        body:
          (result.ambiguous
            ? 'This cube is so close to solved that six photos genuinely cannot pin it down — one more look, held as asked, decides it. '
            : 'A single look could have been held wrong, so a second one settles it for sure. ') +
          this.confirmSentence(result.confirm),
      };
      this.loop('confirm', ...this.confirmWords(result.confirm));
      return;
    }
    // Refused — but NOT thrown away. The six captures are the user's work and every way out of a
    // refusal needs them: fix a sticker, re-show a side (the loop below replaces its reading), or
    // restart. The old code reset everything here, which wiped the board in the same paint as the
    // sixth capture and read as the app breaking.
    this.dispatchEvent(new CustomEvent<AiScanResult>('scan-invalid', { detail: result }));
    this.confirmed = {};
    this.awaiting = null;
    const hold =
      " Tip: hold each side the way its tile's edge colours show, and a scan settles itself.";
    if (this.suspects.length > 0) {
      this.notice = {
        title: this.suspects.length === 1 ? 'One sticker looks wrong' : 'A sticker looks wrong',
        tone: 'err',
        body: `Fixing a marked sticker makes this a solvable cube — tap it and pick the right colour, or show that side again to re-read it.${hold}`,
      };
    } else if (result.valid) {
      // valid but with low-confidence stickers: solvable, read too faintly to trust. fitFace's
      // 0.25 floor keeps this from the camera path today; a future runtime could reach it.
      this.notice = {
        title: 'Some stickers were unclear',
        tone: 'err',
        body: 'The cube reads as solvable, but some stickers were too faint to trust. Show those sides again, or tap stickers to confirm them.',
      };
    } else if (result.ambiguous) {
      this.notice = {
        title: 'Too symmetric to tell',
        tone: 'err',
        body: 'This cube reads the same several ways, and no extra look can split them. Turn any one face a quarter turn, then start the scan over to read the changed cube.',
      };
    } else {
      this.notice = {
        title: "That doesn't read as a solvable cube",
        tone: 'err',
        body: `A sticker was misread somewhere. Tap any sticker to correct it, show a side again to re-read it, or start the scan over for a fresh read.${hold}`,
      };
    }
    // Keep scanning: with all six sides in, a re-shown side replaces its reading (see onTick).
    this.loop(
      'scanning',
      this.tinted('err', "That isn't a solvable cube yet — fix a sticker, or show a side again."),
    );
  }

  private buildDots(): void {
    const dots = this.maybe('dots');
    if (!dots) return;
    dots.textContent = '';
    for (const face of FACES) {
      const g = GUIDE[face];
      const span = document.createElement('span');
      span.style.background = g.swatch;
      span.className = this.faces[face] ? 'done' : '';
      span.title = this.faces[face] ? `${g.name} — captured` : `${g.name} — needed`;
      dots.appendChild(span);
    }
  }

  private buildPreview(): void {
    const p = this.maybe('preview');
    if (!p) return;
    p.textContent = '';
    for (let i = 0; i < 9; i++) p.appendChild(document.createElement('i'));
  }

  private showPreview(colors: number[] | null): void {
    this.live = colors;
    const p = this.maybe('preview');
    if (!p) return;
    if (!colors) {
      p.dataset.show = '0';
      return;
    }
    const cells = p.querySelectorAll('i');
    for (let i = 0; i < 9; i++) {
      (cells[i] as HTMLElement).style.background = CLASS_SWATCH[colors[i]!] ?? '#000';
    }
    p.dataset.show = '1';
  }

  /**
   * Show `parts` on the built-in status line (when there is one) AND tell the host what changed.
   * Every status change goes through here, so a headless host sees exactly what a visible one does.
   */
  private report(phase: ScanPhase, ...parts: (string | Node)[]): void {
    const message = parts.map((p) => (typeof p === 'string' ? p : (p.textContent ?? ''))).join('');
    const status = this.maybe('status');
    if (status) {
      status.textContent = '';
      status.append(...parts);
    }
    this.dispatchEvent(
      new CustomEvent<ScanProgress>('scan-progress', {
        detail: {
          phase,
          message,
          captured: this.capturedFaces(),
          live: this.live,
          device: this.device,
          confirm: this.awaiting,
          runtime: this.runtime,
          notice: this.notice,
          suspects: [...this.suspects],
          complete: this.finished,
        },
      }),
    );
  }

  private bold(text: string): HTMLElement {
    const b = document.createElement('b');
    b.textContent = text;
    return b;
  }
  private tinted(cls: 'ok' | 'err', text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  }
}

if (!customElements.get('ai-scan-panel')) {
  customElements.define('ai-scan-panel', AiScanPanel);
}
