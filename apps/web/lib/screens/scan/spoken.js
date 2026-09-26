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
import { COLOUR_NAMES, colourOfSlot, isColour } from '../../scheme.js';
import { SIDES, sidesIn as sidesOf } from './report-sides.js';

/** The lines, English. Short on purpose: a child listens while holding a cube up.
 *
 *  A SAVED SIDE NAMES THE COLOUR IT SAVED (owner's call, 2026-09-24). It counted down instead —
 *  "Got it! 3 more sides." — which replaced an earlier version that said the same sentence five
 *  times. The count fixed the repetition and left the real defect: "Got it!" never says WHAT it
 *  got. A number is abstract to a child who cannot read, and it is not something they can check
 *  against the cube in their hands; a colour is the one thing they can. Naming it also makes the
 *  sentences differ from each other, which is all the count was ever buying.
 *
 *  AND IT MAKES A MISFILING AUDIBLE. The scan names a side by its centre, and a centre it reads
 *  wrong files the side under the wrong colour — silently, until the scan fails at the end with
 *  advice that does not fit. Said aloud, "Got the blue side" while a child holds the white one is
 *  wrong where somebody can hear it. A claim the app is already making is better made out loud than
 *  kept to itself.
 *
 *  AND IT HAS TO FIT BETWEEN TWO CAPTURES, or it is cut off and nobody hears it (2026-09-24).
 *  Measured on this machine's own voice against the real rhythm of a scan: the median gap between
 *  captures is 2,153 ms over twelve real ones, and "Got the yellow side! Show me another one." takes
 *  2,733 ms — so it was cut on ten of those twelve. "Got the yellow side!" takes 1,333 ms and is cut
 *  by none of them. What was dropped is the INSTRUCTION, which a child learns after the first side
 *  and which the chime has already marked five times; what was kept is the colour, the only part
 *  that is news. `savedLast` is left long on purpose: nothing follows it, so it cannot be cut.
 *
 *  `%1` IS A COLOUR IN ALL THREE, and the keys were RENAMED when it stopped being a number
 *  (`savedMany`/`savedOne`/`lastSaved` -> `savedSide`/`savedPenultimate`/`savedLast`). An edit
 *  stored against an old key is dropped by `spokenLines()` and the default is used, which is what
 *  should happen: keeping the names would have fed a colour to someone's hand-written "Got it! %1
 *  more sides." and said "Got it! yellow more sides." for the rest of that scan. */
export const SPOKEN = Object.freeze({
  open: 'Show me any side of your cube.',
  savedSide: 'Got the %1 side!',
  savedPenultimate: 'Got the %1 side! One more.',
  savedLast: 'Got the %1 side! Let me check your cube.',
  again: "I've got that one. Show me a different side.",
  ask: 'Turn your whole cube like the little cube, and show me that side.',
  // THE ONE MOMENT THE SCAN NEEDS A PERSON, and until 2026-09-25 it was the one moment the voice
  // said nothing: the identity question went up with a chime and a card, and a child scanning by
  // ear had no idea the scan had stopped waiting for frames and started waiting for them. Short,
  // because the answer is on screen and the cue's job is only to send eyes to it.
  which: 'I cannot tell which side that is. Which colour is in the middle?',
  whichAgain: 'Now the side you showed before. Which colour is in its middle?',
  done: 'All done! Your cube is ready.',
  help: "Something doesn't look right. Ask a grown-up to check the stickers.",
  camera: "The camera isn't working. Ask a grown-up to help.",
});

/** Longest an edited line may be. A spoken line is heard, not read: past a breath it stops being a
 *  cue and becomes a paragraph the scan has moved on from. Generous rather than tight -- the point
 *  is to refuse a pasted essay, not to police wording. */
export const LINE_LIMIT = 160;

/**
 * Every `%`-token in a line, read WHOLE: `%1`..`%9`, and `null` for anything else.
 *
 * The digits have to be taken greedily. Matching a single digit finds `%1` inside `%10` and leaves
 * the `0` behind as a literal, so the check passes and a count of five is announced as fifty — the
 * very defect this reads for. `%10` is not a tenth parameter; `t()` substitutes `%1..%9` and nothing
 * else, so a longer run of digits is a token the line cannot have meant.
 */
