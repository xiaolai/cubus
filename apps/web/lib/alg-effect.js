// What an algorithm DOES, computed from the move tables and never written down beside it.
//
// dev-docs/algorithm-drills-plan.md item 2.2. Every word this module produces is arithmetic over
// `cube-pieces.js`, and that is what lets it live in this repository at all: ADR 0006 decision 7
// keeps authored prose out, and a description that is COMPUTED is a fact about a cube rather than
// content. A hand-written "Sune twists three corners" would be both.
//
// TEMPLATES OVER A SIGNATURE, never one label per algorithm. Measured over the 137 algorithms this
// repository holds: 62 distinct signatures, built from eight cycle shapes per piece kind, five twist
// counts and three flip counts. So the words come from a small table of SHAPES, and a shape the table
// does not know THROWS and names the case. A vague fallback — "moves several pieces" — would turn a
// missing shape into a sentence nobody can check, which is the failure this whole module exists to
// avoid.
//
// THE LABEL IS EXHAUSTIVE, and it is declared rather than implied. Every quantity the signature
// measures appears in the words: the permutation cycles of both kinds, the corners twisted, the edges
// flipped. `describeEffect` returns `parts` — the numbers the label was built from — so a test can
// reproduce the signature from them and refuse a label that quietly drops a piece. A "selected fact"
// label would read exactly the same and be unfalsifiable.
//
// WHY "TWISTS n CORNERS" AND NOT "IN PLACE": `co[i] !== 0` says corner i is turned relative to its
// slot, which a corner that also MOVED can be. The obvious wording adds "in place" and is then false
// for every algorithm that permutes and orients at once — 52 of the 137. The count is what was
// measured, so the count is what is said.
import { CORNERS, EDGES, SOLVED, applyAlg, compose, movesOf, toFacelets } from './cube-pieces.js';
import { t } from './i18n.js';

/** The solved arrangement, once — `order` compares against it on every repetition. */
const SOLVED_FACELETS = toFacelets(SOLVED);

/**
 * The cycle LENGTHS of a permutation, longest first, fixed points dropped.
 *
 * Lengths rather than the cycles themselves: the pieces a cycle contains are named for a frame
 * (ADR 0003), and a label that named positions would be a method-frame claim shown to a child
 * holding the cube some other way. A length is frame-free.
 */
export function cycleLengths(perm) {
  const seen = new Array(perm.length).fill(false);
  const out = [];
  for (let i = 0; i < perm.length; i += 1) {
    if (seen[i] || perm[i] === i) continue;
    let j = i;
    let n = 0;
    while (!seen[j]) { seen[j] = true; n += 1; j = perm[j]; }
    out.push(n);
  }
  return out.sort((a, b) => b - a);
}

/** How many repetitions bring the cube back. Bounded loudly: the largest over the 137 is 72, and the
 *  largest any single cube move sequence can have is 1260, so a run past that is a broken state
 *  rather than a slow answer. */
export const ORDER_CEILING = 1260;

/**
 * Everything measurable about one algorithm's effect.
 *
 * `order` is here because it is the one fact a child can check with their own hands — do it that many
 * times and the cube is back where it started — and because a drill repeated from a fixed state walks
 * a closed orbit of exactly this length (plan decision D6).
 */
export function effectOf(alg) {
  const state = applyAlg(SOLVED, alg);
  const corners = cycleLengths(state.cp);
  const edges = cycleLengths(state.ep);
  const twisted = state.co.filter((v) => v !== 0).length;
  const flipped = state.eo.filter((v) => v !== 0).length;
  const movedCorners = CORNERS.filter((_, i) => state.cp[i] !== i || state.co[i] !== 0).length;
  const movedEdges = EDGES.filter((_, i) => state.ep[i] !== i || state.eo[i] !== 0).length;

  let cur = state;
  let order = 1;
  while (toFacelets(cur) !== SOLVED_FACELETS) {
    cur = compose(cur, state);
    order += 1;
    if (order > ORDER_CEILING) throw new Error(`alg-effect: "${alg}" did not return in ${ORDER_CEILING} repetitions`);
  }

  return Object.freeze({
    moves: movesOf(alg).length,
    pieces: movedCorners + movedEdges,
    corners: Object.freeze(corners),
    edges: Object.freeze(edges),
    twisted,
    flipped,
    order,
  });
}

