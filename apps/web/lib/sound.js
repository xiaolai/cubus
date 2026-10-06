// The sounds the app makes: synthesised with Web Audio, never loaded (2026-09-19).
//
// A child who cannot read hears a side being saved and the whole cube checking out
// (dev-docs/scan-guidance-plan.md 3.2). The sounds are made rather than played from files, so there
// is nothing to load, no licence to carry, and they are the same on every build. There is ONE
// AudioContext for the page, created and resumed on the first user gesture, because the engines the
// app runs in refuse to start audio before one; a sound asked for earlier is simply not made — it is
// never queued to burst out later. `settings.soundMode` decides: `off` silences all of it — `voice`
// and `chime` both keep the bell — and a silent scan loses
// nothing: every sound has a picture beside it, which is the rule the plan holds them to.

import { SOUND_MODES, settings } from './app-settings.js';

/** Each sound as notes: [frequency in Hz, start in seconds]. */
const SOUNDS = Object.freeze({
  // A rising pair, short: "got it". Heard once per side saved.
  capture: [[659.25, 0], [880, 0.09]],
  // A rising arpeggio, longer and different: "the whole cube checks out".
  done: [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36]],
  // A drill turn that is not in the algorithm. Decision D4 of
  // dev-docs/algorithm-drills-plan.md: both sounds above mean something affirmative, so reusing
  // either for a deviation would make the vocabulary contradictory — and a BUZZER is not what this
  // app says to an eight-year-old. So: two notes, FALLING and close together, quieter in feel than
  // `capture` because it is the same length but goes down. Not an alarm, not a rebuke, and not
  // repeated — `lib/drill-attempt.js` raises it once per excursion, never once per report.
  off: [[440, 0], [392, 0.09]],
  // ---- the three the VOICE used to carry (owner, 2026-09-30) ---------------------------------
  //
  // The spoken lines are gone: a sound per state is the whole vocabulary now. These three are the
  // states the scan had words for and no tone at all, so a child scanning by ear was told nothing.
  // Each is placed against the two affirmative sounds above rather than chosen on its own, because
  // a vocabulary is only useful if its members cannot be mistaken for one another.
  //
  // ALREADY GOT THAT SIDE. Two notes at ONE pitch: it is not a reward and it is not a mistake, it
  // is "nothing happened, show me another". Flat is what says that — `capture` rises and `off`
  // falls, so level is the only reading left, and it cannot be confused with either.
  again: [[523.25, 0], [523.25, 0.11]],
  // THE SCAN HAS STOPPED AND IS WAITING FOR YOU. The one moment the scan needs a person, and until
  // the voice was added it went up with a chime a child could not tell from any other. Two rising
  // PAIRS — a doorbell, asked twice — so it is a summons rather than an event: the rhythm is what
  // distinguishes it, not the pitch, because `capture` is also a rising interval and a single pair
  // would have been the same gesture at a different height.
  ask: [[587.33, 0], [783.99, 0.1], [587.33, 0.26], [783.99, 0.36]],
  // SOMETHING IS WRONG; FETCH A GROWN-UP. Low and falling, and slower than `off`: a failure a
  // person has to deal with, not a turn to undo. Still not a buzzer — the lowest note here is an
  // octave below the others, which is what carries "this is not for you to fix" without a rebuke.
  help: [[349.23, 0], [261.63, 0.14]],
});
const NOTE_S = 0.18;
/** Quiet on purpose: a chime beside a child's ear, not an alarm. */
const PEAK = 0.12;
const GESTURES = ['pointerdown', 'keydown', 'touchend'];

let makeContext = () => {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return Context ? new Context() : null;
};
let context = null;
/**
 * What became of the last `resume()` — the thing `state` alone cannot tell you.
 *
 * `'suspended'` covers two situations that need opposite answers: the platform REFUSED (no
 * activation after all, another app holding the audio session), so nothing will sound; or it
 * resumed and then PARKED an idle context, so notes scheduled now will sound. `'pending'` is
 * counted with the second, deliberately: WebKit reports `running`, parks back to `suspended`, and
 * only THEN resolves the promise — measured on the Playwright 1.63 bundle — so a chime asked for in
 * that window is a chime that will be heard, and refusing it is the bug this replaces.
 */
let resumeState = /** @type {'none' | 'pending' | 'ok' | 'refused'} */ ('none');
/**
 * Which wake `resumeState` is about. A resume's callbacks carry no identity of their own, so an
 * EARLIER attempt settling late used to overwrite a later one's answer: refuse, wake again, and the
 * first promise resolves `ok` over the second's `refused` — audio then reads as available on a
 * platform that has just refused it twice. Every attempt takes a number and a settled promise
 * answers only for its own (representative's review, 2026-09-29).
 */
