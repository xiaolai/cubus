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
  cropFor,
  PIXEL_PROBE_EVERY_MS,
  PIXEL_PROBE_KEY,
  PIXEL_PROBE_MAX_FRAMES,
  PIXEL_PROBE_MAX_SIDE,
  PIXEL_PROBE_MIN_NEIGHBOURS,
  pixelProbeEnabled,
  resetPixelProbe,
  savePixelProbe,
} from '../view/pixel-probe.js';

/** A box that sits inside the 2×2 fixture below, so the crop is the whole of it. */
const inFrame = (classId: number, confidence = 0.4): Detection => ({
  cx: 1,
  cy: 1,
  w: 2,
  h: 2,
  classId,
  confidence,
});

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
    expect(PIXEL_PROBE_MIN_NEIGHBOURS).toBe(6);
    expect(PIXEL_PROBE_EVERY_MS).toBe(3_000);
    expect(PIXEL_PROBE_KEY).toBe('cubusScanPixels');
    expect(PIXEL_PROBE_MAX_FRAMES).toBe(40);
    expect(PIXEL_PROBE_MAX_SIDE).toBe(640);
  });
});

describe('the crop, which is what makes this affordable', () => {
  // THE BOUND THAT WAS MISSING. The first version saved the whole frame: 4 MB a shot on a 1920×1080
  // camera, 245 MB in one session, and the page's own thread doing a 3 MB base64 encode every three
  // seconds — `inferMs` peaked at 608 ms against a 20 ms median and the scan halved in rate. The
  // question was only ever about the pixels ON a sticker, which a crop answers in a fortieth of the
  // bytes.
  const frame = (w: number, h: number): Frame => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  });

  it('covers the boxes with a margin, and never leaves the frame', () => {
    const c = cropFor(frame(1920, 1080), [
      { ...det(0), cx: 900, cy: 500, w: 40, h: 40 },
      { ...det(0), cx: 1000, cy: 600, w: 40, h: 40 },
    ]);
    expect(c.x).toBeLessThanOrEqual(880);
    expect(c.y).toBeLessThanOrEqual(480);
    expect(c.x + c.w).toBeLessThanOrEqual(1920);
    expect(c.y + c.h).toBeLessThanOrEqual(1080);
    // Both boxes inside, with room around them: what surrounds a sticker is part of the answer.
    expect(c.x + c.w).toBeGreaterThanOrEqual(1020);
    expect(c.y + c.h).toBeGreaterThanOrEqual(620);
  });

  it('is capped, so one enormous box cannot bring the whole frame back', () => {
    const c = cropFor(frame(1920, 1080), [{ ...det(0), cx: 960, cy: 540, w: 1900, h: 1000 }]);
    expect(c.w).toBeLessThanOrEqual(PIXEL_PROBE_MAX_SIDE);
    expect(c.h).toBeLessThanOrEqual(PIXEL_PROBE_MAX_SIDE);
  });

  it('is clamped at the edges, where a margin would run off the frame', () => {
    const c = cropFor(frame(100, 80), [{ ...det(0), cx: 4, cy: 3, w: 8, h: 6 }]);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.x + c.w).toBeLessThanOrEqual(100);
    expect(c.y + c.h).toBeLessThanOrEqual(80);
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
      resetPixelProbe();
      await savePixelProbe(frame(), [
        inFrame(0 /* white, the class the first version wrongly triggered on */),
        inFrame(3, 0.91),
      ]);
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
    expect(body.neighbours).toBe(2);
    // The boxes travel with the picture, or a sticker cannot be found in it afterwards — which is
    // the whole purpose. Rounded, because the question is where a sticker is, not where it is to
    // the tenth of a millionth of a pixel.
    expect(body.boxes).toEqual([
      { cx: 1, cy: 1, w: 2, h: 2, cls: 0, conf: 0.4 },
      { cx: 1, cy: 1, w: 2, h: 2, cls: 3, conf: 0.91 },
    ]);
    expect(body.crop).toEqual({ x: 0, y: 0, w: 2, h: 2 });
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
      await savePixelProbe(frame(), [
        det(0 /* white, the class the first version wrongly triggered on */),
      ]);
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
      await savePixelProbe(frame(), [
        det(0 /* white, the class the first version wrongly triggered on */),
      ]);
    } finally {
      (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = had;
      vi.unstubAllGlobals();
    }
    expect(posted, 'it posted a frame it could not encode').toBe(0);
  });
});
