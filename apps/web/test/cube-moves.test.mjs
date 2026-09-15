// The interpreter's three rules, each held to something that shares no code with it (plan item 1.2 of
// dev-docs/tutorial-capability-plan.md; ADR 0004 decision 5).
//
//   face letters   the inverse of `renameAlg`, over all 24 holds × 18 moves — two independent
//                  derivations of one relabelling, one written for the display and one for the model;
//   rotations      `test/cube-oracle.mjs`, a sticker model checked against cubejs, over all 24 holds
//                  × x y z × every amount;
//   wide / slice   the same oracle, over every hold × every mask × every amount, from a scrambled cube,
//                  and as long mixed sequences over random holds.
//
// The expected pieces are the oracle's facelets read into the piece model through cubejs, so nothing
// the interpreter computes is compared with itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import Cube from '../vendor/cubejs.js';
import { SOLVED, applyAlg, fromCube } from '../lib/cube-pieces.js';
import { applyIdentity, run, tokenOf, toIdentity } from '../lib/cube-moves.js';
import { parse } from '../lib/cube-notation.js';
import { ORIENTATIONS } from '../lib/cube-orientation.js';
import { renameAlg } from '../lib/solving-hold.js';
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
