// Which way up the WALK ON SCREEN is held, and turning the renderer to it — ADR 0003.
//
// `solving-hold.js` says how each stage is held and renames between frames; it knows nothing about a
// walk, a lesson's move list or a renderer. This file is the other half: given the walk on a screen,
// which hold is it in at a given move, when does that hold change, and how is the renderer turned
// to it.
//
// It used to be closure state inside the cube screen's mount — a function of some 1,700 lines — and
// a mini audit of the branch (2026-09-13) found the two things that position hides: the overshoot
// rule stated one way in a comment and another in the code, and the renderer-upgrade path reached by
// no test. Functions with explicit inputs make both testable (`test/hold-presenter.test.mjs`). The rest
// of that mount's walk followed the same day, into `lib/walk-session.js`, which is what calls these.

import { stepAtMove } from './method-lesson.js';
import { SCAN_HOLD, holdForStage, holdForTarget, holdSentence, holdSpec, sameHold } from './solving-hold.js';

/**
 * How a walk that is not a lesson is held.
 *
 * A route that answered — exact, or a fallback, INCLUDING one that overshot to the whole cube, and
 * one already at its target — is held the way its target is built. The child aimed at that stage, so
 * that is how the cube is in their hands, and an overshoot does not turn it back over to show the
 * rest. Anything else keeps the scan's hold: no target, no route yet, a route that found nothing and
 * left the whole-cube walk on screen, a scramble.
 */
export function walkHoldFor(route, target) {
  if (!target || !route || route.alg === null || route.alg === undefined) return SCAN_HOLD;
  return holdForTarget(target.id);
}

/**
 * The hold of move `k` of a walk: a lesson's per move, any other walk's throughout.
 *
 * `k` may equal the walk's length — past the last move the last step's hold stays, which is the rule
 * `stepAtMove` applies to the lesson's cue.
 */
export function holdAtMove(lesson, walkHold, k) {
  if (!lesson) return walkHold;
  const step = lesson.steps[stepAtMove(lesson.moveStep, k)];
  return step ? holdForStage(step.stage) : walkHold;
}

/**
 * The hold move `k` is MADE in — what its chip is named for, and the smart cube's line.
 *
 * Not `holdAtMove`: that is the STAGE's hold, which the renderer is turned to and the hold sentence
 * says, and it changes once, at the tumble. A lesson's regrips turn the child's hold within a stage,
 * move by move (`lesson.moveHolds`, plan item 6.1), while the drawing turns with the regrip itself —
 * so turning the renderer to this one as well would turn the cube twice. Any other walk is held
 * `walkHold` throughout. `k` may equal the walk's length: the hold after the last move.
 */
export function moveHold(lesson, walkHold, k) {
  if (!lesson) return walkHold;
  const holds = lesson.moveHolds;
  if (!Array.isArray(holds) || holds.length === 0) {
    throw new Error('hold-presenter: a lesson carries the hold of every move (`moveHolds`)');
  }
  return holds[Math.min(Math.max(k, 0), holds.length - 1)];
}

/**
 * The hold of the move about to happen at head `i`, and the sentence that says so when it is not
 * `shown`, the hold the screen showed before this head. The drawing turns, but a child's own cube
 * does not, and every chip from here on is named for it. So the sentence follows what was SHOWN,
 * not move `i - 1`: a lesson begun turned over says so at its first move, and a jump or a step
 * back across the turn says so where it lands.
 */
export function holdChangeAt(lesson, walkHold, i, shown) {
  const held = holdAtMove(lesson, walkHold, i);
  return { held, say: sameHold(held, shown) ? '' : holdSentence(held) };
}

/**
 * A function that turns `cube` to a hold — the renderer turning the OBJECT, never the camera.
 *
 * Animated, because a cube that jumps upside down between two frames reads as a different cube, and
 * the turn is what tells a child to turn theirs. `data-hold` records what was asked for: the
 * renderer's pose is private, and a browser test and a person debugging both need to read it.
 *
 * NOT A RENDERER YET — the vendored bundle has not upgraded the tag — the pose waits for the element
 * to be defined, and only the LAST hold asked for is applied, on a screen that is still standing.
 * Each request takes a generation, so three holds asked for before the upgrade turn the cube once,
 * to the third. This used to write the `orientation` attribute, which an upgrade does read, but which
 * then stayed behind naming a pose the renderer had since turned away from.
 */
export function createHoldCube({ cube, isStale, registry = globalThis.customElements, tag = 'cubus-cube' }) {
  /** The hold last ASKED for — the dedupe, so three asks for one hold turn the cube once. */
  let heldSpec = null;
  let asked = 0;
  /**
   * Turn the cube, now that this request is known to still be the current one.
   *
   * THE STALENESS CHECK COVERS BOTH PATHS. It used to guard only the deferred one, so a screen that
   * had already been replaced still turned an UPGRADED renderer and still stamped `data-hold` on it —
   * and the element is parked and re-used, so that is the next screen's cube being turned by the last
   * screen's presenter (Codex audit, 2026-10-04). The guard belongs to the WRITE, not to the waiting.
   *
   * AND THE DEDUPE IS RELEASED WHEN THE TURN FAILS. `heldSpec` was recorded before the turn was
   * attempted, so a `turnTo` that threw left the hold recorded as applied: asking for the same hold
   * again — the ordinary thing a repaint does — returned early and the cube stayed where it was,
   * silently (same audit). A refusal puts the slate back so the next ask is a real one.
   *
   * A rejected promise is caught rather than `void`ed. `turnTo` settles its own promise when a later
   * turn supersedes it, which is normal and resolves `false`; what must not happen is a rejection
   * reaching nothing, which on the deferred path was an unhandled rejection with no screen told.
   *
   * THE CLEANUP BELONGS TO THE REQUEST, NOT TO THE VALUE. The first draft cleared the dedupe whenever
   * the failed hold matched the current one, which is not the same question: ask for A, then B, then A
   * again, and when the FIRST A's turn finally rejects it cleared the slate for the third A that had
   * already succeeded — so the next ask for A turned the cube a second time (verify pass, 2026-10-04).
   * Guarded on the generation, the same thing the turn itself is guarded on.
   */
  const turn = (h, spec, mine) => {
    if (mine !== asked || isStale()) return;
    const refused = (err) => {
      // Only if THIS request is still the current one: a superseded request's failure says nothing
      // about where the cube is now, and its own successor has already recorded that.
      if (mine === asked) heldSpec = null;
      console.warn(`hold-presenter: the cube could not be turned to ${spec}`, err);
    };
    try {
      const turning = cube.turnTo(h[0], h[1]);
      if (typeof turning?.catch === 'function') turning.catch(refused);
    } catch (err) {
      refused(err);
    }
  };
  return function holdCube(h) {
    const spec = holdSpec(h);
    if (spec === heldSpec) return;
    // A REPLACED SCREEN ASKS FOR NOTHING. Checked before `data-hold` as well as before the turn: the
    // element is parked and re-used, so both the stamp and the turn would land on the next screen's cube.
    if (isStale()) return;
    heldSpec = spec;
    const mine = ++asked;
    // What was ASKED for, recorded at once and whether or not the tag has upgraded yet — the renderer's
    // pose is private, and this is what a browser test and a person debugging read.
    cube.dataset.hold = spec;
    if (typeof cube.turnTo === 'function') { turn(h, spec, mine); return; }
    registry.whenDefined(tag).then(() => {
      if (typeof cube.turnTo === 'function') turn(h, spec, mine);
    });
  };
}
