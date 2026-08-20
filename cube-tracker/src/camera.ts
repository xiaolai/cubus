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

/** One selectable camera. */
export interface CameraDevice {
  deviceId: string;
  label: string;
}

/**
 * List available video-input devices. Labels populate only after camera permission has
 * been granted, so call this after a first `openCamera` for a labelled list (e.g. a
 * machine with two webcams).
 */
export async function listCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** Open a camera. `deviceId` selects a specific one (default: the rear/environment camera). */
export async function openCamera(
  video: HTMLVideoElement,
  deviceId?: string,
): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play();

  // Best-effort continuous auto-focus: a sharp frame gives the detector clean edges. Not
  // every webcam exposes focusMode; applyConstraints rejects silently when unsupported.
  const [track] = stream.getVideoTracks();
  const caps = (track?.getCapabilities?.() ?? {}) as { focusMode?: string[] };
  if (track && caps.focusMode?.includes('continuous')) {
    // focusMode isn't in the standard DOM types yet — cast through unknown.
    track
      .applyConstraints({
        advanced: [{ focusMode: 'continuous' }],
      } as unknown as MediaTrackConstraints)
      .catch(() => {}); // unsupported / busy — leave the camera on its default focus
  }

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
