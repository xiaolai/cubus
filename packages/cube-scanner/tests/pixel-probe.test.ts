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
  base64Of,
  PIXEL_PROBE_EVERY_MS,
  PIXEL_PROBE_KEY,
  PIXEL_PROBE_MAX_FRAMES,
  PIXEL_PROBE_MIN_NEIGHBOURS,
  PIXEL_PROBE_SIDE,
  pixelProbeCounts,
  pixelProbeEnabled,
  resetPixelProbe,
  rgbaOf,
  savePixelProbe,
} from '../view/pixel-probe.js';

/**
 * A box covering the whole 16×16 fixture below — IN LETTERBOX SPACE, which is what a `Detection`
 * carries. A 16×16 frame letterboxes to 640 with no padding, so a frame pixel is 40 letterbox
 * pixels: the whole frame is cx 320, cy 320, w 640, h 640.
 */
const inFrame = (classId: number, confidence = 0.4): Detection => ({
  cx: 320,
  cy: 320,
  w: 640,
  h: 640,
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

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

/**
 * A stand-in for the platform's canvas.
 *
 * NODE HAS NO `OffscreenCanvas`, so the real PNG encoder cannot run here and these cases do not
 * pretend to test it — encoding is the platform's, and asserting it against a fake would assert the
 * fake. What IS this module's own and is tested: that the picture handed to `putImageData` is the
 * MODEL's input rather than a crop of the camera frame, that the bytes the encoder returns survive
 * base64 in order and in full, and that the format asked for is lossless.
 */
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
    expect(PIXEL_PROBE_SIDE).toBe(640);
  });
});

describe('the picture is the MODEL\u2019s input, which removes a whole class of bug', () => {
  // WHAT WENT WRONG TWICE. A `Detection` is in the 640 px letterbox the model was handed, not in
  // camera pixels. The first version cropped the FRAME using those numbers, so on a 1920×1080
  // camera every crop landed in the left third of the picture at a third of the right scale, and
  // twenty-two saved frames showed a doorframe while the cube sat outside the crop — three
  // conclusions were drawn from them before a box coordinate was checked against the frame width.
  //
  // Converting correctly fixes the instance. Saving the model's own input removes the class: the
  // boxes and the picture are then in one space by construction, with no conversion to drift.
  const frame = (w: number, h: number): Frame => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = i % 256;
      data[i * 4 + 3] = 255;
    }
    return { data, width: w, height: h };
  };

  it('is 640 square whatever the camera is, so one frame cannot be large', async () => {
    for (const [w, h] of [
      [1920, 1080],
      [640, 480],
      [1280, 720],
    ] as const) {
      let drawnW = 0;
      const { FakeOffscreenCanvas, drawn } = fakeCanvas(new Uint8Array([1, 2, 3]));
      vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
      vi.stubGlobal('ImageData', FakeImageData);
      vi.stubGlobal('fetch', async () => ({ ok: true }));
      try {
        resetPixelProbe();
        await savePixelProbe(frame(w, h), [inFrame(0)]);
        drawnW = drawn[0]?.width ?? 0;
      } finally {
        vi.unstubAllGlobals();
      }
      expect(drawnW, `a ${w}×${h} camera did not letterbox to ${PIXEL_PROBE_SIDE}`).toBe(
        PIXEL_PROBE_SIDE,
      );
    }
  });

  it('pads a 16:9 camera exactly as the detector does, so the picture is what the model saw', async () => {
    // 1920×1080 fits as 640×360 with 140 rows of grey 114 above and below. Those grey rows are 44%
    // of the model's input on a widescreen camera, which is a fact about this pipeline worth
    // seeing in the picture rather than inferring.
    const { FakeOffscreenCanvas, drawn } = fakeCanvas(new Uint8Array([1]));
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('fetch', async () => ({ ok: true }));
    try {
      resetPixelProbe();
      await savePixelProbe(frame(1920, 1080), [inFrame(0)]);
    } finally {
      vi.unstubAllGlobals();
    }
    const px = drawn[0]!.data;
    const at = (x: number, y: number) => px[(y * PIXEL_PROBE_SIDE + x) * 4]!;
    expect(at(320, 5), 'the top band should be the pad the model trains with').toBe(114);
    expect(at(320, 634), 'the bottom band should be the pad too').toBe(114);
    expect(at(320, 320), 'the middle should be picture, not pad').not.toBe(114);
  });
});

