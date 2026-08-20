// <corner-scanner-panel> — the fast two-corner cube scan.
//
// A corner view shows THREE faces at once, so two opposite-corner shots capture all six:
//   1. the white·green·red corner  (white on top, green facing the camera)
//   2. the yellow·blue·orange corner (the opposite corner)
//
// Per tick it detects up to three face quads, DRAWS them on the video so you can see it
// lock on, and — once the frame holds still AND the three centers match the requested
// corner's colors — captures that shot automatically. Faces are assigned by center color,
// so a wrong corner or a non-cube (your face, a cabinet) is refused, never sampled. After
// both shots it validates solvability; a bad read restarts instead of handing off garbage.
//
// OpenCV.js is INJECTED via the `cv` property. Browser shell — verified on-camera, not in
// unit tests (the assignment/session/detector logic underneath IS tested).

import { type FrameSource, openCamera } from '../src/camera.js';
import { CornerScanSession } from '../src/corner-scan.js';
import { type OpenCv, detectFaceQuads } from '../src/detect.js';
import type { Quad } from '../src/homography.js';
import { SteadyDetector } from '../src/stability.js';
import type { Frame, ScanResult } from '../src/types.js';

const TICK_MS = 120; // ~8 fps: enough for steadiness + detection
const SHOTS = [
  {
    name: 'white · green · red',
    hint: 'white on top, GREEN facing you',
    dots: ['#f6f7f8', '#049e4a', '#d0202a'],
  },
  {
    name: 'yellow · blue · orange',
    hint: 'the opposite corner',
    dots: ['#ffd400', '#0057c8', '#ff6a00'],
  },
];

const TEMPLATE = `
<style>
  :host { display: block; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #e6edf3; }
  .stage { position: relative; background: #000; border-radius: 12px; overflow: hidden; aspect-ratio: 4/3; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  canvas.ov { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .box { position: absolute; inset: 0; margin: auto; width: 66%; aspect-ratio: 1;
    border: 3px dashed rgba(255,255,255,.7); border-radius: 16px; pointer-events: none; }
  .hint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font-size: 12px;
    color: #fff; text-shadow: 0 1px 3px #000; pointer-events: none; }
  .status { margin: 12px 0 4px; min-height: 22px; font-weight: 600; } .status b { color: #fff; }
  .sw { width: 14px; height: 14px; border-radius: 4px; border: 1px solid rgba(0,0,0,.4);
    display: inline-block; vertical-align: -2px; }
  .dots { display: flex; gap: 6px; margin: 8px 0; }
  .dots span { width: 30px; height: 10px; border-radius: 3px; background: #30363d; }
  .dots span.done { background: #3fb950; }
  .row { display: flex; gap: 10px; margin-top: 6px; }
  button { font: inherit; border: 0; border-radius: 7px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
  button.primary { background: #58a6ff; color: #06122b; }
  button[hidden] { display: none; }
  .ok { color: #3fb950; } .err { color: #f85149; } .muted { color: #8b949e; }
</style>
<div class="stage">
  <video id="video" playsinline muted></video>
  <canvas class="ov" id="ov"></canvas>
  <div class="box"></div>
  <div class="hint" id="hint"></div>
</div>
<div class="dots" id="dots"><span></span><span></span></div>
<div class="status" id="status">Press <b>Start camera</b>, then show the white-green-red corner.</div>
<div class="row"><button class="primary" id="start">Start camera</button></div>
`;

