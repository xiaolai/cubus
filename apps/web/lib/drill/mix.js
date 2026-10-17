// Mixed practice: the order a session of several algorithms is practised in, weakest first.
//
// dev-docs/algorithm-drill-v2-plan.md §5, work item WI-13. Pure: no storage, no clock, no randomness of its
// own. It reads the practice record (`lib/drill/record.js`) as data and answers with a list of ids.
//
// BLOCKED PRACTICE NEEDS NO MODULE. One algorithm repeated is what the engine already does — a rep
// completes and the next arms at once from wherever the cube now is (`lib/drill/engine.js`, `next`) — so a
// blocked session is one engine and no order to compute. It is the DEFAULT (§5: blocked practice is what
// the evidence supports for beginners — the plan's research record); mixing is offered after it, and this
// module exists only for that.
//
// "WEAKEST" IS WHAT THE RECORD COMPUTES, AND NOTHING ELSE (`statsOf`). No score is invented and no two
// figures are weighted against each other, because any weighting would be a number nobody measured. The
// comparison is lexicographic, each step deciding only when the step before it ties:
//
//   1. unknown first   an algorithm with no JUDGED rep (none, or only reps with a lost turn) has nothing
//                      to say it is strong, so it comes before every algorithm with history — or after all
//                      of them when the caller asks (`unknownFirst: false`)
//   2. error rate      higher first: the share of judged reps that were not the algorithm alone
//   3. clean streak    shorter first: how many clean reps in a row the newest practice ends with
//   4. pace            slower first: the median ms per turn spanned over clean timed reps — the time made
//                      comparable across algorithms of different lengths by the algorithm's OWN turns, not
//                      by a guess. An algorithm with judged reps but no timed one (a cube with no clock, a
//                      one-turn algorithm) has no pace, which ranks with the unknowns: before every pace,
//                      or after every pace under `unknownFirst: false`
//   5. the seed        a tie on all four is broken by a hash of the seed, the round and the id
//
// THE SEED IS HASHED, NOT DRAWN. A tie is ordered by FNV-1a over `seed:round:id`, so the same seed and the
// same record give the same order on every run and every device, and the module needs no generator of its
// own (test/seeded-scrambles.test.mjs keeps the app to one seeded draw).
//
// NO ALGORITHM TWICE IN A ROW when there is more than one. Within a round every id appears once, so the
// only place a repeat can happen is where one round ends and the next begins; there the next round's first
// two are swapped. A single id is blocked practice, and repeats by definition.

import { statsOf } from './record.js';

/** 32-bit FNV-1a over a string's UTF-16 code units: a stable, seedable tie-break with no state. */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** `null` ordered as an unknown: before every number when unknowns come first, after every one otherwise. */
const unknownSide = (a, b, unknownFirst) => {
  if (a === null && b === null) return 0;
  if (a === null) return unknownFirst ? -1 : 1;
  if (b === null) return unknownFirst ? 1 : -1;
  return null;
};

/**
 * Negative when `a` is weaker than `b` (practised first), positive when stronger, zero on a tie — over the
 * figures `statsOf` derives, steps 1–4 of the header.
 *
 * @param {ReturnType<typeof statsOf>} a
 * @param {ReturnType<typeof statsOf>} b
 * @param {{ unknownFirst?: boolean }} [o]
 */
export function compareWeakness(a, b, { unknownFirst = true } = {}) {
  const known = unknownSide(a.judged ? 0 : null, b.judged ? 0 : null, unknownFirst);
  if (known) return known;
  if (!a.judged) return 0;                                   // both unknown: nothing else to compare
  if (a.errorRate !== b.errorRate) return b.errorRate - a.errorRate;
  if (a.streak !== b.streak) return a.streak - b.streak;
  const pace = unknownSide(a.pace, b.pace, unknownFirst);
  if (pace !== null) return pace;
  return b.pace - a.pace;
}

/**
 * The practice order for a mixed session: `rounds` passes over `ids`, each weakest first.
 *
 * @param {ReadonlyArray<string>} ids  the algorithms to mix, ledger row ids, no duplicates
 * @param {Map<string, ReadonlyArray<object>>} record  the practice record as `read()` returns it
 * @param {object} o
 * @param {number} o.seed  a 32-bit unsigned integer; the same seed and record give the same order
 * @param {number} [o.rounds]  passes over the list (default 1)
 * @param {boolean} [o.unknownFirst]  unpractised and untimed algorithms before the rest (default true)
 * @returns {string[]}
 */
export function mixOrder(ids, record, { seed, rounds = 1, unknownFirst = true } = {}) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) throw new Error('mix: ids are ledger ids');
  if (new Set(ids).size !== ids.length) throw new Error('mix: an id appears twice in the list to mix');
  if (!(record instanceof Map)) throw new Error('mix: the record is the Map the practice record reads');
  if (!(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)) throw new Error('mix: the seed is a 32-bit unsigned integer');
  if (!(Number.isInteger(rounds) && rounds >= 1)) throw new Error('mix: at least one round');
  if (typeof unknownFirst !== 'boolean') throw new Error('mix: unknownFirst is true or false');

  const stats = new Map(ids.map((id) => [id, statsOf(record.get(id) ?? [])]));
  const order = [];
  for (let round = 0; round < rounds; round++) {
    const tie = new Map(ids.map((id) => [id, fnv1a(`${seed}:${round}:${id}`)]));
    const ranked = [...ids].sort((a, b) => compareWeakness(stats.get(a), stats.get(b), { unknownFirst })
      || tie.get(a) - tie.get(b)
      || (a < b ? -1 : a > b ? 1 : 0));
    if (ranked.length > 1 && order.length && ranked[0] === order.at(-1)) [ranked[0], ranked[1]] = [ranked[1], ranked[0]];
    order.push(...ranked);
  }
  return order;
}