describe('what the probe writes', () => {
  /** A 16×16 frame with a known pattern, so the crop can be checked pixel for pixel. */
  const frame = (): Frame => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i++) {
      data[i * 4] = i % 256;
      data[i * 4 + 1] = 255 - (i % 256);
      data[i * 4 + 2] = (i * 7) % 256;
      data[i * 4 + 3] = 255;
    }
    return { data, width: 16, height: 16 };
  };

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

    // What reached the canvas is the MODEL's input — 640 square, letterboxed — not the camera
    // frame. A probe that drew the frame would answer the question in a space the boxes are not in.
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.width).toBe(640);
    expect(drawn[0]!.height).toBe(640);

    expect(posts, 'the probe posted more than once for one frame').toHaveLength(1);
    const { url, body } = posts[0]!;
    expect(url).toBe('/__record');
    expect(body.kind).toBe('pixel-probe');
    expect(body.cameraWidth).toBe(16);
    expect(body.cameraHeight).toBe(16);
    expect(body.side).toBe(640);
    expect(body.neighbours).toBe(2);
    // The boxes travel with the picture, or a sticker cannot be found in it afterwards — which is
    // the whole purpose. Rounded, because the question is where a sticker is, not where it is to
    // the tenth of a millionth of a pixel.
    expect(body.boxes).toEqual([
      { cx: 320, cy: 320, w: 640, h: 640, cls: 0, conf: 0.4 },
      { cx: 320, cy: 320, w: 640, h: 640, cls: 3, conf: 0.91 },
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

describe('the budget, which is the whole reason this is safe to leave switched on', () => {
  /** A 4×4 frame — small, because these cases count calls rather than look at pixels. */
  const tiny = (): Frame => ({
    data: new Uint8ClampedArray(4 * 4 * 4).fill(200),
    width: 4,
    height: 4,
  });

  /** The fake canvas, a counting sink, and a promise per encode so a test can hold them open. */
  function harness(respond: () => { ok: boolean; status?: number } = () => ({ ok: true })) {
    const posts: number[] = [];
    const { FakeOffscreenCanvas, drawn } = fakeCanvas(new Uint8Array([1, 2, 3]));
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      posts.push(JSON.parse(init.body).nth as number);
      return respond();
    });
    resetPixelProbe();
    return { posts, drawn };
  }

  it('stops at the limit, and a refused call encodes nothing and posts nothing', async () => {
    const { posts, drawn } = harness();
    try {
      for (let i = 0; i < PIXEL_PROBE_MAX_FRAMES + 5; i++) await savePixelProbe(tiny(), [det(0)]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(posts).toHaveLength(PIXEL_PROBE_MAX_FRAMES);
    // The refused calls did not merely fail to post — they did not letterbox or encode either,
    // which is the expensive half and the reason the bound exists at all.
    expect(drawn, 'a refused call still paid for an encode').toHaveLength(PIXEL_PROBE_MAX_FRAMES);
    expect(posts[0]).toBe(1);
    expect(posts.at(-1)).toBe(PIXEL_PROBE_MAX_FRAMES);
    expect(pixelProbeCounts()).toEqual({
      attempted: PIXEL_PROBE_MAX_FRAMES,
      delivered: PIXEL_PROBE_MAX_FRAMES,
    });
  });

  it('holds the limit when calls OVERLAP, which a check-then-increment does not', async () => {
    // THE CASE THAT FAILED, MEASURED: the cap was read before an `await` and the counter raised
    // after it, so forty-one concurrent calls all read "39 so far" and forty-one frames were
    // posted against a limit of forty. The caller throttles when a save STARTS and nothing
    // serialises when one finishes, so overlap is the normal case, not the exotic one.
    const { posts } = harness();
    try {
      await Promise.all(
        Array.from({ length: PIXEL_PROBE_MAX_FRAMES + 1 }, () => savePixelProbe(tiny(), [det(0)])),
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(posts).toHaveLength(PIXEL_PROBE_MAX_FRAMES);
    expect(new Set(posts).size, 'two calls were handed the same sequence number').toBe(
      PIXEL_PROBE_MAX_FRAMES,
    );
  });

  it('spends the budget on a sink that refuses, and says so rather than counting a save', async () => {
    // A rejected POST has already cost the letterbox, the encode and the base64, so the budget is
    // spent; what must NOT happen is the count claiming frames that no file exists for. The throw
    // is how the caller's warning fires — this used to resolve quietly.
    const { posts } = harness(() => ({ ok: false, status: 500 }));
    const failures: unknown[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        await savePixelProbe(tiny(), [det(0)]).catch((e: unknown) => failures.push(e));
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect(posts).toHaveLength(3);
    expect(failures).toHaveLength(3);
    expect(String(failures[0])).toContain('500');
    expect(pixelProbeCounts()).toEqual({ attempted: 3, delivered: 0 });
  });

  it('gives the budget back only on an explicit reset', async () => {
    const first = harness();
    try {
      for (let i = 0; i < PIXEL_PROBE_MAX_FRAMES; i++) await savePixelProbe(tiny(), [det(0)]);
      await savePixelProbe(tiny(), [det(0)]);
      expect(first.posts).toHaveLength(PIXEL_PROBE_MAX_FRAMES);
      resetPixelProbe();
      expect(pixelProbeCounts()).toEqual({ attempted: 0, delivered: 0 });
      await savePixelProbe(tiny(), [det(0)]);
      expect(first.posts).toHaveLength(PIXEL_PROBE_MAX_FRAMES + 1);
      expect(first.posts.at(-1), 'the sequence did not restart with the budget').toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('spends nothing at all on a runtime that cannot encode', async () => {
    // The capability check comes BEFORE the reservation: a webview with no `OffscreenCanvas` will
    // never write a frame, and burning forty slots proving it would hide that with a used-up budget.
    const had = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined;
    vi.stubGlobal('fetch', async () => ({ ok: true }));
    try {
      resetPixelProbe();
      await savePixelProbe(tiny(), [det(0)]);
      expect(pixelProbeCounts()).toEqual({ attempted: 0, delivered: 0 });
    } finally {
      (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = had;
      vi.unstubAllGlobals();
    }
  });
});

describe('the two pure steps, which are the only conversion this module owns', () => {
  it('reads the model’s CHW planes into RGBA in the right order and scale', () => {
    // A 2×2 tensor whose three planes are distinguishable, so a swapped plane or a transposed
    // index is visible rather than plausible. Plane order is R, G, B; the alpha is opaque.
    const plane = 4;
    const data = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      data[i] = i / 10;
      data[plane + i] = 0.5;
      data[plane * 2 + i] = 1;
    }
    const px = rgbaOf(data, 2);
    expect(px).toHaveLength(plane * 4);
    expect([...px.subarray(0, 4)]).toEqual([0, 128, 255, 255]);
    expect([...px.subarray(4, 8)]).toEqual([26, 128, 255, 255]);
    expect([...px.subarray(12, 16)]).toEqual([77, 128, 255, 255]);
  });

  it('is an 8-BIT VISUALISATION, not the tensor — the claim the doc used to overstate', () => {
    // `preprocess` resamples bilinearly, so its samples sit off the 1/255 grid and an 8-bit PNG
    // rounds them. PNG is lossless about the bytes it is HANDED and says nothing about this step.
    // Enough to see a blown-out sticker or a logo; not enough to recompute a detector score from.
    const data = new Float32Array([0.5015625, 0, 0, 0, 0, 0]);
    const px = rgbaOf(data, 1);
    expect(px[0]).toBe(128);
    expect(px[0]! / 255).not.toBe(0.5015625);
  });

  it('carries every byte through base64, in order, across the chunk boundary', () => {
    const bytes = new Uint8Array(0x8000 + 3);
    bytes.set([1, 2, 3]);
    bytes[bytes.length - 1] = 250;
    const back = Uint8Array.from(atob(base64Of(bytes)), (c) => c.charCodeAt(0));
    expect(back.length).toBe(bytes.length);
    expect([...back.subarray(0, 3)]).toEqual([1, 2, 3]);
    expect(back.at(-1)).toBe(250);
  });
});
