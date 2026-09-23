// @vitest-environment happy-dom
//
// WHAT THE SCAN DOES WITH A COLLIDING CENTRE, ON THE SEVEN MEASURED ON REAL CUBES.
//
// Seven cubes were photographed one side at a time on 2026-09-13 and read by two detectors; in each
// case two sides' centres came back the same colour, so a sixth side could never be filed. Four are
// a white cap with a blue logo printed on it, three are red read as orange
// (`tests/fixtures/centre-collisions.ts` — the reads, with no image).
//
// Until 2026-09-23 a whole mechanism existed to place those sides anyway: the colliding pair was
// held UNNAMED and `resolveCentres` enumerated every way of filing them, taking the filing that
// made a legal cube. The owner had it removed — on the cube it was written for the scan took a
// minute or more and then showed a side it could not place — so a side is its centre again, and a
// colour a second side claims is refused.
//
// THIS FILE PRICES THAT DECISION ON MEASUREMENT RATHER THAN ON ARGUMENT, and the price is worse
// than "one side short". The two halves below are the whole of it, and the second is the one to
// read:
//
//   1. Five sides are filed, never six. Which five is decided by ARRIVAL: the first capture to
//      claim a colour is filed and the second is refused, because nothing here can say which of the
//      two is the misread one.
//   2. On FIVE of the seven, the side filed under the shared colour IS THE WRONG SIDE — the white
//      cap with the logo arrives first, claims blue, and is filed as the blue side; the real blue
//      side then finds blue taken and is turned away. The two cases that come out right are the two
//      where the true side happened to be shown first, which is luck and not a property.
//
// The whole-cube promise still holds and is asserted here: five sides is not a cube, so nothing is
// ever REPORTED. What the person sees is a tile painted with another side's colours under the wrong
// label, and a scan that will not finish. That is the standing cost of the removal, and the number
// a future attempt at this problem has to beat. The fixture is kept live rather than deleted with
// the resolver, because seven real collisions with independently established truth are expensive to
// measure and are the evidence any such attempt will be judged on.

import { describe, expect, it } from 'vitest';
import { FACES, type Face } from '../src/types.js';
import { sideClaimed } from '../view/ai-scan-panel.js';
import { CENTRE_COLLISIONS } from './fixtures/centre-collisions.js';

/** Where each position's sticker comes from when a side is turned a quarter in the hand. */
const QUARTER = [6, 3, 0, 7, 4, 1, 8, 5, 2];

/** The nine stickers `truth` gives the side at `face`, as colour classes. */
function truthOf(truth: string, face: Face): number[] {
  const at = FACES.indexOf(face) * 9;
  return [...truth.slice(at, at + 9)].map((letter) => FACES.indexOf(letter as Face));
}

/**
 * How many of the nine `read` and `want` share, at the best of the four rotations.
 *
 * ROTATIONS, because the camera cannot see which way up a side was held — a capture's rotation is
 * unknown until the assembly solves it, so a comparison fixed at one would report a correctly-read
 * side held a quarter turn round as a stranger.
 *
 * And AGREEMENT rather than equality, because every capture here contains misreads beyond the
 * centre: that is what a collision is. The question worth asking of a filing is not "is it perfect"
 * but "is it this side at all", and the answer is which truth face it agrees with most.
 */
function agreement(read: readonly number[], want: readonly number[]): number {
  let best = 0;
  let turned = [...read];
  for (let k = 0; k < 4; k++) {
    best = Math.max(best, turned.filter((c, i) => c === want[i]).length);
    turned = QUARTER.map((i) => turned[i]!);
  }
  return best;
}

/** Which of the six sides of `truth` this read is, by best agreement. Null on a tie. */
function readsAs(read: readonly number[], truth: string): Face | null {
  const scores = FACES.map((f) => agreement(read, truthOf(truth, f)));
  const best = Math.max(...scores);
  const winners = FACES.filter((_, i) => scores[i] === best);
  return winners.length === 1 ? winners[0]! : null;
}

