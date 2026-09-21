// A script played as a lesson: a recording per step, a question the child answers, a move the child
// makes — and the lesson waiting for each of them (dev-docs/adr/0007-the-course-plays-scripts-a-clip-per-line.md).
//
// THE UNIT IS THE STEP, NOT THE SECOND. An episode is one track and a cube that is a function of `t`;
// that model breaks twice over for an interactive lesson. It has no single timeline — a child answering a
// question or turning their own cube stops the clock for as long as they take — and it ties every cue to
// a timestamp, so re-recording one line moves every line after it. Here a step's recording is its own
// file (`voice`), the step lasts as long as that recording plays, and the lesson moves on when it ends.
// Re-recording a line replaces one file and moves nothing else.
//
// WHAT THIS OWNS: which step the lesson is at, whether it is playing, and what it is waiting for. What it
// does NOT own is anything it can be handed: the cube's positions are the stop driver's
// (`lib/script-drive.js`), a round's rules are `createRound`'s and its reveal is `revealScript`'s
// (`lib/script-rounds.js`), and how a recording is fetched and played is the `voice` it is given. It never
// reads the DOM and never chooses what to teach (ADR 0005 decision 1).
//
// NEVER A GUESSED DURATION. A step whose recording plays is as long as the recording. A step with words
// and no recording WAITS for Next rather than being given a reading time nobody measured, and a recording
// that fails to play is said to have failed, at that step, rather than skipped past in silence.
import { parse } from './cube-notation.js';
import { run } from './cube-moves.js';
import { buildScript } from './script-view.js';
import { createStopDriver, defaultSchedule } from './script-drive.js';
import { createRound, revealScript } from './script-rounds.js';

/** The pause between one step and the next, so two lines do not run into each other. */
export const STEP_GAP_MS = 450;
/** How long a round's verdict is on screen before its reveal starts to play. */
export const VERDICT_MS = 900;

const holdPair = (hold) => String(hold).split(' ');
const hasWords = (text) => typeof text === 'string' && text.trim() !== '';

/**
 * A move a smart cube can report: one face, a quarter or a half turn. A cube reports turns of its FACES —
 * a whole-cube rotation moves no face relative to the others, and a slice is two faces and a regrip — so a
 * step that names anything else can be confirmed by the Done button only.
 */
