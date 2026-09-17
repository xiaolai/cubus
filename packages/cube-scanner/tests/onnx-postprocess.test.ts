import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOW_CONFIDENCE_THRESHOLD } from '../src/ai-assemble.js';
import { fitFromOutput } from '../src/onnx-detect.js';
import {
  type Detection,
  decodeDetections,
  dropNested,
  fitFace,
  MIN_STICKER_CONFIDENCE,
  nms,
} from '../src/onnx-postprocess.js';

/** Nine detections laid out as a clean 3x3 grid, colours in reading order. */
function grid3x3(colors: number[], size = 30, gap = 45): Detection[] {
  const dets: Detection[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      dets.push({
        cx: 100 + c * gap,
        cy: 100 + r * gap,
        w: size,
        h: size,
        classId: colors[r * 3 + c]!,
        confidence: 0.9,
      });
    }
  }
  return dets;
}

describe('decodeDetections', () => {
  it('picks the argmax class per anchor and drops sub-threshold anchors', () => {
    const nc = 3;
    const na = 2;
    const data = new Float32Array((4 + nc) * na);
    const set = (row: number, a: number, v: number) => {
      data[row * na + a] = v;
    };
    set(0, 0, 10);
    set(1, 0, 20);
    set(2, 0, 8);
    set(3, 0, 8); // anchor0 box
    set(4, 0, 0.1);
    set(5, 0, 0.8);
    set(6, 0, 0.2); // anchor0 class 1 = 0.8
    set(4, 1, 0.1);
    set(5, 1, 0.1);
    set(6, 1, 0.1); // anchor1 all below threshold
    const dets = decodeDetections(data, nc, na, 0.25);
    expect(dets).toHaveLength(1);
    expect(dets[0]!.classId).toBe(1);
    expect(dets[0]!.confidence).toBeCloseTo(0.8);
    expect(dets[0]!.cx).toBe(10);
  });
});

describe('nms', () => {
  it('drops an overlapping lower-confidence box, keeps disjoint ones', () => {
    const a: Detection = { cx: 50, cy: 50, w: 20, h: 20, classId: 0, confidence: 0.9 };
    const dup: Detection = { cx: 52, cy: 52, w: 20, h: 20, classId: 0, confidence: 0.6 };
    const far: Detection = { cx: 200, cy: 200, w: 20, h: 20, classId: 1, confidence: 0.7 };
    const kept = nms([a, dup, far], 0.45);
    expect(kept).toHaveLength(2);
    expect(kept.map((d) => d.confidence).sort()).toEqual([0.7, 0.9]);
  });
});

describe('dropNested', () => {
  // The same file ml/test_pipeline.py reads for cube_infer.drop_nested, so the two cannot drift apart.
  const shared = JSON.parse(
    readFileSync(new URL('./fixtures/nested-detections.json', import.meta.url), 'utf8'),
  ) as { cases: { name: string; detections: Detection[]; kept: number[] }[] };
  for (const c of shared.cases) {
    it(c.name, () => {
      expect(dropNested(c.detections).map((d) => c.detections.indexOf(d))).toEqual(c.kept);
    });
  }

  /**
   * A close-up face: six stickers with a full box, three of those also with an inner box whose IoU with
   * it (0.39) is under NMS's 0.45, and three stickers whose only box is smaller than those inner ones.
   * The nine largest boxes therefore hold three stickers twice. ml/test_pipeline.py builds the same.
   */
  const closeUpColors = [0, 1, 2, 3, 4, 5, 0, 1, 2];
  function closeUp(): Detection[] {
    const dets: Detection[] = [];
    closeUpColors.forEach((classId, i) => {
      const cx = 100 + (i % 3) * 45;
      const cy = 100 + Math.floor(i / 3) * 45;
      if (i < 6) dets.push({ cx, cy, w: 40, h: 40, classId, confidence: 0.9 });
      if (i < 3) dets.push({ cx, cy, w: 25, h: 25, classId, confidence: 0.8 });
      if (i >= 6) dets.push({ cx, cy, w: 24, h: 24, classId, confidence: 0.9 });
    });
    return dets;
  }

  it('lets fitFace read a close-up face whose nine largest held three stickers twice', () => {
    const dets = closeUp();
    expect(nms(dets)).toHaveLength(12);
    expect(fitFace(nms(dets)).ok).toBe(false);
    const fit = fitFace(dropNested(nms(dets)));
    expect(fit.ok).toBe(true);
    if (fit.ok) expect(fit.face.colors).toEqual(closeUpColors);
  });

  it('is applied where the app reads a face: fitFromOutput on the raw tensor', () => {
    const dets = closeUp();
    const anchors = dets.length;
    const rows = 4 + 6;
    const data = new Float32Array(rows * anchors);
    dets.forEach((d, a) => {
      data[a] = d.cx;
      data[anchors + a] = d.cy;
      data[2 * anchors + a] = d.w;
      data[3 * anchors + a] = d.h;
      data[(4 + d.classId) * anchors + a] = d.confidence;
    });
    const fit = fitFromOutput({ data, anchors, rows });
    expect(fit.ok).toBe(true);
    if (fit.ok) expect(fit.face.colors).toEqual(closeUpColors);
  });
});

