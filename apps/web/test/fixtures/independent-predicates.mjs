// Each stage target, written a SECOND time — from the app's own predicates, knowing nothing about
// projections or goal codes.
//
// THIS FILE IS NOW A POINTER, and the move is the point. The composition used to live here because
// it read as grading apparatus. It is not: plan §9a makes the runtime replay an unconditional
// SHIPPED guarantee, and a replay that asks the conjunction of projected goals is circular — a
// corrupted goal set produces a route that reaches the corrupted goal and the conjunction agrees.
// So the second definition has to be in the build, and it is, as `target.verify` in
// `lib/stage-targets.js`, with the rule that keeps it honest written beside it.
//
// Kept as a named import so the benches and tests that grade against "the app's own predicate" say
// so at the call site rather than reaching for a field.

import { TARGETS } from '../../lib/stage-targets.js';

/** Every target, by id, as the predicate a route is replayed against. */
export const INDEPENDENT_PREDICATE = Object.freeze(
  Object.fromEntries(TARGETS.map((t) => [t.id, t.verify])),
);