let resumeGen = 0;
/**
 * Oscillators started and not yet ended, against the CLOCK READING they were scheduled at.
 *
 * What decides whether a note is stale is not where it was scheduled but whether the clock has
 * MOVED since — because a suspended context's `currentTime` does not advance, so a note scheduled
 * into one keeps its offset and is still due, while a note the clock has run past has already had
 * its moment.
 *
 * Two wrong answers preceded this one. Cancelling everything cut the bell asked for during a
 * pending wake, before it ever sounded. Labelling each note with the STATE it was scheduled under
 * fixed that and broke the original case: the label is permanent, so a note scheduled while
 * suspended, then played by a context that actually ran, then caught by a second suspension, was
 * never cleaned up and its tail waited for the next resume (verify, 2026-09-29). A clock reading
 * answers all three, and it is observable rather than inferred.
 */
const sounding = new Map();

/**
 * How long the context may sit RUNNING with nothing left to play before it is suspended.
 *
 * A running AudioContext holds the platform's audio session for as long as it lives: on macOS and
 * iOS that is the "something is playing" indicator, a wakelock on the audio hardware, and a device
 * that will not idle. This app plays chimes a fifth of a second long and then nothing for minutes,
 * and it never suspended — measured 2026-09-30, the context reached `running` on the FIRST GESTURE
 * and was still running ten seconds later with nothing scheduled and nothing ever played.
 *
 * Two seconds rather than none, because chimes come in runs — a scan captures a side about every
 * second — and suspending between them would pay a resume for each. Two seconds after the last
 * note ENDS, not after it starts.
 */
export const IDLE_SUSPEND_MS = 2000;

/** The pending idle suspend, and the timer seam tests drive it through. */
let idleTimer = null;
let schedule = Object.assign((fn, ms) => setTimeout(fn, ms), { cancel: (t) => clearTimeout(t) });

const cancelIdle = () => { if (idleTimer !== null) { schedule.cancel(idleTimer); idleTimer = null; } };

/** Seconds until the last scheduled note has finished, or 0 when nothing is due. */
function untilQuiet() {
  let last = 0;
  for (const { end } of sounding.values()) last = Math.max(last, end - context.currentTime);
  return Math.max(0, last);
}

/**
 * Suspend once the last note has finished and the grace has passed.
 *
 * Re-armed rather than fired blind: a note scheduled after this was armed would otherwise be cut
 * off by a suspend that was measured for an earlier one. The check is against the note END TIMES
 * and not against `sounding` being empty, because `onended` is the platform's to fire and a
 * context that is already suspended will never fire it — which would leave the timer re-arming for
 * ever on the one path it exists to handle.
 */
function armIdle() {
  cancelIdle();
  if (!context || typeof context.suspend !== 'function') return;
  idleTimer = schedule(() => {
    idleTimer = null;
    if (!context || context.state !== 'running') return;
    if (untilQuiet() > 0) { armIdle(); return; }
    // `resumeState` is deliberately left as it is: this suspension is OURS, the permission is still
    // granted, and `play()` waking it through `unlock()` is the same path a platform parking takes.
    void Promise.resolve(context.suspend()).catch(() => {});
  }, untilQuiet() * 1000 + IDLE_SUSPEND_MS);
}

/** Create the page's one AudioContext, or wake it. Only ever called from inside a user gesture. */
function unlock() {
  // NOT WITH SOUND OFF. This runs on every pointerdown, keydown and touchend on the document, so
  // it used to open an audio session — and hold it — for a person who had turned sound off and
  // would never hear anything from it. Nothing plays the instant the setting is turned back on
  // (the only callers are the scan's chimes and the drill's cues, both of them screens away), so
  // the next gesture is soon enough to unlock.
  if (settings.soundMode === SOUND_MODES.off) return;
  context ??= makeContext();
  if (!context) return;
  // Any wake cancels a pending suspend: the two are opposite answers to the same question, and the
  // timer was measured against a silence this gesture may be about to end.
  cancelIdle();
  // Taken BEFORE the running branch as well: that branch answers for the context as it is now, so
  // any wake still in flight is stale and must not be allowed to answer after it.
  const gen = ++resumeGen;
  if (context.state === 'running') { resumeState = 'ok'; armIdle(); return; }
  // A context suspended mid-chime keeps its notes scheduled, and resuming plays their unfinished
  // tails — a "got it" for a side saved before the page went to the background, heard on the next
  // touch. Whatever was sounding is over; stop it before waking (round-3 audit).
  //
  stopRan();
  // A refused resume (no activation after all, an audio session another app holds) is not an error
  // to raise: the next gesture tries again, which is why the listener stays.
  resumeState = 'pending';
  context.resume()
    .then(() => { if (gen === resumeGen) { resumeState = 'ok'; armIdle(); } })
    .catch((err) => {
      if (gen !== resumeGen) return;
      resumeState = 'refused';
      // The notes `play()` scheduled while this wake was pending are on a context that never ran, so
      // they sound at no point. Dropping them keeps `sounding` a record of notes that can still be
      // heard, which is what `stopAll` is asked to silence.
      stopAll();
      console.debug('[cubus] audio did not resume; the next gesture tries again', err);
    });
}

