// Which way up the cube is HELD while it is being solved, and the two renamings that follow from it.
//
// The owner's convention, 2026-09-13 (dev-docs/adr/0003-white-first-and-the-tumble.md):
//
//   * the method is WHITE-FIRST — the cross and the first layer are white, the top is yellow;
//   * the cross AND the first layer are built WHITE UP, green facing you — the hold the scan
//     already asks for, and the lesson course's (cubus-im ADR 0002, decisions 3 and 4);
//   * once the first layer is complete the cube TUMBLES FORWARD — white underneath, green at the
//     back, the last layer on top — for the middle layer and everything after it. A rung with no
//     first layer of its own (joined pairs) tumbles straight after the cross.
//
// The whole-cube Solution keeps the scan's hold: "just restore it" has no layers to be held for.
//
// THREE FRAMES, and confusing any two of them is the class of bug this file exists to end:
//
//   the SCAN frame    the app's canonical facelets — white on U, green on F. Everything that is
//                     STATE lives here: the subject, a walk's steps, the smart cube's corrected
//                     stream, what `follow` compares against.
//   the METHOD frame  the scan frame tumbled so WHITE is on D. The method solver and the stage
//                     engine both put the cross on D and are not changed at all; fed this frame,
//                     the cross they build is the white one.
//   a HOLD            how the child is holding the cube right now. A DISPLAY fact: which way the
//                     renderer turns the cube, and what each move chip is called.
//
// Before this file the stages were measured in the scan frame, so "the cross" was the YELLOW cross,
// and `camera-up` drew it from below while every move stayed named for white up — a chip read U
// while the face turning on screen was the one at the bottom.
//
// Pure: no DOM, no renderer, no solver. `test/solving-hold.test.mjs` holds every renaming to the
// identity that defines it, over every one of the 24 holds.

import { applyIdentity, heldFace, heldToken, relabelSelectors, run } from './cube-moves.js';
import { readToken } from './cube-notation.js';
import { ORIENTATIONS, orientationPerm, orientationRelabel, turnFacelets } from './cube-orientation.js';
import { SOLVED, movesOf } from './cube-pieces.js';
import { t } from './i18n.js';

/** A hold is `[up, front]`: which SCAN-frame face points up, and which faces the child. */
const hold = (up, front) => Object.freeze([up, front]);

/** The scan's hold: white up, green facing you. */
export const SCAN_HOLD = hold('U', 'F');

/** Tumbled forward from the scan's hold: white underneath, green at the back — on a Western cube,
 *  yellow up and blue facing you. The course's `X2`. */
export const TUMBLED = hold('D', 'B');

/**
 * The frame the method and the stage engine are fed: the cube tumbled so white is on D.
 *
 * The same pair as `TUMBLED`, and that is not a coincidence to be relied on silently — it is WHY a
 * stage answer computed here needs no renaming to be shown in the tumbled hold. Named twice because
 * the two are different questions: one is where the engine's cross is, the other is how a child
 * holds the cube, and a future hold must be able to change without moving the engine.
 */
export const METHOD_FRAME = TUMBLED;

/** `"D B"` — the spelling `<cubus-cube>` takes for an orientation. */
export const holdSpec = ([up, front]) => `${up} ${front}`;

export const sameHold = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * The hold that undoes `h`: turning by one and then the other leaves every sticker where it was.
 *
 * Found by composing the permutations rather than written down. Tumbling is its own undo, and a
 * table that said so would be right for exactly the one hold this app uses today and silently wrong
 * for the next one somebody adds.
 */
export function undoHold([up, front]) {
  const there = orientationPerm(up, front);
  for (const [u, f] of ORIENTATIONS) {
    const back = orientationPerm(u, f);
    // `turned[i] = original[perm[i]]`, so there-then-back reads `original[there[back[i]]]`.
    if (back.every((_, i) => there[back[i]] === i)) return hold(u, f);
  }
  throw new Error(`solving-hold: "${up} ${front}" has no undo, which a rotation always has`);
}

/** The hold that takes a method-frame cube, move or piece name back to the scan frame. */
export const METHOD_TO_SCAN = undoHold(METHOD_FRAME);

/** Scan-frame facelets as the method sees them: white on D. */
export const toMethodFrame = (facelets) => turnFacelets(facelets, ...METHOD_FRAME);

/** Method-frame facelets back in the scan frame. */
export const fromMethodFrame = (facelets) => turnFacelets(facelets, ...METHOD_TO_SCAN);

