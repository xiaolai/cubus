// Notation is syntax: every spelling a tutorial writes becomes the layer-mask descriptor the renderer
// executes, and anything else is refused by name and place (plan item 1.1 of
// dev-docs/tutorial-capability-plan.md; ADR 0004 decision 4).
//
// Directions are checked by RELATION, not by a table typed twice: `x` must turn exactly as `R` does
// across all three layers (WCA 12a4), `M` as `L`, `E` as `D`, `S` as `F`, `r` as `R` plus the middle.
// The face turns are checked against the descriptors the renderer already draws with, so the new
// reader cannot disagree with the move tables the app has always used.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOVE_DESCRIPTORS } from '../../../packages/cubus-cube/src/pose.js';
import { formatMoves, parse, readToken } from '../lib/cube-notation.js';

const one = (token) => {
  const moves = parse(token);
  assert.equal(moves.length, 1, `${token} is one move`);
  return moves[0];
};
const shape = ({ axis, layers, angle, turns }) => ({ axis, layers: [...layers], angle, turns });

test('the 18 face turns read as exactly the descriptors the renderer draws with', () => {
  for (const [name, d] of Object.entries(MOVE_DESCRIPTORS)) {
    assert.deepEqual(shape(one(name)), shape(d), name);
    assert.equal(one(name).kind, 'face');
  }
});

test('rotations turn as WCA 12a4 says: x as R, y as U, z as F, across all three layers', () => {
  for (const [rot, face] of [['x', 'R'], ['y', 'U'], ['z', 'F']]) {
    for (const amount of ['', "'", '2', "2'"]) {
      const r = one(rot + amount);
      const f = one(face + amount);
      assert.equal(r.kind, 'rotation');
      assert.equal(r.axis, f.axis, `${rot}${amount} axis`);
      assert.equal(r.angle, f.angle, `${rot}${amount} turns the way ${face}${amount} does`);
      assert.deepEqual([...r.layers], [-1, 0, 1]);
    }
  }
});

test('slices turn as the face they follow, on the middle layer: M as L, E as D, S as F', () => {
  for (const [slice, face] of [['M', 'L'], ['E', 'D'], ['S', 'F']]) {
    for (const amount of ['', "'", '2']) {
      const s = one(slice + amount);
      const f = one(face + amount);
      assert.equal(s.kind, 'slice');
      assert.equal(s.axis, f.axis);
      assert.equal(s.angle, f.angle, `${slice}${amount} turns the way ${face}${amount} does`);
      assert.deepEqual([...s.layers], [0]);
    }
  }
});

test('a wide move is its face and the middle layer, in every spelling', () => {
  for (const face of 'URFDLB') {
    const lower = one(face.toLowerCase());
    const f = one(face);
    assert.equal(lower.kind, 'wide');
    assert.equal(lower.angle, f.angle, `${face.toLowerCase()} turns the way ${face} does`);
    assert.deepEqual([...lower.layers].sort(), [...f.layers, 0].sort());
    for (const spelling of [`${face}w`, `2${face}w`]) {
      assert.deepEqual(shape(one(spelling)), shape(lower), `${spelling} is ${face.toLowerCase()}`);
      assert.deepEqual(shape(one(`${spelling}'`)), shape(one(`${face.toLowerCase()}'`)));
    }
  }
});

test('amounts: a prime turns the other way, a 2 turns twice, a 2\' twice the other way', () => {
  const r = one('R');
  assert.equal(one("R'").angle, -r.angle);
  assert.equal(one('R2').angle, 2 * r.angle);
  assert.equal(one('R2').turns, 2);
  assert.equal(one("R2'").angle, -2 * r.angle);
  assert.equal(one("R2'").turns, 2);
});

test('a sequence reads in order, empty text is no moves, and the result cannot be edited', () => {
  const moves = parse("  R U'\n M2  x  ");
  assert.deepEqual(moves.map((m) => m.token), ['R', "U'", 'M2', 'x']);
  assert.deepEqual(parse(''), []);
  assert.deepEqual(parse(undefined), []);
  assert.ok(Object.isFrozen(moves) && Object.isFrozen(moves[0]) && Object.isFrozen(moves[0].layers));
  assert.equal(formatMoves(parse("r U R' U' r' F R F'")), "r U R' U' r' F R F'");
  assert.equal(formatMoves(parse("2Rw Rw'")), "Rw Rw'");
});

test('anything else is refused whole, naming the token, its place and its offset', () => {
  assert.throws(() => parse('R Q U'), /"Q" at move 2 \(character 2\)/);
  assert.throws(() => parse("R U R' U' x3"), /"x3" at move 5 \(character 10\)/);
  for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'RU', 'R3', "R''", 'W', 'Mw', 'xw', '2R', '3Rw', '1Rw', 'Rw2w']) {
    assert.throws(() => parse(bad), /notation: /, `"${bad}" was read as a move`);
    assert.equal(readToken(bad).move, undefined, `readToken accepted "${bad}"`);
  }
  assert.match(readToken('3Rw').why, /write the rotation instead/);
});
