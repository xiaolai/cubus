// The ONLY impure capture code: getUserMedia + grabbing a frame off the video.
// Everything downstream consumes the plain `Frame` this produces, so the core
// stays browser-free and Node-testable. This file needs a real webcam and is
// therefore excluded from the coverage gate (verified manually in the app).

import type { Frame } from './types.js';

/** A source of frames the scanner can sample. Backed by the webcam in the app. */
export interface FrameSource {
  /** The current frame as plain RGBA pixels. */
  grab(): Frame;
  /** Release the underlying camera tracks. */
  stop(): void;
}

export interface CameraOptions {
  /** 'environment' (rear) is the sane default for scanning a held cube. */
  facingMode?: 'user' | 'environment';
  width?: number;
  height?: number;
  /** Select a specific camera (overrides facingMode). Get IDs from `listCameras`. */
  deviceId?: string;
}

/** One selectable camera. */
export interface CameraDevice {
  deviceId: string;
  label: string;
}

/**
 * List video-input devices. Labels are only populated after camera permission has been
 * granted, so call this after a first `openCamera` for named entries (e.g. two webcams).
 */
export async function listCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** Reject as soon as `signal` aborts, even while `promise` is still pending. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('camera open aborted', 'AbortError'));
      return;
    }
    const onAbort = () => reject(new DOMException('camera open aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** Open the webcam into the given <video> and return a frame grabber. */
export async function openCamera(
  video: HTMLVideoElement,
  opts: CameraOptions = {},
  signal?: AbortSignal,
): Promise<FrameSource> {
  // Already cancelled before we start? Don't even prompt for the camera.
  if (signal?.aborted) throw new DOMException('camera open aborted', 'AbortError');

  const videoConstraints: MediaTrackConstraints = opts.deviceId
    ? { deviceId: { exact: opts.deviceId } }
    : { facingMode: opts.facingMode ?? 'environment' };
  if (opts.width) videoConstraints.width = { ideal: opts.width };
  if (opts.height) videoConstraints.height = { ideal: opts.height };

  const stream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false,
  });

  // Ownership-guarded teardown: stop OUR tracks, but only detach the <video> if
  // it still shows this stream — so releasing a superseded open never removes a
  // newer open's feed (both share one <video>).
  const release = (): void => {
    for (const track of stream.getTracks()) track.stop();
    if (video.srcObject === stream) video.srcObject = null;
  };
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new DOMException('camera open aborted', 'AbortError');
  };

  // After acquisition, any failure OR cancellation (a newer open / a detach)
  // must release the stream — otherwise the camera stays live with no
  // FrameSource to stop it.
  try {
    throwIfAborted();
    video.srcObject = stream;
    // Race play() against the abort signal so a detach() during a pending
    // play() (autoplay stalls) rejects promptly instead of hanging forever.
    await raceAbort(video.play(), signal);
    throwIfAborted();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');

    return {
      grab(): Frame {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w === 0 || h === 0) throw new Error('camera not ready: video has no dimensions yet');
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        return { data: img.data, width: img.width, height: img.height };
      },
      stop: release,
    };
  } catch (err) {
    release();
    throw err;
  }
}
