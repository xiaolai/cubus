// The named states a cube can be sent back to, as data: which pieces each one constrains, and
// nothing about how far away it is.
//
// Phase A of dev-docs/solve-to-state-plan.md. Pure — no distance tables, no search, no DOM — so
// that the definition of "the top cross" can be read, tested and argued about without building a
// megabyte of tables first. The distance module builds its tables from these descriptors and
// searches with them.
//
// THE ONE IDEA WORTH READING BEFORE THE CODE (plan §3a's second finding). **A target is a
// conjunction of projection goals, and its predicate is that conjunction.** Not a hand-written
// predicate that a projection is later claimed to model — the projections ARE the definition. That
// makes the plan's hardest correctness obligation (§2 Claim C, "the target is exactly the preimage
// of the projected goal") true by construction rather than by a test: a target cannot acquire a
// clause its projections cannot see, because a clause IS a projection.
//
// What still has to be checked, and is, in `test/stage-targets.test.mjs`: that the conjunction
// agrees with the app's own independently written predicates in `methods/engine.js`. That is a
// cross-check between two definitions, which is a different and more useful thing than a proof
// about one.
//
// THE RULE THAT DECIDED THE U-CORNER PROJECTION, and it generalises: **never track an attribute the
// target does not constrain.** `corners-home` asks only that each top corner be in its own slot.
// Tracking the twist as well expresses the same target and yields the identical heuristic — the
// distance to "own slot, any twist" in the finer projection IS the distance to "own slot" in the
// coarser one, because the goal admits whatever twist the path produces. What it changes is the
// goal SET: one code becomes 81, and an oracle that breadth-first searches backwards from a goal
// set pays for every member. Measured during the spike: the radius-5 ball around those 81 tuples
// exceeded JavaScript's 16,777,216-entry Map limit and crashed; the slot-only ball is 621,067
// states and builds in 1.4 s.
//
// Convention, as everywhere else in this app: the cross goes on D, and a target is measured in the
// METHOD frame — the scan frame tumbled so white is on D, which the app turns every cube into before
// it asks (lib/solving-hold.js, ADR 0003). So "the cross" here is the WHITE cross. Slot index equals
// cubie index, so `EDGE.DF` is both "the DF slot" and "the cubie that belongs there".

import { CORNER, EDGE, MOVES, MOVE_NAMES } from './cube-pieces.js';
import * as eng from './methods/engine.js';
import { FIRST_BLOCK, SECOND_BLOCK, bothBlocksBuilt, firstBlockBuilt } from './methods/roux-blocks.js';

// ---- the cell tables: how one tracked piece moves ----------------------------------------------
//
// Derived from `cube-pieces.js`'s own move tables and never typed, the way
// crates/optimal-solver/src/f2l.rs derives its `Step`. A transcription error here would produce
// well-formed algorithms that simply do not solve, which is the silent failure this repository
// keeps writing derivation tests against; `test/stage-targets.test.mjs`'s first case is that test.

/** `perm[i] = j` inverted to `out[j] = i`. */
function inverse(perm, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[perm[i]] = i;
  return out;
}

/** An edge cell is `slot * 2 + flip`, so 24 of them. */
const EDGE_STEP = MOVE_NAMES.map((m) => {
  const to = inverse(MOVES[m].ep, 12);
  const t = new Uint8Array(24);
  for (let s = 0; s < 12; s++) {
    for (let f = 0; f < 2; f++) t[s * 2 + f] = to[s] * 2 + ((f + MOVES[m].eo[to[s]]) % 2);
  }
  return t;
});

/** A corner cell is `slot * 3 + twist`, so 24 of them too — which is why one packing serves both. */
const CORNER_STEP = MOVE_NAMES.map((m) => {
  const to = inverse(MOVES[m].cp, 8);
  const t = new Uint8Array(24);
  for (let s = 0; s < 8; s++) {
    for (let w = 0; w < 3; w++) t[s * 3 + w] = to[s] * 3 + ((w + MOVES[m].co[to[s]]) % 3);
  }
  return t;
});

