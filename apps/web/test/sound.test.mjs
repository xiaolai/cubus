// The app's sounds (lib/sound.js), against the shared stand-in AudioContext (test/sound-stand-ins.mjs
// — happy-dom has none, and the real one's unlock is asked of a real engine in test/browser/sound.test.mjs).
//
// What is held here is the contract the scan's chime rests on: no sound before a gesture has unlocked
// audio (and none queued to burst out after it), none while sounds are off, every note stopped when a
// screen is left, a note that ended on its own forgotten rather than stopped again, and an unknown
// sound refused rather than silently skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioStandIn } from './sound-stand-ins.mjs';

// app-settings reads localStorage at import; a stand-in store is enough for it.
const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
};
const { settings } = await import('../lib/app-settings.js');
const { audioState, play, stopAll, unlockOnGestures, useAudioContextFactory } = await import('../lib/sound.js');

/** A page to gesture on. */
const page = () => new EventTarget();

/**
 * A stand-in audio context in `soundMode`, installed and put back when the test ends.
 *
 * The five lines this replaces were written out six times and had already diverged: the
 * no-Web-Audio case never set a mode at all, so it could pass because sound was OFF rather than
 * because the platform had none — a false green depending on the order tests happen to run in
 * (audit, 2026-09-20). Nothing restored the factory or the mode either.
 */
function audio(t, { soundMode = 'voice', state, unlocked = false } = {}) {
  const stand = audioStandIn(state ? { state } : {});
  const wasFactory = useAudioContextFactory(() => stand.ctx);
  const wasMode = settings.soundMode;
  settings.soundMode = soundMode;
  const target = page();
  unlockOnGestures(target);
  if (unlocked) target.dispatchEvent(new Event('pointerdown'));
  t.after(() => {
    stopAll();
    useAudioContextFactory(wasFactory);
    settings.soundMode = wasMode;
  });
  return { ...stand, target };
}

test('no sound before a gesture, and none saved up for after it', () => {
  const { ctx } = audioStandIn();
  useAudioContextFactory(() => ctx);
  settings.soundMode = 'voice';
  const target = page();
  unlockOnGestures(target);
  assert.equal(audioState(), 'none');
  assert.equal(play('capture'), false, 'a sound was made before any gesture');
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(ctx.resumed, 1, 'the first gesture did not start audio');
  assert.equal(audioState(), 'running');
  assert.equal(ctx.made.length, 0, 'the sound asked for before the gesture was kept and played late');
  target.dispatchEvent(new Event('keydown'));
  assert.equal(ctx.resumed, 1, 'audio already running was resumed again by the next gesture');
});

// SPLIT INTO FOUR (audit, 2026-09-20). One case held note shapes, sequencing, `stopAll`, the
// disabled mode, the bell-only mode and an unknown name — its oscillator counts were CUMULATIVE, so
// a failure in the first assertion changed the numbers every later one depended on, and a failure
// anywhere named the whole list rather than the behaviour that broke.

/** The notes one sound makes, as {hz, at}. */
const notesOf = (made, from = 0) => made.slice(from).map((o) => ({ hz: o.frequency.value, at: o.started }));

test('each sound is its own rising run of notes', (t) => {
  const { ctx, made } = audio(t, { state: 'running', unlocked: true });
  assert.equal(play('capture'), true);
  const capture = notesOf(made);
  assert.equal(capture.length, 2, 'the capture chime is two notes');
  assert.equal(play('done'), true);
  const done = notesOf(made, 2);
  assert.equal(done.length, 4, 'the checked-out sound is four more');
  // Both rise and both are played one note after another.
  for (const [name, notes] of [['capture', capture], ['done', done]]) {
    for (let i = 1; i < notes.length; i++) {
      assert.ok(notes[i].hz > notes[i - 1].hz, `${name} note ${i} does not rise`);
      assert.ok(notes[i].at > notes[i - 1].at, `${name} note ${i} does not follow the one before it`);
    }
  }
  assert.ok(ctx.made.length === 6);
});

test('the two sounds are told apart by ear, not only by length', (t) => {
  // Comparing the lists as wholes passes on their different LENGTHS alone (audit, 2026-09-19).
  const { made } = audio(t, { state: 'running', unlocked: true });
  play('capture');
  const capture = notesOf(made);
  play('done');
  const done = notesOf(made, 2);
  assert.notEqual(done[0].hz, capture[0].hz, 'the two sounds begin on the same note');
  assert.notDeepEqual(done.slice(0, 2).map((n) => n.hz), capture.map((n) => n.hz),
    'the checked-out sound opens with the capture chime');
});

