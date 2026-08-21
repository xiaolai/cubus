import { describe, expect, it } from 'vitest';
import { type ColorFace, assembleColors } from '../src/ai-assemble.js';
import { SOLVED_FACELETS } from '../src/facelet-cube.js';
import { FACES, type Face } from '../src/types.js';
import { scrambleFacelets } from './helpers.js';

// Colour class per face, matching CANONICAL / ml/data.yaml: U white 0 … B blue 5.
const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

/** A facelet string → 6 faces of 9 colour classes (the AI detector's output shape). */
function faces(facelets: string, conf = 1): Record<Face, ColorFace> {
  const out = {} as Record<Face, ColorFace>;
  FACES.forEach((face, fi) => {
    const colors: number[] = [];
    for (let k = 0; k < 9; k++) colors.push(LETTER_CLASS[facelets[fi * 9 + k] as Face]!);
    out[face] = { colors, confidence: Array(9).fill(conf) };
  });
  return out;
}

describe('assembleColors', () => {
  it('reconstructs + validates a solved cube from colour classes', () => {
    const r = assembleColors(faces(SOLVED_FACELETS));
    expect(r.facelets).toBe(SOLVED_FACELETS);
    expect(r.valid).toBe(true);
    expect(r.confidence).toBe(1);
  });

  it('validates a scrambled but solvable cube (dual verifier agrees)', () => {
    const f = scrambleFacelets("R U R' U' F2 L D'");
    const r = assembleColors(faces(f));
    expect(r.facelets).toBe(f);
    expect(r.valid).toBe(true);
  });

  it('rejects (with a reason) when two faces share a centre colour', () => {
    const f = faces(SOLVED_FACELETS);
    f.R.colors[4] = f.U.colors[4]!; // R centre now equals U centre — impossible cube
    const r = assembleColors(f);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/centre/);
  });

  it('flags low-confidence stickers below the threshold', () => {
    const f = faces(SOLVED_FACELETS, 1);
    f.U.confidence[0] = 0.05;
    const r = assembleColors(f, 0.15);
    expect(r.lowConfidence).toContain(0); // U sticker 0 = global index 0
    expect(r.confidence).toBeCloseTo(0.05);
    expect(r.valid).toBe(true); // low confidence doesn't itself make it invalid
  });

  it('marks an unsolvable colouring invalid', () => {
    const f = faces(SOLVED_FACELETS);
    f.U.colors[0] = LETTER_CLASS.R; // a single swapped sticker → parity broken
    const r = assembleColors(f);
    expect(r.valid).toBe(false);
  });
});