/** A corner SLOT cell is the slot alone: eight of them, the twist deliberately not tracked. */
const CORNER_SLOT_STEP = MOVE_NAMES.map((m) => {
  const to = inverse(MOVES[m].cp, 8);
  const t = new Uint8Array(8);
  for (let s = 0; s < 8; s++) t[s] = to[s];
  return t;
});

const STEP_BY_KIND = { edge: EDGE_STEP, corner: CORNER_STEP, cornerSlot: CORNER_SLOT_STEP };
/** How much room a cell's orientation takes. 1 means "not tracked", and must not be ADDED. */
const SPAN_BY_KIND = { edge: 2, corner: 3, cornerSlot: 1 };

// ---- packing cells into one integer --------------------------------------------------------------

/** Cells per tracked piece. 24 covers an edge (12 slots x 2 flips) and a corner (8 x 3 twists). */
export const CELLS = 24;
/** How many codes a four-piece projection has — the stages' width. Roux's blocks track three edges and two
 *  corners (24^3 and 24^2): a block is not four of anything, and padding one with a fourth piece would make
 *  the target ask for a piece the block does not contain. */
export const PACKED_CODES = CELLS ** 4; // 331,776

const pack = (cells) => cells.reduce((code, cell) => code * CELLS + cell, 0);

function unpack(code, out) {
  let r = code;
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = r % CELLS;
    r = (r - out[i]) / CELLS;
  }
  return out;
}

// ---- a projection ------------------------------------------------------------------------------

/**
 * One to four tracked cubies of one kind, a per-move cell table, and a goal SET.
 *
 * The goal being a set rather than a point is what lets one projection shape serve both "these
 * corners solved" and "these corners in their own slots, any twist".
 *
 * A projection carries NO distance table. Building one is a few hundred milliseconds and a third of
 * a megabyte, and this module is imported by anything that merely wants to ask which pieces a stage
 * is about — the Restore screen's chip labels, a test, a bench. The distance module is where that
 * cost lives, and it is behind a worker.
 */
function packedProjection({ id, kind, cubies, goals }) {
  const step = STEP_BY_KIND[kind];
  const span = SPAN_BY_KIND[kind];
  if (!step) throw new Error(`stage-targets: unknown projection kind "${kind}"`);
  if (cubies.length < 1 || cubies.length > 4) throw new Error(`${id}: a packed projection tracks one to four cubies`);
  const n = cubies.length;
  const scratch = new Array(n);
  const moved = new Array(n);

  const codeOf = (state) => {
    const where = kind === 'edge' ? state.ep : state.cp;
    const turn = kind === 'edge' ? state.eo : state.co;
    // span 1 means the orientation is not tracked, so it must not be ADDED either: `slot * 1 +
    // twist` would silently fold a twist into the next slot's cell and the projection would stop
    // stepping with the cube. Caught by the projection-steps case, which is the assertion every
    // other claim in this feature rests on.
    const cell = (cubie) => {
      const slot = where.indexOf(cubie);
      return span === 1 ? slot : slot * span + turn[slot];
    };
    return pack(cubies.map(cell));
  };

  const stepCode = (code, m) => {
    const a = unpack(code, scratch);
    const s = step[m];
    for (let i = 0; i < n; i++) moved[i] = s[a[i]];
    return pack(moved);
  };

  /**
   * Every one-move successor of `code`, written into `out[0..17]`.
   *
   * ONE DECODE FOR EIGHTEEN MOVES, and it exists because of a measurement. A breadth-first build
   * that calls `stepCode` per move unpacks the same four cells eighteen times over, and the
   * difference is threefold on the table build — the whole of it in an inner loop that had no
   * reason to run.
   *
   * The SEARCH still uses `stepCode`, and correctly: it steps one chosen move at a time, so it
   * decodes once per node either way and has nothing to amortise.
   */
  const expand = (code, out) => {
    const a = unpack(code, scratch);
    for (let m = 0; m < MOVE_NAMES.length; m++) {
      const s = step[m];
      let c = 0;
      for (let i = 0; i < n; i++) c = c * CELLS + s[a[i]];
      out[m] = c;
    }
    return out;
  };

  // ENUMERABLE AND UNTAMPERABLE, both, and the pair is deliberate. An oracle has to walk the goal
  // set backwards, so it needs the codes; nothing may be able to ADD one, because a projection is
  // shared between up to five targets and a stray `goalCodes.add(…)` would make every one of them
  // answer a different question, instantly, silently and self-consistently. A frozen Set is not
  // that guard — `Object.freeze` does not stop `.add` — so the Set is private and only a reader
  // escapes.
  const goalSet = new Set(goals.map((cells) => {
    if (cells.length !== n) throw new Error(`${id}: a goal names ${cells.length} cells for ${n} cubies`);
    return pack(cells);
  }));
  return Object.freeze({
    id,
    kind,
    cubies: Object.freeze([...cubies]),
    codeSpace: CELLS ** n,
    codeOf,
    stepCode,
    expand,
    goals: Object.freeze([...goalSet]),
    isGoal: (code) => goalSet.has(code),
  });
}