describe('fitFace', () => {
  it('returns 9 colours in reading order for a clean grid', () => {
    const colors = [0, 1, 2, 3, 4, 5, 0, 1, 2];
    const r = fitFace(grid3x3(colors));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.face.colors).toEqual(colors);
      expect(r.face.confidence).toHaveLength(9);
    }
  });

  it('abstains: NO_FACE (empty), PARTIAL_FACE (<9), BAD_GEOMETRY (not a grid)', () => {
    expect(fitFace([])).toEqual({ ok: false, reason: 'NO_FACE' });
    expect(fitFace(grid3x3([0, 1, 2, 3, 4, 5, 0, 1, 2]).slice(0, 5))).toEqual({
      ok: false,
      reason: 'PARTIAL_FACE',
    });
    const junk: Detection[] = Array.from({ length: 9 }, (_, i) => ({
      cx: Math.sin(i * 2.3) * 300,
      cy: Math.cos(i * 1.7) * 300,
      w: 20,
      h: 20,
      classId: i % 6,
      confidence: 0.9,
    }));
    expect(fitFace(junk).ok).toBe(false);
  });

  it('picks the 9 largest (front face) when adjacent-face slivers intrude', () => {
    const colors = [0, 1, 2, 3, 4, 5, 0, 1, 2];
    const slivers: Detection[] = [
      { cx: 320, cy: 100, w: 5, h: 25, classId: 5, confidence: 0.5 },
      { cx: 320, cy: 145, w: 5, h: 25, classId: 5, confidence: 0.5 },
    ];
    const r = fitFace([...grid3x3(colors), ...slivers]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.face.colors).toEqual(colors);
  });
});

describe('fitFace — the geometry a real face has, and the arrangements that only look like one', () => {
  // Every bound below was set by MEASUREMENT over all 20 fixtures in ml/golden/frames/, and none
  // of their reads changes under it (`ml/venv/bin/python ml/golden_frames.py --parity --legs onnx`
  // is the gate). The renders in that set are deliberately extreme — an angled hold shears a face
  // hard — so these are sanity bounds rather than tight ones, and the tests below use arrangements
  // that are well outside anything the goldens produce.

  it('refuses eight front stickers plus one neighbour-face sliver', () => {
    // The realistic misread: white is the weakest class (recall 0.62), so a front sticker is
    // dropped, `good.length` is still nine because a sliver of the side face was detected, and the
    // nine LARGEST are then eight stickers and a sliver. Every rule fitFace had passed — the
    // sliver's y matched a row, the column steps stayed plausible — so a face was emitted with one
    // sticker read off a side the user was not showing. A wrong sticker becomes a wrong cube.
    const dets: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (r === 1 && c === 2) continue; // the sticker the model missed
        dets.push({
          cx: 100 + c * 45,
          cy: 100 + r * 45,
          w: 30,
          h: 30,
          classId: 0,
          confidence: 0.9,
        });
      }
    }
    // The sliver: same height, a fifth of the width, just past the face's right edge.
    dets.push({ cx: 210, cy: 145, w: 5, h: 25, classId: 5, confidence: 0.6 });
    expect(fitFace(dets)).toEqual({ ok: false, reason: 'BAD_GEOMETRY' });
  });

  it('refuses three rows sheared past each other', () => {
    // Each row is internally a clean row and the mean column steps are plausible, so every rule
    // there was accepted it. Nine stickers in a staircase are not a face.
    const dets: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        dets.push({
          cx: 100 + c * 45 + r * 150,
          cy: 100 + r * 45,
          w: 30,
          h: 30,
          classId: 1,
          confidence: 0.9,
        });
      }
    }
    expect(fitFace(dets)).toEqual({ ok: false, reason: 'BAD_GEOMETRY' });
  });

  it('refuses a column displaced far from its neighbours', () => {
    const dets: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        dets.push({
          cx: 100 + c * 45 + (c === 2 ? 200 : 0),
          cy: 100 + r * 45,
          w: 30,
          h: 30,
          classId: 2,
          confidence: 0.9,
        });
      }
    }
    expect(fitFace(dets)).toEqual({ ok: false, reason: 'BAD_GEOMETRY' });
  });

  it('refuses one sticker flung out of its column while the other two hold', () => {
    // The narrower version of the case above: only ONE box moves, so the column's MEAN barely
    // shifts and the step check alone would let it through. The per-column spread is what sees it.
    const dets: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        dets.push({
          cx: 100 + c * 45 + (c === 2 && r === 1 ? 200 : 0),
          cy: 100 + r * 45,
          w: 30,
          h: 30,
          classId: 3,
          confidence: 0.9,
        });
      }
    }
    expect(fitFace(dets).ok).toBe(false);
  });

  it('still accepts a face held at an angle, which is what the goldens are full of', () => {
    // The bounds have to admit the hardest READABLE frames, not merely the easy ones. These are the
    // worst values measured across the golden set on a frame the gate says reads correctly: a
    // column spread of ~1.95 sticker widths, a step of ~1.54, and an area ratio of ~3.4. A tighter
    // rule — "per-column x alignment < one box size", the obvious mirror of the row rule — refuses
    // SEVEN of the twenty fixtures, which is why it is not the rule.
    const colors = [0, 1, 2, 3, 4, 5, 0, 1, 2];
    const dets: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const size = 30 - r * 6; // perspective: the far row is smaller (area ratio ~3.4)
        dets.push({
          cx: 100 + c * 45 + r * 28, // a shear of ~1.9 sticker widths across the column
          cy: 100 + r * 40,
          w: size,
          h: size,
          classId: colors[r * 3 + c]!,
          confidence: 0.9,
        });
      }
    }
    const r = fitFace(dets);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.face.colors).toEqual(colors);
  });
});

