// The cube half of ml/propose.py: six photographs' sticker reads go in; the colours to show their
// contributor come out, with the stickers worth a closer look and whether the colours form a legal
// cube.
//
// It is the SCANNER'S assembly, bundled by `propose.py bundle`, never a second copy of it. Legality,
// the nine-of-each repair and the centre-collision rule are the code the app runs, so a proposal and
// the app cannot disagree about what a real cube is. The one thing added here is what a scan never
// needs: the verdict mapped back onto six photographs in the order they were taken.
//
//   node propose-assemble.mjs < sets.json > decisions.json
//
// stdin: a JSON array of sets, each `{ "captures": [six { colors, confidence, scores }] }` in photo
// order, every array in the app's reading order. stdout: one decision per set, in the same order.
import { readFileSync } from 'node:fs';
import {
  type AiScanResult,
  assembleColors,
  type ColorFace,
  LOW_CONFIDENCE_THRESHOLD,
  matchingRotations,
  resolveCentreCollision,
} from '../packages/cube-scanner/src/ai-assemble.js';
import {
  assignNineOfEach,
  NUM_COLORS,
  PER_COLOR,
} from '../packages/cube-scanner/src/nine-of-each.js';
import { type Colour, isColour, slotOf } from '../packages/cube-scanner/src/scheme.js';
import { FACES, type Face } from '../packages/cube-scanner/src/types.js';

/**
 * A sticker whose detector scores are this close (best minus runner-up) is outlined even when
 * nothing changed it: where a legal cube that is not the contributor's would differ, if the assembly
 * ever settled on one.
 *
 * Measured on seven real cubes (378 stickers, V6FT, 2026-09-13), and a weak signal. The 25 wrong
 * stickers had margins from 0.35 to 0.90 and half the right ones sat at 0.90 or below, so no
 * threshold separates them. Below 0.7, 9 of the 23 raw stickers were wrong — six times the base
 * rate — at 3.3 outlines a cube. After reconciliation all seven proposals were right, and this
 * added 14 outlines (two a cube) to the 25 stickers the repair changed, none on a wrong sticker. It
 * has caught nothing on real cubes yet; it stays because the failure it is for, a wrong legal
 * cube, did not occur in that sample.
 */
export const UNSURE_MARGIN = 0.7;

export interface Capture {
  colors: number[];
  confidence: number[];
  scores: number[][];
}

export type Decision =
  | { status: 'unusable'; reason: 'same_side_twice'; photos: [number, number] }
  | {
      status: 'confirm';
      /** The proposed 54 colours are a cube that exists. False is still worth asking about. */
      legal: boolean;
      /** For the log: what the assembly said, in its own words. */
      verdict: string;
      photos: { colors: number[]; uncertain: number[] }[];
    };

/** How the six captures were filed by centre colour, and what the assembly made of that filing. */
interface Filing {
  faces: Record<Face, ColorFace>;
  photoOf: Record<Face, number>;
  result: AiScanResult;
}

/** A legal cube fits: accepted outright, or legal but needing a look the photos cannot give. */
const legalFit = (r: AiScanResult): boolean =>
  r.valid || r.ambiguous === true || r.confirm !== undefined;

const margin = (scores: readonly number[]): number => {
  const [best = 0, next = 0] = [...scores].sort((a, b) => b - a);
  return best - next;
};

const nineOfEach = (colors: readonly (readonly number[])[]): boolean => {
  const counts = new Array<number>(NUM_COLORS).fill(0);
  for (const row of colors) for (const c of row) counts[c]!++;
  return counts.every((n) => n === PER_COLOR);
};

/**
 * File six sides under their centres' colours, as the panel does — or, when one colour is on two
 * centres and one on none (most often a brand logo on the white cap, read as its ink), let
 * `resolveCentreCollision` decide which of the two is the missing colour. Null when no filing can
 * be made: two or more collisions, or a collision the resolver refuses to decide.
 */
function fileSides(
  captures: readonly Capture[],
  byCentre: ReadonlyMap<number, number[]>,
): Filing | null {
  if (byCentre.size === FACES.length) {
    const faces = {} as Record<Face, ColorFace>;
    const photoOf = {} as Record<Face, number>;
    captures.forEach((capture, p) => {
      const slot = slotOf(capture.colors[4] as Colour);
      faces[slot] = capture;
      photoOf[slot] = p;
    });
    return {
      faces,
      photoOf,
      result: assembleColors(faces, LOW_CONFIDENCE_THRESHOLD, {}, { diagnose: false }),
    };
  }
  const shared = [...byCentre.entries()].filter(([, photos]) => photos.length > 1);
  if (byCentre.size !== FACES.length - 1 || shared.length !== 1) return null;
  const [centre, [first, second]] = shared[0] as [number, [number, number]];
  const filed: Partial<Record<Face, ColorFace>> = {};
  const photoOf: Partial<Record<Face, number>> = {};
  captures.forEach((capture, p) => {
    if (p === second) return;
    const slot = slotOf(capture.colors[4] as Colour);
    filed[slot] = capture;
    photoOf[slot] = p;
  });
  const newcomer = captures[second]!;
  const { faces, result } = resolveCentreCollision(filed, newcomer, LOW_CONFIDENCE_THRESHOLD, {
    diagnose: false,
  });
  if (!faces) return null;
  const sharedSlot = slotOf(centre as Colour);
  const missingSlot = FACES.find((slot) => filed[slot] === undefined)!;
  // Which photo went where. The resolver recolours one of the two and files the other under the
  // shared colour; whichever holds the shared slot still carries its own read there, and the two
  // reads differ in at least three stickers (the same-side check has already run), so comparing
  // them is unambiguous.
  const newcomerKeptShared = faces[sharedSlot].colors.every((c, i) => c === newcomer.colors[i]);
  photoOf[sharedSlot] = newcomerKeptShared ? second : first;
  photoOf[missingSlot] = newcomerKeptShared ? first : second;
  return { faces, photoOf: photoOf as Record<Face, number>, result };
}

