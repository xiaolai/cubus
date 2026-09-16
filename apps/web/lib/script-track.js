// Where a cube in a child's hands is on a walk: an observed arrangement matched to a position.
//
// dev-docs/tutorial-capability-plan.md item 3.3; ADR 0004 R3, R5, R6. This is the logic that lived in
// `lib/walk-follow.js` as `locate()` and its half-turn midpoints, moved to where every stop-driven
// script can use it — the cube screen's walk is one, and it now calls this.
//
// MATCHED BY STATE, NEVER BY TOKEN. A smart cube reports quarter turns of its faces; a walk is full of
// half turns, slices and regrips. `R2` arrives as two reports, `M` as `R` and `L'` in either order, and
// `y` as nothing at all. Tokens cannot be paired with that; arrangements always can.
//
// A MIDPOINT is an arrangement the cube passes through part way into a position: one quarter of a half
// turn (in either direction — undoing `R2` passes through `R'`), one face of a slice before the other.
// It is accepted silently and moves nothing, and it counts only BESIDE its own transition: landing on
// a distant one is a wrong turn, not progress somebody forgot to report.
//
// A REGRIP IS NOT OBSERVABLE. A position reached by whole-cube turns alone has the same arrangement as
// the one before it, so a child following on a real cube has nothing to do there and nothing could
// report it. Such a position is passed through when the one before it is reached — which is how a walk
// ends on its trailing `x2` without waiting for a report that will never come (ADR 0004 decision 9).
import { applyMove, toFacelets } from './cube-pieces.js';
import { faceTurnsOf } from './cube-moves.js';
import { parse } from './cube-notation.js';
import { stateFrom } from './script-view.js';

/**
 * The quarter turns of each outer face a move makes, relative to the centres: `[{ face, quarters }]`,
 * `quarters` in 1, 2 or -1 as the piece model names them (`R`, `R2`, `R'`).
 */
function faceQuarters(move) {
  return faceTurnsOf(move).turns
    .filter((t) => t.name)
    .map((t) => ({ face: t.face, quarters: t.name.endsWith('2') ? 2 : t.name.endsWith("'") ? -1 : 1 }));
}

/** A face turned by `q` quarters in the piece model's names — `R`, `R2`, `R'` — or null for none. */
const nameFor = (face, q) => ({ 1: face, 2: `${face}2`, [-1]: `${face}'`, [-2]: `${face}2` }[q] ?? null);

/**
 * Every arrangement strictly between `from` and the end of `moves`: each face that turns is part way
 * through its own turn, independently — the faces of one slice or wide move lie on one axis and
 * commute, so the order a cube reports them in cannot matter.
 */
function between(from, moves) {
  const faces = moves.flatMap(faceQuarters);
  if (!faces.length) return [];
  // For each face: how far it may be — none, part way, or all the way. A half turn can be part way in
  // either direction, because undoing `R2` passes through `R'`.
  const options = faces.map(({ quarters }) => {
    if (Math.abs(quarters) === 1) return [0, quarters];
    return [0, 1, -1, 2];
  });
  const out = new Set();
  const walk = (i, progress) => {
    if (i === faces.length) {
      const none = progress.every((p) => p === 0);
      const all = progress.every((p, k) => p === faces[k].quarters || (Math.abs(faces[k].quarters) === 2 && Math.abs(p) === 2));
      if (none || all) return;
      let state = from;
      progress.forEach((p, k) => { const name = nameFor(faces[k].face, p); if (name) state = applyMove(state, name); });
      out.add(toFacelets(state));
      return;
    }
    for (const p of options[i]) walk(i + 1, [...progress, p]);
  };
  walk(0, []);
  return [...out];
}

/**
 * A track: the arrangement at every position and the midpoints between them.
 *
 * `states[k]` is position k's arrangement as 54 facelets, or null for a position nothing can match (a
 * painted picture claims no arrangement). `transitions[k]` is the identity-frame moves from position k
 * to k+1 — an empty array for a cut. `observable[k]` is false for a position reached by regrips alone.
 */
