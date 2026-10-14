// Which turns tell a set of holds apart — dev-docs/lesson-holds-plan.md Phase 4 ("Match my cube").
//
// A whole-cube turn cannot be observed: a smart cube reports which FACE turned, never how the cube is
// held. But a child asked to turn "the face looking at you" turns whichever face IS looking at them, and
// the cube reports that face. So a hold can be told from the faces a child's turns land on — when, and
// only when, the turns asked for land on different faces in every hold that could be in their hands.
// One turn is not enough for the holds a lesson uses: after `y2` of the tumble the front is green again,
// exactly as it was before the tumble, and only a turn on a second axis (the top) tells the two apart
// (plan §1 rule 3: four holds pass a front check).
//
// Pure: no DOM, no renderer, no trust. Practice proves nothing about the cube's state and must not be
// able to raise trust in it (plan §1 rule 4), which this file cannot do by construction.

import { identityFace, run } from './cube-moves.js';
import { SOLVED } from './cube-pieces.js';
import { SCAN_HOLD, TUMBLED } from './solving-hold.js';

const FACES = Object.freeze(['F', 'U', 'R', 'L', 'D', 'B']);

const spec = ([up, front]) => `${up} ${front}`;

/**
 * The holds a lesson asks a child to copy: the scan's, the tumble, and the tumble turned by `y` to each
 * side — every hold the method uses (white up for the first two stages, then white underneath with the
 * gap brought round to the front). Derived from the tumble rather than written down, so a change to the
 * tumble moves them with it.
 */
export const PRACTISED_HOLDS = Object.freeze([
  SCAN_HOLD,
  ...['', 'y', 'y2', "y'"].map((t) => Object.freeze(t ? [...run(t, TUMBLED, SOLVED).hold] : [...TUMBLED])),
]);

/** The face a smart cube reports when a child holding the cube `hold` turns their own `face`. */
export const reportedFace = (face, hold) => identityFace(face, hold);

/** Does turning `probes` land on a different face somewhere for every two holds in `holds`? */
export function separates(probes, holds) {
  for (let i = 0; i < holds.length; i++) {
    for (let j = i + 1; j < holds.length; j++) {
      if (probes.every((p) => reportedFace(p, holds[i]) === reportedFace(p, holds[j]))) return false;
    }
  }
  return true;
}

/**
 * The fewest of the child's faces whose turns tell every hold in `holds` apart, in a fixed order
 * preference — the face looking at them first, then the top. Refuses a list that repeats a hold, which no
 * set of turns can separate.
 */
export function separatingProbes(holds = PRACTISED_HOLDS) {
  const seen = new Set(holds.map(spec));
  if (seen.size !== holds.length) throw new Error('hold-probes: a hold is listed twice, and nothing tells a hold from itself');
  for (let size = 1; size <= FACES.length; size++) {
    const pick = (from, chosen) => {
      if (chosen.length === size) return separates(chosen, holds) ? chosen : null;
      for (let k = from; k < FACES.length; k++) {
        const found = pick(k + 1, [...chosen, FACES[k]]);
        if (found) return found;
      }
      return null;
    };
    const found = pick(0, []);
    if (found) return Object.freeze(found);
  }
  throw new Error('hold-probes: no set of turns separates these holds');
}

/**
 * The hold the reported faces single out among `holds`, or null when they fit none or more than one —
 * "decides the hold only when those reports single it out" (Phase 4). `reports[i]` is the face the cube
 * reported for the child's turn of `probes[i]`.
 */
export function holdFromReports(probes, reports, holds = PRACTISED_HOLDS) {
  const fits = holds.filter((h) => probes.every((p, i) => reportedFace(p, h) === reports[i]));
  return fits.length === 1 ? fits[0] : null;
}

/**
 * A practice round as the child's moves: each probe, then its undo, so the cube ends exactly as it began
 * (Phase 4 item 4.2) — a practice turn must not move the lesson's cube on.
 */
export const probeRound = (probes) => Object.freeze(probes.flatMap((p) => [p, `${p}'`]));
