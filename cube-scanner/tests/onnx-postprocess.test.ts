import { describe, expect, it } from 'vitest';
import { type Detection, decodeDetections, fitFace, nms } from '../src/onnx-postprocess.js';

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
