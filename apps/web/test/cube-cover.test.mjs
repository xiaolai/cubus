// The renderer's cover test (packages/cubus-cube/src/cover.js, ADR 0013 decision 3): a mark
// triangle covers a sticker's projected quad when the two overlap with positive area AND the mark is
// nearer somewhere in that overlap. A point is [x, y, iw]: CSS px and 1/w, larger iw being nearer.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { covers, overlaps } from '../../../packages/cubus-cube/src/cover.js';

// A sticker facing the camera squarely: the 10×10 square at depth iw = 1 everywhere.
const at = (iw) => [[0, 0, iw], [10, 0, iw], [10, 10, iw], [0, 10, iw]];
const QUAD = at(1);

test('a triangle overlapping the quad and nearer covers it', () => {
  assert.equal(covers(QUAD, [[2, 2, 2], [8, 2, 2], [5, 8, 2]]), true);
});

test('the same triangle farther does not cover it', () => {
  assert.equal(covers(QUAD, [[2, 2, 0.5], [8, 2, 0.5], [5, 8, 0.5]]), false);
});

test('a triangle at the same depth does not cover it: nearer is strict', () => {
  assert.equal(covers(QUAD, [[2, 2, 1], [8, 2, 1], [5, 8, 1]]), false);
});

test('a nearer triangle touching the quad only along an edge or at a corner does not cover it', () => {
  assert.equal(covers(QUAD, [[10, 0, 2], [20, 0, 2], [10, 10, 2]]), false, 'shares the right edge');
  assert.equal(covers(QUAD, [[10, 10, 2], [20, 10, 2], [20, 20, 2]]), false, 'meets one corner');
  assert.equal(covers(QUAD, [[12, 0, 2], [20, 0, 2], [12, 10, 2]]), false, 'apart');
});

// The triangle's depth runs iw = 0.9 + 0.02·x (or its mirror), crossing the sticker's plane at
// x = 5. Its own vertices and every overlap vertex on one side are farther; only the overlap's far
// side is nearer. A test that compares depth at a single vertex misses one of the two.
test('a triangle crossing the sticker plane covers it, whichever side is nearer', () => {
  const rising = (x) => 0.9 + 0.02 * x;
  const falling = (x) => 1.1 - 0.02 * x;
  for (const [name, iw] of [['nearer at +x', rising], ['nearer at -x', falling]]) {
    const tri = [[-20, -20], [-20, 30], [30, 5]].map(([x, y]) => [x, y, iw(x)]);
    assert.equal(covers(QUAD, tri), true, name);
    const mirrored = [[30, -20], [30, 30], [-20, 5]].map(([x, y]) => [x, y, iw(x)]);
    assert.equal(covers(QUAD, mirrored), true, `${name}, mirrored triangle`);
  }
});

test('a triangle nearer only OUTSIDE the overlap does not cover it', () => {
  // iw = 0.5 + 0.02·x: nearer than the quad only beyond x = 25, past the quad's right edge.
  const tri = [[-20, -20], [-20, 30], [40, 5]].map(([x, y]) => [x, y, 0.5 + 0.02 * x]);
  assert.equal(covers(QUAD, tri), false);
});

test('a tilted sticker plane is fitted, not taken as flat', () => {
  // The quad recedes to the right (iw 1.2 → 0.8); a flat triangle at iw 1 is nearer only at x > 5.
  const tilted = [[0, 0, 1.2], [10, 0, 0.8], [10, 10, 0.8], [0, 10, 1.2]];
  assert.equal(covers(tilted, [[6, 2, 1], [9, 2, 1], [8, 8, 1]]), true, 'over the receding half');
  assert.equal(covers(tilted, [[1, 2, 1], [4, 2, 1], [2, 8, 1]]), false, 'over the near half');
});

test('overlaps: positive area only, in either winding', () => {
  const rect = [[5, 5], [15, 5], [15, 15], [5, 15]];
  assert.equal(overlaps(QUAD, rect), true);
  assert.equal(overlaps(QUAD, [...rect].reverse()), true);
  assert.equal(overlaps(QUAD, [[10, 0], [20, 0], [20, 10], [10, 10]]), false, 'shares an edge');
  assert.equal(overlaps(QUAD, [[11, 0], [20, 0], [20, 10], [11, 10]]), false, 'apart');
});
