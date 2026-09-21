// A script played as a lesson — dev-docs/adr/0007-the-course-plays-scripts-a-clip-per-line.md.
//
// The host is driven here against a voice that plays nothing and a clock that moves only when told, so
// every rule about WHEN the lesson moves on is pinned without a browser: a step lasts as long as its
// recording, words without one wait for Next, a round and a move handed to the child wait for the child,
// and nothing a superseded run started may speak or write again. The narration is placeholder prose, as
// every course fixture in this repository is (ADR 0006 decision 7).
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VERDICT_MS, createMoveFollower, createNarration, createScriptLesson, createSequencer, createTurnMatcher, narrate, progressRefusal,
  sectionsOf, turnsOfStep,
} from '../lib/script-lesson.js';
import { buildScript, groupsOf } from '../lib/script-view.js';
import { answerAt } from '../lib/script-rounds.js';
import { parse } from '../lib/cube-notation.js';
import { MANIFEST } from './browser/public-cube.mjs';

const LESSON = {
  schema: 2,
  start: { scramble: "R U R' U'" },
  steps: [
    { section: 'part 0', say: 'line 0', voice: 'v/0.m4a' },
    { move: 'R U', say: 'line 1', voice: 'v/1.m4a' },
    { say: 'line 2' },
    { move: 'R', yours: true, say: 'line 3', voice: 'v/3.m4a' },
    { round: { say: 'line 4', voice: 'v/4.m4a', ask: 'whereIs:UF', choose: 2, reveal: [{ hl: 'slot:UF', say: 'line 5', voice: 'v/5.m4a' }] } },
    { section: 'part 1', move: "U'" },
  ],
};

/** A voice that plays nothing: it records what it was asked, and a test says when a recording ends. */
function silentVoice() {
  const log = [];
  let pending = null;
  const settle = (result) => { const p = pending; pending = null; p?.resolve(result); return p?.ref ?? null; };
  return {
    log,
    speak(ref) {
      settle('stopped');
      log.push(['speak', ref]);
      return new Promise((resolve) => { pending = { ref, resolve }; });
    },
    stop() { log.push(['stop']); settle('stopped'); },
    pause() { log.push(['pause']); },
    resume() { log.push(['resume']); },
    /** The recording in progress ends — or fails, with the reason given. */
    finish: (result = 'ended') => settle(result),
    get speaking() { return pending?.ref ?? null; },
  };
}

/** A clock that moves only when told. */
function manualClock() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const schedule = Object.assign((fn, ms) => { const k = ++id; timers.set(k, { at: now + ms, fn }); return k; }, {
    cancel: (k) => timers.delete(k),
  });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  /** Move the clock on, running what falls due in order and letting each run's awaits resolve. */
  const advance = async (ms) => {
    const until = now + ms;
    await flush();
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await flush();
    }
    now = until;
    await flush();
  };
  return { schedule, advance, flush, pending: () => timers.size };
}

/**
 * An element as the manifest describes it, recording what it is told — the same double
 * `script-drive.test.mjs` uses, so a lesson touching a member the element does not promise throws.
 */
function recordingCube() {
  const calls = [];
  const attrs = new Map();
  const target = {
    calls,
    attrs,
    setAttribute(name, value) { calls.push(['set', name, value]); attrs.set(name, value); },
    removeAttribute(name) { calls.push(['remove', name]); attrs.delete(name); },
    get stops() {
      const out = [0];
      let k = 0;
      for (const g of groupsOf(parse(attrs.get('alg') || ''))) { k += g.length; out.push(k); }
      return out;
    },
    animating: false,
  };
  for (const m of ['step', 'stepBack', 'stepStop', 'stepBackStop', 'seek', 'playTo']) target[m] = (...a) => calls.push([m, ...a]);
  target.turnTo = (...a) => { calls.push(['turnTo', ...a]); return Promise.resolve(true); };
  const allowed = new Set([...MANIFEST.methods, ...MANIFEST.properties.map((p) => p.name), ...Object.keys(MANIFEST.operations), 'calls', 'attrs']);
  return new Proxy(target, {
    get(t, name) {
      if (typeof name === 'string' && !allowed.has(name)) throw new Error(`the manifest lists no member "${name}"`);
      return t[name];
    },
  });
}

function lessonOver(doc = LESSON, { cube = null, settle, voice = silentVoice() } = {}) {
  const built = buildScript(doc);
  const clock = manualClock();
  const views = [];
  const lesson = createScriptLesson(built, {
    cube, voice, schedule: clock.schedule, onChange: (v) => views.push(v), ...(settle ? { settle } : {}),
  });
  return { built, voice, clock, views, lesson };
}

/**
 * A `settle()` the test releases by hand: the cube is still turning until the test says it has landed. The
 * helper above settled every turn at once, so no case ever saw a pause, a Done, a cube's confirmation or a
 * navigation arrive WHILE a turn was in flight (audit, 2026-09-21) -- which is where the defects were.
 */
function heldSettle() {
  const waiting = [];
  return {
    settle: () => new Promise((resolve) => waiting.push(resolve)),
    release() { const r = waiting.shift(); r?.(); return Boolean(r); },
    /** Land the NEWEST turn in flight first — the order a superseded run's older turn does not control. */
    releaseNewest() { const r = waiting.pop(); r?.(); return Boolean(r); },
    get pending() { return waiting.length; },
  };
}

/** `playTo`, releasing each turn as it is asked for. */
async function playToHeld(ctx, held, s) {
  ctx.lesson.play();
  for (let guard = 0; guard < 80 && ctx.lesson.view.step < s; guard++) {
    const v = ctx.lesson.view;
    if (held.pending) held.release();
    else if (v.phase === 'waiting') ctx.lesson.play();
    else if (ctx.voice.speaking) ctx.voice.finish();
    await ctx.clock.advance(1000);
  }
  assert.equal(ctx.lesson.view.step, s, `the lesson did not reach step ${s}`);
}

const spoke = (ctx, ref) => ctx.voice.log.some(([kind, said]) => kind === 'speak' && said === ref);

