import { describe, expect, it, vi } from 'vitest';
import { fitFromOutput } from '../src/onnx-detect.js';
import { CUBE_VISION, decodeTensorResponse, NativeDetector } from '../view/native-detector.js';

// The wire format the cube-vision plugin returns over the Tauri bridge — int32 rows, int32 anchors
// (little-endian), then rows*anchors f32. This is the TS half of the contract; the Rust half is
// `tensor_response` in crates/cube-vision/src/apple.rs, and the two must agree byte for byte or the
// native scan reads garbage. The Swift-through-CoreML parity is proven separately by the golden
// harness's `native` leg; this pins the decode so a change to either side is caught here.

function encode(rows: number, anchors: number, values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + values.length * 4);
  const head = new Int32Array(buf, 0, 2);
  head[0] = rows;
  head[1] = anchors;
  new Float32Array(buf, 8).set(values);
  return buf;
}

describe('decodeTensorResponse', () => {
  it('reads rows*anchors floats after the header', () => {
    const out = decodeTensorResponse(encode(2, 3, [1, 2, 3, 4, 5, 6]));
    expect(out).not.toBeNull();
    expect(out?.anchors).toBe(3);
    expect(Array.from(out!.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('treats a zero-anchor header as "no frame yet" (null), so an idle tick is not an error', () => {
    expect(decodeTensorResponse(encode(0, 0, []))).toBeNull();
  });

  it('treats a truncated response (< the 8-byte header) as null rather than throwing', () => {
    expect(decodeTensorResponse(new ArrayBuffer(4))).toBeNull();
  });

  it('fails loud on a header that promises more floats than the buffer holds', () => {
    // A short/corrupt response means the two sides of the bridge disagreed; throwing beats reading
    // past the buffer or silently returning a truncated tensor the decoder would misread.
    const buf = new ArrayBuffer(8 + 2 * 4); // header says 2×3 = 6 floats, only 2 present
    const head = new Int32Array(buf, 0, 2);
    head[0] = 2;
    head[1] = 3;
    expect(() => decodeTensorResponse(buf)).toThrow(/tensor is \d+ bytes/);
  });

  it('exposes the anchors count decodeDetections needs, matching the header', () => {
    const anchors = 8400;
    const out = decodeTensorResponse(encode(10, anchors, new Array(10 * anchors).fill(0)));
    expect(out?.anchors).toBe(anchors);
    expect(out?.data.length).toBe(10 * anchors);
  });
});

describe('decodeTensorResponse — the Android shape', () => {
  /** The same bytes the Apple path returns raw, as the base64 string Android must send instead. */
  const asBase64 = (buf: ArrayBuffer): string => {
    const b = new Uint8Array(buf);
    let s = '';
    for (const byte of b) s += String.fromCharCode(byte);
    return btoa(s);
  };

  it('reads a base64 tensor identically to the raw buffer', () => {
    // Tauri's Android plugin API is JSON only, so Kotlin cannot return an ArrayBuffer and encodes
    // instead. Both shapes have to decode to the same thing or the two native platforms disagree
    // about what the model said — with everything downstream written against one tensor.
    const buf = encode(2, 3, [1, 2, 3, 4, 5, 6]);
    const raw = decodeTensorResponse(buf);
    const viaString = decodeTensorResponse(asBase64(buf));
    expect(viaString?.anchors).toBe(raw?.anchors);
    expect(Array.from(viaString!.data)).toEqual(Array.from(raw!.data));
  });

  it('treats the empty string as "no frame yet", not as a malformed tensor', () => {
    // Android's way of saying the camera is open but has produced nothing — the same null the
    // Apple path expresses with a short buffer, and what the panel skips a tick on. Throwing here
    // would turn a warm-up into a scanner that looks broken.
    expect(decodeTensorResponse('')).toBeNull();
  });
});

describe('NativeDetector — stop() cancels a pending use()', () => {
  /** An `invoke` whose `open_camera` blocks until released, so a stop can land inside `use()`. */
  function bridge() {
    const calls: string[] = [];
    let openGate = (): void => {};
    const invoke = async (cmd: string): Promise<unknown> => {
      calls.push(cmd.replace('plugin:cube-vision|', ''));
      if (cmd.endsWith('open_camera')) {
        await new Promise<void>((r) => {
          openGate = r;
        });
      }
      if (cmd.endsWith('current_camera')) return { deviceId: 'native-1', label: 'Native' };
      return null;
    };
    return { calls, invoke, finishOpen: () => openGate() };
  }

  it('rejects with AbortError and does not install the camera', async () => {
    // `Detector.use` documents this, and `WebDetector` has always honoured it — so callers were
    // written against a contract only one implementation kept. This one used to resume after a
    // stop() and set `device` again, reopening a camera the caller had released; on the panel's
    // painting path that left the lens on while the app reported no camera.
    const b = bridge();
    const det = new NativeDetector(b.invoke);
    const opening = det.use({});
    det.stop();
    b.finishOpen();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(det.device).toBeNull();
    // And it closes what it abandoned rather than leaving the plugin holding a camera nobody has.
    expect(b.calls.filter((c) => c === 'close_camera').length).toBeGreaterThanOrEqual(2);
    // It never asked which camera opened — the attempt was over before that mattered.
    expect(b.calls).not.toContain('current_camera');
  });

  it('an uninterrupted open still installs the camera', async () => {
    const b = bridge();
    const det = new NativeDetector(b.invoke);
    const opening = det.use({});
    b.finishOpen();
    await opening;
    expect(det.device).toEqual({ deviceId: 'native-1', label: 'Native' });
  });
});

describe('NativeDetector — the one camera, and the order the plugin sees', () => {
  /** Drain the microtasks a fire-and-forget close is issued through. */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const short = (cmd: string): string => cmd.replace(CUBE_VISION, '');

  it('does not let a close land after the open that replaced it', async () => {
    // THE ORDERING THE CLAIM RULE ASSUMES AND NOTHING ENFORCED. `cameraClaim` is taken when an open
    // is ISSUED "because the issue order is the order the plugin sees" — true of two awaited calls,
    // and false of the one call this class makes fire-and-forget. Tauri runs each command as its
    // own task, so a `close_camera` issued before a newer `open_camera` could execute after it, and
    // the lens then goes out under an owner whose panel reports a live camera. The park makes two
    // detectors over one plugin-owned camera ordinary, which is what makes this reachable.
    const trace: string[] = [];
    let openClose = (): void => {};
    let slowClose = true; // only the FIRST close is held; the teardown's must not hang the file
    const invoke = async (cmd: string): Promise<unknown> => {
      const name = short(cmd);
      trace.push(`${name}:start`);
      if (name === 'close_camera' && slowClose) {
        slowClose = false;
        await new Promise<void>((release) => {
          openClose = release;
        });
      }
      trace.push(`${name}:end`);
      return name === 'current_camera' ? { deviceId: 'native-1', label: 'Native' } : null;
    };

    const outgoing = new NativeDetector(invoke);
    await outgoing.use({});
    outgoing.stop(); // the close goes out, and the plugin is slow to run it
    await Promise.resolve();
    expect(trace).toContain('close_camera:start');

    const opens = (): number => trace.filter((t) => t === 'open_camera:start').length;
    expect(opens()).toBe(1); // the outgoing detector's own

    const incoming = new NativeDetector(invoke);
    const opening = incoming.use({});
    await flush();
    // Nothing was asked to open while a close was still in flight. Before this the second open
    // went out at once and the two raced inside the plugin.
    expect(opens()).toBe(1);

    openClose();
    await opening;
    expect(opens()).toBe(2);
    expect(trace.indexOf('close_camera:end')).toBeLessThan(trace.lastIndexOf('open_camera:start'));
    expect(incoming.device).toEqual({ deviceId: 'native-1', label: 'Native' });
    incoming.stop();
    await flush();
  });

  it('opens nothing for an attempt stopped while it waited for that close', async () => {
    // The wait is a new place an attempt can die, and `Detector.use` already says what must happen
    // there: a `stop()` while the open is pending releases the camera and rejects. Asking the
    // platform for a camera after the user stopped the scanner is the lens that flicks on and
    // straight back off — the same fault the queued-open guard in `CameraSession` exists for.
    const trace: string[] = [];
    let openClose = (): void => {};
    let slowClose = true;
    const invoke = async (cmd: string): Promise<unknown> => {
      const name = short(cmd);
      trace.push(name);
      if (name === 'close_camera' && slowClose) {
        slowClose = false;
        await new Promise<void>((release) => {
          openClose = release;
        });
      }
      return name === 'current_camera' ? { deviceId: 'native-1', label: 'Native' } : null;
    };

    const outgoing = new NativeDetector(invoke);
    await outgoing.use({});
    outgoing.stop();
    await Promise.resolve();

    const incoming = new NativeDetector(invoke);
    const opening = incoming.use({});
    incoming.stop(); // the user stopped the scanner while the close was still crossing
    openClose();

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(trace.filter((c) => c === 'open_camera')).toHaveLength(1); // the outgoing one, and no more
    expect(incoming.device).toBeNull();
  });

  it('closes the camera it opened when the metadata read fails', async () => {
    // The one call between opening the camera and installing it. Only the READ failed, so the lens
    // is on — and `use()` rejected with `device` null, which is the panel reporting no camera over
    // a live one, with no handle anywhere able to release it.
    const trace: string[] = [];
    const invoke = async (cmd: string): Promise<unknown> => {
      const name = short(cmd);
      trace.push(name);
      if (name === 'current_camera') throw new Error('the camera went away mid-open');
      return null;
    };
    const det = new NativeDetector(invoke);
    await expect(det.use({})).rejects.toThrow(/went away/);
    expect(det.device).toBeNull();
    await flush();
    expect(trace).toEqual(['open_camera', 'current_camera', 'close_camera']);
  });

  it('gives the claim back when the open itself fails', async () => {
    // A claim taken on the way in and held by an attempt that never opened anything refuses every
    // later `stop()` the right to close the camera — the guard turned into a wedge.
    const trace: string[] = [];
    const invoke = async (cmd: string): Promise<unknown> => {
      const name = short(cmd);
      trace.push(name);
      if (name === 'open_camera') throw new Error('no camera on this machine');
      return null;
    };
    const det = new NativeDetector(invoke);
    await expect(det.use({})).rejects.toThrow(/no camera/);
    const other = new NativeDetector(invoke);
    other.stop();
    await flush();
    expect(trace.filter((c) => c === 'close_camera')).toHaveLength(1);
  });

  it('says so when the camera will not close, and leaves it closable', async () => {
    // Swallowed under the note that "the camera closes a tick later", which nothing implements:
    // nothing retries, so a rejected close is a lens left on for the life of the process with no
    // error anywhere. The claim IS given back, so the next close can succeed — a recovery worth
    // nothing unless somebody knows to look.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const trace: string[] = [];
      let refuse = true;
      const invoke = async (cmd: string): Promise<unknown> => {
        const name = short(cmd);
        trace.push(name);
        if (name === 'close_camera' && refuse) {
          refuse = false;
          throw new Error('the plugin refused to close the camera');
        }
        return name === 'current_camera' ? { deviceId: 'native-1', label: 'Native' } : null;
      };
      const det = new NativeDetector(invoke);
      await det.use({});
      det.stop();
      await flush();
      expect(warned).toHaveBeenCalled();
      expect(String(warned.mock.calls[0]?.[0] ?? '')).toMatch(/did not close/);

      // …and the camera is still closable by whoever comes next.
      const other = new NativeDetector(invoke);
      other.stop();
      await flush();
      expect(trace.filter((c) => c === 'close_camera')).toHaveLength(2);
    } finally {
      warned.mockRestore();
    }
  });
});

describe('the row count reaches the shared seam, so the native path is checked too', () => {
  // WHAT WAS MISSING. `validatedRun` has refused a head that is not `[1, 10, anchors]` since
  // 515002d — but that lives in the BROWSER runtime, and the native plugin never passes through it.
  // The plugin's own decode read `rows` out of the header, used it for one length check and threw
  // it away, so the one runtime that crosses a bridge was the one runtime with no assertion that
  // the tensor is this model's detect head. A re-exported or transposed model would have been
  // decoded off stale offsets: not an error anywhere, just a cube nobody held.
  it('carries rows through the decode', () => {
    expect(decodeTensorResponse(encode(10, 2, new Array(20).fill(0)))?.rows).toBe(10);
  });

  it('refuses a transposed header at fitFromOutput', () => {
    // `[8400, 10]` instead of `[10, 8400]` — a positive anchor count, a buffer of exactly the right
    // length, and every value in the wrong place.
    const out = decodeTensorResponse(encode(20, 10, new Array(200).fill(0)));
    expect(out).not.toBeNull();
    expect(() => fitFromOutput(out!)).toThrow(/transpose of a detect head/);
  });

  it('refuses a head with the wrong number of classes, facing the right way', () => {
    const out = decodeTensorResponse(encode(9, 40, new Array(360).fill(0)));
    expect(() => fitFromOutput(out!)).toThrow(/9 rows, not the 10/);
  });

  it('accepts the shape the plugin really produces', () => {
    const out = decodeTensorResponse(encode(10, 40, new Array(400).fill(0)));
    expect(fitFromOutput(out!)).toEqual({ ok: false, reason: 'NO_FACE' });
  });
});
