import { describe, expect, it } from 'vitest';
import { FACE_NEIGHBOURS, rotateFace } from '../src/facelet-cube.js';
import {
  adjacentIn,
  COLOURS,
  colourOf,
  colourOfSlot,
  commonNeighbours,
  holdOffset,
  isColour,
  neighbourColours,
  positionOf,
  SCHEME_COLOURS,
  SCHEMES,
  schemeOfCentres,
  slotOf,
} from '../src/scheme.js';
import { FACES, type Face } from '../src/types.js';

describe('the scheme table', () => {
  it('is a bijection per scheme, and the two differ only in which of blue/yellow is under white', () => {
    for (const scheme of SCHEMES) {
      const colours = FACES.map((p) => colourOf(p, scheme));
      expect([...colours].sort()).toEqual([0, 1, 2, 3, 4, 5]);
      for (const c of COLOURS) expect(colourOf(positionOf(c, scheme), scheme)).toBe(c);
    }
    // U, F, R, L untouched (dev-docs/colour-scheme-switch.md §2): white up, green front, red right.
    for (const p of ['U', 'F', 'R', 'L'] as Face[]) {
      expect(colourOf(p, 'western')).toBe(colourOf(p, 'japanese'));
    }
    expect(colourOf('D', 'western')).toBe(3); // yellow under white on a Western cube
    expect(colourOf('D', 'japanese')).toBe(5); // blue under white on a Japanese cube
    expect(colourOf('B', 'western')).toBe(5);
    expect(colourOf('B', 'japanese')).toBe(3);
  });

  it('Western is the slot convention: class i files under FACES[i]', () => {
    for (const c of COLOURS) {
      expect(slotOf(c)).toBe(FACES[c]);
      expect(colourOfSlot(slotOf(c))).toBe(c);
      expect(positionOf(c, 'western')).toBe(slotOf(c));
    }
  });

  it('opposite pairs are what the two schemes disagree about', () => {
    const opposite = (scheme: 'western' | 'japanese', c: number) => {
      const p = positionOf(c as 0, scheme);
      const opp = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' } as const;
      return colourOf(opp[p], scheme);
    };
    expect(opposite('western', 0)).toBe(3); // white ↔ yellow
    expect(opposite('western', 2)).toBe(5); // green ↔ blue
    expect(opposite('japanese', 0)).toBe(5); // white ↔ blue
    expect(opposite('japanese', 2)).toBe(3); // green ↔ yellow
    expect(opposite('western', 1)).toBe(4); // red ↔ orange, both
    expect(opposite('japanese', 1)).toBe(4);
  });

  it('a Japanese cube is the opposite chirality of BOY at the DBL corner', () => {
    // Western reads blue → orange → yellow clockwise around DBL (the definition of BOY);
    // Japanese reads the same three colours in the reversed cyclic order. The renderer's
    // chirality assertion must therefore be written per scheme, never reused (§2).
    const dbl = (scheme: 'western' | 'japanese') =>
      (['B', 'L', 'D'] as Face[]).map((p) => colourOf(p, scheme));
    expect(dbl('western')).toEqual([5, 4, 3]);
    expect(dbl('japanese')).toEqual([3, 4, 5]);
  });

  it('recognises each scheme from its six centres, and nothing else', () => {
    for (const scheme of SCHEMES) {
      expect(schemeOfCentres(SCHEME_COLOURS[scheme])).toBe(scheme);
    }
    // Red on the left is neither — a mirrored cube is out of scope and must not be mistaken.
    expect(schemeOfCentres({ U: 0, R: 4, F: 2, D: 3, L: 1, B: 5 })).toBeUndefined();
    expect(schemeOfCentres({ U: 0, R: 0, F: 2, D: 3, L: 4, B: 5 })).toBeUndefined();
  });

  it('a centre is a colour class or nothing', () => {
    for (const c of COLOURS) expect(isColour(c)).toBe(true);
    for (const bad of [6, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(isColour(bad)).toBe(false);
  });
});

describe('adjacency across schemes', () => {
  it('names each colour’s four neighbours per scheme', () => {
    // Blue: around a Western B (white, orange, yellow, red); around a Japanese D (green, red,
    // yellow, orange). Only red, yellow and orange are neighbours in both.
    expect([...neighbourColours(5, 'western')].sort()).toEqual([0, 1, 3, 4]);
    expect([...neighbourColours(5, 'japanese')].sort()).toEqual([1, 2, 3, 4]);
    expect(commonNeighbours(5, SCHEMES)).toEqual([1, 3, 4]);
    // White: green, red and orange in both; blue only in Western, yellow only in Japanese.
    expect(commonNeighbours(0, SCHEMES)).toEqual([1, 2, 4]);
    // Red and orange sit between the same four colours in both schemes.
    expect(commonNeighbours(1, SCHEMES)).toEqual([0, 2, 3, 5]);
    expect(commonNeighbours(4, SCHEMES)).toEqual([0, 2, 3, 5]);
    // With one scheme in play, every neighbour is permitted.
    for (const scheme of SCHEMES)
      for (const c of COLOURS) {
        expect(commonNeighbours(c, [scheme]).length).toBe(4);
      }
  });

  it('adjacentIn agrees with the position geometry', () => {
    for (const scheme of SCHEMES) {
      for (const p of FACES) {
        const around = Object.values(FACE_NEIGHBOURS[p]);
        for (const q of FACES) {
          expect(adjacentIn(colourOf(p, scheme), colourOf(q, scheme), scheme)).toBe(
            around.includes(q),
          );
        }
      }
    }
  });
});

describe('holdOffset — a photograph held a known way up, in each scheme’s frame', () => {
  /**
   * Build the capture a camera sees when the `position` face of a cube in canonical layout is
   * held with its `side` neighbour upwards — the PHYSICAL way round, from first principles, so
   * the offset is tested against a construction and not against itself: holding the right
   * neighbour up turns the face a quarter turn counter-clockwise as seen (its right edge rises),
   * which in reading order is three clockwise quarter turns.
   */
  const physicalTurns = { top: 0, right: 3, bottom: 2, left: 1 } as const;

  it('is null for a hold the scheme calls impossible, and the physical turn count otherwise', () => {
    for (const scheme of SCHEMES) {
      for (const c of COLOURS) {
        const p = positionOf(c, scheme);
        for (const [side, q] of Object.entries(FACE_NEIGHBOURS[p]) as [
          keyof typeof physicalTurns,
          Face,
        ][]) {
          expect(holdOffset(c, colourOf(q, scheme), scheme)).toBe(physicalTurns[side]);
        }
        const opposite = COLOURS.find((o) => o !== c && !adjacentIn(c, o, scheme))!;
        expect(holdOffset(c, opposite, scheme)).toBeNull();
        expect(holdOffset(c, c, scheme)).toBeNull();
      }
    }
  });

  it('the same photograph of the blue side "red up" is a half turn apart between schemes', () => {
    // Red is B's LEFT neighbour in Western and D's RIGHT neighbour in Japanese, so the two
    // canonical rotations differ by 180° — the case a single shared rotation gets wrong.
    expect(holdOffset(5, 1, 'western')).toBe(1);
    expect(holdOffset(5, 1, 'japanese')).toBe(3);
    // And a held capture really is the canonical one turned by that offset: rotateFace applied
    // `offset` times to a labelled canonical face puts the up-neighbour's edge on top.
    const canonical = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(rotateFace(canonical, holdOffset(5, 1, 'western')!)).toEqual([
      6, 3, 0, 7, 4, 1, 8, 5, 2,
    ]);
    expect(rotateFace(canonical, holdOffset(5, 1, 'japanese')!)).toEqual([
      2, 5, 8, 1, 4, 7, 0, 3, 6,
    ]);
  });
});
