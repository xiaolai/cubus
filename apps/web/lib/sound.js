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
/** Oscillators started and not yet ended, so a screen left can silence them. */
const sounding = new Set();

/** Create the page's one AudioContext, or wake it. Only ever called from inside a user gesture. */
function unlock() {
  context ??= makeContext();
  if (!context || context.state === 'running') return;
  // A context suspended mid-chime keeps its notes scheduled, and resuming plays their unfinished
  // tails — a "got it" for a side saved before the page went to the background, heard on the next
  // touch. Whatever was sounding is over; stop it before waking (round-3 audit).
  stopAll();
  // A refused resume (no activation after all, an audio session another app holds) is not an error
  // to raise: the next gesture tries again, which is why the listener stays.
  context.resume().catch((err) => console.debug('[cubus] audio did not resume; the next gesture tries again', err));
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
 * Make `name`'s sound now. Returns whether it sounded: not when sounds are off, and not before a
 * gesture has unlocked audio. An unknown name is a programming error and throws.
 */
export function play(name) {
  const notes = SOUNDS[name];
  if (!notes) throw new Error(`sound: there is no sound called "${name}"`);
  if (settings.soundMode === SOUND_MODES.off || context?.state !== 'running') return false;
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
    sounding.add(osc);
  }
  return true;
}

/** Silence every sound still sounding: a screen left, a scan thrown away. */
export function stopAll() {
  for (const osc of sounding) osc.stop();
  sounding.clear();
}

/** Tests only: make contexts with `factory` from now on, forgetting the current one. Returns the
 *  factory it replaced, so a test can put back what it found rather than leaving the next one a
 *  platform with no audio at all (audit, 2026-09-19). */
export function useAudioContextFactory(factory) {
  const was = makeContext;
  makeContext = factory;
  context = null;
  sounding.clear();
  return was;
}
