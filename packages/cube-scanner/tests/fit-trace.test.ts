// The frame trace, held to the one property that makes it worth having: it describes the scan that
// actually happened. A trace whose verdict drifted from the scan's would send whoever reads it after
// a fault the scan never had, so faithfulness is tested first and on every kind of frame.

import { describe, expect, it } from 'vitest';
import type { ModelOutput } from '../src/detector.js';
import { BOX_CAP, centreProbe, NEAR_CANDIDATES, NEAR_FLOOR, traceFrame } from '../src/fit-trace.js';
import { fitFromOutput, NUM_CLASSES } from '../src/onnx-detect.js';
import type { Detection } from '../src/onnx-postprocess.js';

interface Box {
  cx: number;
  cy: number;
  w?: number;
  h?: number;
  cls: number;
  conf: number;
}

/** A detect head holding exactly these boxes, one per anchor, in the model's row-major layout. */
function outputOf(boxes: Box[], rows = 4 + NUM_CLASSES): ModelOutput {
  const anchors = Math.max(boxes.length, 1);
  const data = new Float32Array(rows * anchors);
  boxes.forEach((b, a) => {
    data[0 * anchors + a] = b.cx;
    data[1 * anchors + a] = b.cy;
    data[2 * anchors + a] = b.w ?? 30;
    data[3 * anchors + a] = b.h ?? 30;
    data[(4 + b.cls) * anchors + a] = b.conf;
  });
  return { data, anchors, rows };
}

/** A clean 3x3 face, stickers 30 across on a 45 pitch, with one cell optionally changed. */
function face(centre?: Partial<Box> | null): Box[] {
  const boxes: Box[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = { cx: 100 + c * 45, cy: 100 + r * 45, cls: (r * 3 + c) % 6, conf: 0.9 };
      if (r === 1 && c === 1) {
        if (centre === null) continue; // the detector saw nothing at the centre
        boxes.push({ ...cell, cls: 0, ...centre });
      } else boxes.push(cell);
    }
  }
  return boxes;
}

describe('traceFrame — faithful to the scan', () => {
  const frames: Record<string, ModelOutput> = {
    'a clean face': outputOf(face()),
    'nothing at all': outputOf([]),
    'a face missing its centre': outputOf(face(null)),
    'a centre scored just under the threshold': outputOf(face({ conf: 0.18 })),
    'a staircase that is not a grid': outputOf(
      face().map((b, i) => ({ ...b, cx: b.cx + Math.floor(i / 3) * 150 })),
    ),
    'a sliver beside eight stickers': outputOf([
      ...face(null),
      { cx: 210, cy: 145, w: 5, h: 25, cls: 5, conf: 0.6 },
    ]),
  };

  for (const [name, output] of Object.entries(frames)) {
    it(`reaches the scan's verdict on ${name}`, () => {
      // The verdict the scan acts on, and the one the trace records, must be the same object in
      // every field — reason, geometry, colours, confidences, boxes.
      expect(traceFrame(output).fit).toEqual(fitFromOutput(output));
    });
  }

  it('throws where the scan throws, on a head with the wrong row count', () => {
    const wrong = outputOf(face(), 4 + NUM_CLASSES + 1);
    expect(() => fitFromOutput(wrong)).toThrow(/rows/);
    expect(() => traceFrame(wrong)).toThrow(/rows/);
  });
});

