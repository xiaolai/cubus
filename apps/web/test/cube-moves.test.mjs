// The interpreter's three rules, each held to something that shares no code with it (plan item 1.2 of
// dev-docs/tutorial-capability-plan.md; ADR 0004 decision 5).
//
//   face letters   the inverse of `renameAlg`, over all 24 holds × 18 moves. Since plan item 1.3 the two
//                  share `heldFace`, so this checks the two directions agree, not that either is right;
//                  what makes the relabelling right is `solving-hold.test.mjs`, which holds `renameAlg`
//                  to cubejs through `turnFacelets`, and the oracle cases below;
//   rotations      `test/cube-oracle.mjs`, a sticker model checked against cubejs, over all 24 holds
//                  × x y z × every amount;
//   wide / slice   the same oracle, over every hold × every mask × every amount, from a scrambled cube,
//                  and as long mixed sequences over random holds.
//
// The expected pieces are the oracle's facelets read into the piece model through cubejs, so nothing
// the interpreter computes is compared with itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import Cube from '../vendor/cubejs.js';
import { SOLVED, applyAlg, fromCube } from '../lib/cube-pieces.js';
import {
  applyIdentity, convertSelectors, faceTurnsAlg, heldFace, heldToken, identityFace, run, tokenOf, toIdentity,
} from '../lib/cube-moves.js';
import { parse } from '../lib/cube-notation.js';
import { FACE_NORMAL } from '../lib/cube-layout.js';
import { ORIENTATIONS } from '../lib/cube-orientation.js';
import { METHOD_TO_SCAN, renameAlg, renameSelectors } from '../lib/solving-hold.js';
import { SOLVED_FACELETS, applyToken, held, holdOf, play } from './cube-oracle.mjs';

const stateOf = (facelets) => fromCube(Cube.fromString(facelets));
const holdText = (h) => h.join(' ');
const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const AMOUNTS = ['', "'", '2', "2'"];
const SCRAMBLE = "R U2 F' L D B2 R' U F2 D' L2 B";
const SCRAMBLED = applyAlg(SOLVED, SCRAMBLE);
const SCRAMBLED_FACELETS = (() => { const c = new Cube(); c.move(SCRAMBLE); return c.asString(); })();

function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}

test('precondition: the scrambled cube is the same cube in both models', () => {
  assert.deepEqual(stateOf(SCRAMBLED_FACELETS), SCRAMBLED);
});

test('a face letter the child reads is the inverse of the display\'s renaming, over 24 holds × 18 moves', () => {
  for (const hold of ORIENTATIONS) {
    for (const face of FACES) {
      for (const amount of ['', "'", '2']) {
        const held = `${face}${amount}`;
        const out = run(held, hold, SCRAMBLED);
        assert.equal(out.drawn.length, 1);
        assert.equal(renameAlg(out.drawn[0], hold), held, `${held} held ${holdText(hold)} drew ${out.drawn[0]}`);
        assert.deepEqual(out.state, applyAlg(SCRAMBLED, out.drawn[0]), `${held} held ${holdText(hold)}: pieces`);
        assert.deepEqual([...out.hold], [...hold], 'a face turn does not change the hold');
      }
    }
  }
});

test('a whole-cube turn rotates about the world axis: every hold × x y z × every amount, against the oracle', () => {
  for (const hold of ORIENTATIONS) {
    for (const rot of ['x', 'y', 'z']) {
      for (const amount of AMOUNTS) {
        const token = rot + amount;
        const out = run(token, hold, SCRAMBLED);
        const expected = holdOf(applyToken(held(SOLVED_FACELETS, holdText(hold)), token));
        assert.equal(holdText(out.hold), expected, `${token} held ${holdText(hold)}`);
        assert.deepEqual(out.state, SCRAMBLED, `${token} moved pieces`);
      }
    }
  }
});

test('wide moves and slices: every hold × every mask × every amount, pieces and hold against the oracle', () => {
  const masks = ['M', 'E', 'S', 'r', 'l', 'u', 'd', 'f', 'b', 'Rw', 'Lw', 'Uw', 'Dw', 'Fw', 'Bw'];
  for (const hold of ORIENTATIONS) {
    for (const mask of masks) {
      for (const amount of AMOUNTS) {
        const token = mask + amount;
        const out = run(token, hold, SCRAMBLED);
        const oracle = play(SCRAMBLED_FACELETS, holdText(hold), token);
        assert.equal(holdText(out.hold), oracle.end.hold, `${token} held ${holdText(hold)}: hold`);
        assert.deepEqual(out.state, stateOf(oracle.end.identity), `${token} held ${holdText(hold)}: pieces`);
      }
    }
  }
});

