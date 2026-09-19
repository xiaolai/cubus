// What the scan says out loud, and when (2026-09-19; dev-docs/scan-guidance-plan.md Phase 6).
//
// A handful of short lines for the moments a child who cannot read meets: show a side, a side saved,
// that side is already in, turn the whole cube the way the small one shows, all done — and, for a
// scan only a grown-up can rescue, the honest way out: ask one. Each line is tied to the state it
// describes and is cut off the instant that state is gone, so the voice never talks about a moment
// that has passed. Every line is heard from something STRUCTURED — the capture event, the refusal
// event, `confirm`, `complete`, `shownAgain`, `sides`, `phase` — never by reading the scanner's
// sentences. The words go through `t()`, English first (D6), so a catalog can translate them later.
//
// Which line a report calls for is decided by `hear`, a pure function, and at most ONE line per
// report, by an explicit priority: a camera in trouble, then the ask for a side back, then a side
// shown again, then the opening. "All done" is not a report's to call: the screen says it when it
// ACCEPTS the scan (`accepted`). The first version ran six detectors in a row and let
// their order decide, which is how a notice's error tone spoke "ask a grown-up" over a confirm ask
// that was still the thing to do (found by audit, 2026-09-19).

import { locale, t } from '../../i18n.js';
import { hush, say } from '../../speech.js';
// Every side held, named or not — `captured` lists only the named ones and can shrink mid-scan.
import { sidesIn as sidesOf } from './report-sides.js';

/** The lines, English. Short on purpose: a child listens while holding a cube up. */
export const SPOKEN = Object.freeze({
  open: 'Show me any side of your cube.',
  saved: 'Got it! Now show me another side.',
  lastSaved: 'Got it! Let me check your cube.',
  again: "I've got that one. Show me a different side.",
  ask: 'Turn your whole cube like the little cube, and show me that side.',
  done: 'All done! Your cube is ready.',
  help: "Something doesn't look right. Ask a grown-up to check the stickers.",
  camera: "The camera isn't working. Ask a grown-up to help.",
});

/** The ask for a side back, as one comparable value, or null. */
const askOf = (p) => (p.confirm ? `${p.confirm.face}/${p.confirm.up}` : null);

/** The platform's reasons for a line not playing that can pass by the next report: audio held by
 *  something else, a network voice, a webview that had not yet been touched. The rest (no voice for
 *  the language, no speech service) will fail the same way again. */
const RETRYABLE = new Set(['not-allowed', 'audio-busy', 'audio-hardware', 'network']);

/** What the voice remembers between reports, before the first one. */
export const QUIET = Object.freeze({ opened: false, sides: 0, again: false, askSaid: null, phase: null });

/**
 * The line a report calls for, if any, and what to remember for the next one. Pure: every cue's
 * entry, persistence, exit and overlap is tested as a table (test/spoken.test.mjs).
 *
 * @returns {{ memo: object, cue: { line: string, holds: (report: object) => boolean } | null }}
 *   `holds` says whether a later report still shows the state the line describes.
 */
export function hear(memo, p) {
  const sides = sidesOf(p);
  const ask = askOf(p);
  const next = {
    // A scan thrown away starts from the top: sides only ever fall when sides are discarded.
    opened: memo.opened && sides >= memo.sides,
    sides,
    again: p.shownAgain === true,
    // An ask is remembered as SAID only when its line was chosen. Recorded as merely seen, one that
    // arrived beside a camera error was never said once the camera recovered (audit, 2026-09-19).
    askSaid: ask === null ? null : memo.askSaid,
    phase: p.phase,
  };
  // While the camera is in trouble, nothing else is said — every other line asks for something the
  // scanner cannot see — and the camera line is said on ENTERING the error, not per message, since
  // one failure can report several (audit, 2026-09-19).
  if (p.phase === 'error') {
    const cue = memo.phase === 'error' ? null : { line: SPOKEN.camera, holds: (q) => q.phase === 'error' };
    return { memo: next, cue };
  }
  if (ask !== null && ask !== next.askSaid) {
    next.askSaid = ask;
    return { memo: next, cue: { line: SPOKEN.ask, holds: (q) => askOf(q) === ask } };
  }
  if (next.again && !memo.again) {
    return { memo: next, cue: { line: SPOKEN.again, holds: (q) => q.shownAgain === true } };
  }
  if (!next.opened && p.phase === 'scanning' && p.device && sides === 0) {
    next.opened = true;
    return { memo: next, cue: { line: SPOKEN.open, holds: (q) => q.phase === 'scanning' && sidesOf(q) === 0 } };
  }
  return { memo: next, cue: null };
}

