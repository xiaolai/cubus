// THE RECORD'S NOTICE, IN FIXED WORDS (dev-docs/practice-redesign-plan.md E12.8). It stands in the band over the foot of
// the cube card in portrait, and the room kept for that band is sized to the longest thing it can hold — so what it says
// is a sentence known before anything fails, never a failure's own message, whose length nobody can know. The message
// is not lost: the page logs it with `console.error` where the failure arrives. Two sentences, and both may stand at once.
//
// English source text, looked up through `t()` where it is shown (lib/i18n.js).

export const RECORD_SAYS = Object.freeze({
  /** A rep's save did not land — whichever algorithm it was a rep of. */
  save: 'A rep was not saved.',
  /** The record, or the earlier record it would have taken in, could not be read: either is left exactly as it is. */
  read: 'Your practice record could not be read, so it is left as it is.',
});