test('long mixed sequences over random holds: every position\'s hold and the end\'s pieces, against the oracle', () => {
  const tokens = ['U', 'R', 'F', 'D', 'L', 'B', 'M', 'E', 'S', 'r', 'u', 'f', 'l', 'd', 'b', 'x', 'y', 'z']
    .flatMap((t) => AMOUNTS.map((a) => t + a));
  const next = rng(0x1d2e3f);
  for (let run_ = 0; run_ < 60; run_++) {
    const hold = ORIENTATIONS[Math.floor(next() * 24)];
    const seq = Array.from({ length: 25 }, () => tokens[Math.floor(next() * tokens.length)]);
    const oracle = play(SCRAMBLED_FACELETS, holdText(hold), seq.join(' '));
    for (let k = 1; k <= seq.length; k += 6) {
      assert.equal(holdText(run(seq.slice(0, k).join(' '), hold, SCRAMBLED).hold), oracle.holds[k], `${seq.slice(0, k).join(' ')} held ${holdText(hold)}`);
    }
    const out = run(seq.join(' '), hold, SCRAMBLED);
    assert.deepEqual(out.state, stateOf(oracle.end.identity), `${seq.join(' ')} held ${holdText(hold)}`);
  }
});

test('face turns at the reference hold are exactly the move tables', () => {
  const alg = "R U R' U' F2 D L' B2 U2 R2 D' F";
  const out = run(alg, ['U', 'F'], SOLVED);
  assert.deepEqual(out.state, applyAlg(SOLVED, alg));
  assert.equal(out.drawn.join(' '), alg);
});

test('M is R L\' to the pieces and leaves B up, U in front; Rw is L and leaves F up, D in front', () => {
  const m = run('M', ['U', 'F'], SOLVED);
  assert.deepEqual(m.state, applyAlg(SOLVED, "R L'"));
  assert.deepEqual([...m.hold], ['B', 'U']);
  const rw = run('Rw', ['U', 'F'], SOLVED);
  assert.deepEqual(rw.state, applyAlg(SOLVED, 'L'));
  assert.deepEqual([...rw.hold], ['F', 'D']);
});

test('what is drawn replays: the identity tokens, applied in the identity frame, reach the same cube', () => {
  const out = run("y U R U' R' U' F' U F M' x2 r", ['D', 'B'], SCRAMBLED);
  let now = { state: SCRAMBLED, hold: ['D', 'B'] };
  for (const token of out.drawn) now = applyIdentity(parse(token)[0], now.hold, now.state);
  assert.deepEqual(now.state, out.state);
  assert.deepEqual(now.hold, [...out.hold]);
  // …and each drawn token names the identity move it came from.
  for (const token of out.drawn) assert.equal(tokenOf(parse(token)[0]), token);
});

test('toIdentity refuses an axis that is not one, and a hold that is not one', () => {
  assert.throws(() => toIdentity({ axis: 'w', layers: [1], angle: 1, turns: 1 }, ['U', 'F']), /no axis/);
  assert.throws(() => run('R', ['U', 'D'], SOLVED), /perpendicular|one axis/);
  assert.throws(() => run('R', ['U'], SOLVED), /\[up, front\]/);
});

