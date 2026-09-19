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

/**
 * "The camera is open but has not produced a frame yet" — the ONE transient `grab()` failure.
 *
 * A named class rather than a message to match on, because `WebDetector.next()` has to swallow
 * exactly this and rethrow everything else. It used to `catch {}` every throw into `null` with a
 * comment saying it was this case, so a camera that opened and never delivered looked identical
 * to one that was still warming up, and the scanner idled forever on "Show any side".
 */
export class FrameNotReadyError extends Error {
  constructor() {
    super('camera not ready: video has no dimensions yet');
    this.name = 'FrameNotReadyError';
  }
}

/**
 * The frame size asked for when a caller expresses no preference.
 *
 * `ideal`, not `exact`: a camera that cannot do 720p gives what it has rather than failing. The
 * reason there is a default at all is that `grab()` copies the whole frame through
 * `getImageData` on EVERY tick, and an unconstrained 4K stream makes that a 33 MB copy per frame
 * — for a picture that is then letterboxed down to 640x640 before the model sees any of it.
 */
export const IDEAL_WIDTH = 1280;
export const IDEAL_HEIGHT = 720;

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
  /**
   * Which way the camera points, when the camera says: 'user' faces the person, 'environment'
   * faces away. Absent when it does not say, which is what a laptop's webcam usually does — and a
   * laptop's webcam faces the person. A host drawing where the camera sees things mirrors unless
   * this says 'environment' (dev-docs/scan-guidance-plan.md 4.1).
   */
  facing?: 'user' | 'environment';
}

/**
 * A facing, if `value` names one of the two directions — and nothing otherwise. ONE check, because it
 * was written out three times (a track's settings, the native plugin's answer, the panel's attribute)
 * and a copy that drifted would mirror a camera the others do not (audit, 2026-09-19).
 */
export function facingOf(value: unknown): 'user' | 'environment' | undefined {
  return value === 'user' || value === 'environment' ? value : undefined;
}

/**
 * The camera a video track came from, as the track itself reports it. Pure, so it is tested without
 * a camera: the facing is kept only when the track names one of the two directions.
 */
export function describeTrack(
  track: Pick<MediaStreamTrack, 'label' | 'getSettings'> | undefined,
): CameraDevice {
  const settings = track?.getSettings();
  const facing = facingOf(settings?.facingMode);
  return {
    deviceId: settings?.deviceId ?? '',
    label: track?.label || 'Camera',
    ...(facing ? { facing } : {}),
  };
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
      reject(abortError());
      return;
    }
    const onAbort = () => reject(abortError());
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

/** The one abort rejection. Four sites built this by hand; the message is what callers match on,
 * so a typo in any one of them was a silent behaviour change. */
const abortError = () => new DOMException('camera open aborted', 'AbortError');

/** Open the webcam into the given <video> and return a frame grabber. */
export async function openCamera(
  video: HTMLVideoElement,
  opts: CameraOptions = {},
  signal?: AbortSignal,
): Promise<FrameSource> {
  // Already cancelled before we start? Don't even prompt for the camera.
  if (signal?.aborted) throw abortError();

  // An empty dict means "any camera", which is what we want when the caller expressed no
  // preference: let the platform hand over its default rather than steering to a facing mode
  // that, on a desktop, names a different physical machine (see CameraOptions.facingMode).
  const videoConstraints: MediaTrackConstraints = {};
  if (opts.deviceId) videoConstraints.deviceId = { exact: opts.deviceId };
  else if (opts.facingMode) videoConstraints.facingMode = opts.facingMode;
  videoConstraints.width = { ideal: opts.width ?? IDEAL_WIDTH };
  videoConstraints.height = { ideal: opts.height ?? IDEAL_HEIGHT };

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
    if (signal?.aborted) throw abortError();
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
    const device = describeTrack(stream.getVideoTracks()[0]);

    return {
      device,
      grab(): Frame {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w === 0 || h === 0) throw new FrameNotReadyError();
        // ONLY ON CHANGE. Assigning either dimension resets the whole canvas — it drops the
        // backing store and re-allocates it — so writing the same numbers back on every tick paid
        // for a full reallocation per frame in exchange for nothing. The stream's size does change
        // (a camera renegotiating, a track constraint applied), so it is re-read rather than
        // captured once.
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
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
