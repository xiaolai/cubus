// The pictures the app offers as targets — "趣味形态", the game beside the method.
//
// `dev-docs/solve-to-state-plan.md` §3b records the owner's decision that started this: **patterns
// are the game. From any state, solve to a picture.** §9.6 then held the door shut — "which patterns
// beyond the five stages" was left STILL OPEN so that patterns would be decided as their own feature
// rather than drifting in because the mechanism allowed them. `six-cross` sat at `offered: false` for
// a fortnight on exactly that rule. This file is that decision, taken: TWENTY, chosen below — five
// of them from 2026-09-26, the rest when the Shapes screen §9.6 asked for arrived (2026-10-04).
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
//             These earn their place by being SHORT FROM SOLVED rather than by being near — four
//             moves or six, by the cuts below. Three of the eighteen are famous enough for the
//             ledger to name (The Checkerboard, Lines, Plus/Minus); the rest are not named anywhere
//             and are described by what they draw, which is a decision rather than a shortage —
//             see THE NAMES ARE DESCRIPTIONS below.
//             (Written c·S⁻¹ here until 2026-09-27, which is the wrong order and does not name the
//             cube `lib/pattern-route.js` actually solves. An audit proved it rather than asserting
//             it: with c = S·R the correct order is one move from solved, and the order written here
//             was neither solved nor one move away. The argument about cost survives either way —
//             both are uniform when c is — which is exactly why the error could sit in a comment
//             next to correct code.)
//
// TWENTY, AND THE SCREEN §9.6 SAID WOULD BE NEEDED (owner, 2026-10-04). It was five until this
// change, and what the five were waiting for is exactly what arrived: "a grid you sort, filter or
// scroll has become the primary region, and 'only a new COMPOSITION is a new screen' makes that a
// screen of its own". That screen is `lib/screens/shapes.js`; the cube screen's menu is the RECENT
// five and a way through to it (`lib/shape-recency.js`). So the menu is still five pictures long and
// the catalogue is no longer five, which is the only reason this number could move at all.
//
// WHY EIGHTEEN STATE PATTERNS AND NOT SEVENTY-THREE. Two cuts, both measured, neither a tally.
//
//   EVERY FACE FIGURE IS CENTRED — its mask is unchanged by a half-turn of its own face. 51 of the
//   ledger's 73 rows pass, and they use exactly SIX masks between them: plain (511), an H (381), an
//   X (341), a plus (186), a bar (56), a dot (16). The 22 rows cut are the ones carrying an
//   edge-anchored figure (`### / ### / ...`, `#.# / ### / ...`, `.#. / .#. / ...` and five more),
//   and an off-centre figure does not read as a design at thumbnail size — it reads as a face
//   somebody stopped halfway through. That is also what makes every name below sayable: the six
//   masks that survive are the six a child can point at.
//
//   ONE PER FACE-SHAPE SIGNATURE — the multiset of the six masks, which is what a whole-cube
//   rotation permutes and so is the honest notion of "the same picture" in a grid. The 51 collapse
//   to 18. The earlier note here measured 34 over all 73 and that figure still stands; it is not
//   the offering, because 16 of those 34 hold an off-centre figure. The representative is the
//   SHORTEST row of its signature at three moves or more, and a row the ledger NAMES wins a tie —
//   which is the whole reason `lines` is still `U2 R2 D2 U2 R2 U2` and not the equally short
//   `U2 R2 D2 U2 R2 D2` beside it.
//
//   The "symmetry order >= 8" cut is still rejected, and for the reason it always was: those 14
//   rows carry only SIX signatures between them. Six of the 73 are two moves or fewer from solved
//   (`U`, `U2`, `D U`, `D U'`, `D U2`, `D2 U2`) — one face turn is not a picture — and the three
//   moves or more floor above is what keeps them out while keeping their signatures, which deeper
//   rows also reach.
//
// AND THE OPTION FOR THE REST IS STILL THE SHAPE OF THIS FILE, not a plugin point. Every record
// below is exactly what a ledger row already is, so offering more is appending rows and flipping a
// boolean — the same `offered` idiom `stage-targets.js` uses, and the reason `six-cross` could wait
// in the open without a branch. `test/patterns.test.mjs` pins each state pattern here against the
// generated ledger and RE-DERIVES both cuts from it, so widening the offering is editing one
// predicate and not arguing with prose.
//
// THE NAMES ARE DESCRIPTIONS, and that is a decision rather than a shortage. 70 of the ledger's 73
// rows have no name at all, and inventing folklore for fifteen of them would be inventing data; the
// two set patterns above already show the house style, which is to say what the picture IS ("a plus
// on every face"). So an unnamed row is named for its signature, in that style, and
// `patterns.test.mjs` derives every one of those names from the picture the row actually draws —
// a name here cannot come to describe a different cube. The three the ledger names keep its names.

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
  // ---- the rest of the eighteen, 2026-10-04 ------------------------------------------------------
  //
  // THE FIRST THREE STAY FIRST so the recent-five seed is the menu that shipped before this screen
  // existed: somebody who has chosen nothing yet opens the same menu they had. These are in order of
  // what they COST from a finished cube — the ledger's proved minimum, four moves then six — and
  // that number is deliberately NOT drawn anywhere. It is the distance from SOLVED, and the cube in
  // the child's hands is almost never solved, so showing it beside the picture would be a true
  // figure answering a question nobody asked. The route's own sentence says the real count once a
  // picture is chosen.
  { id: 'bar4-dot2', kind: 'state', alg: 'D U L2 R2', name: 'a bar on four faces and a dot on two', offered: true },
  { id: 'bar4-h2', kind: 'state', alg: 'U2 L2 R2 U2', name: 'a bar on four faces and an H on two', offered: true },
  { id: 'bar4-x2', kind: 'state', alg: 'D2 U2 L2 R2', name: 'a bar on four faces and an X on two', offered: true },
  { id: 'plain2-bar2-dot2', kind: 'state', alg: 'U2 L2 R2 D2', name: 'plain on two faces, a bar on two and a dot on two', offered: true },
  { id: 'bar6', kind: 'state', alg: "U R2 D2 U2 R2 U'", name: 'a bar on every face', offered: true },
  { id: 'dot4-bar2', kind: 'state', alg: 'D U R2 B2 F2 L2', name: 'a dot on four faces and a bar on two', offered: true },
  { id: 'dot4-h2', kind: 'state', alg: 'D U R2 B2 F2 R2', name: 'a dot on four faces and an H on two', offered: true },
  { id: 'dot4-plain2', kind: 'state', alg: "L2 R2 D U' B2 F2", name: 'a dot on four faces and plain on two', offered: true },
  { id: 'dot4-x2', kind: 'state', alg: 'U2 L2 R2 B2 F2 U2', name: 'a dot on four faces and an X on two', offered: true },
  { id: 'h2-bar2-dot2', kind: 'state', alg: 'U2 R2 B2 F2 R2 U2', name: 'an H on two faces, a bar on two and a dot on two', offered: true },
  { id: 'h2-plus2-bar2', kind: 'state', alg: "D U' L2 R2 D' U", name: 'an H on two faces, a plus on two and a bar on two', offered: true },
  { id: 'h4-x2', kind: 'state', alg: 'U2 L2 R2 B2 F2 D2', name: 'an H on four faces and an X on two', offered: true },
  { id: 'plain4-h2', kind: 'state', alg: 'U2 R2 D2 U2 L2 D2', name: 'plain on four faces and an H on two', offered: true },
  { id: 'x2-bar2-dot2', kind: 'state', alg: 'U2 R2 B2 F2 L2 U2', name: 'an X on two faces, a bar on two and a dot on two', offered: true },
  { id: 'x4-h2', kind: 'state', alg: 'U2 L2 R2 U2 B2 F2', name: 'an X on four faces and an H on two', offered: true },
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

/** What the screens draw. The list they read, exactly as `OFFERED_TARGETS` is for the row. */
export const OFFERED_PATTERNS = Object.freeze(PATTERNS.filter((p) => p.offered));

/**
 * The id a PRESS carries for this pattern — what goes in `data-stage` and into `state.stageTarget`.
 *
 * A set pattern is selected by its TARGET, because the exact engine already answers that id; a
 * state pattern is selected by itself. The ternary was written out at four call sites across the
 * menu and the recency store, which is four places for one rule about what a press means. Both the
 * grid and the menu tick by comparing this with `state.stageTarget`, so the two cannot disagree
 * about which picture is on.
 */
export const selectionOf = (pattern) => (pattern.target ? pattern.target.id : pattern.id);

/**
 * The offered pattern a selection id names, or null.
 *
 * Null rather than a throw, for `pictureDestination`'s reason: the id arrives from storage and from
 * a dataset, so "that is not one of the pictures" is an ordinary answer — a stage is on, or a
 * remembered choice names a row that is no longer offered.
 */
export function patternBySelection(id) {
  if (!id) return null;
  return OFFERED_PATTERNS.find((p) => selectionOf(p) === id) ?? null;
}

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