test('selectors: the child\'s letters read into identity letters are the inverse of the display\'s renaming', () => {
  // Sticker suffixes included: they are face letters too, and the two directions had drifted over them.
  const spec = 'centers,edges,piece:DF,piece:URF,slot:BL,slot:UR,layer:R,layer:D,slot:UF/U,piece:DF/F';
  for (const hold of ORIENTATIONS) {
    assert.equal(renameSelectors(convertSelectors(spec, hold), hold), spec, `held ${holdText(hold)}`);
    assert.equal(convertSelectors(renameSelectors(spec, hold), hold), spec, `held ${holdText(hold)}, other way`);
    for (const face of FACES) assert.equal(heldFace(identityFace(face, hold), hold), face);
  }
  // The method frame's white cross is the scan frame's UB, UR, UF, UL (ADR 0003's door, unchanged).
  assert.equal(renameSelectors('piece:DF,piece:DR,piece:DB,piece:DL', METHOD_TO_SCAN), 'piece:UB,piece:UR,piece:UF,piece:UL');
  // cubus-im lesson 12: gripped x2, turned y2 — the piece on the child's front-left is identity FR.
  const [kind, letters] = convertSelectors('piece:FL', ['D', 'F']).split(':');
  assert.equal(`${kind}:${[...letters].sort().join('')}`, 'piece:FR');
  assert.equal(convertSelectors('slot:UF', ['U', 'F']), 'slot:UF', 'the reference hold renames nothing');
  assert.throws(() => identityFace('Q', ['U', 'F']), /not a face/);
});

test('heldToken is the inverse of reading a child\'s move: every hold × every move the notation has', () => {
  // What a chip needs once a walk may regrip (plan item 6.1): the identity move, named the way the child
  // holding the cube reads it. Held to `run`, whose reading is held to the oracle above.
  const letters = ['U', 'R', 'F', 'D', 'L', 'B', 'M', 'E', 'S', 'u', 'r', 'f', 'd', 'l', 'b', 'x', 'y', 'z'];
  for (const hold of ORIENTATIONS) {
    for (const token of letters.flatMap((l) => ['', "'", '2'].map((a) => `${l}${a}`))) {
      const identity = run(token, ['U', 'F'], SOLVED).drawn[0];
      const named = heldToken(identity, hold);
      assert.equal(run(named, hold, SCRAMBLED).drawn[0], identity, `${identity} held ${holdText(hold)} was named ${named}`);
    }
  }
  assert.throws(() => heldToken('Q', ['U', 'F']), /"Q" is not a move/);
});

test('identity moves as face turns: a regrip is none, a wide move one face, a slice two — reaching the interpreter\'s cube', () => {
  assert.equal(faceTurnsAlg("y x2 z'"), '');
  assert.equal(faceTurnsAlg("y R M Rw2"), "R R L' L2");
  assert.equal(faceTurnsAlg(''), '');
  const random = rng(20260915);
  const tokens = ['U', 'R', 'F', 'D', 'L', 'B', 'M', 'E', 'S', 'Uw', 'Rw', 'Fw', 'x', 'y', 'z'];
  for (let i = 0; i < 60; i++) {
    const hold = ORIENTATIONS[Math.floor(random() * ORIENTATIONS.length)];
    const seq = Array.from({ length: 12 }, () => tokens[Math.floor(random() * tokens.length)] + AMOUNTS[Math.floor(random() * 3)]).join(' ');
    const played = run(seq, hold, SCRAMBLED);
    assert.deepEqual(applyAlg(SCRAMBLED, faceTurnsAlg(played.drawn)), played.state, `${seq} held ${holdText(hold)}`);
  }
});

// Found by a Codex audit, 2026-09-16. The convention "R = +x, U = +y, F = +z" was typed out in three
// production modules, each maintaining it independently. One table now, in the module that owns the
// cube's layout — and a sign the wrong way round in any consumer would be found by a drawing looking
// odd, not by a test, which is why this one asks directly.
test('one face-normal table, and every module that needs it reads that one', async () => {
  const modules = [
    '../lib/cube-orientation.js',
    '../lib/cube-moves.js',
    '../../../packages/cubus-cube/src/pose.js',
  ];
  for (const path of modules) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /FACE_NORMAL/, `${path} does not read the shared table`);
    assert.doesNotMatch(source, /R: \[1, 0, 0\], L: \[-1, 0, 0\]/, `${path} still types the table out`);
  }
  // And the table itself says what the whole app means by the fixed frame, frozen all the way down.
  assert.deepEqual(FACE_NORMAL.U, [0, 1, 0]);
  assert.deepEqual(FACE_NORMAL.R, [1, 0, 0]);
  assert.deepEqual(FACE_NORMAL.F, [0, 0, 1]);
  for (const face of 'URFDLB') assert.throws(() => { FACE_NORMAL[face][0] = 9; }, TypeError, `${face} was writable`);
});
