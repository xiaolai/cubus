// The cube's COLOUR SCHEME: which colour is painted on which position — and the one place in the
// scanner where a colour and a position are allowed to meet.
//
// Two arrangements exist on real 3x3 cubes. Western (BOY): white opposite yellow, green opposite
// blue, red opposite orange. Japanese: white opposite BLUE, green opposite YELLOW, red opposite
// orange. Only which of blue/yellow sits under white differs; red is on the right in both, with
// white up and green facing you (dev-docs/colour-scheme-switch.md §2, verified against the two
// Wikimedia scheme nets). The Japanese scheme was the original on officially produced cubes and
// is still common on the older cubes a child inherits.
//
// Everything downstream of this file is POSITIONAL — a facelet string is URFDLB positions, the
// solver never sees a colour — so the scheme reaches exactly three things: how a captured side is
// placed into the facelet layout, how a facelet is painted, and how a piece is named in prose.
// Until 2026-09-07 the placement was an identity nobody had named: a captured side was filed under
// `FACES[centre colour class]`, and the model's class order (ml/data.yaml: 0 white 1 red 2 green
// 3 yellow 4 orange 5 blue) happens to be URFDLB in the WESTERN scheme. So "blue is Back" was
// stated as an equation, and a scrambled Japanese cube was refused as "at least 3 stickers
// misread" about a correct read. ADR 0001 (dev-docs/adr/) is the decision this file implements.
//
// Two vocabularies, kept apart on purpose:
//
//   * A COLOUR is a detector class, 0..5. It is what a capture IS — a capture is identified by
//     its centre's colour and by nothing else. A record of captures keyed by `Face` letters uses
//     those letters as SLOTS: slot `FACES[c]` holds the colour-`c` capture, so 'D' means "the
//     yellow capture" and 'B' "the blue capture", whatever their positions turn out to be. That
//     is the convention every capture record in this package has always used (it is what
//     `FACES[centre]` filed under); this file names it and gives it a scheme-independent meaning.
//   * A POSITION is a face of the facelet layout, U R F D L B. `positionOf(colour, scheme)` is the
//     only way from one to the other, and `colourOf(position, scheme)` the only way back.
//
// The schemes are a TABLE, not two code paths, so a third arrangement is a row. Handedness is
// deliberately not a row: the mirror image of a legal state is a legal state, so no search over
// legality can tell red-on-the-right from red-on-the-left, and both real schemes put red on the
// right. A mirrored cube would get a mirrored solution silently; that limit is written down in
// the ADR rather than hidden in a table that looks complete.

import { FACE_NEIGHBOURS, type Side } from './facelet-cube.js';
import { FACES, type Face } from './types.js';

/** A detector colour class, in ml/data.yaml order: 0 white, 1 red, 2 green, 3 yellow, 4 orange, 5 blue. */
export type Colour = 0 | 1 | 2 | 3 | 4 | 5;

/** Every colour, in class order. */
export const COLOURS: readonly Colour[] = [0, 1, 2, 3, 4, 5] as const;

/** The colour classes' names, in class order — the words a child hears. */
export const COLOUR_NAMES: readonly string[] = [
  'white',
  'red',
  'green',
  'yellow',
  'orange',
  'blue',
] as const;

/** The two arrangements real cubes come in. */
export type Scheme = 'western' | 'japanese';

/** Every scheme, in the order they are searched and reported. Western first: it is the default
 *  assumption and the one the model's class order encodes. */
export const SCHEMES: readonly Scheme[] = ['western', 'japanese'] as const;

/**
 * Which colour each position wears, per scheme. Only D and B differ (§2 of the design note);
 * U, F, R and L are the same in both, which is why "white up, green facing you" is an instruction
 * that works on every cube and why red stays on the right.
 */
export const SCHEME_COLOURS: Readonly<Record<Scheme, Readonly<Record<Face, Colour>>>> =
  Object.freeze({
    western: Object.freeze({ U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 } as const),
    japanese: Object.freeze({ U: 0, R: 1, F: 2, D: 5, L: 4, B: 3 } as const),
  });

/** The colour painted on `position` under `scheme`. */
export function colourOf(position: Face, scheme: Scheme): Colour {
  return SCHEME_COLOURS[scheme][position];
}

/** The position that wears `colour` under `scheme`. */
export function positionOf(colour: Colour, scheme: Scheme): Face {
  const table = SCHEME_COLOURS[scheme];
  for (const position of FACES) if (table[position] === colour) return position;
  // Unreachable while SCHEME_COLOURS is a bijection per scheme, which scheme.test.ts pins.
  throw new Error(`scheme ${scheme} paints no position ${colour}`);
}

/**
 * The SLOT a colour's capture is filed under in a `Record<Face, ColorFace>`: `FACES[colour]`. The
 * Western positions double as the slot names because the model's class order is URFDLB in that
 * scheme — a historical accident this function turns into a stated convention. A slot is a
 * colour's name, never its position; `positionOf` answers the second question.
 */
export function slotOf(colour: Colour): Face {
  return FACES[colour]!;
}

/** The colour whose capture a slot holds — the inverse of `slotOf`. */
export function colourOfSlot(slot: Face): Colour {
  return FACES.indexOf(slot) as Colour;
}