/**
 * Unlock audio on a gesture anywhere on `target` — and wake it again on any later gesture. Not a
 * one-shot: a context the platform suspends later (a page sent to the background, an audio
 * interruption on a phone) is woken by the next touch rather than silent for the rest of the page,
 * and a first resume that was refused gets another chance (audit, 2026-09-19). A gesture over audio
 * already running costs one state read.
 */
export function unlockOnGestures(target = globalThis.document) {
  for (const type of GESTURES) target.addEventListener(type, unlock, true);
}

/** Where audio stands: 'none' before a gesture (or where there is no Web Audio), else the context's state. */
export const audioState = () => context?.state ?? 'none';

/**
 * Make `name`'s sound now. Returns whether the notes were SCHEDULED: nothing is scheduled when
 * sounds are off, nor before a gesture has unlocked audio. **It is not a measurement of audible
 * output**, and the gap is one case — a wake still `pending` may reject afterwards, and those notes
 * are then dropped by the refusal rather than heard. Nothing in the app branches on the answer, so
 * a TEST asserting it has established scheduling and nothing more; the audible path is the
 * stand-in's `audible()` (representative's review, 2026-09-29).
 * An unknown name is a programming error and throws.
 *
 * A PARKED CONTEXT IS WOKEN; A REFUSED ONE IS STILL REFUSED. The gate used to be
 * `state !== 'running'`, which gave the same answer to both — and WebKit parks aggressively:
 * measured on the Playwright 1.63 bundle, a context reaches `running` on the click and is back to
 * `suspended` a moment later with nothing scheduled, so every chime after a quiet spell returned
 * false and made no sound on the engine macOS and iOS ship. `resumeState` is what tells the two
 * apart, and waking goes through `unlock()` rather than a second `resume()` here, because that path
 * stops notes left scheduled from before the parking — resuming without it plays their tails.
 *
 * The resume is not awaited and does not need to be: a suspended context's `currentTime` does not
 * advance, so notes scheduled at `t0 + at` keep their offsets and sound once it runs.
 */
export function play(name) {
  // `Object.hasOwn`, not a truthy lookup: `SOUNDS.toString` is a function, so `play('toString')`
  // sailed past the guard and died later on `for (const [hz, at] of notes)` with a TypeError about
  // iteration — a confusing error for a plain programming mistake the next line names exactly.
  if (!Object.hasOwn(SOUNDS, name)) throw new Error(`sound: there is no sound called "${name}"`);
  const notes = SOUNDS[name];
  if (settings.soundMode === SOUND_MODES.off || !context) return false;
  if (context.state !== 'running') {
    if (resumeState === 'refused' || resumeState === 'none') return false;
    unlock();
  }
  const t0 = context.currentTime;
  for (const [hz, at] of notes) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, t0 + at);
    gain.gain.linearRampToValueAtTime(PEAK, t0 + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + NOTE_S);
    osc.connect(gain).connect(context.destination);
    osc.onended = () => sounding.delete(osc);
    osc.start(t0 + at);
    osc.stop(t0 + at + NOTE_S + 0.02);
    // BOTH TIMES. `at` is what `stopRan` compares the clock against; `end` is what the idle
    // suspend waits for. Keeping only the first made "is anything still due?" unanswerable without
    // `onended`, which a suspended context never fires — so the timer would have re-armed for ever
    // on exactly the path it exists to serve.
    sounding.set(osc, { at: t0, end: t0 + at + NOTE_S + 0.02 });
  }
  // Nothing is playing a moment after this finishes, and a context nobody is listening to must not
  // hold the platform's audio session.
  armIdle();
  return true;
}

/**
 * Silence the notes whose moment has PASSED — those the context's clock has run beyond. Called
 * before a wake, so resuming does not play their tails; a note the clock has not reached is left
 * alone, because it has not sounded and still keeps its offset.
 */
function stopRan() {
  for (const [osc, { at }] of sounding) {
    // The clock has not moved since this note was scheduled, so its moment has not arrived.
    if (context.currentTime <= at) continue;
    osc.stop();
    sounding.delete(osc);
  }
}

/** Silence every sound still sounding: a screen left, a scan thrown away. */
export function stopAll() {
  for (const osc of sounding.keys()) osc.stop();
  sounding.clear();
  // There is nothing left to wait for, so the suspend is re-measured from now rather than from
  // the end of notes that have just been cancelled.
  armIdle();
}

/** Tests only: make contexts with `factory` from now on, forgetting the current one. Returns the
 *  factory it replaced, so a test can put back what it found rather than leaving the next one a
 *  platform with no audio at all (audit, 2026-09-19). */
export function useAudioContextFactory(factory) {
  const was = makeContext;
  cancelIdle();
  makeContext = factory;
  context = null;
  sounding.clear();
  return was;
}

/** Tests only: drive the idle suspend on `fn` instead of `setTimeout`. Returns what it replaced,
 *  for the same reason the factory above does — a suite that leaves a stand-in installed hands the
 *  next one a timer that never fires. Shaped like `script-drive`'s `schedule`: callable, with a
 *  `cancel`. */
export function useAudioSchedule(fn) {
  const was = schedule;
  cancelIdle();
  schedule = fn;
  return was;
}