/** Play from the top to the step `s`, answering every recording as it comes. */
async function playTo(ctx, s) {
  ctx.lesson.play();
  for (let guard = 0; guard < 50 && ctx.lesson.view.step < s; guard++) {
    const v = ctx.lesson.view;
    if (v.phase === 'waiting') ctx.lesson.play();
    else if (v.phase === 'yours') ctx.lesson.done();
    else if (ctx.voice.speaking) ctx.voice.finish();
    await ctx.clock.advance(1000);
  }
  assert.equal(ctx.lesson.view.step, s, `the lesson did not reach step ${s}`);
}

test('nothing plays until Play is pressed, and the first recording starts inside the press', () => {
  const { lesson, voice } = lessonOver();
  assert.equal(lesson.view.phase, 'ready');
  assert.equal(lesson.view.position, 0);
  assert.deepEqual(voice.log, [], 'a lesson began talking because it was opened');
  lesson.play();
  // SYNCHRONOUSLY: a media element is allowed to start inside the user's gesture, and an await between
  // the press and the first `speak` would put the first line outside it.
  assert.deepEqual(voice.log, [['speak', 'v/0.m4a']]);
  assert.equal(lesson.view.words, 'line 0');
});

test('a step lasts as long as its recording, and the lesson moves on when it ends', async () => {
  const { lesson, voice, clock, built } = lessonOver();
  lesson.play();
  await clock.advance(60_000);
  assert.equal(lesson.view.step, 0, 'the lesson moved on while its line was still being said');
  voice.finish();
  await clock.flush();
  assert.equal(voice.speaking, null);
  await clock.advance(450);
  assert.equal(voice.speaking, 'v/1.m4a');
  // Both of the step's stops were played while its line was said: R, then U.
  const last = built.positions.filter((p) => p.step === 1).at(-1).index;
  assert.equal(lesson.view.position, last);
});

test('words with no recording wait for Next, never for a reading time nobody measured', async () => {
  const ctx = lessonOver();
  await playTo(ctx, 2);
  await ctx.clock.advance(1000);
  assert.equal(ctx.lesson.view.phase, 'waiting');
  assert.equal(ctx.lesson.view.words, 'line 2');
  assert.equal(ctx.lesson.view.playing, false);
  await ctx.clock.advance(600_000);
  assert.equal(ctx.lesson.view.step, 2, 'an unrecorded line was given a duration');
  ctx.lesson.play();   // Play is how a child says "go on"
  assert.equal(ctx.lesson.view.step, 3);
});

test('a move handed to the child waits for Done, and the drawing makes it only then', async () => {
  const ctx = lessonOver();
  await playTo(ctx, 3);
  await ctx.clock.flush();
  const { first, last } = { first: ctx.built.positions.find((p) => p.step === 3).index, last: ctx.built.positions.filter((p) => p.step === 3).at(-1).index };
  assert.equal(ctx.lesson.view.phase, 'yours');
  assert.equal(ctx.lesson.view.position, first - 1, 'the drawing made the child\'s move for them');
  assert.equal(ctx.lesson.view.yours.confirmable, true, 'a single face turn is one a smart cube can report');
  ctx.voice.finish();
  await ctx.clock.advance(600_000);
  assert.equal(ctx.lesson.view.phase, 'yours', 'the lesson went on without the child');
  ctx.lesson.done();
  await ctx.clock.flush();
  assert.equal(ctx.lesson.view.position, last);
  await ctx.clock.advance(450);
  assert.equal(ctx.lesson.view.step, 4);
  assert.equal(ctx.lesson.view.phase, 'asking');
});

test('a smart cube confirms the child\'s move turn by turn, and a wrong turn waits until it is undone', async () => {
  const ctx = lessonOver();
  await playTo(ctx, 3);
  const before = ctx.lesson.view.position;
  assert.equal(ctx.lesson.turn('U').kind, 'wrong');
  assert.equal(ctx.lesson.view.yours.wrong, 'U');
  assert.equal(ctx.lesson.view.position, before, 'a wrong turn moved the drawing');
  assert.equal(ctx.lesson.turn("U'").kind, 'back');
  assert.equal(ctx.lesson.view.yours.wrong, null);
  assert.equal(ctx.lesson.turn('R').kind, 'complete');
  assert.equal(ctx.lesson.view.position, before + 1, 'the drawing did not follow the child\'s turn');
  await ctx.clock.advance(450);
  assert.equal(ctx.lesson.view.step, 4, 'a completed move did not let the lesson go on');
  assert.equal(ctx.lesson.turn('R'), null, 'turns are followed only while a move is the child\'s');
});

test('a round waits for its answer, locks at `choose`, and plays its reveal with its own recording', async () => {
  const ctx = lessonOver();
  await playTo(ctx, 4);
  assert.equal(ctx.lesson.view.phase, 'asking');
  assert.equal(ctx.voice.speaking, 'v/4.m4a');
  assert.equal(ctx.lesson.view.words, 'line 4');
  const roundAt = ctx.built.positions.find((p) => p.step === 4).index;
  const { faces } = answerAt(ctx.built, roundAt);
  await ctx.clock.advance(600_000);
  assert.equal(ctx.lesson.view.phase, 'asking', 'the question went away unanswered');
  ctx.lesson.select(faces[0]);
  assert.equal(ctx.lesson.view.round.locked, false);
  ctx.lesson.select(faces[1]);
  assert.equal(ctx.lesson.view.round.verdict, 'right');
  assert.equal(ctx.lesson.view.phase, 'revealing');
  assert.equal(ctx.lesson.select('D'), null, 'a pick after the round locked was taken');
  await ctx.clock.advance(900);
  assert.equal(ctx.voice.speaking, 'v/5.m4a', 'the reveal did not speak its own line');
  ctx.voice.finish();
  await ctx.clock.advance(450);
  // The last step is a silent move: it plays and the lesson ends.
  await ctx.clock.advance(450);
  assert.equal(ctx.lesson.view.phase, 'ended');
});

