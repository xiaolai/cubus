// The numbers behind the reconnect design (dev-docs/smart-cube-ux-prd.md, "Reconnecting a known
// cube" → "Confirming cheaply — measured"). A claim in a doc must be backed by a test that fails
// when the claim stops being true (AGENTS.md), so the simulation the section quotes lives here,
// seeded, and asserts the bounds the design rests on:
//
//   - a captured side must be compared to the candidate UP TO ROTATION (the app learns a side's
//     true rotation only from a full six-side scan), and compared that way ONE side misses a
//     single untracked quarter turn about a third of the time — a turn only rotates its own face;
//   - two OPPOSITE sides miss it about as often, together — a turn of F leaves B exactly as it
//     was and F matching under rotation;
//   - two ADJACENT sides catch it, near-solved states included — a turn moves a row or a column
//     on at least one of them;
//   - but only compared EXACTLY. Tolerating the scanner's usual two misread stickers lets a
//     quarter turn's three-sticker row through: the confirmation must compare exactly, and a
//     misread must cost a full scan, never a false yes;
//   - and no partial check is a proof: a legal drift exists that leaves three adjacent sides
//     untouched. Partial confirmation is a spot check against casual drift, and the trust it
//     supports is the user's, given with the cube in hand.
//
// Uniform-random cube states are not needed here; states some moves from solved are what a
// reconnect meets, and a seeded generator keeps the figures reproducible.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import Cube from '../vendor/cubejs.js';

const FACES = 'URFDLB';
const MOVES = ['U', "U'", 'U2', 'R', "R'", 'R2', 'F', "F'", 'F2', 'D', "D'", 'D2', 'L', "L'", 'L2', 'B', "B'", 'B2'];

/** mulberry32 — a small seeded PRNG, so every run counts the same trials. */
const prng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const alg = (rand, k) => {
  const out = [];
  let last = '';
  while (out.length < k) {
    const m = MOVES[Math.floor(rand() * MOVES.length)];
    if (m[0] === last) continue;
    last = m[0];
    out.push(m);
  }
  return out.join(' ');
};

const face = (s, x) => s.slice(FACES.indexOf(x) * 9, FACES.indexOf(x) * 9 + 9);
const rot = (s) => [s[6], s[3], s[0], s[7], s[4], s[1], s[8], s[5], s[2]].join('');
const rots = (s) => { const a = []; for (let i = 0; i < 4; i++) { a.push(s); s = rot(s); } return a; };
const differing = (a, b) => { let d = 0; for (let i = 0; i < 9; i++) if (a[i] !== b[i]) d++; return d; };
/** Does the side as captured (any way up) match the candidate's, allowing `tol` misread stickers? */
const sideMatches = (candidate, seen, tol = 0) => rots(seen).some((r) => differing(candidate, r) <= tol);

/** Miss rates over N trials: a candidate `dist` moves from solved, then one untracked quarter
 *  turn; what fraction of checks would still say "same cube"? */
const missRates = ({ dist, trials, tol = 0, seed = 7 }) => {
  const rand = prng(seed + dist * 1000 + tol);
  let one = 0, adjacent = 0, opposite = 0;
  for (let n = 0; n < trials; n++) {
    const c = new Cube();
    if (dist) c.move(alg(rand, dist));
    const V = c.asString();
    c.move(alg(rand, 1));
    const R = c.asString();
    const same = (x) => sideMatches(face(V, x), face(R, x), tol);
    if (same(FACES[Math.floor(rand() * 6)])) one++;
    if (same('F') && same('U')) adjacent++;
    if (same('F') && same('B')) opposite++;
  }
  return { one: one / trials, adjacent: adjacent / trials, opposite: opposite / trials };
};

const TRIALS = 2000;

test('one side, compared any way up, misses a single untracked turn about a third of the time', () => {
  for (const dist of [0, 5, 25]) {
    const { one } = missRates({ dist, trials: TRIALS });
    assert.ok(one > 0.25 && one < 0.45, `${dist} moves from solved: one side still matched ${(one * 100).toFixed(1)}% of the time`);
  }
});

test('two opposite sides fail together: a turn of F leaves B exact and F matching under rotation', () => {
  for (const dist of [0, 5, 25]) {
    const { opposite } = missRates({ dist, trials: TRIALS });
    assert.ok(opposite > 0.25, `${dist} moves from solved: opposite pair still matched ${(opposite * 100).toFixed(1)}%`);
  }
});

test('two adjacent sides, compared exactly, catch a single untracked turn — near-solved states included', () => {
  for (const dist of [0, 2, 5, 25]) {
    const { adjacent } = missRates({ dist, trials: TRIALS });
    assert.ok(adjacent <= 0.01, `${dist} moves from solved: adjacent pair still matched ${(adjacent * 100).toFixed(2)}% (> 1%)`);
  }
});

test('but not if the comparison tolerates the scanner\'s two misread stickers — a quarter turn moves three', () => {
  const { adjacent } = missRates({ dist: 25, trials: TRIALS, tol: 2 });
  assert.ok(adjacent > 0.15, `with a two-sticker tolerance the adjacent pair still matched only ${(adjacent * 100).toFixed(1)}% — the tolerance argument no longer holds`);
});

test('no partial check is a proof: a legal drift leaves U, R and F untouched', () => {
  // Found by the refute pass (Codex, 2026-08-28): a legal state and a legal sequence that permute
  // only pieces the three visible faces do not show.
  const V = 'BBBUUFUUFRRDRRDUBDRRDFFDRRBBBLDDDFLFRFFULLUFDLUULBLLBL';
  const drift = "B2 D B2 R2 F2 U L2 U L2 D2 B2 L' D2 F2 U2 R D";
  assert.equal(Cube.fromString(V).asString(), V, 'the state is legal');
  const R = Cube.fromString(V).move(drift).asString();
  assert.notEqual(R, V, 'the cube changed');
  for (const x of ['U', 'R', 'F']) assert.equal(face(R, x), face(V, x), `${x} looks exactly the same`);
});
