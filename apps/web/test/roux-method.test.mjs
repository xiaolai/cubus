// Roux, whole: the method solves, cubejs agrees, the driver's slice rule holds where it must and refuses where
// it must, and what the solver says becomes a lesson the app can walk and cut (ADR 0012).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { SOLVED, applyAlg, fromCube } from '../lib/cube-pieces.js';
import { convertSelectors, faceTurnsAlg, run } from '../lib/cube-moves.js';
import { answerMethodSolve, handleMethodSolve, METHOD_SOLVE } from '../lib/lesson-client.js';
import { solveByMethod } from '../lib/method-solver.js';
import { methodById } from '../lib/methods/registry.js';
import { methodOf, prepareMethod } from '../lib/methods/method-of.js';
import { namedPieces, whyText } from '../lib/method-lesson.js';
import { STOP_NOW, stopDescriptor } from '../lib/solve-client.js';
import { TARGET_BY_ID } from '../lib/stage-targets.js';
import { scanFrameWalk, sameHold, toMethodFrame } from '../lib/solving-hold.js';
import Cube from '../vendor/cubejs.js';
import { baselineCubes, bootLesson } from './fixtures/beginner-lesson.mjs';
import { seededStates } from './fixtures/seeded-scrambles.mjs';

const ROUX_ENTRY = methodById('roux');
await prepareMethod(ROUX_ENTRY);
const ROUX = methodOf(ROUX_ENTRY);
const STAGES = ['first-block', 'second-block', 'cmll', 'lse'];

/** The pieces each Roux step is about, in the cube's own letters — what its cues must land on, whatever hold
 *  the step begins in. */
const ABOUT = {
  'firstBlock.build': ['DL', 'FL', 'BL', 'DLF', 'DBL'],
  'secondBlock.build': ['DR', 'FR', 'BR', 'DFR', 'DRB'],
  'secondBlock.align': ['UF', 'UB', 'DF', 'DB'],
  'cmll.align': ['URF', 'UFL', 'ULB', 'UBR'],
  'cmll.solve': ['URF', 'UFL', 'ULB', 'UBR'],
  'lse.orient': ['UR', 'UF', 'UL', 'UB', 'DF', 'DB'],
  'lse.sides': ['UL', 'UR'],
  'lse.finish': ['UF', 'UB', 'DF', 'DB'],
};

/** Where each stage's steps begin: the index of the first step of every stage that has any. */
const stageStarts = (steps) => steps.map((s, i) => (i === 0 || steps[i - 1].stage !== s.stage ? i : -1)).filter((i) => i >= 0);

const cubejsSolves = (state, alg) => {
  const c = new Cube();
  c.cp = [...state.cp]; c.co = [...state.co]; c.ep = [...state.ep]; c.eo = [...state.eo];
  if (alg) c.move(alg);
  return c.isSolved();
};

test('Roux solves every sampled cube, cubejs agrees, and every stage begins held upright', () => {
  const frozen = baselineCubes().map((f) => fromCube(Cube.fromString(toMethodFrame(f))));
  let tilted = 0;
  for (const state of [...seededStates(40, 0x0e0e), ...frozen]) {
    const { steps, alg } = solveByMethod(state, ROUX);
    assert.ok(cubejsSolves(state, alg), `cubejs says the Roux alg does not solve the cube: ${alg}`);
    // The stages, in their order, each at most once.
    const order = [...new Set(steps.map((s) => s.stage))];
    assert.deepEqual(order, STAGES.filter((s) => order.includes(s)), `stages out of order: ${order.join(' ')}`);
    for (const i of stageStarts(steps)) {
      assert.deepEqual([...steps[i].hold], ['U', 'F'], `${steps[i].stage} began held ${steps[i].hold}, not upright`);
    }
    // Inside a stage a step may begin tilted by the slice — and the pieces it names, named in that hold, are
    // read back through it (as the lesson does) to the pieces the step is about.
    for (const step of steps) {
      const want = ABOUT[step.why.key];
      if (want) {
        const named = convertSelectors(namedPieces(step).join(','), step.hold);
        assert.deepEqual(named.split(',').map((p) => [...p.slice('piece:'.length)].sort().join('')).sort(),
          want.map((n) => [...n].sort().join('')).sort(), `${step.why.key} held ${step.hold}: points at ${named}`);
      }
      if (step.hold[0] !== 'U') tilted++;
    }
    for (const step of steps) assert.ok(whyText(step).length > 0, `${step.why.key} captions as nothing`);
  }
  assert.ok(tilted > 0, 'no step began tilted in the whole sample — the slice rule was never exercised');
});

