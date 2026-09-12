// The 24 orientations, checked structurally — because a rotation's failures are structural.
//
// The load-bearing case is the first one. `lib/cube-orientation.js` builds its permutations from a
// written-out sticker layout, and a layout with one row reversed or one axis un-negated produces a
// family that passes every count, every multiset, every centre check and every closure test while
// drawing a cube that cannot exist. So it is pinned against `ROTATION_PERMS` in `two-phase.js`,
// which is derived from cubejs and re-derived by that suite on every run — a different
// implementation, written for a different purpose, years of moves apart from this file.
//
// The rest follow the shape cubus-im's own facelet suite settled on, and for its reasons: a face
// rotated WITHIN ITSELF is invisible to every count and every centre check, so two orientations
// are also checked sticker by sticker, by name.

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAlg, rotateState, SOLVED } from '../lib/cube-pieces.js';
import {
  determinant,
  FACE_LETTERS,
  ORIENTATIONS,
  orientationMatrix,
  orientationPerm,
  orientationRelabel,
  sameAxis,
  turnFacelets,
} from '../lib/cube-orientation.js';
import { ROTATION_PERMS, toFacelets } from '../lib/two-phase.js';

const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/** One scramble, one place. Two copies of an alg are two algs as soon as one is edited. */
const SCRAMBLE = "R U R' U' F2 L D B' R2 U D' L F";
const scrambledState = () => applyAlg(SOLVED, SCRAMBLE);
/** A cube that is scrambled on every face, so no symmetry can hide a wrong landing. */
const scrambled = () => toFacelets(scrambledState());

test('the sticker layout agrees with the cubejs-derived rotations', () => {
  // `x` brings F to the top and D to the front; `z` brings L to the top and keeps F in front.
  // These two generate all 24, so agreement here is agreement everywhere.
  assert.deepEqual([...orientationPerm('F', 'D')], [...ROTATION_PERMS.x]);
  assert.deepEqual([...orientationPerm('L', 'F')], [...ROTATION_PERMS.z]);
});

test('there are exactly 24, and they are distinct', () => {
  assert.equal(ORIENTATIONS.length, 24);
  const seen = new Set(ORIENTATIONS.map(([u, f]) => orientationPerm(u, f).join(',')));
  assert.equal(seen.size, 24, 'two orientations collapsed onto one permutation');
});

test('a pair on one axis is refused, and so is a letter that is not a face', () => {
  for (const [up, front] of [['U', 'D'], ['F', 'F'], ['L', 'R']]) {
    assert.throws(() => orientationPerm(up, front), /one axis twice/);
  }
  assert.throws(() => orientationPerm('U', 'X'), /two of URFDLB/);
  assert.throws(() => orientationPerm('u', 'f'), /two of URFDLB/);
  assert.equal(sameAxis('U', 'D'), true);
  assert.equal(sameAxis('U', 'F'), false);
});

test('("U","F") is the identity', () => {
  assert.deepEqual([...orientationPerm('U', 'F')], [...Array(54).keys()]);
  assert.equal(turnFacelets(scrambled(), 'U', 'F'), scrambled());
});

test('every orientation is a rotation, never a reflection', () => {
  for (const [up, front] of ORIENTATIONS) {
    assert.equal(determinant(orientationMatrix(up, front)), 1, `${up} ${front} is a reflection`);
  }
});

test('the family is closed under composition — all 576', () => {
  const byPerm = new Map(ORIENTATIONS.map(([u, f]) => [orientationPerm(u, f).join(','), `${u}${f}`]));
  for (const [u1, f1] of ORIENTATIONS) {
    const a = orientationPerm(u1, f1);
    for (const [u2, f2] of ORIENTATIONS) {
      const b = orientationPerm(u2, f2);
      // `perm[i]` says where facelet i's contents come FROM, so applying `a` and then `b` reads
      // through `a` first: the sticker at i after both came from a[b[i]]. (An earlier version of
      // this comment said that expression "is not it" while the line below used exactly it.)
      const composed = Array.from({ length: 54 }, (_, i) => a[b[i]]).join(',');
      assert.ok(byPerm.has(composed), `${u2}${f2} after ${u1}${f1} is not one of the 24`);
    }
  }
});

test('a solved cube is solved in every orientation', () => {
  for (const [up, front] of ORIENTATIONS) {
    assert.equal(
      turnFacelets(SOLVED_FACELETS, up, front),
      SOLVED_FACELETS,
      `${up} ${front} left a solved cube unsolved — the letters were not renamed with the stickers`,
    );
  }
});

