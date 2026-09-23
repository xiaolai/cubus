// A side captured from its EIGHT ring stickers, with no centre reading at all
// (`dev-docs/scan-pipeline-audit-2026-09-23.md` §4, Stage 2 item 1, wired 2026-09-23).
//
// WHY THIS CASE EXISTS AT ALL. On two recorded scans of the logo-centre cube, `fitFace` refused 204
// and 528 frames as `PARTIAL_FACE` and every one was discarded whole — and in 71 of 72 and 378 of
// 382 of the readable ones the missing sticker was THE CENTRE. The side that could not be captured
// was the side whose ring was perfectly legible, and the scan stalled for 26 and 49 seconds waiting
// for a sticker the detector never produces on that cube.
//
// THE DANGEROUS PART IS THE SENTINEL. `UNREAD_CENTRE` is how "nobody read this" travels from the
// panel to the filing, and it is not a colour: if it ever reaches a cube, a tile or a claim, the
// scanner is showing a person a sticker nobody saw. These cases are about that, and about the
// elimination that replaces it.

import { describe, expect, it } from 'vitest';
import {
  type ColorFace,
  resolveCentres,
  UNREAD_CENTRE,
  type UnnamedSide,
  withCentre,
} from '../src/ai-assemble.js';
import { isColour } from '../src/scheme.js';

/** A capture whose eight are `ring` and whose centre nobody read. */
function fromEight(ring: readonly number[]): ColorFace {
  const colors = [...ring.slice(0, 4), UNREAD_CENTRE, ...ring.slice(4)];
  return { colors, confidence: colors.map((c) => (c === UNREAD_CENTRE ? 0 : 0.9)) };
}

describe('the sentinel is not a colour', () => {
  it('is rejected by the package’s own colour test', () => {
    // The one check every colour passes through. If the sentinel ever passed it, every guard built
    // on `isColour` would wave it through silently.
    expect(isColour(UNREAD_CENTRE)).toBe(false);
    for (let c = 0; c < 6; c++) expect(isColour(c)).toBe(true);
  });

  it('is replaced the moment the side is placed', () => {
    // `withCentre` is what `resolveCentres` calls on a filed side. After it, no sentinel remains —
    // which is what makes it safe for the sentinel to exist at all.
    const capture = fromEight([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(capture.colors[4]).toBe(UNREAD_CENTRE);
    const placed = withCentre(capture, 2);
    expect(placed.colors[4]).toBe(2);
    expect(placed.colors).not.toContain(UNREAD_CENTRE);
    // And the capture it was made from is untouched, so a filing that is later rejected cannot
    // leave a half-written colour behind.
    expect(capture.colors[4]).toBe(UNREAD_CENTRE);
  });
});

describe('a centre placed by elimination is certain, not faint', () => {
  it('carries a confidence to match its scores', () => {
    // THE SYMPTOM THIS FIXES, reported from a live scan: the scan settled the cube and then said
    // "some stickers were too faint to trust — show those sides again". The faint sticker was the
    // centre NOBODY READ, whose confidence is 0 by construction. `withCentre` rewrote its colour
    // and its scores as a certainty and left the confidence behind, so a side the scanner had
    // already settled asked to be shown again.
    //
    // Placement here is by ELIMINATION — five centres taken, one slot free, the filing then checked
    // for legality. That is not a faint reading; it is the only colour the slot can hold.
    const capture = fromEight([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(capture.confidence[4]).toBe(0);
    const placed = withCentre(capture, 2);
    expect(placed.confidence[4]).toBe(1);
    expect(placed.scores?.[4]?.[2] ?? 1).toBe(1);
    // The eight keep their own readings: only the centre was decided here.
    for (let i = 0; i < 9; i++)
      if (i !== 4) expect(placed.confidence[i]).toBe(capture.confidence[i]);
  });

  it('keeps a real reading\u2019s own confidence when the colour is unchanged', () => {
    // A centre that WAS read and already holds the slot's colour is not being decided by
    // elimination, so its own number is the honest one to keep.
    const read: ColorFace = {
      colors: [0, 1, 2, 3, 2, 5, 0, 1, 2],
      confidence: [0.9, 0.9, 0.9, 0.9, 0.31, 0.9, 0.9, 0.9, 0.9],
    };
    expect(withCentre(read, 2).confidence[4]).toBe(0.31);
  });
});

describe('a side with no centre reading is placed by elimination', () => {
  /** Five sides whose centres ARE read, leaving exactly one slot free. */
  function fiveNamed(): Partial<Record<string, ColorFace>> {
    const face = (centre: number): ColorFace => ({
      colors: [centre, centre, centre, centre, centre, centre, centre, centre, centre],
      confidence: new Array(9).fill(0.9),
    });
    // U=0 white is deliberately LEFT OUT: it is the logo side, the one with no centre reading.
    return { R: face(1), F: face(2), D: face(3), L: face(4), B: face(5) };
  }

  it('claims nothing, and is given the one free slot', () => {
    // THE FORCED CASE, which is what the real cube produces: five centres taken, one slot free.
    // `centreClaim: null` is the difference between "claims nothing" and "claims whatever its
    // capture's centre happens to say" — and the sentinel must never become the second.
    const unnamed: UnnamedSide[] = [
      { capture: fromEight([0, 0, 0, 0, 0, 0, 0, 0]), centreClaim: null, centreConfidence: 0.5 },
    ];
    const got = resolveCentres(fiveNamed(), unnamed);
    expect(got.result.valid).toBe(true);
    if (got.result.valid && got.result.facelets) {
      expect(got.result.facelets).toHaveLength(54);
      // The sentinel is nowhere in the answer, and the free slot's centre is its own colour.
      expect(got.result.facelets).not.toContain(String(UNREAD_CENTRE));
      expect(got.result.facelets[4]).toBe('U');
    }
  });

  it('refuses rather than guessing when the slots do not match the unnamed sides', () => {
    // Elimination is only forced when there is exactly one way to do it. Two unnamed sides and one
    // free slot is not a harder version of the same question, it is a different one.
    const two: UnnamedSide[] = [
      { capture: fromEight([0, 0, 0, 0, 0, 0, 0, 0]), centreClaim: null, centreConfidence: 0.5 },
      { capture: fromEight([1, 1, 1, 1, 1, 1, 1, 1]), centreClaim: null, centreConfidence: 0.5 },
    ];
    expect(resolveCentres(fiveNamed(), two).result.valid).toBe(false);
  });

  it('never lets the sentinel be read as a claim', () => {
    // The failure this file exists to prevent: a capture handed over WITHOUT `centreClaim: null`
    // falls back to `capture.colors[4]`, which here is the sentinel. It must be refused, not
    // treated as a sixth colour — a claim of "-1" would be a side named after nothing.
    const missingClaim = [
      { capture: fromEight([0, 0, 0, 0, 0, 0, 0, 0]), centreConfidence: 0.5 },
    ] as UnnamedSide[];
    const got = resolveCentres(fiveNamed(), missingClaim);
    expect(got.result.valid).toBe(false);
    if (!got.result.valid) expect(String(got.result.reason)).toMatch(/not one of the six/);
  });
});
