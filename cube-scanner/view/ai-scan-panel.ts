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
// Browser shell — verified by typecheck + esbuild bundle, exercised manually in the app.

import { type ColorFace, assembleColors } from '../src/ai-assemble.js';
import { type FrameSource, openCamera } from '../src/camera.js';
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

export class AiScanPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  /** Model URL; the app can override before the element renders. */
  modelUrl = './vendor/cube-yolo.onnx';

  private run: RunModel | null = null;
  private source: FrameSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startGen = 0;
  private busy = false;

  private readonly faces = {} as Record<Face, ColorFace>;
  private lastColors = '';
  private stableCount = 0;
  private scanEpoch = 0; // bumped by loop()/stop(); rejects stale in-flight inferences

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = TEMPLATE;
    this.buildDots();
    this.buildPreview();
    this.btn('start').addEventListener('click', () => void this.start());
    this.btn('restart').addEventListener('click', () => this.restart());
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
    const start = this.root.getElementById('start') as HTMLButtonElement | null;
    if (start) {
      start.disabled = false;
      start.hidden = false;
    }
    const restart = this.root.getElementById('restart') as HTMLButtonElement | null;
    if (restart) restart.hidden = true;
  }

  private el<T extends HTMLElement>(id: string): T {
    const node = this.root.getElementById(id);
    if (!node) throw new Error(`ai-scan-panel: missing #${id}`);
    return node as T;
  }
  private btn(id: string): HTMLButtonElement {
    return this.el<HTMLButtonElement>(id);
  }

  private async start(): Promise<void> {
    this.btn('start').disabled = true;
    const gen = ++this.startGen;
    // Release any camera a prior attempt left open (e.g. a failed model load under the
    // camera-first design) before opening a fresh one, so streams can't accumulate.
    this.source?.stop();
    this.source = null;
    let source: FrameSource | null = null;
    try {
      // Camera FIRST — it must never wait on the model download. The model loads over the network,
      // so gating the camera behind it means a slow/failed/offline load leaves a dead panel with no
      // camera at all. Open the camera, THEN load the model behind the live preview.
      source = await openCamera(this.el<HTMLVideoElement>('video'));
      // Cancelled (stop()/restart bumped the generation) while opening → this stream is orphaned;
      // stop it here rather than letting it overwrite this.source and linger.
      if (gen !== this.startGen) {
        source.stop();
        return;
      }
      this.source = source;
      this.btn('start').hidden = true;
      this.reset();
      if (!this.run) {
        this.setStatus('Camera ready — loading the model…');
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
      this.loop();
    } catch (err) {
      if (gen !== this.startGen) {
        source?.stop(); // orphaned camera on a cancelled attempt
        return;
      }
      // Keep the camera preview alive (camera-first) but re-offer Start so the user can retry.
      this.btn('start').hidden = false;
      this.btn('start').disabled = false;
      this.setStatus(this.tinted('err', `Cannot start: ${String((err as Error)?.message ?? err)}`));
    }
  }

  private reset(): void {
    this.lastColors = '';
    this.stableCount = 0;
    for (const f of FACES) delete (this.faces as Partial<Record<Face, ColorFace>>)[f];
    this.buildDots();
  }

  private loop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.scanEpoch++;
    this.showPreview(null);
    this.stableCount = 0;
    this.lastColors = '';
    this.btn('restart').hidden = false;
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
        this.setStatus(`Show any side to the camera — ${HINT[fit.reason]}…`);
        return;
      }
      // Require a few identical reads in a row so we never capture a blurred / moving frame.
      const key = fit.face.colors.join(',');
      this.stableCount = key === this.lastColors ? this.stableCount + 1 : 1;
      this.lastColors = key;
      this.showPreview(fit.face.colors);
      if (this.stableCount < STABLE) {
        this.setStatus('Reading a side — hold still…');
        return;
      }
      // A face's CENTRE colour is its identity (centres never move): colour class i ↔ FACES[i].
      // So sides can be shown in any order — file each stable read under the face it belongs to.
      const centre = fit.face.colors[4];
      const face = centre === undefined ? undefined : FACES[centre];
      if (face === undefined) {
        this.setStatus(this.tinted('err', "Couldn't read the centre — hold it steadier."));
        return;
      }
      if (this.faces[face]) {
        this.setStatus(
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
    const done = this.capturedCount();
    if (done >= FACES.length) {
      this.stopLoop();
      this.showPreview(null);
      this.setStatus(this.tinted('ok', 'All six sides captured — checking…'));
      let result: ScanResult;
      try {
        result = assembleColors(this.faces);
      } catch (err) {
        // Six well-formed faces should never throw, but never freeze on "checking…" if they do.
        this.setStatus(
          this.tinted(
            'err',
            `Couldn't assemble the scan (${String((err as Error)?.message ?? err)}) — starting over.`,
          ),
        );
        this.reset();
        this.loop();
        return;
      }
      this.finish(result);
      return;
    }
    this.setStatus(
      'Got the ',
      this.bold(GUIDE[face].name),
      ` side — ${done}/6. Show another side…`,
    );
  }

  private capturedCount(): number {
    return FACES.reduce((n, f) => n + (this.faces[f] ? 1 : 0), 0);
  }

  /** Clear all captured faces and keep scanning; the camera stays open. */
  private restart(): void {
    this.reset();
    this.loop();
  }

  /** Brief green border pulse on the stage to confirm a capture. */
  private flash(): void {
    const stage = this.root.querySelector('.stage');
    if (!(stage instanceof HTMLElement)) return;
    stage.classList.remove('flash');
    void stage.offsetWidth; // force reflow so the animation restarts on rapid captures
    stage.classList.add('flash');
  }

  private finish(result: ScanResult): void {
    this.stopLoop();
    this.showPreview(null);
    if (result.valid && result.lowConfidence.length === 0) {
      this.setStatus(this.tinted('ok', 'Scan complete — solvable cube captured.'));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-complete', { detail: result }));
      this.stop();
    } else {
      const why = result.valid ? 'Some stickers were unclear' : "That isn't a solvable cube yet";
      this.setStatus(this.tinted('err', `${why} — starting over, show each side again.`));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-invalid', { detail: result }));
      this.reset();
      this.loop(); // auto-resume scanning; the camera stays open
    }
  }

  private buildDots(): void {
    const dots = this.el('dots');
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
    const p = this.el('preview');
    p.textContent = '';
    for (let i = 0; i < 9; i++) p.appendChild(document.createElement('i'));
  }

  private showPreview(colors: number[] | null): void {
    const p = this.el('preview');
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

  private setStatus(...parts: (string | Node)[]): void {
    const status = this.el('status');
    status.textContent = '';
    status.append(...parts);
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
