// What every stage's tutorial needs from the renderer, as data a test can hold the code to.
//
// The plan (dev-docs/tutorial-capability-plan.md, Phase 0) makes this the definition of done: a
// capability exists when a scenario that needs it passes against the renderer's PUBLIC surface.
// dev-docs/tutorial-scenarios.md is the readable matrix; this file is the half that is checked.
//
// Three tables:
//   CAPABILITIES  every capability a tutorial uses or will use, whether the public surface can do it
//                 today, and the plan item that closes it when it cannot;
//   SOURCES       every vocabulary a tutorial is written in today — the lesson course's cue verbs, the
//                 method solver's step kinds and reason keys, the stage targets — mapped onto
//                 capabilities. `tutorial-scenarios.test.mjs` reads each vocabulary from its origin
//                 and fails on a word this table does not map;
//   SCENARIOS     (added by plan item 0.2) runnable cases with checkpoints from independent oracles.

/** `works`: the public surface does it today. `partial`: done, but outside the surface or only in
 *  part — `item` says what finishes it. `gap`: not possible today — `item` is the plan item. */
export const CAPABILITIES = Object.freeze({
  'face-turns': { what: 'the 18 face turns inside a sequence', status: 'works' },
  'hold-set': { what: 'turn the whole cube to one of 24 holds (orientation, turnTo)', status: 'works' },
  'hold-change-in-sequence': { what: 'a whole-cube turn made between two moves of one sequence', status: 'gap', item: '2.2' },
  'rotation-token': { what: 'x y z written inside a move sequence', status: 'gap', item: '2.1' },
  'wide-move': { what: 'Rw, 2Rw, lowercase r', status: 'gap', item: '2.1' },
  'slice-move': { what: 'M E S', status: 'gap', item: '2.1' },
  'held-letters': { what: 'moves and selectors written the way the child holds the cube', status: 'partial', item: '1.2' },
  question: { what: 'ask one cube a question: pieces home, where a piece is, edges carrying no colour of a face', status: 'gap', item: '1.4' },
  'highlight-piece': { what: 'light a piece by identity; the light travels with it', status: 'works' },
  'highlight-position': { what: 'light a slot, a layer or a kind of piece', status: 'works' },
  'highlight-sticker': { what: 'light one sticker of a piece', status: 'gap', item: '4.1' },
  'selector-sets': { what: 'combine selectors: A + B, A - B', status: 'gap', item: '4.1' },
  focus: { what: 'grey everything a cue does not name', status: 'works' },
  ghosts: { what: 'see the hidden faces: floating ghosts, back view', status: 'works' },
  camera: { what: 'place the eye: latitude, longitude, a tour', status: 'works' },
  arrow: { what: 'a turn arrow on the face about to move', status: 'gap', item: '4.2' },
  label: { what: 'face letters on the cube', status: 'gap', item: '4.3' },
  trail: { what: 'the path a piece takes over a sequence', status: 'gap', item: '4.4' },
  'flat-view': { what: 'a net or a top-face case diagram drawn from the same model', status: 'gap', item: '4.5' },
  'several-cubes': { what: 'many cubes on one page', status: 'partial', item: '4.6' },
  pick: { what: 'touch a piece, sticker or centre on the cube itself', status: 'gap', item: '5.3' },
  'drawn-colours': { what: 'the colours the cube is drawn in, under the palette and scheme in force', status: 'partial', item: '5.1' },
  'piece-state': { what: 'which piece is where and how it faces, for a page to count with', status: 'partial', item: '5.2' },
  'painted-picture': { what: 'a picture with unknown stickers, no state behind it', status: 'partial', item: '3.1' },
  'clock-playback': { what: 'a sequence timed to narration, seekable to any instant', status: 'works' },
  'stop-playback': { what: 'a walk a smart cube follows, one observable step at a time', status: 'partial', item: '3.3' },
  'drill-round': { what: 'prompt, pick, deselect, lock, mark, reveal, advance', status: 'partial', item: '3.4' },
  'animating-state': { what: 'whether a move is still animating, as a public member', status: 'partial', item: '2.5' },
  'page-overlay': { what: 'words and numbers the page draws beside the cube (the course number, the hold sentence)', status: 'works' },
});

/** The lesson course's cue verbs, as `parse-lesson.py` accepts them, and what each one needs. */
export const CUE_VERBS = Object.freeze({
  show: ['highlight-piece', 'highlight-position'],
  turn: ['face-turns', 'clock-playback', 'held-letters'],
  scramble: ['face-turns', 'held-letters'],
  solve: ['face-turns', 'clock-playback'],
  reset: ['face-turns'],
  focus: ['focus'],
  ghosts: ['ghosts'],
  camera: ['camera'],
  hold: ['hold-set', 'hold-change-in-sequence', 'held-letters'],
  number: ['page-overlay'],
});

/** The method solver's two kinds of step. */
export const STEP_KINDS = Object.freeze({
  goal: ['face-turns', 'highlight-piece', 'stop-playback'],
  case: ['face-turns', 'highlight-piece', 'stop-playback'],
});

