import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import { type ColorFace, resolveCentreCollision } from '../src/ai-assemble.js';
import { assignNineOfEach } from '../src/nine-of-each.js';
import { type Colour, colourOfSlot, slotOf } from '../src/scheme.js';
import { FACES, type Face } from '../src/types.js';
import { CENTRE_COLLISIONS } from './fixtures/centre-collisions.js';

const LETTER_CLASS: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const DEEP = new Cube().move("R U F2 D' L B R2 F D U2 L2 B'").asString();

/** A facelet string as six captures keyed by slot, canonical rotation, no scores. */
function capturesOf(facelets: string): Record<Face, ColorFace> {
  const out = {} as Record<Face, ColorFace>;
  FACES.forEach((face, fi) => {
    const colors = [...facelets.slice(fi * 9, fi * 9 + 9)].map((l) => LETTER_CLASS[l as Face]!);
    out[face] = { colors, confidence: Array<number>(9).fill(0.9) };
  });
  return out;
}

/** File captures in arrival order, as the panel does: the first of a colour takes the slot. */
function fileInOrder(captures: readonly ColorFace[]): {
  filed: Partial<Record<Face, ColorFace>>;
  newcomers: ColorFace[];
} {
  const filed: Partial<Record<Face, ColorFace>> = {};
  const newcomers: ColorFace[] = [];
  for (const capture of captures) {
    const slot = slotOf(capture.colors[4] as Colour);
    if (filed[slot]) newcomers.push(capture);
    else filed[slot] = capture;
  }
  return { filed, newcomers };
}

/** The white side with its centre read as blue — a blue logo printed on the white cap. */
function whiteReadAsBlue(faces: Record<Face, ColorFace>): ColorFace {
  const colors = [...faces.U.colors];
  colors[4] = LETTER_CLASS.B;
  return { ...faces.U, colors };
}

describe('resolveCentreCollision — the seven collisions measured on real cubes', () => {
  it.each(CENTRE_COLLISIONS)('$name: resolves to the cube as it physically was', (c) => {
    const { filed, newcomers } = fileInOrder(c.captures);
    expect(newcomers).toHaveLength(1);
    expect(Object.keys(filed)).toHaveLength(5);

    const resolution = resolveCentreCollision(filed, newcomers[0]!);

    expect(resolution.result.valid).toBe(true);
    expect(resolution.result.facelets).toBe(c.truth);
    expect(Object.keys(resolution.faces ?? {})).toHaveLength(6);
  });

  it('never needed the detector to prefer the true filing — the counts alone would have chosen wrong', () => {
    // The docstring's claim, pinned: across the seven, the cheaper nine-of-each repair was the true
    // filing's in NONE of them. This is why legality, not repair cost, picks the filing — a resolver
    // that "optimised" by taking the cheaper repair would fail six of the cases above.
    let trueCheaper = 0;
    let wrongCheaper = 0;
    for (const c of CENTRE_COLLISIONS) {
      const { filed, newcomers } = fileInOrder(c.captures);
      const newcomer = newcomers[0]!;
      const shared = slotOf(newcomer.colors[4] as Colour);
      const missing = FACES.find((f) => !filed[f])!;
      const costWhenCertain = (recoloured: ColorFace): number => {
        const all = FACES.flatMap((f) => {
          const cap = f === shared || f === missing ? null : filed[f]!;
          return cap ? [cap] : [];
        });
        const pair =
          recoloured === newcomer ? [filed[shared]!, newcomer] : [newcomer, filed[shared]!];
        const scores = [...all, ...pair].flatMap((cap) =>
          cap.scores!.map((row, i) =>
            cap === recoloured && i === 4
              ? row.map((_, k) => (k === colourOfSlot(missing) ? 1 : 0))
              : row,
          ),
        );
        return assignNineOfEach(scores).cost;
      };
      const resolution = resolveCentreCollision(filed, newcomer);
      const newcomerIsMissing = resolution.faces![missing]!.colors.every(
        (colour, i) => i === 4 || colour === newcomer.colors[i],
      );
      const costTrue = costWhenCertain(newcomerIsMissing ? newcomer : filed[shared]!);
      const costWrong = costWhenCertain(newcomerIsMissing ? filed[shared]! : newcomer);
      if (costTrue < costWrong - 1e-6) trueCheaper++;
      if (costWrong < costTrue - 1e-6) wrongCheaper++;
    }
    expect(trueCheaper).toBe(0);
    expect(wrongCheaper).toBeGreaterThanOrEqual(6);
  });
});

