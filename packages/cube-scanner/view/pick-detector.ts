import type { Detector } from '../src/detector.js';
import { CUBE_VISION, type Invoke, NativeDetector } from './native-detector.js';
import { WebDetector } from './web-detector.js';

/** Which inference backend a panel ended up on. */
export type ScanRuntime = 'native' | 'web';

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: Invoke } };
}

/**
 * Is this rejection just "there is no such command here"?
 *
 * Tauri rejects an unregistered command with a string naming it, and that — the plugin simply not
 * being in this build — is the only quiet case.
 *
 * `not allowed` is deliberately NOT here, though it is the neighbouring wording and the first
 * version of this matched it. It means the command EXISTS and the capability file withholds it,
 * which on the platforms that ship the plugin is a broken configuration, not an unsupported
 * platform: `cube-vision:default` grants `probe`, so a build that gets this has lost its
 * permissions and would fall silently to wasm forever. Quieting it would hide exactly the failure
 * this branch exists to surface.
 *
 * Deliberately narrow for the same reason: a wording this does not recognise is treated as a real
 * failure, so the worst a future Tauri release can do is make a working build noisy.
 */
function absentCommand(err: unknown): boolean {
  const text = typeof err === 'string' ? err : ((err as Error)?.message ?? '');
  return /not found|unknown command/i.test(text);
}

/**
 * Choose the inference backend: the native plugin if it answers, the browser otherwise.
 *
 * Separated from the panel because the choice needs nothing the panel has except two getters, and
 * mixing it in made a 900-line class one function longer for no reason. Everything else in the
 * camera lifecycle reports progress, draws buttons and consults scan state; this only answers a
 * question and hands back an object.
 *
 * The ONLY requirement for the native path is that the plugin answers its probe with `true`. It
 * resolves its own model, so no JS path API is involved — depending on one is what used to drop the
 * desktop app silently onto the wasm runtime.
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
      // `=== true`, not truthiness. `invoke` is typed to return `unknown` because it crosses a
      // bridge, and every non-empty string and every object is truthy — so a plugin answering
      // "false", or an error object some shell serialises instead of rejecting, would put the app
      // on a native path whose commands then fail one frame at a time. Only the one answer the
      // plugin promises counts as yes.
      if ((await invoke(`${CUBE_VISION}probe`)) === true) {
        return { detector: new NativeDetector(invoke), runtime: 'native' };
      }
    } catch (err) {
      // The browser path is what every build has, so falling through is always right. But
      // "no plugin on this platform" and "the plugin is installed and broken" used to be the same
      // silence, and this project's rule is fail loud: a native build that has quietly demoted
      // itself to wasm has to be findable without a debugger. The user sees nothing either way —
      // the scan still works, just slower.
      //
      // The two get different volumes, because they are different facts. The Windows and Linux
      // desktop shells deliberately ship WITHOUT this plugin, so an unknown-command rejection
      // there is the design working, and warning about it on every launch would teach whoever
      // reads that console to skip the line that matters. Anything else — a registered plugin
      // that threw, a permission the capability file was supposed to grant — is the case worth
      // shouting about, so it stays a warning. See `absentCommand` for where the line is.
      (absentCommand(err) ? console.info : console.warn)(
        `[cubus] no native cube-vision runtime — using the browser one${absentCommand(err) ? '' : ' after an unexpected failure'}`,
        err,
      );
    }
  }
  return { detector: new WebDetector(opts.video, opts.modelUrl), runtime: 'web' };
}
