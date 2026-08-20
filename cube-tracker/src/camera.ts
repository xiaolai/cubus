// The ONLY impure capture shell (getUserMedia + frame grab). Acquire ONE long-lived
// stream (WKWebView does not persist the grant and a second getUserMedia can kill the
// first — algorithm §F.3). This file is hardware-bound: it typechecks and lints but is
// verified only live in the app, never in the offline gate.

import type { Frame } from './perception/motion.js';

export interface CameraHandle {
  readonly stream: MediaStream;
  /** Grab the current video frame at a downscaled width (default 480px). */
  grab(width?: number): Frame | null;
  stop(): void;
}

export async function openCamera(video: HTMLVideoElement): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return {
    stream,
    grab(width = 480): Frame | null {
      if (!ctx || video.videoWidth === 0) return null;
      const scale = width / video.videoWidth;
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      return { data: img.data, width: w, height: h };
    },
    stop(): void {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