test('Codex\'s cube: the shortest orient step leaves the slice turned, the next step goes on from it, and the stage still ends upright', () => {
  // Refute pass, 2026-10-17: from solved, `M U M' U'` leaves the blocks and corners built, the centres lined
  // up and the edges unoriented, and its only shortest fixes end a quarter turn of the slice off.
  const state = run("M U M' U'", ['U', 'F'], SOLVED);
  assert.deepEqual([...state.hold], ['U', 'F'], 'precondition: the slice is lined up');
  const { steps, alg } = solveByMethod(state.state, ROUX);
  assert.ok(cubejsSolves(state.state, alg), 'cubejs says it is not solved');
  assert.deepEqual(steps.map((s) => s.stage), steps.map(() => 'lse'), 'only the last six edges had anything to do');
  assert.equal(steps[0].why.key, 'lse.orient');
  assert.ok(['U M U', "U M U'"].includes(steps[0].alg), `the orient step is ${steps[0].alg}, not one of the two shortest`);
  assert.notEqual(steps[1].hold[0], 'U', 'the step after it does not begin tilted, so the case is not what it claims');
  // And the walk the screen draws takes the hold through the slice: the chip after the M is named for it.
  const walk = scanFrameWalk(steps);
  assert.equal(walk.holds.length, walk.moves.length + 1);
  assert.ok(walk.holds.some((h, i) => i > 0 && !sameHold(h, walk.holds[0])), 'the walk\'s hold never moved with the slice');
  assert.ok(sameHold(walk.holds.at(-1), walk.holds[0]), 'the walk ended held other than it began');
});

// ---- the lesson -------------------------------------------------------------------------------------------

let booted;
before(async () => { booted = await bootLesson(); });
after(async () => { await booted?.win.happyDOM.abort(); });

test('a Roux lesson is headed by its own stages, captions every step, and holds every move', async () => {
  for (const facelets of baselineCubes().slice(0, 6)) {
    const lesson = await booted.lessonFor({ facelets, lesson: null }, ROUX_ENTRY);
    assert.ok(lesson, 'no lesson');
    assert.equal(lesson.method, 'roux');
    const names = lesson.sections.map((s) => s.name);
    assert.deepEqual(names, ['Left block', 'Right block', 'Top corners', 'Last six edges'].filter((n) => names.includes(n)));
    assert.equal(lesson.moveHolds.length, lesson.moves.length + 1);
    for (const step of lesson.steps) assert.ok(booted.whyText(step).length > 0);
    // Replayed in the scan frame from the cube it started at, the walk solves it — as the FACE TURNS its tokens
    // are. The tokens themselves are the renderer's, in the cube's own letters: after an M the face a child
    // calls U is another identity face, which cubejs, turning faces where they physically are, would misread.
    const c = Cube.fromString(facelets);
    c.move(faceTurnsAlg(lesson.alg));
    assert.ok(c.isSolved(), 'the lesson\'s walk does not solve the cube on screen');
  }
});

test('the Roux chips cut its lesson where the block first stands, and a chip Roux does not stop at is no cut', async () => {
  const { stageLessonFor } = await import('../lib/cube-subject.js');
  const holds = (id) => (f) => TARGET_BY_ID[id].verify(fromCube(Cube.fromString(toMethodFrame(f))));
  for (const facelets of baselineCubes().slice(0, 4)) {
    for (const chip of ['first-block', 'both-blocks']) {
      const cut = await stageLessonFor({ facelets, lesson: null }, ROUX_ENTRY, TARGET_BY_ID[chip]);
      assert.ok(cut, `${chip}: no cut`);
      assert.ok(holds(chip)(cut.stepFacelets.at(-1)), `${chip}: the cut ends where the chip does not hold`);
      assert.ok(!holds('solved')(cut.stepFacelets.at(-1)), `${chip}: the cut went all the way to solved`);
    }
    // Roux builds no cross: the cross chip is offered, and is no stop of Roux.
    assert.equal(await stageLessonFor({ facelets, lesson: null }, ROUX_ENTRY, TARGET_BY_ID.cross), null);
  }
});

// ---- the worker, preparing --------------------------------------------------------------------------------

const engine = (prepare) => ({ solveByMethod, methodById, methodOf, prepare });

test('a method whose tables cannot be loaded is an answer, never a hanging question — and the next one tries again', async () => {
  const state = applyAlg(SOLVED, "R U R' U'");
  let tries = 0;
  const flaky = async () => { tries++; if (tries === 1) throw new Error('fetch failed'); };
  const first = await answerMethodSolve(engine(flaky), { id: 1, state, method: 'roux' });
  assert.equal(first.kind, METHOD_SOLVE);
  assert.equal(first.ok, false);
  assert.match(first.error.message, /roux method could not be prepared: fetch failed/);
  const second = await answerMethodSolve(engine(flaky), { id: 2, state, method: 'roux' });
  assert.equal(second.ok, true, 'a failed load was remembered');
  assert.equal(tries, 2);
  // Called off while it loaded: the stop word is read after the load, so the answer is "called off".
  const word = new Int32Array(new SharedArrayBuffer(4));
  const slow = () => new Promise((resolve) => setTimeout(() => { Atomics.store(word, 0, STOP_NOW); resolve(); }, 5));
  const stopped = await answerMethodSolve(engine(slow), { id: 3, state, method: 'roux', stop: stopDescriptor(word) });
  assert.equal(stopped.calledOff, true);
  // And handleMethodSolve is still the synchronous whole of a prepared answer.
  assert.deepEqual(handleMethodSolve(engine(), { id: 4, state, method: 'roux' }).result.alg, second.result.alg);
});
