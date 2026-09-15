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

/**
 * The runnable corpus (plan item 0.2). Expected values are NOT written here: the runner asks
 * `test/cube-oracle.mjs`, which shares no code with the renderer, at test time.
 *
 * Every scenario names the half that runs it — `model` (node: notation, interpreter, questions),
 * `element` (a browser: what `<cubus-cube>` draws), `player` (the script player's drivers) — and the
 * plan item that makes it runnable (`closedBy`), or, for behaviour already pinned elsewhere, the test
 * that pins it (`coveredBy`: file and test name, both checked to exist).
 *
 * Moves are written in the CHILD's frame — letters name where a face is now — except in `identity`
 * scenarios, which are written the way `<cubus-cube>`'s `alg` reads them today: the white-up,
 * green-front frame, whatever the element's `orientation`.
 */
export const SCENARIOS = Object.freeze([
  // ---- what the element does today --------------------------------------------------------------
  {
    id: 'face-turns-at-reference', stage: 'every stage', half: 'element', kind: 'identity',
    source: 'the 18 face turns every tutorial is made of', needs: ['face-turns', 'hold-set'],
    orientation: 'U F', alg: "R U R' U' F2 D L' B",
  },
  {
    id: 'face-turns-tumbled', stage: 'middle and last layer', half: 'element', kind: 'identity',
    source: 'ADR 0003: tumbled for the middle layer onwards, moves named in the fixed frame', needs: ['face-turns', 'hold-set'],
    orientation: 'D B', alg: "R U R' U' F2 D L' B",
  },
  {
    id: 'face-turns-every-hold', stage: 'every stage', half: 'element', kind: 'identity-all-holds',
    source: 'a sequence drawn under each of the 24 holds', needs: ['face-turns', 'hold-set'],
    alg: "R U2 F' L D B2",
  },

  // ---- the owner's scenario and the course's --------------------------------------------------------
  {
    id: 'red-green-edge-into-FR', stage: 'middle layer', half: 'model', kind: 'moves', closedBy: '1.2',
    source: "the owner, 2026-09-15: tumbled, turn red to the front, insert the red-green edge",
    needs: ['held-letters', 'rotation-token', 'hold-change-in-sequence'],
    start: { hold: 'D B', setup: "y F' U' F U R U R' U' y'" }, moves: "y U R U' R' U' F' U F",
    expect: { holdAfter: { 1: 'D R' }, solvedAtEnd: true },
  },
  {
    id: 'red-green-edge-question', stage: 'middle layer', half: 'model', kind: 'question', closedBy: '1.4',
    source: "the owner, 2026-09-15: find the top edges with none of the top colour",
    needs: ['question'],
    start: { hold: 'D B', setup: "y F' U' F U R U R' U' y'" }, moves: 'y', ask: 'topEdgesWithoutTopColour',
  },
  {
    id: 'lesson-12-piece-under-grip-and-hold', stage: 'middle layer', half: 'model', kind: 'selectors', closedBy: '1.3',
    source: 'cubus-im lesson 12 section 2: # grip: x2, @ hold y2, @ show piece:FL',
    needs: ['held-letters', 'highlight-piece'],
    hold: 'D F', selector: 'piece:FL',
  },
  {
    id: 'lesson-10-closing-flip', stage: 'first layer', half: 'player', kind: 'timed-trailing-rotation', closedBy: '3.3',
    source: 'cubus-im lesson 10 section 4: a scramble, narration, then @ hold x2 with no turn after it',
    needs: ['hold-change-in-sequence', 'clock-playback'],
    start: { hold: 'U F', setup: "D R2 U2 L D L U B2 U D2 R' D' R D" }, moves: 'x2',
  },
  {
    id: 'oll-24-with-a-wide-move', stage: 'OLL', half: 'model', kind: 'moves', closedBy: '1.2',
    source: "the Trainer preview's OLL 24", needs: ['wide-move', 'held-letters'],
    start: { hold: 'U F', setup: "F R' F' r U R U' r'" }, moves: "r U R' U' r' F R F'",
    expect: { solvedAtEnd: true },
  },
  {
    id: 'roux-slices', stage: 'other methods', half: 'model', kind: 'moves', closedBy: '1.2',
    source: 'Roux last six edges: M U2 M', needs: ['slice-move', 'held-letters'],
    start: { hold: 'U F', setup: '' }, moves: "M' U2 M",
  },

  // ---- ADR 0004's requirements -------------------------------------------------------------------
  {
    id: 'R1-centre-moving-tokens', stage: 'every stage', half: 'element', kind: 'element-tokens', closedBy: '2.1',
    source: 'ADR 0004 R1', needs: ['slice-move', 'wide-move', 'rotation-token'],
    orientation: 'U F', algs: ['M', 'Rw', 'x', 'y', "M' U2 M", "r U R' U' r' F R F'"],
  },
  {
    id: 'R2-episode-rotation-single-timeline', stage: 'every stage', half: 'player', kind: 'episode-hold-timeline', closedBy: '3.3',
    source: 'ADR 0004 R2', needs: ['hold-change-in-sequence', 'clock-playback'], moves: 'y R',
  },
  {
    id: 'R3-walk-draws-by-stop', stage: 'middle layer', half: 'player', kind: 'walk-stops', closedBy: '3.3',
    source: 'ADR 0004 R3', needs: ['stop-playback', 'rotation-token'], walks: ['y R', 'y x R'],
  },
  {
    id: 'R4-a-stop-animates-its-rotations', stage: 'every stage', half: 'element', kind: 'stop-animation', closedBy: '2.3',
    source: 'ADR 0004 R4', needs: ['stop-playback', 'rotation-token'], alg: 'x y R',
  },
  {
    id: 'R5-slice-reported-as-two-turns', stage: 'other methods', half: 'player', kind: 'walk-reports', closedBy: '3.3',
    source: 'ADR 0004 R5', needs: ['stop-playback', 'slice-move'],
    planned: "M M'", reports: ["R L' L R'", "L' R R' L"],
  },
  {
    id: 'R6-revisited-arrangement', stage: 'every stage', half: 'player', kind: 'covered',
    source: 'ADR 0004 R6, fixed in e64817e', needs: ['stop-playback'],
    coveredBy: ['apps/web/test/walk-session.test.mjs', "a turn that cancels the one before it is the walk's next move, not an undo"],
  },
  {
    id: 'R7-trailing-rotation-on-schedule', stage: 'first layer', half: 'player', kind: 'timed-trailing-rotation', closedBy: '3.3',
    source: 'ADR 0004 R7', needs: ['hold-change-in-sequence', 'clock-playback'],
    start: { hold: 'U F', setup: "D R2 U2 L D L U B2 U D2 R' D' R D" }, moves: 'x2',
  },
  {
    id: 'R8-selector-written-mid-turn', stage: 'every stage', half: 'element', kind: 'covered',
    source: 'ADR 0004 R8, fixed in 2ca615c', needs: ['highlight-position', 'focus'],
    coveredBy: ['apps/web/test/browser/renderer-pose.test.mjs', 'a selector written mid-turn names the settled occupant, and each channel keeps its own rule after'],
  },
  {
    id: 'R9-inherited-selector-binds-once', stage: 'every stage', half: 'player', kind: 'selector-provenance', closedBy: '3.1',
    source: 'ADR 0004 R9', needs: ['highlight-position', 'clock-playback'], selector: 'slot:UR', moves: 'R',
  },
  {
    id: 'R10-focus-survives-seek', stage: 'every stage', half: 'element', kind: 'focus-seek', closedBy: '2.4',
    source: 'ADR 0004 R10', needs: ['focus'], selector: 'slot:UR', alg: 'R',
  },
  {
    id: 'R11-focus-and-highlight-keep-their-split', stage: 'every stage', half: 'element', kind: 'covered',
    source: 'ADR 0004 R11 and decision 10', needs: ['focus', 'highlight-position'],
    coveredBy: ['apps/web/test/browser/renderer-pose.test.mjs', 'focus set before a turn and after it are different pictures, and still are'],
  },
]);
