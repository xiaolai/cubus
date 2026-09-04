import { describe, expect, it } from 'vitest';
import { fitFromOutput } from '../src/onnx-detect.js';
import { NativeDetector, decodeTensorResponse } from '../view/native-detector.js';

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
