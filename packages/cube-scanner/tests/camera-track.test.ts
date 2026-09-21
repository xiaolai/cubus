// What the opened camera is said to be, read off its track (src/camera.ts, `describeTrack`).
//
// The scan screen's sticker view mirrors its drawing unless the camera faces AWAY from the person
// (dev-docs/scan-guidance-plan.md 4.1), so the facing has to be exactly what the track reported —
// never guessed from the platform, and absent when the track says nothing, as a laptop's does.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CameraLostError,
  describeTrack,
  FrameNotReadyError,
  facingOf,
  frameLiveness,
  IDEAL_HEIGHT,
  IDEAL_WIDTH,
  listCameras,
  openCamera,
  videoConstraints,
} from '../src/camera.js';

const track = (settings: MediaTrackSettings, label = 'FaceTime HD Camera') => ({
  label,
  getSettings: () => settings,
});

describe('describeTrack', () => {
  it('keeps the facing a track reports', () => {
    expect(describeTrack(track({ deviceId: 'a', facingMode: 'environment' }))).toEqual({
      deviceId: 'a',
      label: 'FaceTime HD Camera',
      facing: 'environment',
    });
    expect(describeTrack(track({ deviceId: 'b', facingMode: 'user' })).facing).toBe('user');
  });

  it('says nothing about facing when the track does not, or names something else', () => {
    expect(describeTrack(track({ deviceId: 'c' }))).not.toHaveProperty('facing');
    expect(describeTrack(track({ deviceId: 'd', facingMode: 'left' }))).not.toHaveProperty(
      'facing',
    );
  });

  it('names a camera with no track and no label rather than leaving it blank', () => {
    expect(describeTrack(undefined)).toEqual({ deviceId: '', label: 'Camera' });
    expect(describeTrack(track({}, '')).label).toBe('Camera');
  });
});

describe('openCamera', () => {
  // The helper above is pure; this is the wiring — the device an opened camera hands the scanner must
  // carry the facing its own track reports, or a phone's back camera is drawn mirrored (audit,
  // 2026-09-19). getUserMedia, the video element and the canvas are stand-ins; nothing opens.
  afterEach(() => vi.unstubAllGlobals());

  it("hands over the opened track's facing — the track's, not the one asked for — and releases it on stop", async () => {
    // The ASK and the ANSWER are deliberately different here: a browser may hand over another camera
    // than the one requested, and a device built from `opts.facingMode` would then mirror the drawing
    // the wrong way while this test passed (audit, 2026-09-19).
    const stopped: string[] = [];
    const track = {
      label: 'Back Camera',
      getSettings: () => ({ deviceId: 'back-1', facingMode: 'environment' }),
      stop: () => stopped.push('track'),
      addEventListener: () => {}, // `openCamera` listens for `ended` (liveness, 2026-09-20)
    };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({}) }) });
    const video = {
      srcObject: null as unknown,
      play: async () => {},
    } as unknown as HTMLVideoElement;
    const source = await openCamera(video, { facingMode: 'user' });
    expect(source.device).toEqual({
      deviceId: 'back-1',
      label: 'Back Camera',
      facing: 'environment',
    });
    expect(video.srcObject).toBe(stream);
    source.stop();
    expect(stopped).toEqual(['track']);
    expect(video.srcObject).toBeNull();
  });
});

describe('frameLiveness — a camera that stops delivering is not a camera that is warming up', () => {
  // THE DEFECT (2026-09-20). `grab()`'s only liveness test was a zero `videoWidth`, and a track
  // that ends keeps its dimensions and keeps painting its last picture — measured in headless
  // Chromium: after `track.stop()`, `readyState` is 'ended' and `stream.active` is false, while
  // `videoWidth` stays 640 and `drawImage` returns the same pixels seconds later. So a webcam
  // unplugged mid-scan was a perfectly still, perfectly readable frame on every tick
  // (dev-docs/scanner-audit-2026-09-20.md §1.2).
  it('reads a live track as live', () => {
    expect(frameLiveness({ active: true }, { readyState: 'live', muted: false })).toBe('live');
  });

  it('reads an ended track, or an inactive stream, as ended — no frame is coming', () => {
    expect(frameLiveness({ active: true }, { readyState: 'ended', muted: false })).toBe('ended');
    expect(frameLiveness({ active: false }, { readyState: 'live', muted: false })).toBe('ended');
    expect(frameLiveness({ active: true }, undefined)).toBe('ended');
  });

  it('reads a muted track as not-ready, because muting can end', () => {
    expect(frameLiveness({ active: true }, { readyState: 'live', muted: true })).toBe('muted');
  });
});