test('after a reveal the lesson reloads its own cube rather than drawing over the reveal\'s', async () => {
  const cube = recordingCube();
  const ctx = lessonOver(LESSON, { cube });
  await playTo(ctx, 4);
  const roundAt = ctx.built.positions.find((p) => p.step === 4).index;
  const { faces } = answerAt(ctx.built, roundAt);
  ctx.lesson.select(faces[0]);
  ctx.lesson.select(faces[1]);
  await ctx.clock.advance(900);
  const revealDone = cube.calls.length;
  ctx.voice.finish();
  await ctx.clock.advance(900);
  const after = cube.calls.slice(revealDone);
  // The reveal wrote a segment of its own. The lesson's writer believed it still held the round's, so
  // without a fresh one it would have played step 5's turn onto the reveal's cube with no reload.
  const lastMove = ctx.built.positions.find((p) => p.step === 5);
  const segment = ctx.built.segments[lastMove.segment];
  const reloadedAlg = after.findIndex(([c, name, value]) => c === 'set' && name === 'alg' && value === segment.alg);
  assert.ok(reloadedAlg >= 0, 'the lesson\'s own segment was never written back after the reveal');
  const played = after.findIndex(([c]) => c === 'stepStop' || c === 'playTo');
  assert.ok(played > reloadedAlg, 'step 5\'s turn was played before the lesson\'s cube was loaded back');
});

test('a recording that fails is said to have failed at its step, and Play goes on from there', async () => {
  const { lesson, voice, clock } = lessonOver();
  lesson.play();
  voice.finish('NotSupportedError');
  await clock.flush();
  assert.equal(lesson.view.phase, 'waiting');
  // The problem names the RECORDING as well as the step, so a screen reports the file that failed rather
  // than reconstructing it from whichever step it thinks was playing (audit, 2026-09-21).
  assert.deepEqual({ ...lesson.view.problem }, { step: 0, reason: 'NotSupportedError', ref: 'v/0.m4a' });
  await clock.advance(600_000);
  assert.equal(lesson.view.step, 0, 'a failed recording was skipped past in silence');
  lesson.play();
  assert.equal(lesson.view.step, 1);
  assert.equal(voice.speaking, 'v/1.m4a');
  assert.equal(lesson.view.problem, null);
});

test('a device that will not start the sound stops the lesson, and Play tries the same step again', async () => {
  const { lesson, voice, clock } = lessonOver();
  lesson.play();
  voice.finish('NotAllowedError');
  await clock.flush();
  assert.equal(lesson.view.playing, false);
  lesson.play();
  assert.equal(lesson.view.step, 0, 'Play after a refusal skipped the line it could not say');
  assert.equal(voice.speaking, 'v/0.m4a');
});

test('pause holds the recording and Play continues it, including while the child is being asked', async () => {
  const ctx = lessonOver();
  ctx.lesson.play();
  ctx.lesson.pause();
  assert.deepEqual(ctx.voice.log.at(-1), ['pause']);
  ctx.lesson.play();
  assert.deepEqual(ctx.voice.log.at(-1), ['resume'], 'Play started the line over rather than continuing it');
  assert.equal(ctx.voice.log.filter(([c]) => c === 'speak').length, 1);

  await playTo(ctx, 4);
  ctx.lesson.pause();
  ctx.lesson.play();
  assert.deepEqual(ctx.voice.log.at(-1), ['resume'], 'a paused question stayed paused');
});

test('a paused lesson stays at the turn it paused on, and goes on from there', async () => {
  const { lesson, voice, clock } = lessonOver();
  lesson.play();
  voice.finish();
  lesson.pause();
  await clock.advance(10_000);
  assert.equal(lesson.view.step, 0, 'a paused lesson went on by itself');
  lesson.play();
  await clock.advance(450);
  assert.equal(voice.speaking, 'v/1.m4a');
});

test('Back, Next and a section land without animating, and keep whether the lesson was playing', async () => {
  const { lesson, voice, built } = lessonOver();
  assert.deepEqual(sectionsOf(built).map((s) => [s.step, s.label]), [[0, 'part 0'], [5, 'part 1']]);
  lesson.seekStep(5);
  assert.equal(lesson.view.phase, 'ready');
  assert.equal(lesson.view.position, built.positions.find((p) => p.step === 5).index - 1);
  assert.equal(lesson.view.section, 'part 1');
  assert.deepEqual(voice.log.filter(([c]) => c === 'speak'), [], 'a jump while paused started talking');
  lesson.back();
  assert.equal(lesson.view.step, 4);
  assert.equal(lesson.view.phase, 'ready');
  lesson.play();
  assert.equal(lesson.view.phase, 'asking');
  lesson.next();
  assert.equal(lesson.view.step, 5, 'Next did not skip the question');
});

test('a disposed lesson never speaks or writes again', async () => {
  const cube = recordingCube();
  const { lesson, voice, clock } = lessonOver(LESSON, { cube });
  lesson.play();
  lesson.dispose();
  const calls = cube.calls.length;
  voice.finish();
  await clock.advance(60_000);
  assert.equal(voice.log.filter(([c]) => c === 'speak').length, 1);
  assert.equal(cube.calls.length, calls, 'a disposed lesson wrote to the element');
});

test('a lesson needs a voice, and says so', () => {
  assert.throws(() => createScriptLesson(buildScript(LESSON), {}), /needs a voice with speak\(\) and stop\(\)/);
});

test('the turns a smart cube can confirm are face turns in the cube\'s own letters, or none at all', () => {
  const built = buildScript({ schema: 2, start: { hold: 'U F' }, steps: [{ move: "R U2 R'", yours: true }, { move: "y R", yours: true }] });
  assert.deepEqual(turnsOfStep(built, 0), ['R', 'U2', "R'"]);
  assert.equal(turnsOfStep(built, 1), null, 'a whole-cube turn is not something a cube reports');
  // Held upside down with green still in front, the child's right hand is on the cube's L face, and that
  // face is what the cube reports. (Tumbled forward instead — `D B` — right stays right.)
  const held = buildScript({ schema: 2, start: { hold: 'D F' }, steps: [{ move: 'R', yours: true }] });
  assert.deepEqual(turnsOfStep(held, 0), ['L']);
  const tumbled = buildScript({ schema: 2, start: { hold: 'D B' }, steps: [{ move: 'R', yours: true }] });
  assert.deepEqual(turnsOfStep(tumbled, 0), ['R']);
});

