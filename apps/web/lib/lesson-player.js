// Write a view onto a `<cubus-cube>`. The thin half; `lesson-schedule.js` is where the thinking is.
//
// Everything here is "has this changed since the last frame, and if so write it". That is not
// micro-optimisation: `focus` and `highlight` repaint 108 materials when written, and writing them
// every frame at 60Hz would burn the budget the turn animation needs. The rule is one-way — this
// module reads the element only to compare against what it last wrote, never to decide anything.
// A view is the truth; the element is where it is displayed.

import { viewAt } from './lesson-schedule.js';
import { bindSelectors } from './script-view.js';
import { SOLVED, applyAlg } from './cube-pieces.js';

/**
 * A turn is ANIMATED only when the cube is exactly one behind the schedule. Two or more means the
 * player has fallen behind or the listener has jumped, and animating the backlog would run the
 * cube through a sequence nobody is watching while the narration talks about something else.
 */
const ONE_BEHIND = 1;

/**
 * Drive `cube` from `schedule`.
 *
 * Nothing in here owns a clock. The caller supplies `t` — from an audio element, from a scrubber,
 * from a test — which is what makes playing, seeking and paused inspection the same code path.
 */
export function createLessonPlayer(cube, schedule, { reducedMotion = () => false } = {}) {
  // What was last WRITTEN, keyed by ATTRIBUTE NAME — not the view object. Comparing against the
  // view's own keys (`ghostElevation`, `camera`) never matched the attribute names being written,
  // so every attribute was rewritten on every frame and the change detection did nothing at all.
  // Not read back off the element either: the element moves on by itself as an animation completes,
  // and comparing against it would rewrite everything every frame for a different reason.
  const written = new Map();
  let shown = null;
  let warned = false;
  let segment = -1;
  let applied = -1;

  /** Write an attribute only if its value has changed since this player last wrote it. */
  const write = (name, value) => {
    if (written.has(name) && written.get(name) === value) return;
    written.set(name, value);
    if (value === null) cube.removeAttribute(name);
    else cube.setAttribute(name, String(value));
  };

  /**
   * Put the cube's TRANSPORT where the view says: the right position, the right number of turns.
   *
   * Split out of `paint` because it is the only part with state of its own — which segment is
   * loaded, how many turns have landed — and mixing that with a dozen attribute writes made both
   * harder to read than either is alone.
   */
  const transport = (view, jumped) => {
    if (view.segment !== segment) {
      // A new position: hand the renderer the scramble and the whole sequence at once, then place
      // the cursor. Never replay the moves in between — that is the jump cut a segment exists for.
      segment = view.segment;
      applied = -1;
      // Straight through `write`, so a repaint of an unchanged time touches nothing at all — and
      // `scramble` in particular costs a full rebuild and repaint of the cube.
      write('scramble', view.scramble);
      write('alg', view.alg);
    }

    // A JUMP re-seats the cursor even when the count has not changed. Seeking into the middle of an
    // animation left the renderer mid-turn — the count was the same either side of the jump, so
    // nothing told the cube to stop, and it went on finishing a turn the listener had scrubbed away
    // from.
    if (view.moves !== applied || (jumped && cube.animating)) {
      const stepping = !jumped && applied >= 0 && view.moves - applied === ONE_BEHIND;
      if (stepping) {
        const m = schedule.segments[segment].moves[view.moves - 1];
        // Aim each turn at 85% of its interval. The renderer snaps the oldest move to completion
        // the instant a THIRD is pending, so an animation must always finish before the next is
        // fed. A HALF turn costs twice as long — the renderer computes `(190 / tempo) * turns` —
        // so the tempo is scaled by the same factor and a `2` inside a 180ms slot stops running
        // 306ms and stretching the sequence by 9%.
        const turns = m.q.endsWith('2') ? 2 : 1;
        cube.setAttribute('tempo-scale', ((190 * turns) / (m.step * 1000 * 0.85)).toFixed(3));
        cube.step();
      } else {
        cube.seek(view.moves);
      }
      applied = view.moves;
    }
  };

  /**
   * A view's `focus` as the pieces it names AT THE CUE THAT WROTE IT.
   *
   * The cube at that moment is the segment's scramble plus the turns whose time had come, which is
   * exactly what `viewAt` answers for that time — so the episode's own schedule says where to look and
   * nothing here models the lesson a second way. An episode whose setup or turns the piece model cannot
   * apply (a whole-cube turn, which this runtime has never modelled) keeps the selector as written: it
   * is what the element has always been given, and inventing a piece for it would be worse.
   */
  const boundAt = (view) => {
    const spec = view.focus;
    if (!spec || spec === 'none' || !/(layer|slot):/i.test(spec)) return spec;
    const cue = schedule.cues[view.line];
    try {
      const at = viewAt(schedule, cue.start, { reducedMotion: true });
      const played = at.alg.split(' ').filter(Boolean).slice(0, at.moves).join(' ');
      return bindSelectors(spec, applyAlg(applyAlg(SOLVED, at.scramble), played));
    } catch (err) {
      if (!warned) { warned = true; console.warn('lesson-player: focus left unbound — this episode is not one the piece model can play', err); }
      return spec;
    }
  };

  /** Put the cube where the schedule says it should be at `t`. */
  const paint = (t, { jumped = false } = {}) => {
    const view = viewAt(schedule, t, { reducedMotion: reducedMotion() });
    transport(view, jumped);

    write('highlight', view.highlight);
    // FOCUS IS BOUND WHERE THE CUE IS, not where the listener happens to be. The element binds a
    // positional selector when it is written and keeps those pieces through a seek (ADR 0004 decision
    // 10) — which is right, and leaves the WRITER holding the other half: on a cold seek this is written
    // after the jump, so `focus: 'slot:UR'` on a line before an R turn lit whatever had arrived at UR
    // rather than the piece the child was shown (Codex audit, 2026-09-16). Resolved here against the
    // cube at the cue's own time, through the same binder the script runtime uses, so a lesson lights
    // the same pieces whether it was played or scrubbed into.
    write('focus', boundAt(view));
    write('ghosts', view.ghosts ? 'floating' : 'none');
    // Elevation 0 sits a ghost exactly ON its sticker, so animating 0 → 9 IS the fly-out and no
    // tween rig is needed. Written only while ghosts are on, so the value a hidden layer happens
    // to hold cannot pop when it comes back.
    if (view.ghosts) write('ghost-elevation', view.ghostElevation);
    write('camera-latitude', view.camera.lat);
    write('camera-longitude', view.camera.lon);
    // BOTH channels, every time. Writing only the one the cue carries left the other holding a
    // stale value — an orientation cue after a rolled one kept the old `camera-up`, and an ordinary
    // cue after an orientation one kept the old orientation. The picture then depended on which
    // cues had been visited, which is exactly the history-dependence `viewAt` exists to remove.
    //
    // The grip, when an episode carries one, is the CUBE turning, and the observer's roll goes back
    // to its own job. An episode written the old way (a `camUp` and no orientation) still plays:
    // the two channels are independent by design, so writing both is meaningful, not a conflict.
    write('orientation', view.camera.orientation ?? 'U F');
    write('camera-up', view.camera.orientation ? 'U' : view.camera.up);

    shown = view;
    return view;
  };

  return {
    paint,
    /** Jump to `t`: the same picture, reached without animating anything in between. */
    seek: (t) => paint(t, { jumped: true }),
    /** What was last painted — for a transcript, a caption or a progress bar. */
    get view() { return shown; },
    schedule,
  };
}
