// What a scramble is allowed to be.
//
// Two halves, and only one of them was ever right. The STATE has always been a uniform draw
// from a cryptographic source — random-state.js, the WCA/TNoodle method — and random-state
// .test.mjs covers that. The LENGTH was not: the scramble was cubejs's `solve()` inverted, and
// that method's default bound is 22, so 96% of scrambles were longer than God's number and
// 79.5% were exactly 22 (measured, n=200).
//
// God's number is 20 for the SOLUTION, and inversion preserves length, so <= 20 is reachable
// for every state. This file is the guarantee.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { GODS_NUMBER, solveWithinGodsNumber } from '../lib/solve-target.js';
import { createSolver } from '../lib/solver-engine.js';
import { randomCube } from '../lib/random-state.js';
import * as twoPhase from '../lib/two-phase.js';
import Cube from '../vendor/cubejs.js';

const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');
const engine = createSolver(twoPhase);
const solve = async (f, bounds) => engine(f, bounds);
const invert = (alg) => alg.trim().split(/\s+/).reverse()
  .map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? m.slice(0, -1) : `${m}'`))
  .join(' ');

test('every scramble is God\'s number or shorter, and actually reaches its cube', async () => {
  // The engine is complete and the promise escalates its budget, so there is no "usually" here:
  // a state that could not be answered inside the bound would throw rather than come back long.
  for (let i = 0; i < 12; i++) {
    const cube = randomCube(Cube);
    const facelets = cube.asString();
    const solution = await solveWithinGodsNumber(facelets, { solve });
    const scramble = invert(solution);
    const moves = scramble.trim().split(/\s+/).length;

    assert.ok(moves <= GODS_NUMBER, `scramble of ${moves} moves for ${facelets}`);
    assert.equal(moves, solution.trim().split(/\s+/).length, 'inversion must preserve length');
    // The scramble is only a scramble if it REACHES the state from solved — the check app.js
    // makes with `reaches` before it will draw one.
    const built = new Cube();
    built.move(scramble);
    assert.equal(built.asString(), facelets, 'the scramble does not reach its own cube');
  }
});

test('a scramble is never rolled by cubejs, whose bound is 22', () => {
  // The defect this file exists for, pinned at the source. cubejs stays as the parser and the
  // oracle; what it must not be again is the thing that decides how long a scramble is.
  const code = app
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/([^:'"`])\/\/[^\n]*/g, '$1');
  const roll = code.match(/async function rollScramble\(\)[\s\S]*?\n\}/)?.[0];
  assert.ok(roll, 'rollScramble is gone or is no longer async');
  assert.doesNotMatch(roll, /\br\.solve\(|cube\.solve\(/,
    'rolling must not call cubejs\'s search — its default maxDepth is 22, and asking it for 20 '
    + 'instead measured 5,644 ms mean and 66 s worst');
  assert.match(roll, /solveWithinGodsNumber/,
    'and it must use the same promise the solve path keeps, not a second copy of the bound');
});

test('the WCA minimum is enforced on the STATE, not on the answer', () => {
  // TNoodle rejects states solvable in under two moves. Asking the solver instead would be
  // wrong in a way that is easy to miss: two-phase does not promise an optimal route, so a
  // one-move state could come back with a long answer and pass a length check.
  const solved = new Cube();
  assert.equal(solved.isSolved(), true);

  const singles = ['U', 'D', 'L', 'R', 'F', 'B'].flatMap((f) => [f, `${f}'`, `${f}2`]);
  assert.equal(singles.length, 18, 'eighteen face turns, or the filter has a hole in it');
  for (const m of singles) {
    const c = new Cube();
    c.move(m);
    assert.equal(c.isSolved(), false, `${m} should not leave a solved cube`);
    // One turn from solved: exactly what trivialState must catch.
    const undone = Cube.fromString(c.asString());
    undone.move(invert(m));
    assert.equal(undone.isSolved(), true);
  }

  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const fn = code.match(/function trivialState\(cube\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(fn, /cube\.isSolved\(\)/, 'the solved state itself must be rejected');
  assert.match(fn, /SINGLE_MOVES/, 'and every one-turn state with it');
  assert.doesNotMatch(fn, /solveWithinGodsNumber|solverWorker/,
    'the filter must ask the state, not the solver');
});