test('the matcher: a half turn either way round, a wrong turn undone, and a half turn reversed', () => {
  const m = createTurnMatcher(['R', 'U2']);
  assert.equal(m.feed('R').kind, 'step');
  assert.equal(m.feed("U'").kind, 'progress');
  assert.equal(m.feed("U'").kind, 'complete');

  const w = createTurnMatcher(['R']);
  assert.equal(w.feed('F').kind, 'wrong');
  assert.equal(w.feed('R').kind, 'wrong', 'the right turn made while off the sequence counted');
  assert.equal(w.feed("R'").kind, 'wrong');
  assert.equal(w.feed("F'").kind, 'back');
  assert.equal(w.feed('R').kind, 'complete');

  // U then U' is the cube back where it started -- NOT two wrong turns (audit, 2026-09-21). This case used
  // to assert the opposite, which kept a child who turned back from ever finishing: U U was then refused.
  const h = createTurnMatcher(['U2']);
  assert.equal(h.feed('U').kind, 'progress');
  assert.equal(h.feed("U'").kind, 'back', 'a half turn begun and then reversed counted as two wrong turns');
  assert.equal(h.state.astray, 0);
  assert.equal(h.feed('U').kind, 'progress');
  assert.equal(h.feed('U').kind, 'complete', 'the half turn could not be made after being taken back');

  // A half turn REPORTED WHOLE is both quarters, always (audit, 2026-09-21). Asking for R and receiving R2
  // is a quarter too far, not a finished step; a wrong U2 is two wrong quarters, undone by two.
  const over = createTurnMatcher(['R']);
  assert.equal(over.feed('R2').kind, 'wrong', 'R2 was accepted for R');
  assert.equal(over.state.astray, 1);
  assert.equal(over.feed("R'").kind, 'complete', 'taking the extra quarter back did not finish the step');
  const wrong2 = createTurnMatcher(['R']);
  assert.equal(wrong2.feed('U2').kind, 'wrong');
  assert.equal(wrong2.state.astray, 2, 'a wrong half turn was counted as one quarter');
  assert.equal(wrong2.feed("U'").kind, 'wrong', 'one quarter back undid a half turn');
  assert.equal(wrong2.feed("U'").kind, 'back');

  assert.equal(createTurnMatcher(['R2']).feed('R2').kind, 'complete', 'a cube reporting a half turn whole');
  assert.equal(createTurnMatcher(['R']).feed('x').kind, 'ignored');
  assert.throws(() => createTurnMatcher(['M']), /"M" is not a face turn a cube can report/);
});

// The 2026-09-21 audit of the course-player branch: the engine, with a turn IN FLIGHT.

test('pausing after Done holds the lesson: the move lands, and nothing else plays until Play', async () => {
  const held = heldSettle();
  const ctx = lessonOver(LESSON, { settle: held.settle });
  await playToHeld(ctx, held, 3);
  ctx.lesson.done();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, "the child's move was not being drawn");
  ctx.lesson.pause();
  held.release();
  await ctx.clock.advance(5000);
  assert.ok(!spoke(ctx, 'v/4.m4a'), 'the next recording started while the lesson was paused');
  ctx.lesson.play();
  await ctx.clock.advance(5000);
  assert.ok(spoke(ctx, 'v/4.m4a'), 'Play did not go on from where the pause held it');
});

test('pausing while an ordinary move turns lets that turn land and starts no other until Play', async () => {
  const held = heldSettle();
  const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ move: "R U R'", say: 'watch', voice: 'v/w.m4a' }, { say: 'after', voice: 'v/after.m4a' }] };
  const ctx = lessonOver(doc, { settle: held.settle });
  ctx.lesson.play();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, 'the first turn was not in flight');
  const first = ctx.lesson.view.position;
  ctx.lesson.pause();
  held.release();
  await ctx.clock.advance(5000);
  assert.equal(held.pending, 0, 'a second turn started while the lesson was paused');
  assert.equal(ctx.lesson.view.position, first, 'the drawing moved on while paused');
  ctx.lesson.play();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, 'Play did not go on to the next turn');
  assert.equal(ctx.lesson.view.position, first + 1);
});

test("pausing while a reveal's move turns holds the reveal there, and the lesson goes on only after Play", async () => {
  const held = heldSettle();
  const doc = {
    schema: 2, start: { scramble: "R U R' U'" },
    steps: [
      { round: { say: 'where', voice: 'v/q.m4a', ask: 'whereIs:UF', choose: 2, reveal: [{ move: "U R", say: 'watch', voice: 'v/r.m4a' }] } },
      { say: 'after', voice: 'v/after.m4a' },
    ],
  };
  const ctx = lessonOver(doc, { settle: held.settle });
  ctx.lesson.play();
  await ctx.clock.advance(0);
  ctx.voice.finish();
  await ctx.clock.flush();
  ctx.lesson.select('U');
  ctx.lesson.select('F');
  await ctx.clock.advance(VERDICT_MS);
  assert.equal(ctx.lesson.view.phase, 'revealing');
  assert.equal(held.pending, 1, "the reveal's first turn was not in flight");
  ctx.lesson.pause();
  held.release();
  await ctx.clock.advance(5000);
  assert.equal(held.pending, 0, "the reveal's next turn started while the lesson was paused");
  ctx.voice.finish();
  await ctx.clock.advance(5000);
  assert.ok(!spoke(ctx, 'v/after.m4a'), 'the lesson left the reveal while paused');
  ctx.lesson.play();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, "Play did not go on to the reveal's next turn");
  held.release();
  await ctx.clock.advance(5000);
  assert.ok(spoke(ctx, 'v/after.m4a'), 'the lesson never went on after the reveal');
});

