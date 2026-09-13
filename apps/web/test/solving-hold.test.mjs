// The hold a cube is solved in, and the renamings that follow from it — lib/solving-hold.js.
//
// dev-docs/adr/0003-white-first-and-the-tumble.md. Every case here is a way the convention can be
// broken while each module it passes through stays green on its own:
//
//   * a move renamed with the relabelling the wrong way round. It still produces legal moves, it
//     still round-trips, and on a cube that is tumbled (its own undo) it is even right — so only
//     the identity over all 24 holds tells the two directions apart.
//   * the engine fed the scan frame. Its cross is then the YELLOW one, every distance is a real
//     distance to a real state, and nothing inside the engine can notice.
//   * a stage or a target with no hold, which a default would quietly decide for a child.
//   * the lesson's words describing one hold while the screen draws another.
//
// cubejs applies every move here. It is the repository's independent oracle, and it shares no code
// with `cube-orientation.js`, which is what makes the identity a check rather than a restatement.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ORIENTATIONS, orientationRelabel, turnFacelets } from '../lib/cube-orientation.js';
import { fromCube } from '../lib/cube-pieces.js';
import { whyText } from '../lib/method-lesson.js';
import { methodFor, solveByMethod } from '../lib/method-solver.js';
import { allRungCombinations } from '../lib/methods/index.js';
import {
  HELD_TARGETS,
  METHOD_FRAME,
  METHOD_TO_SCAN,
  SCAN_HOLD,
  TUMBLED,
  fromMethodFrame,
  holdForStage,
  holdForTarget,
  holdSentence,
  renameAlg,
  renameSelectors,
  showMove,
  toMethodFrame,
  undoHold,
} from '../lib/solving-hold.js';
import { COLOUR_NAMES, SCHEMES, colourOf } from '../lib/scheme.js';
import { TARGETS, targetById } from '../lib/stage-targets.js';
import Cube from '../vendor/cubejs.js';
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const TURNS = ['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'", 'D', 'D2', "D'", 'L', 'L2', "L'", 'B', 'B2', "B'"];

/** A fixed scramble from a seed, drawn by the suite's ONE seeded generator — a copy of it here
 *  is what `seeded-scrambles.test.mjs` exists to refuse. Deterministic, so a failure names a cube
 *  that can be rebuilt from its seed. */
const scramble = (seed, length) => randomAlg(lcg(seed), length);

/** `alg` applied to `facelets`, by cubejs. */
function apply(facelets, alg) {
  const cube = Cube.fromString(facelets);
  if (String(alg).trim()) cube.move(alg);
  return cube.asString();
}

const STATES = [SOLVED, ...[1, 2, 3, 4, 5].map((seed) => apply(SOLVED, scramble(seed, 25)))];
const cubie = (facelets) => fromCube(Cube.fromString(facelets));

test('renaming a move for a hold is the same as turning the cube, for all 24 holds', () => {
  // THE DEFINITION. Turn a cube and make the renamed moves, or make the moves and turn it: the same
  // cube, sticker for sticker. The relabelling the wrong way round survives every other case in
  // this file on the one hold the app uses today, because tumbling is its own undo.
  const algs = [...TURNS, scramble(11, 12), scramble(12, 20)];
  for (const [up, front] of ORIENTATIONS) {
    for (const facelets of STATES) {
      for (const alg of algs) {
        assert.equal(
          apply(turnFacelets(facelets, up, front), renameAlg(alg, [up, front])),
          turnFacelets(apply(facelets, alg), up, front),
          `hold "${up} ${front}", alg "${alg}"`,
        );
      }
    }
  }
  // And the hold the app uses, in words a person can check against a cube in their hands: tumbled
  // forward, the white face is at the bottom, the blue face in front, and R is still R.
  assert.equal(renameAlg("U R F' B2 D L", TUMBLED), "D R B' F2 U L");
});

test('every hold has an undo, and undoing it puts every sticker back', () => {
  for (const [up, front] of ORIENTATIONS) {
    const back = undoHold([up, front]);
    for (const facelets of STATES) {
      assert.equal(turnFacelets(turnFacelets(facelets, up, front), ...back), facelets, `hold "${up} ${front}"`);
    }
  }
  // Tumbling is its own undo. Asserted rather than assumed — the code finds the undo, never types it.
  assert.deepEqual([...undoHold(TUMBLED)], [...TUMBLED]);
  for (const facelets of STATES) assert.equal(fromMethodFrame(toMethodFrame(facelets)), facelets);
});

test('fed the method frame, "the cross" is the WHITE cross', () => {
  const cross = targetById('cross');
  // SOLVED·D keeps the white cross and scatters the yellow one; SOLVED·U does the opposite. The
  // scan frame is how the engine used to be fed, and it answered both of these backwards.
  const whiteKept = apply(SOLVED, 'D');
  const whiteBroken = apply(SOLVED, 'U');
  assert.equal(cross.verify(cubie(toMethodFrame(whiteKept))), true, 'a turned bottom leaves the white cross alone');
  assert.equal(cross.verify(cubie(toMethodFrame(whiteBroken))), false, 'a turned top breaks it');
  assert.equal(cross.verify(cubie(whiteKept)), false, 'in the scan frame the cross on D is the YELLOW one — the old answer');
  assert.equal(cross.verify(cubie(whiteBroken)), true, '…which called a broken white cross done');
});

test('fed the method frame, "the two bottom layers" are the white layer and the middle', () => {
  // A last-layer algorithm keeps the first two layers by construction. Written in the METHOD frame,
  // where the last layer is on U, and renamed into the scan frame to be made on a scan-frame cube.
  const sune = "R U R' U R U2 R'";
  const facelets = apply(SOLVED, renameAlg(sune, METHOD_TO_SCAN));
  assert.equal(facelets.slice(0, 9), 'UUUUUUUUU', 'the scan frame\'s U face — white — is untouched');
  assert.notEqual(facelets, SOLVED, 'and the cube is not solved, so the target is doing work');
  assert.equal(targetById('two-layers').verify(cubie(toMethodFrame(facelets))), true);
  assert.equal(targetById('two-layers').verify(cubie(apply(SOLVED, sune))) , true,
    'the same algorithm in the scan frame keeps the YELLOW layers — which is why a fixture built that way is a different cube');
  assert.equal(targetById('two-layers').verify(cubie(toMethodFrame(apply(SOLVED, sune)))), false,
    'and that cube is not at the white two layers');
});

test('the stages are held the way the owner decided, and every target has a hold', () => {
  // Cross and first layer white up; turned over once the first layer is complete — the course's
  // ADR 0002 decisions 3 and 4, and its practice cards' `up` / `over` grips, stage for stage.
  assert.deepEqual([...holdForTarget('cross')], [...SCAN_HOLD], 'the cross is built white up');
  assert.deepEqual([...holdForTarget('first-layer')], [...SCAN_HOLD], 'and so is the first layer');
  for (const id of ['two-layers', 'top-cross', 'corners-home']) {
    assert.deepEqual([...holdForTarget(id)], [...TUMBLED], `${id} is built tumbled`);
  }
  assert.deepEqual([...holdForTarget('solved')], [...SCAN_HOLD], 'the whole cube keeps the scan\'s hold');
  assert.deepEqual([...holdForTarget(null)], [...SCAN_HOLD], 'and so does no target at all');
  assert.deepEqual([...HELD_TARGETS].sort(), TARGETS.map((target) => target.id).sort(),
    'a target added without a hold would be held however a default happened to say');
  assert.throws(() => holdForTarget('nope'), /no hold for target "nope"/);

  // The engine is fed the tumbled hold, which is why a tumbled route needs no renaming to be shown.
  assert.deepEqual([...METHOD_FRAME], [...TUMBLED]);
});

test('the hold sentence names white, green and positions — true of a Western and a Japanese cube alike', () => {
  // Decision 2 of the course's ADR 0002, resting on this app's ADR 0001: only D and B differ between
  // the schemes, which are exactly the two faces a tumble brings round — so "yellow on top" is a
  // sentence about a Western cube. White and green are where they are on both.
  for (const scheme of SCHEMES) {
    assert.equal(COLOUR_NAMES[colourOf('U', scheme)], 'white', `${scheme}: white is the scan frame's U`);
    assert.equal(COLOUR_NAMES[colourOf('F', scheme)], 'green', `${scheme}: green is the scan frame's F`);
  }
  assert.equal(holdSentence(SCAN_HOLD), 'Hold it with white on top and green facing you.');
  assert.equal(holdSentence(TUMBLED), 'Hold it with white underneath and green at the back.');
  for (const [up, front] of ORIENTATIONS) {
    // The face a hold says is on top is the face the renderer puts on top…
    const relabel = orientationRelabel(up, front);
    assert.equal(relabel[up], 'U', `hold "${up} ${front}" must put ${up} on top`);
    assert.equal(relabel[front], 'F', `hold "${up} ${front}" must put ${front} in front`);
    // …and no hold's sentence names a colour that moves between the schemes, or one it need not.
    assert.doesNotMatch(holdSentence([up, front]), /yellow|blue|red|orange/, `hold "${up} ${front}"`);
  }
});

test('every stage the method emits has a hold, only the cross and first layer are white up, and both are white', () => {
  const WHITE_UP_STAGES = new Set(['cross', 'first-layer']);
  const seen = new Set();
  for (const rungs of allRungCombinations()) {
    const method = methodFor(rungs);
    for (const seed of [21, 22]) {
      const facelets = apply(SOLVED, scramble(seed, 25));
      const { steps } = solveByMethod(cubie(toMethodFrame(facelets)), method);
      for (const step of steps) {
        seen.add(step.stage);
        const held = holdForStage(step.stage);
        assert.deepEqual([...held], [...(WHITE_UP_STAGES.has(step.stage) ? SCAN_HOLD : TUMBLED)], `stage ${step.stage}`);
      }
      // THE LESSON'S CROSS, made on the cube in the scan frame, is the white cross on top: every U
      // edge home. Read off the facelets directly — U edges at 1/3/5/7, their side stickers at
      // R1 (10), F1 (19), L1 (37), B1 (46) — rather than through any predicate in this repository.
      const crossMoves = steps.filter((s) => s.stage === 'cross').map((s) => s.alg).join(' ');
      const after = apply(facelets, renameAlg(crossMoves, METHOD_TO_SCAN));
      for (const [at, face] of [[1, 'U'], [3, 'U'], [5, 'U'], [7, 'U'], [10, 'R'], [19, 'F'], [37, 'L'], [46, 'B']]) {
        assert.equal(after[at], face, `rungs ${JSON.stringify(rungs)}, seed ${seed}: sticker ${at} after the cross`);
      }
      // AND ITS FIRST LAYER, where the rung builds one on its own, is the white layer finished on
      // top before the cube is turned over: the whole U face and the top row of every side.
      if (steps.some((s) => s.stage === 'first-layer')) {
        const layerMoves = steps.filter((s) => WHITE_UP_STAGES.has(s.stage)).map((s) => s.alg).join(' ');
        const layer = apply(facelets, renameAlg(layerMoves, METHOD_TO_SCAN));
        assert.equal(layer.slice(0, 9), 'UUUUUUUUU', `rungs ${JSON.stringify(rungs)}, seed ${seed}: the white face`);
        for (const at of [9, 10, 11, 18, 19, 20, 36, 37, 38, 45, 46, 47]) {
          assert.equal(layer[at], 'URFDLB'[Math.floor(at / 9)], `rungs ${JSON.stringify(rungs)}, seed ${seed}: sticker ${at}`);
        }
      }
    }
  }
  assert.ok(seen.has('cross') && seen.has('first-layer') && seen.size > 3,
    `the sweep reached too few stages to mean anything: ${[...seen]}`);
  assert.throws(() => holdForStage('nope'), /no hold for lesson stage "nope"/);
});

test('a highlight names the same pieces in both frames', () => {
  // `piece:DF` in the method frame is the white-blue edge, which the scan frame calls UB.
  assert.equal(
    renameSelectors('centers,piece:DF,slot:URF,layer:D', METHOD_TO_SCAN),
    'centers,piece:UB,slot:DRB,layer:U',
  );
  for (const [up, front] of ORIENTATIONS) {
    const spec = 'centers,piece:DF,piece:URF,slot:BL,layer:R';
    assert.equal(renameSelectors(renameSelectors(spec, [up, front]), undoHold([up, front])), spec, `hold "${up} ${front}"`);
  }
});

test('only a face turn can be renamed, and a live line never throws for one that is not', () => {
  assert.throws(() => renameAlg('Rw', TUMBLED), /"Rw" is not a face turn/);
  assert.throws(() => renameAlg('x', TUMBLED), /"x" is not a face turn/);
  assert.equal(renameAlg('', TUMBLED), '');
  assert.equal(showMove("U'", TUMBLED), "D'");
  assert.equal(showMove('Rw', TUMBLED), 'Rw');
});

test('the lesson\'s cross and first-layer sentences describe a white-up hold, and the middle layer a tumbled one', () => {
  // The words and the hold are two files, and nothing else holds them together. Held white up, the
  // method's U layer — where it lifts a cross edge to — is the BOTTOM of the cube in the child's
  // hands, so the old sentences ("up to the top", "on the bottom") described a different hold.
  assert.deepEqual([...holdForStage('cross')], [...SCAN_HOLD]);
  const say = (why, kind = 'goal') => whyText({ kind, why });
  assert.match(say({ key: 'cross.lift', edge: 0 }), /down to the bottom/);
  assert.match(say({ key: 'cross.insert', edge: 0 }), /under its home/);
  assert.match(say({ key: 'cross.whole', moves: 5 }), /cross on top/);
  assert.match(say({ key: 'cross.whole', moves: 1 }), /cross on top/);
  // The first layer is held the same way, so its corners come up from the bottom too.
  assert.deepEqual([...holdForStage('first-layer')], [...SCAN_HOLD]);
  assert.match(say({ key: 'firstLayer.lift', corner: 0 }), /down to the bottom/);
  assert.match(say({ key: 'firstLayer.insert', corner: 0 }), /up into its slot above/);
  // And the first stage after the tumble still reads the way it always did, because the tumbled
  // hold IS the frame the method describes itself in.
  assert.deepEqual([...holdForStage('middle-layer')], [...TUMBLED]);
  assert.match(say({ key: 'middleLayer.insert', edge: 0 }), /down into the middle layer/);
});