/**
 * Is `centre` a colour class at all? The detector emits 0..5 and nothing else; a centre outside
 * that range names no face and no scheme, and every assembler refuses it before this file is
 * asked anything. Kept here so the check reads in the vocabulary it is about.
 */
export function isColour(centre: number): centre is Colour {
  return Number.isInteger(centre) && centre >= 0 && centre < COLOURS.length;
}

/** The four colours around `colour` under `scheme`, in the order top, right, bottom, left of its
 *  face held canonically — the same order `FACE_NEIGHBOURS` gives positions. */
export function neighbourColours(colour: Colour, scheme: Scheme): readonly Colour[] {
  const around = FACE_NEIGHBOURS[positionOf(colour, scheme)];
  return (['top', 'right', 'bottom', 'left'] as const).map((side) =>
    colourOf(around[side], scheme),
  );
}

/** Whether two colours sit on adjacent faces under `scheme`. */
export function adjacentIn(a: Colour, b: Colour, scheme: Scheme): boolean {
  return neighbourColours(a, scheme).includes(b);
}

/**
 * The colours adjacent to `colour` in EVERY one of `schemes` — the only sides a child can be told
 * to hold "upwards" while the scheme is still undecided, because an instruction naming two
 * opposite faces is one the cube in the hand cannot obey. For blue that is red, yellow and orange
 * (white is above it in one scheme and opposite it in the other); for a side that is white's
 * neighbour in both — green, red, orange — white is always permitted.
 */
export function commonNeighbours(colour: Colour, schemes: readonly Scheme[]): readonly Colour[] {
  return COLOURS.filter((c) => c !== colour && schemes.every((s) => adjacentIn(colour, c, s)));
}

/**
 * How a capture of the `colour` side held with `up` upwards relates to that side's CANONICAL
 * capture under `scheme`: the number of clockwise quarter turns that take the canonical capture
 * to the held one, or null when `up` is not adjacent to `colour` in this scheme — a hold that the
 * scheme says is impossible.
 *
 * Why this exists: a confirmation is a PHOTOGRAPH, and the same truthful photograph of the blue
 * side "red up" is canonical for a Western B (red is B's left neighbour, so red-up is B turned a
 * quarter turn one way) and for a Japanese D (red is D's right neighbour, the other way) at
 * rotations a half turn apart. Applying one rotation to both candidates would eliminate the true
 * cube under one scheme every time (Codex refute pass, 2026-09-07). So a confirmation is stored
 * as the request it answered and projected into each candidate's frame through this offset.
 *
 * The arithmetic: `FACE_NEIGHBOURS` lists a face's neighbours top, right, bottom, left in its
 * canonical reading order. Holding the RIGHT neighbour up turns the face a quarter turn
 * counter-clockwise as the camera sees it (the right edge rises to the top), and `rotateFace`
 * turns clockwise, so right-up is canonical turned three times, bottom-up twice, left-up once.
 * Pinned by scheme.test.ts against captures built the physical way round.
 */
export function holdOffset(colour: Colour, up: Colour, scheme: Scheme): number | null {
  const around = neighbourColours(colour, scheme);
  const side = around.indexOf(up);
  if (side < 0) return null;
  return (4 - side) % 4;
}

/**
 * The colour that was UPWARDS when a capture was taken, given the canonical rotation a candidate
 * assigned it under `scheme` — the physical, scheme-free name for a rotation.
 *
 * Why it is needed: a canonical rotation is a number IN A SCHEME'S FRAME. `rotate(capture, r)` is
 * canonical, so the capture is canonical turned by `(4 - r) % 4`, which is the hold whose
 * `holdOffset` is `(4 - r) % 4` — and since `holdOffset` is `(4 - sideIndex) % 4`, that hold's
 * up-colour is the `r`-th neighbour in [top, right, bottom, left] order. The neighbours differ
 * between the schemes wherever the positions do, so the SAME `r` names a different physical hold:
 * measured, 12 of the 24 (slot, rotation) pairs. Comparing raw rotations across candidates of
 * different schemes is therefore a comparison in mixed frames, and it was how `undeterminedSlots`
 * and `pickVerification` decided which side to ask about (found by audit, 2026-09-07). Through
 * this function both compare the thing a child actually does — which colour was on top.
 *
 * `scheme.test.ts` pins the derivation against `holdOffset` itself, and pins that the two schemes
 * disagree, so a table change cannot quietly make this a no-op.
 */
export function heldUpColour(colour: Colour, rotation: number, scheme: Scheme): Colour {
  return neighbourColours(colour, scheme)[((rotation % 4) + 4) % 4]!;
}

/**
 * The scheme a set of six centres describes, or undefined when it is neither — a hand-painted
 * arrangement that matches no table, or captures that are not six distinct colours.
 */
export function schemeOfCentres(centres: Readonly<Record<Face, number>>): Scheme | undefined {
  return SCHEMES.find((scheme) => FACES.every((p) => centres[p] === colourOf(p, scheme)));
}

/** A side's neighbour on a given side under a scheme, as a colour — `FACE_NEIGHBOURS` in colours. */
export function neighbourColour(colour: Colour, side: Side, scheme: Scheme): Colour {
  return colourOf(FACE_NEIGHBOURS[positionOf(colour, scheme)][side], scheme);
}