test("pausing while Done plays a several-turn move lets the turn land and plays none of the rest until Play", async () => {
  const held = heldSettle();
  const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ say: 'go', voice: 'v/a.m4a' }, { move: "R U R'", yours: true, say: 'your turn' }, { say: 'after', voice: 'v/after.m4a' }] };
  const ctx = lessonOver(doc, { settle: held.settle });
  await playToHeld(ctx, held, 1);
  const before = ctx.lesson.view.position;
  ctx.lesson.done();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, "the child's move was not being drawn");
  ctx.lesson.pause();
  held.release();
  await ctx.clock.advance(5000);
  assert.equal(held.pending, 0, 'the second turn of the move started while paused');
  assert.equal(ctx.lesson.view.position, before + 1);
  ctx.lesson.play();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, 'Play did not go on with the move');
  held.release();
  await ctx.clock.advance(0);
  held.release();
  await ctx.clock.advance(0);            // the last turn landed; the pause between steps has not yet run
  assert.equal(ctx.lesson.view.position, before + 3, 'the move was not drawn whole');
  await ctx.clock.advance(5000);
  assert.ok(spoke(ctx, 'v/after.m4a'));
});

test('a move the cube confirms lands on the drawing before the next step begins', async () => {
  const held = heldSettle();
  const ctx = lessonOver(LESSON, { settle: held.settle });
  await playToHeld(ctx, held, 3);
  assert.equal(ctx.lesson.turn('R').kind, 'complete');
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, 'the last drawn turn was not waited for');
  await ctx.clock.advance(5000);
  assert.ok(!spoke(ctx, 'v/4.m4a'), 'the next step began over a cube still turning');
  held.release();
  await ctx.clock.advance(5000);
  assert.ok(spoke(ctx, 'v/4.m4a'));
});

test('Next during a turn lands it before the next step', async () => {
  const held = heldSettle();
  const cube = recordingCube();
  const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ move: 'R', say: 'a' }, { move: 'U', say: 'b' }] };
  const ctx = lessonOver(doc, { cube, settle: held.settle });
  ctx.lesson.play();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, 'the first move was not turning');
  cube.animating = true;
  cube.calls.length = 0;
  ctx.lesson.next();
  assert.ok(cube.calls.some(([m]) => m === 'seek'), 'Next left the turn in flight unlanded');
});

test('a turn still in flight when Next is pressed, landing afterwards, draws nothing more for the step it belonged to', async () => {
  // The other half of cancellation: the superseded run is still AWAITING that turn, and when it lands the run
  // must find it is over. The cases above never released it (verify pass, 2026-09-21: removing the loop's
  // stale-run checks passed every test).
  const held = heldSettle();
  const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ move: "R U R'", say: 'a', voice: 'v/a.m4a' }, { move: 'U', say: 'b', voice: 'v/b.m4a' }] };
  const ctx = lessonOver(doc, { settle: held.settle });
  ctx.lesson.play();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, 'the first step was not turning');
  ctx.lesson.next();
  await ctx.clock.advance(0);
  const second = ctx.built.positions.find((q) => q.step === 1).index;
  assert.equal(ctx.lesson.view.position, second, 'precondition: the next step is drawing its own turn');
  assert.equal(held.pending, 2, "precondition: the old step's turn and the new step's turn are both in flight");
  held.release();                        // the OLD turn lands
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, 'the superseded run drew another turn when its old one landed');
  assert.equal(ctx.lesson.view.position, second, 'the superseded run moved the drawing');
});

test("a superseded run whose turn lands while the lesson is paused does not take the current run's place at the pause", async () => {
  // A stale run that reached the pause gate would REPLACE the current run as the one Play releases: Play then
  // woke the stale run, which found itself over and stopped, and the current run waited forever.
  const held = heldSettle();
  const doc = {
    schema: 2, start: { scramble: "R U R' U'" },
    steps: [{ move: "R U R'", say: 'a', voice: 'v/a.m4a' }, { move: 'U R', say: 'b', voice: 'v/b.m4a' }, { say: 'c', voice: 'v/c.m4a' }],
  };
  const ctx = lessonOver(doc, { settle: held.settle });
  ctx.lesson.play();
  await ctx.clock.advance(0);
  ctx.lesson.next();                     // the old run is still awaiting its turn
  await ctx.clock.advance(0);
  ctx.lesson.pause();
  held.releaseNewest();                  // the current run's turn lands, and it waits at the pause
  await ctx.clock.advance(0);
  held.release();                        // then the superseded run's older turn lands
  await ctx.clock.advance(0);
  assert.equal(held.pending, 0, 'a turn started while paused');
  ctx.lesson.play();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1, "Play did not wake the current run: the stale one had taken its place at the pause");
});

test('a run held at the pause, woken by the action that supersedes it, stops there', async () => {
  // Cancelling OPENS the gate on purpose, so a held run wakes and finds it is over — and it must look.
  const held = heldSettle();
  const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ move: "R U R'", say: 'a', voice: 'v/a.m4a' }, { move: 'U', say: 'b', voice: 'v/b.m4a' }] };
  const ctx = lessonOver(doc, { settle: held.settle });
  ctx.lesson.play();
  await ctx.clock.advance(0);
  ctx.lesson.pause();
  held.release();                        // the turn lands; the run now waits at the pause
  await ctx.clock.advance(0);
  assert.equal(held.pending, 0);
  ctx.lesson.next();                     // supersedes it — and opens its gate; a paused lesson stays paused
  await ctx.clock.advance(0);
  const second = ctx.built.positions.find((q) => q.step === 1).index;
  assert.equal(held.pending, 0, 'the woken, superseded run drew another turn');
  assert.equal(ctx.lesson.view.position, second - 1, 'the cube is not as it stands before the next step');
  assert.equal(ctx.lesson.view.playing, false);
});

test('a turn still in flight when the lesson is disposed, landing afterwards, reaches neither the cube nor the voice', async () => {
  const held = heldSettle();
  const cube = recordingCube();
  const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ move: "R U R'", say: 'a', voice: 'v/a.m4a' }, { say: 'b', voice: 'v/b.m4a' }] };
  const ctx = lessonOver(doc, { cube, settle: held.settle });
  ctx.lesson.play();
  await ctx.clock.advance(0);
  assert.equal(held.pending, 1);
  ctx.lesson.dispose();
  const calls = cube.calls.length;
  const said = ctx.voice.log.length;
  held.release();
  await ctx.clock.advance(5000);
  assert.equal(held.pending, 0, 'a disposed lesson asked for another turn');
  assert.deepEqual(cube.calls.slice(calls), [], 'a disposed lesson wrote to the cube after its turn landed');
  assert.deepEqual(ctx.voice.log.slice(said), [], 'a disposed lesson spoke after its turn landed');
});

