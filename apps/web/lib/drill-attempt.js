// One drill attempt: a chosen algorithm, performed from wherever the cube already is.
//
// dev-docs/algorithm-drills-plan.md phase 1. ONE owner for the whole attempt — the cube's three
// report streams, the attempt's identity, the track, the clock and the teardown — because the app
// has exactly ONE `hooks.liveMove`, ONE `hooks.liveUpdate` and ONE `hooks.onTrustLost`, and
// following and timing both want them. Two objects sharing those slots is two attempts, one of
// which silently stops receiving anything.
//
// NO SETUP IS BUILT, and that is the whole shape of this module. What is drilled is the SEQUENCE,
// and a sequence can be performed from any arrangement, so the track is the chosen algorithm applied
// to the SCANNED state and the finish is wherever that lands — never solved. `invert(alg)` appears
// nowhere here; it belongs to the library's no-cube demonstration.
//
// THE FRAME CROSSING HAPPENS ONCE, AT THE DOOR. A catalogue string is written in the METHOD frame; a
// cube reports in its own. The script declares `start.hold` as the method frame and the format's own
// interpreter (ADR 0004: one interpreter, called before anything else) turns each held letter into
// an identity move — which is exactly `renameAlg(alg, METHOD_TO_SCAN)`, asserted in the tests both
// ways round. Feeding the raw letters without declaring the hold builds a track through arrangements
// the cube will never visit, so every turn reads as wrong. That failure is loud rather than subtle,
// which is the only good thing about it.
//
// **`off` IS NOT AN ACCUSATION.** `locate` answers a question about an ARRANGEMENT: is this one on
// the track. "The child turned the wrong face" is a different claim, and it only follows when the
// report stream is known to be intact. The session forwards moves without checking serial
// continuity and discovers a loss later, from a snapshot — so a cue wired straight to `off` accuses
// a child whose turn was correct and whose PREVIOUS report went missing. Continuity is therefore
// established BEFORE judgment, every move, and a gap produces tracking uncertainty instead.
//
// AND NUMBERING IS NOT TRUST, NOR CONTINUITY. `numbersMoves()` says a serial has been seen. On a
// cube that numbers nothing, a dropped turn and a wrong turn are the same observation, so no cue is
// ever raised there — the drill still runs and still completes, it just never accuses. `chainTrusted`
// is asked on every input, because `onCubeMove` forwards everything short of a REFUSED session and a
// freshly connected cube's stream is not evidence about anything.
import { SOLVED, applyAlg, invert, movesOf, toFacelets } from './cube-pieces.js';
import { locate, trackFor } from './script-track.js';
import { buildScript, stateFrom } from './script-view.js';
import { METHOD_FRAME, holdSpec, showMove } from './solving-hold.js';
import { createSolveTimer, serialsAhead } from './solve-timer.js';

/**
 * How many STAMPED reports a span needs. Two, because a span is a difference.
 *
 * Counted from what ARRIVED, never predicted from the algorithm's spelling. The first build
 * predicted it — one token meant no interval — and was wrong about the only entry it excluded:
 * `drop-in` is `F2`, one token, and a cube reports it as TWO quarter turns with two stamps, so a
 * span exists. Measuring the reports instead is both correct and reachable: a stream where only
 * one report carried a usable stamp lands here too (audit, 2026-09-27).
 */
export const MIN_TIMEABLE_REPORTS = 2;

/** Why a drill reports no time, in words the screen can use unchanged. */
export const TOO_SHORT = 'too short to time — a span needs two turns, and only one was timed';

/**
 * The other reason a drill reports no time, and it is the Timer screen's rule, not a new one.
 *
 * `solve-timer`'s two "moves were dropped" refusals both compare serials; with no serial they are
 * inert, and a span would be reported with nothing able to tell it a turn went missing. Three of
 * the brands this app speaks to are in that position. Asked at the SEED, which is the first instant
 * the answer is both needed and known — the same moment the Timer asks it.
 */
export const UNNUMBERED = 'this cube does not number its turns, so a drill on it is not timed';

/** The states an attempt can be in. `uncertain` is not a failure: it is the app saying it has lost
 *  track, which is a different thing from the child having gone wrong. */
export const ATTEMPT_STATES = Object.freeze(['waiting', 'ready', 'running', 'off', 'uncertain', 'done', 'ended']);