describe('openCamera — grab() after the track has ended', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A stand-in camera whose track can be ended under the scanner's feet. */
  function fakeCamera() {
    const listeners: Record<string, (() => void)[]> = {};
    const track = {
      label: 'USB Camera',
      readyState: 'live' as 'live' | 'ended',
      muted: false,
      getSettings: () => ({ deviceId: 'usb-1' }),
      stop: () => {},
      addEventListener: (type: string, fn: () => void) => {
        const fns = listeners[type] ?? [];
        fns.push(fn);
        listeners[type] = fns;
      },
    };
    const stream = { active: true, getVideoTracks: () => [track], getTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    const frame = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ drawImage: () => {}, getImageData: () => frame }),
      }),
    });
    const video = {
      srcObject: null as unknown,
      play: async () => {},
      videoWidth: 4,
      videoHeight: 4,
    } as unknown as HTMLVideoElement;
    const end = (): void => {
      for (const fn of listeners.ended ?? []) fn();
    };
    return { track, stream, video, end };
  }

  it('throws CameraLostError once the track has ended, though the video still has a size', async () => {
    const cam = fakeCamera();
    const source = await openCamera(cam.video, {});
    expect(source.grab().width).toBe(4);
    cam.track.readyState = 'ended';
    expect(() => source.grab()).toThrow(CameraLostError);
    expect(() => source.grab()).toThrow(/camera lost/);
  });

  it('throws CameraLostError when the stream went inactive, and when the ended event fired', async () => {
    const byStream = fakeCamera();
    const first = await openCamera(byStream.video, {});
    byStream.stream.active = false;
    expect(() => first.grab()).toThrow(CameraLostError);
    vi.unstubAllGlobals();
    const byEvent = fakeCamera();
    const second = await openCamera(byEvent.video, {});
    byEvent.end();
    expect(() => second.grab()).toThrow(/the video track ended/);
  });

  it('treats a muted track as not-ready, never as lost, and says it is muted', async () => {
    const cam = fakeCamera();
    const source = await openCamera(cam.video, {});
    cam.track.muted = true;
    expect(() => source.grab()).toThrow(FrameNotReadyError);
    // The reason is the condition measured, not the one the class used to name for everything: a
    // muted track HAS dimensions, and "no dimensions yet" sent a reader after the wrong fault.
    expect(() => source.grab()).toThrow(/muted/);
    expect(() => source.grab()).not.toThrow(/dimensions/);
    cam.track.muted = false;
    expect(source.grab().width).toBe(4);
  });

  it('still names the size when that is what is missing', async () => {
    const cam = fakeCamera();
    const source = await openCamera(cam.video, {});
    (cam.video as { videoWidth: number }).videoWidth = 0;
    expect(() => source.grab()).toThrow(/no dimensions/);
  });
});

describe('openCamera — a cancellation while the browser is still asking', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects at once, and stops the stream the platform grants afterwards', async () => {
    // `getUserMedia` was awaited bare: a stop() under the permission prompt left `openCamera`
    // pending for as long as the prompt stayed up, and a stream granted after the cancellation
    // arrived to a caller already told "aborted", with nothing left to stop it — a lens on for
    // nobody.
    const stopped: string[] = [];
    const track = {
      label: 'Late Camera',
      getSettings: () => ({ deviceId: 'late-1' }),
      stop: () => stopped.push('track'),
      addEventListener: () => {},
    };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    let grant: (s: unknown) => void = () => {};
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((resolve) => {
            grant = resolve;
          }),
      },
    });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({}) }) });
    const video = {
      srcObject: null as unknown,
      play: async () => {},
    } as unknown as HTMLVideoElement;
    const controller = new AbortController();
    const opening = openCamera(video, {}, controller.signal);
    controller.abort();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    // Nothing was granted yet, so nothing is stopped yet…
    expect(stopped).toEqual([]);
    // …and the late grant is released on arrival, never attached to the video.
    grant(stream);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopped).toEqual(['track']);
    expect(video.srcObject).toBeNull();
  });
});

describe('videoConstraints', () => {
  it('pins a deviceId over a facing, asks for the ideal size, and asks for any camera otherwise', () => {
    expect(videoConstraints({ deviceId: 'x', facingMode: 'environment' })).toEqual({
      deviceId: { exact: 'x' },
      width: { ideal: IDEAL_WIDTH },
      height: { ideal: IDEAL_HEIGHT },
    });
    expect(videoConstraints({ facingMode: 'user', width: 640, height: 480 })).toEqual({
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 },
    });
    // No facing by default — on a Mac 'environment' names the user's iPhone (CameraOptions).
    expect(videoConstraints({})).not.toHaveProperty('facingMode');
    expect(videoConstraints({})).not.toHaveProperty('deviceId');
  });
});

describe('listCameras', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drops the pre-permission placeholder with an empty id, and keeps every camera that can be chosen', async () => {
    // Before permission, browsers list one video input with an empty id and label: it cannot be
    // pinned, and a host that keys its own "Default camera" row on '' drew that row twice
    // (dev-docs/scanner-audit-2026-09-20.md §2.11).
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: 'videoinput', deviceId: '', label: '' },
          { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
          { kind: 'videoinput', deviceId: 'a', label: 'Cam A' },
          { kind: 'videoinput', deviceId: 'b', label: '' },
        ],
      },
    });
    // Numbered AFTER the placeholder is dropped: it used to take "Camera 1" with it, so the one
    // unlabelled camera a person could choose was offered as "Camera 3" beside a "Cam A".
    expect(await listCameras()).toEqual([
      { deviceId: 'a', label: 'Cam A' },
      { deviceId: 'b', label: 'Camera 2' },
    ]);
  });

  it('numbers a lone unlabelled camera 1, not 2', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: 'videoinput', deviceId: '', label: '' },
          { kind: 'videoinput', deviceId: 'only', label: '' },
        ],
      },
    });
    expect(await listCameras()).toEqual([{ deviceId: 'only', label: 'Camera 1' }]);
  });
});

describe('facingOf', () => {
  it('names one of the two directions or nothing — the one check every reader of a facing uses', () => {
    expect(facingOf('user')).toBe('user');
    expect(facingOf('environment')).toBe('environment');
    for (const other of ['left', 'unspecified', '', null, undefined, 1, {}])
      expect(facingOf(other)).toBeUndefined();
  });
});