/**
 * `alg`, named for a cube turned to `h`: the same physical turns, each named by where its face now
 * sits — and a regrip, a wide move or a slice by the axis it now turns about.
 *
 * The identity that defines it, and the test's first case: turning a cube and then making the
 * renamed moves lands on exactly the cube that making the original moves and then turning would.
 * A turn keeps its direction because a rotation is not a reflection — clockwise seen from outside a
 * face is clockwise from outside it wherever that face has gone.
 *
 * Every move, since a method step may regrip (plan item 6.1). This used to refuse anything but a face
 * turn, because a rotation cannot be renamed by its letter alone and renaming its first letter would
 * have handed a child a move that is not the one on screen; the interpreter renames it by its axis
 * (`heldToken`), held to an oracle over every hold in `test/cube-moves.test.mjs`. Still LOUD on a
 * token that is not a move at all.
 *
 * The renaming itself is the interpreter's (`lib/cube-moves.js`), the other direction of the same rule
 * it reads a child's letters by — one relabelling, not two (ADR 0004 decision 5).
 */
export function renameAlg(alg, hold) {
  return movesOf(alg).map((move) => heldToken(move, hold)).join(' ');
}

/** One move for SHOWING, where a live report may carry a spelling nobody can read: unrenamed then,
 *  because a line of prose is not the place to throw. Never used for anything that is replayed. */
export function showMove(move, h) {
  return readToken(String(move)).move ? renameAlg(move, h) : String(move);
}

/**
 * A `<cubus-cube>` highlight or focus spec, named for a cube turned to `h`.
 *
 * `piece:DF` in the method frame is the white-blue edge, which the scan frame calls `UB`. Letter by
 * letter is enough: `cube-highlight.js` matches a piece by its SORTED letters, so the order a
 * renaming leaves them in does not matter. The bare kinds (`centers`, `edges`, `corners`) are the
 * same set in every frame and pass through.
 *
 * THE SAME REWRITING as its inverse, `convertSelectors` — both call `relabelSelectors` in
 * lib/cube-moves.js, which is where a sticker's `/F` suffix is relabelled too. This kept its own copy
 * until a Codex audit of 2026-09-16 found the two had drifted: `slot:DF/D` came back as `slot:UB/D`,
 * naming a sticker the piece does not carry.
 */
export function renameSelectors(spec, hold) {
  return relabelSelectors(spec, (c) => heldFace(c, hold));
}

/**
 * WHERE THE CUBE IS TURNED OVER — declared once, here. These stages are built white up; every stage
 * after them, tumbled.
 *
 * Both vocabularies below — the stage targets' ids and the method solver's stage names — call these
 * two stages by these two words, so both tables are DERIVED from this list rather than each stating
 * the flip point again. The lesson's sentences for these stages are written for the white-up hold
 * (`method-lesson.js`), and `solving-hold.test.mjs` holds its list of those sentences to this one.
 */
export const WHITE_UP_STAGES = Object.freeze(['cross', 'first-layer']);

/**
 * A hold for every name in `names`: white up for the white-up stages and for any name in
 * `alsoAsScanned`, tumbled for the rest.
 *
 * Every name a caller may ask about must be listed, so an unlisted one throws at lookup rather than
 * defaulting. Every white-up stage must be among them — a table that does not name one is not
 * describing the same method. And every name in `alsoAsScanned` must be one of them, or a misspelling
 * there is silently held turned over. Both throw here, when the module loads. Exported for its test.
 */
export function holdTable(names, alsoAsScanned = []) {
  for (const stage of WHITE_UP_STAGES) {
    if (!names.includes(stage)) throw new Error(`solving-hold: a hold table does not name the white-up stage "${stage}"`);
  }
  for (const name of alsoAsScanned) {
    if (!names.includes(name)) throw new Error(`solving-hold: "${name}" is listed to keep the scan's hold, but it is not a name this table holds`);
  }
  return Object.freeze(Object.fromEntries(names.map((name) => [
    name,
    WHITE_UP_STAGES.includes(name) || alsoAsScanned.includes(name) ? SCAN_HOLD : TUMBLED,
  ])));
}

/**
 * How each stage target is held. EVERY target has an entry, and the test holds the list to `TARGETS`.
 *
 * A target sends the child BACK to a stage, so it is held the way that stage was built: a child sent
 * back to the first layer is holding white up, as the course's practice card for it does.
 */
const TARGET_HOLD = holdTable(
  ['cross', 'first-layer', 'two-layers', 'top-cross', 'corners-home', 'six-cross', 'solved'],
  // A pattern rather than a stage, and not offered — symmetric, so the scan's hold says no less —
  // and the whole cube, which keeps the scan's hold.
  ['six-cross', 'solved'],
);

/** The hold for a stage target, or the scan's hold for the whole cube (`null`). Loud on an unknown id. */
export function holdForTarget(id) {
  if (id === null || id === undefined) return SCAN_HOLD;
  if (!Object.hasOwn(TARGET_HOLD, id)) throw new Error(`solving-hold: no hold for target "${id}"`);
  return TARGET_HOLD[id];
}

