// @vitest-environment happy-dom
//
// ONE DETECTOR PER PAGE, and therefore one InferenceSession — the leak, and the rule that closes it.
//
// Every visit to the scan screen replaced `stage.innerHTML`, so the old `<ai-scan-panel>` was
// discarded and a new one built. Nothing released the old panel's detector, and nothing could:
// `dispose()` ran only when a detector was REPLACED by an injection or lost a probe race, so a
// discarded one kept its wasm heap or its GPU device for the life of the page, and every visit
// added another plus a 1–5 s model load.
//
// The fix is the rule `<cubus-cube>` already applies to the WebGL context: park one between
// renders. These tests pin both halves of it — that a re-mount REUSES the parked detector, and that
// what may be parked is only what came from `pickDetector` (an injected fake belongs to its caller
// and must never reach a page-wide slot).

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CameraDevice, CameraOptions } from '../src/camera.js';
import type { Detector, ModelOutput } from '../src/detector.js';
import { AiScanPanel } from '../view/ai-scan-panel.js';
import { CameraSession } from '../view/camera-session.js';
import { CUBE_VISION, NativeDetector } from '../view/native-detector.js';
import { disposeParkedDetector, parkedDetector, pickDetector } from '../view/pick-detector.js';
import { WebDetector } from '../view/web-detector.js';

/**
 * A model URL whose directory holds `ort.mjs` — see tests/fixtures/ort.mjs.
 *
 * Built through `pathToFileURL` rather than `new URL(..., import.meta.url)`, because under
 * happy-dom the global `URL` resolves against the document (`http://localhost:3000/`) and hands
 * back an http address for a file on disk — which the ESM loader then refuses.
 */
const MODEL_URL = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'model.onnx'),
).href;

interface FakeInstance {
  sessions: number;
  released: number;
}
const registry = (): { instances: FakeInstance[] } =>
  (globalThis as { __fakeOrt?: { instances: FakeInstance[] } }).__fakeOrt ?? { instances: [] };
/** Every InferenceSession the fake runtime has been asked to create, across every module. */
const sessions = (): number => registry().instances.reduce((n, i) => n + i.sessions, 0);

/** A video element per owner, so "which panel is this detector driving" is observable. */
const videoFor = (id: string): (() => HTMLVideoElement) => {
  const el = document.createElement('video');
  el.id = id;
  return () => el;
};

type TauriGlobal = { __TAURI__?: { core?: { invoke?: (cmd: string) => Promise<unknown> } } };

/** A cube-vision plugin that answers everything, and counts what it was asked. */
function fakePlugin(): { calls: string[]; invoke: (cmd: string) => Promise<unknown> } {
  const calls: string[] = [];
  const invoke = async (cmd: string): Promise<unknown> => {
    calls.push(cmd.replace(CUBE_VISION, ''));
    if (cmd === `${CUBE_VISION}probe`) return true;
    if (cmd === `${CUBE_VISION}current_camera`) {
      return { deviceId: 'native-0', label: 'Native Camera' } satisfies CameraDevice;
    }
    if (cmd === `${CUBE_VISION}list_cameras`) return [];
    return null;
  };
  return { calls, invoke };
}

/**
 * Zero the fake runtime's counters, keeping the registry OBJECT.
 *
 * Replacing it — the obvious way — silently breaks every count in this file: a module is evaluated
 * once per URL for the life of the process, so its `instance` was pushed onto the registry that
 * existed then, and a fresh registry is an empty array the fake never writes to again. Every
 * session count would read zero and every assertion here would pass about nothing.
 */
beforeEach(() => {
  const g = globalThis as { __fakeOrt?: { instances: FakeInstance[]; nextRunMs: number } };
  g.__fakeOrt ??= { instances: [], nextRunMs: 0 };
  for (const i of g.__fakeOrt.instances) {
    i.sessions = 0;
    i.released = 0;
  }
});

/** `dispose()` is fire-and-forget by contract, so a release lands a microtask later. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** How many sessions the fake runtime has been asked to release. */
const released = (): number => registry().instances.reduce((n, i) => n + i.released, 0);

