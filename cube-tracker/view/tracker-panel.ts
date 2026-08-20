// <tracker-panel> — the user-facing camera tracking view.
//
// One guided flow, not a debug HUD: the camera turns on when the panel opens, a framing
// guide + plain instruction sits over the video, and a single 3-state status line reads
// Searching → Cube found → Tracking. Tracking needs a KNOWN start state, so when none is
// set the panel prompts to scan (emitting `request-scan` for the app to run the scanner)
// rather than silently doing nothing. The developer telemetry (rolling palette + per-frame
// detector numbers) is collapsed behind a Debug toggle, off by default.

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
  private readonly stage = document.createElement('div');
  private readonly video = document.createElement('video');
  private readonly overlay = document.createElement('canvas');
  private octx: CanvasRenderingContext2D | null = null;
  private readonly guide = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly picker = document.createElement('select');
  private readonly statusEl = document.createElement('div');
  private readonly scanBtn = document.createElement('button');
  private readonly retryBtn = document.createElement('button');
  private readonly debugToggle = document.createElement('button');
  private readonly debugWrap = document.createElement('div');
  private readonly paletteEl = document.createElement('div');
  private readonly debugEl = document.createElement('pre');
  private cam: Awaited<ReturnType<typeof openCamera>> | null = null;
  private live: LiveTracker | null = null;
  private cameraOn = false;
  private seedFacelets: string | null = null;
  private readonly palette: CenterPalette = rollingPalette();
  private deviceId: string | undefined;
  private debugOn = false;
  private lastLog = 0;
  private loopGen = 0;
  private _cv: any = null;

  // The injected OpenCV.js module (set by the app once its WASM runtime is ready).
  set cv(m: any) {
    this._cv = m;
    this.tryStartTracking();
    this.render();
  }
  get cv(): any {
    return this._cv;
  }

  connectedCallback(): void {
    this.style.display = 'block';

    this.stage.style.cssText =
      'position:relative;width:100%;border-radius:10px;overflow:hidden;background:#000;aspect-ratio:4/3';
    this.video.setAttribute('playsinline', 'true');
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    // Overlay canvas: the detector's found face outlines, drawn in frame coords (the
    // stage aspect is matched to the frame so 100%×100% maps 1:1 — no cover-crop skew).
    this.overlay.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    this.octx = this.overlay.getContext('2d');
    // Framing guide: a rounded square the cube should fill, centered over the feed.
    this.guide.style.cssText =
      'position:absolute;inset:0;margin:auto;width:58%;aspect-ratio:1;border:3px dashed rgba(255,255,255,.75);border-radius:14px;pointer-events:none';
    this.hint.textContent = 'Hold your cube in the box — show 3 sides (top, right, front)';
    this.hint.style.cssText =
      'position:absolute;left:0;right:0;bottom:8px;text-align:center;font-size:12px;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none';
    this.stage.append(this.video, this.overlay, this.guide, this.hint);

    this.picker.style.cssText =
      'margin-top:8px;width:100%;padding:6px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px';
    this.picker.onchange = () => void this.changeCamera(this.picker.value);
    this.picker.style.display = 'none';

    this.statusEl.style.cssText =
      'margin-top:10px;font-size:14px;font-weight:600;color:#e6edf3;min-height:20px';

    this.scanBtn.textContent = 'Scan your cube first';
    this.scanBtn.style.cssText =
      'margin-top:8px;padding:8px 16px;border:0;border-radius:8px;background:#58a6ff;color:#06122b;font-weight:600;cursor:pointer';
    this.scanBtn.onclick = () => this.dispatchEvent(new CustomEvent('request-scan'));
    this.scanBtn.hidden = true;

    this.retryBtn.textContent = 'Start camera';
    this.retryBtn.style.cssText =
      'margin-top:8px;padding:8px 16px;border:1px solid #30363d;border-radius:8px;background:#21262d;color:#e6edf3;cursor:pointer';
    this.retryBtn.onclick = () => void this.startCamera();
    this.retryBtn.hidden = true;

    this.debugToggle.textContent = 'Show debug';
    this.debugToggle.style.cssText =
      'margin-top:12px;padding:0;border:0;background:none;color:#6e7681;font-size:11px;text-decoration:underline;cursor:pointer';
    this.debugToggle.onclick = () => {
      this.debugOn = !this.debugOn;
      this.debugToggle.textContent = this.debugOn ? 'Hide debug' : 'Show debug';
      this.debugWrap.hidden = !this.debugOn;
    };
    this.paletteEl.style.cssText = 'display:flex;gap:4px;margin-top:8px;align-items:center';
    this.debugEl.style.cssText =
      'margin-top:6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#8b949e;white-space:pre-wrap;word-break:break-all';
    this.debugWrap.append(this.paletteEl, this.debugEl);
    this.debugWrap.hidden = true;

    this.append(
      this.stage,
      this.picker,
      this.statusEl,
      this.scanBtn,
      this.retryBtn,
      this.debugToggle,
      this.debugWrap,
    );
    this.render();
    void this.refreshCameras();
  }

  /** Provide the start state (from a scan or the smart cube); tracking begins once cv is ready too. */
  provideSeed(facelets: string): void {
    this.seedFacelets = facelets || null;
    this.tryStartTracking();
    this.render();
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
    this.picker.style.display = cams.length > 1 && this.cameraOn ? 'block' : 'none';
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
    this.statusEl.textContent = 'Opening camera…';
    const gen = ++this.loopGen;
    let cam: Awaited<ReturnType<typeof openCamera>>;
    try {
      cam = await openCamera(this.video, this.deviceId);
    } catch (e) {
      this.statusEl.textContent = `Camera error: ${(e as Error).message || e}`;
      this.retryBtn.hidden = false;
      return;
    }
    if (gen !== this.loopGen) {
      cam.stop(); // superseded by another switch/stop while we awaited
      return;
    }
    this.cam = cam;
    this.cameraOn = true;
    void this.refreshCameras(); // labels are available now
    this.tryStartTracking();
    this.render();
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

  /** Show/hide the contextual controls and set the plain-language status line. */
  private render(): void {
    const cvReady = !!this._cv?.Mat;
    const seeded = !!this.seedFacelets;
    this.retryBtn.hidden = this.cameraOn;
    this.scanBtn.hidden = !(this.cameraOn && cvReady && !seeded);
    this.guide.style.display = this.cameraOn ? 'block' : 'none';
    this.hint.style.display = this.cameraOn && this.live ? 'block' : 'none';

    let text: string;
    let tone = '#e6edf3';
    if (!this.cameraOn) text = 'Camera off';
    else if (!cvReady) text = 'Warming up the detector…';
    else if (!seeded) text = 'To track your cube, its starting colors must be known.';
    else {
      const d = this.live?.lastDebug();
      if (!d) text = 'Point your cube at the box…';
      else if (d.status === 'tracking') {
        text = 'Tracking your cube ✓';
        tone = '#3fb950';
      } else if (d.facesDetected === 0)
        text = 'Searching — hold the cube in the box, showing 3 sides';
      else if (d.status === 'lost') {
        text = 'Lost the cube — show it to the camera again';
        tone = '#d29922';
      } else text = 'Cube found — hold steady';
    }
    this.statusEl.textContent = text;
    this.statusEl.style.color = tone;
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
        this.render();
        this.drawOverlay(frame.width, frame.height, this.live.lastDebug());
        if (this.debugOn) this.renderDebug(this.live.lastDebug());
      } else {
        this.tryStartTracking();
        this.render();
      }
    }
    const next = () => this.tick(gen);
    const v = this.video as unknown as { requestVideoFrameCallback?: (cb: () => void) => void };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  };

  /** Draw the detected face outlines onto the overlay canvas (frame pixel coords). */
  private drawOverlay(fw: number, fh: number, d: FrameDebug | null): void {
    const ctx = this.octx;
    if (!ctx) return;
    if (this.overlay.width !== fw || this.overlay.height !== fh) {
      this.overlay.width = fw;
      this.overlay.height = fh;
      this.stage.style.aspectRatio = `${fw} / ${fh}`; // keep the feed 1:1 with the overlay
    }
    ctx.clearRect(0, 0, fw, fh);
    const quads = d?.quads ?? [];
    if (quads.length === 0) return;
    ctx.lineWidth = Math.max(2, fw / 160);
    ctx.strokeStyle = '#3fb950';
    ctx.fillStyle = 'rgba(63,185,80,0.15)';
    for (const q of quads) {
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (let i = 1; i < q.length; i++) ctx.lineTo(q[i]!.x, q[i]!.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

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
    if (this.octx) this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.render();
  }
}

if (!customElements.get('tracker-panel')) customElements.define('tracker-panel', TrackerPanel);