test('leaving a screen silences every note still sounding', (t) => {
  const { made } = audio(t, { state: 'running', unlocked: true });
  play('capture');
  play('done');
  assert.ok(made.length > 0, 'nothing was sounding, so nothing could be silenced');
  stopAll();
  assert.ok(made.every((o) => o.stops.length === 2), 'a note still sounding was not stopped');
  assert.ok(made.every((o) => o.stops.at(-1) === undefined), 'a note was left on its own schedule');
});

test('sounds off makes none, and the bell-only mode still rings', (t) => {
  const { made } = audio(t, { soundMode: 'off', state: 'running', unlocked: true });
  assert.equal(play('capture'), false, 'a sound was made with sounds off');
  assert.equal(made.length, 0, 'a refused sound still built its oscillators');
  // THE BELL IS NOT THE VOICE (2026-09-20). `chime` exists for someone who wanted the tick without
  // the words, so the chime must sound there exactly as it does under `voice`.
  settings.soundMode = 'chime';
  assert.equal(play('capture'), true, 'the bell was silent in the mode that is only the bell');
  assert.equal(made.length, 2, 'the bell-only mode made a different number of notes');
});

test('an unknown sound is refused rather than silently skipped', (t) => {
  audio(t, { state: 'running', unlocked: true });
  assert.throws(() => play('fanfare'), /no sound called "fanfare"/);
});

test('a note that ends on its own is forgotten, not stopped a second time later', () => {
  // The oscillators a sound made are held only until they end; a leak would have `stopAll()` reaching
  // into nodes the engine has already finished with, for the life of the page (audit, 2026-09-19).
  const { ctx } = audioStandIn();
  useAudioContextFactory(() => ctx);
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  settings.soundMode = 'voice';
  assert.equal(play('capture'), true);
  const notes = ctx.made.slice();
  assert.ok(notes.every((o) => typeof o.onended === 'function'), 'a note cannot say when it ended');
  for (const o of notes) o.onended();
  stopAll();
  assert.ok(notes.every((o) => o.stops.length === 1), 'a note that had ended was stopped again');
});

test('a platform with no Web Audio makes no sound and raises nothing', (t) => {
  // SILENT FOR THE RIGHT REASON. This never set a mode, so it passed whenever an earlier test left
  // `soundMode` at `off` — proving nothing about a platform without Web Audio (audit, 2026-09-20).
  // Sound is explicitly ON here, so the only thing that can silence it is the missing platform.
  const wasFactory = useAudioContextFactory(() => null);
  const wasMode = settings.soundMode;
  settings.soundMode = 'voice';
  t.after(() => {
    useAudioContextFactory(wasFactory);
    settings.soundMode = wasMode;
  });
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(audioState(), 'none');
  assert.equal(play('capture'), false);
});

test('a refused first resume is tried again on the next gesture, and a context suspended later is woken', async () => {
  // Unlocking is not one-shot (audit, 2026-09-19): a platform can refuse the first resume, and a
  // phone suspends audio behind a call or a backgrounded page — the next touch wakes it.
  let refuse = true;
  const { ctx } = audioStandIn();
  ctx.resume = () => {
    ctx.resumed += 1;
    if (refuse) return Promise.reject(new Error('not allowed'));
    ctx.state = 'running';
    return Promise.resolve();
  };
  useAudioContextFactory(() => ctx);
  settings.soundMode = 'voice';
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(audioState(), 'suspended');
  assert.equal(play('capture'), false);
  refuse = false;
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(audioState(), 'running', 'a refused first resume was never tried again');
  ctx.state = 'suspended'; // the platform suspends it
  target.dispatchEvent(new Event('touchend'));
  assert.equal(audioState(), 'running', 'a context suspended later stayed silent');
  assert.equal(ctx.resumed, 3);
});

