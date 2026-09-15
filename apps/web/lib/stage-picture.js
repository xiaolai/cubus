// What a target LOOKS like — with the pieces it does not care about drawn as unknown.
//
// Plan §6 of dev-docs/solve-to-state-plan.md, and it is the part that makes a shortest path
// acceptable rather than alarming. **The shortest way back to the top cross may break the cross on
// the way.** A child watching that happen with no idea what they are aiming at concludes the app is
// wrong; a child who can see the target, with "doesn't matter yet" drawn as grey, follows it.
// Without this the first alarming route costs the feature its credibility, and no amount of correct
// arithmetic buys that back.
//
// A facelet string, so it goes straight into `<cubus-cube facelets=…>`. Unconstrained stickers are
// `'?'`, which the renderer already draws as unknown — the same mechanism the Restore screen's twin
// uses for a half-finished scan, rather than a second convention invented here.
//
// THE RULE THIS FILE IS HELD TO: **never claim a sticker the target leaves free.** Over-claiming
// draws a picture that is simply wrong; under-claiming draws a greyer picture than necessary, which
// is merely less useful. So the pinning below is structural and conservative, and
// `test/stage-picture.test.mjs` samples real states from each target and fails if the picture ever
// asserts a colour that varies across them.

import { SOLVED } from './cube-pieces.js';
import { SLOT_FACELETS } from './cube-layout.js';
import { toFacelets } from './two-phase.js';
import { targetById } from './stage-targets.js';

/** What the renderer draws as "not known". */
export const UNKNOWN = '?';

const SOLVED_FACELETS = toFacelets(SOLVED);

/** The U-layer edge slots, whose four cubies all carry `U` as their first sticker. */
const U_EDGE_SLOTS = [0, 1, 2, 3];
/** Every edge slot that is not in the U layer — the eight `flip`'s precondition is about. */
const NON_U_EDGE_SLOTS = [4, 5, 6, 7, 8, 9, 10, 11];

/**
 * The target, as a facelet string with the free stickers blanked.
 *
 * Four pinning rules, and each one is a statement about a projection rather than about a target, so
 * a new target built from the same projections gets the right picture for free:
 *
 *   centres        always. They are the colour frame — a cube cannot move them, so every target
 *                  agrees about all six.
 *   home goals     a packed projection whose goal is "these cubies home and correctly turned" pins
 *                  every sticker of every slot it tracks.
 *   own-slot goals `uCornerSlots` says each top corner is in its own slot with the twist free, so
 *                  its three stickers are a rotation of the right three colours and no individual
 *                  sticker is determined. Blank, deliberately: "the right piece, turned the wrong
 *                  way" is not something a facelet string can say.
 *   the flip goal  ONLY under its precondition, which is the equivalence plan §3 insists on testing
 *                  in both directions. `flip` says every edge is unflipped; that pins a U slot's
 *                  U-facing sticker to `U` only when the occupant is guaranteed to be one of the
 *                  four U edges — which follows from the other eight edges being pinned home, and
 *                  from nothing else. The precondition is CHECKED here rather than assumed, so a
 *                  future target that reads `flip` without pinning the bottom eight gets a greyer
 *                  picture instead of a wrong one.
 */
export function targetPicture(targetOrId) {
  const target = typeof targetOrId === 'string' ? targetById(targetOrId) : targetOrId;
  const out = new Array(54).fill(UNKNOWN);

  // The centres, always.
  SLOT_FACELETS.centers.forEach((at, i) => { out[at] = SLOT_FACELETS.faces[i]; });

  const pinnedEdgeSlots = new Set();
  for (const projection of target.projections) {
    if (projection.kind === 'edge' && isHomeGoal(projection)) {
      for (const cubie of projection.cubies) {
        pinnedEdgeSlots.add(cubie);
        for (const at of SLOT_FACELETS.edges[cubie]) out[at] = SOLVED_FACELETS[at];
      }
    }
    if (projection.kind === 'corner' && isHomeGoal(projection)) {
      for (const cubie of projection.cubies) {
        for (const at of SLOT_FACELETS.corners[cubie]) out[at] = SOLVED_FACELETS[at];
      }
    }
    // `cornerSlot` pins nothing a sticker can show: the piece is home and the twist is free.
  }

  const readsFlip = target.projections.some((p) => p.kind === 'flip');
  const bottomEightPinned = NON_U_EDGE_SLOTS.every((slot) => pinnedEdgeSlots.has(slot));
  if (readsFlip && bottomEightPinned) {
    // `toFacelets` writes `name[(k + eo) % 2]` at `EDGE_FACELETS[slot][k]`, so with eo === 0 the
    // FIRST facelet of the slot carries the cubie's first letter — and all four U edges are named
    // `U*`, so that letter is `U` whichever of them is standing there.
    for (const slot of U_EDGE_SLOTS) out[SLOT_FACELETS.edges[slot][0]] = 'U';
  }

  return out.join('');
}

/**
 * Is this projection's goal "every tracked cubie home and correctly turned"?
 *
 * Asked by comparing the goal against `codeOf(SOLVED)` — the projection's OWN encoder — rather than
 * by rebuilding the packing here. The first version reimplemented the orientation spans and the
 * base-24 arithmetic, so changing the encoding in `stage-targets.js` would have needed a
 * coordinated edit here or the picture would have quietly stopped pinning anything.
 *
 * THE KIND GATE STAYS, and it is doing real work rather than guarding the arithmetic. A
 * `cornerSlot` projection's goal IS `codeOf(SOLVED)` — a corner in its own slot, twist untracked —
 * so the comparison alone would call it a home goal and the picture would paint three stickers of
 * a corner whose twist the target leaves free. That is the over-claim this file exists to avoid.
 */
const TRACKS_ORIENTATION = new Set(['edge', 'corner']);
function isHomeGoal(projection) {
  if (!TRACKS_ORIENTATION.has(projection.kind)) return false;
  return projection.goals.length === 1 && projection.goals[0] === projection.codeOf(SOLVED);
}

/** How many of the 54 stickers a target pins — the number a chip's "how much is fixed" reads. */
export const pinnedCount = (targetOrId) =>
  [...targetPicture(targetOrId)].filter((ch) => ch !== UNKNOWN).length;
