// <tabletop-scanner-panel> — the tabletop cube scan (the easy one).
//
// Put the cube on the table, aim a camera down at it. Each face is read FLAT and STILL —
// the best possible geometry — so there's no holding steady and no aligning: show each of
// the six faces in ANY order and ANY rotation. The panel detects the face, shows the nine
// colours it read, and auto-captures once the cube is still. When all six are in it solves
// the per-face rotations for a solvable cube (orient.ts); a misread leaves it unsolvable
// and asks you to re-show a face.
//
// "Focus on the cube": the detected outline is drawn on the video and the read is shown as
// a 3x3 preview. Camera controls (focus/exposure/white-balance) are applied best-effort and
// the camera's capabilities are logged so we can see exactly what your webcam exposes.
//
// OpenCV.js is INJECTED via `cv`. Browser shell — the detector/solver underneath IS tested.

import { openCamera } from '../src/camera.js';
import { rgbDistance } from '../src/color.js';
import { CORNER_ANCHORS } from '../src/corner-scan.js';
import type { OpenCv } from '../src/detect.js';
import { type StickerCell, detectStickerGrid } from '../src/grid-detect.js';
import { type OrientationResult, solveOrientations } from '../src/orient.js';
import { SteadyDetector } from '../src/stability.js';
import { FACES, type Face, type Frame, type RGB, type ScanResult } from '../src/types.js';

const TICK_MS = 120;
const IDENTIFY_TOL = 30; // max CIEDE2000 center↔anchor distance to accept a cube face
const NAME: Record<Face, { name: string; sw: string }> = {
  U: { name: 'white', sw: '#f6f7f8' },
  R: { name: 'red', sw: '#d0202a' },
  F: { name: 'green', sw: '#049e4a' },
  D: { name: 'yellow', sw: '#ffd400' },
  L: { name: 'orange', sw: '#ff6a00' },
  B: { name: 'blue', sw: '#0057c8' },
};

const TEMPLATE = `
<style>
  :host { display: block; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #e6edf3; }
  .stage { position: relative; background: #000; border-radius: 12px; overflow: hidden; aspect-ratio: 4/3; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  canvas.ov { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .box { position: absolute; inset: 0; margin: auto; width: 60%; aspect-ratio: 1;
    border: 3px dashed rgba(255,255,255,.7); border-radius: 14px; pointer-events: none; }
  .hint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font-size: 12px;
    color: #fff; text-shadow: 0 1px 3px #000; pointer-events: none; }
  .row2 { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
  .status { min-height: 22px; font-weight: 600; flex: 1; } .status b { color: #fff; }
  .read { display: grid; grid-template-columns: repeat(3, 14px); gap: 2px; }
  .read i { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(0,0,0,.4); background: #161b22; }
  .dots { display: flex; gap: 5px; margin: 10px 0 4px; }
  .dots span { width: 28px; height: 10px; border-radius: 3px; background: #30363d; position: relative; }
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
  <div class="hint">Show a cube face — held up or flat, any side, any way up</div>
</div>
<div class="row2">
  <div class="status" id="status">Press <b>Start camera</b>, then show a cube face to the camera.</div>
  <div class="read" id="read"></div>
</div>
<div class="dots" id="dots"></div>
<div class="row"><button class="primary" id="start">Start camera</button></div>
`;