test('a context parked while its resume is still in flight still chimes', async () => {
  // THE WEBKIT CASE, and the one `state` alone cannot answer. Measured on the Playwright 1.63
  // bundle: a fresh context reports `running` on the click, parks back to `suspended` a moment
  // later, and only THEN resolves the promise `resume()` returned. A chime asked for in that window
  // used to return false and make no sound — on the engine macOS and iOS ship, so every bell after
  // a quiet spell was silently dropped.
  //
  // A resume IN FLIGHT is counted with a successful one on purpose: the notes are scheduled against
  // a clock that is not advancing, so they keep their offsets and sound when it runs. Only a REFUSED
  // resume means nothing will be heard, and that is still false — the case above this one.
  let settle;
  const { ctx } = audioStandIn();
  ctx.resume = () => {
    ctx.resumed += 1;
    ctx.state = 'running';           // the engine reports running…
    return new Promise((res) => { settle = () => { ctx.state = 'running'; res(); }; });
  };
  useAudioContextFactory(() => ctx);
  settings.soundMode = 'chime';
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(audioState(), 'running', 'precondition: the engine reported running on the gesture');

  ctx.state = 'suspended';           // …and parks it before the promise settles
  assert.equal(play('capture'), true, 'a chime was dropped while the resume was still in flight');
  assert.ok(ctx.made.length > 0, 'it returned true without making any note');

  settle();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(play('capture'), true, 'a chime was dropped after the resume succeeded');
});

test('waking a context suspended mid-chime does not play the rest of the chime', () => {
  // A suspended context keeps its notes scheduled; resuming it would play their tails for a moment
  // that has passed (round-3 audit). They are stopped BEFORE the resume.
  const { ctx } = audioStandIn();
  useAudioContextFactory(() => ctx);
  settings.soundMode = 'voice';
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(play('done'), true);
  const notes = ctx.made.slice();
  ctx.state = 'suspended'; // the page went to the background mid-chime
  const stoppedAtResume = [];
  const resume = ctx.resume;
  ctx.resume = () => { stoppedAtResume.push(notes.every((o) => o.stops.length === 2)); return resume(); };
  target.dispatchEvent(new Event('pointerdown'));
  assert.deepEqual(stoppedAtResume, [true], 'a note scheduled before the suspension was still due when audio woke');
  assert.equal(audioState(), 'running');
});

test('a chime is AUDIBLE: every note reaches the destination through a gain that opens', (t) => {
  // "An oscillator was created" is not "a sound was made" (audit, 2026-09-20). The stand-in used to
  // discard every envelope call and every connection, so a chime whose gain never left zero — or one
  // wired to nothing — satisfied all of these assertions while being silent to the user.
  const { ctx, made, gains, audible } = audio(t, { state: 'running', unlocked: true });
  assert.equal(play('capture'), true);
  assert.ok(made.length > 0, 'no notes at all');
  assert.ok(gains.length > 0, 'the notes were not routed through a gain');
  assert.ok(audible(), 'a note never reached the destination, or its gain never opened');
  for (const gain of gains) {
    assert.ok(gain.gain.opens, 'a gain never rose above the value it decays to — a silent note');
    assert.ok(gain.gain.ops.length > 1, 'a gain was set once and never shaped — no envelope');
  }
  assert.ok(ctx.made.every((o) => o.started !== null), 'a note was built and never started');
});

test('the bell-only mode makes the SAME chime, note for note, not merely some notes', (t) => {
  // The contract is that `chime` keeps the bell exactly as `voice` has it. Counting oscillators
  // cannot see a different frequency, a different order or a different start time — so the two runs
  // are compared as sequences (audit, 2026-09-20).
  const wasFactory = useAudioContextFactory(() => null);
  const wasMode = settings.soundMode;
  t.after(() => {
    stopAll();
    useAudioContextFactory(wasFactory);
    settings.soundMode = wasMode;
  });
  /** The notes one `capture` chime makes in `mode`, on a context of its own. */
  const shape = (mode) => {
    const { ctx, made } = audioStandIn({ state: 'running' });
    useAudioContextFactory(() => ctx);
    settings.soundMode = mode;
    const target = page();
    unlockOnGestures(target);
    target.dispatchEvent(new Event('pointerdown'));
    assert.equal(play('capture'), true, `${mode} made no chime`);
    const seq = made.map((o) => [o.type, o.frequency.value, o.started]);
    stopAll();
    return seq;
  };
  assert.deepEqual(shape('chime'), shape('voice'), 'the bell differs between the two modes that have one');
});

// ---- the drill's off-track cue (decision D4 of dev-docs/algorithm-drills-plan.md) ----------------
//
// Both sounds above RISE, and both mean something affirmative — a side saved, a cube checked out.
// A deviation reusing either would make the vocabulary contradictory, so this one is the only
// falling sound the app makes. The case pins the direction rather than the pitches, because the
// direction is the claim and the pitches are a choice.

test('the off-track cue falls, where every other sound rises', (t) => {
  const { made } = audio(t, { state: 'running', unlocked: true });
  assert.equal(play('off'), true);
  const off = notesOf(made);
  assert.equal(off.length, 2, 'the off-track cue is two notes');
  assert.ok(off[1].hz < off[0].hz, 'the off-track cue rises — it must fall, or it reads as approval');
  assert.ok(off[1].at > off[0].at, 'its notes are simultaneous rather than one after the other');
});

