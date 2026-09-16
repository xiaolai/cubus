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
import { regripsOnly, viewAtPosition } from './script-view.js';
import { parse } from './cube-notation.js';
import { createAttributeWriter } from './element-writes.js';
import { locate, trackFor } from './script-track.js';

/**
 * Write views onto one element, and only what changed.
 *
 * `focus` and `highlight` repaint 108 materials when written, and `scramble` rebuilds the cube, so a
 * write that changes nothing is not free — the rule `lesson-player.js` learned the hard way, kept here.
 */
/** A segment's tokens, as the view carries them: `alg` is what the element was written. */
const segmentTokens = (view) => String(view.alg ?? '').split(' ').filter(Boolean);

export function createElementWriter(cube) {
  // The cache is `lib/element-writes.js`'s, shared with the episode runtime's player: the rule "write only
  // what changed" was written out in both, and they had drifted.
  const write = createAttributeWriter(cube);
  let segment = -1;
  let applied = -1;

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
  const transport = (moves, how, tokens = []) => {
    if (how === 'stop' && moves !== applied) {
      const stops = cube.stops;
      const after = stops.find((p) => p > applied);
      const before = [...stops].reverse().find((p) => p < applied);
      // The tokens this arrival crosses. A gap of one is the ordinary turn; a gap of regrips is the
      // element's group being stopped part way through, which is the only other way a script position
      // falls between the element's stops. Bounded by what it IS rather than by a count: a step of
      // `x y z` is three tokens and still nothing a child sees move (found by the verify pass, 2026-09-16).
      const crossed = tokens.slice(Math.min(applied, moves), Math.max(applied, moves));
      const walkable = crossed.length === 1 || regripsOnly(crossed);
      if (moves === after) cube.stepStop();
      else if (moves === before) cube.stepBackStop();
      // A SCRIPT POSITION NEED NOT BE ONE OF THE ELEMENT'S STOPS. The element groups the concatenated
      // sequence — `x R` is one group, because a regrip belongs to the turn it leads into — while a
      // script gives every STEP its own position, so a step that is only a regrip ends inside the
      // element's group. Its arrival was a jump, which snapped the very turn D4's "turn the whole cube
      // so the gap is in front" exists to show (Codex audit, 2026-09-16). One or two tokens are walked
      // instead, animated, in the direction of travel; anything further is a scrub and stays a jump.
      else if (walkable && moves > applied) for (let i = applied; i < moves; i += 1) cube.step();
      else if (walkable) for (let i = applied; i > moves; i -= 1) cube.stepBack();
      else cube.seek(moves);
    } else if (how === 'clock' && moves === applied + 1) {
      cube.step();
    } else if (how === 'halt' || moves !== applied || (how === 'jump' && cube.animating)) {
      // A HALT ALWAYS RE-SEATS. `animating` is false for the instant between two tokens of a group, and
      // the element keeps feeding the group from its own completion handler — so a halt that asked
      // whether a turn was in flight did nothing about a third of the time and the superseded walk
      // carried on turning (found by the verify pass over that fix, 2026-09-16). What a halt stops is
      // the GROUP, which is not visible in `animating` at all.
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
      transport(moves, cold ? 'jump' : how, segmentTokens(view));
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
  // Handed out rather than kept private: the player built a SECOND one for the same script — every
  // state converted to facelets and every midpoint generated twice, and two objects that must agree
  // about where the cube is (Codex audit, 2026-09-16).
  const writer = cube ? createElementWriter(cube) : null;
  const last = built.positions.length - 1;
  let position = 0;
  const go = (k, how) => {
    // A POSITION IS A WHOLE NUMBER. `viewAtPosition` rounds what it is asked for, so a fractional seek
    // stored 0.6 here and showed position 1 — the driver and the picture disagreeing about where the
    // child is (Codex audit, 2026-09-16). Rounded once, here, and a seek to something that is not a
    // number at all is refused rather than clamped into one.
    const to = Math.round(Number(k));
    if (!Number.isFinite(to)) throw new Error(`script-drive: ${JSON.stringify(k)} is not a position`);
    position = Math.max(0, Math.min(to, last));
    return writer ? writer.show(viewAtPosition(built, position), { how }) : viewAtPosition(built, position);
  };
  go(0, 'jump');
  return Object.freeze({
    get position() { return position; },
    get view() { return viewAtPosition(built, position); },
    get track() { return track; },
    next: () => go(position + 1, 'stop'),
    back: () => go(position - 1, 'stop'),
    seek: (k) => go(k, 'jump'),
    /**
     * Stop where this driver believes the cube is, and stay there.
     *
     * For a route being superseded: dropping the route stops the HOST's transitions, and left the
     * element playing the old walk's group — turning on screen, a whole walk behind, for as long as the
     * replacement took to find (Codex audit, 2026-09-16). Its own kind of arrival rather than a jump: a
     * jump re-seats only what is visibly animating, and a group between two of its tokens is not.
     */
    halt: () => go(position, 'halt'),
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
  // A step with no `at` starts when the step before it has FINISHED TURNING — not when it started.
  // Narration carries no time of its own and belongs with what it is said over, which is why an untimed
  // step inherits a time at all; but a step that TURNS the cube, inheriting the start of a step that was
  // also turning, was scheduled to turn at the same instant as it. Two untimed move steps played their
  // last and first tokens together (Codex audit, 2026-09-16, and the verify pass that followed it).
  const stepTimes = [];
  let last = 0;
  script.steps.forEach((step, i) => {
    const before = script.steps[i - 1];
    if (step.at === undefined && before?.move !== undefined) {
      const tokens = parse(before.move).length;
      last += before.secs ?? tokens * QUARTER_GAP;
    } else {
      last = step.at ?? last;
    }
    stepTimes.push(last);
  });
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
  // A TIMELINE THAT CONTRADICTS ITSELF IS REFUSED, not played as best it can be. Tokens are turned in
  // order, so a token timed before the one in front of it states two things at once: a step given four
  // seconds for two tokens is still turning when the next step's `at` arrives, and the clock then has a
  // position whose cues are in force over a cube those cues are not about. `checkScript` cannot see this —
  // the times come from `secs` and the default gap, which are this driver's arithmetic — so it is said
  // here, where the numbers are (Codex audit, 2026-09-16, and the verify pass that followed it).
  tokenTimes.forEach((times, s) => {
    const bad = times.findIndex((at, i) => i > 0 && at < times[i - 1]);
    if (bad > 0) {
      throw new Error(
        `script-drive: segment ${s} turns token ${bad} at ${times[bad]}s, before token ${bad - 1} at `
        + `${times[bad - 1]}s — a step's \`secs\` runs past the next step's \`at\`, and a cube is turned in order`,
      );
    }
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
    //
    // So what this returns is a STOP and how far into it the element has got — `cube`, `hold` and the
    // cues are the stop's, in force from the moment its first token starts, `moves` is what has actually
    // been played, and `settled` is the cube those moves have reached. They are meant to differ while a
    // group animates (Codex audit, 2026-09-16).
    // The PREFIX whose times have come: tokens are turned in order, so token j cannot have started while
    // token j-1 has not. Read this way rather than counted, so it says the same thing as the timeline's
    // own rule (`timelineOf` refuses a token timed before the one in front of it) instead of quietly
    // resting on it.
    const times = timeline.tokenTimes[view.segment];
    let moves = 0;
    while (moves < times.length && times[moves] <= t) moves += 1;
    if (writer) writer.show(view, { moves, how: jumped ? 'jump' : 'clock' });
    // `settled` is the cube AS IT STANDS, which mid-group is the stop before this one: the tokens
    // between two stops are regrips, and a regrip moves no piece. A reader drawing a net wants this
    // one; `cube` is the stop being animated toward, and drawing THAT beside `moves` is a picture of a
    // turn that has not happened yet (found by the verify pass, 2026-09-16 — it was being said in a
    // comment and is a value now, because a comment cannot be read by a consumer).
    const landed = built.positions.findLast((p) => p.segment === view.segment && p.moves <= moves);
    return Object.freeze({ ...view, moves, t, settled: landed?.cube ?? view.cube });
  };
  return Object.freeze({
    duration: timeline.duration,
    paint,
    seek: (t) => paint(t, { jumped: true }),
  });
}
