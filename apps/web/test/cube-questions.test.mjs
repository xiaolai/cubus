// Questions a tutorial asks of one cube (plan item 1.4 of dev-docs/tutorial-capability-plan.md;
// dev-docs/adr/0005-the-renderer-plays-scripts-methods-choose.md, decision 2).
//
// Three independent readings meet here. A piece state is read from its permutation; a picture is read
// from its stickers through `lib/cube-layout.js`; and the expected answers come from the sticker oracle
// in `test/cube-oracle.mjs`, which knows nothing of either — where a cubie sits and whether its
// stickers match their faces, from the published layout checked against cubejs.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Cube from '../vendor/cubejs.js';
import { SOLVED, applyAlg, fromCube } from '../lib/cube-pieces.js';
import { run } from '../lib/cube-moves.js';
import {
  edgesInLayerWithout, inLayerWithout, isHome, layerSlots, pairOf, pieceIn, piecesAway, readCube, whereIs,
} from '../lib/cube-questions.js';
import { targetPicture } from '../lib/stage-picture.js';
import { SOLVED_FACELETS, STICKERS, play } from './cube-oracle.mjs';

const CUBUS_IM = process.env.CUBUS_IM_REPO ?? fileURLToPath(new URL('../../../../cubus-im/', import.meta.url));
const NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const sorted = (s) => [...s].sort().join('');
const facelets = (alg) => { const c = new Cube(); c.move(alg); return c.asString(); };
const readCubeState = (identity) => fromCube(Cube.fromString(identity));

function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}
const TURNS = ['U', 'R', 'F', 'D', 'L', 'B'].flatMap((f) => [f, `${f}'`, `${f}2`]);
const randomAlg = (next, n = 25) => Array.from({ length: n }, () => TURNS[Math.floor(next() * 18)]).join(' ');

/** The oracle's reading of the cubie at the position `slot` names: its letters, and whether it is home. */
function oracleSlot(world, slot) {
  const pos = [...slot].reduce((p, f) => p.map((v, i) => v + NORMAL[f][i]), [0, 0, 0]);
  const stickers = STICKERS.map((s, i) => ({ ...s, i })).filter((s) => s.pos.every((v, k) => v === pos[k]));
  const letters = stickers.map((s) => world[s.i]).join('');
  return { piece: sorted(letters), home: stickers.every((s) => world[s.i] === s.face) };
}

const SLOTS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB', 'UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

test('a state and its picture read the same, slot by slot, over random cubes', () => {
  const next = rng(0x51a7e);
  for (let i = 0; i < 60; i++) {
    const alg = randomAlg(next);
    assert.deepEqual(readCube(facelets(alg)), readCube(applyAlg(SOLVED, alg)), alg);
  }
});

test('what is in a slot, where a piece is, and whether it is home, against the sticker oracle', () => {
  const next = rng(0xa11ce);
  for (let i = 0; i < 30; i++) {
    const alg = randomAlg(next);
    const state = applyAlg(SOLVED, alg);
    const world = facelets(alg);
    for (const slot of SLOTS) {
      const expected = oracleSlot(world, slot);
      assert.equal(sorted(pieceIn(state, slot).piece), expected.piece, `${alg}: in ${slot}`);
      assert.equal(sorted(whereIs(state, pieceIn(state, slot).piece).slot), sorted(slot));
      assert.equal(isHome(state, slot), sorted(expected.piece) === sorted(slot) && expected.home, `${alg}: ${slot} home`);
    }
  }
});

test('every piece is away after nothing but one face turn — eight of them — and none after solving', () => {
  for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
    assert.equal(piecesAway(applyAlg(SOLVED, face)).pieces.length, 8, face);
  }
  assert.deepEqual(piecesAway(SOLVED), { pieces: [], unknown: [] });
});

test('the playground\'s counter, from the questions alone: R wrecks 3 finished pieces, R U R\' wrecks 1, the insert 0', async (t) => {
  const module = `${CUBUS_IM}tools/verify/insert-practice.mjs`;
  if (!existsSync(module)) {
    t.skip(`the lesson course is not checked out beside this repo; its counter's fixture is UNCHECKED, not passed`);
    return;
  }
  const { practice, PROTECTED, wrecked } = await import(pathToFileURL(module).href);
  const position = practice();
  assert.ok(position, 'precondition: the course found its practice position');
  const start = applyAlg(SOLVED, position.alg);
  const expected = { R: 3, "R U R'": 1, [position.insert]: 0 };
  for (const [alg, count] of Object.entries(expected)) {
    const cube = applyAlg(start, alg);
    const fromQuestions = PROTECTED.filter((p) => !isHome(cube, p)).length;
    assert.equal(fromQuestions, wrecked(cube), `${alg}: the questions disagree with the course's own counter`);
    assert.equal(fromQuestions, count, `${alg}: the course's table says ${count}`);
  }
});

