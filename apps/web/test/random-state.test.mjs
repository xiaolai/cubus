// A scramble is only a random-STATE scramble if the state really is uniform over the legal
// positions. Two ways that quietly stops being true: a modulo bias in the draw, and a parity
// repair that skews which arrangements can come out. Both are invisible in play — the cubes look
// fine — so both are checked here rather than trusted.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_REJECTIONS, cryptoUint32, permutationParity, randomBelow, randomCube, randomState,
} from '../lib/random-state.js';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
Cube.initSolver();

/** A generator that hands back exactly these values, so an expectation can be exact. */
const scripted = (values) => { let i = 0; return () => values[i++ % values.length]; };

test('the draw is unbiased: the tail that would skew it is rejected', () => {
  // 2^32 is not divisible by 12, so the top 4 values would make 0..3 more likely than 4..11.
  // Those must be thrown away, not folded in.
  const limit = Math.floor(0x1_0000_0000 / 12) * 12;
  const rng = scripted([limit, limit + 3, 0xffffffff, 7]);
  assert.equal(randomBelow(12, rng), 7, 'every value at or past the cutoff must be redrawn');

  assert.equal(randomBelow(1, scripted([0])), 0);
  assert.throws(() => randomBelow(0), RangeError);
  assert.throws(() => randomBelow(-3), RangeError);
  assert.throws(() => randomBelow(2.5), RangeError);
});

test('a source stuck in the rejected tail THROWS rather than spinning for ever', () => {
  // THE FAILURE THIS REPLACES IS A HANG, which is why it is asserted and not merely hoped for: the
  // rejection loop had no bound, so a source that keeps answering one value in the tail never
  // returned. `drillAlg` runs this synchronously on the UI thread and `makeRound`'s retry budget
  // cannot help, because the loop never gets back to it (Codex audit, 2026-10-04).
  //
  // `0xffffffff` is in the rejected tail for every n this module uses except the powers of two.
  assert.throws(
    () => randomBelow(6, () => 0xffffffff),
    /not varying/,
    'a constant source in the tail must be reported, not waited on',
  );

  // AND THE BOUND IS NOT A CAP ON BAD LUCK. A source that rejects a few times and then answers must
  // still get its answer — a bound set too tight would turn ordinary rejection into a refusal.
  const limit = Math.floor(0x1_0000_0000 / 6) * 6;
  let left = 8;
  assert.equal(randomBelow(6, () => (left-- > 0 ? limit : 5)), 5, 'eight rejections then a draw is a draw');

  // THE BOUND IS THE NUMBER IT IS NAMED FOR. The first draw counts as a rejection, so the budget is
  // spent after exactly that many rejected draws — one fewer still answers, one more throws. Asserted
  // because the first version spent 33 draws under a constant called 32 (verify pass, 2026-10-04).
  const after = (rejections) => { let n = rejections; return () => (n-- > 0 ? limit : 4); };
  assert.equal(randomBelow(6, after(MAX_REJECTIONS - 1)), 4, `${MAX_REJECTIONS - 1} rejections must still answer`);
  assert.throws(() => randomBelow(6, after(MAX_REJECTIONS)), /not varying/, `${MAX_REJECTIONS} rejections must be refused`);

  // A power of two has NO rejected tail, so no source can be stuck for it: every draw is in range.
  assert.equal(randomBelow(2, () => 0xffffffff), 1, 'n = 2 rejects nothing and cannot hang');
});

test('the draw covers its whole range', () => {
  const seen = new Set();
  for (let i = 0; i < 4000; i++) seen.add(randomBelow(12));
  assert.equal(seen.size, 12, 'some value in 0..11 never came up');
});

test('parity is counted by cycles, not guessed', () => {
  assert.equal(permutationParity([0, 1, 2, 3]), 0, 'the identity is even');
  assert.equal(permutationParity([1, 0, 2, 3]), 1, 'one transposition is odd');
  assert.equal(permutationParity([1, 0, 3, 2]), 0, 'two transpositions are even');
  assert.equal(permutationParity([1, 2, 0]), 0, 'a 3-cycle is even');
  assert.equal(permutationParity([1, 2, 3, 0]), 1, 'a 4-cycle is odd');
});

test('every state it produces is a legal cube', () => {
  // The three constraints a real cube obeys. A generator that broke any of them would hand the
  // solver a position with no solution, which is the loudest possible failure downstream and the
  // quietest one here.
  for (let i = 0; i < 300; i++) {
    const { cp, co, ep, eo } = randomState();
    assert.deepEqual([...cp].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual([...ep].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal(permutationParity(cp), permutationParity(ep), 'corner and edge parity must agree');
    assert.equal(co.reduce((a, b) => a + b, 0) % 3, 0, 'corner twists must sum to zero mod 3');
    assert.equal(eo.reduce((a, b) => a + b, 0) % 2, 0, 'edge flips must sum to zero mod 2');
    assert.ok(co.every((o) => o >= 0 && o < 3));
    assert.ok(eo.every((o) => o === 0 || o === 1));
  }
});

test('the parity repair does not lock an edge in place', () => {
  // It swaps the first two edges, so a careless reading would expect those two never to be
  // where they started. Both halves must still occur.
  const firsts = new Set();
  for (let i = 0; i < 400; i++) firsts.add(randomState().ep[0]);
  assert.ok(firsts.size >= 10, `only ${firsts.size} different edges ever land in the first slot`);
});

test('cubejs agrees the generated cubes are solvable, and they are not solved', () => {
  for (let i = 0; i < 12; i++) {
    const cube = randomCube(Cube);
    const facelets = cube.asString();
    assert.equal(facelets.length, 54);
    assert.equal(cube.isSolved(), false, 'a random cube coming out solved is a broken generator');
    const solution = Cube.fromString(facelets).solve();
    const check = Cube.fromString(facelets);
    check.move(solution);
    assert.ok(check.isSolved(), `cubejs cannot solve ${facelets} — the state is not legal`);
  }
});

test('the generator is injected, so the same draws give the same cube', () => {
  const draws = Array.from({ length: 64 }, (_, i) => (i * 2654435761) >>> 0);
  const a = randomState(scripted(draws));
  const b = randomState(scripted(draws));
  assert.deepEqual(a, b, 'same source, same cube — otherwise nothing here could be reproduced');
});

test('there is no silent fallback to Math.random', () => {
  // The failure this guards is a downgrade nobody notices: scrambles keep coming, they are just
  // predictable. Better to fail loudly on a platform with no crypto than to quietly weaken.
  assert.equal(typeof cryptoUint32(), 'number');
  const real = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    assert.throws(() => cryptoUint32(), /refusing to fall back to Math\.random/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
  }
});

test('states are spread out, not repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(randomCube(Cube).asString());
  assert.equal(seen.size, 200, 'two draws produced the same cube — that should never happen');
});
