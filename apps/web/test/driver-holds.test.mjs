// The driver's hold rules (ADR 0012): an entry declares one, `methodOf` carries it, and `solveByMethod`
// enforces it — `vertical` for the cross-first methods, `slice` for a method whose middle slice moves the
// centres. Asserted on one-step probe methods, so each rule is seen refusing exactly what it must.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOLVED } from '../lib/cube-pieces.js';
import { run } from '../lib/cube-moves.js';
import { MethodSolverError, solveByMethod } from '../lib/method-solver.js';

/** A one-stage method whose stage emits `alg` as an intuitive step and returns what the driver will replay. */
function oneStep(alg, turns, kind = 'goal') {
  return {
    id: 'probe', turns, stages: [{
      id: 'probe', keep: () => true, contract: () => true,
      run: (view, steps) => { steps.push({ stage: 'probe', kind, alg, why: { key: 'probe' } }); return run(alg, ['U', 'F'], view).state; },
    }],
  };
}

test('under the slice rule a step may turn the middle and tilt the hold, but never turn the cube over, and a stage ends upright', () => {
  // Turned over by a rotation or a wide turn: refused, naming the move.
  assert.throws(() => solveByMethod(SOLVED, oneStep("x U x'", 'slice')), (e) => e instanceof MethodSolverError && /turns the cube over with x/.test(e.target));
  assert.throws(() => solveByMethod(SOLVED, oneStep("r U r'", 'slice')), (e) => /turns the cube over with r/.test(e.target));
  // E and S are slices about another axis: the cube's top goes sideways, which is not Roux's middle.
  assert.throws(() => solveByMethod(SOLVED, oneStep("S U S'", 'slice')), (e) => /turns the cube over with S/.test(e.target));
  // M is allowed — and a stage that ENDS tilted is refused at the boundary.
  assert.throws(() => solveByMethod(SOLVED, oneStep('M', 'slice')), (e) => e instanceof MethodSolverError && /ends held .* a stage must end with U on top/.test(e.target));
  // Tilted and back inside one stage is fine. (Not solved, so the assembly guard is what stops it — after the
  // hold rules have all passed.)
  assert.throws(() => solveByMethod(SOLVED, oneStep("M U M'", 'slice')), (e) => e.stage === 'assembly');
});

test('under the vertical rule — every cross-first method — a slice in an intuitive step is still refused', () => {
  assert.throws(() => solveByMethod(SOLVED, oneStep("M U M'", 'vertical')), (e) => /vertical axis only/.test(e.target));
  assert.throws(() => solveByMethod(SOLVED, oneStep("M U M'", undefined)), (e) => /vertical axis only/.test(e.target), 'a method with no rule is the ladder\'s');
  assert.throws(() => solveByMethod(SOLVED, oneStep('U', 'sideways')), /no hold rule "sideways"/);
  // A named algorithm is under neither rule: it may tip the cube while it runs, and must end upright.
  assert.throws(() => solveByMethod(SOLVED, oneStep("M U M'", 'vertical', 'case')), (e) => e.stage === 'assembly');
});

