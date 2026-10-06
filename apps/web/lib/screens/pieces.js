// The Pieces screen: read a scrambled cube and say where one piece belongs.
//
// ITS OWN TAB SINCE 2026-09-29 (owner's call, option C). It was a second KIND inside the Drill
// screen, chosen from a two-button row, and the pairing was the problem. Drill's other kind is
// "perform this algorithm" — an advanced skill on one catalogue case — while this is cube literacy on
// a random fourteen-turn stir. Side by side they read as two difficulty levels of one activity, and a
// first-time reader asked what the alternative even was: "aren't all these moves already about
// pieces?" There was no relationship to state. The two were built at different times and grouped
// because both are practice, and the code said so in its own words.
//
// What the pairing implied and did not deliver is "recognise, then execute". This drill is not the
// recognition half of an algorithm: it asks where a single piece lives, which is what cross and
// first-layer intuition are built on, and says nothing about which algorithm a case needs. Making it
// that half would be a different feature (option B, not taken); separating the two is this change.
//
// Drill therefore means one thing now, and this screen keeps working unchanged — the round engine,
// the question, the answer and the reveal are the same code, moved.
//
// HIDDEN BY DEFAULT, with the opt-in screens rather than with the placeholders. It is not a
// placeholder: practice works and it reports nothing it did not measure. It is hidden because the
// default tab row is the beginner's path to a solved cube and this is a side exercise, one chord
// away — the same reason Timer and Stats are hidden, and not the Alg trainer's reason.
import { SCREENS, screenAbort } from '../screen-shell.js';
import { drillHtml, mountDrill } from './pieces/round-play.js';

SCREENS.pieces = () => ({
  html: drillHtml(),
  mount(root) {
    const mounted = mountDrill(root);
    // Disposal is the abort listener's, exactly as it was when this screen was a Drill kind: that is
    // what stops the reveal's pending timer, so a screen that is gone is not still writing to the
    // element it used to own.
    screenAbort?.signal?.addEventListener('abort', () => mounted.dispose(), { once: true });
  },
});

export { drillHtml, mountDrill };