describe('traceFrame — what the scan discarded', () => {
  it('shows a centre scored just under the threshold as a near-miss, not as a kept sticker', () => {
    const t = traceFrame(outputOf(face({ conf: 0.18 })));
    expect(t.fit).toEqual({ ok: false, reason: 'PARTIAL_FACE' });
    expect(t.kept).toBe(8);
    expect(t.near).toBe(1);
    // The question the logo case asks, answered: the detector DID see a sticker at the centre, as
    // white, and scored it too low for the scan to use.
    expect(t.centre).toEqual({
      found: true,
      cls: 0,
      conf: 0.18,
      kept: false,
      dist: 0,
      scores: [0.18, 0, 0, 0, 0, 0],
    });
    expect(t.boxes.filter((b) => !b.kept)).toEqual([
      { x: 145, y: 145, w: 30, h: 30, cls: 0, conf: 0.18, kept: false },
    ]);
  });

  it('says there was nothing at the centre when the detector saw nothing there', () => {
    const t = traceFrame(outputOf(face(null)));
    expect(t.fit).toEqual({ ok: false, reason: 'PARTIAL_FACE' });
    expect(t.near).toBe(0);
    expect(t.centre).toEqual({ found: false });
  });

  it('ignores a box below the floor — below it, the detector did not see a sticker', () => {
    const t = traceFrame(outputOf(face({ conf: NEAR_FLOOR / 2 })));
    expect(t.near).toBe(0);
    expect(t.centre).toEqual({ found: false });
  });

  it('shows a centre read as the wrong colour, which is a different fault from a missing one', () => {
    const t = traceFrame(outputOf(face({ cls: 4, conf: 0.7 })));
    expect(t.fit.ok).toBe(true);
    expect(t.centre).toMatchObject({ found: true, cls: 4, kept: true });
  });

  it('names the fitted centre on a frame the scan read, however far a stray box sits', () => {
    // A background box the fit drops as isolated used to stretch the probe's idea of the middle, so a
    // frame the scan READ could be traced as having nothing at its centre.
    const t = traceFrame(
      outputOf([...face(), { cx: 600, cy: 400, w: 70, h: 70, cls: 4, conf: 0.4 }]),
    );
    expect(t.fit.ok).toBe(true);
    expect(t.kept).toBe(10);
    expect(t.centre).toEqual({
      found: true,
      cls: 0,
      conf: 0.9,
      kept: true,
      dist: 0,
      scores: [0.9, 0, 0, 0, 0, 0],
    });
  });

  it('does not count a weaker duplicate of a real sticker as a near-miss', () => {
    // Same place as the top-left sticker, lower score: NMS suppresses it behind the real one, so it
    // is not a sticker the scan missed and must not be shown as one.
    const t = traceFrame(outputOf([...face(), { cx: 100, cy: 100, cls: 3, conf: 0.15 }]));
    expect(t.fit.ok).toBe(true);
    expect(t.near).toBe(0);
  });

  it('lists kept boxes largest first, then near-misses by score, and stops at the cap', () => {
    const noise: Box[] = Array.from({ length: 30 }, (_, i) => ({
      cx: 400 + (i % 6) * 60,
      cy: 400 + Math.floor(i / 6) * 60,
      cls: 1,
      conf: 0.11 + i * 0.004,
    }));
    const t = traceFrame(outputOf([...face(), ...noise]));
    expect(t.boxes).toHaveLength(BOX_CAP);
    expect(t.boxes.slice(0, 9).every((b) => b.kept)).toBe(true);
    const nearConf = t.boxes.filter((b) => !b.kept).map((b) => b.conf);
    expect(nearConf).toEqual([...nearConf].sort((a, b) => b - a));
    expect(traceFrame(outputOf([...face(), ...noise]), { cap: 3 }).boxes).toHaveLength(3);
  });

  it('bounds the near-miss search, so the trace cannot slow the ticks it measures', () => {
    const flood: Box[] = Array.from({ length: NEAR_CANDIDATES + 200 }, (_, i) => ({
      cx: 1000 + i * 40,
      cy: 1000,
      cls: 2,
      conf: 0.12,
    }));
    const t = traceFrame(outputOf([...face(), ...flood]));
    expect(t.near).toBeLessThanOrEqual(NEAR_CANDIDATES);
    expect(t.fit.ok).toBe(true);
  });
});

describe('centreProbe', () => {
  const d = (cx: number, cy: number, conf = 0.9, classId = 0): Detection => ({
    cx,
    cy,
    w: 30,
    h: 30,
    classId,
    confidence: conf,
  });

  it('has nothing to say with fewer than four kept boxes — there is no face to find the middle of', () => {
    expect(centreProbe([d(100, 100), d(145, 100), d(190, 100)], [])).toBeNull();
  });

  it('finds the empty middle of eight stickers', () => {
    const eight = face(null).map((b) => d(b.cx, b.cy));
    expect(centreProbe(eight, [])).toEqual({ found: false });
    expect(centreProbe(eight, [d(146, 144, 0.2)])).toEqual({
      found: true,
      cls: 0,
      conf: 0.2,
      kept: false,
      dist: expect.any(Number) as number,
    });
  });

  it('records every colour score of the centre box, so what came second is visible', () => {
    // A white centre printed with a logo, read as blue. The question is what white scored.
    const out = outputOf(face({ cls: 5, conf: 0.76 }));
    out.data[(4 + 0) * out.anchors + 4] = 0.41; // anchor 4 is the centre; class 0 is white
    const kept = traceFrame(out).centre;
    expect(kept).toMatchObject({ found: true, kept: true, cls: 5 });
    expect(kept?.found && kept.scores).toEqual([0.41, 0, 0, 0, 0, 0.76]);

    // And the same for a centre the scan did not keep: a near miss is where a logo often lands.
    const near = outputOf(face({ cls: 5, conf: 0.18 }));
    near.data[(4 + 0) * near.anchors + 4] = 0.12;
    const missed = traceFrame(near).centre;
    expect(missed).toMatchObject({ found: true, kept: false, cls: 5 });
    expect(missed?.found && missed.scores).toEqual([0.12, 0, 0, 0, 0, 0.18]);
  });

  it('prefers the nearer of a kept and a near box', () => {
    const nine = face().map((b) => d(b.cx, b.cy, 0.9, b.cls));
    expect(centreProbe(nine, [d(160, 160, 0.2, 3)])).toMatchObject({ found: true, kept: true });
  });
});