const placeholdersOf = (line) =>
  [...line.matchAll(/%(\d+)/g)].map((m) => (m[1].length === 1 ? Number(m[1]) : null));

/**
 * Whether `line` carries exactly the placeholders `template` does.
 *
 * `includes('%1')` was not enough (audit, 2026-09-20). It accepted `%10`, which substitutes the
 * count and leaves the 0 — five sides announced as fifty. It accepted `%9` on a line given one
 * parameter, which is then spoken aloud as "percent nine". And it let a line with NO placeholder
 * gain one, which would speak an `undefined`. The set has to match, not merely be non-empty.
 */
const placeholdersFit = (template, line) => {
  const got = placeholdersOf(line);
  // A token that is not `%1`..`%9` is refused outright, whatever the template carries.
  if (got.includes(null)) return false;
  const want = [...new Set(placeholdersOf(template))].sort();
  const seen = [...new Set(got)].sort();
  return want.length === seen.length && want.every((n, i) => n === seen[i]);
};

/**
 * HOW a line's placeholders fail to fit the default's, or null when they fit.
 *
 * The rule lives beside `placeholdersFit`, which decides it, so the Settings card cannot come to
 * describe a refusal the voice does not make (Codex audit, 2026-09-26: the card told someone to
 * "keep %1" for a line that already had %1 and had gained a %2 — advice that could not be followed).
 * `'missing'` is a line that dropped the colour; `'extra'` is one that gained a token the default
 * does not carry, which includes a malformed `%10`.
 */
export function placeholderFault(key, line) {
  const template = SPOKEN[key];
  if (template === undefined || placeholdersFit(template, line)) return null;
  const got = placeholdersOf(line);
  if (got.includes(null)) return 'extra';
  const want = new Set(placeholdersOf(template));
  const seen = new Set(got);
  for (const n of seen) if (!want.has(n)) return 'extra';
  return 'missing';
}

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
    if (!placeholdersFit(SPOKEN[key], line)) continue;
    lines[key] = line;
  }
  return Object.freeze(lines);
}

/** One line, by name, as it will be said. Cues carry the NAME rather than the words so that an edit
 *  made while a scan is on screen is used by the next line, not the next launch. */
export const lineFor = (key) => spokenLines()[key] ?? SPOKEN[key];

/**
 * A cue's words, ready to speak: the line looked up by name, translated, with its count substituted.
 *
 * THE ONE PLACE THIS HAPPENS. `speak` did it inline and two test files each re-implemented it, so
 * the placeholder-and-translation pipeline existed three times (audit, 2026-09-20). Exported because
 * a test that needs to know what a cue SOUNDS like should ask the app, not rebuild it — and where a
 * test is about the wording itself it asserts a hard-coded string instead, which is the only kind of
 * oracle that can disagree with the code.
 */
export const cueText = (cue) => t(lineFor(cue.line), ...(cue.params ?? []));

/**
 * @typedef {object} Cue
 * @property {string} line  the NAME of a line in `SPOKEN`, resolved through `lineFor` when spoken.
 * @property {unknown[]} [params]  substituted into %1.. after translation.
 * @property {(report: object) => boolean} holds  whether a later report still shows that state.
 */

/** The ask for a side back, as one comparable value, or null. */
const askOf = (p) => (p.confirm ? `${p.confirm.face}/${p.confirm.up}` : null);

/** The open identity question, as one comparable value, or null. The id is already that value —
 *  `IdentityRequest.id` is a serial raised per question — so this is only where it is read from. */
const identOf = (p) => p.identity?.id ?? null;

/** The platform's reasons for a line not playing that can pass by the next report: audio held by
 *  something else, a network voice, a webview that had not yet been touched. The rest (no voice for
 *  the language, no speech service) will fail the same way again. */
const RETRYABLE = new Set(['not-allowed', 'audio-busy', 'audio-hardware', 'network']);

/**
 * The lines that may cut another one off, because they block the scan on a PERSON.
 *
 * Everything else the scan says is a remark about what just happened, and a remark must never take
 * the words out of the mouth of the line before it (owner, 2026-09-25: the voice is always
 * interrupted by the next thing that happens). A line of equal or lower urgency WAITS instead, and
 * is dropped if its own moment passes while it waits.
 */