/** Every reason key the method solver emits (`WHY_KEYS` in `lib/method-lesson.js`). */
export const WHY_KEYS = Object.freeze({
  'cross.lift': ['face-turns', 'highlight-piece', 'held-letters'],
  'cross.insert': ['face-turns', 'highlight-piece', 'held-letters'],
  'cross.whole': ['face-turns', 'highlight-piece', 'held-letters'],
  'firstLayer.lift': ['face-turns', 'highlight-piece', 'held-letters'],
  'firstLayer.insert': ['face-turns', 'highlight-piece', 'held-letters'],
  // The middle layer is where the owner's scenario lives: turn the gap to the front (a whole-cube
  // turn inside the sequence) and find the edges carrying none of the top colour (a question).
  'middleLayer.insert': ['face-turns', 'highlight-piece', 'held-letters', 'hold-change-in-sequence', 'question'],
  'middleLayer.eject': ['face-turns', 'highlight-piece', 'held-letters', 'hold-change-in-sequence'],
  'f2l.pair': ['face-turns', 'highlight-piece', 'held-letters', 'hold-change-in-sequence'],
  'topCross.orient': ['face-turns', 'highlight-position', 'highlight-sticker'],
  'topCross.orient.step': ['face-turns', 'highlight-position', 'highlight-sticker'],
  'topFace.orient': ['face-turns', 'highlight-position', 'highlight-sticker'],
  'topFace.orient.step': ['face-turns', 'highlight-position', 'highlight-sticker'],
  'topCorners.permute': ['face-turns', 'highlight-position', 'trail'],
  'topCorners.permute.step': ['face-turns', 'highlight-position', 'trail'],
  'lastLayer.align': ['face-turns', 'highlight-position'],
  'topEdges.permute': ['face-turns', 'highlight-position', 'trail'],
  'topEdges.permute.step': ['face-turns', 'highlight-position', 'trail'],
  'lastLayer.permute': ['face-turns', 'highlight-position', 'trail'],
});

/** The named states a walk can aim at (`TARGETS` in `lib/stage-targets.js`): each is drawn as a
 *  picture with what it does not constrain left unknown, and is followed by a walk. */
export const TARGET_IDS = Object.freeze({
  cross: ['painted-picture', 'stop-playback', 'hold-set'],
  'first-layer': ['painted-picture', 'stop-playback', 'hold-set'],
  'two-layers': ['painted-picture', 'stop-playback', 'hold-set'],
  'top-cross': ['painted-picture', 'stop-playback', 'hold-set'],
  'corners-home': ['painted-picture', 'stop-playback', 'hold-set'],
  'six-cross': ['painted-picture'],
  solved: ['painted-picture', 'stop-playback'],
});

/**
 * Every place teaching happens today, and every stage still to be taught, by what it uses.
 * `uses` is what it does today; `wants` is what the stage calls for and cannot have yet.
 */
export const SOURCES = Object.freeze([
  { stage: 'concepts', where: 'cubus-im lessons 1-6', uses: ['face-turns', 'highlight-piece', 'highlight-position', 'focus', 'camera', 'ghosts', 'page-overlay', 'clock-playback'], wants: ['label', 'arrow'] },
  { stage: 'concepts', where: 'cubus-im playground (three modes)', uses: ['face-turns', 'highlight-piece', 'piece-state'], wants: ['trail'] },
  { stage: 'cross', where: 'cubus-im lessons 7-8; app cross rungs', uses: ['face-turns', 'highlight-piece', 'highlight-position', 'focus', 'ghosts', 'hold-set', 'clock-playback', 'stop-playback'], wants: [] },
  { stage: 'first layer', where: 'cubus-im lessons 9-10; app first-layer rung', uses: ['face-turns', 'highlight-piece', 'highlight-position', 'focus', 'hold-set', 'clock-playback', 'stop-playback'], wants: ['hold-change-in-sequence', 'question'] },
  { stage: 'middle layer', where: 'cubus-im lessons 11-12; app middle-layer rung', uses: ['face-turns', 'highlight-piece', 'highlight-position', 'focus', 'hold-set', 'clock-playback', 'stop-playback'], wants: ['hold-change-in-sequence', 'rotation-token', 'held-letters', 'question'] },
  { stage: 'last layer', where: 'cubus-im lessons 13-16; app OLL and PLL rungs', uses: ['face-turns', 'highlight-position', 'highlight-piece', 'focus', 'clock-playback', 'stop-playback'], wants: ['highlight-sticker', 'trail', 'arrow'] },
  { stage: 'whole solve', where: 'cubus-im lesson 17; app Solution walk', uses: ['face-turns', 'highlight-piece', 'hold-set', 'clock-playback', 'stop-playback'], wants: ['hold-change-in-sequence'] },
  { stage: 'F2L', where: 'not taught; app joined-pairs rung and the 41 cases in lib/data/case-tables.js', uses: ['face-turns', 'highlight-piece', 'stop-playback'], wants: ['hold-change-in-sequence', 'question', 'flat-view', 'several-cubes'] },
  { stage: 'OLL and PLL', where: 'app Trainer and Drill previews; the 57 and 21 cases', uses: ['page-overlay'], wants: ['wide-move', 'rotation-token', 'highlight-sticker', 'flat-view', 'several-cubes', 'trail', 'drill-round'] },
  { stage: 'other methods', where: 'cubus-im method pages: Roux, ZZ, Petrus, Mehta, 3-style', uses: ['painted-picture', 'focus', 'several-cubes'], wants: ['slice-move', 'wide-move', 'selector-sets', 'trail'] },
  { stage: 'drills', where: 'cubus-im recognition and prediction drills', uses: ['highlight-piece', 'highlight-position', 'drawn-colours', 'drill-round', 'camera'], wants: [] },
  { stage: 'practice cards', where: 'cubus-im practice cards', uses: ['painted-picture', 'hold-set', 'several-cubes'], wants: [] },
  { stage: 'sheets', where: 'cubus-im cheatsheets, flowchart and charts', uses: ['face-turns', 'focus', 'ghosts', 'hold-set', 'several-cubes', 'painted-picture'], wants: ['flat-view', 'arrow'] },
  { stage: 'scan', where: 'app scan screen: the half-read cube', uses: ['painted-picture'], wants: [] },
  { stage: 'companion', where: 'cubus-im lesson companion', uses: ['drawn-colours'], wants: [] },
]);
