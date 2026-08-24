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

  it('auto-corrects a face captured at the wrong rotation (orientation search)', () => {
    // 90°-CW position map for a 3x3 face (centre fixed) — same as ai-assemble's internal one.
    const ROT90 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
    const rot = (a: number[], k: number) => {
      let o = a;
      for (let t = 0; t < k; t++) o = ROT90.map((i) => o[i]!);
      return o;
    };
    const f = scrambleFacelets("R U R' U' F2 L D'");
    const fc = faces(f);
    fc.F.colors = rot(fc.F.colors, 1); // the user showed the F side turned 90° CW
    const r = assembleColors(fc);
    expect(r.valid).toBe(true); // the search un-rotates it…
    expect(r.facelets).toBe(f); // …recovering the exact true cube, no orientation prompt needed
  });
});

// 90°-CW position map for a 3x3 face (centre fixed) — same as ai-assemble's internal one.
const ROT90 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
const rot = (a: number[], k: number): number[] => {
  let o = a;
  for (let t = 0; t < ((k % 4) + 4) % 4; t++) o = ROT90.map((i) => o[i]!);
  return o;
};
/** The canonical (correctly held) capture of one side of a known cube. */
const canonical = (facelets: string, face: Face, misHold = 0): ColorFace => ({
  colors: rot(faces(facelets)[face]!.colors, misHold),
  confidence: Array(9).fill(1),
});

/** Show all six sides at the given rotations, the way a user holds them: any way up. */
const shownAs = (facelets: string, rots: number[]): Record<Face, ColorFace> => {
  const f = faces(facelets);
  FACES.forEach((face, fi) => {
    f[face]!.colors = rot(f[face]!.colors, rots[fi]!);
  });
  return f;
};

/** Answer every `confirm` request, optionally mis-holding the nth one. Returns the final result. */
function scanWithConfirmations(truth: string, rots: number[], misHoldNth = -1) {
  const shown = shownAs(truth, rots);
  let confirmed: Partial<Record<Face, ColorFace>> = {};
  let looks = 0;
  for (let round = 0; round < 8; round++) {
    const r = assembleColors(shown, 0.15, confirmed);
    if (r.valid || !r.confirm) return { ...r, looks };
    if (r.mismatch) {
      confirmed = {};
      continue;
    }
    confirmed = {
      ...confirmed,
      [r.confirm.face]: canonical(truth, r.confirm.face, looks === misHoldNth ? 1 : 0),
    };
    looks++;
  }
  return { valid: false, facelets: '', looks, reason: 'gave up' } as const;
}

describe('assembleColors — cubes that six face photographs cannot pin down', () => {
  // Six unoriented face images genuinely do not determine the cube: turn the four side faces of a
  // once-turned cube upside down and "one U turn from solved" reads as "one D turn from solved".
  // Both are legal. This is not a detector failure and re-scanning cannot fix it.
  const oneTurn = scrambleFacelets('U');

  it('asks for one more look instead of calling a perfectly good cube unsolvable', () => {
    const r = assembleColors(faces(oneTurn));
    expect(r.valid).toBe(false);
    expect(r.ambiguous).toBe(true);
    // The old behaviour said "that isn't a solvable cube yet" about a cube one turn from solved.
    expect(r.reason).not.toMatch(/unsolvable|misread/);
    expect(r.confirm).toBeDefined();
    // A side face, so the instruction is the easy one: "hold the white side up".
    expect(r.confirm?.up).toBe('U');
  });

  it('recovers the true cube once the confirmations are answered', () => {
    const r = scanWithConfirmations(oneTurn, [0, 0, 0, 0, 0, 0]);
    expect(r.valid).toBe(true);
    expect(r.facelets).toBe(oneTurn);
    expect(r.looks).toBeGreaterThan(0); // it genuinely needed the extra looks
  });

  it('a solved cube still needs no extra look — every rotation reads the same', () => {
    const r = scanWithConfirmations(SOLVED_FACELETS, [1, 2, 3, 0, 1, 2]);
    expect(r.valid).toBe(true);
    expect(r.facelets).toBe(SOLVED_FACELETS);
    expect(r.looks).toBe(0);
  });

  // The property that matters more than any of the above: a confirmation is USER INPUT, and a
  // user who holds one look a quarter-turn off is feeding the search a lie. A lie must never be
  // able to produce a confident WRONG cube — only no cube. Requiring every discarded reading to
  // be contradicted TWICE is what buys this, since an honest look can never contradict the truth.
  //
  // "U R" is the case that proves it rather than decorating it: with the first look mis-held, a
  // scanner that trusts a single confirmation discards the truth and returns an equally legal
  // impostor. Relaxing the two-contradiction rule turns these rows red.
  it('never returns a wrong cube when one confirmation is mis-held', () => {
    const CASES: [string, number[]][] = [
      ['U R', [0, 0, 0, 0, 0, 0]],
      ['U R', [1, 0, 2, 0, 3, 0]],
      ['U R', [0, 1, 0, 2, 0, 3]],
      ['U R', [2, 2, 2, 2, 2, 2]],
      ['U', [0, 0, 0, 0, 0, 0]],
      ["R U'", [1, 1, 1, 1, 1, 1]],
      ["F' D", [0, 2, 0, 2, 0, 2]],
      ['L2 B', [3, 0, 1, 0, 3, 0]],
      ["R U R' U'", [0, 1, 2, 3, 0, 1]],
      ["F R U2 B'", [2, 0, 3, 1, 0, 2]],
    ];
    for (const [alg, rots] of CASES) {
      const truth = scrambleFacelets(alg);
      const r = scanWithConfirmations(truth, rots, 0);
      // Refusing is fine. Returning someone else's cube is not.
      if (r.valid) expect(`${alg}: ${r.facelets}`).toBe(`${alg}: ${truth}`);
    }
  });

  it('still recovers those same cubes when the looks are held correctly', () => {
    for (const alg of ['U R', 'U', "R U'", "R U R' U'"]) {
      const truth = scrambleFacelets(alg);
      const r = scanWithConfirmations(truth, [0, 1, 2, 3, 0, 1]);
      expect(`${alg}: ${r.facelets}`).toBe(`${alg}: ${truth}`);
    }
  });

  it('says so plainly when no further look could settle it, rather than guessing', () => {
    // Exercised through the same path: whatever it returns must never be a confident wrong cube.
    for (const alg of ['U2 D2', 'R2 L2', 'F2 B2', 'U2 D2 R2 L2']) {
      const truth = scrambleFacelets(alg);
      const r = scanWithConfirmations(truth, [0, 1, 2, 3, 0, 1]);
      if (r.valid) expect(r.facelets).toBe(truth);
      else expect(r.reason).toBeDefined();
    }
  });
});
