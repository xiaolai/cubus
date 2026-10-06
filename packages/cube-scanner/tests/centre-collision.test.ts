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
import { assembleColors, type ColorFace, withCentre } from '../src/ai-assemble.js';
import { type Colour, colourOfSlot, slotOf } from '../src/scheme.js';
import { FACES, type Face } from '../src/types.js';
import { sideClaimed } from '../view/ai-scan-panel.js';
import { schemeShownIn, sideShownIn } from '../view/session-replay.js';
import { CENTRE_COLLISIONS, type CentreCollisionCase } from './fixtures/centre-collisions.js';

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

// ---- §5's question, run over the same seven as a STRUCTURAL experiment ------------------------
//
// `dev-docs/asking-which-side-plan.md` §6 asks for the photo drop to go through `assembleColors`
// SEPARATELY from the replay, and this is why: these are photographs, one side at a time. There is
// no video, no stillness gate and no camera, so a harness that drove the panel with them would be
// measuring a stand-in for the thing it wants to know. What a drop CAN answer is structural — given
// these six readings, in this order, what does the filing rule place where, and does the assembler
// accept the cube that is actually on the table?
//
// THE PERSON IS STOOD IN FOR BY THE CASE'S OWN TRUTH, never by the scan: whether an answer is right
// is a fact about the cube, and asking the reading under test would be selecting the ground truth
// with the function being measured.

describe('what asking which side does to the seven, and what it does not', () => {
  // The person is stood in for by `sideShownIn` — the SAME rule the replay harness answers with
  // (`view/session-replay.ts`), imported rather than written again: a second copy would make the
  // two experiments §6 asks for incomparable, and its constants were measured on this very drop.
  //
  // WHICH ARRANGEMENT EACH CUBE IS, MEASURED (Codex audit, 2026-09-25). A truth string is
  // POSITIONAL and a capture holds colour CLASSES; on a Western cube the two map through the
  // identity and on a Japanese one the Down and Back positions swap their colours, so reading them
  // as one is ADR 0001's oldest trap. This fixture never recorded an arrangement, so it is taken
  // from the readings themselves over all six captures, and refused if they do not say clearly.
  const schemeOf = (kase: CentreCollisionCase) =>
    schemeShownIn(
      kase.captures.map((c) => c.colors),
      kase.truth,
    ) ?? undefined;

  /**
   * File six captures the way the panel does since 2026-09-25: by the centre's claim, asking about
   * a collision, and filling the last slot by elimination.
   *
   * WRITTEN OUT HERE ON PURPOSE. The panel's own rules are exercised against it in
   * `ai-scan-panel.test.ts` and `real-clip.test.ts`, through the real element; what this needs is
   * the rules applied to a DROP of photographs, which the element cannot be given. Kept to the
   * three that decide a slot — claim, question, elimination — and nothing else.
   */
  function fileWithQuestion(kase: CentreCollisionCase) {
    const held = new Map<Face, ColorFace>();
    /** Every question raised, and what the person could say about it. */
    const asks: { claimed: Face; answer: Colour | null; placed: boolean }[] = [];
    const leftOver: ColorFace[] = [];
    for (const capture of kase.captures) {
      const claim = sideClaimed(capture.colors)!;
      if (!held.has(claim)) {
        held.set(claim, capture);
        continue;
      }
      // A COLLISION. §5: keep the capture and ask which side it is, offering the FREE colours. The
      // answer is a COLOUR (ADR 0001), and its slot is that colour's name; these fixtures record no
      // arrangement, so `sideShownIn` tries both and answers only where they agree.
      const free = FACES.filter((f) => !held.has(f));
      const answer = sideShownIn(capture.colors, kase.truth, schemeOf(kase));
      const slot = answer === null ? null : slotOf(answer);
      const placed = slot !== null && free.includes(slot);
      asks.push({ claimed: claim, answer, placed });
      if (placed) held.set(slot, withCentre(capture, answer!));
      else leftOver.push(capture);
    }
    // The determined sixth, unchanged: one slot free and one capture unplaced.
    const free = FACES.filter((f) => !held.has(f));
    if (free.length === 1 && leftOver.length === 1) {
      held.set(free[0]!, withCentre(leftOver[0]!, colourOfSlot(free[0]!)));
    }
    return { held, asks };
  }

  it.each(CENTRE_COLLISIONS.map((c) => [c.name, c] as const))(
    'never assembles a cube that is not the cube — %s',
    (_name, kase) => {
      // THE GATE (§6), asked of every case whatever the question did with it. A reading that
      // assembles must be the cube on the table.
      const { held } = fileWithQuestion(kase);
      if (held.size < FACES.length) return;
      const result = assembleColors(
        Object.fromEntries(held) as Record<Face, ColorFace>,
        undefined,
        {},
        { diagnose: false },
      );
      if (result.valid) expect(result.facelets).toBe(kase.truth);
    },
  );

  it('places both sides on the two where the true side was shown first, and on no others', () => {
    // THE MEASUREMENT, and the reason §5's acceptance was not met on the 09-18 clip. The question
    // offers the FREE colours. When the TRUE owner of the shared colour arrived first, the colour
    // of the side in hand is still free and the person can name it; when the misread side arrived
    // first it took that colour, and the one answer that would be right is not on offer.
    //
    // Pinned BY NAME, so a change that rescues any of the other five has to come here and say which.
    const placed = CENTRE_COLLISIONS.filter((kase) =>
      fileWithQuestion(kase).asks.every((a) => a.placed),
    ).map((k) => k.name);
    expect(placed).toEqual([
      'cube A, cubedet V6FT: red centre read as orange',
      'cube E, cubedet V6FT: red centre read as orange',
    ]);
    // And those are exactly the two the arrival order already made come out right — which is what
    // says the question adds no new coverage here, only an earlier and explicit placement.
    for (const kase of CENTRE_COLLISIONS) {
      const { asks } = fileWithQuestion(kase);
      expect(asks, `${kase.name}: no question was raised`).toHaveLength(1);
      const ask = asks[0]!;
      // The person can always SAY which side they are holding; whether it can be placed is the
      // question's limit, not theirs.
      expect(ask.answer, `${kase.name}: the truth could not name the side in hand`).not.toBeNull();
      expect(ask.placed).toBe(ask.answer !== colourOfSlot(ask.claimed));
    }
  });

  it('every one of the seven says which arrangement it is, clearly enough to read it by', () => {
    // The precondition the two cases below rest on: an unmeasurable arrangement would make
    // `sideShownIn` abstain on every capture, and both would pass by measuring nothing.
    for (const kase of CENTRE_COLLISIONS) {
      expect(schemeOf(kase), `${kase.name}: the readings do not name an arrangement`).toBeDefined();
    }
  });

  it('fills six slots on every case, where the rule alone filled five', () => {
    // What the question buys structurally, even where the answer cannot be taken: the capture is
    // kept rather than dropped, so the determined-sixth rule has something to place. Five became
    // six on all seven — and on five of them the two sides are exchanged, which is why six slots
    // filled is not the same as a cube, and why the case above this one exists.
    for (const kase of CENTRE_COLLISIONS) {
      const { held } = fileWithQuestion(kase);
      expect(held.size, kase.name).toBe(FACES.length);
    }
  });
});
