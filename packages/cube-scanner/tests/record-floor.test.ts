// A recording must be able to hold the candidates the SCAN throws away, and must not change what
// the scan reads (`dev-docs/scan-recording-session-2026-09-23.md`).
//
// WHY THIS FILE EXISTS. `NEAR_FLOOR_RECORD` is 0.05 so that a recording keeps the near-miss
// candidates a scan floored at 0.25 discards — the plan's §1.2 had seen the logo centre scoring
// 0.20–0.25, and those frames are the failure. But the panel handed the recorder
// `detectionsFromOutput(output)`, which DEFAULTS to 0.25, so the low floor could never keep
// anything: two real recordings of a stalling cube reported "0 candidates below the floor" across
// 1,085 frames, and that number was an artefact of the wiring rather than a fact about the model.
//
// The fix decodes at the recorder's floor while recording and filters back for the fit. Two
// separate claims, checked separately: that the wide decode KEEPS what the scan drops, on a tensor
// built to contain the case; and that filtering it back gives the fit EXACTLY what it had before,
// on the clip's real detector output. The clip cannot serve the first — its own rows were decoded
// at 0.25, so it has no sub-threshold candidate left to find.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectionsFromOutput } from '../src/onnx-detect.js';
import { MIN_STICKER_CONFIDENCE } from '../src/onnx-postprocess.js';
import { NEAR_FLOOR_RECORD } from '../src/session-record.js';

/** The recorded clip's boxes, used as a stand-in tensor source: real detector output. */
interface Clip {
  fps: number;
  frames: number[][][];
}

const clip = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'logo-cube-clip.json'), 'utf8'),
) as Clip;

/**
 * A `ModelOutput` whose tensor reproduces `boxes`.
 *
 * The clip holds decoded rows (`cx, cy, w, h, s0…s5`); the decoder wants the raw tensor laid out
 * `[4 + classes][anchors]`, so the rows are transposed back into one.
 */
function outputOf(boxes: number[][]) {
  const classes = 6;
  const rows = 4 + classes;
  const anchors = boxes.length;
  const data = new Float32Array(rows * anchors);
  for (const [a, box] of boxes.entries()) {
    for (let r = 0; r < rows; r++) data[r * anchors + a] = box[r] ?? 0;
  }
  return { data, rows, anchors, width: 640, height: 640 };
}

describe('the recorder can see below the scan floor, without moving it', () => {
  it('keeps candidates the scan discards', () => {
    // THE MECHANISM, on a tensor built to contain the case. The clip fixture cannot test this: its
    // rows were themselves decoded at 0.25, so nothing under the scan floor survives in it — which
    // is the same blind spot as the wiring bug, one layer out, and the reason a fresh recording is
    // the only way to learn what the model emits at a logo centre.
    const classes = 6;
    const wanted = [0.08, 0.18, 0.24, 0.31, 0.95];
    const boxes = wanted.map((p, i) => {
      const row = [60 + i * 120, 60 + i * 120, 24, 24];
      for (let c = 0; c < classes; c++) row.push(c === i % classes ? p : 0.001);
      return row;
    });
    const output = outputOf(boxes);
    const wide = detectionsFromOutput(output, { confThreshold: NEAR_FLOOR_RECORD });
    const narrow = detectionsFromOutput(output);
    const under = wide.filter((d) => d.confidence < MIN_STICKER_CONFIDENCE);
    expect(under.length, 'the wide decode found nothing under the scan floor').toBe(3);
    expect(narrow.length, 'the scan floor still admits only the confident two').toBe(2);
    // And every one the scan keeps is also in the recording — a recording missing what the scan
    // acted on would be unreplayable in the one case that matters.
    for (const d of narrow) {
      expect(wide.some((w) => w.cx === d.cx && w.cy === d.cy && w.classId === d.classId)).toBe(
        true,
      );
    }
  });

  it('hands the fit exactly what it had before, box for box', () => {
    // THE SAFETY PROPERTY. A scan must read the same whether or not it is being recorded, so the
    // filtered wide decode has to equal the narrow decode exactly — not nearly. It holds because
    // NMS walks candidates in descending confidence and a lower-scoring box can never displace a
    // higher-scoring one; this asserts it on real output instead of trusting the argument.
    let compared = 0;
    for (const boxes of clip.frames) {
      if (!boxes.length) continue;
      const output = outputOf(boxes);
      const narrow = detectionsFromOutput(output);
      const refiltered = detectionsFromOutput(output, {
        confThreshold: NEAR_FLOOR_RECORD,
      }).filter((d) => d.confidence >= MIN_STICKER_CONFIDENCE);
      expect(refiltered).toEqual(narrow);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('states the floors it is comparing, so a change to either is visible here', () => {
    expect(NEAR_FLOOR_RECORD).toBeLessThan(MIN_STICKER_CONFIDENCE);
    expect(NEAR_FLOOR_RECORD).toBe(0.05);
    expect(MIN_STICKER_CONFIDENCE).toBe(0.25);
  });
});
