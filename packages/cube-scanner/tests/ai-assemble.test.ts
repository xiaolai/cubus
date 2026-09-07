import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import {
  type AiScanResult,
  assembleColors,
  assemblePainted,
  type ColorFace,
  type Confirmation,
  matchingRotations,
} from '../src/ai-assemble.js';
import { SOLVED_FACELETS } from '../src/facelet-cube.js';
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
  let confirmed: Partial<Record<Face, Confirmation>> = {};
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
      [r.confirm.face]: answer(truth, scheme, r.confirm, looks === misHoldNth ? 1 : 0),
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
  it('when no remaining side can check the survivor, it says the cube is too symmetric', () => {
    // Found by seeded search: after honestly confirming R and L, exactly this cube at exactly
    // these shown rotations leaves readings nothing further can tell apart.
    const truth = scrambleFacelets("L R' F' B");
    const shown = shownAs(truth, [0, 2, 1, 2, 2, 0]);
    let confirmed: Partial<Record<Face, Confirmation>> = {};
    let r = assembleColors(shown, 0.15, confirmed);
    for (let round = 0; round < 4 && r.confirm; round++) {
      confirmed = { ...confirmed, [r.confirm.face]: answer(truth, 'western', r.confirm) };
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