/**
 * All twelve edge flips at once, which is the only way flips can be tracked at all.
 *
 * A move's effect on a slot's flip depends on which slot fed it, so the flips of four CHOSEN edges
 * are not closed under the move set — `top-cross` cannot have a four-edge flip projection however
 * much it would like one. All twelve are closed, and that coordinate is exactly two-phase's `FLIP`.
 *
 * Under the cumulative precondition that the bottom eight edges are home, "the U edges are oriented"
 * and "the flip coordinate is zero" are the same statement. **That equivalence holds only under the
 * precondition**, which is why `test/stage-targets.test.mjs` asserts it in both directions rather
 * than leaving it as this comment.
 */
function flipProjection() {
  const EP = MOVE_NAMES.map((m) => MOVES[m].ep);
  const EO = MOVE_NAMES.map((m) => MOVES[m].eo);
  const codeOf = (s) => {
    let c = 0;
    for (let i = 0; i < 12; i++) c |= s.eo[i] << i;
    return c;
  };
  const stepCode = (code, m) => {
    const ep = EP[m];
    const eo = EO[m];
    let nc = 0;
    for (let i = 0; i < 12; i++) nc |= (((code >> ep[i]) & 1) ^ eo[i]) << i;
    return nc;
  };
  /** The same eighteen-at-once shape the packed projections have — see `expand` there. */
  const expand = (code, out) => {
    for (let m = 0; m < MOVE_NAMES.length; m++) out[m] = stepCode(code, m);
    return out;
  };
  return Object.freeze({
    id: 'flip',
    kind: 'flip',
    cubies: Object.freeze([...Array(12).keys()]),
    codeSpace: 4096,
    codeOf,
    stepCode,
    expand,
    goals: Object.freeze([0]),
    isGoal: (code) => code === 0,
  });
}

/**
 * All eight corner twists at once — `flip`'s twin for corners, and closed under the move set for the same
 * reason: a move's effect on a slot's twist depends on which slot fed it, so only the whole set steps.
 *
 * Packed as eight base-3 digits, so 6,561 codes of which 2,187 are reachable (the eighth twist follows
 * from the other seven). The unreachable third is never entered by a breadth-first build from the goal,
 * which is cheaper to carry than a seven-digit decode that recomputes the eighth.
 *
 * Under the precondition that the four bottom corners are home, "the top corners are oriented" and "the
 * twist code is zero" are the same statement — and, as for `flip`, ONLY under it. `top-oriented` is the
 * one target that reads this, and it pins the bottom corners through `dCorners`.
 */