/**
 * The line for one accepted capture, or null for the look a confirm asked for (the check answers it).
 * "Show me another side" holds only while the scanner is reading; "let me check" also through the
 * check that follows the sixth side — never into a painting, an error or a finished scan.
 */
export function capturedCue({ kind, sides }) {
  if (kind === 'confirm') return null;
  if (sides >= 6) {
    return {
      line: SPOKEN.lastSaved,
      holds: (q) => (q.phase === 'scanning' || q.phase === 'checking') && sidesOf(q) >= sides,
    };
  }
  return { line: SPOKEN.saved, holds: (q) => q.phase === 'scanning' && sidesOf(q) >= sides };
}

/**
 * The line for a refused scan, or null. Never over an ask for a side back — that is still the thing to
 * do — and never while painting, which is a grown-up's mode already. It holds while the scanner waits
 * on that refusal, and is stopped when a new check begins. `memo` is the voice's memory at the refusal.
 */
export function refusedCue(memo) {
  if (memo.askSaid !== null || memo.phase === 'painting') return null;
  const sides = memo.sides;
  return {
    line: SPOKEN.help,
    holds: (q) => q.phase === 'scanning' && !q.complete && askOf(q) === null && sidesOf(q) === sides,
  };
}

/** The line for a scan the SCREEN accepted: said then, and not on the scanner's `complete`, because
 *  the screen can still refuse a finished scan (sides read before a smart cube moved, a tracking
 *  contradiction) — and "your cube is ready" over a disabled Solve button is false (audit, 2026-09-19). */
export function acceptedCue() {
  return { line: SPOKEN.done, holds: (q) => Boolean(q.complete) };
}

/**
 * @param {object} deps `panel`, the scanner element whose events are heard; `signal`, the screen's
 *   abort signal, which removes the listeners and stops the voice.
 */
export function createSpokenScan({ panel: scanner, signal }) {
  let memo = QUIET;
  // The state the line now being said describes, as the test that it still holds.
  let speaking = null;
  // A refusal is dispatched once and again when its diagnosis lands; it is said once per CHECK. A new
  // check — a correction, a side read again — may refuse again at the same count and be said again.
  let refusalSaid = false;
  // Whether the line under way is "all done", the one line that may outlive the screen (see the abort).
  let finale = false;
  // Which line is the latest, so a failure reported for one already replaced changes nothing.
  let latest = 0;
  // A line the platform failed for a reason that can pass, to try ONCE more at the next report — and
  // only if its moment still stands then, and no newer line has been called for (round-3 audit).
  let retry = null;
  const speak = (cue, { outlivesScreen = false, retried = false } = {}) => {
    if (!cue) return;
    const line = ++latest;
    retry = null;
    const onFail = (error) => {
      if (line !== latest) return;
      speaking = null;
      finale = false;
      if (!retried && RETRYABLE.has(error)) retry = { cue, outlivesScreen };
    };
    // In the language the words were translated into, so a catalog is never read in an English voice.
    const queued = say(t(cue.line), locale(), { onFail });
    speaking = queued ? cue.holds : null;
    finale = queued && outlivesScreen;
  };

  scanner.addEventListener('scan-capture', (e) => {
    refusalSaid = false;
    speak(capturedCue(e.detail));
  }, { signal });
  scanner.addEventListener('scan-invalid', () => {
    if (refusalSaid) return;
    const cue = refusedCue(memo);
    if (cue) { refusalSaid = true; speak(cue); }
  }, { signal });
  scanner.addEventListener('scan-progress', (e) => {
    const p = e.detail;
    if (speaking && !speaking(p)) { hush(); speaking = null; finale = false; }
    if (p.phase === 'checking' || sidesOf(p) < memo.sides) refusalSaid = false;
    const heard = hear(memo, p);
    memo = heard.memo;
    const again = retry;
    retry = null;
    if (heard.cue) speak(heard.cue);
    else if (again?.cue.holds(p)) speak(again.cue, { outlivesScreen: again.outlivesScreen, retried: true });
  }, { signal });

  // Leaving stops the voice — except "all done", which an accepted scan can leave the screen in the
  // middle of (auto-solve, a scan answering a reconnect question) and which is still true where the
  // app went; cut at the jump, a child on auto-solve never heard it (round-3 audit).
  signal?.addEventListener('abort', () => { if (!finale) hush(); }, { once: true });
  /** The screen accepted a finished scan: say so (see `acceptedCue`). */
  return Object.freeze({ accepted: () => speak(acceptedCue(), { outlivesScreen: true }) });
}
