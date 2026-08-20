// <tabletop-scanner-panel> — fixed-grid cube scan (robust, à la Szostak21/Cube_Solver).
//
// NO auto-detection and NO OpenCV. A fixed 3x3 grid is drawn on the video; you align a cube
// face to fill it and it samples the nine cells at those KNOWN positions. This removes every
// fragility of finding-the-cube (background squares, the logo, size/angle sluggishness) —
// the scanner never searches, so the desk/skin can't be mistaken for the cube. Each face is
// identified by its center colour (HSV), auto-captured once the frame holds still (or with
// the Capture button); after six faces it solves the per-face rotations into a solvable cube
// (orient.ts), disambiguating red↔orange by solvability. Browser shell; the solver is tested.

import { type CameraDevice, listCameras, openCamera } from '../src/camera.js';
import { hsvDistance } from '../src/color.js';
import { CORNER_ANCHORS } from '../src/corner-scan.js';
import { type StickerCell, patchColor, ringColor } from '../src/grid-detect.js';
import { type OrientationResult, solveOrientations } from '../src/orient.js';
import { SteadyDetector } from '../src/stability.js';
import { FACES, type Face, type Frame, type RGB, type ScanResult } from '../src/types.js';

const TICK_MS = 100;
const IDENTIFY_TOL = 1.0; // max HSV center↔anchor distance to accept a face
const IDENTIFY_MARGIN = 0.82; // nearest must be this fraction of the runner-up (unambiguous)
const GRID_FRAC = 0.56; // grid side as a fraction of the frame's short side
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
  .camsel { width: 100%; margin: 0 0 8px; padding: 6px; background: #0d1117; color: #e6edf3;
    border: 1px solid #30363d; border-radius: 6px; font: inherit; }
  .stage { position: relative; background: #000; border-radius: 12px; overflow: hidden; aspect-ratio: 4/3; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  canvas.ov { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .hint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font-size: 12px;
    color: #fff; text-shadow: 0 1px 3px #000; pointer-events: none; }
  .row2 { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
  .status { min-height: 22px; font-weight: 600; flex: 1; } .status b { color: #fff; }
  .read { display: grid; grid-template-columns: repeat(3, 16px); gap: 2px; }
  .read i { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(0,0,0,.4); background: #161b22; }
  .dots { display: flex; gap: 5px; margin: 10px 0 4px; }
  .dots span { width: 28px; height: 10px; border-radius: 3px; background: #30363d; }
  .dots span.done { background: #3fb950; }
  .row { display: flex; gap: 10px; margin-top: 6px; align-items: center; flex-wrap: wrap; }
  button { font: inherit; border: 0; border-radius: 7px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
  button.primary { background: #58a6ff; color: #06122b; }
  button.ghost { background: #21262d; color: #e6edf3; border: 1px solid #30363d; padding: 6px 12px; font-weight: 400; font-size: 12px; }
  button[hidden] { display: none; }
  .dbg { margin: 8px 0 0; font: 11px/1.45 ui-monospace, Menlo, monospace; color: #8b949e;
    white-space: pre-wrap; word-break: break-all; max-height: 150px; overflow: auto;
    background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 6px; }
  .ok { color: #3fb950; } .err { color: #f85149; } .muted { color: #8b949e; }
</style>
<select class="camsel" id="camsel" hidden></select>
<div class="stage">
  <video id="video" playsinline muted></video>
  <canvas class="ov" id="ov"></canvas>
  <div class="hint">Fill the grid with one cube face, then hold still</div>
</div>
<div class="row2">
  <div class="status" id="status">Press <b>Start camera</b>, then fill the grid with a cube face.</div>
  <div class="read" id="read"></div>
</div>
<div class="dots" id="dots"></div>
<pre class="dbg" id="dbg"></pre>
<div class="row">
  <button class="primary" id="start">Start camera</button>
  <button class="primary" id="capture" hidden>Capture face</button>
  <button class="ghost" id="retry" hidden>Retry</button>
  <button class="ghost" id="copydbg">Copy debug</button>
</div>
`;

export class TabletopScannerPanel extends HTMLElement {
  private readonly root: ShadowRoot;
  cv: unknown = null; // ignored — the fixed-grid scan needs no OpenCV

  private readonly captured = new Map<Face, RGB[]>();
  private source: Awaited<ReturnType<typeof openCamera>> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private octx: CanvasRenderingContext2D | null = null;
  private stageEl: HTMLElement | null = null;
  private steady = new SteadyDetector({ framesNeeded: 2 });
  private startGen = 0;
  private deviceId: string | undefined;
  private pendingFace: Face | null = null;
  private pendingCount = 0;
  private lastColors: RGB[] | null = null;
  private lastFace: Face | null = null;
  private frameNo = 0;
  private lastHud = 0;
  private lastStuck = 0;
  private hudLine = '';
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
    this.btn('capture').addEventListener('click', () => this.captureNow());
    this.btn('retry').addEventListener('click', () => this.retry());
    this.btn('copydbg').addEventListener('click', () => void this.copyDebug());
    this.el<HTMLSelectElement>('camsel').addEventListener('change', (e) => {
      void this.changeCamera((e.target as HTMLSelectElement).value);
    });
    void this.refreshCameras();
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
    const cap = this.root.getElementById('capture') as HTMLButtonElement | null;
    if (cap) cap.hidden = true;
  }

  private el<T extends HTMLElement>(id: string): T {
    const n = this.root.getElementById(id);
    if (!n) throw new Error(`tabletop-panel: missing #${id}`);
    return n as T;
  }
  private btn(id: string): HTMLButtonElement {
    return this.el<HTMLButtonElement>(id);
  }

  private async refreshCameras(): Promise<void> {
    let cams: CameraDevice[] = [];
    try {
      cams = await listCameras();
    } catch {
      /* enumeration needs permission — filled in after the first openCamera */
    }
    const sel = this.el<HTMLSelectElement>('camsel');
    sel.textContent = '';
    for (const c of cams) {
      const o = document.createElement('option');
      o.value = c.deviceId;
      o.textContent = c.label;
      if (c.deviceId === this.deviceId) o.selected = true;
      sel.append(o);
    }
    sel.hidden = cams.length <= 1;
  }

  private async changeCamera(deviceId: string): Promise<void> {
    if ((deviceId || undefined) === this.deviceId) return;
    this.deviceId = deviceId || undefined;
    if (this.source) {
      this.source.stop();
      this.source = null;
      await this.start();
    }
  }

  private async start(): Promise<void> {
    this.btn('start').disabled = true;
    const gen = ++this.startGen;
    try {
      this.source = await openCamera(this.el<HTMLVideoElement>('video'), {
        width: 1280,
        height: 720,
        deviceId: this.deviceId,
      });
      if (gen !== this.startGen) return;
      this.applyCameraControls();
      void this.refreshCameras();
      this.captured.clear();
      this.pendingFace = null;
      this.pendingCount = 0;
      this.frameNo = 0;
      this.debugLog.length = 0;
      this.hudLine = '';
      this.el('dbg').textContent = '';
      this.steady.reset();
      this.log('start — fill the grid with each face');
      this.buildDots();
      this.btn('start').hidden = true;
      this.btn('start').disabled = false;
      this.btn('capture').hidden = false;
      this.btn('retry').hidden = true;
      this.timer = setInterval(() => this.onTick(), TICK_MS);
    } catch (err) {
      if (gen !== this.startGen) return;
      this.btn('start').disabled = false;
      this.setStatus(
        this.tinted('err', `Camera unavailable: ${String((err as Error)?.message ?? err)}`),
      );
    }
  }

  /** Best-effort continuous focus/exposure/white-balance + log the camera capabilities. */
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

  /** The nine fixed sampling cells, in reading order, for a frame of the given size. */
  private gridCells(fw: number, fh: number): StickerCell[] {
    const side = Math.min(fw, fh) * GRID_FRAC;
    const cell = side / 3;
    const ox = (fw - side) / 2;
    const oy = (fh - side) / 2;
    const cells: StickerCell[] = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        cells.push({ cx: ox + (c + 0.5) * cell, cy: oy + (r + 0.5) * cell, w: cell });
    return cells;
  }

  /** Identify a face by center color (HSV) — only if unambiguous, else null. */
  private identify(center: RGB): Face | null {
    let best: Face | null = null;
    let d1 = Number.POSITIVE_INFINITY;
    let d2 = Number.POSITIVE_INFINITY;
    for (const f of FACES) {
      const d = hsvDistance(center, CORNER_ANCHORS[f]);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        best = f;
      } else if (d < d2) {
        d2 = d;
      }
    }
    return d1 <= IDENTIFY_TOL && d1 <= IDENTIFY_MARGIN * d2 ? best : null;
  }

  private onTick(): void {
    if (!this.source) return;
    let full: Frame;
    try {
      full = this.source.grab();
    } catch {
      return;
    }
    this.frameNo++;
    const cells = this.gridCells(full.width, full.height);
    const colors = cells.map((c, i) =>
      i === 4 ? ringColor(full, c.cx, c.cy, c.w * 0.34) : patchColor(full, c.cx, c.cy, c.w * 0.28),
    );
    this.lastColors = colors;
    const center = colors[4]!;
    const face = this.identify(center);
    this.lastFace = face;
    const steady = this.steady.push(full);
    this.drawGrid(full, cells, face);
    this.showRead(colors);
    this.renderHud(face, center, steady);

    if (!face) {
      this.pendingFace = null;
      this.pendingCount = 0;
      this.logStuck(center);
      this.setStatus('Fill the grid with a cube face — center color unclear');
      return;
    }
    if (face === this.pendingFace) this.pendingCount++;
    else {
      this.pendingFace = face;
      this.pendingCount = 1;
    }
    if (this.captured.has(face)) {
      this.setStatus(
        'Have the ',
        this.swatch(NAME[face].sw),
        ` ${NAME[face].name} face ✓ — show another`,
      );
      return;
    }
    if (!steady || this.pendingCount < 2) {
      this.setStatus(
        'Reading the ',
        this.swatch(NAME[face].sw),
        ` ${NAME[face].name} face — hold still…`,
      );
      return;
    }
    this.captureFace(face, colors);
  }

  private captureFace(face: Face, colors: RGB[]): void {
    this.captured.set(face, colors);
    this.log(
      `cap ${face}(${NAME[face].name}) center=${colors[4]!.map(Math.round).join(',')} n=${this.captured.size}`,
    );
    this.buildDots();
    if (this.captured.size === 6) this.trySolve();
    else
      this.setStatus(
        this.tinted('ok', `${NAME[face].name} ✓  ${this.captured.size}/6 — show another face`),
      );
  }

  /** Manual capture: grab whatever face is aligned right now (overwrites if already have it). */
  private captureNow(): void {
    if (this.lastFace && this.lastColors) this.captureFace(this.lastFace, this.lastColors);
    else this.setStatus('No cube face in the grid yet — fill the grid first.');
  }

  private trySolve(): void {
    const faces = Object.fromEntries(this.captured) as Record<Face, RGB[]>;
    let res: OrientationResult;
    try {
      res = solveOrientations(faces);
    } catch (e) {
      this.log(`solve ERROR ${(e as Error)?.message ?? e}`);
      return;
    }
    this.log(`solve valid=${res.valid} facelets=${res.facelets}`);
    if (res.valid) {
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.setStatus(this.tinted('ok', '✓ Scan complete — cube captured!'));
      this.dispatchEvent(new CustomEvent<ScanResult>('scan-complete', { detail: res }));
      this.stop();
    } else {
      this.btn('retry').hidden = false;
      this.setStatus(
        this.tinted('err', '⚠ Colors don’t form a solvable cube.'),
        ' Re-capture any face by filling the grid, or press Retry.',
      );
      // Allow re-capturing already-scanned faces to fix a misread.
      this.captured.clear();
      for (const [f, c] of Object.entries(faces)) this.captured.set(f as Face, c);
    }
  }

  private retry(): void {
    this.captured.clear();
    this.pendingFace = null;
    this.pendingCount = 0;
    this.btn('retry').hidden = true;
    this.buildDots();
    this.log('retry — cleared all faces');
    this.setStatus('Restarted — fill the grid with each face.');
  }

  private drawGrid(frame: Frame, cells: readonly StickerCell[], face: Face | null): void {
    const ctx = this.octx;
    if (!ctx) return;
    const c = this.el<HTMLCanvasElement>('ov');
    if (c.width !== frame.width || c.height !== frame.height) {
      c.width = frame.width;
      c.height = frame.height;
      if (this.stageEl) this.stageEl.style.aspectRatio = `${frame.width} / ${frame.height}`;
    }
    ctx.clearRect(0, 0, frame.width, frame.height);
    ctx.lineWidth = Math.max(2, frame.width / 240);
    ctx.strokeStyle = face ? '#3fb950' : 'rgba(255,255,255,0.85)';
    for (const cell of cells) {
      const s = cell.w * 0.92;
      ctx.strokeRect(cell.cx - s / 2, cell.cy - s / 2, s, s);
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
      if (!samples) cell.style.background = '#161b22';
      else {
        const [r, g, b] = samples[i]!;
        cell.style.background = `rgb(${r}, ${g}, ${b})`;
      }
    }
  }

  private renderHud(face: Face | null, center: RGB, steady: boolean): void {
    const now = performance.now();
    if (now - this.lastHud < 200) return;
    this.lastHud = now;
    const have = [...this.captured.keys()].join('') || '-';
    this.hudLine = `f${this.frameNo} face=${face ?? '-'} center=${center.map(Math.round).join(',')} steady=${steady} have=${have}`;
    this.refreshDbg();
  }

  private logStuck(center: RGB): void {
    const now = performance.now();
    if (now - this.lastStuck < 1000) return;
    this.lastStuck = now;
    const ds = FACES.map((f) => ({ f, d: hsvDistance(center, CORNER_ANCHORS[f]) })).sort(
      (a, b) => a.d - b.d,
    );
    this.log(
      `unclear center=${center.map(Math.round).join(',')} near=${ds[0]!.f}(${ds[0]!.d.toFixed(2)}) ${ds[1]!.f}(${ds[1]!.d.toFixed(2)})`,
    );
  }

  private async copyDebug(): Promise<void> {
    const text = this.debugLog.join('\n') || '(no debug yet)';
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus(this.tinted('ok', 'Debug log copied.'));
    } catch {
      console.log('[scan] debug log:\n', text);
      this.setStatus('Debug log printed to the console.');
    }
  }

  private log(line: string): void {
    this.debugLog.push(line);
    if (this.debugLog.length > 400) this.debugLog.shift();
    console.log('[scan]', line);
    this.refreshDbg();
  }

  private refreshDbg(): void {
    const dbg = this.root.getElementById('dbg');
    if (dbg)
      dbg.textContent = [this.hudLine, ...this.debugLog.slice(-11)].filter(Boolean).join('\n');
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
