// The scan screen's SOUNDS — which state a report puts the scan in, and the chime that says so.
//
// This replaced a module of eleven sentences read aloud by `speechSynthesis`, with an editable copy of
// each in Settings. The owner's judgement on 2026-09-30 was that the spoken prompts were worse than
// nothing and that a different sound per state says what they said, so the words, the editor and
// the `voice` mode are gone and this keeps the one part that was hard.
//
// WHAT WAS HARD IS DECIDING WHEN, NOT WHAT. `scan-progress` arrives about once a second and mostly
// repeats itself, so a cue fired per report is a cue heard as a stutter. `hear` is the memory that
// turns a stream of reports into the MOMENT a state was entered — and its ladder is ordered, because
// a question that blocks the scan on a person outranks a side they can simply turn. Every rung of it
// is still tested as a table (test/scan-screen.test.mjs); what changed is the text and the speech
// lifetime, not the state machine.
//
// AND THE LIFETIME IS GONE WITH THE WORDS. A spoken line takes seconds, so it had to be cut when it
// went stale, queued behind a standing question, retried, and allowed to outlive the screen in one
// case — `holds`, `cutIfStale`, `takeRetry`, `outlivesScreen`. A chime is a fifth of a second and
// fire-and-forget: there is nothing to cut, so none of that survives.
//
// WHAT THIS FILE DOES NOT SOUND: a side saved, and a cube that checked out. Those are
// `lib/screens/scan/chime.js`'s, tied to the scanner's `scan-capture` and to the SCREEN's
// acceptance, and sounding them here as well would ring each of them twice.
import { play } from '../../sound.js';
import { sidesIn as sidesOf } from './report-sides.js';

/** Nothing heard yet. The memo `hear` starts from and returns to when a scan is thrown away. */
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
 * WHICH SOUND EACH STATE GETS, and the two that get none.
 *
 * `open` is silent: it is the state the scan begins in, and a chime for "I am ready" fires as the
 * screen appears, which is noise rather than news. `which` and `whichAgain` share `ask` because
 * they are the same demand on a person — answer me — and differ only in which reading they are
 * about, which is on screen.
 */
export const SOUND_FOR = Object.freeze({
  open: null,
  ask: 'ask',
  which: 'ask',
  whichAgain: 'ask',
  again: 'again',
  camera: 'help',
  help: 'help',
});

const askOf = (p) => (p.confirm ? `${p.confirm.face}/${p.confirm.up}` : null);
const identOf = (p) => p.identity?.id ?? null;

/**
 * The state a report puts the scan in, if it is a new one, and what to remember for the next report.
 *
 * Pure, and the reason this module still exists. @returns {{ memo: object, state: string | null }}
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
    // The count at which "I have got that one" was last sounded, so the same side settling over and
    // over does not restart it. A count that CHANGES — a side captured, or a scan thrown away —
    // makes it soundable again, which is exactly when it is news again.
    againSaid: memo.againSaid,
    // An ask is remembered as SOUNDED only when it was chosen. Recorded as merely seen, one that
    // arrived beside a camera error was never sounded once the camera recovered (audit, 2026-09-19).
    askSaid: ask === null ? null : memo.askSaid,
    // KEYED ON THE QUESTION'S ID, never on the colour it is about. An answer naming a held colour
    // raises a SECOND question, about the displaced reading and about the SAME colour — so a memo
    // keyed on the colour would fall silent for exactly the follow-up a person has to answer.
    identSaid: ident === null ? null : memo.identSaid,
    phase: p.phase,
  };
  // While the camera is in trouble, nothing else sounds — every other state asks for something the
  // scanner cannot see — and it sounds on ENTERING the error, not per message, since one failure can
  // report several (audit, 2026-09-19).
  if (p.phase === 'error') {
    return { memo: next, state: memo.phase === 'error' ? null : 'camera' };
  }
  if (ask !== null && ask !== next.askSaid) {
    next.askSaid = ask;
    return { memo: next, state: 'ask' };
  }
  // AHEAD OF `again`, and for the reason the ladder is a ladder: a question blocks the scan on a
  // person, where "I've got that one" only reports on a side they can simply turn.
  if (ident !== null && ident !== next.identSaid) {
    next.identSaid = ident;
    return { memo: next, state: p.identity?.displaced ? 'whichAgain' : 'which' };
  }
  if (next.again && memo.againSaid !== sides) {
    next.againSaid = sides;
    return { memo: next, state: 'again' };
  }
  if (!next.opened && p.phase === 'scanning' && p.device && sides === 0) {
    next.opened = true;
    return { memo: next, state: 'open' };
  }
  return { memo: next, state: null };
}

/**
 * Whether a refused scan is a state to sound, and which.
 *
 * Never over an ask for a side back — that is still the thing to do — and never while painting,
 * which is a grown-up's mode already. `memo` is this module's memory at the refusal.
 */
export function refused(memo) {
  if (memo.askSaid !== null || memo.phase === 'painting') return null;
  return 'help';
}

/**
 * @param {object} deps `panel`, the scanner element whose events are heard; `signal`, the screen's
 *   abort signal, which removes the listeners.
 */
export function createScanCues({ panel: scanner, signal }) {
  let memo = QUIET;
  // A refusal is dispatched once and again when its diagnosis lands; it sounds once per CHECK. A new
  // check — a correction, a side read again — may refuse again at the same count and sound again.
  let refusalSounded = false;
  /** Sound a state, if that state has a sound. */
  const sound = (state) => {
    const name = state === null ? null : SOUND_FOR[state];
    if (name) play(name);
  };

  scanner.addEventListener('scan-capture', () => { refusalSounded = false; }, { signal });
  scanner.addEventListener('scan-invalid', () => {
    if (refusalSounded) return;
    const state = refused(memo);
    if (state) { refusalSounded = true; sound(state); }
  }, { signal });
  scanner.addEventListener('scan-progress', (e) => {
    const p = e.detail;
    if (p.phase === 'checking' || sidesOf(p) < memo.sides) refusalSounded = false;
    const heard = hear(memo, p);
    memo = heard.memo;
    sound(heard.state);
  }, { signal });
  // Nothing to stop on the way out: a chime already sounding is `stopAll`'s business, and that is
  // `chime.js`'s, which owns the scan's other two sounds and its teardown.
  return Object.freeze({ get memo() { return memo; } });
}
