// <tracker-panel> — the app-facing web component for continuous camera tracking.
// Mirrors <scanner-panel>: the app hands it OpenCV.js via `panel.cv = cv`, seeds it
// with a known start state, and listens for `state-update` events to drive the twin.
// Adds a camera picker (for machines with several webcams), a per-session ROLLING
// PALETTE (classification adapts to the cube's own centers — handles non-standard /
// metallic colors), and a live DEBUG readout + throttled console logs so you can
// inspect what the camera sees while showing a cube. Browser-only glue; the heavy
// logic is the offline-verified core.

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
  private readonly statusEl = document.createElement('div');
  private readonly paletteEl = document.createElement('div');
  private readonly debugEl = document.createElement('pre');
  private cam: Awaited<ReturnType<typeof openCamera>> | null = null;
  private live: LiveTracker | null = null;
  private running = false;
  private readonly palette: CenterPalette = rollingPalette();
  private deviceId: string | undefined;
  private lastLog = 0;
  // The injected OpenCV.js module (set by the app once its WASM runtime is ready).
  cv: any = null;

  connectedCallback(): void {
    this.style.display = 'block';
    this.picker.style.cssText =
      'margin-bottom:8px;width:100%;padding:6px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px';
    this.picker.onchange = () => this.changeCamera(this.picker.value);
    this.video.setAttribute('playsinline', 'true');
    this.video.muted = true;
    this.video.style.cssText = 'width:100%;border-radius:8px';
    this.statusEl.style.cssText = 'color:#8b949e;font-size:12px;margin-top:8px';
    this.statusEl.textContent = 'idle';
    this.paletteEl.style.cssText = 'display:flex;gap:4px;margin-top:8px;align-items:center';
    this.debugEl.style.cssText =
      'margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#8b949e;white-space:pre-wrap;word-break:break-all';
    this.append(this.picker, this.video, this.statusEl, this.paletteEl, this.debugEl);
    void this.refreshCameras(); // best-effort (labels fill in after permission)
  }

  private async refreshCameras(): Promise<void> {
    let cams: CameraDevice[] = [];
    try {
      cams = await listCameras();
    } catch {
      /* enumeration needs permission — populated after start */
    }
    this.picker.textContent = '';
    for (const c of cams) {
      const o = document.createElement('option');
      o.value = c.deviceId;
      o.textContent = c.label;
      if (c.deviceId === this.deviceId) o.selected = true;
      this.picker.append(o);
    }
    this.picker.style.display = cams.length > 1 ? 'block' : 'none'; // only show a picker when there's a choice
  }

  private async changeCamera(deviceId: string): Promise<void> {
    this.deviceId = deviceId || undefined;
    if (this.running) {
      this.cam?.stop();
      this.cam = await openCamera(this.video, this.deviceId);
    }
  }

  /** Seed from a known facelet state (from a scan or the smart cube) and start tracking. */
  async start(facelets: string): Promise<void> {
    const state = decodeFacelets(facelets);
    if (!state) {
      this.statusEl.textContent = 'invalid start state';
      return;
    }
    if (!this.cv || !this.cv.Mat) {
      this.statusEl.textContent = 'OpenCV not ready';
      return;
    }
    this.live = new LiveTracker(createLocalizer(opencvDetector(this.cv), this.palette));
    this.live.seed(state);
    this.cam = await openCamera(this.video, this.deviceId);
    await this.refreshCameras(); // labels now available
    this.running = true;
    this.tick();
  }

  private readonly tick = (): void => {
    if (!this.running || !this.cam || !this.live) return;
    const frame = this.cam.grab();
    if (frame) {
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
    }
    const v = this.video as unknown as { requestVideoFrameCallback?: (cb: () => void) => void };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(this.tick);
    else requestAnimationFrame(this.tick);
  };

  private renderDebug(d: FrameDebug | null): void {
    // palette swatches — see what the rolling palette has learned about YOUR cube
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
    // throttled console log so it can be copied out while showing a cube
    const now = performance.now();
    if (now - this.lastLog > 500) {
      this.lastLog = now;
      console.log('[tracker]', line.replace('\n', ' | '));
    }
  }

  stop(): void {
    this.running = false;
    this.cam?.stop();
    this.cam = null;
    this.live = null;
    this.statusEl.textContent = 'stopped';
  }
}

if (!customElements.get('tracker-panel')) customElements.define('tracker-panel', TrackerPanel);
