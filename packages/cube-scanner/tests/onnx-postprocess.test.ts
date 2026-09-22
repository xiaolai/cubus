import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOW_CONFIDENCE_THRESHOLD } from '../src/ai-assemble.js';
import { fitFromOutput } from '../src/onnx-detect.js';
import {
  type Detection,
  decodeDetections,
  dropIsolated,
  dropNested,
  fitFace,
  fitLattice,
  latticeOf,
  MIN_STICKER_CONFIDENCE,
  nms,
  ROLL_TIE_BAND_DEG,
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
    // Still refused without `dropNested`, and D4's clutter retry deliberately does NOT rescue it:
    // the duplicate boxes are 2.8x a sticker's area, under `CLUTTER_AREA_RATIO`, so they are not
    // clutter by size and no attempt is made. `dropNested` remains the thing that makes this frame
    // readable, which is what this case exists to prove.
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

describe('dropIsolated', () => {
  // The same file ml/test_pipeline.py reads for cube_infer.drop_isolated, so the two cannot drift apart.
  const shared = JSON.parse(
    readFileSync(new URL('./fixtures/isolated-detections.json', import.meta.url), 'utf8'),
  ) as { cases: { name: string; detections: Detection[]; kept: number[] }[] };
  for (const c of shared.cases) {
    it(c.name, () => {
      expect(dropIsolated(c.detections).map((d) => c.detections.indexOf(d))).toEqual(c.kept);
    });
  }
});

describe('fitFace on frames recorded from a real camera, with a false box in the background', () => {
  // Frames the scan trace recorded on 2026-09-18 (see the fixture's `about`). They are why the
  // isolation rule exists, so they are what it is held to — in both directions.
  type Frame = {
    recorded: string;
    boxes: [number, number, number, number, number, number][];
    before: string;
    after: string;
  };
  const { frames } = JSON.parse(
    readFileSync(new URL('./fixtures/background-box-frames.json', import.meta.url), 'utf8'),
  ) as { frames: Frame[] };
  const read = (f: Frame): string => {
    const r = fitFace(
      f.boxes.map(([cx, cy, w, h, classId, confidence]) => ({ cx, cy, w, h, classId, confidence })),
    );
    return r.ok ? `OK ${r.face.colors.map((c) => 'WRGYOB'[c]).join('')}` : r.reason;
  };
  const spoiled = frames.filter((f) => f.recorded === 'area-ratio');
  const reading = frames.filter((f) => f.recorded !== 'area-ratio');

  it('reads every frame exactly as the Python mirror does', () => {
    // ml/cube_infer.py is held to the same `after`, so this is the cross-language check.
    expect(frames.map(read)).toEqual(frames.map((f) => f.after));
  });

  it('leaves every frame that already read exactly as it was — no sticker moved, none recoloured', () => {
    expect(reading.length).toBeGreaterThan(20);
    for (const f of reading) expect(read(f)).toBe(f.before);
  });

  it('is not disturbed at all by the clutter retry (D4)', () => {
    // MEASURED, AND THE ANSWER IS "NOTHING CHANGED". Setting aside boxes that are clutter by size
    // (`CLUTTER_AREA_RATIO`) leaves every one of these 83 recorded frames reading exactly as it did
    // — the false boxes here are the LONE kind, which `dropIsolated` already removes, so no attempt
    // past the first is ever made. D4's rule is for the clustered kind, which this set does not
    // contain; the case that needs it is built by hand below.
    //
    // Worth asserting rather than assuming, because the first version of the retry had no size
    // condition and it DID disturb this set — two frames went from BAD_GEOMETRY to a read — and,
    // worse, read a face on `ml/golden/frames/abstain-00.png`, a fixture that exists to be refused.
    for (const f of frames) {
      if (f.before.startsWith('OK')) {
        expect(f.after, 'a frame that read now reads differently').toBe(f.before);
      }
    }
  });

  it('reads most of the frames the false box spoiled', () => {
    // Every one was refused before, which is what makes the fixture evidence of the bug.
    expect(spoiled.every((f) => f.before === 'BAD_GEOMETRY')).toBe(true);
    const recovered = spoiled.filter((f) => read(f).startsWith('OK')).length;
    // 48 of 55 today; the rest held only eight real stickers under the false box. The floor sits
    // below today's figure so a genuine improvement never has to edit it.
    expect(recovered / spoiled.length).toBeGreaterThanOrEqual(0.75);
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
    // Refused by SIZE, not by position: a sliver a fifth as wide is 7.2x smaller than a sticker.
    // Naming the rule pins which bound this depends on, so loosening a different one cannot let it
    // through unnoticed.
    expect(fitFace(dets)).toMatchObject({
      ok: false,
      reason: 'BAD_GEOMETRY',
      geometry: { rule: 'area-ratio' },
    });
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
    // The case the column rule was added for: every row passes on its own, and it is the columns'
    // x-spread that gives the staircase away.
    expect(fitFace(dets)).toMatchObject({
      ok: false,
      reason: 'BAD_GEOMETRY',
      geometry: { rule: 'column-spread' },
    });
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
    // The WHOLE column moves, so each column is still internally aligned and column-spread passes
    // it. What is wrong is the gap between columns 1 and 2, which is the step rule's to catch.
    expect(fitFace(dets)).toMatchObject({
      ok: false,
      reason: 'BAD_GEOMETRY',
      geometry: { rule: 'step-long' },
    });
  });

  // Every rule the scan trace can name has a case that names it. The trace reports these strings
  // to whoever is diagnosing a scan, so a rule that fired under a different name — or never fired
  // at all — would send that person after the wrong bound.
  it('names row-spread when one row is not level', () => {
    // Size 30. Row 0 dips by 35 at its right end, which is more than a sticker, while staying well
    // clear of row 1 so the sort by y still groups the rows as rows.
    const ys = [
      [100, 100, 135],
      [190, 190, 190],
      [235, 235, 235],
    ];
    const dets: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        dets.push({ cx: 100 + c * 45, cy: ys[r]![c]!, w: 30, h: 30, classId: 3, confidence: 0.9 });
      }
    }
    const fit = fitFace(dets);
    expect(fit).toMatchObject({
      ok: false,
      reason: 'BAD_GEOMETRY',
      geometry: { rule: 'row-spread', bound: 1 },
    });
    if (!fit.ok) expect(fit.geometry!.value).toBeCloseTo(35 / 30);
  });

  it('names step-short when the rows are stacked on top of each other', () => {
    // Rows 8 apart with stickers 30 across: level, aligned, even in size, and not a face.
    const dets: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        dets.push({ cx: 100 + c * 45, cy: 100 + r * 8, w: 30, h: 30, classId: 4, confidence: 0.9 });
      }
    }
    const fit = fitFace(dets);
    expect(fit).toMatchObject({
      ok: false,
      reason: 'BAD_GEOMETRY',
      geometry: { rule: 'step-short', bound: 0.4 },
    });
    if (!fit.ok) expect(fit.geometry!.value).toBeCloseTo(8 / 30);
  });

  it('carries no geometry on an abstention that is not about geometry', () => {
    // Only BAD_GEOMETRY measured a grid. A NO_FACE or PARTIAL_FACE with a geometry attached would
    // tell the trace's reader about a grid nobody fitted.
    expect(fitFace([])).toEqual({ ok: false, reason: 'NO_FACE' });
    const eight: Detection[] = Array.from({ length: 8 }, (_, i) => ({
      cx: 100 + (i % 3) * 45,
      cy: 100 + Math.floor(i / 3) * 45,
      w: 30,
      h: 30,
      classId: 0,
      confidence: 0.9,
    }));
    expect(fitFace(eight)).toEqual({ ok: false, reason: 'PARTIAL_FACE' });
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

describe('fitFace — a face rolled in the image plane (2026-09-20)', () => {
  // THE DEFECT. Rows were grouped by sorting on y and slicing into threes, which is right only under
  // ~26.6° of roll; past it corners landed on edge positions and edges on corners, and the spread
  // rule that should have refused it grew with the roll exactly as the spread did. Measured on the
  // real fit: 27° to 45° accepted in the order [3,0,1,6,4,2,7,8,5], not a rotation, so the assembly
  // refused every such cube as "a colour was misread" (dev-docs/scanner-audit-2026-09-20.md §1.1).

  /** Nine square stickers on a pitch, rolled by `deg`; `scores[0]` carries the TRUE reading index. */
  function rolled(deg: number, tight = false): Detection[] {
    const th = (deg * Math.PI) / 180;
    const sticker = 74;
    const s = sticker + 10;
    const side = tight ? sticker : sticker * (Math.abs(Math.cos(th)) + Math.abs(Math.sin(th)));
    const out: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const x = (c - 1) * s;
        const y = (r - 1) * s;
        out.push({
          cx: 320 + x * Math.cos(th) - y * Math.sin(th),
          cy: 320 + x * Math.sin(th) + y * Math.cos(th),
          w: side,
          h: side,
          classId: (r * 3 + c) % 6,
          confidence: 0.9,
          scores: [r * 3 + c],
        });
      }
    }
    return out;
  }
  const ROT90 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  const rotations = (() => {
    const all: number[][] = [];
    let o = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    for (let k = 0; k < 4; k++) {
      all.push(o);
      o = ROT90.map((i) => o[i]!);
    }
    return all;
  })();
  const orderOf = (dets: Detection[]): number[] | null => {
    const r = fitFace(dets);
    return r.ok ? r.face.scores!.map((s) => s[0]!) : null;
  };

  it('reads every roll from 0° to 90° as a ROTATION of the truth, never a scramble — or refuses it at the tie', () => {
    const band = ROLL_TIE_BAND_DEG;
    for (let deg = 0; deg <= 90; deg += 1) {
      const gap = Math.abs(45 - deg);
      // The band's own edges (42° and 48° for a 3° band) are a coin toss in the last place of a
      // double, and are asserted neither way.
      if (gap === band) continue;
      const order = orderOf(rolled(deg));
      if (gap < band) {
        expect(order, `${deg}°`).toBeNull();
        expect(fitFace(rolled(deg)), `${deg}°`).toMatchObject({
          reason: 'BAD_GEOMETRY',
          geometry: { rule: 'roll-tie', bound: 2 * band },
        });
        continue;
      }
      expect(order, `${deg}°`).not.toBeNull();
      expect(
        rotations.some((rot) => rot.every((v, i) => v === order![i])),
        `${deg}°: ${order}`,
      ).toBe(true);
    }
  });

  it('reads 27°–41° in the true order and 49°–90° as the quarter turn, and refuses 43°–47°', () => {
    // The row is whichever lattice axis is nearer horizontal, so up to 45° the face reads as held
    // and past it as its quarter turn — either is a rotation the assembly solves. Within
    // ROLL_TIE_BAND_DEG of 45° neither is chosen (2026-09-21): the choice flipped on the sign of a
    // difference that jitter moves through zero, so one face alternated between the two readings
    // frame to frame and the stillness gate never saw it settle.
    for (const deg of [27, 30, 35, 40, 41]) expect(orderOf(rolled(deg))).toEqual(rotations[0]);
    for (const deg of [49, 60, 75, 90]) expect(orderOf(rolled(deg))).toEqual(rotations[1]);
    for (const deg of [43, 44, 45, 46, 47]) {
      const fit = fitFace(rolled(deg));
      expect(fit, `${deg}°`).toMatchObject({
        reason: 'BAD_GEOMETRY',
        geometry: { rule: 'roll-tie' },
      });
      // The gap between the two axes' tilts, in degrees: 2° at 44° and 46°, 0 at 45°.
      if (!fit.ok) expect(fit.geometry!.value, `${deg}°`).toBeCloseTo(2 * Math.abs(45 - deg), 6);
    }
    // Both sides of the tie are the same face: 41° and 49° differ by a quarter turn, and neither
    // reading is a scramble.
    expect(orderOf(rolled(41))).not.toEqual(orderOf(rolled(49)));
  });

  it('reads a rolled face whose centre box is pushed off, because the antipodes are matched exactly', () => {
    // The greedy pairing came apart on a middle box pushed past a fifth of a step: one wrong pair
    // came in under a true one, no basis fit, and the level-frame fallback read the face in the
    // scrambled order `[3,0,1,6,4,2,7,8,5]` (measured at 27° and 30° with the centre at (−25, −12)
    // px). The audit's own example, (−19, −9), had in fact always read — the scramble starts a
    // little further out — and the exact matching holds to nearly half a step.
    const pushed = (deg: number, dx: number, dy: number): Detection[] =>
      rolled(deg).map((d, k) => {
        if (k !== 4) return d;
        const th = (deg * Math.PI) / 180;
        return {
          ...d,
          cx: d.cx + dx * Math.cos(th) - dy * Math.sin(th),
          cy: d.cy + dx * Math.sin(th) + dy * Math.cos(th),
        };
      });
    for (const [deg, dx, dy] of [
      [27, -19, -9],
      [27, -25, -12],
      [30, -25, -12],
      [35, 0, -30],
      [40, 22, 18],
    ] as const) {
      const dets = pushed(deg, dx, dy);
      expect(latticeOf(dets), `${deg}° (${dx}, ${dy})`).not.toBeNull();
      expect(orderOf(dets), `${deg}° (${dx}, ${dy})`).toEqual(rotations[0]);
    }
  });

  it('names the stage that refused: not-nine, no-basis, no-cells, roll-tie', () => {
    const level = rolled(0);
    expect(fitLattice(level.slice(0, 8))).toEqual({ ok: false, reason: 'not-nine' });
    // Nine references to eight boxes are not nine boxes, and would have shortened the pairing.
    expect(fitLattice([...level.slice(0, 8), level[0]!])).toEqual({
      ok: false,
      reason: 'not-nine',
    });
    const junk: Detection[] = Array.from({ length: 9 }, (_, i) => ({
      cx: Math.sin(i * 2.3) * 300 + 400,
      cy: Math.cos(i * 1.7) * 300 + 400,
      w: 60,
      h: 60,
      classId: i % 6,
      confidence: 0.9,
    }));
    expect(fitLattice(junk)).toEqual({ ok: false, reason: 'no-basis' });
    // A basis that fits and cells that do not: nine boxes on one line pair off as antipodes and
    // give a basis whose two vectors are parallel — the sum and difference of parallel vectors are
    // parallel too, so `basisOf` is satisfied — and parallel vectors span no cells.
    const collinear: Detection[] = Array.from({ length: 9 }, (_, k) => ({
      cx: 100 + k * 40,
      cy: 200 + k * 10,
      w: 30,
      h: 30,
      classId: k % 6,
      confidence: 0.9,
    }));
    expect(fitLattice(collinear)).toEqual({ ok: false, reason: 'no-cells' });
    expect(fitLattice(rolled(45))).toMatchObject({
      ok: false,
      reason: 'roll-tie',
      gap: expect.any(Number),
    });
    expect(fitLattice(rolled(20))).toMatchObject({ ok: true });
  });

  it('reads tight boxes too, which the old spread rule refused at 27°', () => {
    for (const deg of [27, 28, 30, 40]) expect(orderOf(rolled(deg, true))).toEqual(rotations[0]);
  });

  it('answers the shared cases exactly as ml/cube_infer.py does', () => {
    // The same file ml/test_pipeline.py reads for cube_infer.fit_grid: rolls, shears, one junk
    // arrangement and one staircase, with the order as indices into `detections`.
    const shared = JSON.parse(
      readFileSync(new URL('./fixtures/rolled-grids.json', import.meta.url), 'utf8'),
    ) as {
      cases: { name: string; detections: Detection[]; order: number[] | null; reason?: string }[];
    };
    expect(shared.cases.length).toBeGreaterThan(30);
    for (const c of shared.cases) {
      const r = fitFace(c.detections);
      if (c.order === null) {
        expect(r.ok, c.name).toBe(false);
        if (!r.ok) expect(r.reason, c.name).toBe(c.reason);
        continue;
      }
      expect(r.ok, c.name).toBe(true);
      if (!r.ok) continue;
      const got = r.face.boxes!.map((b) =>
        c.detections.findIndex(
          (d) => d.cx - d.w / 2 === b[0] && d.cy - d.h / 2 === b[1] && d.w === b[2] && d.h === b[3],
        ),
      );
      expect(got, c.name).toEqual(c.order);
    }
  });

  it('leaves a level or sheared face on the path its bounds were measured on', () => {
    // When the lattice and the sort agree, nothing is turned: the sheared face above and the
    // golden-like case in the fixture read exactly as before. `latticeOf` itself is exported only so
    // this can say the two AGREE on such a face, which is the condition for the unchanged path.
    const level = rolled(0);
    const lattice = latticeOf(level);
    expect(lattice).not.toBeNull();
    const cells = level.map((d) => lattice!.cells.get(d)!);
    expect(cells).toEqual([
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [0, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ]);
    expect(orderOf(level)).toEqual(rotations[0]);
  });

  it('finds no lattice in junk, and the level-frame rules refuse it as they always did', () => {
    const junk: Detection[] = Array.from({ length: 9 }, (_, i) => ({
      cx: Math.sin(i * 2.3) * 300 + 400,
      cy: Math.cos(i * 1.7) * 300 + 400,
      w: 60,
      h: 60,
      classId: i % 6,
      confidence: 0.9,
    }));
    expect(latticeOf(junk)).toBeNull();
    expect(fitFace(junk).ok).toBe(false);
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

/**
 * D4 (`dev-docs/scan-pipeline-audit-2026-09-23.md` §3): clustered false boxes take real stickers'
 * places among "the nine largest", and `dropIsolated` cannot see them because each is the other's
 * neighbour.
 *
 * The audit's reproduction, re-run here: a clean 3×3 of 20 px stickers plus two 60 px boxes 45 px
 * apart — objects on a shelf behind the cube. One such box is dropped as isolated and always was;
 * two keep each other, and both being large they displaced two stickers, so the frame was refused
 * at an area ratio of 9 against a bound of 5. Every frame in a cluttered room failed that way, and
 * each refusal reset the stillness run, so a side never settled.
 */
describe('a cluster of false boxes does not cost the face its place (D4)', () => {
  const grid = (): Detection[] => {
    const out: Detection[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        out.push({
          cx: 200 + 30 * c,
          cy: 200 + 30 * r,
          w: 20,
          h: 20,
          classId: (r * 3 + c) % 6,
          confidence: 0.9,
          scores: [0, 1, 2, 3, 4, 5].map((k) => (k === (r * 3 + c) % 6 ? 0.9 : 0)),
        });
      }
    }
    return out;
  };
  const clutter = (x: number): Detection => ({
    cx: x,
    cy: 450,
    w: 60,
    h: 60,
    classId: 1,
    confidence: 0.4,
    scores: [0, 0.4, 0, 0, 0, 0],
  });

  it('reads the face through one, two and three clustered boxes', () => {
    const clean = fitFace(grid());
    expect(clean.ok).toBe(true);
    for (const n of [1, 2, 3]) {
      const boxes = [...grid(), ...Array.from({ length: n }, (_, i) => clutter(500 + i * 45))];
      const got = fitFace(boxes);
      expect(got.ok, `${n} clustered false boxes refused the face`).toBe(true);
      // And it is the SAME face: the colours the clean frame read, in the same order. A rule that
      // recovered the frame by reading some other nine would be worse than the refusal it replaced.
      if (got.ok && clean.ok) expect(got.face.colors).toEqual(clean.face.colors);
    }
  });

  it('will not manufacture a face out of boxes that are all one size', () => {
    // THE CONDITION THAT MAKES THE RETRY SAFE, pinned. Without `CLUTTER_AREA_RATIO`, "drop the
    // largest and try again" finds nine boxes somewhere in a crowd that satisfy the geometry rules
    // — it read a face on the golden abstention fixture on all four runtimes. Here twelve boxes of
    // equal size are scattered so that no nine of them form a grid: nothing is clutter by size,
    // so no attempt past the first is made and the refusal stands.
    const crowd: Detection[] = Array.from({ length: 12 }, (_, i) => ({
      cx: 150 + (i % 4) * 37 + (i % 3) * 11,
      cy: 150 + Math.floor(i / 4) * 61 + (i % 2) * 17,
      w: 20,
      h: 20,
      classId: i % 6,
      confidence: 0.9,
    }));
    expect(fitFace(crowd).ok).toBe(false);
  });

  it('reports the unmodified rule’s refusal when no attempt fits', () => {
    // Nothing here is a face, so every attempt fails and the reason reported is the one the nine
    // largest gave — the scan trace's diagnosis is unchanged by the retries.
    const scattered: Detection[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({
      cx: 100 + (i % 2) * 40,
      cy: 100 + i * 41,
      w: 20 + i * 12,
      h: 20,
      classId: 0,
      confidence: 0.9,
    }));
    const got = fitFace(scattered);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.reason).toBe('BAD_GEOMETRY');
  });

  it('cannot change a frame that already read: a fit is only tried after a refusal', () => {
    // The property that makes this safe to land without re-pinning a golden. Setting a box aside
    // happens ONLY when the attempt before it failed, so any frame the old rule read is read
    // identically — asserted here by giving the clean grid every extra box that cannot displace a
    // sticker and checking the read never moves.
    const clean = fitFace(grid());
    expect(clean.ok).toBe(true);
    const small: Detection = {
      cx: 260,
      cy: 200,
      w: 8,
      h: 8,
      classId: 3,
      confidence: 0.9,
    };
    const got = fitFace([...grid(), small]);
    expect(got.ok).toBe(true);
    if (got.ok && clean.ok) expect(got.face.colors).toEqual(clean.face.colors);
  });
});