export class TabletopScannerPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  cv: OpenCv | null = null;

  private readonly captured = new Map<Face, RGB[]>();
  private steady = new SteadyDetector({ framesNeeded: 3 });
  private source: Awaited<ReturnType<typeof openCamera>> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private octx: CanvasRenderingContext2D | null = null;
  private stageEl: HTMLElement | null = null;
  private startGen = 0;
  private flashUntil = 0;
  private fixMode = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = TEMPLATE;
    this.octx = this.el<HTMLCanvasElement>('ov').getContext('2d');
    this.stageEl = this.root.querySelector('.stage');
    this.buildDots();
    this.buildRead();
    this.btn('start').addEventListener('click', () => void this.start());
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
    if (!n) throw new Error(`tabletop-panel: missing #${id}`);
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
      this.applyCameraControls();
      this.captured.clear();
      this.fixMode = false;
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

  /** Log the camera's capabilities and best-effort enable continuous focus/exposure/WB. */
  private applyCameraControls(): void {
    const stream = this.el<HTMLVideoElement>('video').srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    if (!track?.getCapabilities) return;
    const caps = track.getCapabilities() as Record<string, unknown>;
    console.log('[scan] camera capabilities:', caps);
    const advanced: MediaTrackConstraintSet[] = [];
    for (const [key, mode] of [
      ['focusMode', 'continuous'],
      ['exposureMode', 'continuous'],
      ['whiteBalanceMode', 'continuous'],
    ] as const) {
      const values = caps[key];
      if (Array.isArray(values) && values.includes(mode))
        advanced.push({ [key]: mode } as MediaTrackConstraintSet);
    }
    if (advanced.length)
      track.applyConstraints({ advanced } as unknown as MediaTrackConstraints).catch(() => {});
  }

  private identify(center: RGB): Face | null {
    let best: Face | null = null;
    let bestD = IDENTIFY_TOL;
    for (const f of FACES) {
      const d = rgbDistance(center, CORNER_ANCHORS[f]);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  private onTick(): void {
    if (!this.source || !this.cv) {
      if (!this.cv) this.setStatus('Warming up the detector…');
      return;
    }
    let frame: Frame;
    try {
      frame = this.source.grab();
    } catch {
      return;
    }
    const { candidates, grid } = detectStickerGrid(this.cv, frame);
    this.drawOverlay(frame, candidates, grid ? grid.cells : []);
    if (!grid) {
      this.showRead(null);
      this.setStatus(
        candidates.length >= 4
          ? `Line up a full face — ${candidates.length} squares seen`
          : 'Show a cube face to the camera (held up or flat)',
      );
      return;
    }
    const samples = grid.colors;
    this.showRead(samples);
    const face = this.identify(samples[4]!);
    const steady = this.steady.push(frame);
    if (!face) {
      this.setStatus("That doesn't look like a cube face — center it in the box");
      return;
    }
    if (performance.now() < this.flashUntil) return;
    if (!steady) {
      this.setStatus(
        'Reading the ',
        this.swatch(NAME[face].sw),
        ` ${NAME[face].name} face — hold still…`,
      );
      return;
    }
    if (this.captured.has(face) && !this.fixMode) {
      this.setStatus(`Got the ${NAME[face].name} face ✓ — show another`);
      return;
    }
    this.captured.set(face, samples);
    this.steady.reset();
    this.flashUntil = performance.now() + 600;
    this.buildDots();
    this.setStatus(this.tinted('ok', `Captured ${NAME[face].name} (${this.captured.size}/6)`));
    if (this.captured.size === 6) this.trySolve();
  }

  private trySolve(): void {
    const faces = Object.fromEntries(this.captured) as Record<Face, RGB[]>;
    let res: OrientationResult;
    try {
      res = solveOrientations(faces);
    } catch {
      return;
    }
    if (res.valid) {
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.setStatus(this.tinted('ok', 'Scan complete — solvable cube captured.'));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-complete', { detail: res }));
      this.stop();
    } else {
      this.fixMode = true;
      this.setStatus(
        this.tinted('err', "Colours don't form a solvable cube yet — re-show a face to fix it."),
      );
    }
  }

  private drawOverlay(
    frame: Frame,
    candidates: readonly StickerCell[],
    gridCells: readonly StickerCell[],
  ): void {
    const ctx = this.octx;
    if (!ctx) return;
    const c = this.el<HTMLCanvasElement>('ov');
    if (c.width !== frame.width || c.height !== frame.height) {
      c.width = frame.width;
      c.height = frame.height;
      if (this.stageEl) this.stageEl.style.aspectRatio = `${frame.width} / ${frame.height}`;
    }
    ctx.clearRect(0, 0, frame.width, frame.height);
    const inGrid = new Set(gridCells.map((g) => `${g.cx},${g.cy}`));
    // Every candidate square dim, so near-misses are visible…
    ctx.lineWidth = Math.max(1, frame.width / 320);
    ctx.strokeStyle = 'rgba(210,153,34,0.7)';
    for (const cell of candidates) {
      if (inGrid.has(`${cell.cx},${cell.cy}`)) continue;
      ctx.strokeRect(cell.cx - cell.w / 2, cell.cy - cell.w / 2, cell.w, cell.w);
    }
    // …and the locked 3x3 bright green.
    ctx.lineWidth = Math.max(2, frame.width / 200);
    ctx.strokeStyle = '#3fb950';
    ctx.fillStyle = 'rgba(63,185,80,0.15)';
    for (const cell of gridCells) {
      ctx.beginPath();
      ctx.rect(cell.cx - cell.w / 2, cell.cy - cell.w / 2, cell.w, cell.w);
      ctx.fill();
      ctx.stroke();
    }
  }

  private buildDots(): void {
    const dots = this.el('dots');
    dots.textContent = '';
    for (const f of FACES) {
      const span = document.createElement('span');
      if (this.captured.has(f)) span.className = 'done';
      span.title = NAME[f].name;
      dots.appendChild(span);
    }
  }

  private buildRead(): void {
    const r = this.el('read');
    r.textContent = '';
    for (let i = 0; i < 9; i++) r.appendChild(document.createElement('i'));
  }

  private showRead(samples: RGB[] | null): void {
    const cells = this.el('read').querySelectorAll('i');
    for (let i = 0; i < 9; i++) {
      const cell = cells[i] as HTMLElement;
      if (!samples) {
        cell.style.background = '#161b22';
      } else {
        const [r, g, b] = samples[i]!;
        cell.style.background = `rgb(${r}, ${g}, ${b})`;
      }
    }
  }

  private setStatus(...parts: (string | Node)[]): void {
    const status = this.el('status');
    status.textContent = '';
    status.append(...parts);
  }
  private swatch(color: string): HTMLElement {
    const s = document.createElement('span');
    s.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;background:${color}`;
    return s;
  }
  private tinted(cls: 'ok' | 'err', text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
  }
}

if (!customElements.get('tabletop-scanner-panel')) {
  customElements.define('tabletop-scanner-panel', TabletopScannerPanel);
}
