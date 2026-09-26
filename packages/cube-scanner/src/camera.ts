// The ONLY impure capture code: getUserMedia + grabbing a frame off the video.
// Everything downstream consumes the plain `Frame` this produces, so the core
// stays browser-free and Node-testable. This file needs a real webcam and is
// therefore excluded from the coverage gate (verified manually in the app).

import type { Frame } from './types.js';

/** A source of frames the scanner can sample. Backed by the webcam in the app. */
export interface FrameSource {
  /** The current frame as plain RGBA pixels. */
  grab(): Frame;
  /**
   * WHICH frame is in front of the camera right now — a value that changes when, and only when, the
   * picture does. Null from a source that cannot tell.
   *
   * ADDED FOR D2 (`dev-docs/scan-pipeline-audit-2026-09-23.md` §3). Nothing downstream could tell a
   * re-served frame from a new one, on either path: the native camera hands back the same frame on
   * every tick for up to a second, and a `<video>` ticked faster than its stream paints repeats the
   * last one just as silently. One physical frame then supplied several "reads" of the stillness
   * gate — three identical reads spanning 500 ms is satisfiable by ONE frame read three times — and
   * any design that accumulates evidence would have counted it as several observations.
   *
   * IDENTITY, NOT A FILTER, and the distinction is the audit's central finding (§0.2): a stage that
   * decides and discards is how a weak signal becomes total failure. So this reports which frame
   * this is and refuses nothing; a consumer that wants distinct frames compares it, one that wants
   * every tick ignores it, and the recorder counts how often each was served.
   *
   * Optional because a source that cannot say must say so rather than invent a counter — a
   * fabricated id is worse than none, since it would read as "always a new frame", which is exactly
   * the belief that was wrong.
   */
  frameId?(): number | null;
  /**
   * The liveness half of `grab()` on its own: throws exactly what `grab()` would throw before it
   * read a pixel — `CameraLostError`, `FrameNotReadyError` — and returns when a frame could be read.
   *
   * For a caller that takes the picture another way (an `ImageBitmap` for the letterbox worker,
   * 2026-09-20) and still owes the loop the same two verdicts: a camera that stopped delivering is
   * a failure to report, and one that has not delivered yet is a tick to skip. Optional because a
   * source that cannot say ahead of time answers at `grab()`, and that answer still stands — which
   * is why a source WITHOUT it is read through `grab()` even where a worker could take a bitmap
   * (`WebDetector.next`, 2026-09-21): the bitmap path never calls `grab()`, so a conforming source
   * that keeps its verdicts there would otherwise be snapshotted as a frozen picture for ever.
   */
  ready?(): void;
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
 *
 * The REASON is the thrower's to give (2026-09-21). The message was fixed at "video has no
 * dimensions yet" for every not-ready condition, and by then three threw it: a video with no
 * size, a MUTED track (which has a size), and a bitmap the engine would not take (which says
 * nothing about size). A diagnosis that names the wrong condition sends whoever reads the scan
 * trace after a fault that is not there, so each site says what it measured.
 */
export class FrameNotReadyError extends Error {
  constructor(reason = 'the video has no dimensions yet') {
    super(`camera not ready: ${reason}`);
    this.name = 'FrameNotReadyError';
  }
}

/**
 * "The camera has stopped delivering" — the one `grab()` failure that is NOT transient.
 *
 * Its own class, and not `FrameNotReadyError`, because the two mean opposite things to the loop
 * that reads them: not-ready is "try again next tick", and this is "no frame is coming". It used
 * not to exist at all (2026-09-20): `grab()`'s only liveness test was a zero `videoWidth`, and a
 * track that ENDED — a webcam unplugged, a Continuity Camera walked away, permission revoked in
 * the site bubble — keeps its dimensions and keeps painting its last picture, so every tick was a
 * successful inference of a frozen frame, both of the panel's fail-loud clocks stayed clear, and
 * the scan sat on "Already have" for as long as anyone watched (measured in headless Chromium;
 * `dev-docs/scanner-audit-2026-09-20.md` §1.2).
 */
export class CameraLostError extends Error {
  constructor(why: string) {
    super(`camera lost: ${why}`);
    this.name = 'CameraLostError';
  }
}

/**
 * Why a stream can no longer be read from, or null while it can. Pure over the three facts a
 * `MediaStream` and its video track expose — `active`, the track's `readyState`, and `muted` — so
 * it is tested without a camera.
 *
 * A track that has ENDED is gone for good and is the lost case. A MUTED track is a camera that has
 * stopped sending frames without ending — an OS privacy switch, a tab the browser has throttled —
 * and it can resume, so it is reported as not-ready: the panel's no-frame clock then gives it the
 * same few seconds a warming-up camera gets and fails loud only if it stays that way.
 */
export function frameLiveness(
  stream: Pick<MediaStream, 'active'> | null,
  track: Pick<MediaStreamTrack, 'readyState' | 'muted'> | undefined,
): 'live' | 'muted' | 'ended' {
  // `active === false`, not `!active`: a stand-in stream with no such field is not an inactive one.
  if (!track || track.readyState === 'ended' || stream?.active === false) return 'ended';
  return track.muted === true ? 'muted' : 'live';
}

/**
 * The minimum of a `<video>` this module needs to identify the frame it is showing — so the rule
 * can be tested without a camera, which this file otherwise cannot be (see the header).
 */
export interface FrameCountable {
  videoWidth: number;
  videoHeight: number;
  getVideoPlaybackQuality?: () => { totalVideoFrames: number };
}

/**
 * Which frame `video` is showing, as a COUNT of the frames it has produced (D2,
 * `dev-docs/scan-pipeline-audit-2026-09-23.md` §3).
 *
 * `getVideoPlaybackQuality().totalVideoFrames` is exactly that: the number of frames created for
 * this element, dropped ones included. It repeats between paints, which is the fact D2 needs
 * reported, and it is a counter rather than a clock — so a tick between two paints reads the same
 * value by construction rather than by rounding.
 *
 * NOT `currentTime`, which was the first attempt and is the wrong instrument: for a `MediaStream`
 * the element's position advances with the stream in real time, so reading it per tick would answer
 * "a new frame" on every tick — precisely the false belief D2 exists to correct, restated as its
 * fix. NOT `requestVideoFrameCallback`'s `presentedFrames` either: exact, but absent on standard
 * WebKitGTK and Android's WebView, and it needs a registered callback to read at all.
 *
 * NULL is a first-class answer, and the honest one wherever the count cannot be had: an engine
 * without `getVideoPlaybackQuality`, a video with no dimensions, a non-finite count. A source that
 * cannot identify its frames must say so — `Stillness` then counts every tick, exactly as it did
 * before any of this existed — because a fabricated id reads as "always a new frame", which is the
 * belief being corrected.
 *
 * NOT YET VERIFIED ON A REAL CAMERA. The native half of D2 is measured end to end
 * (`NextDetectionTests`, mutation-checked); this half is reasoned from the specification and held
 * by unit tests over a stand-in element. What a browser actually reports for a `MediaStream`-backed
 * video is a claim only a device can make.
 */
export function videoFrameId(video: FrameCountable): number | null {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;
  const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
  return typeof frames === 'number' && Number.isFinite(frames) ? frames : null;
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
  return (
    devices
      .filter((d) => d.kind === 'videoinput')
      // A PLACEHOLDER IS NOT A CAMERA (2026-09-20). Before permission is granted, the browser lists
      // one video input per kind with an EMPTY id and label — the spec's way of saying "there is a
      // camera" without naming it. An empty id cannot be pinned (`deviceId: { exact: '' }` matches
      // nothing), and a host keying its own "Default camera" row on the empty string drew two such
      // rows and ticked both (`dev-docs/scanner-audit-2026-09-20.md` §2.11). The default is the
      // host's to offer; only cameras that can be chosen are listed.
      .filter((d) => d.deviceId !== '')
      // NUMBERED AFTER the placeholder is dropped, not before (2026-09-21): numbered first, the
      // placeholder took "Camera 1" with it, and a lone unlabelled camera was offered as "Camera 2".
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
  );
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

/**
 * What `getUserMedia` is asked for. Pure over the options, so the three rules it encodes are
 * tested without a camera: a pinned `deviceId` overrides a facing; an empty dict means "any camera"
 * when the caller expressed no preference — let the platform hand over its default rather than
 * steering to a facing mode that, on a desktop, names a different physical machine (see
 * `CameraOptions.facingMode`); and the size is `ideal`, never `exact` (see `IDEAL_WIDTH`).
 */
export function videoConstraints(opts: CameraOptions): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {};
  if (opts.deviceId) constraints.deviceId = { exact: opts.deviceId };
  else if (opts.facingMode) constraints.facingMode = opts.facingMode;
  constraints.width = { ideal: opts.width ?? IDEAL_WIDTH };
  constraints.height = { ideal: opts.height ?? IDEAL_HEIGHT };
  return constraints;
}

/**
 * Ask the platform for the camera, racing the request against `signal`.
 *
 * RACED, AND THE LATE STREAM IS STOPPED (2026-09-21). The request was awaited bare, so a `stop()`
 * while the browser was still asking for permission — a panel disconnecting under the prompt, a
 * newer `use()` — left `openCamera` pending for as long as the prompt stayed up, holding the
 * lifecycle that had cancelled it; and a stream granted after the cancellation arrived to a
 * caller that had already been told "aborted", with nothing left to stop it. The race answers the
 * caller at once; the `then` below is what turns the lens back off if the platform answers late.
 */
async function acquireStream(
  constraints: MediaStreamConstraints,
  signal: AbortSignal | undefined,
): Promise<MediaStream> {
  const asked = navigator.mediaDevices.getUserMedia(constraints);
  if (signal) {
    void asked.then(
      (stream) => {
        if (signal.aborted) for (const track of stream.getTracks()) track.stop();
      },
      () => {},
    );
  }
  return raceAbort(asked, signal);
}

/**
 * The `FrameSource` over an opened stream: its liveness verdicts, its pixel readback and its
 * release, built once the stream is playing. Its own function (2026-09-21) so `openCamera` is
 * acquisition and cancellation and nothing else, and this — the part every later tick runs — can
 * be read on its own.
 */
function frameSourceOf(
  video: HTMLVideoElement,
  stream: MediaStream,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  release: () => void,
): FrameSource {
  // Read back what we actually got, rather than what we asked for. `label` is only populated
  // once permission has been granted — which it has, by the time we are here.
  const track = stream.getVideoTracks()[0];
  const device = describeTrack(track);
  // The moment the platform says the track is over, recorded so the next grab refuses. Read as
  // a fact rather than kept as a flag: `frameLiveness` asks the track and the stream each time,
  // and this listener only exists so an `ended` that fires between two grabs is not missed by a
  // platform that leaves `readyState` lagging (none measured, but the listener costs nothing).
  let endedWhy: string | null = null;
  track?.addEventListener('ended', () => {
    endedWhy = 'the video track ended';
  });

  // What `grab()` asks before it reads a pixel, on its own so the bitmap path (`FrameSource.ready`)
  // asks the same questions in the same order and can never be answered differently.
  const ready = (): void => {
    if (endedWhy !== null) throw new CameraLostError(endedWhy);
    const liveness = frameLiveness(stream, track);
    if (liveness === 'ended') throw new CameraLostError('the camera stopped delivering');
    if (liveness === 'muted') throw new FrameNotReadyError('the video track is muted');
    if (video.videoWidth === 0 || video.videoHeight === 0) throw new FrameNotReadyError();
  };

  return {
    device,
    ready,
    /**
     * Which frame the element is showing, as a COUNT of frames it has produced (D2).
     *
     * `getVideoPlaybackQuality().totalVideoFrames` is exactly that: the number of frames created
     * for this element, dropped ones included. It repeats between paints, which is the fact D2
     * needs reported, and it is a counter rather than a clock — so a tick between two paints reads
     * the same value by construction rather than by rounding.
     *
     * NOT `currentTime`, which was the first attempt and is the wrong instrument: for a
     * `MediaStream` the element's position advances with the stream in real time, so reading it
     * per tick would answer "a new frame" on every tick — precisely the false belief D2 exists to
     * correct, restated as its fix. NOT `requestVideoFrameCallback`'s `presentedFrames` either:
     * exact, but absent on standard WebKitGTK and Android's WebView, and it needs a registered
     * callback to read at all.
     *
     * NULL is a first-class answer, and it is the honest one wherever the count cannot be had: an
     * engine without `getVideoPlaybackQuality`, a video with no dimensions, a non-finite count. A
     * source that cannot identify its frames must say so — `Stillness` then counts every tick,
     * exactly as it did before any of this existed — because a fabricated id reads as "always a
     * new frame", which is the belief being corrected.
     *
     * NOT YET VERIFIED ON A REAL CAMERA. The native half of D2 is measured end to end
     * (`NextDetectionTests`, mutation-checked); this half is reasoned from the specification and
     * held by unit tests over a stand-in element. What a browser actually reports for a
     * `MediaStream`-backed video is a claim only a device can make.
     */
    frameId: () => videoFrameId(video),
    grab(): Frame {
      ready();
      const w = video.videoWidth;
      const h = video.videoHeight;
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
}

/** Open the webcam into the given <video> and return a frame grabber. */
export async function openCamera(
  video: HTMLVideoElement,
  opts: CameraOptions = {},
  signal?: AbortSignal,
): Promise<FrameSource> {
  // Already cancelled before we start? Don't even prompt for the camera.
  if (signal?.aborted) throw abortError();

  const stream = await acquireStream({ video: videoConstraints(opts), audio: false }, signal);

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

    return frameSourceOf(video, stream, ctx, canvas, release);
  } catch (err) {
    release();
    throw err;
  }
}
