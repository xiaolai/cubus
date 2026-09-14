// Where every cubie is, and which way it is turned — as a function of the cube's state, never as
// the residue of an animation (packages/cubus-cube/src/pose.js).
//
// The renderer has its own move implementation today: `_grab` collects the meshes of a layer into
// a temporary group, `_bake` writes the result back and rounds the positions, and what a cubie's
// rotation IS depends on the sequence of turns that happened to it. That is the second
// implementation of a thing this repository already publishes as its API (lib/cube-pieces.js), and
// it is the one it actually draws with. `poseAll` replaces it with arithmetic over the piece
// state, so seeking to a timestamp and playing into it cannot disagree.
//
// The claim underneath is that a cubie's rotation follows from (home, slot, twist) alone. It was
// re-derived independently before this module was written — geometry simulated cubie by cubie
// against cube-pieces' own tables, 200,000 random quarter turns: 192 corner mappings, 288 edge
// mappings, 0 collisions, and exactly 24 distinct rotations, all with determinant +1.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORNERS, EDGES, SOLVED, applyAlg, applyMove,
} from '../lib/cube-pieces.js';
import {
  CUBIES, HOME, after, poseAll,
} from '../../../packages/cubus-cube/src/pose.js';

const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const QUARTER = Math.PI / 2;
/** A face turn as the descriptor: one outer layer of an axis. */
const FACE = {
  R: { axis: 'x', layers: [1] }, L: { axis: 'x', layers: [-1] },
  U: { axis: 'y', layers: [1] }, D: { axis: 'y', layers: [-1] },
  F: { axis: 'z', layers: [1] }, B: { axis: 'z', layers: [-1] },
};
/** The signed angle cube-pieces' `move` name turns through, in this module's convention. */
const moveOf = (name) => {
  const face = name[0];
  const turns = name.endsWith('2') ? 2 : 1;
  const dir = name.endsWith("'") ? -1 : 1;
  const sign = FACE[face].layers[0];
  return { ...FACE[face], turns, angle: -dir * sign * turns * QUARTER };
};

const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
  - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
  + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const closeVec = (a, b) => a.every((x, i) => close(x, b[i]));
const closeMat = (a, b) => a.every((row, i) => closeVec(row, b[i]));
/** A deterministic stream, so a failure is reproducible from its seed alone. */
const stream = (seed) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

test('a solved cube is every cubie at home, turned by nothing', () => {
  const poses = poseAll(I3, SOLVED, null, 0);
  assert.equal(poses.length, 26, 'a cube has 26 cubies: 8 corners, 12 edges, 6 centres');
  for (const [i, p] of poses.entries()) {
    assert.deepEqual(p.pos, HOME[i], `${CUBIES[i].name} is not at home`);
    assert.deepEqual(p.m, I3, `${CUBIES[i].name} is turned, on a solved cube`);
  }
});

// THE INVARIANT, and the reason this module can replace the animation's bookkeeping: a turn
// finished is the cube after that turn. Stated over the FRAME as well as the state, because a
// whole-cube rotation moves every cubie while leaving {cp,co,ep,eo} identical.
test('a move at phase 1 is the cube the move leaves behind — over a thousand of them', () => {
  const next = stream(20260914);
  const names = Object.keys(FACE).flatMap((f) => [f, `${f}'`, `${f}2`]);
  let state = SOLVED;
  for (let i = 0; i < 1000; i++) {
    const name = names[Math.floor(next() * names.length)];
    const move = moveOf(name);
    const ran = poseAll(I3, state, move, 1);
    const landed = after(I3, state, move);
    const settled = poseAll(landed.frame, landed.state, null, 0);
    for (const [k, p] of ran.entries()) {
      assert.ok(closeVec(p.pos, settled[k].pos), `${name} #${i}: ${CUBIES[k].name} lands somewhere else`);
      assert.ok(closeMat(p.m, settled[k].m), `${name} #${i}: ${CUBIES[k].name} lands turned differently`);
    }
    state = applyMove(state, name);
    // And the state the module derives is the state cube-pieces derives, move for move.
    assert.deepEqual(landed.state.cp, state.cp, `${name} #${i}: corner permutation`);
    assert.deepEqual(landed.state.co, state.co, `${name} #${i}: corner twists`);
    assert.deepEqual(landed.state.ep, state.ep, `${name} #${i}: edge permutation`);
    assert.deepEqual(landed.state.eo, state.eo, `${name} #${i}: edge flips`);
  }
});

test('every pose is a rotation, at rest and mid-turn', () => {
  const state = applyAlg(SOLVED, "R U R' U' F2 L D B'");
  for (const phase of [0, 0.17, 0.5, 0.83, 1]) {
    for (const p of poseAll(I3, state, moveOf('R'), phase)) {
      assert.ok(close(det(p.m), 1), `determinant ${det(p.m)} at phase ${phase} — not a rotation`);
      const t = [0, 1, 2].map((i) => [0, 1, 2].map((j) => p.m[j][i]));
      assert.ok(closeMat(mul(p.m, t), I3), `not orthonormal at phase ${phase}`);
    }
  }
});

test('a settled cubie sits on exact integers — nothing is left rounded into place', () => {
  const state = applyAlg(SOLVED, "F R U2 B' L D2");
  for (const [phase, move] of [[0, moveOf('L')], [1, moveOf('L')], [0, null]]) {
    for (const p of poseAll(I3, state, move, phase)) {
      for (const x of p.pos) assert.equal(Number.isInteger(x), true, `${x} is not an integer at phase ${phase}`);
    }
  }
});

