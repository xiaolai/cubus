// Driving `<cubus-cube>` from a script: the element half every driver shares, and two of the drivers.
//
// dev-docs/tutorial-capability-plan.md item 3.3; ADR 0005 decision 3; ADR 0004 R2, R3, R7. A script says
// what the cube is at every POSITION (`lib/script-view.js`). A driver decides which position it is:
//
//   the CLOCK driver   from a time — a narrated lesson, where the audio is the clock
//   the STOP driver    from a button or from a cube the child turned — a walk
//   (the EVENT driver, a drill round, is plan item 3.4)
//
// and all of them hand the view to ONE writer, so "what the element is told" cannot differ by driver.
//
// THE WRITER TOUCHES ONLY THE MANIFEST (ADR 0005 decision 4): attributes, `step`/`stepBack`/`stepStop`/
// `stepBackStop`/`seek`, and the `animating` and `stops` properties. The browser suite runs both drivers
// against a proxy that throws on anything else.
import { CAM_DEFAULT, GHOST_ELEV, QUARTER_GAP } from './lesson-schedule.js';
import { viewAtPosition } from './script-view.js';
import { locate, trackFor } from './script-track.js';

/** How many tokens a stop arrival will walk one at a time when it does not land on one of the
 *  element's own stops. Two, because the element snaps the oldest turn the moment a third is
 *  queued — past that a walk is a jump wearing an animation. */
const WALK_TOKENS = 2;

/**
 * Write views onto one element, and only what changed.
 *
 * `focus` and `highlight` repaint 108 materials when written, and `scramble` rebuilds the cube, so a
 * write that changes nothing is not free — the rule `lesson-player.js` learned the hard way, kept here.
 */
export function createElementWriter(cube) {
  const written = new Map();
  let segment = -1;
  let applied = -1;

  const write = (name, value, { force = false } = {}) => {
    if (!force && written.has(name) && written.get(name) === value) return;
    written.set(name, value);
    if (value === null) cube.removeAttribute(name);
    else cube.setAttribute(name, String(value));
  };

  /** Load a segment: the hold, then the cube, then the sequence — each of which resets what follows it. */
  const load = (view) => {
    write('orientation', view.orientation);
    // FORCED: two segments can load the same stickers with different sequences, and the element only
    // rebuilds its cube when the attribute is written. Skipping an "unchanged" scramble left the cube
    // wherever the last segment's moves had put it.
    if (view.facelets !== null) {
      write('scramble', null);
      write('facelets', view.facelets, { force: true });
    } else {
      write('facelets', null);
      write('scramble', view.scramble ?? '', { force: true });
    }
    write('alg', view.alg, { force: true });
    segment = view.segment;
    applied = 0;
  };

  /**
   * Put the transport at `moves` tokens into the segment.
   *
   * `how` says what kind of arrival it is. `stop`: one stop along or back, animated as a group
   * (`stepStop`, so a regrip is never snapped by the backlog rule — R4). `clock`: exactly one token
   * behind the schedule, animated; anything further is a jump. `jump`: land there, no animation — and
   * re-seat even when the count is unchanged if a turn is still in flight, or the element finishes a
   * turn the listener has scrubbed away from.
   */
  const transport = (moves, how) => {
    if (how === 'stop' && moves !== applied) {
      const stops = cube.stops;
      const after = stops.find((p) => p > applied);
      const before = [...stops].reverse().find((p) => p < applied);
      if (moves === after) cube.stepStop();
      else if (moves === before) cube.stepBackStop();
      // A SCRIPT POSITION NEED NOT BE ONE OF THE ELEMENT'S STOPS. The element groups the concatenated
      // sequence — `x R` is one group, because a regrip belongs to the turn it leads into — while a
      // script gives every STEP its own position, so a step that is only a regrip ends inside the
      // element's group. Its arrival was a jump, which snapped the very turn D4's "turn the whole cube
      // so the gap is in front" exists to show (Codex audit, 2026-09-16). One or two tokens are walked
      // instead, animated, in the direction of travel; anything further is a scrub and stays a jump.
      else if (moves > applied && moves - applied <= WALK_TOKENS) for (let i = applied; i < moves; i += 1) cube.step();
      else if (moves < applied && applied - moves <= WALK_TOKENS) for (let i = applied; i > moves; i -= 1) cube.stepBack();
      else cube.seek(moves);
    } else if (how === 'clock' && moves === applied + 1) {
      cube.step();
    } else if (moves !== applied || (how === 'jump' && cube.animating)) {
      cube.seek(moves);
    }
    applied = moves;
  };

  return Object.freeze({
    /** Show `view` with `moves` tokens of its segment applied, arriving `how`. */
    show(view, { moves = view.moves, how = 'jump' } = {}) {
      // Asked BEFORE loading, because loading changes the answer: a segment just loaded is a cold landing,
      // and its transport is a jump whatever kind of arrival the driver meant.
      const cold = view.segment !== segment;
      if (cold) load(view);
      transport(moves, cold ? 'jump' : how);
      const { cues } = view;
      write('highlight', cues.hl ?? 'none');
      write('focus', cues.focus ?? null);
      write('ghosts', cues.ghosts ? 'floating' : 'none');
      if (cues.ghosts) write('ghost-elevation', cues.ghostElevation ?? GHOST_ELEV);
      const [lat, lon] = Array.isArray(cues.cam) ? cues.cam : CAM_DEFAULT;
      write('camera-latitude', lat);
      write('camera-longitude', lon);
      write('camera-up', cues.camUp ?? 'U');
      write('arrow', cues.arrow ?? 'none');
      write('labels', cues.labels ?? 'none');
      write('trail', cues.trail ?? 'none');
      return view;
    },
  });
}

