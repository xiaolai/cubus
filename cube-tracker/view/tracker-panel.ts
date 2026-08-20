// <tracker-panel> — the app-facing web component for continuous camera tracking.
// Mirrors <scanner-panel>: the app hands it OpenCV.js via `panel.cv = cv`, seeds it
// with a known start state, and listens for `state-update` events to drive the twin.
// The heavy lifting is the tested cube-tracker core; this shell is the thin, browser-
// only glue (camera + rVFC loop), verified live in the app.

import { openCamera } from '../src/camera.js';
import { decodeFacelets, encodeFacelets } from '../src/cube.js';
import { LiveTracker } from '../src/live.js';
import { createLocalizer } from '../src/perception/localize.js';
import { opencvDetector } from '../src/perception/opencv-detector.js';

export class TrackerPanel extends HTMLElement {
  private readonly video = document.createElement('video');
  private readonly statusEl = document.createElement('div');
  private cam: Awaited<ReturnType<typeof openCamera>> | null = null;
  private live: LiveTracker | null = null;
  private running = false;
  // The injected OpenCV.js module (set by the app once its WASM runtime is ready).
  cv: any = null;

  connectedCallback(): void {
    this.style.display = 'block';
    this.video.setAttribute('playsinline', 'true');
    this.video.muted = true;
    this.video.style.width = '100%';
    this.video.style.borderRadius = '8px';
    this.statusEl.style.cssText = 'color:#8b949e;font-size:12px;margin-top:8px';
    this.statusEl.textContent = 'idle';
    this.append(this.video, this.statusEl);
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
    this.live = new LiveTracker(createLocalizer(opencvDetector(this.cv)));
    this.live.seed(state);
    this.cam = await openCamera(this.video);
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
      this.statusEl.textContent = `tracking: ${this.live.status()}`;
    }
    const v = this.video as unknown as {
      requestVideoFrameCallback?: (cb: () => void) => void;
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(this.tick);
    else requestAnimationFrame(this.tick);
  };

  stop(): void {
    this.running = false;
    this.cam?.stop();
    this.cam = null;
    this.live = null;
    this.statusEl.textContent = 'stopped';
  }
}

if (!customElements.get('tracker-panel')) customElements.define('tracker-panel', TrackerPanel);