const FACE_TURN = /^([URFDLB])(2|')?$/;

/**
 * Follow a child's turns along the ones a step asks for.
 *
 * `tokens` are face turns in the cube's own letters — the letters a smart cube reports in. A half turn is
 * two quarter turns the same way round, either way round. A turn that is not the next one is `wrong` and
 * is remembered; turning it back takes the child back onto the sequence, and until then nothing advances.
 */
export function createTurnMatcher(tokens) {
  const want = tokens.map((token) => {
    const m = FACE_TURN.exec(token);
    if (!m) throw new Error(`script-lesson: "${token}" is not a face turn a cube can report`);
    return { face: m[1], turns: m[2] === '2' ? 2 : 1, sign: m[2] === "'" ? -1 : m[2] === '2' ? 0 : 1 };
  });
  // INVARIANTS: `at` counts completed tokens. `half` is non-zero only while a half turn of `want[at]` is part
  // made, and only while nothing is astray. `astray` holds the quarter turns that took the cube off the
  // sequence, newest last -- including any turned past the end, because the cube really made them.
  let at = 0;
  let half = 0;
  const astray = [];

  const quarterOf = (notation) => {
    const m = /^([URFDLB])(2|')?$/.exec(String(notation).trim());
    if (!m) return null;
    return { face: m[1], sign: m[2] === "'" ? -1 : 1, twice: m[2] === '2' };
  };

  const state = (kind) => Object.freeze({ kind, done: at, total: want.length, astray: astray.length });
  const finished = () => at === want.length && astray.length === 0 && half === 0;
  const advance = () => { at += 1; return state(at === want.length ? 'complete' : 'step'); };
  const stray = (q) => { astray.push({ face: q.face, sign: q.sign }); return state('wrong'); };

  /** Off the sequence: this quarter either undoes the newest wrong one, or is one more. */
  const whileAstray = (q) => {
    const top = astray[astray.length - 1];
    if (top.face !== q.face || top.sign !== -q.sign) return stray(q);
    astray.pop();
    if (astray.length) return state('wrong');
    // Back on the sequence -- and if every token was already made, the child has now made them all.
    return state(at === want.length ? 'complete' : 'back');
  };

  /** A half turn part made: the same way finishes it, the other way UNDOES it, anything else strays. */
  const midHalf = (q) => {
    const w = want[at];
    if (q.face === w.face && q.sign === half) { half = 0; return advance(); }
    // U then U' is the cube back where it was, not two wrong turns (audit, 2026-09-21): the first quarter
    // is taken back and the half turn simply has not begun.
    if (q.face === w.face && q.sign === -half) { half = 0; return state('back'); }
    astray.push({ face: w.face, sign: half });
    half = 0;
    return stray(q);
  };

  const feedQuarter = (q) => {
    if (astray.length) return whileAstray(q);
    // Past the end is not "still complete": the cube made the turn, so it is off the sequence (asking for R
    // and receiving R2 used to be accepted -- audit, 2026-09-21).
    if (at >= want.length) return stray(q);
    if (half !== 0) return midHalf(q);
    const w = want[at];
    if (w.face !== q.face) return stray(q);
    if (w.turns === 2) { half = q.sign; return state('progress'); }
    return w.sign === q.sign ? advance() : stray(q);
  };

  return Object.freeze({
    /**
     * A reported turn. `step` when it completed one of the step's turns (the drawing may follow it),
     * `progress` for the first half of a half turn, `complete` when every turn is made and nothing is off
     * the sequence, `wrong` for a turn that is not the next one, `back` when the cube is back on the
     * sequence. A half turn is BOTH of its quarters, always: stopping after the first when it completed or
     * strayed dropped a real quarter turn of the cube (audit, 2026-09-21). Anything a cube could not have
     * meant is ignored rather than guessed at.
     */
    feed(notation) {
      const q = quarterOf(notation);
      if (!q) return state('ignored');
      const first = feedQuarter(q);
      return q.twice ? feedQuarter(q) : first;
    },
    get state() { return state(finished() ? 'complete' : astray.length ? 'wrong' : 'waiting'); },
  });
}

/**
 * Where each step's positions are. Every step has at least one — `buildScript` records a position for every
 * step it reads, and a move of several groups records one per group — so a step is `[first, last]`, and the
 * position BEFORE it is `first - 1`, the cube as it stands when the step begins.
 */
function stepSpans(built) {
  const first = [];
  const last = [];
  for (const p of built.positions) {
    if (p.step < 0) continue;
    if (first[p.step] === undefined) first[p.step] = p.index;
    last[p.step] = p.index;
  }
  return { first, last };
}

/** The sections a script declares, in order: which step each begins at, and what it is called. */
export function sectionsOf(built) {
  const out = [];
  built.script.steps.forEach((step, i) => {
    if (hasWords(step.section)) out.push(Object.freeze({ step: i, label: step.section }));
  });
  return Object.freeze(out);
}

/**
 * The face turns a `yours` step asks for, in the cube's own letters — the letters a smart cube reports in
 * — or null when a cube could not report them all.
 */
export function turnsOfStep(built, s) {
  const step = built.script.steps[s];
  if (!step?.move) return null;
  const { first } = stepSpans(built);
  const before = built.positions[first[s] - 1];
  const { drawn } = run(parse(step.move), holdPair(before.hold), before.cube);
  return drawn.every((t) => FACE_TURN.test(t)) ? Object.freeze([...drawn]) : null;
}

/**
 * Why `progress` cannot be restored onto `built`, or null when it can.
 *
 * A lesson's progress is one of its RESTING places, as plain data (`progress()` below): `{ step }` to stand
 * before a step, `{ step: n }` to have ended, `{ step, picks }` for a question asked and not yet answered,
 * `{ step, fed }` for a move handed to the child with the turns their cube has reported so far, and
 * `{ step, waiting, words, problem }` for a step that has played and waits to go on. A record that does not
 * fit -- made on a lesson whose steps have since changed, or not made by `progress()` at all -- is refused
 * here by name rather than half-restored.
 */
export function progressRefusal(built, progress) {
  const n = built.script.steps.length;
  const s = progress?.step;
  if (!Number.isInteger(s) || s < 0 || s > n) return `step ${JSON.stringify(s)} is not a step of this lesson (0–${n})`;
  const { picks, fed, waiting } = progress;
  const kinds = [picks !== undefined, fed !== undefined, waiting !== undefined].filter(Boolean).length;
  if (kinds > 1) return 'a lesson rests in one place at a time';
  if (kinds === 0) return null;
  if (s === n) return 'an ended lesson has nothing waiting';
  const step = built.script.steps[s];
  if (picks !== undefined) {
    if (!step.round) return `step ${s + 1} asks nothing`;
    if (!Array.isArray(picks)) return 'the picks are not a list';
    const round = createRound(built, stepSpans(built).first[s]);
    try { for (const face of picks) round.select(face); } catch { return 'a pick is not a face'; }
    return round.state.locked ? 'those picks answer the question -- an answered question is not waiting' : null;
  }
  if (fed !== undefined) {
    if (!step.yours) return `step ${s + 1} hands the child no move`;
    if (!Array.isArray(fed) || !fed.every((x) => typeof x === 'string')) return 'the turns are not a list of turns';
    // A move no cube can report (a slice, a whole-cube turn) is followed by Done alone, so none of its turns
    // were ever taken.
    const turns = turnsOfStep(built, s);
    if (!turns) return fed.length ? `step ${s + 1}'s move is not one a cube can report, so none of it was followed` : null;
    const matcher = createTurnMatcher(turns);
    for (const x of fed) matcher.feed(x);
    return matcher.state.kind === 'complete' ? 'those turns make the move -- a made move is not waiting' : null;
  }
  if (waiting !== true) return 'waiting is either true or absent';
  if (step.round || step.yours) return `step ${s + 1} waits for the child, not to go on`;
  if (typeof progress.words !== 'string') return 'the words are not text';
  const { problem } = progress;
  if (problem !== null && (typeof problem !== 'object' || problem.step !== s)) return 'the problem is not about this step';
  return null;
}

/**
 * The lesson's runs, and what stops them — the sequencing, apart from what is being sequenced.
 *
 * A run belongs to the GENERATION it started in, and any action moves the generation on. A wait is on the
 * lesson's clock (`schedule`, the same seam the stop driver takes), and a gate holds a run while the lesson
 * is paused. `cancel` ends the generation, its timer and its gate, so the run wakes, finds it is no longer
 * current, and stops. These were eight closures over four variables inside the lesson (audit, 2026-09-21).
 */
export function createSequencer({ schedule, isPlaying }) {
  let gen = 0;
  let timer = null;
  let parked = null;
  const release = () => { const r = parked; parked = null; r?.(); };
  return Object.freeze({
    get current() { return gen; },
    /** Wait `ms` on the lesson's clock. Cancelled with everything else by the next action. */
    wait: (ms) => new Promise((resolve) => {
      if (!(ms > 0)) { resolve(); return; }
      timer = schedule(() => { timer = null; resolve(); }, ms);
    }),
    /** Hold here while paused. A newer action releases it, and the run then finds it is no longer current. */
    gate: () => (isPlaying() ? Promise.resolve() : new Promise((resolve) => { parked = resolve; })),
    /** Let a run held at a gate go on. */
    release,
    /** End the current generation: its timer stops and its gate opens onto a run that is no longer current. */
    cancel() {
      gen += 1;
      if (timer !== null) { schedule.cancel(timer); timer = null; }
      release();
    },
  });
}

/**
 * Following the child's move on a smart cube: the turns their cube reports, matched against the step's own
 * `turns`, and how many of the step's `stops` the drawing should now show. A move no cube can report (`turns`
 * null) is followed by Done alone, so this follows nothing and says so (`confirmable`). Every turn it took is
 * kept (`fed`), so the same turns fed to a fresh follower land it exactly where this one is, astray or half
 * made included — which is how a lesson is restored.
 */
export function createMoveFollower(turns, stops) {
  const matcher = turns ? createTurnMatcher(turns) : null;
  const fed = [];
  let wrong = null;
  let drawn = 0;
  return Object.freeze({
    get confirmable() { return matcher !== null; },
    /** How many of the step's stops the drawing has been told to show. */
    get drawn() { return drawn; },
    get fed() { return Object.freeze([...fed]); },
    /** What a view says about the move: whether a cube can confirm it, how far it is, and the stray turn. */
    view: () => Object.freeze({ confirmable: matcher !== null, ...(matcher ? matcher.state : {}), wrong }),
    /**
     * A reported turn: the matcher's answer, and how many MORE stops the drawing should show. As many as are
     * DONE, whatever the report's kind: one report can complete two tokens (`R2` for `R R U`), or complete one
     * and begin or stray from the next (`R2` for `R R2 U` is `progress`, for `R U` is `wrong`) — each once
     * left the drawing a turn behind (audit and verify pass, 2026-09-21).
     */
    feed(notation) {
      if (!matcher) return null;
      const r = matcher.feed(notation);
      if (r.kind !== 'ignored') fed.push(String(notation));
      if (r.kind === 'wrong') wrong = String(notation);
      if (r.kind === 'back' || r.kind === 'step' || r.kind === 'complete') wrong = null;
      const due = Math.max(0, Math.min(r.done, stops) - drawn);
      drawn += due;
      return { r, due };
    },
  });
}

/**
 * A voice's `speak(ref)`, as a promise that always settles with `{ result, ref }` — never throws, never
 * rejects. A REJECTED recording is a failed recording, like one that threw: only the synchronous throw was
 * caught, so a rejecting `speak()` was an unhandled rejection and the lesson went on saying it was playing
 * with no problem shown (audit, 2026-09-21).
 */
export function narrate(voice, ref) {
  let started;
  try { started = Promise.resolve(voice.speak(ref)); } catch (err) { started = Promise.resolve(err?.name || 'Error'); }
  return started.then((result) => ({ result, ref }), (err) => ({ result: err?.name || 'Error', ref }));
}

/**
 * What the lesson is saying: the words shown for the line, its recording, and holding and continuing it. ONE
 * owner for narration's lifecycle, which was seven places in the lesson — a stop in cancelling and another in
 * the reveal, a hold in pause, a resume in play, and the words written from four sites (audit and verify pass,
 * 2026-09-21).
 */
export function createNarration(voice) {
  if (!voice || typeof voice.speak !== 'function' || typeof voice.stop !== 'function') {
    throw new Error('script-lesson: needs a voice with speak() and stop()');
  }
  let words = '';
  let held = false;              // a recording paused by `hold()`, to be continued by `resume()`
  return Object.freeze({
    /** What is being said now, for a caption; empty between lines. */
    get words() { return words; },
    /** Say a line: its words shown, and its recording started if it has one — how it ended (`narrate`), or null. */
    say(ref, text) {
      words = hasWords(text) ? text : '';
      return ref ? narrate(voice, ref) : null;
    },
    /** Show a line's words with no recording started — a restored lesson says nothing until it is asked. */
    show(text) { words = hasWords(text) ? text : ''; },
    /** The line has been said: its words go. */
    clear() { words = ''; },
    /** Hold the recording in progress, to be continued. */
    hold() { held = true; voice.pause?.(); },
    /** Continue a held recording; nothing, when none is held. */
    resume() { if (held) { held = false; voice.resume?.(); } },
    /** Stop the recording in progress, and forget any hold. The words stay: the caller says when they go. */
    stop() { held = false; voice.stop(); },
    /** Stop, and clear the words — for everything a cancelled run was doing. */
    reset() { held = false; voice.stop(); words = ''; },
  });
}

/**
 * A lesson over one built script.
 *
 * `voice` plays a step's recording: `speak(ref)` resolves `'ended'` when it played to the end, `'stopped'`
 * when `stop()` cut it off, and otherwise the reason it could not play (`'refused'` for a reference the
 * course door would not let through, or the media's own error name). `pause()` and `resume()` hold and
 * continue the one in progress. `settle()` resolves when the cube has finished turning. `schedule` is the
 * clock every pause between steps is measured on — the same seam the stop driver takes.
 *
 * `from` is a record `progress()` made -- the lesson restored where it rested, PAUSED, because nothing in
 * this app plays without being asked. A record that does not fit throws; ask `progressRefusal` first.
 */
export function createScriptLesson(built, {
  cube = null,
  voice = null,
  settle = async () => {},
  schedule = defaultSchedule,
  onChange = () => {},
  gap = STEP_GAP_MS,
  verdictMs = VERDICT_MS,
  from = null,
} = {}) {
  const narration = createNarration(voice);
  const refusal = from === null ? null : progressRefusal(built, from);
  if (refusal) throw new RangeError(`script-lesson: that progress does not fit this lesson -- ${refusal}`);
  const steps = built.script.steps;
  const n = steps.length;
  const span = stepSpans(built);
  const sections = sectionsOf(built);

  let driver = createStopDriver(built, { cube });
  let at = 0;                  // the step the lesson is at: about to play, playing, or waiting in
  let phase = 'ready';         // ready | playing | yours | asking | revealing | waiting | ended
  let playing = false;         // whether the lesson goes on by itself
  let problem = null;          // { step, reason } — a recording that did not play
  let round = null;            // the round being asked, while one is
  let follow = null;           // the child's move on a `yours` step, followed (`createMoveFollower`), while one waits
  let childMoved = false;      // the child's move is made and the drawing is catching up with it
  let revealed = false;
  /** The reveal's driver while one is playing: what is on the element then is its picture, not the lesson's. */
  let shown = null;        // a reveal has written its own segment onto the element since `driver` last did
  let disposed = false;        // `dispose()` was called: nothing public acts again

  const runs = createSequencer({ schedule, isPlaying: () => playing });
  const alive = (mine) => mine === runs.current && !disposed;

  /**
   * The cues on show — read from whichever driver last wrote to the element, because during a reveal that is
   * the reveal's and not the lesson's. A figure belongs to the picture in front of the child.
   */
  const drawn = () => (shown ?? driver).view.cues;

  /**
   * The picture or clip the lesson is showing where the cube is, or null.
   *
   * THE ONE SET LAST WINS. A step may not set both (`checkScript` refuses that), but a picture set on step 2
   * and a clip set on step 7 are BOTH in force at step 7 — cues stay in force until they are cleared. So the
   * one that took effect later is the one on screen, which is what an author who forgot to clear the first
   * one means. `bound` carries where each cue took effect, which is the only place that can be answered.
   */
  const media = () => {
    const bound = (shown ?? driver).view.bound;
    const set = ['image', 'clip'].filter((kind) => bound[kind]?.value);
    if (!set.length) return null;
    const kind = set.length === 1 ? set[0] : (bound.image.at >= bound.clip.at ? 'image' : 'clip');
    const { src, alt } = bound[kind].value;
    return Object.freeze({ kind, src, alt });
  };

  const view = () => Object.freeze({
    step: at,
    steps: n,
    phase,
    playing,
    words: narration.words,
    /** The figure this position puts on screen (`number`), and whether it asked to be counted up to.
     *  A cue stays in force until it is cleared, so `counting` outlives the figure it was written beside —
     *  and "counting" with no figure on screen is a claim about nothing. It is reported of the FIGURE. */
    /** The picture or clip where the cube is, or null when the cube itself is what is being shown. */
    media: media(),
    number: drawn().number ?? null,
    counting: Boolean(drawn().number) && Boolean(drawn().counting),
    problem,
    section: [...sections].reverse().find((s) => s.step <= Math.min(at, n - 1))?.label ?? null,
    round: round ? round.state : null,
    yours: phase === 'yours' && follow ? follow.view() : null,
    position: driver.position,
  });
  const changed = () => onChange(view());

  /** Stop everything a run was doing: its generation, timer and gate, its recording, and what it waited on. */
  const cancel = () => {
    runs.cancel();
    narration.reset();
    shown = null;
    round = null;
    follow = null;
    childMoved = false;
  };

  /**
   * The lesson's own driver, fit to write. After a reveal it is not: the reveal loaded its own segment onto
   * the element, and a writer that still believes it holds the round's segment would skip the reload and
   * draw the next position over the reveal's cube. A fresh one lands cold (the event driver's own rule).
   */
  const own = () => {
    if (revealed) { driver = createStopDriver(built, { cube }); revealed = false; }
    return driver;
  };

  /** Put the cube as it stands just before step `s`, without animating the way there. */
  const land = (s) => {
    const before = s >= n ? built.positions.length - 1 : span.first[s] - 1;
    // ALWAYS a seek. Skipping it when the driver already stood at the target left a turn still in flight
    // there: Next during a one-move step started the next move before the last one had landed (audit,
    // 2026-09-21). The driver re-seats an unchanged position that is still animating.
    own().seek(before);
  };

  // A step's recording is started by `narration.say` in the same task as the press that led here, so the
  // FIRST recording starts inside the user's gesture, which is what a media element needs to be allowed to.

  /** A recording that did not play, said about the step it belongs to -- and the recording, by name. */
  const failed = (s, result, ref, extra = {}) => Object.freeze({ step: s, reason: result, ref, ...extra });

  /**
   * When a WAITING step's recording ends: a failure becomes that step's problem, and `clear` says whether its
   * caption goes. One handler for both kinds of waiting step (audit, 2026-09-21: two copies had already
   * drifted), with the difference written down: a QUESTION's words clear when it has been asked, because
   * the question is then on screen as its choices; a move HANDED TO THE CHILD keeps its words, because they
   * say what to do for as long as the child is doing it.
   */
  const whenSpoken = (talk, s, mine, { clear }) => talk?.then(({ result, ref }) => {
    if (!alive(mine)) return;
    if (result !== 'ended' && result !== 'stopped') problem = failed(s, result, ref);
    else if (result === 'ended' && clear) narration.clear();
    changed();
  });

  /**
   * Draw stops `from`..`to` on `driver`, each one landed and then held while the lesson is paused. False once
   * the run is no longer current. ONE loop for every playback — a step, a reveal's step, and the rest of a
   * child's move after Done — because two copies of it had already come to enforce different pause rules
   * (audit, 2026-09-21: pausing after Done went on making the remaining moves).
   */
  const playStops = async (driver, from, to, mine) => {
    for (let k = from; k <= to; k++) {
      driver.next();
      changed();
      await settle();
      if (!alive(mine)) return false;
      await runs.gate();
      if (!alive(mine)) return false;
    }
    return true;
  };

  /**
   * One ordinary step of `ctx` — the lesson's own steps, or a reveal's — played from the position before
   * it: its recording and its turns together, then the pause. `'next'` to go on, `'hold'` to stop and wait.
   */
  const playStep = async (ctx, s, mine) => {
    const step = ctx.steps[s];
    const talk = narration.say(step.voice, step.say);
    changed();
    if (!(await playStops(ctx.driver(), ctx.first[s], ctx.last[s], mine))) return 'gone';
    if (talk) {
      const { result } = await talk;
      if (!alive(mine)) return 'gone';
      if (result !== 'ended') {
        problem = failed(at, result, step.voice, ctx.reveal ? { reveal: s } : {});
        return 'hold';
      }
      narration.clear();
    } else if (hasWords(step.say)) {
      // Words and no recording: shown, and waited on. A reading time would be a number nobody measured.
      return 'hold';
    } else if (step.secs) {
      await runs.wait(step.secs * 1000);
      if (!alive(mine)) return 'gone';
    }
    changed();
    await runs.wait(gap);
    if (!alive(mine)) return 'gone';
    await runs.gate();
    return alive(mine) ? 'next' : 'gone';
  };

  const mainCtx = { steps, first: span.first, last: span.last, driver: () => driver };

  /** Begin step `s`: an ordinary one plays and hands back what to do next; a round or a `yours` waits. */
  const begin = async (s, mine) => {
    at = s;
    problem = null;
    childMoved = false;
    const step = steps[s];
    if (step.round) {
      phase = 'asking';
      own().next();                       // the round's own position: its cues, the same cube
      round = createRound(built, span.first[s]);
      const talk = narration.say(step.round.voice, step.round.say);
      changed();
      whenSpoken(talk, s, mine, { clear: true });
      return 'hold';
    }
    if (step.yours) {
      phase = 'yours';
      follow = createMoveFollower(turnsOfStep(built, s), span.last[s] - span.first[s] + 1);
      // #6 -- THE STEP'S CUES, NOT THE LAST STEP'S. The child is about to make this move, so its arrow and
      // highlight are what the cube should show while they do -- on the cube as it stands, the move unmade.
      // Entering the step drew nothing, and the child waited over the previous step's cues (audit, 2026-09-21).
      own().describe(span.first[s]);
      const talk = narration.say(step.voice, step.say);
      changed();
      whenSpoken(talk, s, mine, { clear: false });
      return 'hold';
    }
    phase = 'playing';
    own();
    const outcome = await playStep(mainCtx, s, mine);
    if (outcome === 'hold' && alive(mine)) {
      // Stopped, and waiting for the child: Play (or Next) goes on, and Play after a device refusing to
      // start the sound tries the step again.
      phase = 'waiting';
      playing = false;
      changed();
    }
    return outcome;
  };

  /** Play on from step `s` for as long as the lesson is playing and nothing waits on the child. */
  const runFrom = async (s, mine) => {
    let k = s;
    while (alive(mine) && k < n) {
      const outcome = await begin(k, mine);
      if (outcome !== 'next') return;
      k += 1;
    }
    if (alive(mine) && k >= n) {
      at = n;
      phase = 'ended';
      playing = false;
      narration.clear();
      changed();
    }
  };

  /** Go to step `s` — the cube as it stands just before it — and play on from there if the lesson is playing. */
  const goTo = (s) => {
    cancel();
    at = Math.max(0, Math.min(s, n));
    problem = null;
    land(at);
    if (at >= n) {
      phase = 'ended';
      playing = false;
      changed();
      return;
    }
    phase = 'ready';
    changed();
    if (playing) void runFrom(at, runs.current);
  };

  /** On to the next step. Anything the child was being waited for is skipped, and the lesson plays on. */
  const goOn = () => {
    if (phase === 'waiting' || phase === 'yours' || phase === 'asking' || phase === 'revealing') playing = true;
    goTo(at + 1);
  };

  /**
   * The child's move is made — they pressed Done, or their cube made the last turn. The drawing plays what
   * it has not already followed, and the lesson goes on: the child acting is the child engaged.
   */
  const finishYours = async () => {
    const s = at;
    const from = span.first[s] + (follow?.drawn ?? 0);
    cancel();
    const mine = runs.current;
    phase = 'playing';
    playing = true;
    childMoved = true;
    changed();
    // GATED LIKE ANY OTHER PLAYBACK: the same loop as every step (`playStops`).
    if (!(await playStops(own(), from, span.last[s], mine))) return;
    // A cube that confirmed the last move has already had it drawn, so there is nothing left to play -- but
    // that drawing may still be turning. It lands before the pause between steps begins (audit, 2026-09-21).
    if (from > span.last[s]) {
      await settle();
      if (!alive(mine)) return;
    }
    await runs.wait(gap);
    if (!alive(mine)) return;
    await runs.gate();
    if (alive(mine)) void runFrom(s + 1, mine);
  };

  /** A round answered: the verdict shown, the reveal played stop by stop, and the lesson back on its own cube. */
  const reveal = async (s, mine) => {
    phase = 'revealing';
    narration.stop();
    revealed = true;
    changed();
    await runs.wait(verdictMs);
    if (!alive(mine)) return;
    // The verdict's pause, gated: a lesson paused while the verdict showed started the reveal's narration.
    await runs.gate();
    if (!alive(mine)) return;
    const rbuilt = buildScript(revealScript(built, span.first[s]));
    const spans = stepSpans(rbuilt);
    let rdriver = createStopDriver(rbuilt, { cube });
    shown = rdriver;
    // Position 1 is the round as it was asked — its first synthesised step — which is on screen already.
    rdriver.seek(spans.last[0]);
    const ctx = { steps: rbuilt.script.steps, first: spans.first, last: spans.last, driver: () => rdriver, reveal: true };
    for (let j = 1; j < rbuilt.script.steps.length; j++) {
      const outcome = await playStep(ctx, j, mine);
      if (outcome === 'gone') return;
      if (outcome === 'hold') {
        // A reveal line that did not play is said to have failed, and the lesson waits at the ROUND: the
        // reveal is part of answering it, and Next goes on from there.
        phase = 'waiting';
        playing = false;
        changed();
        rdriver = null;
        shown = null;
        return;
      }
    }
    // The reveal loaded its own segment onto the element, so the lesson's driver no longer knows what the
    // element holds; a fresh one lands cold on the round's position (the event driver's own rule).
    shown = null;
    own().seek(span.last[s]);
    round = null;
    if (alive(mine)) void runFrom(s + 1, mine);
  };

  /**
   * Stand where `p` says, paused, the cube placed rather than turned there. A question is on show again with
   * the faces already picked, and a move handed to the child again with the turns their cube has reported:
   * the same turns fed to a fresh matcher land it exactly where it was, astray or half made included.
   */
  const restore = (p) => {
    at = p.step;
    playing = false;
    if (at >= n) { land(n); phase = 'ended'; return; }
    const step = steps[at];
    if (p.picks) {
      land(at);
      own().next();
      round = createRound(built, span.first[at]);
      for (const face of p.picks) round.select(face);
      narration.show(step.round.voice ? '' : step.round.say);
      phase = 'asking';
      return;
    }
    if (p.fed) {
      follow = createMoveFollower(turnsOfStep(built, at), span.last[at] - span.first[at] + 1);
      for (const notation of p.fed) follow.feed(notation);
      if (follow.drawn) own().seek(span.first[at] - 1 + follow.drawn);
      else { land(at); own().describe(span.first[at]); }
      narration.show(step.say);
      phase = 'yours';
      return;
    }
    if (p.waiting) {
      own().seek(span.last[at]);
      narration.show(p.words);
      problem = p.problem;
      phase = 'waiting';
      return;
    }
    land(at);
    phase = 'ready';
  };
  if (from !== null) restore(from);

  return Object.freeze({
    get view() { return view(); },

    /**
     * Where the lesson rests, as a record `from` restores (`progressRefusal` says what one may hold). Taken
     * whenever -- a step part played rests before that step, a reveal part played rests at its question
     * asked again, and a child's move already made rests at the step after it.
     */
    progress() {
      if (phase === 'ended' || at >= n) return Object.freeze({ step: n });
      if (childMoved) return Object.freeze({ step: at + 1 });
      if (phase === 'asking' && round && !round.state.locked) return Object.freeze({ step: at, picks: round.state.picked });
      if (phase === 'asking' || phase === 'revealing' || (phase === 'waiting' && steps[at].round)) {
        return Object.freeze({ step: at, picks: Object.freeze([]) });
      }
      if (phase === 'yours') return Object.freeze({ step: at, fed: follow ? follow.fed : Object.freeze([]) });
      if (phase === 'waiting') return Object.freeze({ step: at, waiting: true, words: narration.words, problem });
      return Object.freeze({ step: at });
    },
    get sections() { return sections; },

    /**
     * Play. From where the lesson is; from the top once it has ended; the same step again after a device
     * refused to start its sound; and ON from a step that is waiting, because Play is how a child says
     * "go on".
     */
    play() {
      if (disposed) return;
      if (phase === 'ended') { playing = true; goTo(0); return; }
      if (phase === 'waiting') {
        if (problem?.reason === 'NotAllowedError') { playing = true; goTo(at); return; }
        goOn();
        return;
      }
      if (playing) return;
      playing = true;
      // A held recording continues; a run parked between two turns is released. Both, when both.
      narration.resume();
      runs.release();
      if (phase === 'ready') { void runFrom(at, runs.current); return; }
      changed();
    },

    /** Stop going on by itself. A recording in progress is held and a turn in progress lands. */
    pause() {
      if (disposed || !playing) return;
      playing = false;
      narration.hold();
      changed();
    },

    /** The step after this one, without waiting for anything this one is waiting for. */
    next: () => { if (!disposed) goOn(); },

    /** The step before this one. */
    back() { if (!disposed) goTo(at - 1); },

    /** This step again, from its beginning, playing. */
    replay() { if (disposed) return; playing = true; goTo(Math.min(at, n - 1)); },

    /** A section's first step, keeping whether the lesson was playing. */
    seekStep(s) {
      if (disposed) return;
      // VALIDATED FIRST. `goTo` cancels the run and writes `at` before the driver refuses a position that is
      // not a whole number, so `seekStep(0.5)` left a lesson half-changed (audit, 2026-09-21).
      if (!Number.isInteger(s)) throw new RangeError(`script-lesson: seekStep takes a step number, not ${JSON.stringify(s)}`);
      goTo(s);
    },

    /** Pick a face for the round being asked. The answer is computed from the cube, never written down. */
    select(face) {
      if (disposed || phase !== 'asking' || !round) return null;
      const s = round.select(face);
      changed();
      if (s.locked) {
        playing = true;
        void reveal(at, runs.current);
      }
      return s;
    },

    /** The child says the move is made. */
    done() {
      if (disposed || phase !== 'yours') return;
      void finishYours();
    },

    /**
     * A turn the child's smart cube reported, in the cube's own letters. Followed only while a `yours` step
     * is waiting and its turns are ones a cube can report; each completed turn is mirrored on the drawing.
     */
    turn(notation) {
      if (disposed || phase !== 'yours' || !follow?.confirmable) return null;
      // Each face turn of a `yours` step is a group of its own, so each is one stop to follow: the drawing
      // follows as many as the follower says are newly done (`createMoveFollower`).
      const { r, due } = follow.feed(notation);
      for (let i = 0; i < due; i++) own().next();
      changed();
      if (r.kind === 'complete') void finishYours();
      return r;
    },

    /** Leave: nothing this lesson started may write to the cube or speak again. */
    dispose() {
      if (disposed) return;
      cancel();
      playing = false;
      // TERMINAL, and the cube still. `cancel()` stopped this lesson's runs, but a turn the renderer was
      // animating went on, and a retained reference could call `play()` and start the narration again
      // (audit, 2026-09-21).
      disposed = true;
      driver.halt();
    },
  });
}
