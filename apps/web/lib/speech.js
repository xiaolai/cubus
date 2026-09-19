// Spoken words: the system's own voice, where the platform has one (2026-09-19).
//
// The owner's call (dev-docs/scan-guidance-plan.md §10, D6): any system voice, English first — no
// recordings. Speech is offered where the platform provides `speechSynthesis` and nowhere else, as
// smart-cube pairing is offered only where a radio route exists (`bleReach`, lib/cube-connection.js):
// Android's WebView and standard WebKitGTK have none, and there a scan still completes on the chime
// and the pictures, which every scan must be able to do anyway. One switch, `settings.sounds`,
// silences the voice with the chime (lib/sound.js). A line replaces whatever was being said, so the
// voice never queues up behind a scan that has moved on.

import { settings } from './app-settings.js';

let engine = () => ({
  synth: globalThis.speechSynthesis ?? null,
  Utterance: globalThis.SpeechSynthesisUtterance ?? null,
});

/** A line the app cut off itself — a newer line, or the state it described gone — is not a failure. */
const CUT_OFF = new Set(['interrupted', 'canceled']);

/**
 * Say `text` now, cutting off anything still being said. Returns whether the line was QUEUED — the
 * platform speaks it asynchronously and can still decline, which is why callers treat the answer as
 * "a line is under way", never as "it was heard". A line the platform declines (no voice installed,
 * a speech service that is not running, a webview that wants a gesture first) is logged, and
 * `onFail(error)` is told the platform's reason, so the caller — which knows whether the moment the
 * line describes still stands — can decide whether to try again (round-3 audit).
 */
export function say(text, lang = 'en', { onFail } = {}) {
  if (!settings.sounds) return false;
  const { synth, Utterance } = engine();
  if (!synth || !Utterance) return false;
  synth.cancel();
  const line = new Utterance(text);
  // The language the words ARE in — English first (D6), and a catalog's language once there is one:
  // a voice for another language reads a sentence as nonsense. A little slower than the default,
  // for a child.
  line.lang = lang;
  line.rate = 0.95;
  line.onerror = (e) => {
    if (CUT_OFF.has(e.error)) return;
    console.warn(`[cubus] a spoken line did not play (${e.error}): "${text}"`);
    onFail?.(e.error);
  };
  synth.speak(line);
  return true;
}

/** Stop speaking: the state a line described has changed, or the screen was left. */
export function hush() {
  engine().synth?.cancel();
}

/** Tests only: speak through `synth` and `Utterance` from now on. Returns the engine it replaced, so
 *  a test can put back what it found (audit, 2026-09-19). */
export function useSpeechEngine(make) {
  const was = engine;
  engine = make;
  return was;
}
