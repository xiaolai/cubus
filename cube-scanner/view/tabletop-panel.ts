// <tabletop-scanner-panel> — the camera cube scan (rotate-and-collect).
//
// Turn the cube slowly (e.g. hold two opposite centers and spin the four sides; then the
// other two). Each frame is captured WIDE + high-res and searched for a face's 3x3 sticker
// grid; whenever a face passes the camera it's identified by center colour and its BEST
// read (the frame with the most stickers actually seen — i.e. face-on, no glare) is kept.
// Rotation sweeps every face through its clean angle, so there's no holding still and no
// fighting glare. Detection runs on a scaled copy for speed and, once a face is found,
// crops into its region (digital zoom) so the stickers are bigger. When all six faces are
// collected it solves the per-face rotations for a solvable cube (orient.ts); if not yet
// solvable, keep turning and better reads replace worse ones.
//
// Camera controls (focus/exposure/white-balance) are applied best-effort and the camera's
// capabilities are logged, so we can see whether it also exposes native (digital) PTZ.
//
// OpenCV.js is INJECTED via `cv`. Browser shell — the detector/solver underneath IS tested.

import { openCamera } from '../src/camera.js';
import { rgbDistance } from '../src/color.js';
import { CORNER_ANCHORS } from '../src/corner-scan.js';
import type { OpenCv } from '../src/detect.js';
import {
  type StickerCell,
  cropFrame,
  detectStickerGrid,
  downscaleFrame,
} from '../src/grid-detect.js';
import { type OrientationResult, solveOrientations } from '../src/orient.js';
import { FACES, type Face, type Frame, type RGB, type ScanResult } from '../src/types.js';