describe('the confidence floor sits above the low-confidence bar', () => {
  it('so a valid cube with faint stickers cannot come off the camera', () => {
    // ONE INVARIANT ACROSS TWO FILES. `fitFace` builds no face out of a sticker below
    // MIN_STICKER_CONFIDENCE; `assembleColors` calls one faint below LOW_CONFIDENCE_THRESHOLD. As
    // long as the first is the larger, "valid, with low-confidence stickers" is a state the camera
    // cannot produce — which is what lets the panel treat it as the contradiction it is (a
    // `scan-invalid` event whose own payload says `valid: true`). Two numbers in two files with no
    // relation written down between them is how that would come back silently.
    expect(MIN_STICKER_CONFIDENCE).toBeGreaterThan(LOW_CONFIDENCE_THRESHOLD);
    const faint: Detection[] = grid3x3([0, 1, 2, 3, 4, 5, 0, 1, 2]).map((d) => ({
      ...d,
      confidence: (MIN_STICKER_CONFIDENCE + LOW_CONFIDENCE_THRESHOLD) / 2,
    }));
    expect(fitFace(faint)).toEqual({ ok: false, reason: 'NO_FACE' });
  });
});

describe('a box that is not a box', () => {
  /** Row-major [4 + numClasses, numAnchors], the layout decodeDetections documents. */
  function tensor(rows: number[][]): Float32Array {
    return Float32Array.from(rows.flat());
  }

  it('drops a detection whose geometry is not finite, however sure the score is', () => {
    const data = tensor([
      [100, Number.NaN], // cx — the second anchor's is NaN
      [100, 100],
      [30, 30],
      [30, 30],
      [0.9, 0.9], // class 0 scores, both well over the threshold
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    const dets = decodeDetections(data, 6, 2, 0.25);
    expect(dets).toHaveLength(1);
    expect(dets[0]!.cx).toBe(100);
  });

  it('drops a detection with an infinite side, which `w > 0` alone lets through', () => {
    const data = tensor([
      [100, 100],
      [100, 100],
      [30, Number.POSITIVE_INFINITY], // w
      [30, 30],
      [0.9, 0.9],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(decodeDetections(data, 6, 2, 0.25)).toHaveLength(1);
  });

  it('drops a detection with no area', () => {
    const data = tensor([
      [100, 100],
      [100, 100],
      [30, 0], // w
      [30, 30],
      [0.9, 0.9],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(decodeDetections(data, 6, 2, 0.25)).toHaveLength(1);
  });
});