test('every relabelling is a bijection, and names where each face went', () => {
  for (const [up, front] of ORIENTATIONS) {
    const relabel = orientationRelabel(up, front);
    assert.equal(new Set(Object.values(relabel)).size, 6, `${up} ${front}`);
    // The two the caller asked for, by name: the face that was `up` is now U, `front` is now F.
    assert.equal(relabel[up], 'U', `${up} ${front}: ${up} did not become the top`);
    assert.equal(relabel[front], 'F', `${up} ${front}: ${front} did not come to the front`);
  }
});

test('turning is undone by turning back', () => {
  const fl = scrambled();
  for (const [up, front] of ORIENTATIONS) {
    const turned = turnFacelets(fl, up, front);
    const relabel = orientationRelabel(up, front);
    // The way back is named in the TURNED cube's OWN letters: to undo, put the face that was
    // originally on top back on top — and in the turned cube that face is called `relabel.U`.
    // Inverting the relabelling instead gives `[up, front]` again, which re-applies the turn
    // rather than undoing it, and passes for the eight orientations that are their own inverse.
    assert.equal(turnFacelets(turned, relabel.U, relabel.F), fl, `${up} ${front} did not invert`);
  }
});

test('turning actually moves something', () => {
  const fl = scrambled();
  const same = ORIENTATIONS.filter(([u, f]) => turnFacelets(fl, u, f) === fl);
  assert.deepEqual(same.map(([u, f]) => `${u}${f}`), ['UF'], 'only the identity may be a no-op');
});