test('a disposed lesson halts the cube and cannot be started again', async () => {
  const held = heldSettle();
  const cube = recordingCube();
  const ctx = lessonOver(LESSON, { cube, settle: held.settle });
  ctx.lesson.play();
  await ctx.clock.advance(0);
  cube.calls.length = 0;
  ctx.lesson.dispose();
  assert.ok(cube.calls.some(([m]) => m === 'seek'), 'the turn in flight was not halted');
  const speaks = () => ctx.voice.log.filter(([kind]) => kind === 'speak').length;
  const before = speaks();
  ctx.lesson.play();
  ctx.lesson.replay();
  ctx.lesson.next();
  await ctx.clock.advance(5000);
  assert.equal(speaks(), before, 'a disposed lesson spoke again');
});

test('seekStep refuses a position that is not a step number, and changes nothing', async () => {
  const ctx = lessonOver();
  await playTo(ctx, 2);
  const { step, phase, playing } = ctx.lesson.view;
  assert.throws(() => ctx.lesson.seekStep(0.5), RangeError);
  assert.throws(() => ctx.lesson.seekStep(Number.NaN), RangeError);
  assert.deepEqual([ctx.lesson.view.step, ctx.lesson.view.phase, ctx.lesson.view.playing], [step, phase, playing]);
});

test('a recording that REJECTS is a failed recording, not a lesson still saying it plays', async () => {
  const voice = {
    speak: () => Promise.reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })),
    stop() {}, pause() {}, resume() {},
  };
  const ctx = lessonOver(LESSON, { voice });
  ctx.lesson.play();
  await ctx.clock.advance(1000);
  assert.equal(ctx.lesson.view.problem?.reason, 'NotSupportedError', 'the rejection was not reported');
  assert.equal(ctx.lesson.view.playing, false, 'the lesson went on saying it was playing');
});

test('one report that completes two turns moves the drawing two stops', async () => {
  const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ say: 'go', voice: 'v/a.m4a' }, { move: 'R R U', yours: true, say: 'your turn' }] };
  const ctx = lessonOver(doc);
  await playTo(ctx, 1);
  const from = ctx.lesson.view.position;
  assert.equal(ctx.lesson.turn('R2').done, 2);
  assert.equal(ctx.lesson.view.position, from + 2, 'the drawing followed one of the two turns made');
});

test('a report that completes a turn and begins, or strays from, the next still moves the drawing for the one done', async () => {
  for (const [move, report, kind] of [["R R2 U", 'R2', 'progress'], ['R U', 'R2', 'wrong']]) {
    const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ say: 'go', voice: 'v/a.m4a' }, { move, yours: true, say: 'your turn' }] };
    const ctx = lessonOver(doc);
    await playTo(ctx, 1);
    const from = ctx.lesson.view.position;
    const r = ctx.lesson.turn(report);
    assert.equal(r.kind, kind, `${report} for ${move}`);
    assert.equal(r.done, 1);
    assert.equal(ctx.lesson.view.position, from + 1, `${report} for ${move} finished a turn the drawing did not follow`);
  }
});

test('a move handed to the child is described on the cube before it is made', async () => {
  const cube = recordingCube();
  const doc = {
    schema: 2, start: { scramble: "R U R' U'" },
    steps: [{ say: 'go', voice: 'v/a.m4a' }, { move: 'R', yours: true, say: 'turn it', arrow: 'R', hl: 'slot:UF' }],
  };
  const ctx = lessonOver(doc, { cube });
  await playTo(ctx, 1);
  assert.notEqual(cube.attrs.get('arrow') ?? 'none', 'none', "the step's arrow was not drawn");
  assert.notEqual(cube.attrs.get('highlight') ?? 'none', 'none', "the step's highlight was not drawn");
});

// ---------------------------------------------------------------------------------------------------------
// Progress: where a lesson rests, carried across a screen rebuild (audit, 2026-09-21: a script lesson at step 2
// of 3 came back at step 1 after `renderScreen()`, because every mount built a fresh lesson).

/** What a child can see of where a lesson is -- the parts a restore must reproduce. */
const resting = (v) => ({
  step: v.step, phase: v.phase, playing: v.playing, words: v.words, problem: v.problem,
  round: v.round, yours: v.yours, position: v.position,
});

/** The lesson rebuilt from `ctx`'s progress: a new lesson, a new voice, the same built script. */
function restored(ctx) {
  const progress = ctx.lesson.progress();
  assert.equal(progressRefusal(ctx.built, progress), null, 'a record progress() made was refused');
  const voice = silentVoice();
  const views = [];
  const lesson = createScriptLesson(ctx.built, { voice, schedule: manualClock().schedule, onChange: (v) => views.push(v), from: progress });
  return { progress, voice, views, lesson };
}

/** The original lesson, paused -- a restore is always paused, so this is the view it must match. */
const pausedView = (ctx) => ({ ...resting(ctx.lesson.view), playing: false });

test('a lesson standing before a step comes back before that step', async () => {
  const ctx = lessonOver();
  ctx.lesson.seekStep(1);
  const back = restored(ctx);
  assert.deepEqual(back.progress, { step: 1 });
  assert.deepEqual(resting(back.lesson.view), pausedView(ctx));
});

test('a step that has played and waits to go on comes back waiting, its words still shown', async () => {
  const ctx = lessonOver();
  await playTo(ctx, 2);
  await ctx.clock.advance(1000);
  assert.equal(ctx.lesson.view.phase, 'waiting');
  const back = restored(ctx);
  assert.deepEqual(resting(back.lesson.view), pausedView(ctx));
  assert.equal(back.lesson.view.words, 'line 2');
  back.lesson.play();                        // Play goes on, as it does from any waiting step
  assert.equal(back.lesson.view.step, 3);
});

