// The two counters, tested directly. They are the part of the scanner that can only fail under a
// race, which is exactly the part the panel's DOM tests cannot reach: from outside, an inference
// that lands one microtask too late and one that lands on time look identical.
import { afterEach, describe, expect, it } from 'vitest';
import type { CameraDevice, CameraOptions } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import { CameraSession } from '../view/camera-session.js';

class StubDetector implements Detector {
  device: CameraDevice | null = null;
  stops = 0;
  lastUse: CameraOptions | undefined;
  failPinned = false;
  async use(opts: CameraOptions = {}): Promise<void> {
    this.lastUse = opts;
    if (this.failPinned && opts.deviceId !== undefined) throw new Error('that camera is gone');
    this.device = { deviceId: opts.deviceId ?? 'default', label: 'Stub' };
  }
  async load(): Promise<void> {}
  async next(): Promise<ModelOutput | null> {
    return null;
  }
  async cameras(): Promise<CameraDevice[]> {
    return [];
  }
  stop(): void {
    this.stops++;
    this.device = null;
  }
}

/** A detector whose `use()` blocks until released, so opens can be made to overlap and reorder. */
class GatedDetector extends StubDetector {
  entered: string[] = [];
  private gates = new Map<string, () => void>();
  override async use(opts: CameraOptions = {}): Promise<void> {
    const id = opts.deviceId ?? 'default';
    this.entered.push(id);
    await new Promise<void>((res) => this.gates.set(id, res));
    // Deliberately no abort-on-stop: `WebDetector` has one, `NativeDetector` had to be given one,
    // and a fake kinder than the weakest implementation cannot catch an ordering bug.
    // `failPinned` is honoured AFTER the gate, so a test can supersede an attempt that is already
    // inside the detector — the only way left to reach the fallback's superseded branch now that a
    // queued attempt whose token was cancelled never enters at all.
    if (this.failPinned && opts.deviceId !== undefined) throw new Error('that camera is gone');
    this.device = { deviceId: id, label: id };
  }
  /** Let the most recently entered pending open finish, and only that one. */
  releaseNewestFirst(): void {
    for (let i = this.entered.length - 1; i >= 0; i--) {
      const id = this.entered[i]!;
      const gate = this.gates.get(id);
      if (gate) {
        this.gates.delete(id);
        gate();
        return;
      }
    }
  }

  release(id: string): void {
    const gate = this.gates.get(id);
    this.gates.delete(id);
    gate?.();
  }
}

type TauriGlobal = { __TAURI__?: { core?: { invoke?: (cmd: string) => Promise<unknown> } } };
const video = () => ({}) as HTMLVideoElement;
const modelUrl = () => './m.onnx';

afterEach(() => {
  (globalThis as TauriGlobal).__TAURI__ = undefined;
});

describe('CameraSession — generation and epoch', () => {
  it('a new attempt supersedes frames in flight, not only earlier attempts', async () => {
    // GENERATION guarded attempts and EPOCH guarded frames, and beginning an attempt bumped only
    // the first. So an inference already out over the camera being switched AWAY from still passed
    // freshFrame — the timer was alive and the epoch unchanged — and could file a capture read
    // through the old lens into the scan that had just asked for a different one.
    const s = new CameraSession();
    s.beginLoop(10, () => {});
    const inFlight = s.frameEpoch();
    expect(s.freshFrame(inFlight)).toBe(true);
    s.beginAttempt();
    expect(s.freshFrame(inFlight)).toBe(false);
    s.close();
  });

  it('restarting the loop invalidates frames without being asked twice', async () => {
    // This used to be a two-call protocol — beginLoop() plus dropFramesInFlight() — enforced by
    // nothing but the one caller remembering both.
    const s = new CameraSession();
    s.beginLoop(10, () => {});
    const before = s.frameEpoch();
    s.beginLoop(10, () => {});
    expect(s.freshFrame(before)).toBe(false);
    s.close();
  });

  it('a stopped loop makes every frame stale, whatever its epoch', () => {
    const s = new CameraSession();
    s.beginLoop(10, () => {});
    const e = s.frameEpoch();
    s.stopLoop();
    expect(s.freshFrame(e)).toBe(false);
  });
});