/** What the panel does with six captures shown in order: file by claim, first one wins. */
function fileInOrder(captures: readonly { colors: readonly number[] }[]) {
  const claims = captures.map((c) => sideClaimed(c.colors));
  const filed = new Map<Face, readonly number[]>();
  for (const [i, claim] of claims.entries()) {
    if (claim !== undefined && !filed.has(claim)) filed.set(claim, captures[i]!.colors);
  }
  return { claims, filed };
}

describe('a centre a second side claims, on the seven collisions measured on real cubes', () => {
  it.each(CENTRE_COLLISIONS.map((c) => [c.name, c] as const))('%s', (_name, kase) => {
    const { claims, filed } = fileInOrder(kase.captures);
    expect(
      claims.every((c) => c !== undefined),
      'a capture claimed no side at all',
    ).toBe(true);

    // FIVE, NOT SIX. Exactly two captures claim one colour — that is what makes this a collision —
    // so five colours are claimed between six sides and one side is never filed. The scan therefore
    // cannot finish, which is the whole-cube promise holding: an incomplete scan reports nothing,
    // so none of what follows can become a cube the app states.
    expect(new Set(claims).size).toBe(5);
    expect(filed.size).toBe(5);

    // Every filed side is A side of this cube, read well enough to be told from the other five.
    for (const read of filed.values()) {
      expect(
        readsAs(read, kase.truth),
        'a filed capture matches no side of the cube',
      ).not.toBeNull();
    }
  });

  it('files the WRONG side under the shared colour on five of the seven', () => {
    // THE MEASUREMENT, and the reason this file is not a victory lap. On the four logo cubes the
    // white cap reads blue, arrives first, and is filed as the blue side — its nine stickers agree
    // with the cube's WHITE side (6 or 7 of 9) far better than with its blue one (3 or 4). Cube F
    // is the same shape with the other cause: a red side filed as orange.
    //
    // Pinned by NAME, so that a change which fixes some of these has to come here and say which.
    const wrong = CENTRE_COLLISIONS.filter((kase) => {
      const { claims, filed } = fileInOrder(kase.captures);
      const shared = claims.find((c, i) => claims.indexOf(c) !== i)!;
      return readsAs(filed.get(shared)!, kase.truth) !== shared;
    }).map((k) => k.name);

    expect(wrong).toEqual([
      'cube B, v3: white centre read as blue (a logo printed on the cap)',
      'cube B, cubedet V6FT: white centre read as blue (a logo printed on the cap)',
      'cube C, v3: white centre read as blue (a logo printed on the cap)',
      'cube F, cubedet V6FT: red centre read as orange',
      'cube G, v3: white centre read as blue (a logo printed on the cap)',
    ]);

    // And the two that come out right are right by ARRIVAL ORDER, not by anything the scan knows:
    // the true side was simply shown first. Stated so that "5 of 7" is not read as "2 of 7 work".
    for (const name of [
      'cube A, cubedet V6FT: red centre read as orange',
      'cube E, cubedet V6FT: red centre read as orange',
    ]) {
      const kase = CENTRE_COLLISIONS.find((k) => k.name === name)!;
      const { claims } = fileInOrder(kase.captures);
      const shared = claims.find((c, i) => claims.indexOf(c) !== i)!;
      const first = claims.indexOf(shared);
      expect(readsAs(kase.captures[first]!.colors, kase.truth)).toBe(shared);
    }
  });

  it('covers both causes, so neither can be fixed by a change that only suits the other', () => {
    // Four logo caps and three red-read-as-orange. A change that made the logo cubes work by
    // reading white harder would leave the red/orange ones exactly where they are, and a suite
    // holding only one kind would not say so.
    expect(CENTRE_COLLISIONS).toHaveLength(7);
    expect(CENTRE_COLLISIONS.filter((c) => c.logo)).toHaveLength(4);
  });
});
