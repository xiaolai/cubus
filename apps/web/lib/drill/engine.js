// The drill engine: one algorithm, executed over and over on a cube in a hand, from whatever state it is in.
//
// dev-docs/algorithm-drill-v2-plan.md §3 (work items WI-5 to WI-8). A module with NO screen: no DOM, no
// globals, no clock of its own. The caller injects `now`, a timer pair and a `sound(name)` callback, feeds
// it the smart cube's reports, and hears back through `onEvent`.
//
// WHAT IT ASSUMES, and nothing more: an unbroken stream of reports, each ONE outer-face quarter turn in the
// CUBE's own frame (`lib/cube-session.js`). It never trusts the cube's colours and never needs a scan: the
// rep is tracked RELATIVE to the arrangement the cube reported when it began (§3.1), so the only thing that
// can break it is a lost turn.
//
// THE HOLD IS INFERRED (§3.2). A cube cannot say how it is held, so all 24 holds are candidates, each with
// its own track (`lib/drill/candidates.js`), and a reported turn removes every candidate that does not
// accept it. The first turn's DIRECTION is already checkable — clockwise is intrinsic to a face — and turns
// on a second axis settle the hold, unless every turn of the algorithm reads alike in more than one hold: a
// half turn or a slice names an axis and not a side, so H perm (`M2 U M2 U2 M2 U M2`) keeps [U, F] and [U, B]
// to its end, and an algorithm on one axis keeps four holds (F2) or eight (M2). Such an algorithm's turns are
// judged all the same; only its hold stays unknown, and a rep leaves exactly the holds that read it alike. A
// turn NO candidate accepts is off the plan whether or not the hold is settled. Limits a cube cannot lift:
// the first turn's FACE is never wrong (any face is `R` in some hold), and before the hold settles a wrong
// turn that some other hold would accept is read as that hold — nothing in the reports could tell the two
// apart.
//
// TRACKING IS NEAR-ONLY (§3.3): within two turns of where the cube is (`locate(…, { near: true })`), a run of
// regrips counting as one place because no report could move the cube along it.
// The walk's last-resort "anywhere on the track, first index" would place a cube in a repeated sequence
// (`R U R' U' R U R' U'`) at the FIRST occurrence of an arrangement it reaches at the second.
//
// STATES — one rep at a time, each with its own `attempt` number:
//
//   idle       nothing armed (before `start`, after `stop`)
//   armed      armed from an arrangement; no turn of the algorithm yet
//   running    at least one turn of the algorithm matched
//   off        no candidate accepts the arrangement, and the cue window has passed (`off` sounded once)
//   uncertain  a turn was LOST (a serial jump, or the app's `gap()`): the reports are not the turns made, so
//              nothing is judged and nothing is sounded until the stream is whole again (`resync`) or the
//              rep starts over
//   done       the last position was reached (`done` sounded); the next rep is armed at once from the
//              arrangement the cube is now in, so `done` is only ever seen in an event
//
// THE FIRST DRILL'S DEFECTS, and what stands against each here (dev-docs/algorithm-drills-plan.md):
//   one procedure printed, another judged — the track is built from the same token list the caller prints,
//                                           read by the one interpreter; the tests feed the reports a cube
//                                           would make for every hold and assert the rep completes
//   a dropped turn as a false accusation  — a serial jump is `uncertain`, never `off`; and on a cube that
//                                           does not number its turns an `off` says so (`about: 'cube'`),
//                                           so a screen words it about the cube, never the child
//   one attempt's reports in the next      — every timer carries its attempt and its excursion and does
//                                           nothing when either has moved on; every event names its attempt
//   the biased timer                       — `lib/drill/timing.js`: first turn to last turn, nothing estimated
import { applyMove, toFacelets } from '../cube-pieces.js';
import { parse } from '../cube-notation.js';
import { locate, wayBack as wayBackOn } from '../script-track.js';
import { stateFrom } from '../script-view.js';
import { candidatesFrom, faceQuartersAt, heldLetters, htmOf, plansFor, whole } from './candidates.js';
import { timeRep } from './timing.js';