// A half turn has two ways round, and the descriptor carries a SIGNED angle so that a scrubber can
// tell them apart. A token could not: forward `R2` and the `R2` an undo plays share both
// endpoints, so a canonicalised one puts the moving layer 180 degrees from where the other has it
// at the same instant.
test('the two ways round a half turn differ in the middle, and agree at both ends', () => {
  const forward = moveOf('R2');
  const backward = { ...forward, angle: -forward.angle };
  const mid = (m) => poseAll(I3, SOLVED, m, 0.5).map((p) => p.pos);
  assert.notDeepEqual(mid(forward), mid(backward), 'a half turn went the same way round both times');
  for (const phase of [0, 1]) {
    const f = poseAll(I3, SOLVED, forward, phase);
    const b = poseAll(I3, SOLVED, backward, phase);
    for (const [i, p] of f.entries()) {
      assert.ok(closeVec(p.pos, b[i].pos), `the two ways round disagree at phase ${phase}`);
    }
  }
});

// x y z: the whole cube turns. The piece state cannot express it — every cubie moves and
// {cp,co,ep,eo} is identical — which is why the frame is an argument and not a derived thing.
test('a whole-cube rotation moves all 26 cubies and leaves the piece state alone', () => {
  const state = applyAlg(SOLVED, "R U R'");
  const x2 = { axis: 'x', layers: [-1, 0, 1], turns: 2, angle: Math.PI };
  const landed = after(I3, state, x2);
  for (const half of ['cp', 'co', 'ep', 'eo']) {
    assert.deepEqual(landed.state[half], state[half], `a whole-cube rotation rewrote ${half}`);
  }
  assert.deepEqual(landed.state.ct, [0, 0, 0, 0, 0, 0], 'a whole-cube rotation spun a centre in place');
  assert.notDeepEqual(landed.frame, I3, 'a whole-cube rotation left the frame where it was');
  const before = poseAll(I3, state, null, 0);
  const turned = poseAll(I3, state, x2, 1);
  const moved = turned.filter((p, i) => !closeVec(p.pos, before[i].pos)).length;
  // x2 leaves only the two centres ON its axis where they were; everything else changes place.
  assert.equal(moved, 24, 'x2 moved something other than the whole cube minus its R and L centres');
  for (const [i, p] of turned.entries()) {
    assert.ok(closeMat(p.m, poseAll(landed.frame, landed.state, null, 0)[i].m),
      `${CUBIES[i].name} is turned differently from the cube the rotation leaves behind`);
  }
});

test('a slice turns the middle layer only, and hands back a cube in a new frame', () => {
  const M = { axis: 'x', layers: [0], turns: 1, angle: QUARTER };
  const before = poseAll(I3, SOLVED, null, 0);
  const turned = poseAll(I3, SOLVED, M, 1);
  const moved = turned.map((p, i) => (closeVec(p.pos, before[i].pos) ? null : CUBIES[i].name)).filter(Boolean);
  assert.equal(moved.length, 8, 'a slice moves the four edges and four centres of its layer, and nothing else');
  assert.ok(moved.every((name) => !name.includes('R') && !name.includes('L')),
    `the x slice moved a cubie of the R or L face: ${moved.join(' ')}`);
  const landed = after(I3, SOLVED, M);
  assert.notDeepEqual(landed.frame, I3, 'a slice left the frame where it was — then its centres have nowhere to go');
});

test('a wide move turns two layers, and a face turn one', () => {
  const wide = { axis: 'x', layers: [1, 0], turns: 1, angle: -QUARTER };
  const face = moveOf('R');
  const before = poseAll(I3, SOLVED, null, 0);
  const count = (move) => poseAll(I3, SOLVED, move, 1)
    .filter((p, i) => !closeVec(p.pos, before[i].pos)).length;
  assert.equal(count(face), 8, 'a face turn moves the eight cubies around its centre');
  assert.equal(count(wide), 16, 'a wide move moves its face and the slice beside it');
});

test('the frame is applied to everything, and nothing else', () => {
  // A quarter turn about y, as a frame: every cubie's home is turned with it.
  const frame = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]];
  const plain = poseAll(I3, SOLVED, null, 0);
  const held = poseAll(frame, SOLVED, null, 0);
  for (const [i, p] of held.entries()) {
    const want = [0, 1, 2].map((r) => frame[r].reduce((s, v, c) => s + v * plain[i].pos[c], 0));
    assert.ok(closeVec(p.pos, want), `${CUBIES[i].name} is not its home turned by the frame`);
    assert.ok(closeMat(p.m, frame), `${CUBIES[i].name} does not wear the frame's rotation`);
  }
});

test('the cubie list is the renderer\'s own order, and every home is a real slot', () => {
  assert.deepEqual(CUBIES.slice(0, 8).map((c) => c.name), CORNERS, 'corners are not in cube-pieces order');
  assert.deepEqual(CUBIES.slice(8, 20).map((c) => c.name), EDGES, 'edges are not in cube-pieces order');
  assert.deepEqual(CUBIES.slice(20).map((c) => c.name), ['U', 'R', 'F', 'D', 'L', 'B'], 'centres are not in URFDLB order');
  for (const [i, c] of CUBIES.entries()) {
    const span = Math.abs(HOME[i][0]) + Math.abs(HOME[i][1]) + Math.abs(HOME[i][2]);
    assert.equal(span, { corner: 3, edge: 2, centre: 1 }[c.kind], `${c.name} does not sit where a ${c.kind} sits`);
  }
});
