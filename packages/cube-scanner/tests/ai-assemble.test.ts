import { describe, expect, it } from 'vitest';
import { type ColorFace, assembleColors, assemblePainted } from '../src/ai-assemble.js';
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

describe('assembleColors — confirmations are rotation measurements, and refusals carry diagnosis', () => {
  const oneTurn = scrambleFacelets('U');
  const deep = scrambleFacelets("R U F2 D' L B R2 F D U2 L2 B'");

  it('a confirmation with one misread sticker still recovers the true cube', () => {
    // Exact matching failed here at EVERY rotation, so a correctly-held look read as a mis-hold —
    // measured against the old drop-and-retry policy, a 2% per-sticker misread on the second look
    // wiped 11% of once-turned scans, and 66% at the model's held-out 10%.
    const shown = shownAs(oneTurn, [0, 0, 0, 0, 0, 0]);
    const first = assembleColors(shown);
    expect(first.confirm).toBeDefined();
    const cap = canonical(oneTurn, first.confirm!.face);
    cap.colors[0] = (cap.colors[0]! + 1) % 6; // the second look flips one sticker
    const second = assembleColors(shown, 0.15, { [first.confirm!.face]: cap });
    // Never a mismatch ("held the wrong way up") for a colour flip; the scan continues instead.
    expect(second.mismatch).toBeUndefined();
    if (!second.valid) {
      expect(second.confirm).toBeDefined();
    } else {
      expect(second.facelets).toBe(oneTurn);
    }
  });

  it('a confirmation that reads as a different face entirely comes back as `reread`', () => {
    const shown = shownAs(oneTurn, [0, 0, 0, 0, 0, 0]);
    const first = assembleColors(shown);
    const face = first.confirm!.face;
    const cap = canonical(oneTurn, face);
    for (const i of [0, 1, 2, 3]) cap.colors[i] = (cap.colors[i]! + 1) % 6; // 4 disagreements
    const r = assembleColors(shown, 0.15, { [face]: cap });
    expect(r.valid).toBe(false);
    expect(r.reread).toBe(face);
    expect(r.confirm?.face).toBe(face);
    expect(r.mismatch).toBeUndefined(); // colours disagreeing is not a hold accusation
  });

  it('a single misread sticker is pointed at, in as-shown coordinates', () => {
    // The F side is shown a quarter turn off AND with one sticker misread. The suspect must name
    // the sticker as displayed (index into the rotated capture), because that is what a user taps.
    const rots = [0, 0, 1, 0, 0, 0];
    const shown = shownAs(deep, rots);
    const trueColor = shown.F!.colors[2]!;
    shown.F!.colors[2] = (trueColor + 1) % 6;
    const r = assembleColors(shown);
    expect(r.valid).toBe(false);
    expect(r.suspects).toContainEqual({ face: 'F', index: 2, to: trueColor });
    // Applying the suggested fix makes the scan assemble to the true cube.
    shown.F!.colors[2] = trueColor;
    expect(assembleColors(shown).facelets).toBe(deep);
  });

  it('anything messier than a single 10/8 imbalance gets no suspects rather than a guess', () => {
    const shown = shownAs(deep, [0, 0, 0, 0, 0, 0]);
    shown.F!.colors[0] = (shown.F!.colors[0]! + 1) % 6;
    shown.R!.colors[1] = (shown.R!.colors[1]! + 2) % 6;
    shown.L!.colors[3] = (shown.L!.colors[3]! + 3) % 6;
    const r = assembleColors(shown);
    if (!r.valid) expect(r.suspects ?? []).toEqual([]);
  });

  it('success returns the rotation applied to each as-shown face', () => {
    const rots = [1, 2, 3, 0, 1, 2];
    const shown = shownAs(deep, rots);
    const r = assembleColors(shown);
    expect(r.valid).toBe(true);
    expect(r.rotations).toBeDefined();
    // Applying the returned rotations to the as-shown captures reproduces the accepted facelets.
    const rebuilt = FACES.map((face, fi) =>
      rot(shown[face]!.colors, r.rotations![fi]!)
        .map((c) => FACES[c])
        .join(''),
    ).join('');
    expect(rebuilt).toBe(r.facelets);
  });
});

describe('assembleColors — dead ends refuse rather than guess', () => {
  it('when no remaining side can check the survivor, it says the cube is too symmetric', () => {
    // Found by seeded search: after honestly confirming R and L, exactly this cube at exactly
    // these shown rotations leaves readings nothing further can tell apart.
    const truth = scrambleFacelets("L R' F' B");
    const shown = shownAs(truth, [0, 2, 1, 2, 2, 0]);
    let confirmed: Partial<Record<Face, ColorFace>> = {};
    let r = assembleColors(shown, 0.15, confirmed);
    for (let round = 0; round < 4 && r.confirm; round++) {
      confirmed = { ...confirmed, [r.confirm.face]: canonical(truth, r.confirm.face) };
      r = assembleColors(shown, 0.15, confirmed);
    }
    expect(r.valid).toBe(false);
    expect(r.confirm).toBeUndefined();
    expect(r.ambiguous).toBe(true);
    expect(r.reason).toMatch(/too symmetric/);
  });

  it('throws loudly on a malformed face rather than assembling nonsense', () => {
    const f = faces(SOLVED_FACELETS);
    f.U = { colors: [0, 0, 0], confidence: [1, 1, 1] };
    expect(() => assembleColors(f)).toThrow(/expected 9 colours/);
  });
});

describe('assemblePainted', () => {
  it('accepts a hand-painted legal cube exactly as painted — no rotation search', () => {
    const truth = scrambleFacelets("F R U' L2 D B");
    const r = assemblePainted(faces(truth));
    expect(r.valid).toBe(true);
    expect(r.facelets).toBe(truth);
  });

  it('rejects two faces painted with the same centre colour', () => {
    const f = faces(SOLVED_FACELETS);
    f.R.colors[4] = f.U.colors[4]!;
    const r = assemblePainted(f);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/centre/);
  });

  it('rejects a sticker painted a colour no centre has', () => {
    // Only reachable if a caller feeds classes outside 0..5 — the panel never does, but the
    // validator must not place an unplaceable sticker silently.
    const f = faces(SOLVED_FACELETS);
    f.U.colors[0] = 17;
    const r = assemblePainted(f);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/centre colours/);
  });

  it('rejects an unsolvable painting with "keep painting", not a misread accusation', () => {
    const f = faces(SOLVED_FACELETS);
    f.U.colors[0] = LETTER_CLASS.R;
    f.R.colors[0] = LETTER_CLASS.U; // counts stay 9/9 but the state is illegal
    const r = assemblePainted(f);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/keep painting/);
  });

  it('flags low-confidence stickers below the threshold', () => {
    const f = faces(SOLVED_FACELETS);
    f.D.confidence[3] = 0.05;
    const r = assemblePainted(f, 0.15);
    expect(r.valid).toBe(true);
    expect(r.lowConfidence).toContain(27 + 3); // D is the 4th face: global index 27..35
    expect(r.confidence).toBeCloseTo(0.05);
  });

  it('throws loudly on a malformed face', () => {
    const f = faces(SOLVED_FACELETS);
    f.B = { colors: [], confidence: [] };
    expect(() => assemblePainted(f)).toThrow(/expected 9 colours/);
  });
});
