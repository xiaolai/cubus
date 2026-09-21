import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import { type ColorFace, resolveCentres, type UnnamedSide } from '../src/ai-assemble.js';
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

/**
 * File captures in arrival order, as the panel does: a side is named by its centre, and a colour two
 * sides claim leaves BOTH of them unnamed, in the order they arrived.
 */
function fileInOrder(captures: readonly ColorFace[]): {
  named: Partial<Record<Face, ColorFace>>;
  unnamed: ColorFace[];
} {
  const named: Partial<Record<Face, ColorFace>> = {};
  const unnamed: ColorFace[] = [];
  for (const capture of captures) {
    const slot = slotOf(capture.colors[4] as Colour);
    const holder = named[slot];
    if (holder) {
      delete named[slot];
      unnamed.push(holder);
    }
    if (holder || unnamed.some((u) => u.colors[4] === capture.colors[4])) unnamed.push(capture);
    else named[slot] = capture;
  }
  return { named, unnamed };
}

/** Each capture as an unnamed side, with the confidence its own centre was read at. */
const asUnnamed = (captures: readonly ColorFace[]): UnnamedSide[] =>
  captures.map((capture) => ({ capture, centreConfidence: capture.confidence[4]! }));

/** `capture` with its centre read at `confidence`. */
function centreAt(capture: ColorFace, confidence: number): ColorFace {
  const out = [...capture.confidence];
  out[4] = confidence;
  return { ...capture, confidence: out };
}

/** `capture` with its centre read as `colour` — a logo on the cap, or a red read as orange. */
function centreReadAs(capture: ColorFace, colour: number): ColorFace {
  const colors = [...capture.colors];
  colors[4] = colour;
  return { ...capture, colors };
}

/**
 * Two outer stickers of different colours swapped on one side — their scores and confidences with
 * them, so the evidence agrees with the swap and no score-guided repair can quietly swap them back.
 * Every colour still counts nine, and no rotation can undo a swap between two cubies: no filing is legal.
 */
function swapTwo(capture: ColorFace): ColorFace {
  const colors = [...capture.colors];
  const confidence = [...capture.confidence];
  const scores = capture.scores?.map((row) => [...row]);
  const j = [1, 2, 3, 5, 6, 7, 8].find((k) => colors[k] !== colors[0])!;
  [colors[0], colors[j]] = [colors[j]!, colors[0]!];
  [confidence[0], confidence[j]] = [confidence[j]!, confidence[0]!];
  if (scores) [scores[0], scores[j]] = [scores[j]!, scores[0]!];
  return { ...capture, colors, confidence, ...(scores ? { scores } : {}) };
}

/** Which slot each unnamed capture was filed in — by its outer stickers, which filing never changes. */
function slotsOf(faces: Record<Face, ColorFace>, unnamed: readonly ColorFace[]): Face[] {
  return unnamed.map(
    (u) =>
      FACES.find((f) =>
        faces[f].colors.every((colour, i) => i === 4 || colour === u.colors[i]),
      ) as Face,
  );
}

