// Building an F2L position, and enumerating every one there is.
//
// Shared by `f2l-configurations.test.mjs`, which asks what the app's pairing rung does with each
// of them, and `f2l-table.test.mjs`, which replays the generated table's algorithms through this
// repository's own cube. Two tests over one construction, because a builder that drifted between
// them would make the two agree about a cube neither of them is describing.

import assert from 'node:assert/strict';

import { CORNER, EDGE } from '../../lib/cube-pieces.js';

export const U_CORNER_SLOTS = [CORNER.URF, CORNER.UFL, CORNER.ULB, CORNER.UBR];
export const D_CORNER_SLOTS = [CORNER.DFR, CORNER.DLF, CORNER.DBL, CORNER.DRB];
export const U_EDGE_SLOTS = [EDGE.UR, EDGE.UF, EDGE.UL, EDGE.UB];
export const MIDDLE_SLOTS = [EDGE.FR, EDGE.FL, EDGE.BL, EDGE.BR];
export const CROSS_SLOTS = [EDGE.DR, EDGE.DF, EDGE.DL, EDGE.DB];

/** Slot 0's pair, and what its algorithm may not disturb. Slot 0 because the rung walks the
 *  slots in order, so it is the one whose configuration a constructed cube controls exactly. */
export const PAIR = { corner: CORNER.DFR, edge: EDGE.FR };
export const PROTECTED_CORNERS = D_CORNER_SLOTS.filter((c) => c !== PAIR.corner);
export const PROTECTED_EDGES = [...CROSS_SLOTS, ...MIDDLE_SLOTS.filter((e) => e !== PAIR.edge)];

const permutationParity = (a) => {
  let p = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] > a[j]) p ^= 1;
  return p;
};

/**
 * A legal cube with the cross solved and slot 0's pair in a named configuration.
 *
 * `filler` chooses which of the free top-layer pieces goes where — the knob the exhaustiveness
 * check turns. Everything the SEARCH reads is fixed by the four arguments before it; everything
 * else is whatever makes the cube legal, which is what a real cube at this point in a solve is.
 */
export function configuration(cornerAt, twist, edgeAt, flip, filler = 0) {
  const cp = new Array(8).fill(-1);
  const co = new Array(8).fill(0);
  const ep = new Array(12).fill(-1);
  const eo = new Array(12).fill(0);
  for (const slot of CROSS_SLOTS) { ep[slot] = slot; eo[slot] = 0; }
  cp[cornerAt] = PAIR.corner;
  co[cornerAt] = twist;
  ep[edgeAt] = PAIR.edge;
  eo[edgeAt] = flip;

  const otherCorners = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => c !== PAIR.corner);
  const freeCornerSlots = [...U_CORNER_SLOTS, ...D_CORNER_SLOTS].filter((s) => s !== cornerAt);
  const otherEdges = [...U_EDGE_SLOTS, ...MIDDLE_SLOTS].filter((e) => e !== PAIR.edge);
  const freeEdgeSlots = [...U_EDGE_SLOTS, ...MIDDLE_SLOTS].filter((s) => s !== edgeAt);
  // The knob: rotate which spare piece lands in which spare slot.
  const roll = (list, by) => list.map((_, i) => list[(i + by) % list.length]);
  roll(otherCorners, filler).forEach((cubie, i) => { cp[freeCornerSlots[i]] = cubie; });
  roll(otherEdges, filler).forEach((cubie, i) => { ep[freeEdgeSlots[i]] = cubie; });

  // Legal: twists sum to 0 mod 3, flips to 0 mod 2, and the two permutations share a parity.
  // Absorbed by spare TOP-layer pieces, which is where a real solve's spare pieces are.
  const spareCorners = freeCornerSlots.filter((s) => U_CORNER_SLOTS.includes(s));
  const spareEdges = freeEdgeSlots.filter((s) => U_EDGE_SLOTS.includes(s));
  co[spareCorners[0]] = (3 - (twist % 3)) % 3;
  eo[spareEdges[0]] = flip;
  if (permutationParity(cp) !== permutationParity(ep)) {
    const [a, b] = [spareCorners[1], spareCorners[2]];
    [cp[a], cp[b]] = [cp[b], cp[a]];
    [co[a], co[b]] = [co[b], co[a]];
  }
  assert.ok(!cp.includes(-1) && !ep.includes(-1), 'the construction left a slot empty');
  return { cp, co, ep, eo };
}