// A face rotated within itself lands every sticker on the right FACE while permuting the nine
// among themselves. Counts, multisets, centre checks and the relabelling all pass; only naming the
// landings catches it. cubus-im's suite shipped this weakness once — three of four mutations of an
// x2-only permutation passed a self-test built on blocks of a solved cube.
test('sticker landings, by name, for two orientations', () => {
  // Distinct labels so every one of the 54 is traceable.
  const labelled = Array.from({ length: 54 }, (_, i) => i);
  const trace = (up, front) => {
    const perm = orientationPerm(up, front);
    return Array.from({ length: 54 }, (_, i) => labelled[perm[i]]);
  };

  // Turning the cube over, top to bottom — 180° about the R–L axis, so D comes up and B comes
  // forward. Two things here are worth deriving rather than guessing, because the first draft of
  // this test got BOTH wrong and every other case in this file still passed:
  //
  //   U and D exchange IN ORDER, not reversed. U is read with B at the top of the view and D with
  //   F at the top, so the two reading conventions are already mirrored about the very axis being
  //   turned, and the turn cancels them. "Turning it over reverses the reading" is the intuition,
  //   and it is wrong.
  //
  //   R and L do NOT swap. The rotation is about the R–L axis, so each stays on its own face and
  //   is rotated 180° WITHIN ITSELF. Putting L's landings in R's slot is the transposition this
  //   test exists to catch, and it is what the first draft did.
  const over = trace('D', 'B');
  assert.deepEqual(over.slice(0, 9), [27, 28, 29, 30, 31, 32, 33, 34, 35]);
  assert.deepEqual(over.slice(27, 36), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(over.slice(9, 18), [17, 16, 15, 14, 13, 12, 11, 10, 9]);
  assert.deepEqual(over.slice(36, 45), [44, 43, 42, 41, 40, 39, 38, 37, 36]);
  // F and B do exchange, each reversed — the axis they sit on is the one being turned.
  assert.deepEqual(over.slice(45, 54), [26, 25, 24, 23, 22, 21, 20, 19, 18]);

  // A quarter turn about U, bringing the left-hand face round to the front.
  const quarter = trace('U', 'L');
  assert.deepEqual(quarter.slice(0, 9), [2, 5, 8, 1, 4, 7, 0, 3, 6]);
  assert.deepEqual(quarter.slice(18, 27), [36, 37, 38, 39, 40, 41, 42, 43, 44]);
  assert.deepEqual(quarter.slice(27, 36), [6, 3, 0, 7, 4, 1, 8, 5, 2].map((n) => n + 27));
});

// `rotateState` turns the PIECE STATE about U and carries a subtlety this file does not have:
// edge orientation is measured against the F/B axis, so a whole-cube turn changes which edges read
// as flipped. Two representations of one physical act, and nothing until now made them agree.
test('the facelet turn agrees with rotateState on the four it shares', () => {
  const state = scrambledState();
  // rotateAlg replaces F with R — an instruction you used to call F you now call R — so the face
  // that was on the left has come to the front. One quarter turn about U is ("U","L").
  const AFTER_Y = ['UF', 'UL', 'UB', 'UR'];
  for (let k = 0; k < 4; k++) {
    const [up, front] = AFTER_Y[k];
    assert.equal(
      turnFacelets(toFacelets(state), up, front),
      toFacelets(rotateState(state, k)),
      `y^${k}: the facelet turn and the state turn describe different cubes`,
    );
  }
});

test('an unreadable sticker survives the turn without becoming a face', () => {
  const fl = `${'?'.repeat(9)}${SOLVED_FACELETS.slice(9)}`;
  const turned = turnFacelets(fl, 'D', 'B');
  assert.equal(turned.length, 54);
  assert.equal([...turned].filter((c) => c === '?').length, 9);
  assert.equal(turned.slice(27, 36), '?????????', 'the unread face should now be underneath');
});

test('a facelet string of the wrong length is refused', () => {
  assert.throws(() => turnFacelets('UUU', 'D', 'B'), /expected 54 facelets/);
});

test('FACE_LETTERS is the URFDLB order the rest of the app uses', () => {
  assert.equal(FACE_LETTERS, 'URFDLB');
});

// ---- what the audit found ---------------------------------------------------------------------

// `Object.freeze` is SHALLOW. Freezing the NORMAL map left its vectors writable, and
// `orientationMatrix` returned two of them as rows — so one `m[1][1] = 0` in a caller permanently
// corrupted this module for every later call, because the next call reads the same array. Measured
// before the fix: the second `orientationMatrix('U','F')` came back with row 1 as [0,0,0].
test('a returned matrix cannot be used to corrupt the module', () => {
  // The write is refused rather than silently accepted: a caller writing to a matrix it was handed
  // is confused about who owns it, and a TypeError says so where a working-but-private copy would
  // not. (Under sloppy mode this would be a silent no-op — modules are strict, so it throws.)
  assert.throws(() => { orientationMatrix('U', 'F')[1][1] = 0; }, TypeError);
  assert.throws(() => { orientationMatrix('D', 'B')[0][0] = 5; }, TypeError);
  // And whatever a caller does, the next call is unaffected — the property that actually matters.
  try { const m = orientationMatrix('U', 'F'); m[1] = [9, 9, 9]; } catch { /* expected */ }
  assert.deepEqual(orientationMatrix('U', 'F').map((r) => [...r]), [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    'a caller mutated the module by writing to a matrix it was given');
});

// A bare `NORMAL[x]` lookup is truthy for `constructor`, `toString` and `__proto__`, all inherited
// from Object.prototype. Every guard written as `!NORMAL[up]` waved them through, and
// `orientationMatrix('constructor','F')` returned a matrix with a NaN determinant instead of
// refusing. These are exported entry points; they defend themselves.
test('an inherited property name is not a face', () => {
  for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    assert.throws(() => orientationMatrix(bad, 'F'), /two of URFDLB/, `${bad} was accepted`);
    assert.throws(() => orientationPerm('U', bad), /two of URFDLB/, `${bad} was accepted`);
    assert.equal(sameAxis(bad, 'F'), false);
  }
  // And a multi-character token that happens to be a SUBSTRING of the face letters.
  for (const bad of ['UR', 'RF', 'URFDLB', '']) {
    assert.throws(() => orientationMatrix(bad, 'F'), /two of URFDLB/, `"${bad}" was accepted`);
  }
  assert.throws(() => orientationMatrix(null, 'F'), /two of URFDLB/);
  assert.throws(() => orientationMatrix(['U'], 'F'), /two of URFDLB/);
});

// THE COVERAGE GAP THE AUDIT FOUND. The `rotateState` cross-check above covers four orientations —
// the ones about the vertical axis — so a mutation that reversed every OTHER turn passed all
// fifteen cases. This composes the whole group from the two cubejs-derived generators and checks
// every one of the 24, which is the comparison the file claimed to be making.
test('all 24 agree with the group generated from the cubejs-derived rotations', () => {
  const IDENTITY = [...Array(54).keys()];
  // perm[i] = where i's contents come FROM, so applying `a` then `b` is a[b[i]].
  const after = (a, b) => b.map((i) => a[i]);
  const seen = new Map([[IDENTITY.join(','), IDENTITY]]);
  const queue = [IDENTITY];
  while (queue.length) {
    const p = queue.shift();
    for (const g of [ROTATION_PERMS.x, ROTATION_PERMS.z]) {
      const next = after(p, [...g]);
      const key = next.join(',');
      if (seen.has(key)) continue;
      seen.set(key, next);
      queue.push(next);
    }
  }
  assert.equal(seen.size, 24, `the generators produced ${seen.size} rotations, not 24`);

  // Name each generated rotation by where it puts the U and F centres, then ask this module for
  // that same pair and require the identical permutation.
  const centre = { U: 4, F: 22 };
  for (const perm of seen.values()) {
    const up = FACE_LETTERS[Math.floor(perm[centre.U] / 9)];
    const front = FACE_LETTERS[Math.floor(perm[centre.F] / 9)];
    assert.deepEqual([...orientationPerm(up, front)], perm,
      `"${up} ${front}" disagrees with the rotation generated from cubejs's own tables`);
  }
});
