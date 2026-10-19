// THE SPACES THE PORTRAIT WALKING COMPOSITION HOLDS ON PURPOSE (dev-docs/practice-redesign-plan.md E12.7). Each is kept
// whether or not anything is in it, so that nothing appearing there ever resizes the cube — and an empty one is room the
// eye sees as a gap. geometry.test.mjs's gap gate measures to such a slot's BOX, not to what is drawn in it, and only to
// the slots named here; every other gap is measured from drawn thing to drawn thing. The Practice case asserts every
// entry is on the page, so this list can never quietly cover nothing.

export const RESERVED_SLOTS = Object.freeze([
  // The trigger labels' row over Practice's strip (E12.5): a label coming into view never moves the turns under it.
  Object.freeze({ name: 'the trigger label row', selector: '.practice-page #practiceAlg .walk-sec-l' }),
  // The quiet line's slot, two caption lines tall: the follow-note takes its place and moves nothing (E11.3).
  Object.freeze({ name: 'the quiet line\'s two-line slot', selector: '.practice-page .practice-said' }),
  // The room kept at the foot of the cube card for the longest thing the band over it can say (E12.8): kept whether or
  // not the band is up, so the cube is one size. Its box is `--band-reserve` tall, nothing where no room is needed.
  Object.freeze({ name: 'the band\'s reserve under the cube', selector: '.cols.walking .band-reserve' }),
]);