describe('CameraSession — who owns the detector', () => {
  it('injecting a detector retires the one it replaces', () => {
    // A replaced detector may hold a live camera, and dropping the reference leaks it with nothing
    // left able to close it.
    const s = new CameraSession();
    const first = new StubDetector();
    const second = new StubDetector();
    s.use(first, 'web');
    s.use(second, 'web');
    expect(first.stops).toBe(1);
    expect(s.chosen).toBe(second);
    // Re-injecting the SAME detector releases it too. `use()` is a reset — it clears `device` and
    // `modelLoaded` — so leaving the camera open there reported no camera over a live lens, which
    // is the leak this whole method exists to prevent.
    s.use(second, 'web');
    expect(second.stops).toBe(1);
    expect(s.device).toBeNull();
  });

  it('replacing the detector retires its attempt, its frames and its loop', () => {
    // Stopping the old detector is not the same as saying its work is over. A frame the REPLACED
    // detector had in flight stayed `fresh` — same epoch, timer still running — so it landed as
    // part of the new detector's session, and an attempt still opening the old camera stayed
    // `current` and could install it.
    const s = new CameraSession();
    s.use(new StubDetector(), 'web');
    s.beginLoop(10, () => {});
    const attempt = s.beginAttempt();
    const frame = s.frameEpoch();
    expect(s.current(attempt)).toBe(true);
    expect(s.freshFrame(frame)).toBe(true);

    s.use(new StubDetector(), 'native');
    expect(s.current(attempt)).toBe(false);
    expect(s.freshFrame(frame)).toBe(false);
    s.close();
  });

  it('an injection beats a probe that is still in flight', async () => {
    // The panel calls useDetector() before start(), but nothing stopped a host doing it the other
    // way round — and the loser of that race was silent: the probe's detector overwrote the
    // injected one after the fact, so a test's fake, or a native host's own detector, vanished.
    let answerProbe = (): void => {};
    (globalThis as TauriGlobal).__TAURI__ = {
      core: {
        invoke: () =>
          new Promise<unknown>((res) => {
            answerProbe = () => res(false); // resolves to the web path
          }),
      },
    };
    const s = new CameraSession();
    const pending = s.ensureDetector(video, modelUrl);
    const injected = new StubDetector();
    s.use(injected, 'native');
    answerProbe();
    await expect(pending).resolves.toBe(injected);
    expect(s.chosen).toBe(injected);
    expect(s.runtime).toBe('native');
  });

  it('a probe that lands after park() is not installed on the session that left it', async () => {
    // `park()` cleared the cached PROMISE and left the CHOICE alone, so a `pickDetector` probe
    // still in flight could land afterwards and install its detector on a session that had already
    // given its one away — and `chosen` and `detectorPromise` then pointed at different objects,
    // with the loser holding a camera and a model nothing could reach to release.
    //
    // Reachable exactly as it reads: `<ai-scan-panel>` disconnects during the first probe (the
    // scan screen left before the native plugin answered) and the next mount asks again.
    const answer: ((v: unknown) => void)[] = [];
    (globalThis as TauriGlobal).__TAURI__ = {
      core: { invoke: () => new Promise<unknown>((res) => answer.push(res)) },
    };
    const s = new CameraSession();
    const first = s.ensureDetector(video, modelUrl);
    s.park(); // disconnectedCallback, with the probe still out
    const second = s.ensureDetector(video, modelUrl);
    answer[1]!(false); // the re-mount's probe lands first and wins
    const live = await second;
    expect(s.chosen).toBe(live);

    answer[0]!(false); // …and the abandoned one lands afterwards
    // The loser hands back the live detector rather than installing itself, so nothing that asks
    // this session for a detector can be given the one it gave away.
    await expect(first).resolves.toBe(live);
    expect(s.chosen).toBe(live);
    await expect(s.ensureDetector(video, modelUrl)).resolves.toBe(live);
    // Deliberately NOT parked on the way out: `parkDetector` is a page-wide slot, and a detector
    // left in it would be handed to whatever ran next in this file.
  });
});