/**
 * A walk: moved by stops, from buttons or from the cube in the child's hands.
 *
 * The host keeps the smart cube's plumbing and its trust; this takes an arrangement it has decided to
 * believe and answers where on the walk that is, or that it is not on the walk at all.
 */
export function createStopDriver(built, { cube = null } = {}) {
  const track = trackFor(built);
  const writer = cube ? createElementWriter(cube) : null;
  const last = built.positions.length - 1;
  let position = 0;
  const go = (k, how) => {
    position = Math.max(0, Math.min(k, last));
    return writer ? writer.show(viewAtPosition(built, position), { how }) : viewAtPosition(built, position);
  };
  go(0, 'jump');
  return Object.freeze({
    get position() { return position; },
    get view() { return viewAtPosition(built, position); },
    next: () => go(position + 1, 'stop'),
    back: () => go(position - 1, 'stop'),
    seek: (k) => go(k, 'jump'),
    /**
     * Stop where this driver believes the cube is, and stay there.
     *
     * For a route being superseded: dropping the route stops the HOST's transitions, and left the
     * element playing the old walk's group — turning on screen, a whole walk behind, for as long as the
     * replacement took to find (Codex audit, 2026-09-16). A jump to the position already reached re-seats
     * a turn in flight, which is the one thing `how: 'jump'` does even when the count has not changed.
     */
    halt: () => go(position, 'jump'),
    /**
     * A cube the child turned, as 54 facelets: where it is on the walk.
     *
     * `{ kind: 'step', position }` moved the walk there; `{ kind: 'mid' }` is part way into a turn the
     * walk asked for and moves nothing; `{ kind: 'off' }` is not on the walk, and the host says so.
     */
    observe(facelets) {
      const loc = locate(track, facelets, position);
      if (loc.kind === 'step' && loc.idx !== position) go(loc.idx, Math.abs(loc.idx - position) === 1 ? 'stop' : 'jump');
      return Object.freeze({ kind: loc.kind, position });
    },
  });
}

/**
 * When everything in a script happens, for a script played against a clock.
 *
 * A step is at its `at`, or at the step before it when it has none — narration that carries no time
 * of its own belongs with what it is said over. A move step's tokens start `secs / n` apart, or
 * `QUARTER_GAP` apart when the step does not say, exactly as an episode's turns do.
 */
export function timelineOf(built) {
  const { positions, segments, script } = built;
  const stepTimes = [];
  let last = 0;
  for (const step of script.steps) { last = step.at ?? last; stepTimes.push(last); }
  const tokenTimes = segments.map(() => []);
  // Tokens applied before position `i`, within its segment. A move never opens a segment, so the position
  // before a move step's first stop is always in the same one.
  const tokensBefore = (i) => (i > 0 && positions[i - 1].segment === positions[i].segment ? positions[i - 1].moves : 0);
  const positionTimes = positions.map((p, k) => {
    if (p.step < 0) return -Infinity;
    const step = script.steps[p.step];
    if (step.move === undefined) return stepTimes[p.step];
    const first = positions.findIndex((q) => q.step === p.step);
    const stepFrom = tokensBefore(first);
    const stepTokens = positions.findLast((q) => q.step === p.step).moves - stepFrom;
    const gap = step.secs ? step.secs / stepTokens : QUARTER_GAP;
    const from = tokensBefore(k);
    for (let j = from; j < p.moves; j++) tokenTimes[p.segment][j] = stepTimes[p.step] + (j - stepFrom) * gap;
    // A stop is reached when its first token starts: its cues are in force while it animates.
    return tokenTimes[p.segment][from];
  });
  const ends = tokenTimes.flatMap((times, s) => times.map((at) => at + QUARTER_GAP)).concat(stepTimes);
  return Object.freeze({ positionTimes, tokenTimes, duration: Math.max(0, ...ends) + 0.6 });
}

/** A script played against a clock: the audio, a scrubber, a test. Nothing in here owns one. */
export function createClockDriver(built, { cube = null } = {}) {
  const timeline = timelineOf(built);
  const writer = cube ? createElementWriter(cube) : null;
  const paint = (t, { jumped = false } = {}) => {
    let k = 0;
    timeline.positionTimes.forEach((at, i) => { if (at <= t) k = i; });
    const view = viewAtPosition(built, k);
    // The tokens STARTED by `t`, which is what the element should be animating toward: a trailing
    // regrip turns when its time comes, never when its segment loads (ADR 0004 R7).
    // The PREFIX whose times have come, not a count of them: tokens are played in order, so token j
    // cannot have started while token j-1 has not. Counting matching times instead answered a script
    // whose steps overlap — `{move:'R U', at:1, secs:4}` then `{move:'F', at:2}`, times [1, 3, 2] — with
    // two tokens at t=2.1, applying `U` a second before its own time (Codex audit, 2026-09-16).
    const times = timeline.tokenTimes[view.segment];
    let moves = 0;
    while (moves < times.length && times[moves] <= t) moves += 1;
    if (writer) writer.show(view, { moves, how: jumped ? 'jump' : 'clock' });
    return Object.freeze({ ...view, moves, t });
  };
  return Object.freeze({
    duration: timeline.duration,
    paint,
    seek: (t) => paint(t, { jumped: true }),
  });
}