const TICK_MS = 120;
const IDENTIFY_TOL = 30; // max CIEDE2000 center↔anchor distance to accept a cube face
const NAME: Record<Face, { name: string }> = {
  U: { name: 'white' },
  R: { name: 'red' },
  F: { name: 'green' },
  D: { name: 'yellow' },
  L: { name: 'orange' },
  B: { name: 'blue' },
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
  button.ghost { background: #21262d; color: #e6edf3; border: 1px solid #30363d; padding: 6px 12px; font-weight: 400; font-size: 12px; }
  button[hidden] { display: none; }
  .dbg { margin: 8px 0 0; font: 11px/1.4 ui-monospace, Menlo, monospace; color: #8b949e;
    white-space: pre-wrap; word-break: break-all; max-height: 88px; overflow: auto; }
  .ok { color: #3fb950; } .err { color: #f85149; } .muted { color: #8b949e; }
</style>
<div class="stage">
  <video id="video" playsinline muted></video>
  <canvas class="ov" id="ov"></canvas>
  <div class="box"></div>
  <div class="hint">Turn the cube slowly — each face is grabbed as it passes</div>
</div>
<div class="row2">
  <div class="status" id="status">Press <b>Start camera</b>, then slowly turn the cube so every face faces the camera.</div>
  <div class="read" id="read"></div>
</div>
<div class="dots" id="dots"></div>
<pre class="dbg" id="dbg"></pre>
<div class="row">
  <button class="primary" id="start">Start camera</button>
  <button class="ghost" id="copydbg">Copy debug</button>
</div>
`;

export class TabletopScannerPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  cv: OpenCv | null = null;

  private readonly captured = new Map<Face, { colors: RGB[]; real: number }>();
  private source: Awaited<ReturnType<typeof openCamera>> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private octx: CanvasRenderingContext2D | null = null;
  private stageEl: HTMLElement | null = null;
  private startGen = 0;
  private roi: { x: number; y: number; w: number; h: number } | null = null;
  private roiMiss = 0;
  private pendingFace: Face | null = null;
  private pendingCount = 0;
  private frameNo = 0;
  private lastHud = 0;
  private readonly debugLog: string[] = [];

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
    this.btn('copydbg').addEventListener('click', () => void this.copyDebug());
  }

  /** Copy the running debug log to the clipboard so it can be pasted for diagnosis. */
  private async copyDebug(): Promise<void> {
    const text = this.debugLog.join('\n') || '(no debug yet — start the camera and turn the cube)';
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus(this.tinted('ok', 'Debug log copied — paste it to report.'));
    } catch {
      console.log('[scan] debug log:\n', text); // clipboard blocked — fall back to console
      this.setStatus('Debug log printed to the console (clipboard blocked).');
    }
  }

  /** Record a debug line (kept in memory for Copy debug, and echoed to the console). */
  private log(line: string): void {
    this.debugLog.push(line);
    if (this.debugLog.length > 400) this.debugLog.shift();
    console.log('[scan]', line);
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
      // Capture WIDE + high-res so the cube can sit anywhere in view and still be read
      // (app-side digital PTZ: search the whole frame, no need to center it).
      this.source = await openCamera(this.el<HTMLVideoElement>('video'), {
        width: 1280,
        height: 720,
      });
      if (gen !== this.startGen) return;
      this.applyCameraControls();
      this.captured.clear();
      this.roi = null;
      this.roiMiss = 0;
      this.pendingFace = null;
      this.pendingCount = 0;
      this.frameNo = 0;
      this.debugLog.length = 0;
      this.el('dbg').textContent = '';
      this.log('start — turn the cube slowly');
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

  /**
   * Identify a face by its center color, but only if UNAMBIGUOUS: nearest anchor within
   * IDENTIFY_TOL and clearly closer than the runner-up. A glare/gray/between-colors center
   * returns null → no capture (this is what stops phantom U/D captures from a misread).
   */
  private identify(center: RGB): Face | null {
    let best: Face | null = null;
    let d1 = Number.POSITIVE_INFINITY;
    let d2 = Number.POSITIVE_INFINITY;
    for (const f of FACES) {
      const d = rgbDistance(center, CORNER_ANCHORS[f]);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        best = f;
      } else if (d < d2) {
        d2 = d;
      }
    }
    return d1 <= IDENTIFY_TOL && d1 <= 0.6 * d2 ? best : null;
  }

  private onTick(): void {
    if (!this.source || !this.cv) {
      if (!this.cv) this.setStatus('Warming up the detector…');
      return;
    }
    let full: Frame;
    try {
      full = this.source.grab();
    } catch {
      return;
    }
    this.frameNo++;
    // Auto-zoom: once a face is found, detect INSIDE its region (cropped + upscaled) so the
    // stickers are bigger and detection is easier — digital zoom, no camera motion. Search
    // the whole frame again after a few misses.
    const roi = this.roi;
    const detSrc = roi ? cropFrame(full, roi.x, roi.y, roi.w, roi.h) : full;
    const ox = roi ? roi.x : 0;
    const oy = roi ? roi.y : 0;
    const { frame: small, scale } = downscaleFrame(detSrc, 960);
    const { candidates, grid } = detectStickerGrid(this.cv, small);
    const back = (c: StickerCell): StickerCell => ({
      cx: c.cx / scale + ox,
      cy: c.cy / scale + oy,
      w: c.w / scale,
    });
    const cells = grid ? grid.cells.map(back) : [];
    this.drawOverlay(full, candidates.map(back), cells);
    if (!grid) {
      this.showRead(null);
      this.pendingFace = null;
      this.pendingCount = 0;
      this.renderHud(candidates.length, 0, null, [0, 0, 0]);
      if (roi && ++this.roiMiss > 6) {
        this.roi = null; // lost it — zoom back out and search the whole frame
        this.roiMiss = 0;
      }
      this.setStatus(
        candidates.length >= 4
          ? `${candidates.length} squares — turn a full face toward the camera`
          : 'Turn the cube slowly so each face faces the camera',
      );
      return;
    }
    this.roi = this.faceRoi(cells, full); // lock + zoom onto this face next frame
    this.roiMiss = 0;
    const samples = grid.colors;
    this.showRead(samples);
    const center = samples[4]!;
    const face = this.identify(center);
    this.renderHud(candidates.length, grid.real, face, center);
    if (!face) {
      this.pendingFace = null;
      this.pendingCount = 0;
      this.setStatus('Reading… center color unclear — turn a face flat to the camera');
      return;
    }
    // Stability: require the SAME confident face for a few frames with a near-complete read
    // before capturing, so a transient glare/edge misread cannot add a phantom face.
    if (face === this.pendingFace) this.pendingCount++;
    else {
      this.pendingFace = face;
      this.pendingCount = 1;
    }
    if (this.pendingCount < 3 || grid.real < 8) {
      this.setStatus(`Reading ${NAME[face].name}… hold it a moment`);
      return;
    }
    // Rotate-and-collect: keep the BEST read per face (most stickers really seen).
    const prev = this.captured.get(face);
    if (!prev || grid.real > prev.real) {
      this.captured.set(face, { colors: samples, real: grid.real });
      this.log(
        `cap ${face}(${NAME[face].name}) real=${grid.real} center=${center.map(Math.round).join(',')} n=${this.captured.size}`,
      );
      this.buildDots();
      if (this.captured.size === 6) this.trySolve();
      else if (!prev)
        this.setStatus(
          this.tinted('ok', `${NAME[face].name} ✓  ${this.captured.size}/6 — keep turning`),
        );
    }
  }

  private trySolve(): void {
    const faces = Object.fromEntries([...this.captured].map(([f, r]) => [f, r.colors])) as Record<
      Face,
      RGB[]
    >;
    let res: OrientationResult;
    try {
      res = solveOrientations(faces);
    } catch {
      return;
    }
    this.log(`solve valid=${res.valid} facelets=${res.facelets}`);
    if (res.valid) {
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.setStatus(this.tinted('ok', 'Scan complete — solvable cube captured.'));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-complete', { detail: res }));
      this.stop();
    } else {
      // All six read but not solvable → a misread; keep turning to improve any face.
      this.setStatus(this.tinted('err', 'Not solvable yet — keep turning so I re-read each face.'));
    }
  }

  /** Live per-frame readout (throttled) — what the detector sees right now. */
  private renderHud(cands: number, real: number, face: Face | null, center: RGB): void {
    const now = performance.now();
    if (now - this.lastHud < 250) return; // ~4 Hz is enough to read
    this.lastHud = now;
    const have = [...this.captured.keys()].join('') || '-';
    this.el('dbg').textContent =
      `f${this.frameNo} cand=${cands} grid=${real}/9 face=${face ?? '-'} ` +
      `center=${center.map(Math.round).join(',')} have=${have}`;
  }

  /** Bounding box of a found face plus margin, clamped to the frame — the next zoom region. */
  private faceRoi(
    cells: readonly StickerCell[],
    full: Frame,
  ): { x: number; y: number; w: number; h: number } {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const c of cells) {
      minX = Math.min(minX, c.cx - c.w / 2);
      minY = Math.min(minY, c.cy - c.w / 2);
      maxX = Math.max(maxX, c.cx + c.w / 2);
      maxY = Math.max(maxY, c.cy + c.w / 2);
    }
    const mx = (maxX - minX) * 0.4;
    const my = (maxY - minY) * 0.4;
    const x = Math.max(0, minX - mx);
    const y = Math.max(0, minY - my);
    return {
      x,
      y,
      w: Math.min(full.width - x, maxX - minX + 2 * mx),
      h: Math.min(full.height - y, maxY - minY + 2 * my),
    };
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
