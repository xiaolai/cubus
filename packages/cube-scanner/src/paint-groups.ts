// WHICH STICKERS CARRY THE SAME PAINT — the question the detector is not asked, and the only one
// that is well posed when the light is unknown.
//
// A pixel is paint times light. "What colour is this sticker" therefore has no answer from one
// observation: red under warm light and orange under cool light produce the same pixel, and both
// occur in a child's bedroom. But the nine stickers in a photograph share one illuminant, so it
// cancels in any comparison BETWEEN them, and "do these two carry the same paint" survives the
// lighting that defeats the absolute question.
//
// The cube's three confusable pairs are the three OPPOSITE pairs, and each differs by yellow:
// white/yellow, red/orange, blue/green. In Lab that is one axis, b*, and an illuminant shift moves
// every sticker along the same axis together — which is why a misread cube is usually misread the
// same way on many stickers at once, not scattered.
//
// WHAT THIS IS WORTH, measured on the 131 complete community sets (2026-09-17, V6FT):
//
//   grouping all 54 stickers correctly   detector scores 128/131   plain median Lab 124/131
//
// So neither wins outright, and this is NOT a replacement for the scores — used on its own it reads
// 122 of 131 cubes against the shipped path's 128. It earns its place only where that path gives
// up: of the three sets the assembly refuses, Lab groups two of them PERFECTLY (54/54) while the
// scores manage 52 and 50. The groups are then named by the CENTRES, not by the scores — see
// `colorsFromPaint` for why that distinction is the whole safety of this file.
//
// AND IT CANNOT MAKE THINGS WORSE, which is the property that allows it to ship: over the same 131
// sets, every colouring it gets wrong is an ILLEGAL cube (9 of 9), so the assembly refuses it. It
// can turn a refusal into a correct read, or leave a refusal where it found one.

import { hungarian, NUM_COLORS, PER_COLOR, STICKERS } from './nine-of-each.js';

/** Median CIE Lab per sticker, in capture order: `[L, a, b]`, nine per face. */
export type StickerLab = readonly (readonly [number, number, number])[];

/** Balanced k-means iterations. It converges in a handful; the cap only bounds a pathological input. */
const ROUNDS = 25;
/**
 * How much closer a sticker must sit to its own group than to the nearest other one, as a ratio of
 * distances, for the grouping to be believed at all.
 *
 * THIS IS THE GATE, and the obvious alternative is the wrong one. The count repair refuses to overrule
 * the detector past a likelihood ceiling, but the whole value of the pixels is in the cases where the
 * detector is confidently wrong on many stickers at once — a likelihood ceiling would block exactly
 * those. What can be asked instead is whether the PIXELS are unambiguous: six paints under one light
 * are six tight clusters, and a photograph where they are not is one where this has nothing to say.
 * Without such a gate, measured on the 140 community sets, this turned five of v3's refusals into
 * correct reads and one into a legal cube that was not the user's.
 */
const MAX_RATIO = 0.7;

/**
 * Six groups of nine, by paint, from the a*b* plane alone.
 *
 * L* is deliberately left out: it carries the shading — a sticker on a face turned away from the
 * window is darker paint-for-paint, and including it groups by geometry as much as by colour.
 *
 * Balanced k-means: the group sizes are not discovered, they are known, so each round solves the
 * same rectangular assignment `nine-of-each` solves, with distance where that one has -log p.
 * Seeded by farthest-point, so the result does not depend on a random draw and a failure reproduces.
 *
 * @returns one group index (0..5) per sticker, or null when the input is not a whole cube's worth
 *   of finite Lab values.
 */
export function groupByPaint(lab: StickerLab): number[] | null {
  if (lab.length !== STICKERS) return null;
  const ab: [number, number][] = [];
  for (const row of lab) {
    if (row.length !== 3 || !row.every((v) => Number.isFinite(v))) return null;
    ab.push([row[1], row[2]]);
  }

  // Farthest-point seeding: start from the sticker furthest from the mean, then repeatedly take the
  // one furthest from everything chosen so far. Six colours are well separated in a*b*, so this puts
  // one seed in each without needing to know where they are.
  const mean: [number, number] = [
    ab.reduce((s, p) => s + p[0], 0) / ab.length,
    ab.reduce((s, p) => s + p[1], 0) / ab.length,
  ];
  const seeds: [number, number][] = [ab[argmaxBy(ab, (p) => squared(p, mean))]!];
  while (seeds.length < NUM_COLORS) {
    seeds.push(ab[argmaxBy(ab, (p) => Math.min(...seeds.map((s) => squared(p, s))))]!);
  }

  let centres = seeds;
  let groups: number[] | null = null;
  for (let round = 0; round < ROUNDS; round++) {
    const cost = ab.map((p) => {
      const row = new Array<number>(STICKERS);
      for (let c = 0; c < NUM_COLORS; c++) {
        const d = squared(p, centres[c]!);
        for (let k = 0; k < PER_COLOR; k++) row[c * PER_COLOR + k] = d;
      }
      return row;
    });
    const next = hungarian(cost).map((slot) => Math.floor(slot / PER_COLOR));
    if (groups && next.every((g, i) => g === groups![i])) break;
    groups = next;
    centres = centres.map((_, c) => {
      const members = ab.filter((_, i) => groups![i] === c);
      return [
        members.reduce((s, p) => s + p[0], 0) / members.length,
        members.reduce((s, p) => s + p[1], 0) / members.length,
      ] as [number, number];
    });
  }
  return groups;
}

