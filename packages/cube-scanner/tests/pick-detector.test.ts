// Which inference backend the app ends up on — the one decision that decides whether a desktop
// build runs at 1.5 ms a frame or at 400, and until now the only part of the scanner with no test
// at all. Panel tests inject a detector, so every one of them walks straight past this.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUBE_VISION, NativeDetector } from '../view/native-detector.js';
import { pickDetector } from '../view/pick-detector.js';
import { WebDetector } from '../view/web-detector.js';

/** The two getters `pickDetector` takes. Neither may be CALLED while it is choosing. */
const lazy = () => {
  const calls = { video: 0, modelUrl: 0 };
  return {
    calls,
    opts: {
      video: () => {
        calls.video++;
        return {} as HTMLVideoElement;
      },
      modelUrl: () => {
        calls.modelUrl++;
        return './vendor/cube-yolo.onnx';
      },
    },
  };
};

type TauriGlobal = { __TAURI__?: { core?: { invoke?: (cmd: string) => Promise<unknown> } } };
const withTauri = (invoke?: (cmd: string) => Promise<unknown>): void => {
  (globalThis as TauriGlobal).__TAURI__ = invoke ? { core: { invoke } } : { core: {} };
};

afterEach(() => {
  (globalThis as TauriGlobal).__TAURI__ = undefined;
  vi.restoreAllMocks();
});

describe('pickDetector', () => {
  it('picks the browser when there is no Tauri at all', async () => {
    const { calls, opts } = lazy();
    const { detector, runtime } = await pickDetector(opts);
    expect(runtime).toBe('web');
    expect(detector).toBeInstanceOf(WebDetector);
    // Lazily, both of them: the <video> does not exist until the panel has rendered, and the model
    // URL can be set by an attribute after construction, so reading either here would capture
    // whatever happened to be true at selection time.
    expect(calls).toEqual({ video: 0, modelUrl: 0 });
  });

  it('picks the browser when Tauri is present but exposes no invoke', async () => {
    withTauri(); // a shell built without withGlobalTauri, or with core unpopulated
    const { detector, runtime } = await pickDetector(lazy().opts);
    expect(runtime).toBe('web');
    expect(detector).toBeInstanceOf(WebDetector);
  });

  it('picks native when the plugin answers its probe, and asks the right command', async () => {
    const invoke = vi.fn(async () => true);
    withTauri(invoke);
    const { detector, runtime } = await pickDetector(lazy().opts);
    expect(runtime).toBe('native');
    expect(detector).toBeInstanceOf(NativeDetector);
    // The namespace is shared with NativeDetector rather than written out twice: a rename that
    // reached only one of them would leave the probe answering for commands that no longer exist.
    expect(invoke).toHaveBeenCalledWith(`${CUBE_VISION}probe`);
  });

  it('picks the browser when the plugin says no', async () => {
    withTauri(async () => false);
    expect((await pickDetector(lazy().opts)).runtime).toBe('web');
  });

  it('takes only `true` for an answer, not merely something truthy', async () => {
    // `invoke` returns `unknown` because it crosses a bridge, and every non-empty string and every
    // object is truthy. A shell that serialises its refusal, or an error object some layer returns
    // instead of rejecting, would otherwise put the app on a native path whose every command then
    // fails one frame at a time — the expensive failure, because it looks like it worked.
    for (const answer of ['false', 'no', {}, [], 1, 'true']) {
      withTauri(async () => answer);
      expect((await pickDetector(lazy().opts)).runtime).toBe('web');
    }
  });

  it('a broken plugin is a warning, and the fallback still happens', async () => {
    // The fallback is always right — every build has the browser path. The SILENCE was not: an
    // absent plugin and an installed-but-broken one produced the same nothing, so a native build
    // that had quietly demoted itself to wasm was invisible without a debugger.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noted = vi.spyOn(console, 'info').mockImplementation(() => {});
    withTauri(async () => {
      throw new Error('cube-vision: model failed to compile');
    });
    const { detector, runtime } = await pickDetector(lazy().opts);
    expect(runtime).toBe('web');
    expect(detector).toBeInstanceOf(WebDetector);
    expect(warned).toHaveBeenCalled();
    expect(noted).not.toHaveBeenCalled();
    expect(String(warned.mock.calls[0]?.[1] ?? '')).toMatch(/failed to compile/);
  });

  it('a plugin that was never registered is not a warning — that is the design', async () => {
    // The Windows and Linux desktop shells ship without this plugin on purpose, so an
    // unknown-command rejection there is the design working. Warning about it every launch is how
    // a console gets trained to be ignored, which costs exactly the warning above its audience.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noted = vi.spyOn(console, 'info').mockImplementation(() => {});
    for (const message of [
      'Command plugin:cube-vision|probe not found',
      'unknown command: plugin:cube-vision|probe',
    ]) {
      withTauri(async () => {
        throw new Error(message);
      });
      expect((await pickDetector(lazy().opts)).runtime).toBe('web');
    }
    expect(warned).not.toHaveBeenCalled();
    expect(noted).toHaveBeenCalledTimes(2);
  });

  it('a permission the capability file should have granted is LOUD, not expected absence', async () => {
    // The neighbouring wording, and the one the first version of the matcher wrongly quieted.
    // "not allowed" means the command EXISTS and is being withheld — on the platforms that ship
    // the plugin, `cube-vision:default` grants `probe`, so this is a build that has lost its
    // permissions and would fall to wasm silently forever. It is the case the branch is for.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noted = vi.spyOn(console, 'info').mockImplementation(() => {});
    withTauri(async () => {
      throw new Error('plugin:cube-vision|probe not allowed. Permissions associated with...');
    });
    expect((await pickDetector(lazy().opts)).runtime).toBe('web');
    expect(warned).toHaveBeenCalled();
    expect(noted).not.toHaveBeenCalled();
  });

  it('a "not found" about something OTHER than the command is loud', async () => {
    // The matcher tested the WORDS and not the subject, and "not found" is the commonest phrase in
    // a platform failure. So a plugin that IS installed and cannot load its native runtime, find
    // its model, or open its device was read as "no plugin on this platform" and logged at `info`
    // — a build silently demoted to wasm, hidden by the very check that exists to expose it.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noted = vi.spyOn(console, 'info').mockImplementation(() => {});
    for (const message of [
      'cube-vision: native runtime DLL not found',
      'plugin:cube-vision|probe failed: model file not found',
      'the capture device was not found',
    ]) {
      withTauri(async () => {
        throw new Error(message);
      });
      expect((await pickDetector(lazy().opts)).runtime).toBe('web');
    }
    expect(warned).toHaveBeenCalledTimes(3);
    expect(noted).not.toHaveBeenCalled();
  });

  it('a rejection it does not recognise is treated as a real failure', async () => {
    // The matcher is narrow ON PURPOSE. A wording it has not seen must land in the loud branch:
    // being told about a working build is cheap, and missing a broken one is not.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withTauri(async () => {
      throw new Error('some future tauri wording nobody predicted');
    });
    expect((await pickDetector(lazy().opts)).runtime).toBe('web');
    expect(warned).toHaveBeenCalled();
  });
});
