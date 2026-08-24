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
  /**
   * The camera actually selected. A host that shows no video preview has no other way to tell
   * WHICH of several cameras it got — and getting the wrong one looks identical to a broken one.
   */
  readonly device: CameraDevice;
}

export interface CameraOptions {
  /**
   * Ask for a front ('user') or rear ('environment') camera. Deliberately UNSET by default.
   *
   * 'environment' looks like the obvious default for scanning a held cube, and on a phone it is.
   * On a Mac it is a trap: the only device that reports itself rear-facing is a Continuity Camera,
   * i.e. the user's iPhone. Defaulting to 'environment' therefore reaches straight past the
   * built-in camera and wakes the phone — which macOS engages as a paired camera AND microphone,
   * so the mic indicator lights up while the camera handoff may never complete. Someone sitting
   * at a laptop never meant that. A host that genuinely wants the rear camera must say so.
   */
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

  // An empty dict means "any camera", which is what we want when the caller expressed no
  // preference: let the platform hand over its default rather than steering to a facing mode
  // that, on a desktop, names a different physical machine (see CameraOptions.facingMode).
  const videoConstraints: MediaTrackConstraints = {};
  if (opts.deviceId) videoConstraints.deviceId = { exact: opts.deviceId };
  else if (opts.facingMode) videoConstraints.facingMode = opts.facingMode;
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

    // Read back what we actually got, rather than what we asked for. `label` is only populated
    // once permission has been granted — which it has, by the time we are here.
    const track = stream.getVideoTracks()[0];
    const device: CameraDevice = {
      deviceId: track?.getSettings().deviceId ?? '',
      label: track?.label || 'Camera',
    };

    return {
      device,
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