const SOLVED_FACELETS = toFacelets(SOLVED);

/**
 * One attempt at one algorithm.
 *
 * @param {object} o
 * @param {object} o.entry      a `lib/alg-catalogue.js` entry — the chosen algorithm
 * @param {() => boolean} o.chainTrusted  whether the live chain may be believed at all
 * @param {() => boolean} [o.numbersMoves] whether this cube numbers its turns
 * @param {boolean} [o.clock]   whether to time the attempt (`settings.drillClock`)
 * @param {(event) => void} [o.onEvent]   every state change, once each
 * @param {() => number} [o.now]  host clock, for the timer's staleness rule
 */
export function createDrillAttempt({
  entry, chainTrusted, numbersMoves = () => false, clock = false, onEvent = () => {}, now,
}) {
  if (!entry || !entry.alg) throw new Error('drill-attempt: needs a catalogue entry with an algorithm');

  let state = 'waiting';
  /** The arrangement the attempt was seeded from, and the one the clock arms on. */
  let from = null;
  /** Where the cube is, as facelets, rebuilt from the reports. Null until seeded. */
  let model = null;
  let track = null;
  let endState = null;
  /** Where on the track the cube is. */
  let at = 0;
  /** The last position the cube was CONFIRMED on, and the moves reported since — the two together
   *  are what makes a recovery computable rather than guessed. */
  let lastOn = 0;
  let since = [];
  let lastSerial = null;
  /** True while off the track, so the cue fires once per excursion rather than once per report. */
  let excursion = false;
  let disposed = false;
  let timer = null;

  /** Settled at the seed, because whether the cube numbers its turns is not known before one
   *  report has arrived — and is needed no earlier. */
  let timeable = clock;
  let timingRefusal = null;
  /** Reports carrying a usable hardware stamp. The span is a difference between two of them. */
  let stamped = 0;

  const emit = (event) => { if (!disposed) onEvent(Object.freeze({ ...event, state })); };

  const go = (next, event = {}) => { state = next; emit({ kind: next, ...event }); };

  /** Where the cube is on the track. Every progress-bearing event carries this, from whichever
   *  input produced it — a `running` emitted bare left the screen printing its own placeholders,
   *  because the sentence is "%1 of %2 turns." and there was no %1 (audit, 2026-09-27). */
  const progress = () => ({ at, of: track ? track.states.length - 1 : 0 });

  /**
   * The attempt is finished: stop the clock and publish the verdict.
   *
   * ONE completion for both paths. The move path reaches the end by reconstruction and the
   * snapshot path by being told, and when only one of them could finish, a cube that landed on the
   * final arrangement between reports stayed `running` for ever.
   *
   * The clock is stopped from the arrangement the reports add up to, which is a RECONSTRUCTION and
   * not an invented snapshot. The timer's own dropped-move refusal compares a snapshot's serial
   * with the last move's and would see nothing here; it does not need to, because this attempt has
   * already refused every gap MOVE BY MOVE, which is the stricter rule, and an attempt that lost
   * continuity never reaches this line.
   */
  const finish = (f = model, serial = lastSerial) => {
    timer?.facelets(f, serial);
    const result = timer?.result?.() ?? null;
    // EXACTLY ONE stamp is the case only this can name. At zero the timer's own "this cube did not
    // timestamp its moves" is true and more specific, so it keeps it; at one the timer would say
    // "the cube's clock reset mid-solve", which is false — nothing reset, there was simply nothing
    // to subtract from. At two or more, any refusal is the timer's own and is about the span.
    if (timeable && !result && stamped === MIN_TIMEABLE_REPORTS - 1) timingRefusal = TOO_SHORT;
    // `refusal` is a GETTER on the timer, not a method. Reading it as a call threw a TypeError on
    // exactly the path this feature is about — a drill that finished but could not be timed — and
    // no test caught it, because every case that HAD a refusal had no timer built, so the optional
    // chain short-circuited before reaching the mistake (audit, 2026-09-27).
    go('done', { time: result, refusal: result ? null : (timingRefusal ?? timer?.refusal ?? null) });
  };

  /** Tracking is no longer knowledge of the cube. Never says a turn was wrong. */
  const lose = (why) => {
    if (state === 'uncertain' || state === 'ended' || state === 'done') return;
    model = null;
    since = [];
    excursion = false;
    timer?.reset();
    go('uncertain', { why });
  };

  /** The attempt is over without a verdict — trust lapsed, or the screen moved on. */
  const end = (why) => {
    if (state === 'ended') return;
    timer?.reset();
    go('ended', { why });
  };

  /**
   * The moves that undo everything since the last confirmed position, CHECKED by replay.
   *
   * Not "the last turn reversed": a deviation can begin from a legitimate midpoint, and several
   * turns can pass before the child looks up. Null when the replay does not land back on the track,
   * which is the honest answer whenever the history is not complete — the screen then asks for the
   * cube rather than offering an instruction that would not work.
   */
  function recovery() {
    if (!since.length || model === null) return null;
    const undo = invert(since.join(' '));
    // CHECKED IN THE CUBE'S FRAME, SAID IN THE CHILD'S. The replay is about an arrangement, so it
    // runs on the scan-frame letters the cube reported; the sentence is about a face a child is
    // looking at, so it is renamed into the hold this stage is held in. Emitting the scan-frame
    // letters verbatim told a child holding Sune's `D B` grip to "undo it with F'" when the face
    // under their hand is B (audit, 2026-09-27) — the same frame confusion ADR 0003 exists to stop,
    // reappearing in a sentence rather than in a track.
    const back = toFacelets(applyAlg(stateFrom(model), undo));
    if (back !== track.states[lastOn]) return null;
    const hold = String(entry.hold).split(' ');
    return movesOf(undo).map((m) => showMove(m, hold)).join(' ');
  }

  return Object.freeze({
    get state() { return state; },
    get at() { return at; },
    get of() { return track ? track.states.length - 1 : 0; },
    get entry() { return entry; },
    /** Whether this attempt will report a time at all, and why not when it will not. */
    get timing() {
      return Object.freeze({ on: timeable, refusal: timeable ? null : timingRefusal });
    },

    /**
     * A snapshot: the seed, and thereafter the truth the model is corrected from.
     *
     * A snapshot is authoritative — it shares the moves' FIFO channel, so every one delivered is
     * current — which is why the model is replaced by it rather than reconciled with it.
     */
    facelets(f, serial) {
      if (disposed || state === 'done' || state === 'ended') return state;
      if (!chainTrusted()) { end('trust'); return state; }
      model = f;
      lastSerial = serial ?? lastSerial;
      if (from === null) {
        // The seed. Everything the attempt needs is now known: where the cube is, and which
        // algorithm. No setup has to be reached first, so this is the whole of readiness.
        from = f;
        const built = buildScript({
          schema: 2,
          start: { facelets: from, hold: holdSpec(METHOD_FRAME) },
          steps: [{ move: entry.alg }],
        });
        track = trackFor(built);
        endState = track.states[track.states.length - 1];
        at = 0;
        lastOn = 0;
        since = [];
        if (timeable && !numbersMoves()) { timeable = false; timingRefusal = UNNUMBERED; }
        if (timeable) {
          timer = createSolveTimer({ target: () => from, trusted: chainTrusted, finish: () => endState, ...(now ? { now } : {}) });
          timer.facelets(f, serial);
        }
        go('ready');
        return state;
      }
      // A real snapshot re-establishes where the cube is, which is also how an attempt comes back
      // from `uncertain` — the one thing that can answer "show me the cube again".
      const was = at;
      const found = locate(track, f, at);
      if (found.kind === 'off') {
        if (state !== 'uncertain') lose('snapshot-off-track');
        return state;
      }
      at = found.kind === 'step' ? found.idx : at;
      lastOn = at;
      since = [];
      // A snapshot that puts the cube back on the track ENDS the excursion. Left standing, its
      // undo instruction described a deviation the cube is no longer in (audit, 2026-09-27).
      const wasOff = excursion;
      excursion = false;
      if (model === endState && at === track.states.length - 1) { finish(f, serial); return state; }
      timer?.facelets(f, serial);
      // PUBLISHED WHENEVER THE POSITION MOVED, not only out of uncertainty or an excursion. A
      // snapshot that advanced the cube two steps while `running` told the screen nothing, so the
      // count stood still while the cube did not (audit verify, 2026-09-27).
      if (state === 'uncertain' || wasOff || at !== was) go(at === 0 ? 'ready' : 'running', progress());
      return state;
    },

    /** A turn the cube reported. */
    move(m) {
      if (disposed || state === 'done' || state === 'ended') return state;
      if (!chainTrusted()) { end('trust'); return state; }
      if (model === null || track === null) return state;   // never seeded, or tracking lost

      // CONTINUITY BEFORE JUDGMENT. Only a numbered cube can answer this at all; an unnumbered one
      // is tracked and never accused, which is the whole of the capability gate.
      if (numbersMoves()) {
        // A NUMBERING CUBE'S REPORT MUST CARRY ITS NUMBER. Without one there is nothing to place
        // it against, and the first build let it through whenever no baseline had been set yet —
        // which is every attempt the screen starts, because the seed carries no serial (audit
        // verify, 2026-09-27).
        if (!Number.isFinite(m.serial)) { lose('dropped-report'); return state; }
        const ahead = serialsAhead(lastSerial, m.serial);
        // UNKNOWN CONTINUITY IS NOT CONTINUITY. `serialsAhead` answers null for an unusable serial
        // AND for one that is behind — a stale or replayed report. The first build read that null
        // as "nothing to worry about" and went on to judge the turn, so a missing serial and a
        // backward one could both end in an accusation (audit, 2026-09-27: reproduced with a
        // missing serial, and with serial 8 arriving after seed serial 9). On a cube that numbers
        // its turns, a serial we cannot place is a reason to stop judging.
        if (lastSerial !== null && ahead !== 1) { lose('dropped-report'); return state; }
      }
      lastSerial = m.serial ?? lastSerial;

      model = toFacelets(applyAlg(stateFrom(model), m.notation));
      since.push(m.notation);
      // THE CLOCK SEES EVERY TURN THE CHILD MAKES, not only the ones that land on a whole track
      // position. Fed after the track match, a half turn arriving as two quarter-turn reports gave
      // the timer one move instead of two, and a deviation-then-recovery gave it none — so the
      // span and the move count described a performance nobody gave (audit, 2026-09-27). Continuity
      // has already been established above; that is the only precondition the timer needs.
      if (typeof m.cubeTimestamp === 'number' && Number.isFinite(m.cubeTimestamp)) stamped += 1;
      timer?.move(m);
      const found = locate(track, model, at);

      if (found.kind === 'off') {
        // Off the track. On a cube that cannot say whether a report went missing, this is not
        // reportable as a wrong turn — so it is not reported at all.
        if (!numbersMoves()) return state;
        // The SOUND fires once per excursion; the INSTRUCTION follows every turn of it. Frozen at
        // the first, it kept naming an undo that no longer reaches the track once a second wrong
        // turn had been made (audit, 2026-09-27).
        const first = !excursion;
        excursion = true;
        if (first) go('off', { recovery: recovery(), sound: true });
        else emit({ kind: 'off', recovery: recovery(), sound: false });
        return state;
      }
      if (found.kind === 'mid') {
        // Part way through a half turn, which is ON the track — so an excursion that has just
        // come back to one is over. Returning silently left the undo instruction standing over a
        // cube that no longer needed it (audit verify, 2026-09-27).
        if (excursion) { excursion = false; since = []; go('running', progress()); }
        return state;
      }

      at = found.idx;
      lastOn = at;
      since = [];
      excursion = false;

      if (model === endState && at === track.states.length - 1) { finish(); return state; }
      if (state !== 'running') go('running', progress());
      else emit({ kind: 'progress', ...progress() });
      return state;
    },

    /** Trust lapsed: the stream stops being evidence, so the attempt stops. */
    trustLost() { if (!disposed) end('trust'); return state; },

    /** A turn the connection knows was lost. Same answer as a serial gap, by a different route. */
    movesLost() { if (!disposed) lose('dropped-report'); return state; },

    /** Everything this attempt owns, released. Called by the screen on navigation and on a swap to
     *  another algorithm — after which no event can reach the caller, whatever arrives late. */
    dispose() { disposed = true; timer = null; },

    /** For the screen and the tests: what the child should be turning, and where. */
    get view() {
      return Object.freeze({
        shown: entry.shown, hold: entry.hold, at, of: track ? track.states.length - 1 : 0,
        solvedAtEnd: endState === SOLVED_FACELETS,
      });
    },
  });
}