test('a question asked and part answered comes back asked, with the faces already picked', async () => {
  const ctx = lessonOver();
  await playTo(ctx, 4);
  ctx.voice.finish();
  await ctx.clock.flush();
  ctx.lesson.select('U');
  const back = restored(ctx);
  assert.deepEqual(back.progress, { step: 4, picks: ['U'] });
  assert.deepEqual(resting(back.lesson.view), pausedView(ctx));
  assert.equal(back.lesson.select('F').locked, true, 'the restored question did not take the second face');
});

test("a move handed to the child comes back handed over, with the turns their cube made -- a wrong one too", async () => {
  const doc = { schema: 2, start: { scramble: "R U R' U'" }, steps: [{ say: 'go', voice: 'v/a.m4a' }, { move: "R U R'", yours: true, say: 'your turn' }] };
  const ctx = lessonOver(doc);
  await playTo(ctx, 1);
  assert.equal(ctx.lesson.turn('R').kind, 'step');
  assert.equal(ctx.lesson.turn('D').kind, 'wrong');
  const back = restored(ctx);
  assert.deepEqual(back.progress, { step: 1, fed: ['R', 'D'] });
  assert.deepEqual(resting(back.lesson.view), pausedView(ctx));
  assert.equal(back.lesson.view.yours.wrong, 'D');
  assert.equal(back.lesson.turn("D'").kind, 'back', 'the restored matcher did not know the cube was astray');
  assert.equal(back.lesson.turn('U').kind, 'step');
});

test('a restored lesson is paused and says nothing until it is asked to', async () => {
  const ctx = lessonOver();
  await playTo(ctx, 3);
  const back = restored(ctx);
  assert.equal(back.lesson.view.playing, false);
  assert.deepEqual(back.voice.log, [], 'restoring a lesson started a recording');
  assert.deepEqual(back.views, [], 'restoring reported a change nobody made');
});

test("a child's move already made rests at the step after it, and a reveal part played rests at its question", async () => {
  const ctx = lessonOver();
  await playTo(ctx, 3);
  ctx.lesson.done();
  assert.deepEqual(ctx.lesson.progress(), { step: 4 }, "the child would be asked again for a move their cube has made");
  await ctx.clock.advance(450);
  ctx.voice.finish();
  await ctx.clock.flush();
  ctx.lesson.select('U');
  ctx.lesson.select('F');
  assert.equal(ctx.lesson.view.phase, 'revealing');
  assert.deepEqual(ctx.lesson.progress(), { step: 4, picks: [] });
});

test('a step part played rests before that step, and an ended lesson rests at its end', async () => {
  const ctx = lessonOver();
  ctx.lesson.play();
  await ctx.clock.flush();
  assert.equal(ctx.lesson.view.phase, 'playing');
  assert.deepEqual(ctx.lesson.progress(), { step: 0 });
  ctx.lesson.seekStep(ctx.built.script.steps.length);
  const back = restored(ctx);
  assert.equal(back.lesson.view.phase, 'ended');
});

test('progress that does not fit the lesson is refused by name, and a lesson will not be built on it', () => {
  const built = buildScript(LESSON);
  const refusals = [
    [{ step: 99 }, /not a step/],
    [{ step: 1.5 }, /not a step/],
    [null, /not a step/],
    [{ step: 1, picks: [] }, /asks nothing/],
    [{ step: 4, picks: ['U', 'F'] }, /answer the question/],
    [{ step: 4, picks: ['Q'] }, /not a face/],
    [{ step: 3, fed: ['R'] }, /make the move/],
    [{ step: 1, fed: [] }, /no move/],
    [{ step: 3, waiting: true, words: '', problem: null }, /waits for the child/],
    [{ step: 2, waiting: true, words: 'line 2', problem: { step: 1 } }, /not about this step/],
    [{ step: 4, picks: [], fed: [] }, /one place at a time/],
    [{ step: 6, picks: [] }, /ended/],
  ];
  for (const [progress, why] of refusals) {
    assert.match(progressRefusal(built, progress) ?? 'accepted', why, JSON.stringify(progress));
    // `from: null` is "no progress" -- the lesson from its start -- so only a record is held to fitting.
    if (progress !== null) assert.throws(() => createScriptLesson(built, { voice: silentVoice(), from: progress }), RangeError);
  }
  assert.equal(progressRefusal(built, { step: 3, fed: [] }), null);
});

// ---------------------------------------------------------------------------------------------------------
// The lesson's parts, each on its own (the split of 2026-09-21: the sequencing, following the child's move,
// and speaking a recording had been closures over one factory's shared state).

test('the sequencer: a wait is on the clock, a gate holds while paused, and cancelling ends both', async () => {
  const clock = manualClock();
  let playing = false;
  const runs = createSequencer({ schedule: clock.schedule, isPlaying: () => playing });
  const mine = runs.current;
  let waited = false;
  runs.wait(100).then(() => { waited = true; });
  await clock.advance(99);
  assert.equal(waited, false);
  await clock.advance(1);
  assert.equal(waited, true, 'a wait did not end on the clock');
  let through = false;
  runs.gate().then(() => { through = true; });
  await clock.flush();
  assert.equal(through, false, 'a gate let a paused run through');
  runs.release();
  await clock.flush();
  assert.equal(through, true, 'release did not let the held run go on');
  playing = true;
  assert.equal(await Promise.race([runs.gate().then(() => 'open'), clock.flush().then(() => 'held')]), 'open');
  runs.wait(100);
  playing = false;
  let heldThrough = false;
  runs.gate().then(() => { heldThrough = true; });
  runs.cancel();
  await clock.flush();
  assert.notEqual(runs.current, mine, 'cancelling did not end the generation');
  assert.equal(clock.pending(), 0, "cancelling left the generation's timer running");
  assert.equal(heldThrough, true, 'cancelling left a run held at its gate, never to find out it is over');
});