function twistProjection() {
  const CP = MOVE_NAMES.map((m) => MOVES[m].cp);
  const CO = MOVE_NAMES.map((m) => MOVES[m].co);
  const POW = [1, 3, 9, 27, 81, 243, 729, 2187];
  const digit = (code, i) => Math.floor(code / POW[i]) % 3;
  const codeOf = (s) => {
    let c = 0;
    for (let i = 0; i < 8; i++) c += s.co[i] * POW[i];
    return c;
  };
  // A cube after move m has, in slot i, the corner that was in slot cp[i], turned by co[i] more —
  // the same composition `cube-pieces.js` applies to whole states.
  const stepCode = (code, m) => {
    const cp = CP[m];
    const co = CO[m];
    let nc = 0;
    for (let i = 0; i < 8; i++) nc += ((digit(code, cp[i]) + co[i]) % 3) * POW[i];
    return nc;
  };
  const expand = (code, out) => {
    for (let m = 0; m < MOVE_NAMES.length; m++) out[m] = stepCode(code, m);
    return out;
  };
  return Object.freeze({
    id: 'twist',
    kind: 'twist',
    cubies: Object.freeze([...Array(8).keys()]),
    codeSpace: 6561,
    codeOf,
    stepCode,
    expand,
    goals: Object.freeze([0]),
    isGoal: (code) => code === 0,
  });
}

// ---- the seven projections ----------------------------------------------------------------------

/** The four cross edges, in the order the beginner method places them. */
const CROSS_EDGES = [EDGE.DR, EDGE.DF, EDGE.DL, EDGE.DB];
/** The four middle-layer edges. */
const MIDDLE_EDGES = [EDGE.FR, EDGE.FL, EDGE.BL, EDGE.BR];
/** The four top edges. */
const TOP_EDGES = [EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB];
/** The four first-layer corners. */
const D_CORNERS = [CORNER.DFR, CORNER.DLF, CORNER.DBL, CORNER.DRB];
// Both of Roux's blocks are six edges and the four D corners. Three edges a side and two corners a side was the
// first try, and too weak to search: a ten-move case cost about twenty million nodes. Four edges each — a block's
// three and the other block's bottom edge — with the D corners whole (the same table the first layer uses).
const BLOCK_EDGES_L = [...FIRST_BLOCK.edges, EDGE.DR];
const BLOCK_EDGES_R = [...SECOND_BLOCK.edges, EDGE.DL];
/** The four last-layer corners. */
const U_CORNERS = [CORNER.URF, CORNER.UFL, CORNER.ULB, CORNER.UBR];

/** Every tracked piece home and correctly turned: cells are `slot * span + 0`. */
const homeGoal = (kind, cubies) => [cubies.map((c) => c * SPAN_BY_KIND[kind])];
/** Each tracked corner in its own slot, twist not tracked: one goal code. See CORNER_SLOT_STEP. */
const ownSlotGoal = (cubies) => [cubies.slice()];

/**
 * The projections, by id.
 *
 * Seven, and the seventh is why `solved` is a target of this mechanism at all. Plan §0 excluded it
 * through three drafts because the six stage projections cannot express it — a cube that is solved
 * except for two twisted U corners is IDENTICAL to solved in every one of them, so a distance read
 * off them would be zero for an unsolved cube. `uCorners` tracks slot AND twist, which makes all
 * twenty pieces tracked and `solved` a conjunction like every other target. The stage projections
 * are still blind to a U-corner twist, and `test/stage-targets.test.mjs` asserts that too, because
 * it is the reason a stage table may never be asked for a distance to solved.
 */