test('the off-track cue is not either of the affirmative sounds', (t) => {
  const { made } = audio(t, { state: 'running', unlocked: true });
  play('capture');
  const capture = notesOf(made);
  play('off');
  const off = notesOf(made, capture.length);
  assert.notDeepEqual(off.map((n) => n.hz), capture.map((n) => n.hz), 'the cue is the capture chime');
  // And it is no LONGER than the affirmative one: an alarm is partly a matter of duration.
  assert.ok(off.at(-1).at <= capture.at(-1).at + 0.01, 'the cue outlasts the capture chime');
});

test('the off-track cue obeys the sound setting like every other sound', (t) => {
  // The shared helper owns the mode and puts it back — written any other way, this case leaks a
  // setting into whichever test happens to run next, which is the defect its own comment records.
  const { made } = audio(t, { soundMode: 'off', state: 'running', unlocked: true });
  assert.equal(play('off'), false, 'the cue sounded with sounds turned off');
  assert.equal(made.length, 0);
});

test('the off-track cue sounds on the bell-only setting, where the spoken lines do not', (t) => {
  const { made } = audio(t, { soundMode: 'chime', state: 'running', unlocked: true });
  assert.equal(play('off'), true, 'the cue is a bell, so the bell-only setting must keep it');
  assert.equal(made.length, 2);
});

test('a wake that rejects drops the notes scheduled while it was pending', async (t) => {
  // THE GAP IN `play()`'s ANSWER, and why its return now says SCHEDULED rather than sounded
  // (representative's review, 2026-09-29). `pending` covers two futures: the WebKit parking above,
  // where the notes keep their offsets and are heard; and a wake the platform refuses, where they
  // are heard at no point. `play` cannot tell them apart at the instant it is asked, so the refusal
  // is what clears up after it — otherwise `sounding` holds notes nobody can ever hear and
  // `stopAll` is asked to silence a context that never ran.
  let reject;
  const { ctx } = audioStandIn();
  ctx.resume = () => {
    ctx.resumed += 1;
    ctx.state = 'running';
    return new Promise((res, rej) => { reject = () => { ctx.state = 'suspended'; rej(new Error('not allowed')); }; });
  };
  const wasFactory = useAudioContextFactory(() => ctx);
  const wasMode = settings.soundMode;
  settings.soundMode = 'chime';
  t.after(() => { stopAll(); useAudioContextFactory(wasFactory); settings.soundMode = wasMode; });
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  ctx.state = 'suspended';
  assert.equal(play('capture'), true, 'precondition: a chime is scheduled while the wake is pending');
  const scheduled = ctx.made.slice();
  assert.ok(scheduled.length > 0, 'precondition: the scheduled chime made notes');

  reject();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(scheduled.every((o) => o.stops.at(-1) === undefined),
    'a note on a context that never ran was left due to sound');
  assert.equal(play('capture'), false, 'a chime was scheduled after the wake was refused');
});

test('an earlier wake settling late does not answer for a later one', async (t) => {
  // A resume's callbacks carry no identity of their own. Refuse, gesture again, and the FIRST
  // promise can settle after the second — `ok` written over `refused`, so audio reads as available
  // on a platform that has just refused it, and every chime afterwards is scheduled on a context
  // that never runs (representative's review, 2026-09-29). Whether a real engine settles them out
  // of order is not what this holds: the model must not DEPEND on the order.
  const inflight = [];
  const { ctx } = audioStandIn();
  ctx.resume = () => {
    ctx.resumed += 1;
    return new Promise((res, rej) => inflight.push({ res, rej }));
  };
  const wasFactory = useAudioContextFactory(() => ctx);
  const wasMode = settings.soundMode;
  settings.soundMode = 'chime';
  t.after(() => { stopAll(); useAudioContextFactory(wasFactory); settings.soundMode = wasMode; });
  const target = page();
  unlockOnGestures(target);
  target.dispatchEvent(new Event('pointerdown'));
  target.dispatchEvent(new Event('pointerdown'));
  assert.equal(inflight.length, 2, 'precondition: two wakes are in flight');

  inflight[1].rej(new Error('not allowed'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(play('capture'), false, 'precondition: the later, refused wake makes no sound');

  inflight[0].res();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(play('capture'), false, 'a stale wake re-enabled sound after a later refusal');
});