describe('resolveCentres — the seven collisions measured on real cubes', () => {
  it.each(CENTRE_COLLISIONS)('$name: resolves to the cube as it physically was', (c) => {
    const { named, unnamed } = fileInOrder(c.captures);
    expect(unnamed).toHaveLength(2);
    expect(Object.keys(named)).toHaveLength(4);

    const resolution = resolveCentres(named, asUnnamed(unnamed));

    expect(resolution.result.valid).toBe(true);
    expect(resolution.result.facelets).toBe(c.truth);
    expect(resolution.decidedBy).toBe('legality');
    expect(Object.keys(resolution.faces ?? {})).toHaveLength(6);
  });

  it('never needed the detector to prefer the true filing — the counts alone would have chosen wrong', () => {
    // The docstring's claim, pinned: across the seven, the cheaper nine-of-each repair was the true
    // filing's in NONE of them. This is why legality, not repair cost, picks the filing — a resolver
    // that "optimised" by taking the cheaper repair would fail six of the cases above.
    let trueCheaper = 0;
    let wrongCheaper = 0;
    for (const c of CENTRE_COLLISIONS) {
      const { named, unnamed } = fileInOrder(c.captures);
      const [first, second] = unnamed as [ColorFace, ColorFace];
      const shared = slotOf(first.colors[4] as Colour);
      const missing = FACES.find((f) => f !== shared && !named[f])!;
      const costWhenCertain = (recoloured: ColorFace): number => {
        const scores = [...Object.values(named), first, second].flatMap((cap) =>
          cap.scores!.map((row, i) =>
            cap === recoloured && i === 4
              ? row.map((_, k) => (k === colourOfSlot(missing) ? 1 : 0))
              : row,
          ),
        );
        return assignNineOfEach(scores).cost;
      };
      const resolution = resolveCentres(named, asUnnamed(unnamed));
      const [firstSlot] = slotsOf(resolution.faces!, [first]);
      const misread = firstSlot === missing ? first : second;
      const costTrue = costWhenCertain(misread);
      const costWrong = costWhenCertain(misread === first ? second : first);
      if (costTrue < costWrong - 1e-6) trueCheaper++;
      if (costWrong < costTrue - 1e-6) wrongCheaper++;
    }
    expect(trueCheaper).toBe(0);
    expect(wrongCheaper).toBeGreaterThanOrEqual(6);
  });

  it('names the misread centre by its confidence on all seven, when something else is misread too', () => {
    // The fallback's evidence, pinned on real reads. Each case gets a second fault no filing survives
    // — two stickers swapped on a side whose centre is not in question — so legality has nothing left
    // to say, and only the centres' own confidence can pick which reading to put in front of the
    // person. On every case it picks the filing legality picked on the clean captures.
    for (const c of CENTRE_COLLISIONS) {
      const { named, unnamed } = fileInOrder(c.captures);
      const truth = slotsOf(resolveCentres(named, asUnnamed(unnamed)).faces!, unnamed);

      const bystander = FACES.find((f) => named[f])!;
      const broken = { ...named, [bystander]: swapTwo(named[bystander]!) };
      const resolution = resolveCentres(broken, asUnnamed(unnamed));

      expect(resolution.decidedBy, c.name).toBe('confidence');
      expect(resolution.result.valid, c.name).toBe(false); // a reading chosen, never a cube
      expect(slotsOf(resolution.faces!, unnamed), c.name).toEqual(truth);
    }
  });
});