afterEach(() => {
  disposeParkedDetector();
  (globalThis as TauriGlobal).__TAURI__ = undefined;
  vi.restoreAllMocks();
});

describe('the page-level detector park', () => {
  it('two mounts share one detector, and therefore build one InferenceSession', async () => {
    // THE LEAK, in the smallest form that shows it. Two sessions in sequence is exactly what a
    // screen swap does — the old panel disconnects, the new one connects — and before parking each
    // built its own WebDetector, its own runner and its own session, with the first unreachable
    // for the life of the page.
    const first = new CameraSession();
    const a = await first.ensureDetector(videoFor('a'), () => MODEL_URL);
    await a.load();
    expect(sessions()).toBe(1);
    first.park();

    const second = new CameraSession();
    const b = await second.ensureDetector(videoFor('b'), () => MODEL_URL);
    await b.load();

    expect(b).toBe(a); // the same object, not merely an equivalent one
    expect(sessions()).toBe(1); // …and no second session was ever created
    await flush();
    expect(released()).toBe(0); // nor built-and-thrown-away
    second.park();
  });

  it('a parked detector arrives already loaded, so the re-mount does not report loading', async () => {
    const first = new CameraSession();
    const a = await first.ensureDetector(videoFor('a'), () => MODEL_URL);
    await a.load();
    first.modelLoaded = true;
    first.park();

    const second = new CameraSession();
    await second.ensureDetector(videoFor('b'), () => MODEL_URL);
    expect(second.modelLoaded).toBe(true);
  });

  it('parking releases the CAMERA and keeps the model', async () => {
    // The whole distinction `stop()` and `dispose()` exist to draw. Parking may cost a lens left
    // on if it gets this wrong, and may never cost the compiled model — that is the point of it.
    const session = new CameraSession();
    const detector = await session.ensureDetector(videoFor('a'), () => MODEL_URL);
    await detector.load();
    const stop = vi.spyOn(detector, 'stop');
    const dispose = vi.spyOn(detector as Required<Detector>, 'dispose');
    session.park();
    expect(stop).toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(parkedDetector()?.detector).toBe(detector);
  });

  it('is re-pointed at the new owner’s video, never left driving the old one', async () => {
    // A `<video>` in a disconnected shadow root is a camera nobody can see. The getters are
    // captured at construction, so reuse without `retarget` would have opened the second panel's
    // stream into the first panel's detached element — a scan that works everywhere but on screen.
    const first = new CameraSession();
    const detector = (await first.ensureDetector(videoFor('a'), () => MODEL_URL)) as WebDetector;
    first.park();
    const second = new CameraSession();
    await second.ensureDetector(videoFor('b'), () => MODEL_URL);
    const seen = (detector as unknown as { video: () => HTMLVideoElement }).video();
    expect(seen.id).toBe('b');
    second.park();
  });

  it('lends exactly one: a second live owner gets its own, and it is disposed on the way back', async () => {
    // The `<cubus-cube>` rule in full — "a detached, unparked cube releases itself, because a quiet
    // GL-context leak is worse than a rebuild". Two panels alive at once must not fight over one
    // camera, so the second builds its own; and that one must not simply be dropped either.
    const first = new CameraSession();
    const second = new CameraSession();
    const a = await first.ensureDetector(videoFor('a'), () => MODEL_URL);
    const b = await second.ensureDetector(videoFor('b'), () => MODEL_URL);
    expect(b).not.toBe(a);

    await a.load();
    await b.load();
    expect(sessions()).toBe(2);

    first.park();
    second.park(); // the slot is taken, so this one is released rather than kept
    expect(parkedDetector()?.detector).toBe(a);
    await flush();
    expect(released()).toBe(1);
  });

  it('never parks an injected detector', async () => {
    // `useDetector` is the test seam and the native host's. A fake reaching a page-wide slot would
    // be handed to the next mount — a suite that passes alone and fails in a file, and a host whose
    // scanner is quietly driven by somebody else's object.
    const fake: Detector = {
      device: null,
      async use(_opts?: CameraOptions) {},
      async load() {},
      async next(): Promise<ModelOutput | null> {
        return null;
      },
      async cameras() {
        return [];
      },
      stop() {},
    };
    const session = new CameraSession();
    session.use(fake, 'web');
    session.park();
    expect(parkedDetector()).toBeNull();
  });

  it('disposeParkedDetector gives the model back', async () => {
    const session = new CameraSession();
    const detector = await session.ensureDetector(videoFor('a'), () => MODEL_URL);
    await detector.load();
    session.park();
    disposeParkedDetector();
    expect(parkedDetector()).toBeNull();
    await flush();
    expect(released()).toBe(1);
  });
});

