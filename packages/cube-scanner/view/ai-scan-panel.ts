// <ai-scan-panel> — the cube scanner: show the six sides in ANY order and each is captured
// automatically. Driven by the ONNX (YOLOv11) sticker detector, robust where the old classical
// HSV path failed (red↔orange under lighting). It is the only scanner (the OpenCV path was
// removed). onnxruntime-web is loaded via createModelRunner (this panel owns the wasm dep; the
// pure core stays clean). Each face is read as 9 colour classes; the model ABSTAINS on a frame
// that isn't a clean single face. A face's CENTRE colour is its identity (centres never move),
// so a stable read is filed under the face it belongs to — no fixed order, no per-side confirm.
// After all six, `assembleColors` runs the dual verifier. Emits 'scan-complete' (valid cube) /
// 'scan-invalid' (auto-restarts the scan).
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
  assembleColors,
} from '../src/ai-assemble.js';
import { type CameraDevice, type FrameSource, listCameras, openCamera } from '../src/camera.js';
import { type RunModel, detectFace } from '../src/onnx-detect.js';
import type { FitReason } from '../src/onnx-postprocess.js';
import { FACES, type Face, type ScanResult } from '../src/types.js';
import { createModelRunner } from './onnx-runtime.js';

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
const HINT: Record<FitReason, string> = {
  NO_FACE: 'point a side at the camera',
  PARTIAL_FACE: 'show the whole face, centred',
  BAD_GEOMETRY: 'hold it flatter and steadier',
};
const TICK_MS = 200; // ~5 fps; the model run dominates the budget
const STABLE = 3; // identical reads in a row before we auto-capture a face
const OPENING = 'Show any side to the camera — held flat and centred.';
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

  private run: RunModel | null = null;
  private source: FrameSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startGen = 0;
  private busy = false;
  /** `headless`: draw nothing, and let the host draw from 'scan-progress'. */
  private headless = false;

  private readonly faces = {} as Record<Face, ColorFace>;
  private lastColors = '';
  private stableCount = 0;
  private live: number[] | null = null;
  private device: CameraDevice | null = null;
  /** Captures known to be in canonical rotation, from answering a `confirm` request. */
  private confirmed: Partial<Record<Face, ColorFace>> = {};
  private awaiting: ConfirmRequest | null = null;
  /** Contradictory confirmations in a row; two means the instruction is not landing. */
  private mismatches = 0;
  private scanEpoch = 0; // bumped by loop()/stop(); rejects stale in-flight inferences

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

  /** Release the camera + stop the loop. Safe repeatedly and before first render. */
  stop(): void {
    this.startGen++;
    this.scanEpoch++;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.source?.stop();
    this.source = null;
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

  /** Open the camera and begin scanning. Public so a host can autostart it, or retry an error. */
  async start(): Promise<void> {
    const startBtn = this.maybe<HTMLButtonElement>('start');
    if (startBtn) startBtn.disabled = true;
    const gen = ++this.startGen;
    this.report('starting', 'Opening the camera…');
    // Release any camera a prior attempt left open (e.g. a failed model load under the
    // camera-first design) before opening a fresh one, so streams can't accumulate.
    this.source?.stop();
    this.source = null;
    // Deliberately does NOT abort the open: a user answering a permission prompt slowly must not
    // be cut off. It only stops the silence — and a late grant still resolves, reports 'scanning'
    // and overwrites this. Cleared in the finally below, so it can only fire while still opening.
    const slowOpen = setTimeout(() => {
      if (gen === this.startGen && this.source === null) {
        this.report('error', this.tinted('err', SLOW_OPEN));
      }
    }, SLOW_OPEN_MS);
    let source: FrameSource | null = null;
    let fellBack = false;
    try {
      // Camera FIRST — it must never wait on the model download. The model loads over the network,
      // so gating the camera behind it means a slow/failed/offline load leaves a dead panel with no
      // camera at all. Open the camera, THEN load the model behind the live preview.
      const facing = this.getAttribute('facing');
      const facingMode = facing === 'user' || facing === 'environment' ? facing : undefined;
      const pinned = this.getAttribute('device-id') || undefined;
      const video = this.el<HTMLVideoElement>('video');
      try {
        source = await openCamera(video, { deviceId: pinned, facingMode });
      } catch (err) {
        // A pinned camera can simply go away — a webcam unplugged, or a Continuity Camera whose
        // phone wandered off. Falling back beats dead-ending on an exact-deviceId constraint that
        // can no longer be satisfied. The pin is deliberately KEPT, so the preferred camera is
        // picked up again the moment it returns.
        if (pinned === undefined || gen !== this.startGen) throw err;
        fellBack = true;
        source = await openCamera(video, { facingMode });
      }
      // Cancelled (stop()/restart bumped the generation) while opening → this stream is orphaned;
      // stop it here rather than letting it overwrite this.source and linger.
      if (gen !== this.startGen) {
        source.stop();
        return;
      }
      this.source = source;
      this.device = source.device;
      if (startBtn) startBtn.hidden = true;
      this.reset();
      if (!this.run) {
        this.report('loading', 'Camera ready — loading the model…');
        // onnxruntime-web resolves wasmPaths inconsistently: the .wasm relative to the document,
        // but the dynamically-imported .mjs glue relative to THIS bundle (…/vendor/) — so a
        // relative "./vendor/" doubles into "/vendor/vendor/…mjs" and a relative "./" puts the
        // .wasm at the page root (404). An ABSOLUTE URL sidesteps both, being used as-is whatever
        // the base. Point it at the model's own directory (both the model and runtime live there).
        const wasmPaths = new URL(this.modelUrl.replace(/[^/]+$/, '') || './', document.baseURI)
          .href;
        this.run = await createModelRunner(this.modelUrl, { wasmPaths });
        if (gen !== this.startGen) return; // stop() already released this.source
      }
      if (fellBack) this.loop('scanning', this.tinted('err', PINNED_GONE), ' ', OPENING);
      else this.loop('scanning');
    } catch (err) {
      if (gen !== this.startGen) {
        source?.stop(); // orphaned camera on a cancelled attempt
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

  private reset(): void {
    this.lastColors = '';
    this.stableCount = 0;
    this.live = null;
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
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
    this.report(phase, ...(opening.length > 0 ? opening : [OPENING]));
    this.timer = setInterval(() => void this.onTick(), TICK_MS);
  }

  private stopLoop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async onTick(): Promise<void> {
    if (this.busy || !this.source || !this.run) return;
    this.busy = true;
    const epoch = this.scanEpoch;
    try {
      const frame = this.source.grab();
      const fit = await detectFace(frame, this.run);
      // Reject a stale result: stop()/restart() between grab and here bumps scanEpoch, so an
      // in-flight inference can't bleed into a new scan (or land after the loop was stopped).
      if (this.scanEpoch !== epoch || this.timer === null) return;
      if (!fit.ok) {
        this.stableCount = 0;
        this.lastColors = '';
        this.showPreview(null);
        this.report('scanning', `Show any side to the camera — ${HINT[fit.reason]}…`);
        return;
      }
      // Require a few identical reads in a row so we never capture a blurred / moving frame.
      const key = fit.face.colors.join(',');
      this.stableCount = key === this.lastColors ? this.stableCount + 1 : 1;
      this.lastColors = key;
      this.showPreview(fit.face.colors);
      if (this.stableCount < STABLE) {
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
        this.stopLoop();
        this.showPreview(null);
        this.flash();
        this.assemble();
        return;
      }
      if (face === undefined) {
        this.report('scanning', this.tinted('err', "Couldn't read the centre — hold it steadier."));
        return;
      }
      if (this.faces[face]) {
        this.report(
          'scanning',
          'Already have the ',
          this.bold(GUIDE[face].name),
          ' side — show a different one.',
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
      this.stopLoop();
      this.showPreview(null);
      this.report('checking', this.tinted('ok', 'All six sides captured — checking…'));
      this.assemble();
      return;
    }
    this.report(
      'scanning',
      'Got the ',
      this.bold(GUIDE[face].name),
      ` side — ${done}/6. Show another side…`,
    );
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
    // Only a side the camera has actually read can be corrected. Hand-building a side the scanner
    // never saw is a different act with a different failure mode — nine guesses instead of one
    // correction — and it would let a stray tap turn an unscanned tile into a face the camera then
    // refuses to read. Correcting a reading is the job; supplying one is not.
    const read = this.faces[face];
    if (read === undefined) return;
    if (read.colors[index] === colour) return;
    read.colors[index] = colour;
    read.confidence[index] = 1; // a person looked at it, which beats the detector's guess
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    if (this.capturedFaces().length < FACES.length) {
      this.report('scanning', `Corrected the ${GUIDE[face].name} side. Show another side…`);
      return;
    }
    this.stopLoop();
    this.showPreview(null);
    this.report('checking', this.tinted('ok', 'Corrected — checking…'));
    this.assemble();
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
    this.buildDots();
    if (this.source === null) {
      // Dropping the side still stands, but promising a fresh read would be a lie: nothing is
      // watching. Turning the camera back on starts the whole scan over anyway.
      this.report(
        'error',
        this.tinted('err', 'The camera is not running — turn it on to scan that side again.'),
      );
      return;
    }
    this.loop('scanning', `Show the ${GUIDE[face].color} side again — it will be read fresh.`);
  }

  /**
   * The selectable cameras. Labels are only filled in once camera permission has been granted,
   * so a host gets named entries by calling this after the first successful start().
   */
  async cameras(): Promise<CameraDevice[]> {
    return listCameras();
  }

  /** Clear all captured faces and keep scanning; the camera stays open. Public for host UIs. */
  restart(): void {
    this.reset();
    this.loop('scanning');
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

  /** Read the six faces (plus any confirmations) into a cube, and act on what comes back. */
  private assemble(): void {
    let result: AiScanResult;
    try {
      result = assembleColors(this.faces, undefined, this.confirmed);
    } catch (err) {
      // Six well-formed faces should never throw, but never freeze on "checking…" if they do.
      const why = String((err as Error)?.message ?? err);
      this.reset();
      this.loop(
        'scanning',
        this.tinted('err', `Couldn't assemble the scan (${why}) — starting over.`),
      );
      return;
    }
    this.finish(result);
  }

  private finish(result: AiScanResult): void {
    this.stopLoop();
    this.showPreview(null);
    if (result.valid && result.lowConfidence.length === 0) {
      this.report('done', this.tinted('ok', 'Scan complete — solvable cube captured.'));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-complete', { detail: result }));
      this.stop();
      return;
    }
    if (result.confirm) {
      // Contradictory confirmations mean one was held the wrong way up, and which one is not
      // knowable — so drop them all rather than loop on the last. Twice in a row means the
      // instruction is not landing, and re-showing the six sides is the better offer.
      if (result.mismatch) {
        this.confirmed = {};
        if (++this.mismatches >= 2) {
          this.dispatchEvent(new CustomEvent<ScanResult>('scan-invalid', { detail: result }));
          this.reset();
          this.loop(
            'scanning',
            this.tinted('err', "Those looks didn't line up — let's show all six sides again."),
          );
          return;
        }
        this.awaiting = result.confirm;
        this.loop(
          'confirm',
          this.tinted('err', 'Those two looks disagree. '),
          ...this.confirmWords(result.confirm),
        );
        return;
      }
      this.awaiting = result.confirm;
      this.loop('confirm', ...this.confirmWords(result.confirm));
      return;
    }
    const why = result.valid
      ? 'Some stickers were unclear'
      : (result.reason ?? "That isn't a solvable cube yet");
    this.dispatchEvent(new CustomEvent<ScanResult>('scan-invalid', { detail: result }));
    this.reset();
    // Auto-resume scanning; the camera stays open. The reason rides along as the opening
    // message so it is not wiped by the standard prompt.
    this.loop('scanning', this.tinted('err', `${why} — starting over, show each side again.`));
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
