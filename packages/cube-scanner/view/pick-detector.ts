import type { Detector } from '../src/detector.js';
import { type Invoke, NativeDetector } from './native-detector.js';
import { WebDetector } from './web-detector.js';

/** Which inference backend a panel ended up on. */
export type ScanRuntime = 'native' | 'web';

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: Invoke } };
}

/**
 * Choose the inference backend: the native plugin if it answers, the browser otherwise.
 *
 * Separated from the panel because the choice needs nothing the panel has except two getters, and
 * mixing it in made a 900-line class one function longer for no reason. Everything else in the
 * camera lifecycle reports progress, draws buttons and consults scan state; this only answers a
 * question and hands back an object.
 *
 * The ONLY requirement for the native path is that the plugin answers its probe. It resolves its
 * own model, so no JS path API is involved — depending on one is what used to drop the desktop app
 * silently onto the wasm runtime.
 *
 * The getters are lazy on purpose. The video element does not exist until the panel has rendered,
 * and the model URL can be set by an attribute after construction, so taking either by value here
 * would capture whatever happened to be true at selection time.
 */
export async function pickDetector(opts: {
  video: () => HTMLVideoElement;
  modelUrl: () => string;
}): Promise<{ detector: Detector; runtime: ScanRuntime }> {
  const invoke = (globalThis as TauriGlobal).__TAURI__?.core?.invoke;
  if (invoke) {
    try {
      if (await invoke('plugin:cube-vision|probe')) {
        return { detector: new NativeDetector(invoke), runtime: 'native' };
      }
    } catch {
      // Plugin absent or errored — fall through to the browser path, which every build has.
    }
  }
  return { detector: new WebDetector(opts.video, opts.modelUrl), runtime: 'web' };
}