test('the owner\'s scenario: the top edges carrying none of the top colour are exactly the oracle\'s', () => {
  // Tumbled, white underneath and green at the back, with the red-green edge waiting on top. The
  // child's `y` turns the whole cube, so the pieces do not move and the top is still identity D.
  const start = play(SOLVED_FACELETS, 'D B', "y F' U' F U R U R' U' y'").end;
  assert.equal(start.hold, 'D B', 'precondition: the setup nets no whole-cube turn');
  const after = run('y', ['D', 'B'], readCubeState(start.identity));
  assert.deepEqual([...after.hold], ['D', 'R'], 'turning red to the front is a y');
  const world = play(start.identity, 'D B', 'y').worlds.at(-1);
  const topEdges = [[1, 46], [3, 37], [5, 10], [7, 19]].map(([u, s]) => world[u] + world[s]);
  const expected = topEdges.filter((letters) => !letters.includes(world[4])).map(sorted).sort();
  const answer = edgesInLayerWithout(after.state, after.hold[0], after.hold[0]);
  assert.deepEqual([...answer.unknown], []);
  assert.deepEqual(answer.pieces.map(sorted).sort(), expected);
  assert.ok(expected.includes(sorted('FR')), 'precondition: the red-green edge is among them');
});

test('a painted picture answers for what it shows and says unknown for the rest: the cross target', () => {
  const picture = targetPicture('cross');
  assert.equal([...picture].filter((c) => c === '?').length, 40, 'precondition: 40 stickers left free');
  const read = readCube(picture);
  const identified = [...read.corners, ...read.edges].filter((r) => r.piece !== null);
  // Every identified piece is one the picture paints in full; nothing is identified from a partial one.
  const shown = identified.map((r) => r.slot).sort();
  assert.deepEqual(shown, ['DB', 'DF', 'DL', 'DR'], 'the cross target shows exactly the four cross edges');
  for (const r of identified) assert.equal(r.twist, 0);
  assert.equal(piecesAway(picture).unknown.length, 16);
  assert.equal(isHome(picture, 'URF'), null, 'a piece the picture does not show is unknown, not away');
  assert.equal(whereIs(picture, 'UF'), null);
  assert.deepEqual(inLayerWithout(picture, 'D', 'U', 'edges'), { pieces: ['DR', 'DF', 'DL', 'DB'], unknown: [] });
  assert.deepEqual(inLayerWithout(picture, 'U', 'D', 'edges').unknown.length, 4);
});

test('a picture that spells a piece the wrong way round is not that piece', () => {
  // Swap two stickers of the URF corner: the letters are URF's, the twist order is a mirror's.
  const swapped = [...SOLVED_FACELETS];
  [swapped[9], swapped[20]] = [swapped[20], swapped[9]];
  assert.equal(pieceIn(swapped.join(''), 'URF'), null);
  assert.equal(pieceIn(SOLVED_FACELETS, 'URF').piece, 'URF');
});

test('layers, pairs, and refusals', () => {
  assert.deepEqual([...layerSlots('U', 'edges')], ['UR', 'UF', 'UL', 'UB']);
  assert.deepEqual([...layerSlots('D', 'corners')], ['DFR', 'DLF', 'DBL', 'DRB']);
  assert.deepEqual([...pairOf('DFR')], ['DFR', 'FR']);
  assert.deepEqual([...pairOf('DBL')], ['DBL', 'BL']);
  assert.throws(() => readCube('UUU'), /54 stickers/);
  assert.throws(() => readCube({ cp: [] }), /piece state/);
  assert.throws(() => pieceIn(SOLVED, 'UD'), /not a slot/);
  assert.throws(() => whereIs(SOLVED, 'QQ'), /not a piece/);
  assert.throws(() => layerSlots('Q'), /not a face/);
});

// Found by a Codex audit, 2026-09-16. A question that answers a malformed cube, or one asked with a
// filter that is not a filter, is worse than one that refuses: it is a wrong answer wearing a right
// one's shape, and nothing downstream can tell.
test('a malformed state and a filter that is not one are refused, not answered', () => {
  // All four arrays, not two of them: `co: []` answered `twist: undefined` and called URF not home.
  assert.throws(() => readCube({ ...SOLVED, co: [] }), /co must be an array of 8/);
  assert.throws(() => isHome({ ...SOLVED, co: [] }, 'URF'), /co must be an array of 8/);
  assert.throws(() => readCube({ ...SOLVED, eo: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), /eo must be whole numbers 0 to 1/);
  assert.throws(() => readCube({ ...SOLVED, ep: [0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }), /ep names one cubie twice/);
  // An out-of-range index used to crash a layer question a few frames after being accepted.
  assert.throws(() => inLayerWithout({ ...SOLVED, ep: [99, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, 'U', 'U', 'edges'),
    /ep must be whole numbers 0 to 11/);
  // A kind that is not a kind answered with BOTH kinds; a `without` that is not a face matched nothing
  // and so answered with the whole layer.
  assert.throws(() => layerSlots('U', 'edge'), /is not a kind/);
  assert.throws(() => layerSlots('U', 'corner'), /is not a kind/);
  assert.throws(() => inLayerWithout(SOLVED, 'U', 'Q', 'edges'), /"Q" is not a face/);
  // And the questions they were mistyped from still answer.
  assert.deepEqual(layerSlots('U', 'edges'), ['UR', 'UF', 'UL', 'UB']);
  assert.deepEqual(layerSlots('U', null).length, 8);
  assert.deepEqual(inLayerWithout(SOLVED, 'U', 'U', 'edges').pieces, []);
});
