// <scanner-panel> — a framework-agnostic vanilla web component that wraps the
// pure scanner core into a guided 6-face camera capture UI. It owns only
// presentation + the camera lifecycle; all cube logic lives in the tested core.
//
// Emits:
//   'scan-complete' (detail: ScanResult) when a valid cube is scanned.
//   'scan-invalid'  (detail: ScanResult) when the 6 faces don't form a solvable
//                    cube — the UI then prompts a retake instead of guessing.
//
// This is the browser shell — verified manually in the app, not in unit tests.

import { type CubeScanner, createCubeScanner } from '../src/live-scanner.js';
import type { Face, ScanResult } from '../src/types.js';

interface FaceGuide {
  color: string;
  name: string;
  swatch: string;
}

// Capture order URFDLB, with a beginner-friendly color + position for each.
const GUIDE: Record<Face, FaceGuide> = {
  U: { color: 'WHITE', name: 'Up', swatch: '#f6f7f8' },
  R: { color: 'RED', name: 'Right', swatch: '#d0202a' },
  F: { color: 'GREEN', name: 'Front', swatch: '#049e4a' },
  D: { color: 'YELLOW', name: 'Down', swatch: '#ffd400' },
  L: { color: 'ORANGE', name: 'Left', swatch: '#ff6a00' },
  B: { color: 'BLUE', name: 'Back', swatch: '#0057c8' },
};

const TEMPLATE = `
<style>
  :host { display: block; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #e6edf3; }
  .stage { position: relative; aspect-ratio: 1; background: #000; border-radius: 12px; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .grid { position: absolute; inset: 12%; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr);
    pointer-events: none; }
  .grid > div { border: 1px solid rgba(255,255,255,.7); }
  .swatch { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0,0,0,.4);
    display: inline-block; vertical-align: -3px; }
  .status { margin: 12px 0; min-height: 40px; }
  .status b { color: #fff; }
  .tip { color: #8b949e; font-size: 12px; margin: 6px 0 0; }
  .dots { display: flex; gap: 6px; margin: 8px 0; }
  .dots span { width: 22px; height: 10px; border-radius: 3px; background: #30363d; }
  .dots span.done { background: #3fb950; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  button { font: inherit; border: 0; border-radius: 7px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
  button.primary { background: #58a6ff; color: #06122b; }
  button.ghost { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
  button:disabled { opacity: .5; cursor: default; }
  .err { color: #f85149; } .ok { color: #3fb950; }
</style>
<div class="stage">
  <video id="video" playsinline muted></video>
  <div class="grid"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
</div>
<div class="dots" id="dots"></div>
<div class="status" id="status">Click <b>Start camera</b> to begin scanning your cube.</div>
<div class="tip">Hold the cube in one orientation — tilt to show each face, don't spin it in your hand.</div>
<div class="row">
  <button class="primary" id="start">Start camera</button>
  <button class="primary" id="capture" disabled>Capture face</button>
  <button class="ghost" id="retake" disabled>Start over</button>
</div>
`;

const ORDER: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];

