// THE SUPPORTED SURFACE. What another project may depend on, stated in one place.
//
// Not a convenience. Every module under `apps/web/lib/` is equally reachable by a relative path,
// so today there is no such thing as a private one and no way to know whether renaming an export
// breaks somebody. cubus-im — the lesson course — reaches into five files by hardcoded path and
// one by regular expression, and nothing in THIS repository goes red when any of them moves.
// `test/cube-kit-surface.test.mjs` is what closes that, and this file is what it can be written
// against.
//
// WHAT THIS FILE IS NOT. It does not make a relocated checkout work: an import specifier must be
// a literal, so a consumer still cannot put an environment variable in one — a barrel just moves
// that problem into a single import instead of five. Resolution is a separate job, done by the
// `exports` map in `package.json` plus a link, or by a resolver on the consumer's side using
// dynamic `import()`. Anyone reaching for this file to fix a path is in the wrong place.
//
// Adding an export here is free. REMOVING or renaming one is a breaking change to a downstream
// project, which is exactly what the surface test makes visible before it ships.

// The move tables — the app's model of a cube's pieces, replayed by every check the course runs.
export {
  CORNER,
  CORNERS,
  EDGE,
  EDGES,
  MOVE_NAMES,
  MOVES,
  SOLVED,
  allSolved,
  applyAlg,
  applyMove,
  cornerSlot,
  cornerSolved,
  edgeSlot,
  edgeSolved,
  fromCube,
  invert,
  moveCount,
  movesOf,
  rotateAlg,
  rotateState,
} from './cube-pieces.js';

// The camera's own geometry — where the eye is, what the cube's outline is, and how far back the
// camera has to sit for the whole of it to land inside a frame of a given shape.
export {
  cameraAxes,
  eyeDirection,
  fitDistance,
  fitDistanceStable,
  project,
  silhouette,
} from './cube-frame.js';

// The selector grammar: `slot:UF`, `layer:U`, `piece:BL` — how a lesson says "these pieces".
export {
  KIND,
  parseHighlight,
  pieceKey,
  resolveHighlight,
  selects,
  slotVector,
} from './cube-highlight.js';

// The 24 orientations, as a facelet operation and as a rotation. Both halves of a turn: the
// stickers move AND the letters are renamed to the faces they now sit on.
export {
  FACE_LETTERS,
  ORIENTATIONS,
  determinant,
  orientationMatrix,
  orientationPerm,
  orientationRelabel,
  sameAxis,
  turnFacelets,
} from './cube-orientation.js';

// Notation as syntax: text to layer-mask moves — faces, outer blocks, slices, rotations — with no hold
// and no colour (dev-docs/adr/0004-orientation-notation-and-colour-are-three-things.md, decision 4).
export { formatMoves, parse } from './cube-notation.js';

// The interpreter: the child's moves, read in the hold in force as each is made, applied to a cube —
// the pieces, the hold after, and the identity-frame tokens that draw it (ADR 0004 decision 5).
export { convertSelectors, heldFace, identityFace, run } from './cube-moves.js';

// Questions a tutorial asks of one cube — a piece state or a painted picture with unknown stickers.
// They read and never move (dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md, decision 2).
export {
  edgesInLayerWithout,
  inLayerWithout,
  isHome,
  layerSlots,
  pairOf,
  pieceIn,
  piecesAway,
  readCube,
  whereIs,
} from './cube-questions.js';

// The view the app draws its own cubes at, so a consumer's cubes can look like the app's without
// keeping a hand-copied set of numbers that goes stale in silence.
export { CUBE_VIEW, CUBE_VIEW_ATTRS } from './cube-view.js';

// The episode runtime. cubus-im authors the scores, measures the speech and builds the artifacts;
// the RUNTIME — what the cube is doing at time `t`, and writing that onto an element — is the same
// question the app has to answer, so it is answered once here. `spanning` resolution is part of it
// rather than part of a build script, because a schedule that resolves it differently is a
// different schedule with nothing to say so.
export { checkEpisode, MIN_PER_MOVE, resolveSpanning, SPAN_LEAD } from './lesson-format.js';

// A SCRIPT is the same tutorial with no clock attached: steps in the child's frame, cues that take
// effect where they are written, pictures that are not cubes, and drill rounds
// (dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md decision 3). `checkLesson` is the one
// door that tells the two kinds apart.
export { STEP_CUES, STEP_KINDS, checkLesson, checkScript } from './lesson-format.js';

// The questions a script names, and the frame they are asked in: a script writes "the top edges with
// none of the top colour" the way the child holds the cube, and this is where that becomes a question
// `lib/cube-questions.js` can answer.
export { QUESTIONS, TAKES_ARGUMENT, ask, readAsk } from './script-questions.js';

// A script's cube at every position — the pure half every driver stands on (plan item 3.2).
export { askAt, buildScript, groupsOf, stateFrom, viewAtPosition } from './script-view.js';

// The drivers: a clock (a narrated lesson), stops (a walk a cube follows), and the one writer both hand
// their views to — plus the matcher that finds a turned cube on a walk (plan item 3.3).
export { createClockDriver, createElementWriter, createStopDriver, timelineOf } from './script-drive.js';
export { locate, trackFor, trackOf } from './script-track.js';

// The event driver: a drill round's answer worked out from the cube, its picks and verdict, and its reveal
// as a script segment (plan item 3.4). The page keeps its controls; a round never reads the DOM.
export { answerAt, createEventDriver, createRound, revealScript } from './script-rounds.js';
export { ROUND_QUESTIONS } from './lesson-format.js';

// The load contract: one route at a time, nothing from a superseded one applied, and the connection's
// live model kept across loads and located on each (plan item 3.5).
export { createScriptPlayer } from './script-player.js';

// Flat views from the same model: the net and the top-face case diagram, as SVG text (plan item 4.5).
export { TOP_RING, faceletsOf, netSvg, topFaceSvg } from './cube-flat.js';

// Many cubes on one page: live cubes while the browser can hold them, flat diagrams past that (plan item 4.6).
export { CONTEXT_CAP, LIVE_BUDGET, flatGallery, galleryKind } from './cube-gallery.js';
export {
  CAM_DEFAULT,
  CAM_EASE,
  GHOST_ELEV,
  GHOST_REVEAL,
  QUARTER_GAP,
  buildSchedule,
  cameraAt,
  lineAt,
  numberAt,
  segmentAt,
  viewAt,
} from './lesson-schedule.js';
export { createLessonPlayer } from './lesson-player.js';