export const PROJECTIONS = Object.freeze({
  crossEdges: packedProjection({ id: 'crossEdges', kind: 'edge', cubies: CROSS_EDGES, goals: homeGoal('edge', CROSS_EDGES) }),
  midEdges: packedProjection({ id: 'midEdges', kind: 'edge', cubies: MIDDLE_EDGES, goals: homeGoal('edge', MIDDLE_EDGES) }),
  topEdges: packedProjection({ id: 'topEdges', kind: 'edge', cubies: TOP_EDGES, goals: homeGoal('edge', TOP_EDGES) }),
  dCorners: packedProjection({ id: 'dCorners', kind: 'corner', cubies: D_CORNERS, goals: homeGoal('corner', D_CORNERS) }),
  uCorners: packedProjection({ id: 'uCorners', kind: 'corner', cubies: U_CORNERS, goals: homeGoal('corner', U_CORNERS) }),
  uCornerSlots: packedProjection({ id: 'uCornerSlots', kind: 'cornerSlot', cubies: U_CORNERS, goals: ownSlotGoal(U_CORNERS) }),
  flip: flipProjection(),
  twist: twistProjection(),
  // Roux's blocks (lib/methods/roux-blocks.js): three edges and two corners each, so two projections a block.
  fbEdges: packedProjection({ id: 'fbEdges', kind: 'edge', cubies: FIRST_BLOCK.edges, goals: homeGoal('edge', FIRST_BLOCK.edges) }),
  fbCorners: packedProjection({ id: 'fbCorners', kind: 'corner', cubies: FIRST_BLOCK.corners, goals: homeGoal('corner', FIRST_BLOCK.corners) }),
  blockEdgesL: packedProjection({ id: 'blockEdgesL', kind: 'edge', cubies: BLOCK_EDGES_L, goals: homeGoal('edge', BLOCK_EDGES_L) }),
  blockEdgesR: packedProjection({ id: 'blockEdgesR', kind: 'edge', cubies: BLOCK_EDGES_R, goals: homeGoal('edge', BLOCK_EDGES_R) }),
});

// ---- the targets ---------------------------------------------------------------------------------

/**
 * The named states, each a conjunction of projected goals.
 *
 * `parts` is the definition. `predicate` is derived from it below and is not a second statement of
 * the same thing — writing one by hand is how a target acquires a clause its projections cannot see.
 *
 * `offered` is whether the app puts a chip on the Restore screen for it. The six stages and
 * `solved` are offered (plan §6's six chips, and `top-edges` since ADR 0009). `six-cross` is not: it is a PATTERN rather than a
 * stage, plan §9.6 says patterns are a separate product decision and must not drift in because the
 * mechanism allows them, and it stays here because it is in the frozen oracle corpus and grades the
 * engine on a target whose free pieces are a different shape from every stage's.
 */
/**
 * The SECOND definition of every target, and it is a shipped guarantee rather than a test fixture.
 *
 * WHY IT SHIPS. Plan §9a puts an unconditional runtime check on the one failure that would hurt a
 * child: every route is replayed against the cube that was read and must reach the target, or
 * nothing is shown. That check is worth exactly as much as the predicate it asks. Asking
 * `predicate` — the conjunction of projected goals — would make the replay CIRCULAR: a corrupted
 * goal set produces a route that reaches the corrupted goal, and the conjunction agrees, instantly
 * and confidently. `test/solve-to-state.test.mjs` demonstrates that on purpose, and it is the whole
 * argument for this constant existing outside `test/`.
 *
 * WHY IT IS INDEPENDENT even though it sits beside the thing it checks. Independence is a property
 * of AUTHORSHIP, not of file paths. These are `methods/engine.js`'s predicates, written for the
 * method solver long before this feature existed; they read `cp`, `co`, `ep` and `eo` directly and
 * know nothing about projections, goal codes or packing. A wrong projection, a wrong goal set, a
 * wrong packing and a corrupted table are all visible to them and to nothing else here.
 *
 * The rule that keeps it honest: **nothing in this table may ever read a projection.** A `verify`
 * that consults a goal code is a replay that cannot refuse anything.
 */
