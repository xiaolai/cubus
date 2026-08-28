// The point of vendoring min2phase ourselves is to be able to ask for a solution LENGTH.
// If that patch ever stops applying, the app keeps running on min2phase's stock bounds and
// every target is silently ignored — the solver still returns solutions, they are just never
// the ones that were asked for. So these run against the real vendored module, not a fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

import { LOOSEST_BOUND, createSolver } from '../lib/min2phase-engine.js';
import { refine } from '../lib/solve-target.js';

const vendored = new URL('../vendor/min2phase.js', import.meta.url);
assert.ok(existsSync(vendored), 'vendor/min2phase.js is missing — run `pnpm vendor:libs`');
const min2phase = await import(vendored);
const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
Cube.initSolver();

const solve = createSolver(min2phase);
const movesIn = (alg) => alg.trim().split(/\s+/).length;

test('the vendored module exposes the bounds the patch is supposed to add', () => {
  for (const fn of ['initialize', 'solvePattern', 'setBounds']) {
    assert.equal(typeof min2phase[fn], 'function', `vendor/min2phase.js has no ${fn}()`);
  }
});

test('a module without setBounds is refused rather than silently unbounded', () => {
  // This is the failure the whole file exists to catch: a vendoring that produced a working
  // solver with no way to bound it. Accepting it would mean every target is ignored.
  assert.throws(() => createSolver({ initialize() {}, solvePattern() {} }),
    /has no setBounds\(\).*would be ignored/s);
  assert.throws(() => createSolver(null), TypeError);
});

test('asking for a length actually bounds the answer', () => {
  for (let i = 0; i < 8; i++) {
    const facelets = Cube.random().asString();
    for (const solLen of [LOOSEST_BOUND, 21]) {
      const alg = solve(facelets, { solLen, probeMax: 2_000_000 });
      assert.ok(alg, `no solution under ${solLen} for ${facelets}`);
      assert.ok(movesIn(alg) < solLen, `asked for < ${solLen}, got ${movesIn(alg)}`);
      // cubejs is the oracle, exactly as it is for the two-phase path in app.js.
      const oracle = Cube.fromString(facelets);
      oracle.move(alg);
      assert.ok(oracle.isSolved(), 'the bounded solution must still solve the cube');
    }
  }
});

test('a budget it cannot meet returns null, not an error string and not junk', () => {
  // Sixteen moves inside one probe: unreachable. min2phase answers "Error 8", and the whole
  // job of this adapter is that no caller ever sees that string.
  const facelets = Cube.random().asString();
  const answer = solve(facelets, { solLen: 16, probeMax: 1 });
  assert.equal(answer, null);
});

test('a facelet string that is not one is refused at the boundary', () => {
  assert.throws(() => solve('too short'), TypeError);
  assert.throws(() => solve(null), TypeError);
  assert.throws(() => solve(new Cube().asString(), { solLen: 99 }), RangeError);
  assert.throws(() => solve(new Cube().asString(), { solLen: 1 }), RangeError);
});

test('the real solver honours the contract solve-target.js assumes', async () => {
  // The unit tests for solve-target.js use a scripted fake, which can only prove the module
  // handles a contract. This proves min2phase actually has it: every improvement is strictly
  // shorter, the target is met when reachable, and the answers solve the cube.
  const asyncSolve = async (facelets, options) => solve(facelets, { ...options, probeMax: 100_000 });
  for (let i = 0; i < 4; i++) {
    const facelets = Cube.random().asString();
    let previous = Infinity;
    let last = null;
    for await (const step of refine(facelets, { solve: asyncSolve, tier: 'twenty' })) {
      const improved = step.moves < previous || (step.moves === previous && step.stopped !== null);
      assert.ok(improved, `${previous} -> ${step.moves} (stopped=${step.stopped})`);
      previous = step.moves;
      last = step;
      const oracle = Cube.fromString(facelets);
      oracle.move(step.alg);
      assert.ok(oracle.isSolved(), 'every answer shown must solve the cube');
    }
    assert.equal(last.met, true, '<= 20 is reachable on every cube — see solver-move-count.md');
    assert.ok(last.moves <= 20);
  }
});

test('a solved cube needs no moves and does not confuse the bound check', () => {
  const alg = solve(new Cube().asString(), { solLen: LOOSEST_BOUND, probeMax: 100_000 });
  assert.equal(alg, '', 'a solved cube has an empty solution, not a null one');
});
