import { describe, expect, it } from 'vitest';
import { decodeTensorResponse } from '../view/native-detector.js';

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