/**
 * How long a turn no candidate accepts may stand before `off` plays — long enough for a slice's second face,
 * a half turn's second quarter, or the second of two commuting turns made in the other order, to arrive.
 *
 * MEASURED 2026-10-17 on one cube that numbers its turns (a GAN 16 ui, the owner's hands; WI-14 of
 * dev-docs/algorithm-drill-v2-plan.md): over 75 slices the two faces arrived a median 8 ms and at worst 41 ms
 * apart on the cube's clock, so 300 ms — Cubedex's value, kept — clears the worst seven times over and still
 * answers within a beginner's turn (the same session's Sunes left 319 ms or more between distinct turns).
 * test/drill-hardware-replay.test.mjs holds the relation to the recording: the window must be at least twice
 * the worst recorded slice. A cube that does not number its turns is not measured yet.
 */
export const CUE_WINDOW_MS = 300;

/**
 * The longest four identical quarter turns of one face may take, first report to fourth, to count as the
 * "start over" gesture (csTimer's and briefcubing's convention).
 *
 * MEASURED 2026-10-17 in the same session: every run of four identical turns made "quickly" took a median
 * 741 ms and at worst 1453 ms, first report to fourth, so 2000 ms holds them all;
 * test/drill-hardware-replay.test.mjs fails if the limit stops covering the recording.
 */
export const GESTURE_MS = 2000;

/** How many identical quarter turns in a row make the gesture. Four of one face change nothing. */
export const GESTURE_TURNS = 4;

/** The engine's states. */
export const STATUS = Object.freeze({
  IDLE: 'idle', ARMED: 'armed', RUNNING: 'running', OFF: 'off', UNCERTAIN: 'uncertain', DONE: 'done',
});

/** What a cube reports: one outer-face quarter turn, never a half turn and never a slice. */
const QUARTER = /^[URFDLB]'?$/;

/** Every order a cube may report one transition's face turns in: a slice's faces either way, a half turn either way. */
function reportOrders(names) {
  const orders = names.length === 2 ? [names, [names[1], names[0]]] : [names];
  return orders.flatMap((order) => order.reduce((acc, name) => {
    const ways = name.endsWith('2') ? [[name[0], name[0]], [`${name[0]}'`, `${name[0]}'`]] : [[name]];
    return acc.flatMap((a) => ways.map((w) => [...a, ...w]));
  }, [[]]));
}

/**
 * The longest run of quarter turn `q` a plan's reports can end with (`atEnd`) or start with — Infinity when the
 * whole algorithm can be reported as `q` alone, so that reps back to back run on without end (`R`, `F2`).
 */
function runOf(plan, q, atEnd) {
  const turns = plan.faces.filter((names) => names.length);
  let n = 0;
  for (const names of atEnd ? [...turns].reverse() : turns) {
    const orders = reportOrders(names).map((o) => (atEnd ? [...o].reverse() : o));
    const whole = orders.find((o) => o.every((x) => x === q));
    if (whole) { n += whole.length; continue; }
    return n + Math.max(...orders.map((o) => { let k = 0; while (k < o.length && o[k] === q) k += 1; return k; }));
  }
  return Infinity;
}

/**
 * Whether the gesture may run on across the end of a rep into the next one: only when two CORRECT reps back to
 * back can never report four identical quarter turns between them — in any holds, whichever order a slice's faces
 * and whichever way a half turn's quarters come. Otherwise drilling R2, or an algorithm that ends and starts on half
 * turns of one face, would start itself over.
 */
function gestureCarries(plans) {
  return !['U', 'R', 'F', 'D', 'L', 'B'].flatMap((f) => [f, `${f}'`]).some((q) => {
    const ends = Math.max(...plans.map((p) => runOf(p, q, true)));
    const starts = Math.max(...plans.map((p) => runOf(p, q, false)));
    return ends + starts >= GESTURE_TURNS;
  });
}

/** From position `k`, through the regrips that follow it — a rotation is never reported, so it is passed. */
function passRegrips(track, k) {
  let at = k;
  while (at + 1 < track.states.length && !track.observable[at + 1] && track.states[at + 1] === track.states[at]) at++;
  return at;
}

/**
 * A drill engine for one algorithm.
 *
 * @param {object} o
 * @param {string} o.alg        the algorithm, as the page prints it — the SAME text, so what is shown is what
 *                              is judged
 * @param {Array<{from:number,to:number}>} [o.chunks]  token index ranges `[from, to)` to time as splits
 * @param {[string,string]|null} [o.fixedHold]  judge in this hold only, `[up, front]`
 * @param {boolean} [o.numbersMoves]  the session's `numbersMoves()`: whether a lost turn shows at once
 * @param {(fn: Function, ms: number) => unknown} o.setTimer
 * @param {(handle: unknown) => void} o.clearTimer
 * @param {() => number} o.now  the host clock the reports' `timestamp` is on
 * @param {(name: 'off'|'capture'|'done') => void} [o.sound]
 * @param {(event: object) => void} [o.onEvent]
 */