/** The signature a label is built from: the four quantities and nothing else. Its shape is the
 *  grouping key the templates are indexed by, and the test enumerates it over the whole catalogue. */
export const signatureOf = (effect) =>
  `c[${effect.corners.join(',')}] e[${effect.edges.join(',')}] t${effect.twisted} f${effect.flipped}`;

/** Number words, because the reader is eight and "cycles three corners" reads where "cycles 3" does
 *  not. Bounded by the cube: eight corners, twelve edges, and no cycle longer than five occurs. */
const NUMBER_WORD = Object.freeze({
  2: () => t('two'), 3: () => t('three'), 4: () => t('four'), 5: () => t('five'),
  6: () => t('six'), 7: () => t('seven'), 8: () => t('eight'),
});
const word = (n) => (NUMBER_WORD[n] ? NUMBER_WORD[n]() : String(n));

/**
 * One phrase per cycle SHAPE, keyed by the lengths joined.
 *
 * Eight shapes cover all 137 — measured, not assumed. `%1` is the piece kind, so the same eight
 * shapes serve corners and edges and there is no second table to drift from this one.
 */
export const CYCLE_SHAPES = Object.freeze({
  '2': (kind) => t('swaps two %1', kind),
  '3': (kind) => t('cycles three %1', kind),
  '4': (kind) => t('cycles four %1', kind),
  '5': (kind) => t('cycles five %1', kind),
  '2,2': (kind) => t('swaps two pairs of %1', kind),
  '3,2': (kind) => t('cycles three %1 and swaps two more', kind),
  '3,3': (kind) => t('cycles two separate sets of three %1', kind),
});

const KIND_WORD = Object.freeze({ corners: () => t('corners'), edges: () => t('edges') });

/** The phrase for one kind's cycles, or null when that kind is not permuted at all. Throws by NAME on
 *  a shape the table does not hold, so a new algorithm with an unmet shape fails loudly. */
function cyclePhrase(lengths, kind, alg) {
  if (lengths.length === 0) return null;
  const key = lengths.join(',');
  const shape = CYCLE_SHAPES[key];
  if (!shape) throw new Error(`alg-effect: no phrase for ${kind} cycle shape [${key}] (${alg})`);
  return shape(KIND_WORD[kind]());
}

/** English list joining, kept in one place so a two-clause and a three-clause label read the same. */
const joinClauses = (parts) => {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(t(', '))}${t(' and ')}${parts[parts.length - 1]}`;
};

/**
 * What an algorithm does, in words, plus the numbers those words were built from.
 *
 * `parts` exists so exhaustiveness is checkable rather than asserted: `signatureFromParts` rebuilds
 * the signature out of it, and the test demands the two agree for all 137.
 */
export function describeEffect(effect, alg = '') {
  const clauses = [];
  const permuted = [];
  for (const kind of ['corners', 'edges']) {
    const phrase = cyclePhrase(effect[kind], kind, alg);
    if (phrase) { clauses.push(phrase); permuted.push(...effect[kind]); }
  }
  if (effect.twisted) clauses.push(t('twists %1 corners', word(effect.twisted)));
  if (effect.flipped) clauses.push(t('flips %1 edges', word(effect.flipped)));
  // Cannot happen for a real algorithm — a sequence that moves nothing is the identity, and no entry
  // in the catalogue is one (every setup is checked non-solved). A guard rather than a branch, so a
  // future table of patterns cannot quietly produce a label that says nothing.
  if (clauses.length === 0) throw new Error(`alg-effect: "${alg}" disturbs nothing, so it has no effect to describe`);
  return Object.freeze({
    label: joinClauses(clauses),
    parts: Object.freeze({
      corners: effect.corners, edges: effect.edges, twisted: effect.twisted, flipped: effect.flipped,
    }),
  });
}

/** The signature rebuilt from a label's own numbers — the exhaustiveness check's other half. */
export const signatureFromParts = (parts) =>
  `c[${parts.corners.join(',')}] e[${parts.edges.join(',')}] t${parts.twisted} f${parts.flipped}`;
