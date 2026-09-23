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
// stdin: a JSON array of sets, each `{ "captures": [six { colors, confidence, scores, lab? }] }` in photo
// order, every array in the app's reading order. stdout: one decision per set, in the same order.
import { readFileSync } from 'node:fs';
import {
  type AiScanResult,
  assembleColors,
  type ColorFace,
  LOW_CONFIDENCE_THRESHOLD,
  matchingRotations,
} from '../packages/cube-scanner/src/ai-assemble.js';
import {
  assignNineOfEach,
  NUM_COLORS,
  PER_COLOR,
} from '../packages/cube-scanner/src/nine-of-each.js';
import { colorsFromPaint } from '../packages/cube-scanner/src/paint-groups.js';
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
  /**
   * Median CIE Lab per sticker, when the caller had the pixels. OPTIONAL: the assembly reads it only
   * where everything else has refused (`paint-groups.ts`), so a payload without it decides exactly as
   * it did before.
   */
  lab?: [number, number, number][];
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
 * File six sides under their centres' colours, exactly as the panel does.
 *
 * A SIDE IS ITS CENTRE, and a colour on two centres is a filing that cannot be made (2026-09-23,
 * the owner's call). This used to hand the collision to `resolveCentres`, which enumerated every way
 * the two could fill the two free slots and took the one legal filing — by legality first, then by
 * which centre read less surely. That machinery was removed from the app, and this tool exists to be
 * the app's assembly rather than a second opinion about what a real cube is, so the collision is
 * refused here too. A contributor whose white cap reads as its logo now gets `null` and is asked
 * again, where before they got a filing the app itself would no longer produce.
 */
function fileSides(
  captures: readonly Capture[],
  byCentre: ReadonlyMap<number, number[]>,
): Filing | null {
  if (byCentre.size !== FACES.length) return null;
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

  // WHICH COLOURING TO SHOW. Legal as read: show it as read. Otherwise the assembly reached its legal
  // cube by recolouring, and this has to show the SAME recolouring — it cannot be re-derived by
  // guessing, so the candidates are tried in the assembly's own order and the first that assembles
  // to a legal cube wins: nine-of-each first (`repairByCounts`), then the pixels
  // (`recolourByPaint`). Stickers go to each in slot order when there is a filing, because that is
  // the order the assembly uses and a tie must break the way the scanner's did.
  //
  // When none of them is legal the reading is refused anyway, and the nine-of-each colouring is
  // still the likeliest one a physical cube allows, so that is what the page is shown.
  const colors = reads.map((read) => [...read.colors]);
  if (!(legal && nineOfEach(colors))) {
    const order = filing ? FACES.map((slot) => filing.photoOf[slot]) : captures.map((_, p) => p);
    const scores = order.flatMap((p) => reads[p]!.scores!);
    const lab = order.every((p) => reads[p]!.lab?.length === PER_COLOR)
      ? order.flatMap((p) => reads[p]!.lab!)
      : null;
    const candidates = [assignNineOfEach(scores).colors];
    // The pixels regroup, the centres name — the same call the assembly makes, in the same order.
    const painted = lab
      ? colorsFromPaint(
          lab,
          order.map((p) => reads[p]!.colors[4]!),
        )
      : null;
    if (painted) candidates.push(painted);
    const apply = (flat: number[]): number[][] => {
      const out = colors.map((row) => [...row]);
      order.forEach((p, k) => {
        out[p] = flat.slice(k * PER_COLOR, (k + 1) * PER_COLOR);
      });
      return out;
    };
    const fits = (rows: number[][]): boolean => {
      const faces = {} as Record<Face, ColorFace>;
      rows.forEach((row, p) => {
        faces[slotOf(row[4] as Colour)] = { ...reads[p]!, colors: row };
      });
      return (
        Object.keys(faces).length === FACES.length &&
        legalFit(assembleColors(faces, LOW_CONFIDENCE_THRESHOLD, {}, { diagnose: false }))
      );
    };
    const chosen =
      candidates.map(apply).find((rows) => !legal || fits(rows)) ?? apply(candidates[0]!);
    chosen.forEach((row, p) => {
      colors[p] = row;
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
    const { colors, confidence, scores, lab } = (raw ?? {}) as Record<string, unknown>;
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
    // Lab is optional, but a malformed one is refused rather than dropped: silently ignoring it would
    // turn "the pixels were supplied" into "the pixels were supplied and quietly thrown away".
    const labOk =
      lab === undefined ||
      (Array.isArray(lab) &&
        lab.length === PER_COLOR &&
        lab.every(
          (row) =>
            Array.isArray(row) &&
            row.length === 3 &&
            row.every((v) => typeof v === 'number' && Number.isFinite(v)),
        ));
    if (!labOk) throw new Error(`${where}, photo ${p}: malformed lab`);
    return {
      colors,
      confidence,
      scores,
      ...(Array.isArray(lab) && lab.length === PER_COLOR ? { lab } : {}),
    } as Capture;
  });
}

const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(input)) throw new Error('stdin: expected a JSON array of sets');
process.stdout.write(JSON.stringify(input.map((set, n) => decide(parseSet(set, `set ${n}`)))));
