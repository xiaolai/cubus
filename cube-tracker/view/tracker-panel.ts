// <tracker-panel> — the app-facing web component for continuous camera tracking.
// The camera preview is DECOUPLED from tracking: the camera opens immediately (so you
// always get a live feed to inspect), and tracking activates on its own once a start
// state AND OpenCV are both available. Adds a camera picker (multiple webcams), a
// per-session rolling palette (adapts to the cube's own colors), and a live debug
// readout + throttled console logs. Browser-only glue; the heavy logic is the core.

import { type CameraDevice, listCameras, openCamera } from '../src/camera.js';
import { type Face, decodeFacelets, encodeFacelets } from '../src/cube.js';
import { type FrameDebug, LiveTracker } from '../src/live.js';
import { createLocalizer } from '../src/perception/localize.js';
import { opencvDetector } from '../src/perception/opencv-detector.js';
import { type CenterPalette, rollingPalette } from '../src/perception/palette.js';

const FACES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
const css = (r: number, g: number, b: number): string =>
  `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

export class TrackerPanel extends HTMLElement {
  private readonly video = document.createElement('video');
  private readonly picker = document.createElement('select');
  private readonly startBtn = document.createElement('button');
  private readonly stopBtn = document.createElement('button');
  private readonly statusEl = document.createElement('div');
  private readonly paletteEl = document.createElement('div');
  private readonly debugEl = document.createElement('pre');
  private cam: Awaited<ReturnType<typeof openCamera>> | null = null;
  private live: LiveTracker | null = null;
  private cameraOn = false;
  private seedFacelets: string | null = null;
  private readonly palette: CenterPalette = rollingPalette();
  private deviceId: string | undefined;
  private lastLog = 0;
  private loopGen = 0;
  private _cv: any = null;

  // The injected OpenCV.js module (set by the app once its WASM runtime is ready).
  set cv(m: any) {
    this._cv = m;
    this.tryStartTracking();
  }
  get cv(): any {
    return this._cv;
  }

  connectedCallback(): void {
    this.style.display = 'block';
    this.picker.style.cssText =
      'margin-bottom:8px;width:100%;padding:6px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px';
    this.picker.onchange = () => void this.changeCamera(this.picker.value);
    this.video.setAttribute('playsinline', 'true');
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.style.cssText = 'width:100%;border-radius:8px;background:#000;min-height:200px';
    this.startBtn.textContent = 'Start camera';
    this.startBtn.style.cssText =
      'margin-top:8px;padding:6px 14px;border:0;border-radius:7px;background:#58a6ff;color:#06122b;font-weight:600;cursor:pointer';
    this.startBtn.onclick = () => void this.startCamera();
    this.stopBtn.textContent = 'Stop';
    this.stopBtn.style.cssText =
      'margin:8px 0 0 8px;padding:6px 14px;border:1px solid #30363d;border-radius:7px;background:#21262d;color:#e6edf3;cursor:pointer';
    this.stopBtn.onclick = () => this.stop();
    this.statusEl.style.cssText = 'color:#8b949e;font-size:12px;margin-top:8px';
    this.statusEl.textContent = 'idle — press Start camera';
    this.paletteEl.style.cssText = 'display:flex;gap:4px;margin-top:8px;align-items:center';
    this.debugEl.style.cssText =
      'margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#8b949e;white-space:pre-wrap;word-break:break-all';
    this.append(
      this.picker,
      this.video,
      this.startBtn,
      this.stopBtn,
      this.statusEl,
      this.paletteEl,
      this.debugEl,
    );
    void this.refreshCameras();
  }

  /** Provide the start state (from a scan or the smart cube); tracking begins once cv is ready too. */
  provideSeed(facelets: string): void {
    this.seedFacelets = facelets || null;
    this.tryStartTracking();
  }

  private async refreshCameras(): Promise<void> {
    let cams: CameraDevice[] = [];
    try {
      cams = await listCameras();
    } catch {
      /* enumeration needs permission — populated after the camera opens */
    }
    this.picker.textContent = '';
    for (const c of cams) {
      const o = document.createElement('option');
      o.value = c.deviceId;
      o.textContent = c.label;
      if (c.deviceId === this.deviceId) o.selected = true;
      this.picker.append(o);
    }
    this.picker.style.display = cams.length > 1 ? 'block' : 'none';
  }

  private async changeCamera(deviceId: string): Promise<void> {
    if ((deviceId || undefined) === this.deviceId) return;
    this.deviceId = deviceId || undefined;
    // Tear the old stream down FIRST so startCamera's re-open guard doesn't short-circuit
    // (leaving a stopped stream on screen — the "goes dark on switch" bug). The tracker
    // (this.live) is intentionally kept across the switch.
    if (this.cameraOn) this.teardownCamera();
    await this.startCamera();
  }

  /** Stop the current stream and kill its frame loop, without clearing the tracker. */
  private teardownCamera(): void {
    this.loopGen++; // orphan any in-flight tick loop
    this.cameraOn = false;
    this.cam?.stop();
    this.cam = null;
  }

  /** Open the camera and show the live feed — independent of the seed / OpenCV. */
  async startCamera(): Promise<void> {
    if (this.cameraOn && this.cam) return;
    this.statusEl.textContent = 'opening camera…';
    const gen = ++this.loopGen;
    let cam: Awaited<ReturnType<typeof openCamera>>;
    try {
      cam = await openCamera(this.video, this.deviceId);
    } catch (e) {
      this.statusEl.textContent = `camera error: ${(e as Error).message || e}`;
      return;
    }
    if (gen !== this.loopGen) {
      cam.stop(); // superseded by another switch/stop while we awaited
      return;
    }
    this.cam = cam;
    this.cameraOn = true;
    this.startBtn.hidden = true;
    void this.refreshCameras(); // labels are available now
    this.tryStartTracking();
    this.updateWaitingStatus();
    this.tick(gen);
  }

  private tryStartTracking(): void {
    if (this.live || !this.cameraOn) return;
    if (this._cv?.Mat && this.seedFacelets) {
      const state = decodeFacelets(this.seedFacelets);
      if (state) {
        this.live = new LiveTracker(createLocalizer(opencvDetector(this._cv), this.palette));
        this.live.seed(state);
      }
    }
  }

  private updateWaitingStatus(): void {
    if (this.live) return;
    const missing: string[] = [];
    if (!this.seedFacelets) missing.push('a start state (connect the cube or scan a face)');
    if (!this._cv?.Mat) missing.push('OpenCV (loading…)');
    this.statusEl.textContent = `camera live — waiting for ${missing.join(' + ') || 'tracking'}`;
  }

  private readonly tick = (gen: number): void => {
    if (gen !== this.loopGen || !this.cameraOn || !this.cam) return;
    const frame = this.cam.grab();
    if (frame) {
      if (this.live) {
        const u = this.live.pushFrame(frame, performance.now());
        if (u.kind === 'move' || u.kind === 'resync') {
          const st = this.live.state();
          if (st) {
            this.dispatchEvent(
              new CustomEvent('state-update', { detail: { facelets: encodeFacelets(st) } }),
            );
          }
        }
        this.renderDebug(this.live.lastDebug());
      } else {
        this.tryStartTracking();
        this.updateWaitingStatus();
      }
    }
    const next = () => this.tick(gen);
    const v = this.video as unknown as { requestVideoFrameCallback?: (cb: () => void) => void };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  };

  private renderDebug(d: FrameDebug | null): void {
    const p = this.palette.get();
    this.paletteEl.textContent = 'palette:';
    for (const f of FACES) {
      const sw = document.createElement('span');
      const [r, g, b] = p[f];
      sw.title = `${f} ${css(r, g, b)}`;
      sw.style.cssText = `width:16px;height:16px;border-radius:3px;border:1px solid rgba(0,0,0,.4);background:${css(r, g, b)}`;
      this.paletteEl.append(sw);
    }
    if (!d) return;
    const centers = d.centers
      .map((c) => `${c.slot}=${css(c.rgb[0], c.rgb[1], c.rgb[2])}`)
      .join(' ');
    const line =
      `status=${d.status} last=${d.lastUpdate} faces=${d.facesDetected} cells=${d.cellsSeen} ` +
      `diff=${Number.isFinite(d.diff) ? d.diff.toFixed(1) : '∞'} stable=${d.stable} aligned=${d.alignedGeometry}\n` +
      `centers: ${centers || '(none — detector found no cube)'}`;
    this.statusEl.textContent = `tracking: ${d.status}`;
    this.debugEl.textContent = line;
    const now = performance.now();
    if (now - this.lastLog > 500) {
      this.lastLog = now;
      console.log('[tracker]', line.replace('\n', ' | '));
    }
  }

  stop(): void {
    this.teardownCamera();
    this.live = null;
    this.startBtn.hidden = false;
    this.statusEl.textContent = 'stopped';
  }
}

if (!customElements.get('tracker-panel')) customElements.define('tracker-panel', TrackerPanel);
