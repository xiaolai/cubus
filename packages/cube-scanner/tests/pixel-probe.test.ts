// The dev-only pixel probe: the switch, the throttle, and what it writes.
//
// It is instrumentation, not a feature, and the assertions are shaped by that. What matters is that
// it does NOTHING with the switch off — a probe that fired on a shipped app would post a camera
// frame to a server that is not there, on a path that runs sixteen times a second — and that what it
// writes is actually the frame, losslessly, with the boxes needed to find a sticker in it.

import { describe, expect, it, vi } from 'vitest';
import type { Detection } from '../src/onnx-postprocess.js';
import type { Frame } from '../src/types.js';
import {
  PIXEL_PROBE_CLASS,
  PIXEL_PROBE_EVERY_MS,
  PIXEL_PROBE_KEY,
  pixelProbeEnabled,
  savePixelProbe,
} from '../view/pixel-probe.js';

const det = (classId: number, confidence = 0.4): Detection => ({
  cx: 10.26,
  cy: 20.34,
  w: 8.02,
  h: 8.04,
  classId,
  confidence,
});

describe('the pixel probe switch', () => {
  it('is off unless the key says exactly "1"', () => {
    for (const value of [null, '', '0', 'true', 'yes', ' 1', '1 ']) {
      expect(pixelProbeEnabled({ getItem: () => value }), `"${String(value)}" turned it on`).toBe(
        false,
      );
    }
    expect(pixelProbeEnabled({ getItem: () => '1' })).toBe(true);
  });

  it('is off, rather than throwing, where storage itself throws', () => {
    // A page with storage disabled throws on ACCESS, not on read — and a probe that took the scan
    // loop down with it would be a debugging tool that broke the thing being debugged.
    expect(
      pixelProbeEnabled({
        getItem: () => {
          throw new Error('storage is disabled');
        },
      }),
    ).toBe(false);
  });

  it('states the class it hunts and the gap it leaves, because both are the instrument', () => {
    // Pinned so a change to either is a change somebody made on purpose: the class decides which
    // question is being asked, and the gap is what keeps a 1.2 MB-a-frame probe from becoming a
    // gigabyte a minute on a loop running at sixteen frames a second.
    expect(PIXEL_PROBE_CLASS).toBe(0); // white
    expect(PIXEL_PROBE_EVERY_MS).toBe(3_000);
    expect(PIXEL_PROBE_KEY).toBe('cubusScanPixels');
  });
});

/**
 * A stand-in for the platform's canvas.
 *
 * NODE HAS NO `OffscreenCanvas`, so the real encoder cannot run here and these cases do not pretend
 * to test it — PNG encoding is the platform's, and asserting it against a fake would assert the
 * fake. What IS this module's own and is tested here: that the frame reaches `putImageData`
 * unchanged, that the bytes the encoder returns survive base64 in order and in full (the chunking
 * exists because `String.fromCharCode(...bytes)` overflows on a whole frame), and that the body
 * carries the boxes beside the picture.
 */
class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

function fakeCanvas(bytes: Uint8Array) {
  const drawn: { width: number; height: number; data: Uint8ClampedArray }[] = [];
  class FakeOffscreenCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext() {
      return {
        putImageData: (img: { data: Uint8ClampedArray; width: number; height: number }) => {
          drawn.push({ width: img.width, height: img.height, data: img.data });
        },
      };
    }
    async convertToBlob({ type }: { type: string }) {
      return { type, arrayBuffer: async () => bytes.buffer.slice(0) };
    }
  }
  return { FakeOffscreenCanvas, drawn };
}

describe('what the probe writes', () => {
  /** A 2×2 frame with four known pixels, so the PNG can be checked for being LOSSLESS. */
  const frame = (): Frame => ({
    data: new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 255, 255, 12, 34, 56, 255, 255, 255, 255, 255,
    ]),
    width: 2,
    height: 2,
  });

  it('posts the frame and its boxes to the dev sink, and nowhere else', async () => {
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    // A byte run long enough to cross the 0x8000 chunk boundary the base64 loop exists for.
    const bytes = new Uint8Array(0x8000 + 5);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes[bytes.length - 1] = 99;
    const { FakeOffscreenCanvas, drawn } = fakeCanvas(bytes);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true };
    });
    try {
      await savePixelProbe(frame(), [det(PIXEL_PROBE_CLASS), det(3, 0.91)]);
    } finally {
      vi.unstubAllGlobals();
    }

    // The frame reached the canvas unchanged — a probe that drew something else would answer the
    // question with a picture the camera never produced.
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.width).toBe(2);
    expect([...drawn[0]!.data]).toEqual([...frame().data]);

    expect(posts, 'the probe posted more than once for one frame').toHaveLength(1);
    const { url, body } = posts[0]!;
    expect(url).toBe('/__record');
    expect(body.kind).toBe('pixel-probe');
    expect(body.width).toBe(2);
    expect(body.height).toBe(2);
    expect(body.hunting).toBe(PIXEL_PROBE_CLASS);
    // The boxes travel with the picture, or a sticker cannot be found in it afterwards — which is
    // the whole purpose. Rounded, because the question is where a sticker is, not where it is to
    // the tenth of a millionth of a pixel.
    expect(body.boxes).toEqual([
      { cx: 10.3, cy: 20.3, w: 8, h: 8, cls: 0, conf: 0.4 },
      { cx: 10.3, cy: 20.3, w: 8, h: 8, cls: 3, conf: 0.91 },
    ]);
    // Every byte the encoder produced, in order, across the chunk boundary.
    const back = Uint8Array.from(atob(body.png as string), (c) => c.charCodeAt(0));
    expect(back.length).toBe(bytes.length);
    expect([...back.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(back[back.length - 1]).toBe(99);
  });

  it('asks the platform for a LOSSLESS format, because exact pixel values are the question', async () => {
    // A JPEG would answer it with values the camera never produced. What this module controls is
    // the request; the encoding itself is the platform's.
    let asked = '';
    const { FakeOffscreenCanvas } = fakeCanvas(new Uint8Array([1, 2, 3]));
    class Watching extends FakeOffscreenCanvas {
      override async convertToBlob(opts: { type: string }) {
        asked = opts.type;
        return super.convertToBlob(opts);
      }
    }
    vi.stubGlobal('OffscreenCanvas', Watching);
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('fetch', async () => ({ ok: true }));
    try {
      await savePixelProbe(frame(), [det(PIXEL_PROBE_CLASS)]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(asked).toBe('image/png');
  });

  it('writes nothing at all where the runtime cannot encode one', async () => {
    // Node without `OffscreenCanvas`, and any webview old enough to lack it: the probe declines
    // rather than posting a body with no picture in it, which would look like a saved frame.
    const had = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    let posted = 0;
    vi.stubGlobal('fetch', async () => {
      posted += 1;
      return { ok: true };
    });
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined;
    try {
      await savePixelProbe(frame(), [det(PIXEL_PROBE_CLASS)]);
    } finally {
      (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = had;
      vi.unstubAllGlobals();
    }
    expect(posted, 'it posted a frame it could not encode').toBe(0);
  });
});
