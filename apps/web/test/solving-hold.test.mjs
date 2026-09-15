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
import { faceTurnsAlg, run } from '../lib/cube-moves.js';
import { SOLVED as SOLVED_PIECES, fromCube } from '../lib/cube-pieces.js';
import { whyText } from '../lib/method-lesson.js';
import { methodFor, solveByMethod } from '../lib/method-solver.js';
import { allRungCombinations } from '../lib/methods/index.js';
import {
  HELD_TARGETS,
  METHOD_FRAME,
  METHOD_TO_SCAN,
  SCAN_HOLD,
  TUMBLED,
  WHITE_UP_STAGES,
  fromMethodFrame,
  holdTable,
  holdForStage,
  holdForTarget,
  holdSentence,
  renameAlg,
  renameSelectors,
  scanFrameWalk,
  showMove,
  toMethodFrame,
  undoHold,
} from '../lib/solving-hold.js';
import { COLOUR_NAMES, SCHEMES, colourOf } from '../lib/scheme.js';
import { TARGETS, targetById } from '../lib/stage-targets.js';
import Cube from '../vendor/cubejs.js';
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';
import { turnsOf } from './fixtures/method-replay.mjs';

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

  // THE FLIP POINT IS DECLARED ONCE. The two vocabularies share three names, and each is one stage:
  // held the same way whichever table is asked. It used to be stated in both tables by hand, where
  // moving it in one and not the other would have passed every other case in this file.
  assert.deepEqual([...WHITE_UP_STAGES], ['cross', 'first-layer']);
  for (const name of ['cross', 'first-layer', 'top-cross']) {
    assert.deepEqual([...holdForTarget(name)], [...holdForStage(name)], `"${name}" is held the same in both vocabularies`);
  }

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
      const crossMoves = steps.filter((s) => s.stage === 'cross').map(turnsOf).join(' ');
      const after = apply(facelets, renameAlg(crossMoves, METHOD_TO_SCAN));
      for (const [at, face] of [[1, 'U'], [3, 'U'], [5, 'U'], [7, 'U'], [10, 'R'], [19, 'F'], [37, 'L'], [46, 'B']]) {
        assert.equal(after[at], face, `rungs ${JSON.stringify(rungs)}, seed ${seed}: sticker ${at} after the cross`);
      }
      // AND ITS FIRST LAYER, where the rung builds one on its own, is the white layer finished on
      // top before the cube is turned over: the whole U face and the top row of every side.
      if (steps.some((s) => s.stage === 'first-layer')) {
        const layerMoves = steps.filter((s) => WHITE_UP_STAGES.has(s.stage)).map(turnsOf).join(' ');
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

test('every move can be renamed for a hold — a regrip or a slice by its axis — and a live line never throws', () => {
  // A method step may regrip (plan item 6.1), so what is renamed is any move the interpreter reads, and
  // the identity that defines the renaming is the interpreter's: the renamed move, read in the hold, is
  // the move that was renamed. (That the interpreter reads a hold right is test/cube-moves.test.mjs's,
  // against an oracle.)
  for (const hold of ORIENTATIONS) {
    for (const move of ['R', "U'", 'F2', 'x', "y'", 'z2', 'Rw', "u'", 'M', 'E2', "S'"]) {
      assert.deepEqual([...run(renameAlg(move, hold), hold, SOLVED_PIECES).drawn], [...run(move, ['U', 'F'], SOLVED_PIECES).drawn],
        `${move} renamed for ${hold.join(' ')}`);
    }
  }
  assert.throws(() => renameAlg('R Q', TUMBLED), /"Q" is not a move/);
  assert.equal(renameAlg('', TUMBLED), '');
  assert.equal(showMove("U'", TUMBLED), "D'");
  assert.equal(showMove('y', TUMBLED), "y'", 'tumbled, the axis a regrip turns about points the other way');
  assert.equal(showMove('?!', TUMBLED), '?!', 'a spelling nobody reads is shown as it came');
});

test('the lesson\'s cross and first-layer sentences describe a white-up hold, and the middle layer a tumbled one', () => {
  // The words and the hold are two files, and nothing else holds them together. Held white up, the
  // method's U layer — where it lifts a cross edge to — is the BOTTOM of the cube in the child's
  // hands, so the old sentences ("up to the top", "on the bottom") described a different hold.
  assert.deepEqual([...holdForStage('cross')], [...SCAN_HOLD]);
  // The sentences checked below, per white-up stage. Held to the one declaration of the flip point,
  // so moving it cannot leave a stage's words describing the other hold without this going red.
  const WHITE_UP_SENTENCES = { cross: ['cross.lift', 'cross.insert', 'cross.whole'], 'first-layer': ['firstLayer.lift', 'firstLayer.insert'] };
  assert.deepEqual(Object.keys(WHITE_UP_SENTENCES), [...WHITE_UP_STAGES],
    'every white-up stage has its sentences checked for the white-up hold, and no other stage does');
  const say = (why, stage, kind = 'goal') => whyText({ kind, stage, why });
  assert.match(say({ key: 'cross.lift', edge: 0 }, 'cross'), /down to the bottom/);
  assert.match(say({ key: 'cross.insert', edge: 0 }, 'cross'), /under its home/);
  assert.match(say({ key: 'cross.whole', moves: 5 }, 'cross'), /cross on top/);
  assert.match(say({ key: 'cross.whole', moves: 1 }, 'cross'), /cross on top/);
  // The first layer is held the same way, so its corners come up from the bottom too.
  assert.deepEqual([...holdForStage('first-layer')], [...SCAN_HOLD]);
  assert.match(say({ key: 'firstLayer.lift', corner: 0 }, 'first-layer'), /down to the bottom/);
  assert.match(say({ key: 'firstLayer.insert', corner: 0 }, 'first-layer'), /up into its slot above/);
  // And the first stage after the tumble still reads the way it always did, because the tumbled
  // hold IS the frame the method describes itself in.
  assert.deepEqual([...holdForStage('middle-layer')], [...TUMBLED]);
  assert.match(say({ key: 'middleLayer.insert', edge: 0 }, 'middle-layer'), /down into the middle layer/);
});

test('a sentence that says where a piece goes follows the STAGE\'s hold, never the reason key', () => {
  // `firstLayer.*` is emitted by the layer-by-layer first layer AND by the joined-pairs rung's
  // fallback (`pairs.js`, stage `f2l`), which is held turned over. Keyed by reason alone, that
  // fallback told a child to take a corner "down" that was going up — found by the Codex audit of
  // 2026-09-13, and reached here through REAL solver steps, because a hand-built step is exactly the
  // thing that could leave the fallback out. Seed 1 reaches it on every rung above the bottom.
  const facelets = apply(SOLVED, scramble(1, 25));
  const seen = { up: 0, over: 0, f2l: 0 };
  for (const rungs of allRungCombinations()) {
    const { steps } = solveByMethod(cubie(toMethodFrame(facelets)), methodFor(rungs));
    for (const step of steps.filter((s) => /^(cross|firstLayer)\./.test(s.why.key))) {
      const text = whyText(step);
      const where = `rungs ${JSON.stringify(rungs)}, stage ${step.stage}, ${step.why.key}: "${text}"`;
      if (WHITE_UP_STAGES.includes(step.stage)) {
        seen.up += 1;
        assert.match(text, /down to the bottom|under its home|cross on top|up into its slot above/, where);
      } else {
        seen.over += 1;
        if (step.stage === 'f2l') seen.f2l += 1;
        assert.match(text, /up to the top|over its home|cross on the bottom|slot underneath/, where);
      }
    }
  }
  assert.ok(seen.up > 0 && seen.f2l > 0, `both holds must be reached by real steps, the F2L fallback included: ${JSON.stringify(seen)}`);
  // And a step that cannot say which hold it is in is refused, rather than given one of two opposite
  // instructions by default.
  assert.throws(() => whyText({ kind: 'goal', why: { key: 'firstLayer.lift', corner: 0 } }), /has no stage to say which/);
});

test('a hold table refuses a name it does not hold, in either list', () => {
  assert.throws(() => holdTable(['first-layer', 'solved']), /does not name the white-up stage "cross"/);
  assert.throws(() => holdTable(['cross', 'first-layer', 'solved'], ['sloved']),
    /"sloved" is listed to keep the scan's hold, but it is not a name this table holds/,
    'a misspelled exception must throw, not be held turned over');
  assert.equal(holdTable(['cross', 'first-layer', 'solved'], ['solved']).solved.join(' '), 'U F');
});

test('a lesson walk is the scan-frame moves, every chip named for the hold its move is made in — a regrip too', () => {
  // With face turns only — every rung today — the walk is exactly the renaming it replaced, and each move
  // is held the way its stage is.
  for (const [n, rungs] of allRungCombinations().entries()) {
    const scan = Cube.fromString(SOLVED);
    scan.move(randomAlg(lcg(n + 7), 25));
    const { steps, alg } = solveByMethod(cubie(toMethodFrame(scan.asString())), methodFor(rungs));
    const walk = scanFrameWalk(steps);
    const where = `rungs ${JSON.stringify(rungs)}`;
    assert.equal(faceTurnsAlg(walk.moves), renameAlg(alg, METHOD_TO_SCAN), `${where}: the walk turns the faces the method's alg does`);
    assert.equal(walk.holds.length, walk.moves.length + 1, 'one hold more than moves: the hold after the last');
    let k = 0;
    for (const step of steps) {
      const tokens = walk.algs[steps.indexOf(step)].split(' ').filter(Boolean);
      if (holdForStage(step.stage)[0] === 'U') {
        // White up, and no regrip there: every move held as scanned.
        tokens.forEach((_, j) => assert.deepEqual([...walk.holds[k + j]], [...SCAN_HOLD], `${where}: move ${k + j}`));
      } else {
        // Tumbled, the child's hands and the method's frame agree — through every regrip — so each chip is
        // the method's own letter.
        assert.deepEqual(tokens.map((m, j) => renameAlg(m, walk.holds[k + j])), step.alg.split(' '), `${where}: ${step.stage}`);
        tokens.forEach((_, j) => assert.equal(walk.holds[k + j][0], 'D', `${where}: white underneath at move ${k + j}`));
      }
      k += tokens.length;
    }
  }

  // A regrip in the middle layer. The chips after it are the letters the method wrote — the child's
  // hands and the method's frame agree once tumbled — and the drawing reaches the cube the steps do.
  const regripped = [
    { stage: 'cross', alg: 'D R', hold: ['U', 'F'] },
    { stage: 'middle-layer', alg: 'y', hold: ['U', 'F'] },
    { stage: 'middle-layer', alg: "U R U' R' U' F' U F", hold: ['U', 'R'] },
    { stage: 'top-cross', alg: "F R U R' U' F'", hold: ['U', 'R'] },
  ];
  const walk = scanFrameWalk(regripped);
  const chips = walk.moves.map((m, k) => renameAlg(m, walk.holds[k]));
  assert.deepEqual(chips, ['U', 'R', 'y', 'U', 'R', "U'", "R'", "U'", "F'", 'U', 'F', 'F', 'R', 'U', "R'", "U'", "F'"],
    'white up the cross is named for white up; tumbled, every chip is the method\'s own letter, before and after the regrip');
  assert.deepEqual([...walk.holds[2]], [...TUMBLED], 'the regrip is made in the tumbled hold');
  assert.equal(walk.holds[3][0], 'D', 'and leaves white underneath');
  assert.notDeepEqual([...walk.holds[3]], [...TUMBLED], 'but turned');
  assert.deepEqual([...walk.stepHolds[3]], [...walk.holds[3]], 'the regrip carries into the next stage');
  assert.equal(
    apply(SOLVED, faceTurnsAlg(walk.moves)),
    apply(SOLVED, renameAlg(regripped.map(turnsOf).join(' '), METHOD_TO_SCAN)),
    'the walk the renderer draws moves the pieces the steps do',
  );

  // A regrip carried across the tumble would name every later chip for a hold the child was just told to
  // leave: refused where the walk is built.
  assert.throws(() => scanFrameWalk([
    { stage: 'cross', alg: 'y', hold: ['U', 'F'] },
    { stage: 'middle-layer', alg: 'R', hold: ['U', 'R'] },
  ]), /begins a new hold/);
});