test('the move follower: the drawing follows every turn done, and a move no cube can report follows nothing', () => {
  const f = createMoveFollower(['R', 'R2', 'U'], 3);
  const first = f.feed('R2');
  assert.equal(first.due, 1, 'R then the first quarter of R2: one token done');
  assert.equal(first.r.kind, 'progress');
  assert.equal(f.feed('R').due, 1, 'the second quarter of R2');
  assert.equal(f.feed('D').due, 0);
  assert.equal(f.view().wrong, 'D');
  assert.equal(f.feed('Q').r.kind, 'ignored');
  assert.deepEqual(f.fed, ['R2', 'R', 'D'], 'a report no cube could have meant was kept');
  assert.equal(f.drawn, 2);
  const again = createMoveFollower(['R', 'R2', 'U'], 3);
  for (const x of f.fed) again.feed(x);
  assert.deepEqual(again.view(), f.view(), 'the same turns did not land a fresh follower where this one is');
  const unreportable = createMoveFollower(null, 2);
  assert.equal(unreportable.confirmable, false);
  assert.equal(unreportable.feed('R'), null);
  assert.deepEqual(unreportable.fed, []);
});

test('narrate: a recording that throws, rejects or ends is always an answer, never an exception', async () => {
  assert.deepEqual(await narrate({ speak: () => 'ended' }, 'a.m4a'), { result: 'ended', ref: 'a.m4a' });
  assert.deepEqual(await narrate({ speak: () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } }, 'b.m4a'), { result: 'NotAllowedError', ref: 'b.m4a' });
  assert.deepEqual(await narrate({ speak: () => Promise.reject(new Error('gone')) }, 'c.m4a'), { result: 'Error', ref: 'c.m4a' });
});

test('narration: a line shows its words, a hold is continued once, and a stop forgets the hold', async () => {
  const voice = silentVoice();
  const narration = createNarration(voice);
  assert.equal(narration.say(null, '  '), null, 'a line with no recording started one');
  assert.equal(narration.words, '', 'blank words were shown');
  const talk = narration.say('v/a.m4a', 'the words');
  assert.equal(narration.words, 'the words');
  narration.resume();
  assert.deepEqual(voice.log, [['speak', 'v/a.m4a']], 'a resume with nothing held reached the voice');
  narration.hold();
  narration.resume();
  narration.resume();
  assert.deepEqual(voice.log.slice(1), [['pause'], ['resume']], 'a hold was not continued exactly once');
  narration.hold();
  narration.stop();
  narration.resume();
  assert.equal(voice.log.filter(([k]) => k === 'resume').length, 1, 'a stopped recording was resumed');
  assert.equal(narration.words, 'the words', 'stopping cleared words the caller had not cleared');
  assert.deepEqual(await talk, { result: 'stopped', ref: 'v/a.m4a' });
  narration.reset();
  assert.equal(narration.words, '');
  narration.show('restored');
  assert.equal(narration.words, 'restored');
  assert.throws(() => createNarration({ speak() {} }), /needs a voice/);
});

// A lesson may put a figure on screen (the `number` cue) — the cue exists in the format, and until now
// nothing on the Course screen drew it. The host carries what the POSITION IN VIEW says, which during a
// reveal is the reveal's own.
test('the figure on show is the one the picture in front of the child carries', async () => {
  const doc = {
    schema: 2,
    start: { scramble: "R U R' U'" },
    steps: [
      { say: 'line 0', voice: 'v/0.m4a', number: '43,252,003,274,489,856,000', counting: true },
      { say: 'line 1', voice: 'v/1.m4a', number: null },
      { round: { ask: 'whereIs:UF', choose: 2, say: 'line 2', voice: 'v/2.m4a', reveal: [{ say: 'line 3', voice: 'v/3.m4a', number: '20' }] } },
    ],
  };
  const ctx = lessonOver(doc);
  ctx.lesson.play();
  assert.equal(ctx.lesson.view.number, '43,252,003,274,489,856,000');
  assert.equal(ctx.lesson.view.counting, true);

  ctx.voice.finish();
  await ctx.clock.advance(450);
  assert.equal(ctx.lesson.view.number, null, 'a figure cleared by the next step stayed on screen');
  assert.equal(ctx.lesson.view.counting, false);

  ctx.voice.finish();
  await ctx.clock.advance(450);
  assert.equal(ctx.lesson.view.phase, 'asking');
  const at = ctx.built.positions.find((p) => p.step === 2).index;
  for (const face of answerAt(ctx.built, at).faces) ctx.lesson.select(face);
  await ctx.clock.advance(900);
  assert.equal(ctx.lesson.view.number, '20', "the reveal's own figure was not the one on show");
});

// A lesson can show a photograph or a short clip where the cube is — for the parts of a course that are not
// about a cube at all (ADR 0007). The host says WHAT is on show; where the file lives is the door's answer.
test('the picture on show is the one set last, and the cube comes back when it is cleared', async () => {
  const pic = { src: 'media/box.jpg', alt: 'A plain blue box' };
  const clip = { src: 'media/turning.mp4', alt: 'A hand turning a cube' };
  const ctx = lessonOver({
    schema: 2,
    steps: [
      { say: 'line 0', voice: 'v/0.m4a', image: pic },
      { say: 'line 1', voice: 'v/1.m4a' },
      { say: 'line 2', voice: 'v/2.m4a', clip },
      { say: 'line 3', voice: 'v/3.m4a', image: null, clip: null },
    ],
  });
  ctx.lesson.play();
  assert.deepEqual({ ...ctx.lesson.view.media }, { kind: 'image', ...pic });

  ctx.voice.finish();
  await ctx.clock.advance(450);
  assert.deepEqual({ ...ctx.lesson.view.media }, { kind: 'image', ...pic }, 'a picture went away on the next step');

  // Both cues are in force here — the picture was never cleared — and the one set LAST is what is shown.
  ctx.voice.finish();
  await ctx.clock.advance(450);
  assert.deepEqual({ ...ctx.lesson.view.media }, { kind: 'clip', ...clip });

  ctx.voice.finish();
  await ctx.clock.advance(450);
  assert.equal(ctx.lesson.view.media, null, 'the cube never came back');
});
