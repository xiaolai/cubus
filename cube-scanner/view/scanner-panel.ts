// <scanner-panel> — auto-capture, confirm-per-side camera scanner.
//
// For each side the app asks for, the panel watches the live camera; once the
// frame holds still and a face is located, it snaps, samples the 9 stickers, and
// shows them for the user to accept (advance) or retake. No fiddly grid
// alignment and no shutter button — the face can be held roughly however.
//
// OpenCV.js does the face-finding but is INJECTED via the `cv` property (the app
// loads it and sets `panel.cv = window.cv`). Without it, the panel falls back to
// sampling a centered square, so it degrades instead of breaking.
//
// Emits 'scan-complete' (valid cube) / 'scan-invalid' (prompt a fresh scan).
// Browser shell — verified manually in the app, not in unit tests.

import { AutoCubeScanner, type FaceDetector, type FaceProposal } from '../src/auto-scanner.js';
import { type FrameSource, openCamera } from '../src/camera.js';
import { type OpenCv, detectFaceQuad } from '../src/detect.js';
import type { Quad } from '../src/homography.js';
import type { Face, RGB, ScanResult } from '../src/types.js';

const GUIDE: Record<Face, { color: string; name: string; swatch: string }> = {
  U: { color: 'WHITE', name: 'Up', swatch: '#f6f7f8' },
  R: { color: 'RED', name: 'Right', swatch: '#d0202a' },
  F: { color: 'GREEN', name: 'Front', swatch: '#049e4a' },
  D: { color: 'YELLOW', name: 'Down', swatch: '#ffd400' },
  L: { color: 'ORANGE', name: 'Left', swatch: '#ff6a00' },
  B: { color: 'BLUE', name: 'Back', swatch: '#0057c8' },
};
const ORDER: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
const TICK_MS = 150; // scan cadence (~7 fps): enough for steady + detection

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

export class ScannerPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  /** OpenCV.js namespace, set by the app once loaded. Null => centered fallback. */
  cv: OpenCv | null = null;

  private scanner: AutoCubeScanner | null = null;
  private source: FrameSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startGen = 0;

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

  /** Release the camera + stop the loop. Safe before first render / repeatedly. */
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
    if (!node) throw new Error(`scanner-panel: missing #${id}`);
    return node as T;
  }
  private btn(id: string): HTMLButtonElement {
    return this.el<HTMLButtonElement>(id);
  }

  private detector(): FaceDetector {
    const cv = this.cv;
    if (cv) return (frame) => detectFaceQuad(cv, frame);
    // Fallback with no OpenCV: assume the face fills a centered square.
    return (frame): Quad => {
      const size = Math.min(frame.width, frame.height) * 0.8;
      const x = (frame.width - size) / 2;
      const y = (frame.height - size) / 2;
      return { tl: [x, y], tr: [x + size, y], br: [x + size, y + size], bl: [x, y + size] };
    };
  }

  private async start(): Promise<void> {
    this.btn('start').disabled = true;
    const gen = ++this.startGen;
    try {
      this.source = await openCamera(this.el<HTMLVideoElement>('video'));
      if (gen !== this.startGen) return; // superseded by stop()/restart
      this.scanner = new AutoCubeScanner({ source: this.source, detectFace: this.detector() });
      this.btn('start').hidden = true;
      this.loop();
    } catch (err) {
      if (gen !== this.startGen) return;
      this.btn('start').disabled = false;
      this.setStatus(
        this.tinted('err', `Camera unavailable: ${String((err as Error)?.message ?? err)}`),
      );
    }
  }

  private loop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.showPreview(null);
    this.btn('accept').hidden = true;
    this.btn('retake').hidden = true;
    this.timer = setInterval(() => this.onTick(), TICK_MS);
  }

  private stopLoop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private onTick(): void {
    if (!this.scanner) return;
    let status: ReturnType<AutoCubeScanner['tick']>;
    try {
      status = this.scanner.tick();
    } catch {
      return; // camera not ready yet (0x0) — try again next tick
    }
    if (status.kind === 'searching') {
      const face = this.scanner.next();
      const hint = status.reason === 'no-face' ? 'point a side at the camera' : 'hold still';
      if (face) {
        const g = GUIDE[face];
        this.setStatus(
          'Show the ',
          this.swatch(g.swatch),
          ' ',
          this.bold(g.color),
          ` (${g.name}) side — `,
          hint,
          '…',
        );
      }
    } else if (status.kind === 'proposed') {
      this.stopLoop();
      this.propose(status.proposal);
    } else if (status.kind === 'complete') {
      this.finish(status.result);
    }
  }

  private propose(p: FaceProposal): void {
    const g = GUIDE[p.face];
    this.showPreview(p.samples);
    this.setStatus('Read the ', this.bold(g.name), ' side. Looks right?');
    this.btn('accept').hidden = false;
    this.btn('retake').hidden = false;
  }

  private accept(): void {
    if (!this.scanner) return;
    const status = this.scanner.confirm();
    this.buildDots();
    if (status.kind === 'complete') this.finish(status.result);
    else this.loop(); // next side
  }

  private retake(): void {
    if (!this.scanner) return;
    this.scanner.reject();
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
      this.setStatus(this.tinted('err', `${why} — press Start over to re-scan.`));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-invalid', { detail: result }));
      this.scanner?.reset();
      this.buildDots();
      this.btn('start').hidden = false;
      this.btn('start').disabled = false;
    }
  }

  private buildDots(): void {
    const done = new Set(this.scanner?.progress() ?? []);
    const dots = this.el('dots');
    dots.textContent = '';
    for (const face of ORDER) {
      const span = document.createElement('span');
      span.className = done.has(face) ? 'done' : '';
      span.title = GUIDE[face].name;
      dots.appendChild(span);
    }
  }

  private buildPreview(): void {
    const p = this.el('preview');
    p.textContent = '';
    for (let i = 0; i < 9; i++) p.appendChild(document.createElement('i'));
  }

  private showPreview(samples: RGB[] | null): void {
    const p = this.el('preview');
    if (!samples) {
      p.dataset.show = '0';
      return;
    }
    const cells = p.querySelectorAll('i');
    for (let i = 0; i < 9; i++) {
      const [r, g, b] = samples[i]!;
      (cells[i] as HTMLElement).style.background = `rgb(${r}, ${g}, ${b})`;
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

if (!customElements.get('scanner-panel')) {
  customElements.define('scanner-panel', ScannerPanel);
}