describe('resolveCentreCollision — on a synthetic cube', () => {
  it('accepts the true cube when the logo side arrives after the blue side', () => {
    const faces = capturesOf(DEEP);
    const { U: _white, ...filed } = faces;
    const resolution = resolveCentreCollision(filed, whiteReadAsBlue(faces));
    expect(resolution.result.valid).toBe(true);
    expect(resolution.result.facelets).toBe(DEEP);
    // The white side is filed as white, with its centre put right.
    expect(resolution.faces!.U.colors[4]).toBe(LETTER_CLASS.U);
  });

  it('accepts the true cube when the logo side was filed first, under blue', () => {
    // The white side arrived first and was filed under BLUE; the real blue side is the newcomer.
    const faces = capturesOf(DEEP);
    const { U: _white, B: blue, ...rest } = faces;
    const filed = { ...rest, B: whiteReadAsBlue(faces) };
    const resolution = resolveCentreCollision(filed, blue);
    expect(resolution.result.valid).toBe(true);
    expect(resolution.result.facelets).toBe(DEEP);
    expect(resolution.faces!.B.colors).toEqual(faces.B.colors);
  });

  it('refuses, naming both slots, when neither filing is a legal cube — and guesses nothing', () => {
    // Two outer stickers of different colours swapped on the green side: every colour still counts
    // nine, so no repair can move anything, and no rotation can undo a swap between two cubies.
    const faces = capturesOf(DEEP);
    const green = faces.F.colors;
    const j = [1, 2, 3, 5, 6, 7, 8].find((k) => green[k] !== green[0])!;
    [green[0], green[j]] = [green[j]!, green[0]!];
    const { U: _white, ...filed } = faces;

    const resolution = resolveCentreCollision(filed, whiteReadAsBlue(faces));

    expect(resolution.result.valid).toBe(false);
    expect(resolution.result.centreConflict).toEqual({
      shared: 'B',
      missing: 'U',
      legalFilings: 0,
    });
    expect(resolution.faces).toBeUndefined();
  });

  it('refuses input that is not a centre collision rather than inventing one', () => {
    const faces = capturesOf(DEEP);
    // All six already filed: nothing is unclaimed.
    expect(resolveCentreCollision(faces, whiteReadAsBlue(faces)).result.valid).toBe(false);
    // The newcomer's centre is shared with nothing filed.
    const { U: white, ...filed } = faces;
    expect(resolveCentreCollision(filed, white).result.valid).toBe(false);
    expect(resolveCentreCollision(filed, white).result.centreConflict).toBeUndefined();
  });
});

describe('resolveCentreCollision — when both filings are legal cubes', () => {
  it('refuses rather than choosing, and says both were legal', () => {
    // Found by exhaustive search over near-solved cubes: a half turn of U leaves U and D uniform, so a
    // yellow side whose centre reads white is a legal cube filed either way. Measured: 120 of 4,568
    // contests on cubes 0-2 moves from solved refuse like this; none of 1,792 on deep scrambles did,
    // and no wrong cube was accepted in either set.
    const state = new Cube().move('U2').asString();
    const { D: yellow, ...filed } = capturesOf(state);
    const colors = [...yellow.colors];
    colors[4] = LETTER_CLASS.U;

    const resolution = resolveCentreCollision(filed, { ...yellow, colors });

    expect(resolution.result.valid).toBe(false);
    expect(resolution.result.centreConflict).toEqual({
      shared: 'U',
      missing: 'D',
      legalFilings: 2,
    });
    expect(resolution.faces).toBeUndefined();
  });
});