const VERIFY = {
  cross: eng.crossSolved,
  'first-layer': eng.keeping(eng.CROSS, eng.F1L),
  'two-layers': eng.firstTwoLayers,
  'top-cross': (s) => eng.firstTwoLayers(s) && eng.topEdgesOriented(s),
  // Where the course's lesson 14 ends: the top edges home and the right way up, the corners anyhow.
  'top-edges': (s) => eng.firstTwoLayers(s) && eng.topEdgesHome(s),
  // `topCornersPlaced`, NOT `topCornersHome`: the owner's stage 5 is corners in their own slots,
  // possibly still twisted, which is the course's order (lesson 15's end). Plan §0. The top edges are
  // HOME as well as up since ADR 0009: "corners home" is what the course says once its edges are, and
  // without them `top-edges` would not nest inside it.
  'corners-home': (s) => eng.firstTwoLayers(s) && eng.topEdgesHome(s) && eng.topCornersPlaced(s),
  // No counterpart in the method solver — the app never stops here — so it is spelled from the
  // cubie model: every edge home and oriented, every corner free.
  'six-cross': (s) => s.ep.every((v, i) => v === i) && s.eo.every((v) => v === 0),
  // The mirror of `six-cross`: every corner home and untwisted, every edge free. Each face is then
  // its centre plus its four corners in one colour, which is an X.
  'x-every-face': (s) => s.cp.every((v, i) => v === i) && s.co.every((v) => v === 0),
  // CFOP's stop after OLL (ADR 0011 Phase 7): the first two layers, and every top piece the right way up
  // wherever it stands. Not nested with `top-edges` or `corners-home` — it says nothing about places,
  // they say nothing about the corners' twist — so it is a stop of the CFOP entries only, never of the
  // beginner's row.
  'top-oriented': (s) => eng.firstTwoLayers(s) && eng.topEdgesOriented(s) && eng.topCornersOriented(s),
  // Roux's stops (ADR 0012). Written for the Roux stages as their contracts, from the piece model, and read
  // here as the second opinion — never a projection.
  'first-block': firstBlockBuilt,
  'both-blocks': bothBlocksBuilt,
  solved: eng.wholeCubeSolved,
};

const TARGET_SPECS = [
  { id: 'cross', name: 'cross', offered: true, parts: ['crossEdges'] },
  { id: 'first-layer', name: 'first layer', offered: true, parts: ['crossEdges', 'dCorners'] },
  { id: 'two-layers', name: 'two bottom layers', offered: true, parts: ['crossEdges', 'dCorners', 'midEdges'] },
  { id: 'top-cross', name: 'top cross', offered: true, parts: ['crossEdges', 'dCorners', 'midEdges', 'flip'] },
  // `topEdges` rather than `flip`: home AND up is the stronger goal, and `flip`'s other eight edges are
  // already home in the first two layers, so it adds nothing `topEdges` does not.
  { id: 'top-edges', name: 'top edges home', offered: true, parts: ['crossEdges', 'dCorners', 'midEdges', 'topEdges'] },
  { id: 'corners-home', name: 'top corners home', offered: true, parts: ['crossEdges', 'dCorners', 'midEdges', 'topEdges', 'uCornerSlots'] },
  // CFOP's stop (ADR 0011 Phase 7). `offered` is true because a method stops here, so the worker bounds
  // it and a chip can be drawn for it; WHICH chips a row shows is the chosen method's (`stopTargets`).
  { id: 'top-oriented', name: 'top oriented', offered: true, parts: ['crossEdges', 'dCorners', 'midEdges', 'flip', 'twist'] },
  // TWO PATTERNS, NOT STAGES, and `offered` is false for both because that field is what the Restore
  // row reads. They are offered through `lib/patterns.js` instead — plan §9.6 says patterns are their
  // own feature and must not drift into the stage row, where every chip means "how far back am I".
  // `sideways: true` — a destination the cube has NEVER BEEN AT. Every stage above is somewhere it
  // was and the child has lost, which is why the copy for one says "back"; a picture is somewhere
  // new, so "a way back to a plus on every face" is false. The flag lives here rather than in
  // `lib/patterns.js` because `stageTargetNow()` hands the TARGET to the copy for a set pattern,
  // and the target is the only thing the sentence ever sees.
  { id: 'six-cross', name: 'a plus on every face', offered: false, sideways: true, parts: ['crossEdges', 'midEdges', 'topEdges'] },
  { id: 'x-every-face', name: 'an X on every face', offered: false, sideways: true, parts: ['dCorners', 'uCorners'] },
  // Roux's stops (ADR 0012): a stop of the Roux entry only, nested with each other and with `solved` but with
  // none of the stages above, which build a cross Roux never makes.
  { id: 'first-block', name: 'first block', offered: true, parts: ['fbEdges', 'fbCorners'] },
  { id: 'both-blocks', name: 'both blocks', offered: true, parts: ['blockEdgesL', 'blockEdgesR', 'dCorners'] },
  { id: 'solved', name: 'solved', offered: true, parts: ['crossEdges', 'midEdges', 'topEdges', 'dCorners', 'uCorners'] },
];