describe('CameraSession.open', () => {
  it('falls back off a pinned camera that has gone away, keeping every other option', async () => {
    // Rebuilding the options from facingMode alone silently dropped a caller's width and height,
    // so the fallback camera opened at a resolution nobody asked for.
    const s = new CameraSession();
    const det = new StubDetector();
    det.failPinned = true;
    const token = s.beginAttempt();
    const { fellBack } = await s.open(
      det,
      { deviceId: 'gone', facingMode: 'environment', width: 1280, height: 720 },
      token,
    );
    expect(fellBack).toBe(true);
    expect(det.lastUse).toEqual({ facingMode: 'environment', width: 1280, height: 720 });
  });

  it('opens the pinned camera when it is there, and says it did not fall back', async () => {
    const s = new CameraSession();
    const det = new StubDetector();
    const token = s.beginAttempt();
    await expect(s.open(det, { deviceId: 'good' }, token)).resolves.toEqual({ fellBack: false });
    expect(det.device?.deviceId).toBe('good');
  });

  it('an attempt superseded MID-open rethrows rather than opening some other camera', async () => {
    // The attempt that superseded this one is opening its own camera. Falling back here would
    // open a THIRD one behind its back.
    //
    // MID-open since 2026-09-05: an attempt superseded before it even reaches the detector now
    // asks for no camera at all (the case below), so the supersession has to land while `use()` is
    // out — which is also the only way it happens in the app, a permission prompt answered after a
    // stop().
    const s = new CameraSession();
    const det = new GatedDetector();
    det.failPinned = true;
    const token = s.beginAttempt();
    const opening = s.open(det, { deviceId: 'gone' }, token);
    await Promise.resolve();
    expect(det.entered).toEqual(['gone']); // inside the detector before it was superseded
    s.beginAttempt();
    det.release('gone');
    await expect(opening).rejects.toThrow(/that camera is gone/);
    // No fallback open behind the newer attempt's back…
    expect(det.entered).toEqual(['gone']);
    // …and it DOES release on the way out. That is the opposite of what this asserted while opens
    // ran concurrently, and it flipped for a reason: inside the chain nothing else is running, so
    // a release here can only release what this attempt opened.
    expect(det.stops).toBe(1);
  });

  it('an open cancelled while it QUEUED asks the platform for no camera at all', async () => {
    // A queued open used to run regardless of whether its token was still current, so pressing
    // stop while one attempt sat behind another asked for a camera AFTER the user stopped the
    // scanner — a lens that flicks on and straight back off through the finally — and made the
    // attempt that IS current queue behind a permission wait nobody was waiting for.
    const s = new CameraSession();
    const det = new GatedDetector();
    const first = s.beginAttempt();
    const a = s.open(det, { deviceId: 'A' }, first);
    await Promise.resolve();
    const second = s.beginAttempt();
    const b = s.open(det, { deviceId: 'B' }, second);
    s.close(); // the user pressed stop, or the panel went away, while A's prompt was still up
    det.release('A');
    await Promise.allSettled([a, b]);
    // B never touched the platform. Before this, `entered` was ['A', 'B'].
    expect(det.entered).toEqual(['A']);
    expect(det.device).toBeNull();
    expect(s.device).toBeNull();
  });

  it('opens queue behind the ACTUAL latest, not behind a snapshot of one', async () => {
    // Three overlapping opens, settling out of order. Awaiting a SNAPSHOT of the pending open
    // serialises two and not three: with A pending, B and C both snapshot A and both start the
    // moment A settles, racing each other exactly as before. Measured on that version — arriving
    // A, B, C and settling A, C, B — the detector ended on B while C was the last one queued.
    //
    // ONE attempt token for all three, since 2026-09-05. Three `beginAttempt()`s would supersede
    // each other, and a queued open whose token is superseded now enters nothing at all — leaving
    // only A and C to order, which a snapshot barrier passes just as happily. The claim here is
    // about the CHAIN, so the tokens are held current and `device` is what discriminates: under a
    // barrier, C is released first and B lands last, so the camera ends on B.
    const s = new CameraSession();
    const det = new GatedDetector();
    const token = s.beginAttempt();
    const a = s.open(det, { deviceId: 'A' }, token);
    await Promise.resolve();
    const b = s.open(det, { deviceId: 'B' }, token);
    const c = s.open(det, { deviceId: 'C' }, token);
    await Promise.resolve();
    // Release NEWEST-first, repeatedly. Under a real chain only one open is ever inside the
    // detector, so this degenerates to arrival order and nothing can overtake. Under a snapshot
    // barrier, B and C are both inside once A settles — and this releases C before B, so the
    // detector ends on B, which is the measured failure.
    for (let i = 0; i < 6; i++) {
      det.releaseNewestFirst();
      await new Promise((r) => setTimeout(r, 1));
    }
    await Promise.allSettled([a, b, c]);
    // Only one open ran at a time, in arrival order…
    expect(det.entered).toEqual(['A', 'B', 'C']);
    // …so the last one to touch the camera is the last one queued, whatever settled when.
    expect(s.current(token)).toBe(true);
    expect(det.device?.deviceId).toBe('C');
  });

  it('a camera released mid-open stays released once the open lands', async () => {
    // `close()` stops the detector, but a `use()` already inside the detector reopens the camera
    // when it settles. The panel then reports no device over a live lens — `setPainting(true)`
    // takes exactly this path, so painting ran with the camera light on.
    const s = new CameraSession();
    const det = new GatedDetector();
    const token = s.beginAttempt();
    const opening = s.open(det, { deviceId: 'A' }, token);
    await Promise.resolve();
    s.close(); // the user switched to painting, or navigated away
    det.release('A'); // …and the open lands afterwards
    await opening.catch(() => {});
    expect(det.device).toBeNull();
    expect(s.device).toBeNull();
  });
});
