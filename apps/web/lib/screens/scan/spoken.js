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

import { settings } from '../../app-settings.js';
import { locale, t } from '../../i18n.js';
import { hush, say } from '../../speech.js';
// Every side held, named or not — `captured` lists only the named ones and can shrink mid-scan.
import { sidesIn as sidesOf } from './report-sides.js';

/** The lines, English. Short on purpose: a child listens while holding a cube up.
 *
 *  A SAVED SIDE COUNTS DOWN rather than repeating (owner's call, 2026-09-20). It said
 *  "Got it! Now show me another side." on every accepted capture, so an ordinary scan was that one
 *  sentence five times over a chime that had already marked each one — the chime says a side landed,
 *  and the words after it added nothing but length. The remaining count is a fact the scanner
 *  measures and already passes to `capturedCue`, so the line now carries it: no two captures in a
 *  scan say the same thing, and what a child hears is progress rather than a repeated instruction.
 *  Two keys instead of `plural()` on purpose — these are edited by hand in Settings -> Advanced, and
 *  an editable plural table is a worse thing to hand someone than two plain sentences. */
export const SPOKEN = Object.freeze({
  open: 'Show me any side of your cube.',
  savedMany: 'Got it! %1 more sides.',
  savedOne: 'Got it! One more side.',
  lastSaved: 'Got it! Let me check your cube.',
  again: "I've got that one. Show me a different side.",
  ask: 'Turn your whole cube like the little cube, and show me that side.',
  done: 'All done! Your cube is ready.',
  help: "Something doesn't look right. Ask a grown-up to check the stickers.",
  camera: "The camera isn't working. Ask a grown-up to help.",
});

/** The sides a whole cube has. Named because the countdown is `SIDES - sides` and a bare 6 in that
 *  expression is the kind of number that later disagrees with the scanner's own. */
export const SIDES = 6;
/** Longest an edited line may be. A spoken line is heard, not read: past a breath it stops being a
 *  cue and becomes a paragraph the scan has moved on from. Generous rather than tight -- the point
 *  is to refuse a pasted essay, not to police wording. */
export const LINE_LIMIT = 160;

/**
 * The lines as they will actually be said: the defaults above, with any edited in
 * Settings -> Advanced laid over them.
 *
 * The stored record is untrusted input (`settings.spokenLines`, repaired to an object by
 * lib/app-settings.js and no further). A key the app does not know is dropped rather than passed to
 * the voice; a value that is not a non-empty string is dropped; a line longer than `LINE_LIMIT` is
 * dropped whole rather than truncated, because half a sentence said out loud is worse than the
 * default one. AND A LINE THAT DROPS A PLACEHOLDER THE DEFAULT CARRIES IS DROPPED: `savedMany`
 * without `%1` would announce "Got it! more sides." for the rest of the scan, which is exactly the
 * kind of invented sentence this app refuses everywhere else.
 */
export function spokenLines(edits = settings.spokenLines) {
  const lines = { ...SPOKEN };
  if (!edits || typeof edits !== 'object') return Object.freeze(lines);
  for (const [key, value] of Object.entries(edits)) {
    if (!Object.hasOwn(SPOKEN, key)) continue;
    if (typeof value !== 'string') continue;
    const line = value.trim();
    if (!line || line.length > LINE_LIMIT) continue;
    if (SPOKEN[key].includes('%1') && !line.includes('%1')) continue;
    lines[key] = line;
  }
  return Object.freeze(lines);
}

/** One line, by name, as it will be said. Cues carry the NAME rather than the words so that an edit
 *  made while a scan is on screen is used by the next line, not the next launch. */
export const lineFor = (key) => spokenLines()[key] ?? SPOKEN[key];

/**
 * @typedef {object} Cue
 * @property {string} line  the NAME of a line in `SPOKEN`, resolved through `lineFor` when spoken.
 * @property {unknown[]} [params]  substituted into %1.. after translation.
 * @property {(report: object) => boolean} holds  whether a later report still shows that state.
 */

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
 * @returns {{ memo: object, cue: Cue | null }} `holds` says whether a later report still shows
 *   the state the line describes.
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
    const cue = memo.phase === 'error' ? null : { line: 'camera', holds: (q) => q.phase === 'error' };
    return { memo: next, cue };
  }
  if (ask !== null && ask !== next.askSaid) {
    next.askSaid = ask;
    return { memo: next, cue: { line: 'ask', holds: (q) => askOf(q) === ask } };
  }
  if (next.again && !memo.again) {
    return { memo: next, cue: { line: 'again', holds: (q) => q.shownAgain === true } };
  }
  if (!next.opened && p.phase === 'scanning' && p.device && sides === 0) {
    next.opened = true;
    return { memo: next, cue: { line: 'open', holds: (q) => q.phase === 'scanning' && sidesOf(q) === 0 } };
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
  if (sides >= SIDES) {
    return {
      line: 'lastSaved',
      holds: (q) => (q.phase === 'scanning' || q.phase === 'checking') && sidesOf(q) >= sides,
    };
  }
  // What is LEFT, which is what changes: five captures in a scan, five different sentences.
  const left = SIDES - sides;
  return {
    line: left === 1 ? 'savedOne' : 'savedMany',
    params: [left],
    holds: (q) => q.phase === 'scanning' && sidesOf(q) >= sides,
  };
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
    line: 'help',
    holds: (q) => q.phase === 'scanning' && !q.complete && askOf(q) === null && sidesOf(q) === sides,
  };
}

/** The line for a scan the SCREEN accepted: said then, and not on the scanner's `complete`, because
 *  the screen can still refuse a finished scan (sides read before a smart cube moved, a tracking
 *  contradiction) — and "your cube is ready" over a disabled Solve button is false (audit, 2026-09-19). */
export function acceptedCue() {
  return { line: 'done', holds: (q) => Boolean(q.complete) };
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
    // Resolved HERE, not when the cue was made: a line edited in Settings while the scan is on
    // screen is used by the very next thing said. In the language the words were translated into,
    // so a catalog is never read in an English voice; the count substitutes after the lookup, so a
    // catalog keeps one whole sentence rather than two halves around a number.
    const queued = say(t(lineFor(cue.line), ...(cue.params ?? [])), locale(), { onFail });
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