export function decide(captures: readonly Capture[]): Decision {
  const byCentre = new Map<number, number[]>();
  captures.forEach((capture, p) => {
    byCentre.set(capture.colors[4]!, [...(byCentre.get(capture.colors[4]!) ?? []), p]);
  });

  // The same side photographed twice leaves another side in no photograph, so no answer to this set
  // can ever be a legal cube and asking for one wastes the contributor's minute. `matchingRotations`
  // is the panel's own test for "this is the side already filed".
  for (const photos of byCentre.values()) {
    for (let a = 0; a < photos.length; a++) {
      for (let b = a + 1; b < photos.length; b++) {
        const [pa, pb] = [photos[a]!, photos[b]!];
        if (matchingRotations(captures[pa]!, captures[pb]!).size > 0) {
          return { status: 'unusable', reason: 'same_side_twice', photos: [pa, pb] };
        }
      }
    }
  }

  const filing = fileSides(captures, byCentre);
  const legal = filing !== null && legalFit(filing.result);
  // Each photo's read as the filing holds it — with a recoloured centre and its certain score row,
  // where the resolver changed one.
  const reads: ColorFace[] = [...captures];
  if (filing) for (const slot of FACES) reads[filing.photoOf[slot]] = filing.faces[slot];

  // Legal as read: show it as read. Otherwise the nine-of-each colouring — the repair the assembly
  // made to reach its legal cube, or, when none was reached, still the likeliest colouring a
  // physical cube allows. Stickers go to the assignment in slot order when there is a filing,
  // because that is the order `repairByCounts` uses and a tie must break the way the scanner's did.
  const colors = reads.map((read) => [...read.colors]);
  if (!(legal && nineOfEach(colors))) {
    const order = filing ? FACES.map((slot) => filing.photoOf[slot]) : captures.map((_, p) => p);
    const assigned = assignNineOfEach(order.flatMap((p) => reads[p]!.scores!)).colors;
    order.forEach((p, k) => {
      colors[p] = assigned.slice(k * PER_COLOR, (k + 1) * PER_COLOR);
    });
  }

  // `legal` is a claim about the colours this returns, so check exactly those. A failure here is a
  // bug in the mapping above, never a property of the photographs.
  if (legal) {
    const faces = {} as Record<Face, ColorFace>;
    colors.forEach((row, p) => {
      faces[slotOf(row[4] as Colour)] = { ...reads[p]!, colors: row };
    });
    if (
      Object.keys(faces).length !== FACES.length ||
      !legalFit(assembleColors(faces, LOW_CONFIDENCE_THRESHOLD, {}, { diagnose: false }))
    ) {
      throw new Error('internal: the proposed colours are not the legal cube the assembly found');
    }
  }

  return {
    status: 'confirm',
    legal,
    verdict: filing ? (filing.result.reason ?? 'a legal cube') : 'centres could not be filed',
    photos: colors.map((row, p) => ({
      colors: row,
      uncertain: row.flatMap((c, i) =>
        c !== captures[p]!.colors[i] || margin(captures[p]!.scores[i]!) < UNSURE_MARGIN ? [i] : [],
      ),
    })),
  };
}

const isScore = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Zero trust at the boundary: a malformed read is refused here, not guessed through. */
export function parseSet(value: unknown, where: string): Capture[] {
  const captures = (value as { captures?: unknown } | null)?.captures;
  if (!Array.isArray(captures) || captures.length !== FACES.length) {
    throw new Error(`${where}: expected ${FACES.length} captures`);
  }
  return captures.map((raw: unknown, p) => {
    const { colors, confidence, scores } = (raw ?? {}) as Record<string, unknown>;
    const ok =
      Array.isArray(colors) &&
      colors.length === PER_COLOR &&
      colors.every((c) => typeof c === 'number' && isColour(c)) &&
      Array.isArray(confidence) &&
      confidence.length === PER_COLOR &&
      confidence.every(isScore) &&
      Array.isArray(scores) &&
      scores.length === PER_COLOR &&
      scores.every((row) => Array.isArray(row) && row.length === NUM_COLORS && row.every(isScore));
    if (!ok) throw new Error(`${where}, photo ${p}: malformed capture`);
    return { colors, confidence, scores } as Capture;
  });
}

const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(input)) throw new Error('stdin: expected a JSON array of sets');
process.stdout.write(JSON.stringify(input.map((set, n) => decide(parseSet(set, `set ${n}`)))));
