// What an algorithm DOES, computed from the move tables and never written down beside it.
//
// dev-docs/algorithm-drills-plan.md item 2.2. Every word this module produces is arithmetic over
// `cube-pieces.js`, and that is what lets it live in this repository at all: ADR 0006 decision 7
// keeps authored prose out, and a description that is COMPUTED is a fact about a cube rather than
// content. A hand-written "Sune twists three corners" would be both.
//
// TEMPLATES OVER A SIGNATURE, never one label per algorithm. The catalogue's signatures are built from a
// handful of cycle shapes per piece kind, a few twist counts and a few flip counts — counted, not stated
// here, by `alg-catalogue.test.mjs`. So the words come from a small table of SHAPES, and a shape the table
// does not know THROWS and names the case. A vague fallback — "moves several pieces" — would turn a
// missing shape into a sentence nobody can check, which is the failure this whole module exists to
// avoid.
//
// THE LABEL IS EXHAUSTIVE, and it is declared rather than implied. Every quantity the signature
// measures appears in the words: the permutation cycles of both kinds, the corners twisted, the edges
// flipped. `alg-catalogue.test.mjs` reads those quantities back OUT OF THE SENTENCE and refuses a label
// that quietly drops a piece. A "selected fact" label would read exactly the same and be unfalsifiable.
//
// WHY "TWISTS n CORNERS" AND NOT "IN PLACE": `co[i] !== 0` says corner i is turned relative to its
// slot, which a corner that also MOVED can be. The obvious wording adds "in place" and is then false
// for every algorithm that permutes and orients at once, which is most of the catalogue. The count is
// what was measured, so the count is what is said.
import { CORNERS, EDGES, SOLVED, compose, movesOf, toFacelets } from './cube-pieces.js';
import { run } from './cube-moves.js';
import { t } from './i18n.js';

/** The hold whose letters are the cube's own — what an algorithm is read in when only its effect matters. */
const IDENTITY_HOLD = Object.freeze(['U', 'F']);

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

/** How many repetitions bring the cube back. Bounded loudly: the largest in the catalogue is 72, and the
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
  // THROUGH THE INTERPRETER, so a slice, a wide move and a whole-cube turn are read as what they do to
  // the pieces relative to the centres. The letters are read in their own frame: any hold would do,
  // because the four quantities below are frame-free, so the identity hold is the honest one.
  const after = run(alg, IDENTITY_HOLD, SOLVED);
  // AN ALGORITHM THAT LEAVES THE CUBE TURNED HAS NO ORDER AS A PIECE EFFECT. Its letters name
  // positions, so a second repetition is read in a different hold and is not the same permutation
  // again — `compose` below would compute the order of something nobody performs. Refused by name;
  // the human-speed table closes every rotation it opens for exactly this reason.
  if (after.hold[0] !== IDENTITY_HOLD[0] || after.hold[1] !== IDENTITY_HOLD[1]) {
    throw new Error(`alg-effect: "${alg}" leaves the cube held ${after.hold.join(' ')}, so it has no order`);
  }
  const { state } = after;
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
 * These shapes cover the whole catalogue — measured, not assumed: an algorithm with a shape missing here
 * throws when the catalogue loads. `%1` is the piece kind, so the same shapes serve corners and edges and
 * there is no second table to drift from this one.
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

/**
 * The same shapes, said as what is WRONG with a case rather than what an algorithm does to a solved
 * cube.
 *
 * A case is the algorithm undone, so its permutation is the inverse — and an inverse has the same
 * cycle type and the same orientation counts. The numbers are therefore identical and only the
 * sentence changes: "cycles three corners" is what the algorithm DOES, "three corners are in the
 * wrong places" is what the learner is LOOKING AT. Keyed off the same shapes as `CYCLE_SHAPES` and
 * held to them by a test, so a shape can never be added to one table and forgotten in the other.
 */
export const CASE_SHAPES = Object.freeze({
  '2': (kind) => t('two %1 are swapped', kind),
  '3': (kind) => t('three %1 are in the wrong places', kind),
  '4': (kind) => t('four %1 are in the wrong places', kind),
  '5': (kind) => t('five %1 are in the wrong places', kind),
  '2,2': (kind) => t('two pairs of %1 are swapped', kind),
  '3,2': (kind) => t('three %1 are in the wrong places and two more are swapped', kind),
  '3,3': (kind) => t('two separate sets of three %1 are in the wrong places', kind),
});

/** English list joining, kept in one place so a two-clause and a three-clause label read the same. */
const joinClauses = (parts) => {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(t(', '))}${t(' and ')}${parts[parts.length - 1]}`;
};

/**
 * The clauses one effect is said in, by one VOICE — a table of cycle shapes, the twist and flip sentences,
 * and the refusals. ONE walk over the effect for both sentences a learner reads, so what an algorithm DOES
 * and what is wrong with its CASE cannot come to count the pieces differently.
 *
 * Throws by NAME on a shape the voice's table does not hold, so a new algorithm with an unmet shape fails
 * loudly, and on an effect with nothing to say, because a label that says nothing is not a label.
 */
function clausesIn(voice, effect, alg) {
  const clauses = [];
  for (const kind of ['corners', 'edges']) {
    const lengths = effect[kind];
    if (lengths.length === 0) continue;
    const key = lengths.join(',');
    const shape = voice.shapes[key];
    if (!shape) throw new Error(`alg-effect: no ${voice.what} for ${kind} cycle shape [${key}] (${alg})`);
    clauses.push(shape(KIND_WORD[kind]()));
  }
  if (effect.twisted) clauses.push(voice.twisted(word(effect.twisted)));
  if (effect.flipped) clauses.push(voice.flipped(word(effect.flipped)));
  if (clauses.length === 0) throw new Error(`alg-effect: "${alg}" ${voice.empty}`);
  return joinClauses(clauses);
}

/** What an algorithm DOES to a solved cube. */
const DOES = Object.freeze({
  what: 'phrase',
  shapes: CYCLE_SHAPES,
  twisted: (n) => t('twists %1 corners', n),
  flipped: (n) => t('flips %1 edges', n),
  // Cannot happen for a real algorithm — a sequence that moves nothing is the identity, and no entry in the
  // catalogue is one (every setup is checked non-solved). A guard rather than a branch, so a future table
  // of patterns cannot quietly produce a label that says nothing.
  empty: 'disturbs nothing, so it has no effect to describe',
});

/** What is WRONG with the case an algorithm answers. */
const LOOKS = Object.freeze({
  what: 'case phrase',
  shapes: CASE_SHAPES,
  twisted: (n) => t('%1 corners are turned the wrong way', n),
  flipped: (n) => t('%1 edges are flipped', n),
  empty: 'answers a case with nothing out of place',
});

/**
 * What an algorithm does, in words.
 *
 * Exhaustiveness is checked by decoding the SENTENCE back into an effect (`alg-catalogue.test.mjs`). It
 * was once checked against a `parts` copy of the numbers the sentence was built from — which was
 * CIRCULAR, agreeing with itself for every algorithm — and `parts` is gone with it.
 */
export const describeEffect = (effect, alg = '') => Object.freeze({ label: clausesIn(DOES, effect, alg) });

/**
 * What is out of place in the CASE this algorithm answers, in words.
 *
 * Same numbers as `describeEffect`, different sentence — see `CASE_SHAPES`. This is what a generated
 * case gets instead of a name: `oll:02220000` is our key for a position and means nothing to a
 * learner, but "three corners are turned the wrong way" is the thing they are looking at.
 */
export const describeCase = (effect, alg = '') => clausesIn(LOOKS, effect, alg);
