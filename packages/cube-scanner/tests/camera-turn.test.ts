// The platform's camera calls go one at a time (`inTurn`, src/camera.ts), and the gate is BOUNDED: a call the
// platform never answers would otherwise hold every later camera open and device list for the life of the page —
// where, before the gate, pressing Start again simply asked again.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_CALL_RELEASE_MS, listCameras, openCamera } from '../src/camera.js';

describe('the camera gate is bounded', () => {
  afterEach(async () => {
    // A call left unanswered still holds the module's queue until its bound, and that bound is a timer on the
    // fake clock: run the clock past every bound a test could have started before going back to real time.
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS * 4);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const video = () => ({ srcObject: null, play: async () => {} }) as unknown as HTMLVideoElement;

  it('a call that never answers stops holding the queue at the bound, says so, and is itself left pending', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let asked = 0;
    vi.stubGlobal('navigator', {
      mediaDevices: {
        // Never answered: no grant, no refusal — a host that never settles a permission request.
        getUserMedia: () => {
          asked += 1;
          return new Promise(() => {});
        },
        enumerateDevices: async () => [],
      },
    });
    let stuckSettled = false;
    openCamera(video()).then(
      () => {
        stuckSettled = true;
      },
      () => {
        stuckSettled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toBe(1);

    // A second open — a person pressing Start again — waits its turn…
    void openCamera(video()).catch(() => {});
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS - 1);
    expect(asked).toBe(1);
    expect(warn).not.toHaveBeenCalled();

    // …and is asked once the bound has passed, with the release said out loud.
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/getUserMedia.*not answered/);
    // The bound releases the QUEUE, not the call: whoever asked first is still waiting on the platform.
    expect(stuckSettled).toBe(false);
  });

  it('the bound runs from when a call is ASKED, not from when it joined the queue', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () => {
          order.push('camera');
          return new Promise(() => {});
        },
        enumerateDevices: async () => {
          order.push('list');
          return [];
        },
      },
    });
    void openCamera(video()).catch(() => {}); // asked at 0, never answers
    void openCamera(video()).catch(() => {}); // queued at 0, asked at the bound, never answers
    const list = listCameras(); // queued at 0: must wait a FULL bound behind the second, not be freed with it
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS);
    expect(order).toEqual(['camera', 'camera']);
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS - 1);
    expect(order).toEqual(['camera', 'camera']);
    await vi.advanceTimersByTimeAsync(1);
    await list;
    expect(order).toEqual(['camera', 'camera', 'list']);
  });

  it('a call that answers in time says nothing and holds the queue only as long as it takes', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new DOMException('no', 'NotAllowedError')), 1000),
          ),
        enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'a', label: 'A' }],
      },
    });
    const opening = openCamera(video()).catch(() => {});
    const list = listCameras();
    await vi.advanceTimersByTimeAsync(1000);
    await opening;
    expect(await list).toEqual([{ deviceId: 'a', label: 'A' }]);
    await vi.advanceTimersByTimeAsync(CAMERA_CALL_RELEASE_MS * 2);
    expect(warn).not.toHaveBeenCalled();
  });
});
