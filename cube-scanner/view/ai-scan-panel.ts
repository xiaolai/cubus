// <ai-scan-panel> — the cube scanner: a guided, confirm-per-side capture driven by the ONNX
// (YOLOv11) sticker detector, robust where the old classical HSV path failed (red↔orange under
// lighting). It is the only scanner (the OpenCV path was removed). onnxruntime-web is loaded via
// createModelRunner (this panel owns the wasm dep; the pure core stays clean). Each face is
// read as 9 colour classes; the model ABSTAINS on a frame that isn't a clean single face.
// After 6 faces, `assembleColors` runs the same dual verifier. Emits 'scan-complete'
// (valid cube) / 'scan-invalid' (prompt a fresh scan).
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
/** Colour-class index → swatch, matching ml/data.yaml (0 white … 5 blue). */
const CLASS_SWATCH = ['#f6f7f8', '#d0202a', '#049e4a', '#ffd400', '#ff6a00', '#0057c8'];
const HINT: Record<FitReason, string> = {
  NO_FACE: 'point a side at the camera',
  PARTIAL_FACE: 'show the whole face, centred',
  BAD_GEOMETRY: 'hold it flatter and steadier',
};
const TICK_MS = 200; // ~5 fps; the model run dominates the budget
const STABLE = 3; // identical reads in a row before we offer to accept

const TEMPLATE = `
<style>
  :host { display: block; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #e6edf3; }
  .stage { position: relative; aspect-ratio: 1; background: #000; border-radius: 12px; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .status { margin: 12px 0 4px; min-height: 22px; } .status b { color: #fff; }
  .swatch { width: 15px; height: 15px; border-radius: 4px; border: 1px solid rgba(0,0,0,.4);
    display: inline-block; vertical-align: -3px; }
  .dots { display: flex; gap: 6px; margin: 8px 0; }
  .dots span { width: 22px; height: 10px; border-radius: 3px; background: #30363d; }
  .dots span.done { background: #3fb950; }
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
  <button class="primary" id="accept" hidden>Yes, next side</button>
  <button class="ghost" id="retake" hidden>Retake</button>
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
  private faceIdx = 0;
  private lastColors = '';
  private stableCount = 0;
  private proposed: ColorFace | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = TEMPLATE;
    this.buildDots();
    this.buildPreview();
    this.btn('start').addEventListener('click', () => void this.start());
    this.btn('accept').addEventListener('click', () => this.accept());
    this.btn('retake').addEventListener('click', () => this.retake());
  }

  disconnectedCallback(): void {
    this.stop();
  }

  /** Release the camera + stop the loop. Safe repeatedly and before first render. */
  stop(): void {
    this.startGen++;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.source?.stop();
    this.source = null;
    const start = this.root.getElementById('start') as HTMLButtonElement | null;
    if (start) start.disabled = false;
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
    try {
      // Camera FIRST — it must never wait on the model download. The model loads over the network,
      // so gating the camera behind it means a slow/failed/offline load leaves a dead panel with no
      // camera at all. Open the camera, THEN load the model behind the live preview.
      this.source = await openCamera(this.el<HTMLVideoElement>('video'));
      if (gen !== this.startGen) return;
      this.btn('start').hidden = true;
      this.reset();
      if (!this.run) {
        this.setStatus('Camera ready — loading the model…');
        this.run = await createModelRunner(this.modelUrl);
        if (gen !== this.startGen) return;
      }
      this.loop();
    } catch (err) {
      if (gen !== this.startGen) return;
      this.btn('start').hidden = false; // re-offer Start so the user can retry
      this.btn('start').disabled = false;
      this.setStatus(this.tinted('err', `Cannot start: ${String((err as Error)?.message ?? err)}`));
    }
  }

  private reset(): void {
    this.faceIdx = 0;
    this.lastColors = '';
    this.stableCount = 0;
    this.proposed = null;
    for (const f of FACES) delete (this.faces as Partial<Record<Face, ColorFace>>)[f];
    this.buildDots();
  }

  private loop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.showPreview(null);
    this.btn('accept').hidden = true;
    this.btn('retake').hidden = true;
    this.proposed = null;
    this.stableCount = 0;
    this.lastColors = '';
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
    try {
      const frame = this.source.grab();
      const fit = await detectFace(frame, this.run);
      if (this.timer === null) return; // stopped mid-run
      const face = FACES[this.faceIdx]!;
      const g = GUIDE[face];
      if (!fit.ok) {
        this.stableCount = 0;
        this.setStatus(
          'Show the ',
          this.swatch(g.swatch),
          ' ',
          this.bold(g.color),
          ` (${g.name}) side — ${HINT[fit.reason]}…`,
        );
        return;
      }
      const key = fit.face.colors.join(',');
      this.stableCount = key === this.lastColors ? this.stableCount + 1 : 1;
      this.lastColors = key;
      if (this.stableCount >= STABLE) {
        this.stopLoop();
        this.propose(fit.face);
      } else {
        this.setStatus('Reading the ', this.bold(g.name), ' side — hold still…');
      }
    } catch {
      // camera not ready (0x0) — try again next tick
    } finally {
      this.busy = false;
    }
  }

  private propose(face: ColorFace): void {
    this.proposed = face;
    this.showPreview(face.colors);
    const g = GUIDE[FACES[this.faceIdx]!];
    this.setStatus('Read the ', this.bold(g.name), ' side. Looks right?');
    this.btn('accept').hidden = false;
    this.btn('retake').hidden = false;
  }

  private accept(): void {
    if (!this.proposed) return;
    this.faces[FACES[this.faceIdx]!] = this.proposed;
    this.faceIdx++;
    this.buildDots();
    if (this.faceIdx >= FACES.length) this.finish(assembleColors(this.faces));
    else this.loop();
  }

  private retake(): void {
    this.loop();
  }

  private finish(result: ScanResult): void {
    this.stopLoop();
    this.showPreview(null);
    this.btn('accept').hidden = true;
    this.btn('retake').hidden = true;
    if (result.valid && result.lowConfidence.length === 0) {
      this.setStatus(this.tinted('ok', 'Scan complete — solvable cube captured.'));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-complete', { detail: result }));
      this.stop();
    } else {
      const why = result.valid ? 'Some stickers were ambiguous' : "That isn't a solvable cube";
      this.setStatus(this.tinted('err', `${why} — press Start camera to re-scan.`));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-invalid', { detail: result }));
      this.reset();
      this.btn('start').hidden = false;
      this.btn('start').disabled = false;
    }
  }

  private buildDots(): void {
    const dots = this.el('dots');
    dots.textContent = '';
    FACES.forEach((face, i) => {
      const span = document.createElement('span');
      span.className = i < this.faceIdx ? 'done' : '';
      span.title = GUIDE[face].name;
      dots.appendChild(span);
    });
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
  private swatch(color: string): HTMLElement {
    const s = document.createElement('span');
    s.className = 'swatch';
    s.style.background = color;
    return s;
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