/** The target ids this file knows a hold for — for the test that holds it to `TARGETS`. */
export const HELD_TARGETS = Object.freeze(Object.keys(TARGET_HOLD));

/**
 * How each of the method solver's fine-grained stages is held.
 *
 * `f2l` places each corner WITH its middle edge, so it has no moment at which the first layer alone
 * is complete: it tumbles straight after the cross, and each pair goes in from the top, which is how
 * every F2L algorithm is written. A stage the solver emits with no entry here throws rather than
 * defaulting, because a default would decide which way up a child holds the cube for a stage nobody
 * thought about.
 */
const STAGE_HOLD = holdTable(
  ['cross', 'first-layer', 'middle-layer', 'f2l', 'top-cross', 'top-face', 'top-corners', 'top-edges'],
);

export function holdForStage(stage) {
  if (typeof stage !== 'string' || !Object.hasOwn(STAGE_HOLD, stage)) {
    throw new Error(`solving-hold: no hold for lesson stage "${stage}"`);
  }
  return STAGE_HOLD[stage];
}

/** The hold the method solver begins in and writes every stage for: its own frame, upright. */
const METHOD_UPRIGHT = hold('U', 'F');

/**
 * A method's steps as the walk a screen shows: every move in the SCAN frame, and how the child is
 * holding the cube when they make it.
 *
 * `steps` are `solveByMethod`'s — each in the child's letters for the method-frame hold it records,
 * and free to regrip. Returns, all frozen:
 *
 *   `moves`       every move as a scan-frame token, a regrip included: the renderer's `alg`, which
 *                 turns the drawing with the child;
 *   `algs`        the same moves, one string per step;
 *   `holds`       the hold, in scan-frame letters, when `k` moves have been made — one more than there
 *                 are moves, so the hold after the last one is there too. What a chip is named for;
 *   `stepHolds`   the hold each step begins in.
 *
 * The hold is the STAGE's where the stage's hold changes — the tumble, which the screen tells the child
 * to make in a sentence — and from there it turns with every regrip. Those two agree only when the
 * method is holding the cube upright where the hold changes, so anything else THROWS: a regrip carried
 * across the tumble would name every later chip for a cube the child has just been told to hold another
 * way. Nothing produces that today; this is where it would surface.
 */
export function scanFrameWalk(steps) {
  const moves = [];
  const algs = [];
  const holds = [];
  const stepHolds = [];
  let stageHold = null;
  let shown = SCAN_HOLD;
  for (const step of steps) {
    const held = holdForStage(step.stage);
    if (!stageHold || !sameHold(held, stageHold)) {
      if (!Array.isArray(step.hold) || !sameHold(step.hold, METHOD_UPRIGHT)) {
        throw new Error(`solving-hold: the ${step.stage} stage begins a new hold while the method holds the cube "${step.hold}", not upright`);
      }
      stageHold = held;
      shown = held;
    }
    stepHolds.push(shown);
    const tokens = run(step.alg, step.hold, SOLVED).drawn.map((token) => heldToken(token, METHOD_TO_SCAN));
    for (const token of tokens) {
      holds.push(shown);
      moves.push(token);
      const after = applyIdentity(readToken(token).move, shown, SOLVED).hold;
      shown = sameHold(after, shown) ? shown : hold(after[0], after[1]);
    }
    algs.push(tokens.join(' '));
  }
  holds.push(shown);
  return Object.freeze({
    moves: Object.freeze(moves), algs: Object.freeze(algs), holds: Object.freeze(holds), stepHolds: Object.freeze(stepHolds),
  });
}

/** Where a SCAN-frame face ends up under hold `h`: `U` is on top, `F` facing you, and so on. */
function whereFaceGoes(face, [up, front]) {
  return orientationRelabel(up, front)[face];
}

const POSITION_WORD = Object.freeze({
  U: () => t('on top'),
  D: () => t('underneath'),
  F: () => t('facing you'),
  B: () => t('at the back'),
  R: () => t('on the right'),
  L: () => t('on the left'),
});

/**
 * The one sentence that tells a child how to hold the cube.
 *
 * NAMED BY WHITE, GREEN AND POSITION — never by the colour that ends up on top. That is decision 2
 * of the lesson course's ADR 0002 (cubus-im, docs/adr/), which rests on this app's ADR 0001: white
 * and green sit in the same places on a Western and a Japanese cube, so "white underneath, green at
 * the back" is true of both, while "yellow on top" is true only of a Western cube — a Japanese cube
 * tumbled has BLUE on top. Naming the colour from the scheme the app has drawn would be right only
 * while the app's belief about the cube is, and that belief is a default until a scan proves it.
 */
export function holdSentence(h) {
  return t('Hold it with white %1 and green %2.',
    POSITION_WORD[whereFaceGoes('U', h)](), POSITION_WORD[whereFaceGoes('F', h)]());
}