export function createDrillEngine({
  alg, chunks = [], fixedHold = null, numbersMoves = false,
  setTimer, clearTimer, now, sound = () => {}, onEvent = () => {},
}) {
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function' || typeof now !== 'function') {
    throw new Error('drill: setTimer, clearTimer and now are injected, never assumed');
  }
  const moves = parse(alg);
  const htm = htmOf(moves);
  if (htm === 0) throw new Error(`drill: "${alg}" turns no face, so no cube could report it`);
  const plans = plansFor(moves, { fixedHold });
  // How far an armed candidate's track must reach before its first turn: the two TURNS `locate` looks ahead
  // — past any rotations before or between them, which no report moves the cube along — and one spare. Which
  // transitions turn a face is the same in every hold, so one plan answers for all of them.
  const turning = plans[0].faces.flatMap((names, k) => (names.length ? [k] : []));
  const prefix = (turning[1] ?? turning[0]) + 2;
  // How many reports a clean rep makes: a half turn is two quarters, whichever way they go.
  const quarters = plans[0].faces.flat().reduce((n, name) => n + (name.endsWith('2') ? 2 : 1), 0);
  // Whether the start-over gesture's turns carry across the end of a rep (`arm`, `gestureCarries`).
  const carriesGesture = gestureCarries(plans);
  for (const c of chunks) {
    if (!Number.isInteger(c.from) || !Number.isInteger(c.to) || c.from < 0 || c.to <= c.from || c.to > moves.length) {
      throw new Error(`drill: a chunk is a token range [from, to) inside 0..${moves.length}, not ${JSON.stringify(c)}`);
    }
  }

  let status = STATUS.IDLE;
  let attempt = 0;
  let model = null;              // the cube's arrangement as the reports have moved it, in its own frame
  let modelTrusted = false;      // false from a lost turn until the app hands the arrangement back
  let lastSerial = null;
  // [{ c: candidate, idx, reach: Map(position -> log index), landed: Set(log index), firstFrom }] — `landed`
  // holds every report that left the cube ON a position of this track, which is a report that ended a turn
  let live = [];
  let rep = null;
  let pending = null;            // { handle, token } — the cue window of one excursion
  let excursionToken = 0;

  const emit = (type, from, extra = {}) => onEvent(Object.freeze({ type, attempt, from, to: status, ...extra }));

  const cancelPending = () => {
    if (pending) clearTimer(pending.handle);
    pending = null;
  };

  const facelets = () => toFacelets(model);

  /** Every position from `k` back through the regrip run that led into it was reached by this report. */
  const recordReach = (entry, k, logIdx) => {
    const { states, observable } = entry.c.track;
    let at = k;
    entry.reach.set(at, logIdx);
    while (at > 0 && !observable[at] && states[at] === states[at - 1]) { at--; entry.reach.set(at, logIdx); }
  };

  /**
   * The fewest turns back onto the algorithm, as the cube's own faces and — when they can be known — the
   * child's letters, or null past two turns (the screen says start over).
   *
   * Before the hold settles, the candidates can disagree: `R2` finishes the first turn in the holds where
   * the cube's R is the child's R, while `R` undoes it in all of them. The way back offered is the shortest
   * that puts the cube back on the algorithm in EVERY hold still standing, because the engine does not know
   * which one is the child's; only when no turns do that is one candidate's own way back offered.
   */
  const snapshotWayBack = () => {
    const f = facelets();
    const back = (turns) => {
      let replay = model;
      for (const t of turns) replay = applyMove(replay, t);
      const g = toFacelets(replay);
      return live.filter((e) => locate(e.c.track, g, e.idx, { near: true }).kind !== 'off');
    };
    const found = live
      .map((e) => wayBackOn(e.c.track, f, e.idx, 2, { near: true }))
      .filter(Boolean)
      .sort((a, b) => a.length - b.length);
    if (!found.length) return null;
    const turns = found.find((t) => back(t).length === live.length) ?? found[0];
    // Verified by replay: the turns put THIS cube back on the track, or the way back is not shown at all.
    const onto = back(turns);
    if (!onto.length) throw new Error(`drill: the way back ${turns.join(' ')} did not replay onto the track`);
    // In the child's letters only when every hold it works in names them alike.
    const holdsNow = onto.flatMap((e) => e.c.heldAt.map((h) => h[e.idx]));
    return Object.freeze({ turns, held: heldLetters(turns, holdsNow) });
  };

  /** Arm a rep from `state` — an arrangement already read and checked (`stateFrom`), or undefined for the model. */
  const arm = (from, cause, state) => {
    cancelPending();
    attempt += 1;
    if (state !== undefined) model = state;
    modelTrusted = true;
    live = candidatesFrom(plans, model, prefix).map((c) => ({
      c, idx: passRegrips(c.track, 0), reach: new Map(), landed: new Set(), firstFrom: null,
    }));
    // `since`: the first report after the cube last stood where the rep was armed — where the rep's turns
    // begin once one of them is matched (`judge`). `run`: the gesture's latest identical turns. The next rep that
    // arms itself keeps them where the algorithm allows: four quick R' made one turn before Sune's end finish the
    // rep with the first and start over with the fourth.
    const run = cause === 'next' && carriesGesture ? rep.run : null;
    rep = {
      start: facelets(), log: [], since: 0, firstMatched: null, excursions: 0,
      streamBroken: false, allNumbered: true, wayBack: null, about: null, cause: null, run,
    };
    status = STATUS.ARMED;
    emit(cause, from, { facelets: rep.start });
  };

  const complete = (entry) => {
    cancelPending();
    const from = status;
    const logIdx = (i) => (i === undefined || i === null || i < rep.firstMatched ? null : i - rep.firstMatched);
    const startIdx = passRegrips(entry.c.track, 0);
    const splits = chunks.map(({ from: a, to: b }) => ({
      from: a,
      to: b,
      start: a <= startIdx ? 0 : logIdx(entry.reach.get(a)),
      end: logIdx(entry.reach.get(b)),
    }));
    // The first report ends a whole turn unless it is one quarter of a half turn. Its turn is the first one
    // from where the rep began that turns its face — not necessarily the algorithm's first turn, because two
    // commuting turns may come in either order. A first report on no turn of the algorithm is a rep that was
    // not the algorithm alone, which is given no turn rate.
    const firstFace = rep.log[rep.firstMatched].notation[0];
    let firstEntry = null;
    for (let k = entry.firstFrom; k < entry.c.transitions.length && !firstEntry; k++) {
      firstEntry = faceQuartersAt(entry.c, k).find((q) => q.face === firstFace) ?? null;
    }
    const completesOne = firstEntry?.quarters === 1;
    const reports = rep.log.slice(rep.firstMatched);
    // Turns beyond the algorithm's own — an undo, a wrong turn taken back inside the window — are in the
    // span, so the rep was not the algorithm alone.
    const extraTurns = rep.log.length - quarters;
    const time = timeRep({
      reports,
      htm,
      turnsTimed: htm - (completesOne ? 1 : 0),
      streamBroken: rep.streamBroken,
      clean: rep.excursions === 0 && extraTurns === 0,
      splits,
      // The reports in the span that ended a turn: a pause is measured against the gaps between turns.
      moveEnds: [...entry.landed].map(logIdx).filter((i) => i !== null).sort((a, b) => a - b),
    });
    status = STATUS.DONE;
    sound('done');
    emit('done', from, {
      result: Object.freeze({
        ...time,
        htm,
        excursions: rep.excursions,
        extraTurns,
        clean: rep.excursions === 0 && extraTurns === 0 && !rep.streamBroken,
        holds: entry.c.holds,
        reports: rep.log.length,
      }),
    });
    arm(STATUS.DONE, 'next');
  };

  const enterUncertain = (cause) => {
    cancelPending();
    rep.streamBroken = true;
    modelTrusted = false;
    if (status === STATUS.UNCERTAIN) return;
    const from = status;
    status = STATUS.UNCERTAIN;
    rep.cause = cause;
    rep.wayBack = null;
    // About the cube: a turn went missing between it and the app, and nobody did anything wrong.
    rep.about = 'cube';
    emit('uncertain', from, { cause, about: 'cube' });
  };

  /**
   * Give every candidate still standing its whole track, once the cube has moved along it — a prefix covers
   * only the first turns. Re-passing the regrips matters: a prefix ends where it ends, and a rotation just
   * beyond it was not passed when the turn before it was reached.
   */
  const wholeTracks = (logIdx) => {
    live = live.map((e) => {
      if (!e.c.partial) return e;
      const c = whole(e.c);
      const idx = passRegrips(c.track, e.idx);
      const next = { ...e, c, idx };
      if (idx !== e.idx && logIdx !== null) recordReach(next, idx, logIdx);
      return next;
    });
  };

  /**
   * The candidate the cube has finished: at its last position AND in its last arrangement. The position
   * alone is not enough — a midpoint keeps the position it was beside, so a cube at the end that turns a
   * quarter of the last half turn back is still "at" the last position while it has left the end.
   */
  const finishedOn = (f) => live.find((e) => e.idx === e.c.track.states.length - 1 && e.c.track.states[e.idx] === f);

  /** Judge the arrangement against every candidate. `quiet` judges without cue or sound (`uncertain`). */
  const judge = (quiet) => {
    const f = facelets();
    const logIdx = rep.log.length - 1;
    const results = live.map((e) => locate(e.c.track, f, e.idx, { near: true }));
    const accepted = live.flatMap((e, i) => (results[i].kind === 'off' ? [] : [{ e, r: results[i] }]));
    if (!accepted.length) {
      if (quiet) return;
      if (status === STATUS.OFF) {
        const before = rep.wayBack;
        rep.wayBack = snapshotWayBack();
        if ((before?.turns.join(' ') ?? null) !== (rep.wayBack?.turns.join(' ') ?? null)) {
          emit('way-back', status, { wayBack: rep.wayBack });
        }
        return;
      }
      if (!pending) {
        const token = ++excursionToken;
        const mine = attempt;
        pending = { token, handle: setTimer(() => cueOff(mine, token), CUE_WINDOW_MS) };
      }
      return;
    }
    const progress = accepted.some(({ e, r }) => !(r.kind === 'step' && r.idx === e.idx));
    live = accepted.map(({ e, r }) => {
      const next = { ...e, idx: r.kind === 'step' ? r.idx : e.idx };
      if (progress && rep.firstMatched === null) next.firstFrom = e.idx;
      if (r.kind === 'step') { recordReach(next, r.idx, logIdx); next.landed.add(logIdx); }
      return next;
    });
    if (progress && rep.firstMatched === null) {
      // The rep's turns began with the first report since the cube last stood where it was armed, which need
      // not be this one: two commuting turns made in the other order leave the first on no track until the
      // second lands, and it is still the first turn the hand made.
      rep.firstMatched = rep.since;
    } else if (rep.firstMatched === null) {
      rep.since = logIdx + 1;   // back where it was armed: nothing up to here belongs to the rep
    }
    if (progress) wholeTracks(logIdx);
    cancelPending();
    const from = status;
    if (!quiet) {
      if (status === STATUS.OFF) {
        status = rep.firstMatched === null ? STATUS.ARMED : STATUS.RUNNING;
        rep.wayBack = null;
        rep.about = null;
        sound('capture');
        emit('back', from, { position: live[0].idx });
      } else if (status === STATUS.ARMED && rep.firstMatched !== null) {
        status = STATUS.RUNNING;
        emit('running', from, { position: live[0].idx });
      } else {
        emit('progress', from, { position: live[0].idx });
      }
    } else {
      emit('progress', from, { position: live[0].idx });
    }
    const finished = finishedOn(f);
    if (finished) complete(finished);
  };

  const cueOff = (mine, token) => {
    // A timer from an earlier rep, or an earlier excursion of this one, acts on nothing (defect (d)).
    if (mine !== attempt || !pending || pending.token !== token) return;
    pending = null;
    if (status !== STATUS.ARMED && status !== STATUS.RUNNING) return;
    const from = status;
    status = STATUS.OFF;
    rep.excursions += 1;
    // On a cube that numbers its turns, an unbroken run of serials proves the cube reported every turn, so
    // leaving the algorithm was a TURN. Without numbers a lost turn looks exactly like a wrong one until the
    // next snapshot, so it is worded about the CUBE — the first Drill accused these cubes' owners.
    rep.about = numbersMoves && rep.allNumbered ? 'turn' : 'cube';
    rep.wayBack = snapshotWayBack();
    sound('off');
    emit('off', from, { about: rep.about, wayBack: rep.wayBack });
  };

  /**
   * The LATEST four reports, when they are one quarter turn of one face, made within the limit. Only their
   * times are kept: a slow turn of the same face before them is not part of the gesture, and counting the
   * whole run of one face would let it reach four too slowly and never reach four again.
   */
  const isGesture = (report) => {
    const t = Number.isFinite(report.timestamp) ? report.timestamp : now();
    const times = rep.run?.notation === report.notation ? [...rep.run.times, t].slice(-GESTURE_TURNS) : [t];
    rep.run = { notation: report.notation, times };
    return times.length === GESTURE_TURNS && t - times[0] <= GESTURE_MS;
  };

  /**
   * The serial count an arrangement HANDED IN sets: the serial it was reported at, so the next report is compared
   * with that — or none, when the caller has none. Never the last serial this engine saw: an arrangement from
   * outside may already hold turns that never reached it, and the next report compared with the last one it did
   * see would call those turns lost again. Checked before anything changes.
   */
  const countFrom = (serial) => {
    if (serial === undefined || serial === null) return null;
    if (!Number.isInteger(serial) || serial < 0 || serial > 0xff) {
      throw new Error(`drill: a serial is a whole number 0..255, not ${JSON.stringify(serial)}`);
    }
    return serial;
  };

  const restartFrom = (from, cause, state) => {
    if (state === undefined && !modelTrusted) {
      emit('refused', from, { why: 'the stream lost a turn, so the arrangement now is not known' });
      return false;
    }
    arm(from, cause, state);
    return true;
  };

  return Object.freeze({
    /**
     * Arm the first rep from the arrangement the cube reports now (54 facelets, its own frame), and `serial`, the
     * serial that report carried, when the cube numbers its turns.
     *
     * The serial count starts again here (`countFrom`): the next report is compared with `serial`, or with
     * nothing. A cube nobody was drilling — disconnected, or simply away from this engine — went on numbering
     * its turns, and those turns are in the arrangement given, not lost from the rep. The next rep that arms
     * itself after a `done` keeps the count: that is one unbroken stream.
     */
    start({ facelets: given, serial }) {
      if (typeof given !== 'string') throw new Error('drill: start needs the cube\'s arrangement');
      // Both read and checked before anything changes: a refused start leaves the engine as it was.
      const state = stateFrom(given);
      const count = countFrom(serial);
      lastSerial = count;
      arm(status, 'start', state);
    },

    /**
     * One report from the cube: `{ notation, timestamp, cubeTimestamp, serial }` as `lib/cube-session.js`
     * hands it over. Applied to the cube's model whatever the state, because the cube moved.
     */
    report(move) {
      const notation = move?.notation;
      if (!QUARTER.test(notation ?? '')) {
        throw new Error(`drill: a cube reports one quarter turn of an outer face, not "${notation}"`);
      }
      const serial = Number.isInteger(move.serial) ? move.serial : null;
      const jumped = serial !== null && lastSerial !== null && ((serial - lastSerial) & 0xff) !== 1;
      lastSerial = serial;
      if (status === STATUS.IDLE) return;
      model = applyMove(model, notation);
      rep.log.push(Object.freeze({
        notation,
        timestamp: move.timestamp,
        cubeTimestamp: move.cubeTimestamp ?? null,
        serial,
      }));
      if (serial === null) rep.allNumbered = false;
      if (jumped) enterUncertain('lost-turn');
      if (isGesture(move)) {
        restartFrom(status, 'gesture');
        return;
      }
      if (status === STATUS.UNCERTAIN) {
        if (modelTrusted) judge(true);
        return;
      }
      judge(false);
    },

    /** The app proved a turn was lost (a serial gap it saw, or the self-check's verdict, `hooks.liveGap`). */
    gap() {
      if (status === STATUS.IDLE) return;
      enterUncertain('lost-turn');
    },

    /**
     * The arrangement the app has reconciled (the self-check's, after a gap), and `serial`, the serial of the
     * snapshot it came from when the cube numbers its turns. Mends the stream: tracking resumes, silently, from
     * the position nearest where the cube had got to, and the serial count is taken from the snapshot
     * (`countFrom`). The rep stays `uncertain` — its time is refused — and can still complete. An arrangement
     * the engine already holds changes nothing, the count included.
     */
    resync(given, { serial } = {}) {
      const state = stateFrom(given);
      const count = countFrom(serial);
      if (status === STATUS.IDLE) { model = state; modelTrusted = true; lastSerial = count; return; }
      if (modelTrusted && facelets() === given) return;
      if (modelTrusted) enterUncertain('snapshot-disagrees');
      model = state;
      modelTrusted = true;
      lastSerial = count;
      const f = facelets();
      wholeTracks(null);
      // Turns went by unseen, so the cube may be anywhere AHEAD: the one place this engine looks further
      // than two turns. Nearest first, ahead before behind, so a repeated sequence is placed where the
      // cube most plausibly is — and a rep resumed this way is `uncertain` and untimed whatever happens.
      // A cube that is nowhere on the track stays where it was, uncertain, until it starts over.
      const nearest = (track, from) => {
        const { states } = track;
        for (let d = 0; d < states.length; d++) {
          const k = (d ? [from + d, from - d] : [from]).find((i) => i >= 0 && i < states.length && states[i] === f);
          if (k !== undefined) return passRegrips(track, k);
        }
        return null;
      };
      const placed = live.map((e) => ({ e, k: nearest(e.c.track, e.idx) }));
      live = placed.map(({ e, k }) => (k === null ? e : { ...e, idx: k }));
      // When NO hold still standing can place the cube, the reports that ruled holds out are suspect: a lost turn
      // the stream did not show makes the next report look like a different turn, so the hold the child holds
      // can be ruled out by a turn it never made. Every hold is asked again, from the rep's start, and those that
      // place the cube come back; if none does, the cube stays where it was, as before.
      if (placed.every(({ k }) => k === null)) {
        const from = live[0]?.idx ?? 0;
        const again = candidatesFrom(plans, stateFrom(rep.start)).flatMap((c) => {
          const k = nearest(c.track, from);
          return k === null ? [] : [{ c, idx: k, reach: new Map(), landed: new Set(), firstFrom: passRegrips(c.track, 0) }];
        });
        if (again.length) live = again;
      }
      emit('resync', status, { position: live[0].idx });
      const finished = rep.firstMatched === null ? null : finishedOn(f);
      if (finished) complete(finished);
    },

    /**
     * Start over, from the screen: re-arm from the cube as it is NOW — `facelets` when the caller has them, with
     * the `serial` they were reported at, which sets the count as `start` does; otherwise the engine's own model,
     * which is the reports' and keeps the count. Refused (false, and a `refused` event) when a lost turn left the
     * model unknown and no arrangement was given.
     */
    restart({ facelets: given, serial } = {}) {
      if (status === STATUS.IDLE && given === undefined) throw new Error('drill: nothing to restart; start first');
      if (given === undefined && serial !== undefined) throw new Error('drill: a serial belongs to an arrangement, and none was given');
      // Both read and checked before anything changes: a refused restart leaves the engine as it was.
      const state = given === undefined ? undefined : stateFrom(given);
      const count = countFrom(serial);
      if (state !== undefined) lastSerial = count;
      return restartFrom(status, 'restart', state);
    },

    /** Stop drilling: nothing armed, every timer dead, and the serial count forgotten (see `start`). */
    stop() {
      cancelPending();
      const from = status;
      attempt += 1;
      status = STATUS.IDLE;
      live = [];
      rep = null;
      lastSerial = null;
      emit('stop', from);
    },

    /** The engine as a screen reads it. */
    get state() {
      const holds = live.flatMap((e) => e.c.holds);
      return Object.freeze({
        status,
        attempt,
        position: live[0]?.idx ?? null,
        length: moves.length,
        holds: Object.freeze(holds),
        // ONE HOLD left, not one track: the holds about one axis share a track on an algorithm that turns only
        // that axis (`drop-in`, F2), and nothing a cube reports tells them apart, so its hold is never known.
        settled: holds.length === 1,
        pending: pending !== null,
        wayBack: rep?.wayBack ?? null,
        about: rep?.about ?? null,
        cause: rep?.cause ?? null,
        excursions: rep?.excursions ?? 0,
        trusted: modelTrusted,
      });
    },

    /** The cube's arrangement as the reports have moved it — what `next` and the gesture re-arm from. */
    get facelets() {
      return model ? facelets() : null;
    },
  });
}
