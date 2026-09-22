import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import {
  type AiScanResult,
  assembleColors,
  assemblePainted,
  type ColorFace,
  type Confirmation,
  type Confirmed,
  matchingRotations,
  reobserved,
} from '../src/ai-assemble.js';
import { rotateFace, SOLVED_FACELETS } from '../src/facelet-cube.js';
import {
  adjacentIn,
  type Colour,
  colourOf,
  colourOfSlot,
  holdOffset,
  positionOf,
  SCHEMES,
  type Scheme,
  slotOf,
} from '../src/scheme.js';
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

  it('refuses a centre colour class the detector cannot produce, in both assemblers', () => {
    // A CENTRE NAMES A FACE, so an out-of-range one is silently accepted as the name of one.
    // Replacing all nine U stickers with class 17 built the map `17 -> U`, every one of them then
    // resolved through it, and BOTH entry points returned `valid: true` for a facelet string
    // assembled out of a colour class no model emits. NaN is the worse half: `Map` matches it to
    // itself, so it works exactly as well as a real class. This is "Never invent data" at the one
    // seam where the detector's output stops being checked — the ordinary stickers are deliberately
    // left alone, because an unknown colour THERE is a statement about the cube.
    for (const bad of [17, Number.NaN, -1, 2.5]) {
      const f = faces(SOLVED_FACELETS);
      f.U.colors = Array(9).fill(bad) as number[];
      for (const assemble of [assembleColors, assemblePainted]) {
        const r = assemble(f);
        expect(r.valid, `${assemble.name} accepted centre class ${bad}`).toBe(false);
        expect(r.reason).toMatch(/centre colour/);
      }
    }
  });

  it('still lets an unreadable ORDINARY sticker say what it says about the cube', () => {
    // The other side of the rule above: a non-centre sticker that is not one of the six centre
    // colours is refused in words a child can act on, not as malformed input.
    const f = faces(SOLVED_FACELETS);
    f.U.colors[0] = 9;
    const r = assemblePainted(f);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/not one of the six centre colours/);
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
/** The colour painted on a facelet letter (a position) on a cube of the given scheme. */
const paint = (letter: string, scheme: Scheme): Colour => colourOf(letter as Face, scheme);

/**
 * The six captures a camera makes of a cube in state `facelets` painted in `scheme`, each shown
 * at its own rotation, FILED BY COLOUR the way the panel files them: under `FACES[centre]`. For
 * a Western cube this is `faces()` turned; for a Japanese cube the blue capture lands in slot B
 * and the yellow one in slot D whatever their positions, which is the whole point.
 */
function capturesOf(
  facelets: string,
  scheme: Scheme,
  rots: number[] = [0, 0, 0, 0, 0, 0],
): Record<Face, ColorFace> {
  const out = {} as Record<Face, ColorFace>;
  FACES.forEach((_position, fi) => {
    const colors = rot(
      [...facelets.slice(fi * 9, fi * 9 + 9)].map((l) => paint(l, scheme)),
      rots[fi]!,
    );
    out[slotOf(colors[4] as Colour)] = { colors, confidence: Array(9).fill(1) };
  });
  return out;
}

/**
 * What a camera sees of the side in `slot` when a cube of `scheme` is held with the `up` colour
 * upwards — the canonical capture turned by the hold's physical offset — optionally mis-held by a
 * further quarter turn. Built from the geometry, not from the assembler, so the projection the
 * assembler does is tested against a construction and not against itself.
 */
function heldOf(facelets: string, scheme: Scheme, slot: Face, up: Face, misHold = 0): ColorFace {
  const position = positionOf(colourOfSlot(slot), scheme);
  const fi = FACES.indexOf(position);
  const canonicalColors = [...facelets.slice(fi * 9, fi * 9 + 9)].map((l) => paint(l, scheme));
  const offset = holdOffset(colourOfSlot(slot), colourOfSlot(up), scheme);
  if (offset === null)
    throw new Error(`impossible hold: ${slot} with ${up} up on a ${scheme} cube`);
  return { colors: rot(canonicalColors, offset + misHold), confidence: Array(9).fill(1) };
}

/** A confirmation as the assembler takes it: the held capture and the hold it answered. */
const answer = (
  facelets: string,
  scheme: Scheme,
  req: { face: Face; up: Face },
  misHold = 0,
): Confirmation => ({
  capture: heldOf(facelets, scheme, req.face, req.up, misHold),
  up: req.up,
});

/** The canonical (correctly held) capture of one side of a WESTERN cube, held white-up for a
 *  side face and as its canonical top neighbour dictates otherwise — what `up` the assembler
 *  asks for on a Western-only scan. */
const canonical = (facelets: string, face: Face, misHold = 0): ColorFace => ({
  colors: rot(faces(facelets)[face]!.colors, misHold),
  confidence: Array(9).fill(1),
});

/** Show all six sides at the given rotations, the way a user holds them: any way up. */
const shownAs = (facelets: string, rots: number[]): Record<Face, ColorFace> =>
  capturesOf(facelets, 'western', rots);

/**
 * Answer every `confirm` request the way a cube of `scheme` would be held, optionally mis-holding
 * the nth one. Returns the final result and how many looks it took.
 */
function scanAs(truth: string, scheme: Scheme, rots: number[], misHoldNth = -1) {
  const shown = capturesOf(truth, scheme, rots);
  // Looks ACCUMULATE per slot, as the panel keeps them (2026-09-20): a slot may be looked at twice,
  // under two holds, and a caller that overwrote the first with the second would be asked again.
  let confirmed: Confirmed = {};
  let looks = 0;
  for (let round = 0; round < 12; round++) {
    const r = assembleColors(shown, 0.15, confirmed);
    if (r.valid || !r.confirm) return { ...r, looks };
    if (r.mismatch) {
      confirmed = {};
      continue;
    }
    const given = confirmed[r.confirm.face];
    const before = given === undefined ? [] : Array.isArray(given) ? given : [given];
    confirmed = {
      ...confirmed,
      [r.confirm.face]: [...before, answer(truth, scheme, r.confirm, looks === misHoldNth ? 1 : 0)],
    };
    looks++;
  }
  const gaveUp: AiScanResult & { looks: number } = {
    valid: false,
    facelets: '',
    looks,
    reason: 'gave up',
  };
  return gaveUp;
}

/** `scanAs` for the Western cube every pre-existing fixture is. */
const scanWithConfirmations = (truth: string, rots: number[], misHoldNth = -1) =>
  scanAs(truth, 'western', rots, misHoldNth);

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
    let accepted = 0;
    for (const [alg, rots] of CASES) {
      const truth = scrambleFacelets(alg);
      const r = scanWithConfirmations(truth, rots, 0);
      // Refusing is fine. Returning someone else's cube is not.
      if (r.valid) {
        accepted++;
        expect(`${alg}: ${r.facelets}`).toBe(`${alg}: ${truth}`);
      }
    }
    // A conditional assertion needs a witness that the condition ever held, or a regression that
    // simply refuses everything passes this test while proving nothing about what it accepts.
    expect(accepted).toBeGreaterThan(0);
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
    const cap = heldOf(oneTurn, 'western', first.confirm!.face, first.confirm!.up);
    cap.colors[0] = (cap.colors[0]! + 1) % 6; // the second look flips one sticker
    const second = assembleColors(shown, 0.15, {
      [first.confirm!.face]: { capture: cap, up: first.confirm!.up },
    });
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
    const up = first.confirm!.up;
    const cap = heldOf(oneTurn, 'western', face, up);
    for (const i of [0, 1, 2, 3]) cap.colors[i] = (cap.colors[i]! + 1) % 6; // 4 disagreements
    const r = assembleColors(shown, 0.15, { [face]: { capture: cap, up } });
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

  it('a reading one change from legal is not always one sticker, and is not accused', () => {
    // The counterexample `misread-decode.test.ts` measures, taken to the surface the user sees.
    //
    // A solved cube read with two of the U-layer 3-cycle's three stickers sits ONE change from a
    // legal cube that is not the user's. Before this was pinned, `distance === 1` alone licensed
    // pointing, and the app marked FOUR stickers — every quarter turn of a rotationally symmetric
    // face names a different as-shown index for the same repair — under a heading reading "One
    // sticker looks wrong". Three of the four had been read correctly, and applying any of them
    // does not give back the cube in the user's hand.
    const shown = faces(SOLVED_FACELETS);
    shown.F!.colors[1] = LETTER_CLASS.R; // the UF slot shows the UR piece's red sticker
    shown.L!.colors[1] = LETTER_CLASS.F; // the UL slot shows the UF piece's green sticker
    const r = assembleColors(shown);
    expect(r.valid).toBe(false);
    // A count is still honest — it is a proven lower bound, just a loose one here.
    expect(r.misreadCount).toBe(1);
    // An accusation is not.
    expect(r.suspects ?? []).toEqual([]);
  });

  it('a confidence that is not a number is refused, never averaged into one', () => {
    // `NaN < min` and `NaN < threshold` are both false, so 54 of them used to sail through as
    // `confidence: 1` with no low-confidence stickers — the module reporting perfect certainty
    // about a reading that carried none. A fabricated number is worse than a refusal.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.5, 1.5]) {
      const f = faces(SOLVED_FACELETS);
      f.U.confidence[3] = bad;
      expect(() => assembleColors(f)).toThrow(/confidence/);
      expect(() => assemblePainted(f)).toThrow(/confidence/);
    }
    // The legal range still passes, ends included.
    const ok = faces(SOLVED_FACELETS);
    ok.U.confidence[3] = 0;
    ok.R.confidence[3] = 1;
    expect(assembleColors(ok).valid).toBe(true);
  });

  it('a confirmation that is not nine stickers is refused, never matched by tolerance', () => {
    // A confirmation is USER INPUT arriving through the same public argument as the six sides, and
    // it was the one capture nobody checked. `matchingRotations` compares nine positions against
    // whatever array it is handed, so a SHORT one reads `undefined` at the missing indices — which
    // counts as at most two differences and therefore passes CONFIRM_TOLERANCE at some rotation.
    //
    // Measured before the check existed: seven colours and no confidences at all, fed as the answer
    // to every confirm request, narrowed a once-turned cube all the way to `valid: true` — on all
    // six of U, U', U R, D, U2 and R U'. The cube it returned happened to be the true one, which is
    // the worst version of the bug: an accepted reading whose deciding evidence was a rotation
    // measured from a capture that does not exist.
    //
    // It THROWS, like every other malformed capture here: a reject is a sentence shown to a child
    // about their cube, and a caller handing over a seven-sticker face is not making a claim about
    // a cube at all.
    const truth = scrambleFacelets('U');
    const shown = faces(truth);
    const ask = assembleColors(shown);
    const { face, up } = ask.confirm!;
    const short: ColorFace = { colors: faces(truth)[face]!.colors.slice(0, 7), confidence: [] };
    expect(() => assembleColors(shown, 0.15, { [face]: { capture: short, up } })).toThrow(
      new RegExp(`confirmation of ${face}`),
    );
    // A full-length confirmation whose confidences are not numbers is refused on the same rule.
    const nan: ColorFace = {
      colors: faces(truth)[face]!.colors,
      confidence: Array(9).fill(Number.NaN),
    };
    expect(() => assembleColors(shown, 0.15, { [face]: { capture: nan, up } })).toThrow(
      /confirmation of/,
    );
    // A confirmation without its hold is not a confirmation: the assembler cannot project it into
    // any scheme's frame, and a bare capture handed in the old way must not be quietly accepted.
    expect(() =>
      assembleColors(shown, 0.15, { [face]: canonical(truth, face) as unknown as Confirmation }),
    ).toThrow(/confirmation of/);
    // …and a well-formed one is still accepted, so the guard did not simply refuse everything.
    expect(() =>
      assembleColors(shown, 0.15, { [face]: answer(truth, 'western', ask.confirm!) }),
    ).not.toThrow();
  });

  it('a confirmation matches at every rotation inside the tolerance, not only the closest', () => {
    // CONFIRM_TOLERANCE grants two differing stickers. Keeping only the MINIMUM-distance rotations
    // was a second, stricter rule on top of it that undid the first: on this pair the distances
    // are [2, 8, 1, 8], so the true rotation at 2 — inside the tolerance — was discarded for one
    // that collides on a single sticker by chance. The confirmation then matched no candidate
    // reading at all, and a user who held the side exactly as asked was told they held it wrong.
    const face = (s: string) => ({
      colors: [...s].map((c) => LETTER_CLASS[c as Face]!),
      confidence: Array<number>(9).fill(1),
    });
    const original = face('BFRRRRRBB');
    const confirmed = face('BURRRRRFB');
    const dist = [0, 1, 2, 3].map((k) =>
      rot(original.colors, k).reduce((n, c, i) => n + (c === confirmed.colors[i] ? 0 : 1), 0),
    );
    expect(dist).toEqual([2, 8, 1, 8]); // the measurement the rule has to survive
    // Rotation 0 is the truth and sits inside the tolerance. Argmin would have kept only 2.
    expect([...matchingRotations(original, confirmed)].sort()).toEqual([0, 2]);

    // The tolerance is still a bound, not an invitation: when NO rotation comes within it the two
    // looks disagree about colours, which the caller turns into a `reread` rather than a hold.
    expect(matchingRotations(original, face('UUURRRUUU')).size).toBe(0);
    // And a different centre is a different FACE, whatever the distance says.
    expect(matchingRotations(original, face('BFRRURRBB')).size).toBe(0);
  });

  it('a lone suspect is a sticker to CHECK, and provably not a sticker known to be wrong', () => {
    // The limit of minimum-distance decoding, measured rather than argued, because the copy that
    // sits on top of it has to be true. `distance === 1` is a property of the READING, and it is
    // not a proof that one sticker was misread — nor do `unique` and a single named sticker make
    // it one, which is what the first attempt at this assumed.
    //
    // These two cubes are both legal and stand exactly three stickers apart (7, 21, 39). The
    // reading takes TWO of those three from the cube the user was NOT holding, so it sits two
    // stickers from theirs and one from the other. The decoder therefore names position 7 —
    // uniquely, with nothing to contradict it — and position 7 was read CORRECTLY.
    const user = 'DLDBUBDRBULLDRUDRFLULLFFURRFDFFDBBDRRDFFLUURLBFBBBUULR';
    const other = 'DLDBUBDLBULLDRUDRFLULFFFURRFDFFDBBDRRDFRLUURLBFBBBUULR';
    const reading = 'DLDBUBDRBULLDRUDRFLULFFFURRFDFFDBBDRRDFRLUURLBFBBBUULR';
    const differ = [...Array(54).keys()].filter((i) => user[i] !== other[i]);
    expect(differ).toEqual([7, 21, 39]); // the minimum distance between two legal cubes
    expect([...Array(54).keys()].filter((i) => user[i] !== reading[i])).toEqual([21, 39]);

    const r = assembleColors(faces(reading));
    expect(r.valid).toBe(false);
    // Honest, and loose: at least one sticker is wrong. Two are.
    expect(r.misreadCount).toBe(1);
    // It points at U7 — the sticker the camera got RIGHT — and taking its advice yields `other`,
    // a legal cube the user never held. Nothing in the reading distinguishes this from a genuine
    // single misread, so the app may say "changing this makes it solvable" and must never say
    // "this sticker is wrong". `ai-scan-panel.test.ts` pins the wording that rests on this.
    expect(r.suspects).toEqual([{ face: 'U', index: 7, to: LETTER_CLASS[other[7] as Face] }]);
    const repaired = [...reading];
    repaired[7] = other[7]!;
    expect(assembleColors(faces(repaired.join(''))).facelets).toBe(other);
  });

  it('anything messier than a single 10/8 imbalance gets no suspects rather than a guess', () => {
    const shown = shownAs(deep, [0, 0, 0, 0, 0, 0]);
    shown.F!.colors[0] = (shown.F!.colors[0]! + 1) % 6;
    shown.R!.colors[1] = (shown.R!.colors[1]! + 2) % 6;
    shown.L!.colors[3] = (shown.L!.colors[3]! + 3) % 6;
    const r = assembleColors(shown);
    // Unconditionally, and in this order. `if (!r.valid) expect(...)` was the whole of this test,
    // so the one regression that matters most — three misreads accepted as a cube the user never
    // held — skipped every assertion and the test still passed.
    expect(r.valid).toBe(false);
    expect(r.suspects ?? []).toEqual([]);
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
  it('when no FRESH side can check the survivor, it asks for a side already looked at, held another way up', () => {
    // Found by seeded search: after honestly confirming R and L, exactly this cube at exactly
    // these shown rotations leaves readings no OTHER side can tell apart. Until 2026-09-20 that was
    // the end — "too symmetric, turn any one face" — thrown at a user whose every look was honest,
    // because the verification wanted a second contradiction from a second SLOT and skipped the
    // slots already looked at. A second look at R under another colour up is a second photograph,
    // and the first look at R had already contradicted the impostor, so the side can tell them
    // apart; asked for, answered honestly, the true cube is accepted.
    const truth = scrambleFacelets("L R' F' B");
    const shown = shownAs(truth, [0, 2, 1, 2, 2, 0]);
    let confirmed: Confirmed = {};
    let r = assembleColors(shown, 0.15, confirmed);
    const asked: string[] = [];
    for (let round = 0; round < 8 && r.confirm; round++) {
      asked.push(`${r.confirm.face}/${r.confirm.up}`);
      const given = confirmed[r.confirm.face];
      const before = given === undefined ? [] : Array.isArray(given) ? given : [given];
      confirmed = {
        ...confirmed,
        [r.confirm.face]: [...before, answer(truth, 'western', r.confirm)],
      };
      r = assembleColors(shown, 0.15, confirmed);
    }
    // R and L each looked at twice, under two different holds, and never the same hold twice.
    expect(asked).toEqual(['R/U', 'L/U', 'R/F', 'L/F']);
    expect(r.valid).toBe(true);
    expect(r.facelets).toBe(truth);
  });

  it('a caller that keeps one look per side is asked for the SAME side once more and then no more', () => {
    // The old shape, `confirmed[face] = look`, overwrote: the assembler then sees one look at R
    // and asks for R again under the other hold — which the old-shape caller overwrites again. The
    // hold already given is never asked for twice (`permittedHold`), so the asks run out rather
    // than loop; the pinned bound is what a host that never upgraded its shape can rely on.
    const truth = scrambleFacelets("L R' F' B");
    const shown = shownAs(truth, [0, 2, 1, 2, 2, 0]);
    let confirmed: Confirmed = {};
    let r = assembleColors(shown, 0.15, confirmed);
    let rounds = 0;
    for (; rounds < 12 && r.confirm; rounds++) {
      confirmed = { ...confirmed, [r.confirm.face]: answer(truth, 'western', r.confirm) };
      r = assembleColors(shown, 0.15, confirmed);
    }
    expect(rounds).toBeLessThan(12);
  });

  it('when no look at all can tell the readings apart, it says the cube is too symmetric', () => {
    // A half-turn pattern: four readings, and every side reads the same under every hold within
    // the tolerance, so a first look at any side separates nothing — which is exactly the
    // condition under which a second look at it is NOT asked for (`mayLookAgain`). Honest looks
    // at three sides, and the honest answer is a turn and a fresh scan.
    const truth = scrambleFacelets("B2 U D'");
    const r = scanWithConfirmations(truth, [0, 0, 0, 0, 0, 0]);
    expect(r.valid).toBe(false);
    expect(r.confirm).toBeUndefined();
    expect(r.ambiguous).toBe(true);
    expect(r.reason).toMatch(/too symmetric/);
    expect(r.looks).toBeLessThanOrEqual(6);
  });

  it('two readings that differ on ONE side are settled by two looks at that side', () => {
    // The sharpest case of the audit (§3): one honest look at L decides it, and the old rule
    // then threw the scan away for want of a second slot to ask about.
    const truth = scrambleFacelets("R2 D2 F2 D2 B R2 D' U");
    const r = scanWithConfirmations(truth, [0, 0, 0, 0, 0, 0]);
    expect(r.valid).toBe(true);
    expect(r.facelets).toBe(truth);
    expect(r.looks).toBe(2);
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

  it('counts an unsolvable painting, and still accuses nobody above one sticker', () => {
    // This case used to assert the words "keep painting" and no diagnosis at all. The
    // no-accusation half was right and is kept — two wrong stickers have more than one possible
    // repair, so naming one would sometimes blame a sticker the user painted correctly. The
    // silence was the part that was wrong: it also withheld the count, which IS answerable and is
    // a proven lower bound.
    const f = faces(SOLVED_FACELETS);
    f.U.colors[0] = LETTER_CLASS.R;
    f.R.colors[0] = LETTER_CLASS.U; // counts stay 9/9 but the state is illegal
    const r = assemblePainted(f);
    expect(r.valid).toBe(false);
    expect(r.misreadCount).toBeGreaterThanOrEqual(2);
    expect(r.suspects ?? []).toEqual([]); // above distance 1 the repair is not unique
  });

  it('points at the one wrong sticker in a painting that is one from legal', () => {
    // The whole reason to diagnose a PAINTED cube: decodeMisread's guarantee is about the
    // colouring, not about who produced it. Two legal colourings are never closer than three
    // stickers, so at distance 1 the repair is unique whether a camera read it or a child painted
    // it — and "this sticker, make it that colour" is the difference between fixing a cube and
    // recounting all 54.
    const truth = scrambleFacelets("F R U' L2 D B");
    const f = faces(truth);
    const was = f.U.colors[0]!;
    f.U.colors[0] = (was + 1) % 6; // exactly one sticker away from a legal cube
    const r = assemblePainted(f);
    expect(r.valid).toBe(false);
    expect(r.misreadCount).toBe(1);
    expect(r.suspects).toEqual([{ face: 'U', index: 0, to: was }]);
  });

  it('a painted face turned 90 degrees is counted, not waved through as zero', () => {
    // The rotation search exists for the CAMERA, where a side is photographed however it was held.
    // A painted cube has no such freedom, and letting the decoder rotate a face back made it report
    // "0 stickers wrong" about a cube assemblePainted had just refused — measured on nine scrambles
    // with one face turned, all nine. Painting a face a quarter-turn off is an ordinary mistake, so
    // it is the case the diagnosis most needs to get right.
    const rot = (c: number[]): number[] => [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => c[i]!);
    for (const alg of ["F R U' L2 D B", "R U R' U' F2 L"]) {
      for (const face of ['F', 'R', 'U'] as Face[]) {
        const f = faces(scrambleFacelets(alg));
        f[face]!.colors = rot(f[face]!.colors);
        const r = assemblePainted(f);
        expect(r.valid).toBe(false);
        expect(r.misreadCount ?? 0).toBeGreaterThan(1); // a floor, never a confident zero
        expect(r.suspects ?? []).toEqual([]); // and far too damaged to accuse anything
      }
    }
  });

  it('every one-sticker suggestion it offers actually makes the painting legal', () => {
    // The property that licenses pointing at all. Checked by APPLYING each suggestion rather than
    // trusting the reported distance: a decoder optimising under a freedom the caller does not have
    // can return a repair that is minimal in its own search space and wrong in the caller's.
    const truth = scrambleFacelets("R U R' U' F2 L");
    let pointed = 0;
    for (let k = 0; k < 9; k++) {
      if (k === 4) continue; // the centre names the face and cannot be repainted
      const broken = faces(truth);
      const was = broken.U!.colors[k]!;
      broken.U!.colors[k] = (was + 1) % 6;
      const r = assemblePainted(broken);
      if (r.suspects?.length !== 1) continue;
      pointed += 1;
      const s = r.suspects[0]!;
      const repaired = faces(truth);
      repaired.U!.colors[k] = (was + 1) % 6;
      repaired[s.face]!.colors[s.index] = s.to;
      expect(assemblePainted(repaired).valid).toBe(true);
    }
    expect(pointed).toBeGreaterThan(0); // the loop must actually have exercised the claim
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

describe('assembleColors — what an ambiguous scan says about itself', () => {
  // The six sides of a real scan, transcribed from a user's screenshot on 2026-09-06: every colour
  // correct, and the app asked for another look. Four legal cubes fit these readings — the white
  // side either way up, times the yellow side either way up — and the notice said only "several
  // readings fit", which read as a failed scan. These are the facts the result must carry so the
  // notice can say what is actually undetermined.
  const CLASS: Record<string, number> = { W: 0, R: 1, G: 2, Y: 3, O: 4, B: 5 };
  const side = (s: string): ColorFace => ({
    colors: s.split(' ').map((l) => CLASS[l]!),
    confidence: Array(9).fill(1),
  });
  const SCREENSHOT: Record<Face, ColorFace> = {
    U: side('W Y Y Y W W Y W W'),
    L: side('R B B R O O R R B'),
    F: side('R B B B G G O G G'),
    R: side('O O G O R R O G G'),
    B: side('O O G B B G R R B'),
    D: side('Y W W W Y Y W Y Y'),
  };

  it('names how many cubes fit and which sides they disagree about', () => {
    const r = assembleColors(SCREENSHOT);
    expect(r.valid).toBe(false);
    expect(r.ambiguous).toBe(true);
    expect(r.readings).toBe(4);
    expect(r.undetermined).toEqual(['U', 'D']);
    expect(r.confirm).toEqual({ face: 'U', up: 'B' });
  });

  it('asks about a side the readings disagree on, and the count is the one in the reason', () => {
    let checked = 0;
    for (const f of [SCREENSHOT, faces(scrambleFacelets('U')), faces(scrambleFacelets("U D'"))]) {
      const r = assembleColors(f);
      if (!r.ambiguous || !r.confirm) continue;
      checked++;
      expect(r.readings).toBeGreaterThanOrEqual(2);
      expect(r.reason).toMatch(new RegExp(`^${r.readings} readings fit`));
      expect(r.undetermined?.length).toBeGreaterThan(0);
      expect(r.undetermined).toContain(r.confirm.face);
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('a unique reading carries neither field', () => {
    const r = assembleColors(faces(scrambleFacelets("R U R' U' F2 L D'")));
    expect(r.valid).toBe(true);
    expect(r.readings).toBeUndefined();
    expect(r.undetermined).toBeUndefined();
  });
});

describe('assembleColors — the colour scheme is a third ambiguity dimension (ADR 0001)', () => {
  // The states the design note measured (dev-docs/colour-scheme-switch.md §3, corrected the same
  // day): a scrambled Japanese cube used to be refused as "at least 3 stickers misread" about a
  // correct read, because a capture was filed under FACES[centre] — the Western scheme stated
  // as an identity. And the obvious remedy, "exactly one filing is legal", is false on the
  // near-solved states a beginner hands over, so the scheme is searched WITH the rotations.
  const deep = scrambleFacelets("D2 L' B U2 F' R2 D B' L2 U F2 R");
  const sexy = scrambleFacelets("R U R' U'");
  /** The U-layer edge 3-cycle that is valid under BOTH filings as two different cubes. */
  const CYCLE = 'UFUUUUUUURRRFRRRRRFBFFFUFFFDDDDDDDDDLLLLLLLLLBRBBBBBBB';
  /** Two twisted corners: legal, unsolved, and the SAME string under both filings. */
  const twisted = (() => {
    // cubejs's typings do not expose the orientation arrays; the runtime object carries them.
    const c = new Cube() as unknown as { co: number[]; asString(): string };
    c.co[0] = 1;
    c.co[1] = 2;
    return c.asString();
  })();

  it('reads a scrambled Japanese cube, and says which scheme it is', () => {
    for (const truth of [sexy, deep]) {
      const r = assembleColors(capturesOf(truth, 'japanese'));
      expect(r.valid).toBe(true);
      expect(r.facelets).toBe(truth);
      expect(r.scheme).toBe('japanese');
    }
  });

  it('a Western cube is decisive the same way, and the old contract is unchanged for it', () => {
    for (const truth of [sexy, deep]) {
      const r = assembleColors(capturesOf(truth, 'western'));
      expect(r.valid).toBe(true);
      expect(r.facelets).toBe(truth);
      expect(r.scheme).toBe('western');
    }
  });

  it('a solved cube is one state under both schemes, and says the colours are undetermined', () => {
    for (const scheme of SCHEMES) {
      const r = assembleColors(capturesOf(SOLVED_FACELETS, scheme, [1, 2, 3, 0, 1, 2]));
      expect(r.valid).toBe(true);
      expect(r.facelets).toBe(SOLVED_FACELETS);
      expect(r.scheme).toBe('undetermined');
    }
  });

  it('two twisted corners: the STATE is known and the scheme is not, and it says so', () => {
    for (const scheme of SCHEMES) {
      const r = scanAs(twisted, scheme, [0, 0, 0, 0, 0, 0]);
      expect(r.valid).toBe(true);
      expect(r.facelets).toBe(twisted);
      expect(r.scheme).toBe('undetermined');
    }
  });

  it('the top-layer 3-cycle differs only by scheme: every look is answered, then "turn any one face"', () => {
    // Under one filing alone this scans as a unique, valid reading. Under both it is two
    // different cubes that differ in nothing but which colour is under white. The scanner asks
    // for the looks that COULD separate them — each one a hold both kinds of cube can obey — and
    // when the answers turn out to fit both, it says so and gives the one instruction that works.
    // It never picks: accepting either reading is a confidently wrong cube for whichever child
    // has the other kind (ADR 0001 §8.2).
    for (const scheme of SCHEMES) {
      const r = scanAs(CYCLE, scheme, [0, 0, 0, 0, 0, 0]);
      expect(r.valid).toBe(false);
      expect(r.schemeAmbiguous).toBe(true);
      expect(r.reason).toMatch(/turn any one face/);
      expect(r.confirm).toBeUndefined();
    }
    // And the instruction works: one turn of any face, and the same cube — of either kind — is
    // read decisively, with its own scheme.
    const turned = Cube.fromString(CYCLE).move('R').asString();
    for (const scheme of SCHEMES) {
      const r = assembleColors(capturesOf(turned, scheme));
      expect(r.valid).toBe(true);
      expect(r.facelets).toBe(turned);
      expect(r.scheme).toBe(scheme);
    }
  });

  it('a look CAN eliminate a scheme, so a scan is never refused merely for standing under two', () => {
    // The counterexample that killed a guard, kept as the fixture that stops it coming back
    // (2026-09-07, found in verification). The reasoning it refuted: "the scanner only asks for
    // holds both arrangements can obey, so an answer is consistent with both and can never tell
    // them apart." A hold being POSSIBLE under both schemes does not mean both READINGS predict
    // the same photograph of it — each candidate accepts its own set of rotations for that side,
    // and a truthful answer can miss one candidate's set entirely.
    //
    // This state scans as nine Western readings and one Japanese one. Answering "the blue side,
    // red up" leaves eight — the Japanese reading is among those gone — and the scan carries on
    // narrowing within one scheme. A guard that refused whenever two schemes stood with different
    // states threw this cube away with no look asked at all.
    const cube = new Cube() as unknown as { ep: number[]; asString(): string };
    const ep = cube.ep.slice();
    [ep[1], ep[7], ep[10]] = [7, 10, 1];
    cube.ep = ep;
    const truth = cube.asString();
    const shown = capturesOf(truth, 'western');

    const before = assembleColors(shown);
    expect(before.valid).toBe(false);
    expect(before.confirm).toBeDefined(); // a look is asked for, never a turn

    const after = assembleColors(shown, 0.15, {
      B: answer(truth, 'western', { face: 'B', up: 'R' }),
    });
    expect(after.readings).toBe(8);
    expect(after.confirm).toBeDefined(); // still narrowing
    expect(after.schemeAmbiguous).toBeUndefined();
  });

  it('never returns a wrong cube when one look is mis-held, on either kind of cube', () => {
    const CASES: [string, number[]][] = [
      ['U R', [1, 0, 2, 0, 3, 0]],
      ['U', [0, 0, 0, 0, 0, 0]],
      ["R U'", [1, 1, 1, 1, 1, 1]],
      ["R U R' U'", [0, 1, 2, 3, 0, 1]],
    ];
    let accepted = 0;
    for (const scheme of SCHEMES) {
      for (const [alg, rots] of [...CASES, ['cycle', [2, 0, 1, 0, 3, 0]] as [string, number[]]]) {
        const truth = alg === 'cycle' ? CYCLE : scrambleFacelets(alg);
        const r = scanAs(truth, scheme, rots, 0);
        if (r.valid) {
          accepted++;
          expect(`${scheme} ${alg}: ${r.facelets}`).toBe(`${scheme} ${alg}: ${truth}`);
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });

  it('a confirmation is projected into each scheme’s frame: every permitted hold recovers the truth', () => {
    // The same photograph of the blue side "red up" is canonical for a Western B and a Japanese D
    // at rotations a half turn apart. Answer every request the physical way for the cube's own
    // scheme, at every starting rotation of every side, and the truth must come back.
    for (const scheme of SCHEMES) {
      for (const alg of ['U', 'U R', "F' D", 'L2 B']) {
        const truth = scrambleFacelets(alg);
        for (const rots of [
          [0, 0, 0, 0, 0, 0],
          [1, 2, 3, 0, 1, 2],
          [3, 3, 3, 3, 3, 3],
        ]) {
          const r = scanAs(truth, scheme, rots);
          expect(`${scheme} ${alg} ${rots}: ${r.facelets}`).toBe(
            `${scheme} ${alg} ${rots}: ${truth}`,
          );
          expect(r.scheme === scheme || r.scheme === 'undetermined').toBe(true);
        }
      }
    }
  });

  it('while both schemes are in play, a requested hold is possible on both kinds of cube', () => {
    // A hold naming two faces that are opposite on the cube in the hand cannot be obeyed. Every
    // request the search emits before the scheme is settled must be adjacent under every scheme.
    let requests = 0;
    for (const scheme of SCHEMES) {
      for (const truth of [CYCLE, twisted, scrambleFacelets('U'), scrambleFacelets("U D'")]) {
        const shown = capturesOf(truth, scheme);
        let confirmed: Partial<Record<Face, Confirmation>> = {};
        for (let round = 0; round < 6; round++) {
          const r = assembleColors(shown, 0.15, confirmed);
          if (!r.confirm) break;
          requests++;
          // Whatever the search still considers possible, the instruction must be obeyable on
          // the ACTUAL cube — and on the other kind, until a look has ruled it out.
          expect(adjacentIn(colourOfSlot(r.confirm.face), colourOfSlot(r.confirm.up), scheme)).toBe(
            true,
          );
          confirmed = { ...confirmed, [r.confirm.face]: answer(truth, scheme, r.confirm) };
        }
      }
    }
    expect(requests).toBeGreaterThan(0);
  });

  it('a one-sticker misread on a Japanese cube is "at least 1", not the old "at least 4"', () => {
    // Decoded under the Western filing this reading is four stickers from legal; under the
    // Japanese, one. The count reported is the smaller floor, and the pointer comes from the
    // scheme that achieved it, in slot coordinates — the tile the user can tap.
    const shown = capturesOf(sexy, 'japanese');
    const was = shown.U.colors[0]!;
    shown.U.colors[0] = 1; // white read as red
    const r = assembleColors(shown);
    expect(r.valid).toBe(false);
    expect(r.misreadCount).toBe(1);
    expect(r.misreadScheme).toBe('japanese');
    expect(r.suspects).toEqual([{ face: 'U', index: 0, to: was }]);
  });

  it('the same misread on a Western cube reports the same floor, from the Western filing', () => {
    const shown = capturesOf(sexy, 'western');
    const was = shown.U.colors[0]!;
    shown.U.colors[0] = 1;
    const r = assembleColors(shown);
    expect(r.valid).toBe(false);
    expect(r.misreadCount).toBe(1);
    expect(r.misreadScheme).toBe('western');
    expect(r.suspects).toEqual([{ face: 'U', index: 0, to: was }]);
  });

  it('a deferred diagnosis is still null, never a count, and never a scheme', () => {
    const shown = capturesOf(sexy, 'japanese');
    shown.U.colors[0] = 1;
    const r = assembleColors(shown, 0.15, {}, { diagnose: false });
    expect(r.valid).toBe(false);
    expect(r.misreadCount).toBeNull();
    expect(r.misreadScheme).toBeUndefined();
    expect(r.suspects).toBeUndefined();
  });

  it('a capture filed under a slot that is not its colour is refused, not re-filed', () => {
    // A slot names a colour. A caller that puts the blue capture under D has confused a slot
    // with a position, and the assembler says so rather than guessing which was meant.
    const shown = capturesOf(sexy, 'western');
    const swapped = { ...shown, D: shown.B, B: shown.D };
    const r = assembleColors(swapped);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/slot names a colour/);
  });

  it('rotations come back in slot order, so a host can turn every capture the right way up', () => {
    const rots = [1, 2, 3, 0, 1, 2];
    const shown = capturesOf(deep, 'japanese', rots);
    const r = assembleColors(shown);
    expect(r.valid).toBe(true);
    expect(r.scheme).toBe('japanese');
    // Rebuild the positional string from the captures and the reported rotations, placing each
    // slot's capture at the position the reported scheme gives its colour.
    const positional = new Array<string>(54);
    FACES.forEach((slot, si) => {
      const canonicalColors = rot(shown[slot]!.colors, r.rotations![si]!);
      const position = positionOf(colourOfSlot(slot), 'japanese');
      const base = FACES.indexOf(position) * 9;
      canonicalColors.forEach((c, i) => {
        positional[base + i] = positionOf(c as Colour, 'japanese');
      });
    });
    expect(positional.join('')).toBe(deep);
  });

  it('a painted cube reports the scheme its centres describe', () => {
    for (const scheme of SCHEMES) {
      // Painted by POSITION: the user authored each tile in place, D included.
      const painted = {} as Record<Face, ColorFace>;
      FACES.forEach((position, fi) => {
        painted[position] = {
          colors: [...deep.slice(fi * 9, fi * 9 + 9)].map((l) => paint(l, scheme)),
          confidence: Array(9).fill(1),
        };
      });
      const r = assemblePainted(painted);
      expect(r.valid).toBe(true);
      expect(r.facelets).toBe(deep);
      expect(r.scheme).toBe(scheme);
    }
  });
});

describe('the pixels, when the scores have been refused', () => {
  // Where the six paints sit in a*b*, and the per-face lighting a real scan has: six photographs of
  // one cube, taken in one sitting, so the shifts are small next to the gaps between paints.
  const PAINT: Record<number, [number, number]> = {
    0: [0, 2],
    1: [55, 40],
    2: [-50, 35],
    3: [-5, 70],
    4: [35, 60],
    5: [10, -50],
  };
  const SHIFT: [number, number][] = [
    [0, 0],
    [5, -6],
    [-4, 5],
    [2, 7],
    [-6, -4],
    [3, 3],
  ];

  /**
   * A cube the detector reads with orange called red, CONFIDENTLY, everywhere but the centres —
   * the shape of a lighting shift along the blue-yellow axis, and of the set the assembly refused on
   * 2026-09-17 with two such stickers. Too expensive for the nine-of-each repair, whose ceiling is
   * 12 nats; eight stickers at 0.9 against 0.05 cost about 23.
   *
   * THE CENTRES ARE LEFT ALONE ON PURPOSE. A capture is filed under its centre's colour, so a
   * misread centre is refused earlier and by a different rule — `checkedBySlot`, "a slot names a
   * colour, not a position" — and never reaches this path at all.
   */
  function misreadOrangeAsRed(facelets: string, withLab: boolean): Record<Face, ColorFace> {
    const out = {} as Record<Face, ColorFace>;
    FACES.forEach((face, fi) => {
      const truth: number[] = [];
      for (let k = 0; k < 9; k++) truth.push(LETTER_CLASS[facelets[fi * 9 + k] as Face]!);
      const colors = truth.map((c, k) => (c === 4 && k !== 4 ? 1 : c));
      const scores = truth.map((c, k) => {
        const row = new Array<number>(6).fill(0.01);
        if (c === 4 && k !== 4) {
          row[1] = 0.9;
          row[4] = 0.05;
        } else {
          row[c] = 0.95;
        }
        return row;
      });
      const lab = truth.map((c) => {
        const [a, b] = PAINT[c]!;
        const [da, db] = SHIFT[fi]!;
        return [60, a + da, b + db] as [number, number, number];
      });
      out[face] = withLab
        ? { colors, confidence: Array(9).fill(0.9), scores, lab }
        : { colors, confidence: Array(9).fill(0.9), scores };
    });
    return out;
  }

  const scrambled = scrambleFacelets("R U R' U' F2 L D L'");

  it('reads the cube the pixels say it is', () => {
    const r = assembleColors(misreadOrangeAsRed(scrambled, true));
    expect(r.valid).toBe(true);
    expect(r.facelets).toBe(scrambled);
  });

  it('refuses exactly as before when no Lab was supplied', () => {
    const r = assembleColors(misreadOrangeAsRed(scrambled, false));
    expect(r.valid).toBe(false);
  });
});

describe('a confirming look is matched against the capture as READ — audit §1.5 (2026-09-20)', () => {
  // `U`, with three narrow misreads on F: its bottom row read as blue at 0.40 against green at
  // 0.38. The count repair puts them right (twelve blues and six greens are not a cube), the repaired
  // cube is the ambiguous one-turn cube, and a look at F comes back READ THE SAME WAY, because a
  // camera that misreads a paint under this light misreads it again. Matched against the REPAIRED
  // side, that look differs by three — past CONFIRM_TOLERANCE — and used to come back as a mismatch:
  // reread, repair, ask again, until the scan was refused. The look is matched against both now —
  // the side as the camera read it and as the repair reads it — so the systematic misread the repair
  // exists for can no longer make the confirming look impossible.
  const truth = scrambleFacelets('U');
  const MISREAD_AT = [6, 7, 8]; // F's bottom row, in the canonical frame
  const GREEN = 2;
  const BLUE = 5;

  /** The side in `slot` as this camera reads it, held with `up` upwards (canonically when null). */
  function readBy(slot: Face, up: Face | null): ColorFace {
    const position = positionOf(colourOfSlot(slot), 'western');
    const fi = FACES.indexOf(position);
    const colors = [...truth.slice(fi * 9, fi * 9 + 9)].map((l) => paint(l, 'western'));
    const narrow = new Set<number>();
    if (slot === 'F') {
      for (const i of MISREAD_AT) {
        colors[i] = BLUE;
        narrow.add(i);
      }
    }
    const scores = colors.map((c, i) =>
      [0, 1, 2, 3, 4, 5].map((k) => {
        if (narrow.has(i)) return k === c ? 0.4 : k === GREEN ? 0.38 : 0.02;
        return k === c ? 0.9 : 0.02;
      }),
    );
    const k = up === null ? 0 : (holdOffset(colourOfSlot(slot), colourOfSlot(up), 'western') ?? 0);
    const order = rot([0, 1, 2, 3, 4, 5, 6, 7, 8], k);
    return {
      colors: order.map((i) => colors[i]!),
      confidence: order.map((i) => Math.max(...scores[i]!)),
      scores: order.map((i) => scores[i]!),
    };
  }

  /** Drive the look-and-check exchange, answering every ask with `camera`. */
  function exchange(
    shown: Record<Face, ColorFace>,
    camera: (slot: Face, up: Face) => ColorFace,
  ): { result: AiScanResult; asked: Face[] } {
    let confirmed: Confirmed = {};
    const asked: Face[] = [];
    let result = assembleColors(shown, 0.15, confirmed);
    for (let round = 0; round < 12 && !result.valid && result.confirm; round++) {
      expect(result.mismatch, `round ${round}: a truthful look was refused`).toBeFalsy();
      const { face, up } = result.confirm;
      asked.push(face);
      const given = confirmed[face];
      const before = given === undefined ? [] : Array.isArray(given) ? given : [given];
      confirmed = { ...confirmed, [face]: [...before, { capture: camera(face, up), up }] };
      result = assembleColors(shown, 0.15, confirmed);
    }
    return { result, asked };
  }

  /** `slot` read WITHOUT the F misread — a second photograph that got the bottom row right. */
  function trueRead(slot: Face, up: Face | null): ColorFace {
    const position = positionOf(colourOfSlot(slot), 'western');
    const fi = FACES.indexOf(position);
    const colors = [...truth.slice(fi * 9, fi * 9 + 9)].map((l) => paint(l, 'western'));
    const k = up === null ? 0 : (holdOffset(colourOfSlot(slot), colourOfSlot(up), 'western') ?? 0);
    const order = rot([0, 1, 2, 3, 4, 5, 6, 7, 8], k);
    return {
      colors: order.map((i) => colors[i]!),
      confidence: order.map(() => 0.9),
      scores: order.map((i) => [0, 1, 2, 3, 4, 5].map((c) => (c === colors[i] ? 0.9 : 0.02))),
    };
  }

  it('asks about the misread side, and takes a second look that reads it right', () => {
    // The look the repair asks for (D1, 2026-09-23) is answered by a camera that gets F right this
    // time — a second photograph at another angle, in other light, which is what a second look
    // physically IS. The repair's answer is confirmed and the scan finishes with the true cube.
    const shown = {} as Record<Face, ColorFace>;
    for (const slot of FACES) shown[slot] = readBy(slot, null);
    const { result, asked } = exchange(shown, (slot, up) =>
      slot === 'F' ? trueRead(slot, up) : readBy(slot, up),
    );
    expect(asked).toContain('F');
    expect(result.mismatch).toBeFalsy();
    expect(result.valid).toBe(true);
    expect(result.facelets).toBe(truth);
  });

  it('refuses rather than assert the cube when every look repeats the same misread', () => {
    // THE LIMIT OF D1, stated rather than hidden. A repaired sticker is a colour nobody observed,
    // and a camera that answers every look with the same misread has not observed it either — the
    // second look is the same measurement taken twice, not independent evidence. The honest answer
    // is then a refusal naming the sticker, which a person can tap, and NOT a cube built on three
    // invented colours: this reading sits one repair from the true cube and, on another cube with
    // the same shape, one repair from a decoy (§3 A2). Nothing in the captures tells the two apart.
    //
    // The scan does not loop asking, either: one look per side, then a verdict.
    const shown = {} as Record<Face, ColorFace>;
    for (const slot of FACES) shown[slot] = readBy(slot, null);
    const { result, asked } = exchange(shown, readBy);
    expect(asked).toContain('F');
    expect(asked.filter((f) => f === 'F')).toHaveLength(1);
    expect(result.valid).toBe(false);
    expect(result.mismatch).toBeFalsy();
  });
});

describe('a reread names the look that disagreed (2026-09-21)', () => {
  const oneTurn = scrambleFacelets('U');

  it('by its index among the looks at that side, whichever of them it is', () => {
    // A side can carry two looks under two holds, and a caller that took "the last" as the one
    // that disagreed adopted the wrong photograph whenever it was the earlier one — again and
    // again, until the six-round cap refused the scan.
    const shown = shownAs(oneTurn, [0, 0, 0, 0, 0, 0]);
    const first = assembleColors(shown);
    const { face, up } = first.confirm!;
    const good: Confirmation = { capture: heldOf(oneTurn, 'western', face, up), up };
    const badCapture = heldOf(oneTurn, 'western', face, up);
    for (const i of [0, 1, 2, 3]) badCapture.colors[i] = (badCapture.colors[i]! + 1) % 6;
    const bad: Confirmation = { capture: badCapture, up };

    const disagreeingFirst = assembleColors(shown, 0.15, { [face]: [bad, good] });
    expect(disagreeingFirst.reread).toBe(face);
    expect(disagreeingFirst.rereadLook).toBe(0);

    const disagreeingSecond = assembleColors(shown, 0.15, { [face]: [good, bad] });
    expect(disagreeingSecond.reread).toBe(face);
    expect(disagreeingSecond.rereadLook).toBe(1);
    expect(disagreeingSecond.confirm).toEqual({ face, up });
  });
});

describe('every confirmed slot is asked about every combo (2026-09-21)', () => {
  it('a later slot whose look also excluded a combo is still offered its second look', () => {
    // Found by a seeded search over 3,000 short scrambles at random holds, comparing the fixed
    // assembler against the one that stopped at the first refusing slot. With R and L both looked
    // at, every combo L would have excluded was excluded by R first — `every` never asked L, L was
    // never recorded as `effective`, and `mayLookAgain` then refused it the second look it was
    // entitled to: the scan stopped one look short. The outcome here is still "too symmetric";
    // the property is the entitlement, and the ask sequence is what shows it.
    const truth = scrambleFacelets("R2 B' F R2 B2");
    const shown = shownAs(truth, [1, 1, 0, 1, 3, 1]);
    let confirmed: Confirmed = {};
    const asked: string[] = [];
    let r = assembleColors(shown, 0.15, confirmed);
    for (let round = 0; round < 8 && r.confirm; round++) {
      asked.push(`${r.confirm.face}/${r.confirm.up}`);
      const given = confirmed[r.confirm.face];
      const before = given === undefined ? [] : Array.isArray(given) ? given : [given];
      confirmed = {
        ...confirmed,
        [r.confirm.face]: [...before, answer(truth, 'western', r.confirm)],
      };
      r = assembleColors(shown, 0.15, confirmed);
    }
    expect(asked).toEqual(['R/U', 'F/U', 'L/U', 'R/F', 'L/F']);
  });
});

describe('a repair that cost nothing is not a repair — audit §2.6 (2026-09-20)', () => {
  it('refuses flat scores rather than handing back the solved cube for any reading', () => {
    // Every row flat: the detector preferred nothing, so the nine-of-each matching breaks 54 ties
    // and hands back whatever its tie-break favours — the SOLVED cube, whatever was read. A repair
    // is licensed by the likelihood it gives up; zero given up is no licence, and `repairByCounts`
    // refuses it. Unreachable from the shipped fit, since a flat row never passes the confidence floor,
    // so this pins the contract on the public field rather than a path a user takes.
    const f = faces(scrambleFacelets("R U R' U' F2 L D'"));
    // One misread, so the reading is refused and the repair is asked for.
    f.F!.colors[0] = (f.F!.colors[0]! + 1) % 6;
    for (const face of FACES) {
      f[face]!.scores = Array.from({ length: 9 }, () => Array<number>(6).fill(1 / 6));
    }
    const r = assembleColors(f);
    expect(r.valid).toBe(false);
    expect(r.facelets).not.toBe(SOLVED_FACELETS);
  });
});

/**
 * D1's guard, asked about its own mechanics — and about the two ways it failed OPEN, found by an
 * independent audit on 2026-09-23 (Codex, read-only). Both are the guard admitting a repair no
 * photograph supports, which is the one thing it exists to prevent.
 */
describe('a repair is confirmed by one look, at the right sticker (D1)', () => {
  const capture = (colors: number[]): ColorFace => ({
    colors,
    confidence: Array<number>(9).fill(0.9),
  });
  // A side, and the same side turned a quarter in the hand.
  const base = [0, 1, 2, 3, 4, 5, 0, 1, 2];

  it('accepts a look that shows the repaired colour at the repaired sticker', () => {
    const repaired = capture(base);
    const original = capture(base.map((c, i) => (i === 0 ? 5 : c)));
    const look = { capture: capture(base), up: 'U' as Face };
    expect(reobserved(repaired, original, [look], [0])).toBe(true);
  });

  it('refuses a look that shows something else there', () => {
    const repaired = capture(base);
    const original = capture(base.map((c, i) => (i === 0 ? 5 : c)));
    // The look still reads the sticker the way the camera did: it contradicts the repair.
    const look = { capture: capture(base.map((c, i) => (i === 0 ? 5 : c))), up: 'U' as Face };
    expect(reobserved(repaired, original, [look], [0])).toBe(false);
  });

  it('turns a rotated look back before it reads the sticker', () => {
    // THE FIRST High FINDING. `matchingRotations` says the look is the capture turned by k, so the
    // look must be turned BACK before position `index` names the same physical sticker in both.
    // Comparing at the raw index asks about whichever sticker rotated INTO that position — and
    // since the alignment already requires all but two positions to agree, it usually passed.
    const repaired = capture(base);
    const original = capture(base.map((c, i) => (i === 0 ? 5 : c)));
    // The same side, photographed a quarter turn round. Position 0 of the capture is elsewhere here.
    const turned = rotateFace(base, 1);
    const look = { capture: capture(turned), up: 'U' as Face };
    expect(reobserved(repaired, original, [look], [0])).toBe(true);
    // …and a turned look that DISAGREES at the repaired sticker is refused, which is what the
    // wrong-index version could not tell apart.
    const wrongThere = [...turned];
    wrongThere[rotateFace([0, 1, 2, 3, 4, 5, 6, 7, 8], 1).indexOf(0)] = 4;
    expect(reobserved(repaired, original, [{ capture: capture(wrongThere), up: 'U' }], [0])).toBe(
      false,
    );
  });

  it('will not confirm two repaired stickers under two different rotations', () => {
    // THE SECOND High FINDING. Asked per sticker, a face could have one repair confirmed under
    // rotation 0 and another under rotation 1 — from the same photograph — so no single physical
    // orientation supported the cube that was accepted. A photograph is of a face, held one way up.
    //
    // A symmetric side, so several rotations align: white everywhere but two positions, each of
    // which the repair invented, and a look that agrees with one under each of two rotations.
    const sym = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const repaired = capture(sym.map((c, i) => (i === 1 ? 1 : i === 3 ? 2 : c)));
    const original = capture(sym);
    // This look reads position 1 as the repair says and position 3 as it does not; turned a
    // quarter, it reads position 3 as the repair says and position 1 as it does not.
    const look = capture(sym.map((c, i) => (i === 1 ? 1 : c)));
    const both = reobserved(repaired, original, [{ capture: look, up: 'U' }], [1, 3]);
    expect(both, 'two stickers were confirmed under two different holds').toBe(false);
    // Each ALONE can still be confirmed — which is exactly why asking per sticker was unsound.
    expect(reobserved(repaired, original, [{ capture: look, up: 'U' }], [1])).toBe(true);
  });

  it('confirms nothing from no looks, and everything from no repairs', () => {
    const repaired = capture(base);
    const original = capture(base);
    expect(reobserved(repaired, original, [], [0])).toBe(false);
    // A face with no invented stickers has nothing to confirm; demanding a look would ask for one
    // about a side the repair never touched.
    expect(reobserved(repaired, original, [], [])).toBe(true);
  });
});