/** Every configuration the search can be asked about, as `{ cornerAt, twist, edgeAt, flip }`. */
export const EVERY_CONFIGURATION = [...U_CORNER_SLOTS, ...D_CORNER_SLOTS].flatMap((cornerAt) =>
  [0, 1, 2].flatMap((twist) =>
    [...U_EDGE_SLOTS, ...MIDDLE_SLOTS].flatMap((edgeAt) =>
      [0, 1].map((flip) => ({ cornerAt, twist, edgeAt, flip })))));



/**
 * The same pair configuration, but with the OTHER three pairs already solved.
 *
 * `configuration()` above fills the free slots with whatever makes the cube legal, which is what a
 * real cube looks like part way through F2L and is the right population for asking what the pairing
 * rung does. It is the WRONG population for asking about the `two-layers` target: with the other
 * pairs scattered, the distance to two solved layers is about all four pairs and the crate's number
 * is about one.
 *
 * This builder isolates the pair, so the two questions coincide and the crate's 42 proven minima can
 * be compared against `lib/stage-distance.js`'s answers. Every case in
 * `crates/optimal-solver/tables/f2l.json` has its corner in DFR or UBR and its edge in FR or a U
 * slot, so the three solved pairs are never in the way — asserted below rather than assumed.
 */
export function pairsSolvedConfiguration(cornerAt, twist, edgeAt, flip) {
  const OTHER_CORNERS = D_CORNER_SLOTS.filter((c) => c !== PAIR.corner);
  const OTHER_MIDDLES = MIDDLE_SLOTS.filter((e) => e !== PAIR.edge);
  assert.ok(!OTHER_CORNERS.includes(cornerAt),
    `pairsSolvedConfiguration: corner slot ${cornerAt} belongs to a pair this builder keeps solved`);
  assert.ok(!OTHER_MIDDLES.includes(edgeAt),
    `pairsSolvedConfiguration: edge slot ${edgeAt} belongs to a pair this builder keeps solved`);

  const cp = new Array(8).fill(-1);
  const co = new Array(8).fill(0);
  const ep = new Array(12).fill(-1);
  const eo = new Array(12).fill(0);
  // Everything the target needs except this one pair.
  for (const slot of CROSS_SLOTS) { ep[slot] = slot; eo[slot] = 0; }
  for (const slot of OTHER_MIDDLES) { ep[slot] = slot; eo[slot] = 0; }
  for (const slot of OTHER_CORNERS) { cp[slot] = slot; co[slot] = 0; }
  // The pair, where the case says.
  cp[cornerAt] = PAIR.corner;
  co[cornerAt] = twist;
  ep[edgeAt] = PAIR.edge;
  eo[edgeAt] = flip;
  // The four top corners and four top edges go wherever is left.
  const freeCornerSlots = [PAIR.corner, ...U_CORNER_SLOTS].filter((s) => s !== cornerAt);
  const freeEdgeSlots = [PAIR.edge, ...U_EDGE_SLOTS].filter((s) => s !== edgeAt);
  U_CORNER_SLOTS.forEach((cubie, i) => { cp[freeCornerSlots[i]] = cubie; });
  U_EDGE_SLOTS.forEach((cubie, i) => { ep[freeEdgeSlots[i]] = cubie; });

  // Legal, and absorbed by top-layer pieces exactly as `configuration()` does it: twists sum to 0
  // mod 3, flips to 0 mod 2, and the two permutations share a parity.
  const spareCorners = freeCornerSlots.filter((s) => U_CORNER_SLOTS.includes(s));
  const spareEdges = freeEdgeSlots.filter((s) => U_EDGE_SLOTS.includes(s));
  co[spareCorners[0]] = (3 - (twist % 3)) % 3;
  eo[spareEdges[0]] = flip;
  if (permutationParity(cp) !== permutationParity(ep)) {
    const [a, b] = [spareCorners[1], spareCorners[2]];
    [cp[a], cp[b]] = [cp[b], cp[a]];
    [co[a], co[b]] = [co[b], co[a]];
  }
  assert.ok(!cp.includes(-1) && !ep.includes(-1), 'the construction left a slot empty');
  return { cp, co, ep, eo };
}