function makeTarget(spec) {
  const projections = spec.parts.map((p) => {
    const proj = PROJECTIONS[p];
    if (!proj) throw new Error(`${spec.id}: no projection named "${p}"`);
    return proj;
  });
  const target = {
    id: spec.id,
    name: spec.name,
    offered: spec.offered,
    sideways: spec.sideways === true,
    parts: Object.freeze([...spec.parts]),
    projections: Object.freeze(projections),
    /** The codes this target reads off a cube, in `parts` order. */
    codesOf: (state) => projections.map((p) => p.codeOf(state)),
    /** Whether a list of codes, in `parts` order, is at every goal. */
    atGoal: (codes) => projections.every((p, i) => p.isGoal(codes[i])),
  };
  // The predicate IS the conjunction, evaluated on a cube. Derived, so it cannot disagree with the
  // heuristic's own reading of the same state — which is the whole of §2 Claim C.
  target.predicate = (state) => projections.every((p) => p.isGoal(p.codeOf(state)));
  // And the second opinion, which is what a route is actually replayed against. See VERIFY.
  target.verify = VERIFY[spec.id];
  if (!target.verify) throw new Error(`${spec.id}: no independent predicate to verify a route against`);
  return Object.freeze(target);
}

/** Every target this mechanism can answer, in nesting order for the six stages. */
export const TARGETS = Object.freeze(TARGET_SPECS.map(makeTarget));

/**
 * By id, because every caller has an id and none of them has an index.
 *
 * NULL PROTOTYPE, and it is not decoration. A plain object inherits `toString`, `constructor` and
 * `__proto__`, so `TARGET_BY_ID['toString']` is a truthy non-target and `targetById('toString')`
 * returned a function instead of throwing — reproduced. Ids reach this from a chip's dataset and
 * from `state.stageTarget`, which is exactly the kind of value that should never be able to
 * resolve to something the prototype chain happened to have.
 */
export const TARGET_BY_ID = Object.freeze(
  Object.assign(Object.create(null), Object.fromEntries(TARGETS.map((t) => [t.id, t]))),
);

/** `id` as a target, or a throw. A silently-undefined target is a screen that shows nothing. */
export function targetById(id) {
  const target = TARGET_BY_ID[id];
  if (!target) throw new Error(`stage-targets: no target named "${id}"`);
  return target;
}

/**
 * The chips the Restore screen offers, in order: the six stages, then `solved` (plan §6; ADR 0009).
 *
 * Nesting order, and it is load-bearing rather than cosmetic — `d(cross) <= d(first-layer) <= …`
 * holds for every cube, so a row read left to right never goes down. A chip reading a smaller
 * number than the one before it is a visible defect, which is worth more than a comment.
 */
export const OFFERED_TARGETS = Object.freeze(TARGETS.filter((t) => t.offered));

/**
 * The nesting of plan §1, as an ordered list of ids: each target's state set contains the next.
 *
 * `six-cross` is absent because it is not nested with the stages — it constrains all twelve edges
 * and no corners, so it is neither a superset nor a subset of `two-layers`. Saying so here keeps
 * anybody from adding it to a monotonicity check and being surprised.
 */
export const NESTING = Object.freeze([
  'cross', 'first-layer', 'two-layers', 'top-cross', 'top-edges', 'corners-home', 'solved',
]);