describe('the park, driven through <ai-scan-panel>', () => {
  it('a re-mounted panel reuses the page’s detector and does not load the model again', async () => {
    // The native plugin, because it makes both claims observable in one list of commands: the probe
    // runs once, and `load_model` — minutes of CoreML/LiteRT compilation on a cold cache — runs
    // once across two visits to the scan screen.
    const plugin = fakePlugin();
    (globalThis as TauriGlobal).__TAURI__ = { core: { invoke: plugin.invoke } };

    const first = new AiScanPanel();
    first.setAttribute('headless', '');
    document.body.appendChild(first);
    await first.start();
    expect(plugin.calls.filter((c) => c === 'load_model')).toHaveLength(1);
    const detector = parkedDetector();
    expect(detector).toBeNull(); // lent out while the panel is alive

    first.remove();
    expect(parkedDetector()?.detector).toBeInstanceOf(NativeDetector);
    const kept = parkedDetector()?.detector;

    const second = new AiScanPanel();
    second.setAttribute('headless', '');
    document.body.appendChild(second);
    await second.start();
    second.remove();

    expect(parkedDetector()?.detector).toBe(kept);
    expect(plugin.calls.filter((c) => c === 'probe')).toHaveLength(1);
    expect(plugin.calls.filter((c) => c === 'load_model')).toHaveLength(1);
  });

  it('a removed panel leaves no camera open', async () => {
    const plugin = fakePlugin();
    (globalThis as TauriGlobal).__TAURI__ = { core: { invoke: plugin.invoke } };
    const panel = new AiScanPanel();
    panel.setAttribute('headless', '');
    document.body.appendChild(panel);
    await panel.start();
    panel.remove();
    expect(parkedDetector()?.detector.device).toBeNull();
    expect(plugin.calls).toContain('close_camera');
  });
});

describe('pickDetector', () => {
  it('does not re-probe for a parked detector', async () => {
    // The probe crosses the Tauri bridge, and which runtime a BUILD has cannot change between two
    // mounts of the same element on the same page.
    const plugin = fakePlugin();
    (globalThis as TauriGlobal).__TAURI__ = { core: { invoke: plugin.invoke } };
    const chosen = await pickDetector({ video: videoFor('a'), modelUrl: () => MODEL_URL });
    expect(chosen.runtime).toBe('native');
    chosen.detector.stop();
    // Park it by hand, as a session would.
    const session = new CameraSession();
    await session.ensureDetector(videoFor('b'), () => MODEL_URL);
    session.park();
    await pickDetector({ video: videoFor('c'), modelUrl: () => MODEL_URL });
    expect(plugin.calls.filter((c) => c === 'probe')).toHaveLength(2);
  });
});

/** The fixture runtime really is being loaded, or every session count above is about nothing. */
it('the fixture runtime is what the detector loaded', async () => {
  const session = new CameraSession();
  const detector = await session.ensureDetector(videoFor('a'), () => MODEL_URL);
  await detector.load();
  expect(detector).toBeInstanceOf(WebDetector);
  expect(detector.providers).toEqual(['wasm']);
  expect(fileURLToPath(MODEL_URL)).toMatch(/fixtures[/\\]model\.onnx$/);
  session.park();
});