/**
 * A whole cube's colouring: the pixels say which stickers share a paint, THE CENTRES say what each
 * paint is called.
 *
 * NAMING IS NOT A JUDGEMENT CALL HERE, and it cannot be, because legality cannot check it: any
 * permutation of six colours over a legal cube is another legal cube, so a naming that swaps red and
 * orange everywhere produces a cube that passes every downstream check and is not the user's. Scoring
 * the groups was tried and measured on the 140 community sets: the confident-but-wrong namings reach
 * 75 nats of margin where the correct ones start at 54, so no threshold separates them.
 *
 * What does settle it is the cube itself. Each face's centre never moves, and the assembly has already
 * refused any reading whose six centres are not six distinct colours filed under their own slots — so
 * each group holds exactly one centre, and that centre's colour IS the group's colour. The pixels then
 * decide only the question they are good at, and a colour cannot be swapped with another.
 *
 * @param lab median Lab per sticker, nine per face, faces in slot order.
 * @param centres the colour of each face's centre, in the same face order.
 * @returns nine colour classes per face in the order given, or null when the pixels cannot answer:
 *   missing or malformed Lab, groups that are not clearly separated, or a grouping that does not put
 *   the six centres in six different groups — which is itself evidence the grouping is wrong.
 */
export function colorsFromPaint(
  lab: StickerLab,
  centres: readonly number[],
  maxRatio = MAX_RATIO,
): number[] | null {
  if (centres.length !== NUM_COLORS) return null;
  if (!centres.every((c) => Number.isInteger(c) && c >= 0 && c < NUM_COLORS)) return null;
  if (new Set(centres).size !== NUM_COLORS) return null;
  const groups = groupByPaint(lab);
  if (!groups) return null;
  if (!wellSeparated(lab, groups, maxRatio)) return null;

  // One centre per group, or the grouping disagrees with something the assembly has already checked.
  const naming = new Array<number>(NUM_COLORS).fill(-1);
  for (let face = 0; face < NUM_COLORS; face++) {
    const group = groups[face * PER_COLOR + 4]!;
    if (naming[group] !== -1) return null;
    naming[group] = centres[face]!;
  }
  return groups.map((g) => naming[g]!);
}

/**
 * Is every sticker clearly closer to its own group than to any other? The grouping is always
 * produced — balanced k-means returns something for any input — so this is what distinguishes six
 * paints under one light from a photograph where the colours have run together.
 */
function wellSeparated(lab: StickerLab, groups: readonly number[], maxRatio: number): boolean {
  const ab = lab.map((row) => [row[1], row[2]] as [number, number]);
  const centres: [number, number][] = [];
  for (let c = 0; c < NUM_COLORS; c++) {
    const members = ab.filter((_, i) => groups[i] === c);
    if (members.length === 0) return false;
    centres.push([
      members.reduce((s, q) => s + q[0], 0) / members.length,
      members.reduce((s, q) => s + q[1], 0) / members.length,
    ]);
  }
  for (const [i, point] of ab.entries()) {
    const own = Math.sqrt(squared(point, centres[groups[i]!]!));
    let nearest = Number.POSITIVE_INFINITY;
    for (let c = 0; c < NUM_COLORS; c++) {
      if (c !== groups[i]) nearest = Math.min(nearest, Math.sqrt(squared(point, centres[c]!)));
    }
    // Stated as a NEGATED `<` so the degenerate cases fail closed. When a frame's stickers share
    // one a*b* -- a blown-out or monochrome capture -- every centroid coincides, own and nearest
    // are both zero, and `0 > 0` would have called that well separated and let balanced k-means
    // split 54 identical points into six invented paints. `!(0 < 0)` refuses it, and so does any
    // NaN, which is the same class of answer.
    if (!(own < maxRatio * nearest)) return false;
  }
  return true;
}

function squared(a: readonly [number, number], b: readonly [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function argmaxBy<T>(items: readonly T[], value: (item: T) => number): number {
  let best = 0;
  for (let i = 1; i < items.length; i++) if (value(items[i]!) > value(items[best]!)) best = i;
  return best;
}
