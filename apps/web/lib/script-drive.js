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
import { parse } from './cube-notation.js';
import { createAttributeWriter } from './element-writes.js';
import { locate, trackFor } from './script-track.js';

/**
 * Write views onto one element, and only what changed.
 *
 * `focus` and `highlight` repaint 108 materials when written, and `scramble` rebuilds the cube, so a
 * write that changes nothing is not free — the rule `lesson-player.js` learned the hard way, kept here.
 */
export function createElementWriter(cube, { owned = [] } = {}) {
  // The cache is `lib/element-writes.js`'s, shared with the episode runtime's player: the rule "write only
  // what changed" was written out in both, and they had drifted.
  const writeAny = createAttributeWriter(cube);
  /**
   * ATTRIBUTES THE HOST OWNS ARE NEVER WRITTEN (plan item 6.5, owner's decision 2026-09-17).
   *
   * A script says what it needs to say about the cube; it does not say everything about the element. The
   * cube screen lets a child tune the view — ghosts, the camera's angle, which way is up — and a writer
   * that puts `camera-latitude` back on every position would undo that on every press, which is the first
   * of the three reasons the screen could not become a driver consumer. Declared by the HOST rather than
   * guessed at here: which attributes a surface owns is a fact about that surface.
   */
  const ownedSet = new Set(owned);
  const write = (name, value, opts) => (ownedSet.has(name) ? undefined : writeAny(name, value, opts));
  let segment = -1;
  let applied = -1;
  // The hold this writer last put the cube in. Kept rather than read back off the element: the writer
  // already caches every attribute it writes, so asking the DOM would be a second source for a fact it
  // owns — and a host that owns `orientation` never has it written at all, which a read could not tell.
  let held = null;

  /** Load a segment: the hold, then the cube, then the sequence — each of which resets what follows it. */
  const load = (view, how) => {
    // A HOLD CHANGE IS A TUMBLE, NOT A CUT, when the child is walking (ADR 0003: the cube turns over in
    // front of them, and that turn is the thing being taught). Writing `orientation` STATES where the cube
    // is and arrives instantly, which is right for a seek — a scrub cannot animate through every hold it
    // passes — and wrong for the one step where the first layer is finished and the cube goes over.
    // `turnTo` animates between two NAMED orientations, which is exactly what a hold change is.
    const tumble = how === 'stop' && held !== null && view.orientation && view.orientation !== held
      && !ownedSet.has('orientation');
    if (tumble) {
      const [up, front] = String(view.orientation).split(/\s+/);
      cube.turnTo(up, front);
    } else if (held === null || how !== 'stop') {
      // A CUT STATES THE POSE; A STEP NEVER DOES. A tumble moves the cube through `turnTo` and
      // deliberately writes no attribute, so the writer's cache keeps whatever was written BEFORE it —
      // and the cache is what decides whether a write is skipped. Two failures came out of that, in
      // opposite directions, and both are why this branch is shaped the way it is:
      //
      //   · SKIPPED WHEN IT WAS NEEDED. Tumble to `D B`, then scrub back: the view's `U F` matched the
      //     cached `U F`, the write was skipped as unchanged, and the cube stayed upside down under a
      //     position that is the right way up (Codex audit, 2026-10-04). So a cut FORCES the write.
      //   · WRITTEN WHEN IT WAS NOT. `orientation` arrives instantly and cancels an animation in
      //     flight, so any write landing while a tumble is still running snaps the one turn ADR 0003
      //     exists to show. Forcing on every arrival did it, and so did leaving an unforced write in
      //     place: after a tumble the cache is stale, so `hold D B` then a `setup` step wrote
      //     `orientation="D B"` precisely because the cache still said `U F` (verify pass, same day).
      //
      // So a STOP writes nothing at all once the cube has a hold: it has either just tumbled, or it is
      // already where the view says. `held === null` is the opening load, where there is no hold to
      // tumble from and the cube has to start somewhere.
      write('orientation', view.orientation, { force: true });
    }
    // Recorded whichever way it was said, because the NEXT hold change is measured against it. The first
    // load is never a tumble: there is no hold to turn from, and the cube has to start somewhere.
    if (view.orientation) held = view.orientation;
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
      // so the gap is in front" exists to show (Codex audit, 2026-09-16).
      // `playTo` is the element's own answer to that (plan item 2.3's stops, extended 2026-09-16): it
      // walks to any token the way a group plays, one at a time, fed from each completion — which is
      // what the driver could not do from outside without queueing a batch the backlog rule would snap.
      // IT TAKES NO TOKEN LIST. An earlier draft walked one or two tokens by hand and was handed the
      // segment's tokens to do it; `playTo` made that unnecessary and the argument was left behind,
      // computed on every `show()` and discarded by a `void` (Codex audit, 2026-10-04). A parameter
      // nothing reads is a parameter the next reader will try to use.
      else cube.playTo(moves);
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
      if (cold) load(view, how);
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
/**
 * How `play` measures time, as a seam. `setTimeout` in a browser; a test hands in its own and runs a whole
 * walk without waiting for any of it — the same reason the element takes a `clock`.
 */
export const defaultSchedule = Object.assign((fn, ms) => setTimeout(fn, ms), { cancel: (t) => clearTimeout(t) });

export function createStopDriver(built, { cube = null, owned = [], schedule = defaultSchedule } = {}) {
  const track = trackFor(built);
  // Handed out rather than kept private: the player built a SECOND one for the same script — every
  // state converted to facelets and every midpoint generated twice, and two objects that must agree
  // about where the cube is (Codex audit, 2026-09-16).
  const writer = cube ? createElementWriter(cube, { owned }) : null;
  const last = built.positions.length - 1;
  let position = 0;
  let timer = null;
  /**
   * Which run of `play` is current. Bumped by every `stop()`, and checked by `tick` AFTER it has moved.
   *
   * `go()` writes the element, the element reports a step synchronously, and a host may `pause()` or
   * `halt()` from inside that report — after which `tick` went on to `timer = schedule(...)` and the
   * walk it had just been told to stop carried on playing, with `playing` back to true (Codex audit,
   * 2026-10-04). The same shape the element guards with `_era`: the press that started this tick is
   * about a walk that is no longer the one being played.
   */
  let run = 0;
  const stop = () => { run += 1; if (timer !== null) { schedule.cancel(timer); timer = null; } };
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
    next: () => { stop(); return go(position + 1, 'stop'); },
    back: () => { stop(); return go(position - 1, 'stop'); },
    seek: (k) => { stop(); return go(k, 'jump'); },
    /**
     * Stop where this driver believes the cube is, and stay there.
     *
     * For a route being superseded: dropping the route stops the HOST's transitions, and left the
     * element playing the old walk's group — turning on screen, a whole walk behind, for as long as the
     * replacement took to find (Codex audit, 2026-09-16). Its own kind of arrival rather than a jump: a
     * jump re-seats only what is visibly animating, and a group between two of its tokens is not.
     */
    halt: () => { stop(); return go(position, 'halt'); },
    /**
     * Position `k`'s CUES on the cube as it stands, without moving it -- how a step the child is asked to
     * make is described before they make it (ADR 0007: a `yours` step's arrow and highlight). The cube, the
     * segment and the transport stay where they are; only what the cues say changes. Selectors keep the
     * letters of the step that wrote them, and a positional one lights whatever occupies its place here.
     */
    describe: (k) => {
      stop();
      const view = Object.freeze({ ...viewAtPosition(built, position), cues: viewAtPosition(built, k).cues });
      return writer ? writer.show(view, { how: 'jump' }) : view;
    },
    /**
     * A cube the child turned, as 54 facelets: where it is on the walk.
     *
     * `{ kind: 'step', position }` moved the walk there; `{ kind: 'mid' }` is part way into a turn the
     * walk asked for and moves nothing; `{ kind: 'off' }` is not on the walk, and the host says so.
     */
    /**
     * WALK THE STOPS ON A CLOCK — the third thing the screen's transport offers and the driver did not
     * (plan item 6.5, owner's decision 2026-09-17).
     *
     * One stop at a time, each arriving the way a press arrives, so a hold change still tumbles and the
     * element still animates every token of the group. `every` is the gap BETWEEN stops, and the next is
     * scheduled once the last has been asked for rather than on a fixed cadence: a stop four tokens long
     * takes longer to walk than a single turn, and a metronome would start the next over the top of it.
     *
     * `repeat` wraps at the end rather than stopping there. Without it the walk ends, which is what a
     * lesson wants; with it a drill loops until something stops it.
     */
    play({ every = 900, repeat = false } = {}) {
      stop();
      const mine = run;
      const tick = () => {
        if (mine !== run) return;
        if (position < last) go(position + 1, 'stop');
        else if (repeat) go(0, 'jump');
        else { timer = null; return; }
        // CHECKED AFTER THE MOVE, not only before it. `go` writes the element, which reports
        // synchronously, and a host listener may stop this playback from inside that report.
        if (mine !== run) return;
        timer = schedule(tick, every);
      };
      timer = schedule(tick, every);
      return this;
    },

    /** Stop the clock. What the element is mid-way through still lands; a paused cube is a settled one. */
    pause() { stop(); return this; },

    get playing() { return timer !== null; },

    observe(facelets) {
      const loc = locate(track, facelets, position);
      // A CUBE IN A HAND OUTRANKS THE CLOCK. Turning it is a person taking over, and a walk still playing
      // underneath them would race the hands it is meant to be following.
      if (loc.kind === 'step' && loc.idx !== position) stop();
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
  // WHAT THIS CHECK STILL DOES NOT COVER, written down because it was attempted and withdrawn.
  //
  // The rule above is per SEGMENT, and a hold change or a `setup` opens a new one — so two timings that
  // contradict each other across a segment boundary are both accepted. Two costs, measured:
  //
  //   · A SHADOWED POSITION. `createClockDriver.paint` takes the LAST position whose time has come, so a
  //     position timed behind the one in front of it can never be landed on at any `t`, and whatever it
  //     says is never shown. `[{move:'R U',at:0,secs:8},{hold:'D B',at:1},{move:'F',at:2}]` is accepted
  //     and the position at 4s is the unreachable one.
  //   · A TURN CUT AWAY. `[{move:'y x R',at:0,secs:6},{hold:'D B',at:1},{move:'U',at:2}]` is accepted
  //     with token times [0, 2, 4]: at 1s the new segment loads a cube that already contains the R
  //     scheduled for 4s, so the turn being taught is skipped and the state jumps early.
  //
  // A guard on `positionTimes` monotonicity was written for the first of those and REVERTED (verify
  // pass, 2026-10-04): it also refuses `[{move:'R U',at:0,secs:8},{setup:'F',at:1},{move:'L',at:2}]`,
  // which is a deliberate cut to a new cube that `checkLesson` permits — a cut is ALLOWED to discard the
  // turns the segment before it had pending. Telling a contradiction from a cut needs the distinction
  // between a step's token spacing, the renderer's animation duration, and an intentional jump, and it
  // has to be checked against the real course (ADR 0006 keeps that out of this repository, and this
  // build reports NO COURSE INSTALLED). A validator that falsely refuses an authored lesson is worse
  // than one that lets a mistimed one through, so this stays stated rather than half-enforced.
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
