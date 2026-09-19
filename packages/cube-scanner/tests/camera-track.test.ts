// What the opened camera is said to be, read off its track (src/camera.ts, `describeTrack`).
//
// The scan screen's sticker view mirrors its drawing unless the camera faces AWAY from the person
// (dev-docs/scan-guidance-plan.md 4.1), so the facing has to be exactly what the track reported —
// never guessed from the platform, and absent when the track says nothing, as a laptop's does.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeTrack, facingOf, openCamera } from '../src/camera.js';

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

describe('facingOf', () => {
  it('names one of the two directions or nothing — the one check every reader of a facing uses', () => {
    expect(facingOf('user')).toBe('user');
    expect(facingOf('environment')).toBe('environment');
    for (const other of ['left', 'unspecified', '', null, undefined, 1, {}])
      expect(facingOf(other)).toBeUndefined();
  });
});