export class ScannerPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  private readonly scanner: CubeScanner = createCubeScanner();
  private started = false;
  private startGen = 0;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = TEMPLATE;
    this.renderDots();
    this.el<HTMLButtonElement>('start').addEventListener('click', () => void this.start());
    this.el<HTMLButtonElement>('capture').addEventListener('click', () => this.capture());
    this.el<HTMLButtonElement>('retake').addEventListener('click', () => this.retake());
  }

  disconnectedCallback(): void {
    this.stop();
  }

  private el<T extends HTMLElement>(id: string): T {
    const node = this.root.getElementById(id);
    if (!node) throw new Error(`scanner-panel: missing #${id}`);
    return node as T;
  }

  /**
   * Release the camera. Safe to call repeatedly and before the first render
   * (e.g. host unconditional cleanup), so it guards every DOM touch.
   */
  stop(): void {
    this.startGen++; // invalidate any in-flight start()
    this.scanner.detach();
    this.started = false;
    const start = this.root.getElementById('start') as HTMLButtonElement | null;
    const capture = this.root.getElementById('capture') as HTMLButtonElement | null;
    if (start) start.disabled = false;
    if (capture) capture.disabled = true;
  }

  private async start(): Promise<void> {
    // Disable synchronously so a double-click can't open two camera streams.
    this.el<HTMLButtonElement>('start').disabled = true;
    // If the previous scan already completed, begin a fresh one on restart.
    if (this.scanner.next() === null) {
      this.scanner.reset();
      this.renderDots();
    }
    const gen = ++this.startGen;
    try {
      await this.scanner.attach(this.el<HTMLVideoElement>('video'));
      if (gen !== this.startGen) return; // superseded by stop()/restart — don't touch UI
      this.started = true;
      this.el<HTMLButtonElement>('capture').disabled = false;
      this.el<HTMLButtonElement>('retake').disabled = false;
      this.guide();
    } catch (err) {
      if (gen !== this.startGen) return; // superseded — swallow (incl. AbortError)
      this.el<HTMLButtonElement>('start').disabled = false; // allow a retry
      const msg = String((err as Error)?.message ?? err);
      this.setStatus(this.tinted('err', `Camera unavailable: ${msg}`));
    }
  }

  private capture(): void {
    if (!this.started) return;
    try {
      const face = this.scanner.next();
      if (!face) return;
      this.scanner.captureFace(face);
      this.renderDots();
      if (this.scanner.next()) this.guide();
      else this.finish();
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      this.setStatus(this.tinted('err', `Capture failed: ${msg}. Press Start over.`));
    }
  }

  private finish(): void {
    const result = this.scanner.result();
    if (!result) return;
    this.el<HTMLButtonElement>('capture').disabled = true; // all 6 captured

    // Only a valid AND unambiguous scan counts — never emit success on flagged,
    // low-confidence guesses (the app would apply the wrong cube silently).
    if (result.valid && result.lowConfidence.length === 0) {
      this.setStatus(this.tinted('ok', 'Scan complete — solvable cube captured.'));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-complete', { detail: result }));
      this.stop(); // capture succeeded — release the camera
      return;
    }

    if (result.valid) {
      this.setStatus(
        this.tinted('err', 'Some stickers were ambiguous'),
        ` — press Start over and re-scan the ${this.flaggedFaces(result)} face(s).`,
      );
    } else {
      this.setStatus(
        this.tinted('err', "That doesn't look like a solvable cube"),
        ' — press Start over and keep the cube in one orientation.',
      );
    }
    this.dispatchEvent(new CustomEvent<ScanResult>('scan-invalid', { detail: result }));
  }

  private retake(): void {
    this.scanner.reset();
    this.renderDots();
    this.el<HTMLButtonElement>('capture').disabled = !this.started;
    this.guide();
  }

  private guide(): void {
    const face = this.scanner.next();
    if (!face) return;
    const g = GUIDE[face];
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = g.swatch;
    this.setStatus(
      'Show the ',
      swatch,
      ' ',
      this.bold(g.color),
      ' centre face (',
      this.bold(g.name),
      '), align it to the grid, then ',
      this.bold('Capture'),
      '.',
    );
  }

  private flaggedFaces(result: ScanResult): string {
    const faces = new Set<Face>();
    for (const idx of result.lowConfidence) faces.add(ORDER[Math.floor(idx / 9)]!);
    return faces.size ? [...faces].map((f) => GUIDE[f].name).join(', ') : 'shown';
  }

  private renderDots(): void {
    const done = new Set(this.scanner.progress());
    const dots = this.el('dots');
    dots.textContent = '';
    for (const face of ORDER) {
      const span = document.createElement('span');
      span.className = done.has(face) ? 'done' : '';
      span.title = GUIDE[face].name;
      dots.appendChild(span);
    }
  }

  // Status is built from DOM nodes + text, never innerHTML — the same discipline
  // the renderer uses, so no dynamic string is ever interpreted as markup.
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

if (!customElements.get('scanner-panel')) {
  customElements.define('scanner-panel', ScannerPanel);
}