describe('resolveCentres — on a synthetic cube', () => {
  it('accepts the true cube when the logo side arrives after the blue side', () => {
    const faces = capturesOf(DEEP);
    const logo = centreReadAs(faces.U, LETTER_CLASS.B);
    const { U: _white, B: _blue, ...named } = faces;
    const resolution = resolveCentres(named, asUnnamed([faces.B, logo]));
    expect(resolution.result.valid).toBe(true);
    expect(resolution.result.facelets).toBe(DEEP);
    // The white side is filed as white, with its centre put right.
    expect(resolution.faces!.U.colors[4]).toBe(LETTER_CLASS.U);
  });

  it('accepts the true cube when the logo side arrived first', () => {
    const faces = capturesOf(DEEP);
    const logo = centreReadAs(faces.U, LETTER_CLASS.B);
    const { U: _white, B: _blue, ...named } = faces;
    const resolution = resolveCentres(named, asUnnamed([logo, faces.B]));
    expect(resolution.result.valid).toBe(true);
    expect(resolution.result.facelets).toBe(DEEP);
    expect(resolution.faces!.B.colors).toEqual(faces.B.colors);
  });

  it('takes two collisions at once, which a one-contest design could not', () => {
    // A logo on the white cap read as blue AND a red centre read as orange: four sides unnamed, four
    // slots free, 24 filings — and legality still leaves exactly one.
    const faces = capturesOf(DEEP);
    const logo = centreReadAs(faces.U, LETTER_CLASS.B);
    const redAsOrange = centreReadAs(faces.R, LETTER_CLASS.L);
    const { U: _u, R: _r, L: _l, B: _b, ...named } = faces;
    const resolution = resolveCentres(named, asUnnamed([logo, faces.B, redAsOrange, faces.L]));
    expect(resolution.result.valid).toBe(true);
    expect(resolution.result.facelets).toBe(DEEP);
    expect(resolution.decidedBy).toBe('legality');
  });

  describe('when no filing is a legal cube', () => {
    const faces = capturesOf(DEEP);
    const { U: _white, B: _blue, F: green, ...rest } = faces;
    const named = { ...rest, F: swapTwo(green) };

    it('takes the side whose centre read less surely as the misread one, and still refuses', () => {
      const logo = centreAt(centreReadAs(faces.U, LETTER_CLASS.B), 0.6);
      const resolution = resolveCentres(named, asUnnamed([faces.B, logo]));
      expect(resolution.decidedBy).toBe('confidence');
      expect(resolution.result.valid).toBe(false);
      expect(resolution.faces!.U.colors).toEqual(faces.U.colors); // the logo side, filed as white
      expect(resolution.faces!.B.colors).toEqual(faces.B.colors);
    });

    it('whichever order the two arrived in', () => {
      const logo = centreAt(centreReadAs(faces.U, LETTER_CLASS.B), 0.6);
      const resolution = resolveCentres(named, asUnnamed([logo, faces.B]));
      expect(resolution.faces!.U.colors).toEqual(faces.U.colors);
    });

    it('refuses, naming both slots, when the centres read equally surely — and guesses nothing', () => {
      const logo = centreReadAs(faces.U, LETTER_CLASS.B); // 0.9, as surely as the real blue
      const resolution = resolveCentres(named, asUnnamed([faces.B, logo]));
      expect(resolution.result.valid).toBe(false);
      expect(resolution.result.centreConflict).toEqual({
        shared: 'B',
        missing: 'U',
        legalFilings: 0,
      });
      expect(resolution.faces).toBeUndefined();
    });

    it('refuses when two sides are misread, because confidence cannot say which unclaimed colour is whose', () => {
      const logo = centreAt(centreReadAs(faces.U, LETTER_CLASS.B), 0.6);
      const redAsOrange = centreAt(centreReadAs(faces.R, LETTER_CLASS.L), 0.6);
      const { R: _r, L: _l, ...fewer } = named;
      const resolution = resolveCentres(fewer, asUnnamed([logo, faces.B, redAsOrange, faces.L]));
      expect(resolution.faces).toBeUndefined();
      expect(resolution.result.centreConflict?.legalFilings).toBe(0);
    });
  });

  it('refuses a centre the detector cannot produce rather than filing it anywhere', () => {
    const faces = capturesOf(DEEP);
    const { U: white, B: blue, ...named } = faces;
    const resolution = resolveCentres(named, asUnnamed([centreReadAs(white, 7), blue]));
    expect(resolution.result.valid).toBe(false);
    expect(resolution.result.reason).toMatch(/not one of the six/);
    expect(resolution.faces).toBeUndefined();
  });

  it('refuses input that is not a centre collision rather than inventing one', () => {
    const faces = capturesOf(DEEP);
    const logo = centreReadAs(faces.U, LETTER_CLASS.B);
    // All six already named: nothing is free.
    expect(resolveCentres(faces, asUnnamed([logo])).result.valid).toBe(false);
    // More unnamed sides than free slots.
    const { U: white, ...five } = faces;
    const { B: blue, ...four } = five;
    expect(resolveCentres(four, asUnnamed([logo, blue, faces.R])).result.valid).toBe(false);
    void white;
    expect(
      resolveCentres(four, asUnnamed([logo, blue, faces.R])).result.centreConflict,
    ).toBeUndefined();
  });
});