const URGENT = new Set(['camera', 'ask', 'which', 'whichAgain']);
const rankOf = (cue) => (URGENT.has(cue.line) ? 1 : 0);

/** What the voice remembers between reports, before the first one. */
export const QUIET = Object.freeze({
  opened: false,
  sides: 0,
  again: false,
  againSaid: null,
  askSaid: null,
  identSaid: null,
  phase: null,
});

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
  const ident = identOf(p);
  const next = {
    // A scan thrown away starts from the top: sides only ever fall when sides are discarded.
    opened: memo.opened && sides >= memo.sides,
    sides,
    again: p.shownAgain === true,
    // The count at which "I have got that one" was last said, so the same side settling over and
    // over does not restart it. A count that CHANGES — a side captured, or a scan thrown away —
    // makes it sayable again, which is exactly when it is news again.
    againSaid: memo.againSaid,
    // An ask is remembered as SAID only when its line was chosen. Recorded as merely seen, one that
    // arrived beside a camera error was never said once the camera recovered (audit, 2026-09-19).
    askSaid: ask === null ? null : memo.askSaid,
    // KEYED ON THE QUESTION'S ID, never on the colour it is about. An answer naming a held colour
    // raises a SECOND question, about the displaced reading and about the SAME colour — so a memo
    // keyed on the colour would fall silent for exactly the follow-up a person has to answer.
    identSaid: ident === null ? null : memo.identSaid,
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
  // AHEAD OF `again`, and for the reason the ladder is a ladder: a question blocks the scan on a
  // person, where "I've got that one" only reports on a side they can simply turn.
  if (ident !== null && ident !== next.identSaid) {
    next.identSaid = ident;
    const line = p.identity?.displaced ? 'whichAgain' : 'which';
    return { memo: next, cue: { line, holds: (q) => identOf(q) === ident } };
  }
  // HELD BY WHAT IT DESCRIBES, NOT BY THE FLAG THAT RAISED IT (Codex audit, 2026-09-25).
  // `shownAgain` is consumed by the panel on every report, so `holds: q => q.shownAgain` was false
  // by the very next one and cut the line about 60 ms in — spoken every time and heard none of
  // them. What the line says ("show me a different side") stays true until a different side is
  // actually captured, so that is what holds it, and the count is also what lets it be said again.
  if (next.again && memo.againSaid !== sides) {
    next.againSaid = sides;
    return {
      memo: next,
      cue: { line: 'again', holds: (q) => q.phase === 'scanning' && sidesOf(q) === sides },
    };
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
export function capturedCue({ kind, face, sides }) {
  if (kind === 'confirm') return null;
  // A COUNT THAT IS NOT A COUNT NEVER BECOMES A SENTENCE (audit, 2026-09-20). `scan-progress` is
  // validated by `sidesIn`; this path was not, so a malformed capture event said "NaN more sides" to
  // a child, or "7 more sides", or "4.5". Saying nothing is the honest answer to a number the
  // scanner cannot have meant — the chime still marks the capture.
  if (!Number.isInteger(sides) || sides < 1 || sides > SIDES) return null;
  // AND A COLOUR THAT IS NOT A COLOUR NEVER BECOMES ONE EITHER, the same rule for the new parameter.
  // `ScanCapture.face` is typed non-null and every caller passes a slot, but this reads an EVENT
  // from a custom element — the one boundary where the type is a promise rather than a guarantee —
  // and a bad slot here would say "Got the undefined side!" out loud to a child.
  const colour = COLOUR_NAMES[colourOfSlot(face)];
  if (!isColour(colourOfSlot(face)) || colour === undefined) return null;
  if (sides >= SIDES) {
    return {
      line: 'savedLast',
      params: [colour],
      holds: (q) => (q.phase === 'scanning' || q.phase === 'checking') && sidesOf(q) >= sides,
    };
  }
  return {
    // "One more to go" is kept for the last-but-one, where it is the encouraging thing to say and
    // cannot be mistaken for the count it replaced: it sits beside a named colour.
    line: SIDES - sides === 1 ? 'savedPenultimate' : 'savedSide',
    params: [colour],
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
/**
 * The voice's lifecycle: what is being said, whether it may outlive the screen, which line is the
 * latest, and a line worth trying once more.
 *
 * FOUR MUTABLE VARIABLES THAT ONLY EVER MOVE TOGETHER (audit, 2026-09-20). They lived as `let`s
 * beside the listeners, and every transition between them was implicit — `speaking` cleared here,
 * `finale` there, `latest` compared in a callback that closed over a number. Delayed failures make
 * these races, so the states are named and the transitions are the only way to reach them.
 */
function speechLife() {
  /** The state the line now being said describes, as the test that it still holds. */
  let speaking = null;
  /** How urgent the line now being said is, so a remark cannot cut off a question. */
  let rank = 0;
  /** Whether the line under way is "all done", the one line that may outlive the screen. */
  let finale = false;
  /** Which line is the latest, so a failure reported for one already replaced changes nothing. */
  let latest = 0;
  /** A line the platform failed for a reason that can pass, to try ONCE more at the next report. */
  let retry = null;
  /**
   * The line waiting for the one being said to finish — at most one, and always the newest.
   *
   * A QUEUE OF ONE, deliberately. The scan speaks about what just happened, so two lines deep is
   * already a voice describing the past: if a third thing happens while one line waits, the waiting
   * one is the stale one and the new one takes its place.
   */
  let pending = null;
  /** Whether the screen has gone: nothing more is said, and nothing in flight may speak again. */
  let dead = false;

  /** Say `cue` now, cutting off whatever is being said. */
  const begin = (cue, { outlivesScreen = false, retried = false } = {}) => {
    if (dead) return;
    const line = ++latest;
    retry = null;
    const ended = () => {
      // A line already replaced tells us nothing about the one now being said.
      if (line !== latest) return;
      speaking = null;
      rank = 0;
      finale = false;
      flush();
    };
    const onFail = (error) => {
      if (line !== latest) return;
      speaking = null;
      rank = 0;
      finale = false;
      if (!retried && RETRYABLE.has(error)) retry = { cue, outlivesScreen };
      flush();
    };
    // Resolved HERE, not when the cue was made: a line edited in Settings while the scan is on
    // screen is used by the very next thing said. In the language the words were translated into,
    // so a catalog is never read in an English voice; the count substitutes after the lookup, so a
    // catalog keeps one whole sentence rather than two halves around a number.
    const queued = say(cueText(cue), locale(), { onFail, onEnd: ended });
    speaking = queued ? cue.holds : null;
    rank = queued ? rankOf(cue) : 0;
    finale = queued && outlivesScreen;
    if (!queued) flush();
  };

  /**
   * Nothing is being said any more: start the line that was waiting.
   *
   * IT IS NOT RE-CHECKED HERE, and the first version of this got that wrong. `cutIfStale` already
   * drops a waiting line whose moment has passed, and it does so against the report in hand;
   * re-checking at flush time meant checking against the last report SEEN, which for a line queued
   * by a capture event is the report BEFORE it — so a perfectly good "Got the white side!" was
   * dropped for describing a moment that had, by that stale reading, not yet arrived. Reports come
   * about sixteen a second, so a waiting line is re-validated continuously; between two of them
   * there is no newer information, and saying it is the honest answer.
   */
  const flush = () => {
    if (dead || speaking !== null || pending === null) return;
    const next = pending;
    pending = null;
    begin(next.cue, next.opts);
  };

  return {
    get finale() { return finale; },
    /** Take the line worth retrying, if any, and forget it — a retry is never offered twice. */
    takeRetry() {
      const again = retry;
      retry = null;
      return again;
    },
    /** Say `cue`, or make it wait. Returns nothing; everything it decides lands in this object. */
    say(cue, opts = {}) {
      if (dead || !cue) return;
      // A LINE FINISHES UNLESS SOMETHING MORE URGENT ARRIVES. `say()` in speech.js cancels whatever
      // is being said, so every cue used to cut the one before it off mid-word — captures arrive
      // about every 2,153 ms and a line takes 1,333-2,733 ms, so the voice talked over itself all
      // the way through a scan. The earlier answer was to SHORTEN the sentences, which hid it.
      if (speaking !== null && rankOf(cue) <= rank) {
        pending = { cue, opts };
        return;
      }
      begin(cue, opts);
    },
    /**
     * The screen has gone: nothing more may be said, and nothing already in flight may speak.
     *
     * WHY THIS HAD TO EXIST (Codex audit, 2026-09-26). Leaving the screen used to hush and no more,
     * which was enough while a line could only ever be cut off — nothing survived teardown to do
     * anything later. The waiting queue changed that: this object now holds a `pending` line and an
     * `onEnd` callback on a platform utterance, and a late `end` from the ABANDONED scan called
     * `flush` -> `begin` -> `say`, whose first act is `synth.cancel()`. So an old scan reached
     * across and cut off the new one's opening line, then spoke a line about a scan that no longer
     * existed. Bumping `latest` is what disarms the callbacks already handed to the platform.
     */
    stop() {
      dead = true;
      pending = null;
      retry = null;
      latest += 1;
      speaking = null;
      rank = 0;
    },
    /** The moment the line described has passed: stop it. */
    cutIfStale(report) {
      if (speaking && !speaking(report)) {
        hush();
        speaking = null;
        rank = 0;
        finale = false;
      }
      // A waiting line whose moment has passed is dropped rather than said late.
      if (pending && !pending.cue.holds(report)) pending = null;
      flush();
    },
  };
}

/**
 * @param {object} deps `panel`, the scanner element whose events are heard; `signal`, the screen's
 *   abort signal, which removes the listeners and stops the voice.
 */
export function createSpokenScan({ panel: scanner, signal }) {
  let memo = QUIET;
  // A refusal is dispatched once and again when its diagnosis lands; it is said once per CHECK. A new
  // check — a correction, a side read again — may refuse again at the same count and be said again.
  let refusalSaid = false;
  const voice = speechLife();

  scanner.addEventListener('scan-capture', (e) => {
    refusalSaid = false;
    // A CAPTURE NEVER TALKS OVER A STANDING QUESTION (Codex audit, 2026-09-25). Answering with a
    // held colour files a side AND raises the displaced reading as the next question, in that
    // order: the progress report spoke "Now the side you showed before…", and then this event
    // cancelled it mid-sentence to say "Got the yellow side!" — so the one line a person had to act
    // on was the only one they never heard, and `identSaid` stopped it being said again.
    //
    // Dropped rather than queued, and the capture loses nothing by it: `scan-capture` rings the
    // chime, which is what marks an accepted side for a child who cannot read. The question is the
    // only part that needs words.
    if (memo.identSaid !== null) return;
    voice.say(capturedCue(e.detail));
  }, { signal });
  scanner.addEventListener('scan-invalid', () => {
    if (refusalSaid) return;
    const cue = refusedCue(memo);
    if (cue) { refusalSaid = true; voice.say(cue); }
  }, { signal });
  scanner.addEventListener('scan-progress', (e) => {
    const p = e.detail;
    voice.cutIfStale(p);
    if (p.phase === 'checking' || sidesOf(p) < memo.sides) refusalSaid = false;
    const heard = hear(memo, p);
    memo = heard.memo;
    const again = voice.takeRetry();
    if (heard.cue) voice.say(heard.cue);
    else if (again?.cue.holds(p)) voice.say(again.cue, { outlivesScreen: again.outlivesScreen, retried: true });
  }, { signal });

  // Leaving stops the voice — except "all done", which an accepted scan can leave the screen in the
  // middle of (auto-solve, a scan answering a reconnect question) and which is still true where the
  // app went; cut at the jump, a child on auto-solve never heard it (round-3 audit).
  signal?.addEventListener('abort', () => {
    // READ BEFORE STOPPING: "all done" is the one line allowed to outlive the screen, so whether to
    // hush is decided on the state as it was, and `stop()` then disarms everything either way.
    const keep = voice.finale;
    voice.stop();
    if (!keep) hush();
  }, { once: true });
  /** The screen accepted a finished scan: say so (see `acceptedCue`). */
  return Object.freeze({ accepted: () => voice.say(acceptedCue(), { outlivesScreen: true }) });
}
