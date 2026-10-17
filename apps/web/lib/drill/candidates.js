// The holds a drill could be in, each as the track its algorithm traces from one start arrangement.
//
// dev-docs/algorithm-drill-v2-plan.md §3.2–3.3. A smart cube reports turns of its OWN faces and knows
// nothing of how it is held, so the hold is not asked for: every one of the 24 is a candidate, and the
// turns the cube reports rule candidates out (`lib/drill/engine.js`). This module only builds them.
//
// A candidate is a TRACK (`trackOf` in lib/script-track.js): the arrangement at every position of the
// algorithm and the midpoints between them, so `R2` as two reports, `M` as `R` and `L'` in either order
// and `y` as nothing are all already matched by arrangement, never by token. The algorithm is read by the
// one interpreter (`run`'s arithmetic in lib/cube-moves.js) in the hold in force at each move, so a wide
// turn or a rotation part way through changes the letters that follow, exactly as it does in a hand.
//
// Holds that turn the same faces the same way trace the same track — an algorithm of R and L turns only
// cannot tell the four holds about that axis apart — so they are ONE candidate carrying every hold that
// shares it. That is not a guess: nothing a cube reports could separate them.
import { applyIdentity, faceTurnsOf, heldFace, toIdentity } from '../cube-moves.js';
import { parse } from '../cube-notation.js';
import { ORIENTATIONS } from '../cube-orientation.js';
import { SOLVED, applyMove, toFacelets } from '../cube-pieces.js';
import { trackOf } from '../script-track.js';

/** The face turns one identity-frame move makes, relative to the centres, in the piece model's names. */
const faceNames = (identity) => faceTurnsOf(identity).turns.map((t) => t.name).filter(Boolean);

/**
 * The algorithm's turns in the half-turn metric, as the pieces see them: a face turn is one, a half turn
 * one, a wide turn one (its one outer face, relative to the centres), a slice two, a rotation none. The
 * same count in every hold, because a hold renames faces and never adds or removes one.
 */
export function htmOf(alg) {
  const moves = typeof alg === 'string' ? parse(alg) : alg;
  return moves.reduce((n, move) => n + faceNames(toIdentity(move, ['U', 'F'])).length, 0);
}

/**
 * The algorithm read in every hold, once — none of it depends on where the cube starts, so an engine works
 * it out when it is made and each rep only applies it: `[{ holds, heldAt, transitions, faces }]`, one entry
 * per distinct sequence of face turns.
 *
 * `transitions[k]` is the identity-frame move from position k to k+1, `faces[k]` its face turns in the
 * piece model's names, and `heldAt[j][k]` the hold in force at position k for `holds[j]` — a rotation or a
 * wide turn inside the algorithm changes it. Two holds share an entry exactly when every token turns the
 * same faces the same way. `fixedHold` (`[up, front]`) narrows the holds to that one.
 */
export function plansFor(alg, { fixedHold = null } = {}) {
  const moves = typeof alg === 'string' ? parse(alg) : alg;
  if (!moves.length) throw new Error('drill: an algorithm needs at least one move');
  const byKey = new Map();
  for (const hold of fixedHold ? [fixedHold] : ORIENTATIONS) {
    const heldAt = [Object.freeze([...hold])];
    const transitions = [];
    let now = [...hold];
    for (const move of moves) {
      const identity = toIdentity(move, now);
      // A move's effect on the hold does not depend on the pieces, so any state will do here.
      now = applyIdentity(identity, now, SOLVED).hold;
      transitions.push(Object.freeze([identity]));
      heldAt.push(Object.freeze([...now]));
    }
    const faces = transitions.map(([m]) => Object.freeze(faceNames(m)));
    const key = faces.map((f) => f.join(' ')).join('|');
    const known = byKey.get(key);
    if (known) {
      known.holds.push(Object.freeze([...hold]));
      known.heldAt.push(Object.freeze(heldAt));
      continue;
    }
    byKey.set(key, { holds: [Object.freeze([...hold])], heldAt: [Object.freeze(heldAt)], transitions, faces });
  }
  return Object.freeze([...byKey.values()].map((p) => Object.freeze({
    holds: Object.freeze(p.holds),
    heldAt: Object.freeze(p.heldAt),
    transitions: Object.freeze(p.transitions),
    faces: Object.freeze(p.faces),
  })));
}

/**
 * One plan as a candidate from `start` (a piece state in the cube's own frame): the plan with its TRACK —
 * the arrangement at every position and the midpoints between them (`trackOf`) — and the start it was
 * built from.
 *
 * `upTo` builds positions 0..upTo only, and marks the candidate `partial`. A rep arms with 24 candidates
 * and its first accepted turn leaves at most a handful, so building every track whole spent most of an
 * arm on tracks a turn later thrown away; the engine extends the survivors (`whole`) before it reads
 * anything beyond the prefix.
 */
export function candidateFrom(plan, start, upTo = Infinity) {
  const last = Math.min(plan.faces.length, upTo);
  const pieces = [start];
  for (const names of plan.faces.slice(0, last)) {
    let state = pieces.at(-1);
    for (const name of names) state = applyMove(state, name);
    pieces.push(state);
  }
  const states = pieces.map(toFacelets);
  return Object.freeze({
    ...plan,
    start,
    partial: last < plan.faces.length,
    track: trackOf(states, plan.transitions.slice(0, last), pieces),
  });
}

/** A candidate with its whole track — itself, when it already has it. */
export const whole = (candidate) => (candidate.partial ? candidateFrom(candidate, candidate.start) : candidate);

/** Every plan as a candidate from `start`, each track built to position `upTo` (all of it by default). */
export const candidatesFrom = (plans, start, upTo = Infinity) =>
  Object.freeze(plans.map((plan) => candidateFrom(plan, start, upTo)));

/** `plansFor` and `candidatesFrom` in one: every distinct track `alg` traces from `start`. */
export const candidatesFor = (alg, start, options) => candidatesFrom(plansFor(alg, options), start);

/**
 * Identity-frame face turns (`R2`, `U'`) as the letters a child holding the cube `hold` reads them by — or
 * null when the holds disagree, because then the letters are not yet knowable.
 */
export function heldLetters(turns, holds) {
  const spell = (hold) => turns.map((t) => `${heldFace(t[0], hold)}${t.slice(1)}`).join(' ');
  const spellings = new Set(holds.map(spell));
  return spellings.size === 1 ? [...spellings][0].split(' ').filter(Boolean) : null;
}

/** The face turns transition `k` of a candidate makes, as `[{ face, quarters }]`, `quarters` 1 or 2. */
export function faceQuartersAt(candidate, k) {
  const moves = candidate.transitions[k];
  if (!moves) return [];
  return moves.flatMap((m) => faceTurnsOf(m).turns.filter((t) => t.name).map((t) => ({
    face: t.face,
    quarters: t.name.endsWith('2') ? 2 : 1,
  })));
}