describe('resolveCentres — what it says about where each side went, and what it counts (2026-09-21)', () => {
  it('`placed` names the unnamed side each free slot took, including one whose centre was rewritten', () => {
    // A filing REBUILDS a capture whenever its centre changes, so a caller matching the filed
    // captures to its own by identity found nothing for exactly the reassigned-centre case — the
    // logo side — and the record it keeps about that side stayed on an object nothing held.
    const faces = capturesOf(DEEP);
    const logo = centreReadAs(faces.U, LETTER_CLASS.B);
    const { U: _white, B: _blue, ...named } = faces;
    const resolution = resolveCentres(named, asUnnamed([faces.B, logo]));
    expect(resolution.decidedBy).toBe('legality');
    expect(resolution.placed).toEqual({ B: 0, U: 1 });
    expect(resolution.faces!.B).toBe(faces.B); // its centre was right: the same object
    expect(resolution.faces!.U).not.toBe(logo); // its centre was put right: a copy
    expect(resolution.faces!.U.colors.filter((_, i) => i !== 4)).toEqual(
      logo.colors.filter((_, i) => i !== 4),
    );
  });

  it('…on the counting path and the confidence path too', () => {
    const faces = capturesOf(DEEP);
    const { U: white, ...five } = faces;
    const counted = resolveCentres(five, asUnnamed([centreReadAs(white, LETTER_CLASS.B)]));
    expect(counted.decidedBy).toBe('counting');
    expect(counted.placed).toEqual({ U: 0 });

    const { U: _u, B: _b, F: green, ...rest } = faces;
    const broken = { ...rest, F: swapTwo(green) };
    const logo = centreAt(centreReadAs(faces.U, LETTER_CLASS.B), 0.6);
    const byConf = resolveCentres(broken, asUnnamed([faces.B, logo]));
    expect(byConf.decidedBy).toBe('confidence');
    expect(byConf.placed).toEqual({ B: 0, U: 1 });
  });

  it('a refusal for unread centres counts only the sides whose centre never settled', () => {
    // `unnamed.length` counted a side that DID claim a colour and merely could not be placed, so
    // "the middle stickers of 2 sides kept changing" was said about one.
    const faces = capturesOf(DEEP);
    const { U: white, D: yellow, F: green, ...rest } = faces;
    const named = { ...rest, F: swapTwo(green) }; // no filing is legal
    const unnamed: UnnamedSide[] = [
      { capture: yellow, centreClaim: LETTER_CLASS.D as Colour, centreConfidence: 0.9 },
      { capture: white, centreClaim: null, centreConfidence: 0.5 },
    ];
    const resolution = resolveCentres(named, unnamed);
    expect(resolution.faces).toBeUndefined();
    expect(resolution.result.unreadCentres).toBe(1);
    expect(resolution.result.centreConflict).toBeUndefined();
  });

  it('with no unread side and no two claims alike, it names a conflict — never "0 sides" unread', () => {
    const faces = capturesOf(DEEP);
    const { U: white, D: yellow, F: green, ...rest } = faces;
    const named = { ...rest, F: swapTwo(green) };
    const unnamed: UnnamedSide[] = [
      { capture: white, centreClaim: LETTER_CLASS.U as Colour, centreConfidence: 0.9 },
      { capture: yellow, centreClaim: LETTER_CLASS.D as Colour, centreConfidence: 0.9 },
    ];
    const resolution = resolveCentres(named, unnamed);
    expect(resolution.result.unreadCentres).toBeUndefined();
    expect(resolution.result.centreConflict?.legalFilings).toBe(0);
  });
});

describe('resolveCentres — one unnamed side, one free slot', () => {
  it('places it: six centres, five taken, so the colour is forced', () => {
    // The case the logo fix creates (2026-09-20). A white cap with a blue logo never settles on a
    // centre colour, so the panel holds that side unnamed rather than filing it as blue — and it
    // collides with nobody, because it claims nothing. One unnamed side used to be refused outright,
    // which meant the scan ended with "start over" on the one cube this mechanism was built for.
    const faces = capturesOf(DEEP);
    const { U: white, ...five } = faces;
    // The centre reads as anything at all — the point is that it is NOT trusted.
    const unread = centreReadAs(white, LETTER_CLASS.B);
    const resolved = resolveCentres(five, asUnnamed([unread]));
    expect(resolved.result.valid).toBe(true);
    // Placed in the one free slot, with its centre made certain rather than left as it read.
    expect(resolved.faces?.U.colors[4]).toBe(LETTER_CLASS.U);
  });

  it('is forced, not unchecked: a side that cannot make a legal cube is still refused', () => {
    // "Forced" decides WHICH SLOT, never whether the cube is real. A capture whose eight cannot
    // belong to the free slot has to come back refused, or this mechanism would launder any reading
    // into a cube by arithmetic alone.
    const faces = capturesOf(DEEP);
    const { U: _white, ...five } = faces;
    const wrong = { ...faces.R, colors: faces.R.colors.map(() => LETTER_CLASS.R) };
    expect(resolveCentres(five, asUnnamed([wrong])).result.valid).toBe(false);
  });
});

describe('resolveCentres — when both filings are legal cubes', () => {
  it('refuses rather than choosing, and says both were legal', () => {
    // Found by exhaustive search over near-solved cubes: a half turn of U leaves U and D uniform, so a
    // yellow side whose centre reads white is a legal cube filed either way. Measured: 120 of 4,568
    // contests on cubes 0-2 moves from solved refuse like this; none of 1,792 on deep scrambles did,
    // and no wrong cube was accepted in either set.
    const state = new Cube().move('U2').asString();
    const faces = capturesOf(state);
    const { U: white, D: yellow, ...named } = faces;
    const yellowAsWhite = centreReadAs(yellow, LETTER_CLASS.U);

    const resolution = resolveCentres(named, asUnnamed([white, yellowAsWhite]));

    expect(resolution.result.valid).toBe(false);
    expect(resolution.result.centreConflict).toEqual({
      shared: 'U',
      missing: 'D',
      legalFilings: 2,
    });
    expect(resolution.faces).toBeUndefined();
  });
});