export class CornerScannerPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  cv: OpenCv | null = null;

  private session = new CornerScanSession();
  private steady = new SteadyDetector({ framesNeeded: 3 });
  private source: FrameSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private octx: CanvasRenderingContext2D | null = null;
  private stageEl: HTMLElement | null = null;
  private startGen = 0;
  private flashUntil = 0;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = TEMPLATE;
    this.octx = this.el<HTMLCanvasElement>('ov').getContext('2d');
    this.stageEl = this.root.querySelector('.stage');
    this.el('hint').textContent = SHOTS[0]!.hint;
    this.btn('start').addEventListener('click', () => void this.start());
    this.buildDots();
  }

  disconnectedCallback(): void {
    this.stop();
  }

  stop(): void {
    this.startGen++;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.source?.stop();
    this.source = null;
    const start = this.root.getElementById('start') as HTMLButtonElement | null;
    if (start) start.hidden = false;
  }

  private el<T extends HTMLElement>(id: string): T {
    const n = this.root.getElementById(id);
    if (!n) throw new Error(`corner-panel: missing #${id}`);
    return n as T;
  }
  private btn(id: string): HTMLButtonElement {
    return this.el<HTMLButtonElement>(id);
  }

  private async start(): Promise<void> {
    this.btn('start').disabled = true;
    const gen = ++this.startGen;
    try {
      this.source = await openCamera(this.el<HTMLVideoElement>('video'));
      if (gen !== this.startGen) return;
      this.session.reset();
      this.steady.reset();
      this.buildDots();
      this.btn('start').hidden = true;
      this.btn('start').disabled = false;
      this.timer = setInterval(() => this.onTick(), TICK_MS);
    } catch (err) {
      if (gen !== this.startGen) return;
      this.btn('start').disabled = false;
      this.setStatus(
        this.tinted('err', `Camera unavailable: ${String((err as Error)?.message ?? err)}`),
      );
    }
  }

  private onTick(): void {
    if (!this.source || !this.cv) {
      if (!this.cv) this.setStatus('Warming up the detector…');
      return;
    }
    const shotIdx = this.session.progress().length / 3; // 0 or 1
    const expected = this.session.nextShot();
    let frame: Frame;
    try {
      frame = this.source.grab();
    } catch {
      return; // camera not ready (0x0) — retry next tick
    }
    const quads = this.cv ? detectFaceQuads(this.cv, frame) : [];
    this.drawOverlay(frame, quads);

    if (!expected) return; // complete() handled below via capture path
    const guide = SHOTS[Math.min(shotIdx, 1)]!;
    if (performance.now() < this.flashUntil) return; // holding a "captured ✓" flash

    const steady = this.steady.push(frame);
    if (quads.length < 3) {
      this.setStatus(
        'Show the ',
        ...this.swatches(guide.dots),
        ` ${guide.name} corner — turn so 3 sides face me`,
      );
      return;
    }
    if (!steady) {
      this.setStatus('Hold still…');
      return;
    }
    const res = this.session.capture(frame, quads);
    if (res.ok) {
      this.steady.reset();
      this.buildDots();
      this.flashUntil = performance.now() + 700;
      this.setStatus(this.tinted('ok', `Captured the ${guide.name} corner ✓`));
      if (this.session.complete()) this.finish();
    } else {
      this.setStatus(
        "That's not the ",
        ...this.swatches(guide.dots),
        ` ${guide.name} corner — turn the cube`,
      );
    }
  }

  private finish(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const result = this.session.result();
    if (result?.valid) {
      this.setStatus(this.tinted('ok', 'Scan complete — solvable cube captured.'));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-complete', { detail: result }));
      this.stop();
    } else {
      this.setStatus(this.tinted('err', "That didn't read as a solvable cube — let's redo it."));
      this.session.reset();
      this.steady.reset();
      this.buildDots();
      this.timer = setInterval(() => this.onTick(), TICK_MS);
    }
  }

  private drawOverlay(frame: Frame, quads: readonly Quad[]): void {
    const ctx = this.octx;
    if (!ctx) return;
    const cv = this.el<HTMLCanvasElement>('ov');
    if (cv.width !== frame.width || cv.height !== frame.height) {
      cv.width = frame.width;
      cv.height = frame.height;
      // Match the stage aspect to the frame so the overlay maps 1:1 (no cover-crop skew).
      if (this.stageEl) this.stageEl.style.aspectRatio = `${frame.width} / ${frame.height}`;
    }
    ctx.clearRect(0, 0, frame.width, frame.height);
    ctx.lineWidth = Math.max(2, frame.width / 160);
    ctx.strokeStyle = '#3fb950';
    ctx.fillStyle = 'rgba(63,185,80,0.15)';
    for (const q of quads) {
      ctx.beginPath();
      ctx.moveTo(q.tl[0], q.tl[1]);
      ctx.lineTo(q.tr[0], q.tr[1]);
      ctx.lineTo(q.br[0], q.br[1]);
      ctx.lineTo(q.bl[0], q.bl[1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private buildDots(): void {
    const done = this.session.progress().length / 3; // shots captured (0..2)
    const dots = this.el('dots').querySelectorAll('span');
    dots.forEach((d, i) => {
      (d as HTMLElement).className = i < done ? 'done' : '';
    });
    const next = this.session.nextShot();
    this.el('hint').textContent = next ? SHOTS[Math.min(done, 1)]!.hint : 'done';
  }

  private setStatus(...parts: (string | Node)[]): void {
    const status = this.el('status');
    status.textContent = '';
    status.append(...parts);
  }
  private swatches(colors: string[]): Node[] {
    return colors.map((c) => {
      const s = document.createElement('span');
      s.className = 'sw';
      s.style.background = c;
      return s;
    });
  }
  private tinted(cls: 'ok' | 'err', text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  }
}

if (!customElements.get('corner-scanner-panel')) {
  customElements.define('corner-scanner-panel', CornerScannerPanel);
}
