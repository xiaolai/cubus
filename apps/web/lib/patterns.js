// The pictures the app offers as targets — "趣味形态", the game beside the method.
//
// `dev-docs/solve-to-state-plan.md` §3b records the owner's decision that started this: **patterns
// are the game. From any state, solve to a picture.** §9.6 then held the door shut — "which patterns
// beyond the five stages" was left STILL OPEN so that patterns would be decided as their own feature
// rather than drifting in because the mechanism allowed them. `six-cross` sat at `offered: false` for
// a fortnight on exactly that rule. This file is that decision, taken: FIVE, chosen below.
//
// TWO KINDS, because they are two different things arithmetically and two different games.
//
//   'set'   — a conjunction of projection goals, so it is MILLIONS of cubes. Already a target of the
//             exact engine (`lib/stage-targets.js`), already graded in the frozen oracle corpus.
//             Cheap from a scramble: measured 10.8 moves for the plus and 8.9 for the X, against
//             19.3 and 19.4 to solve those same cubes (plan §3b). Roughly half the work of solving,
//             which is what makes it a reward a beginner can actually reach.
//   'state' — ONE exact cube. Free of tables (§3a's first finding: a target that is one state needs
//             none of this), but NOT cheap from a scramble: reaching S from c is the distance from
//             c·S⁻¹ to solved, and c·S⁻¹ is uniform when c is, so it costs about what solving costs.
//             These earn their place by being FAMOUS and SHORT FROM SOLVED (six moves each), not by
//             being near.
//
// WHY FIVE AND NOT SEVENTY-FIVE. The ledger holds 73 state patterns and 2 set patterns, and the
// obvious cut — "symmetry order >= 8", the 14 most symmetric — was measured and rejected: those 14
// carry only SIX distinct face-shape signatures between them, so at least eight differ from a sibling
// only in which colour sits where, which in a grid of thumbnails reads as the same picture twice. Six
// of the 73 are two moves or fewer from solved (`U`, `U2`, `D U`, `D U'`, `D U2`, `D2 U2`) — one face
// turn is not a picture. And all 73 collapse into 34 distinct signatures, not 73. So the number here
// is small because the ledger says it should be, not because shipping more would be hard.
//
// AND THE OPTION FOR THE REST IS THE SHAPE OF THIS FILE, not a plugin point. Every record below is
// exactly what a ledger row already is, so offering more is appending rows and flipping a boolean —
// the same `offered` idiom `stage-targets.js` uses, and the reason `six-cross` could wait in the open
// without a branch. `test/patterns.test.mjs` pins each state pattern here against the generated
// ledger, so the copies cannot drift from the thing that proved them. What growing past about a dozen
// would need is NOT a longer menu: a grid you sort, filter or scroll has become the primary region,
// and "only a new COMPOSITION is a new screen" makes that a screen of its own, sibling to Lessons.
// That is a separate decision, and §9.6's rule applies to it exactly as it applied to these five.

import { SOLVED, applyAlg, toFacelets } from './cube-pieces.js';
import { targetById } from './stage-targets.js';

/**
 * The pictures, in the order they are offered.
 *
 * `look` is a full facelet string in the scan frame, straight from the ledger — it goes into
 * `netSvg()` and `<cubus-cube facelets=…>` with no conversion, which is why a state pattern needs no
 * picture derivation the way a target does.
 *
 * `target` names a `stage-targets.js` id, and is how a set pattern is answered: the exact engine
 * already routes to it. The picture comes from `targetPicture()`, which draws the free pieces grey.
 */
const PATTERN_SPECS = [
  // ---- set patterns: the game, because they are cheap from a scramble ---------------------------
  {
    id: 'plus-every-face', kind: 'set', target: 'six-cross',
    name: 'a plus on every face', offered: true,
  },
  {
    id: 'x-every-face', kind: 'set', target: 'x-every-face',
    name: 'an X on every face', offered: true,
  },
  // ---- state patterns: famous, and six moves from solved ----------------------------------------
  // The ALGORITHM is what is copied out of `test/fixtures/pattern-ledger.mjs`, and the picture is
  // computed from it below. That is not tidiness, it is a correctness fix the tests found:
  //
  // **The ledger's stored `look` is NOT what its `alg` produces, on 68 of its 73 rows.** The ledger
  // deduplicates over all 48 symmetries plus inversion (plan §3b), because a picture, its mirror and
  // its inverse are one pattern to anybody looking — so `look` is the CANONICAL REPRESENTATIVE of a
  // rotation class while `alg` reaches some other member of that class. Shipping the pair as though
  // they described one cube draws a target the route does not arrive at: the same picture, the cube
  // turned. Only five rows coincide, and The Checkerboard is one of them, so a spot check on the
  // first entry would have said everything was fine.
  //
  // Deriving the picture makes the drift unrepresentable rather than merely tested: there is one
  // fact here, and the cube drawn is by construction the cube routed to. Anyone offering the other
  // 70 inherits that for free.
  {
    id: 'checkerboard', kind: 'state',
    alg: 'D2 U2 L2 R2 B2 F2', name: 'The Checkerboard', offered: true,
  },
  {
    id: 'lines', kind: 'state',
    alg: 'U2 R2 D2 U2 R2 U2', name: 'Lines', offered: true,
  },
  {
    id: 'plus-minus', kind: 'state',
    alg: 'U2 L2 R2 U2 L2 R2', name: 'Plus/Minus', offered: true,
  },
];

/** A facelet string is 54 stickers of the six face letters, and nothing else may reach a renderer. */
const FACELETS = /^[UDLRFB]{54}$/;

function makePattern(spec) {
  if (spec.kind === 'set') {
    // Throws when the id is unknown, which is the point: a pattern naming a target that does not
    // exist must fail at load, not draw an empty menu entry at the moment a child presses it.
    const target = targetById(spec.target);
    return Object.freeze({ ...spec, target });
  }
  if (spec.kind !== 'state') throw new Error(`patterns: ${spec.id} has no kind "set" or "state"`);
  const look = toFacelets(applyAlg(SOLVED, spec.alg));
  if (!FACELETS.test(look)) throw new Error(`patterns: ${spec.id}'s algorithm does not give 54 facelets`);
  return Object.freeze({ ...spec, look, target: null });
}

/** Every picture this file knows, offered or not. */
export const PATTERNS = Object.freeze(PATTERN_SPECS.map(makePattern));

/** By id, null-prototype for the reason `TARGET_BY_ID` gives: ids arrive from a dataset. */
export const PATTERN_BY_ID = Object.freeze(
  Object.assign(Object.create(null), Object.fromEntries(PATTERNS.map((p) => [p.id, p]))),
);

/** `id` as a pattern, or a throw. A silently-undefined pattern is a button that does nothing. */
export function patternById(id) {
  const pattern = PATTERN_BY_ID[id];
  if (!pattern) throw new Error(`patterns: no pattern named "${id}"`);
  return pattern;
}

/** What the menu draws. The list the screens read, exactly as `OFFERED_TARGETS` is for the row. */
export const OFFERED_PATTERNS = Object.freeze(PATTERNS.filter((p) => p.offered));