export function trackOf(states, transitions) {
  // An empty track is a walk that does not exist yet — one being searched for — and matching anything on
  // it is simply `off`; the cube screen asks while it waits.
  const needed = Math.max(0, states.length - 1);
  if (transitions.length !== needed) {
    throw new Error(`script-track: ${states.length} positions need ${needed} transitions, not ${transitions.length}`);
  }
  const midpoints = new Map();
  const observable = states.map((_, k) => k === 0 || transitions[k - 1].some((m) => faceQuarters(m).length));
  transitions.forEach((moves, k) => {
    if (states[k] === null) return;
    for (const f of between(stateFrom(states[k]), moves)) {
      if (!midpoints.has(f)) midpoints.set(f, []);
      midpoints.get(f).push(k);
    }
  });
  return Object.freeze({ states: Object.freeze([...states]), midpoints, observable: Object.freeze(observable) });
}

/**
 * Where `facelets` is on `track`, for a cube last known to be at `from`:
 * `{ kind: 'step', idx }`, `{ kind: 'mid', idx: from }`, or `{ kind: 'off' }`.
 *
 * Near first, AHEAD BEFORE BEHIND at the same distance (R6): a walk can pass through one arrangement
 * twice — a step ending on `R` and the next beginning with `R'` are not merged, and 1,661 of 3,600
 * method walks do it within two moves — and there the cube matches both. The turn that reached it IS
 * the walk's next move, so it is progress; checking behind first drew an undo nobody made.
 */
export function locate(track, facelets, from) {
  const { states, midpoints, observable } = track;
  const passRegrips = (idx) => {
    let k = idx;
    while (k + 1 < states.length && !observable[k + 1] && states[k + 1] === states[k]) k++;
    return k;
  };
  // The other way along the same run: where the cube WAS when it was carried to `from`. Arriving at a
  // position passes the regrips that follow it, so a cube standing at `from` may be mid-way through the
  // turn that led into the position the pass started at — undoing a quarter of `R2` in `R2 x2` produced
  // transition 0's midpoint while `from` was already 2, and that was reported as off the walk entirely
  // (Codex audit, 2026-09-16).
  const passedFrom = (idx) => {
    let k = idx;
    while (k > 0 && !observable[k] && states[k] === states[k - 1]) k--;
    return k;
  };
  for (let d = 0; d <= 2; d++) {
    for (const idx of d === 0 ? [from] : [from + d, from - d]) {
      if (idx >= 0 && idx < states.length && states[idx] === facelets) {
        // Reaching a position carries the cube through any regrip that follows it — but only when it
        // was REACHED: standing still on a position must not skip what comes next.
        return { kind: 'step', idx: idx === from ? idx : passRegrips(idx) };
      }
    }
  }
  const oldest = passedFrom(from) - 1;                 // the transition INTO the run `from` sits at the end of
  if (midpoints.get(facelets)?.some((k) => k <= from && k >= oldest)) return { kind: 'mid', idx: from };
  const idx = states.indexOf(facelets);
  return idx >= 0 ? { kind: 'step', idx: passRegrips(idx) } : { kind: 'off' };
}

/**
 * The track of a built script (`buildScript` in `lib/script-view.js`): every position's arrangement,
 * with a painted picture unmatchable, and the identity-frame moves between neighbours in one segment.
 * A cut — a new cube, a picture, a new hold — is a transition of no moves.
 */
export function trackFor(built) {
  const { positions, segments } = built;
  const states = positions.map((p) => (p.isPicture ? null : toFacelets(p.cube)));
  const transitions = positions.slice(1).map((p, k) => {
    const prev = positions[k];
    if (p.segment !== prev.segment) return [];
    return segments[p.segment].tokens.slice(prev.moves, p.moves).map((token) => parse(token)[0]);
  });
  return trackOf(states, transitions);
}
