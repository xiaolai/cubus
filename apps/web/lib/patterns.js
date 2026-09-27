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
//             S⁻¹·c to solved, and S⁻¹·c is uniform when c is, so it costs about what solving costs.
//             These earn their place by being FAMOUS and SHORT FROM SOLVED (six moves each), not by
//             being near.
//             (Written c·S⁻¹ here until 2026-09-27, which is the wrong order and does not name the
//             cube `lib/pattern-route.js` actually solves. An audit proved it rather than asserting
//             it: with c = S·R the correct order is one move from solved, and the order written here
//             was neither solved nor one move away. The argument about cost survives either way —
//             both are uniform when c is — which is exactly why the error could sit in a comment
//             next to correct code.)
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
import { TARGET_BY_ID, targetById } from './stage-targets.js';

/**
 * The pictures, in the order they are offered.
 *
 * `alg` is what is copied from the ledger. `look` is DERIVED from it below — a full facelet string in
 * the scan frame, which goes into `netSvg()` and `<cubus-cube facelets=…>` with no conversion, so a
 * state pattern needs no picture derivation the way a target does. Copying the ledger's own `look`
 * instead is the trap recorded beside the state patterns: it is a canonical rotation representative
 * and differs from what the algorithm produces on 68 of the ledger's 73 rows.
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
  // ---- state patterns: famous, and six moves from solved -----------------------------------------
  //
  // OFFERED AND ROUTED since 2026-09-26. A set pattern is already a stage target, so choosing one is
  // a `data-stage` press every existing router answers unchanged. A state pattern is one exact cube,
  // and the maneuver to it is whatever solves `compose(inverseOf(S), c)` — so it needs no new engine
  // either, only its own path: `lib/pattern-route.js` asks the pool through `solveWithinGodsNumber`
  // and replays the answer through cubejs, and `lib/walk-resolver.js` branches to it BEFORE starting
  // the whole-cube search, so a refused route fails the walk instead of quietly solving the cube.
  //
  // The rest of the ledger stays at `offered: false`, which is what this field is for.
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
  // `picture` IS the marker every reader keys on — `stage-picture.js` returns it instead of
  // deriving one, `walk-session.js` paints it without re-framing, `walk-resolver.js` takes the
  // picture route instead of the three-source race, and `walk-live-distance.js` asks nothing. A
  // boolean `kind` would have worked equally well for any one of them and worse for all of them
  // together: the thing they each need is the picture, so the field they test is the field they use.
  return Object.freeze({ ...spec, look, picture: look, target: null });
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

/**
 * The state patterns as DESTINATIONS, by id — target-shaped enough for the readers that take one.
 *
 * `state.stageTarget` holds an id and `stageTargetNow()` resolves it through `TARGET_BY_ID`, which
 * knows only stage targets: an id it does not know is reset to `solved`, so without this a state
 * pattern could not be selected at all (found by a Codex refute pass, 2026-09-26, which also found
 * that `holdForTarget` threw on one and `targetPicture` threw "projections is not iterable").
 *
 * SET patterns are absent on purpose. They are real targets already, so they resolve through
 * `TARGET_BY_ID` with their projections, their admissible tables and their independently written
 * `verify` — and shadowing them here would quietly demote them to a picture with no exact engine.
 */
export const DESTINATION_BY_ID = Object.freeze(
  Object.assign(Object.create(null),
    Object.fromEntries(PATTERNS.filter((p) => p.kind === 'state').map((p) => [p.id, p]))),
);

/**
 * `id` as a PICTURE destination — a state pattern, or a target only ever offered as one.
 *
 * `screens/cube.js` decides the composition before a walk session exists, so it cannot ask
 * `stageTargetNow()`. Both lookups, because a SET pattern is selected by its TARGET's id and carries
 * its marker there (`sideways`), while a state pattern is selected by its own.
 *
 * Null rather than a throw: the id arrives from storage and from a dataset, so "not one" is an
 * ordinary answer, which is also why `targetById` is not used.
 */
export function pictureDestination(id) {
  if (!id) return null;
  const picture = DESTINATION_BY_ID[id];
  if (picture) return picture;
  const target = TARGET_BY_ID[id];
  return target && target.sideways ? target : null;
}
