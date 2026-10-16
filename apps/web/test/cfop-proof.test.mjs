// The proof each CFOP entry carries (ADR 0011 decision 5; plan Phase 7): every last-layer LOOK over its
// whole case domain, enumerated rather than sampled, with cubejs as the oracle — and, labelled as what it
// is, a regression sample of whole solves on top.
//
// WHY A LOOK'S DOMAIN IS SMALL ENOUGH TO ENUMERATE HERE. An orientation look reads and changes only
// orientation: a sequence of face turns does the same thing to the orientation of each SLOT whichever
// pieces stand in it. So "every top orientation, the pieces home" — 27 twists x 8 flips = 216 states — is
// the whole of what the OLL looks are asked, and a look that finishes all 216 finishes every one of the
// 62,208 last-layer states' orientation half. The permutation looks are asked a top that is oriented:
// 24 corner orders x 24 edge orders of matching parity = 288 states, the whole of their domain. The
// 62,208-state sweep of both halves together is the nightly CI shard (`bench/method-solver-profile.mjs
// exhaustive 0 0` and `1 1`); this is the per-look half of the claim, cheap enough to run on every push.
//
// THE ORACLE IS CUBEJS, which shares no code with the solver: each answer is played on a cubejs cube built
// from the state's facelets, and the look's goal is read off cubejs's own stickers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Cube from 'cubejs';

import { methodById } from '../lib/methods/registry.js';
import { methodOf } from '../lib/methods/method-of.js';
import { solveByMethod } from '../lib/method-solver.js';
import { SOLVED, applyAlg, toFacelets } from '../lib/cube-pieces.js';
import { faceTurnsAlg, run } from '../lib/cube-moves.js';
import { SCAN_HOLD, holdForStage, sameHold } from '../lib/solving-hold.js';
import { whyText } from '../lib/method-lesson.js';
import { seededStates } from './fixtures/seeded-scrambles.mjs';
import { EVERY_CONFIGURATION, configuration } from './fixtures/f2l-positions.mjs';

const CFOP = ['cfop-4lll', 'cfop'];
const ORIENT_STAGES = new Set(['top-cross', 'top-face']);
/** The stage names a pairs-dial step can carry (lib/method-lesson.js DIAL_OF). */
const PAIR_STAGES = new Set(['first-layer', 'middle-layer', 'f2l']);

/** cubejs's faces, URFDLB, nine stickers each. */
const faces = (cube) => {
  const s = cube.asString();
  return Object.fromEntries('URFDLB'.split('').map((f, i) => [f, s.slice(i * 9, i * 9 + 9)]));
};
const uniform = (face) => [...face].every((c) => c === face[4]);
const lowerTwo = (face) => [...face.slice(3)].every((c) => c === face[4]);
const firstTwoLayers = (f) => uniform(f.D) && ['R', 'F', 'L', 'B'].every((x) => lowerTwo(f[x]));
const topOriented = (f) => firstTwoLayers(f) && uniform(f.U);

/** A step's moves as face turns, as the solver itself plays them (its hold renamed away). */
const turns = (step) => faceTurnsAlg(run(step.alg, step.hold, SOLVED).drawn);

/** Solve `state` with `id`'s method and replay it on cubejs: the cube after the orientation looks, and
 *  after everything. */
function replay(id, state) {
  const result = solveByMethod(state, methodOf(methodById(id)));
  const cube = Cube.fromString(toFacelets(state));
  let afterOrient = null;
  let oriented = false;
  for (const step of result.steps) {
    const alg = turns(step);
    if (alg) cube.move(alg);
    if (ORIENT_STAGES.has(step.stage)) oriented = true;
    else if (oriented && afterOrient === null) afterOrient = faces(cube);
  }
  return { result, afterOrient: afterOrient ?? faces(cube), end: cube };
}

const permutations = (a) => (a.length <= 1 ? [a] :
  a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
const parity = (p) => {
  let n = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) n++;
  return n % 2;
};

/** Every top orientation with every piece home: the orientation looks' domain. */
function* orientations() {
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
      yield {
        cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [a, b, c, (9 - a - b - c) % 3, 0, 0, 0, 0],
        ep: [...Array(12).keys()], eo: [x, y, z, (x + y + z) % 2, 0, 0, 0, 0, 0, 0, 0, 0],
      };
    }
  }
}

/** Every order of the top pieces with the top oriented: the permutation looks' domain. */
function* placements() {
  const P4 = permutations([0, 1, 2, 3]);
  for (const cp of P4) for (const ep of P4) {
    if (parity(cp) !== parity(ep)) continue;
    yield { cp: [...cp, 4, 5, 6, 7], co: Array(8).fill(0), ep: [...ep, 4, 5, 6, 7, 8, 9, 10, 11], eo: Array(12).fill(0) };
  }
}

test('the enumerations are the whole domains they claim: 216 orientations, 288 placements, all distinct', () => {
  const key = (s) => JSON.stringify(s);
  assert.equal(new Set([...orientations()].map(key)).size, 216);
  assert.equal(new Set([...placements()].map(key)).size, 288);
});

for (const id of CFOP) {
  test(`${id}: every one of the 384 placements of a pair is put in by its F2L stage — checked by cubejs`, () => {
    // The pairs stage's whole domain (test/f2l-configurations.test.mjs): one pair's corner in any of 8
    // slots and 3 twists, its edge in any of 8 slots and 2 flips, the cross solved. Full CFOP's 41-case
    // rung and the easy entry's trigger rung are each replayed over all of it, not over a sample.
    let n = 0;
    for (const c of EVERY_CONFIGURATION) {
      const state = configuration(c.cornerAt, c.twist, c.edgeAt, c.flip);
      const result = solveByMethod(state, methodOf(methodById(id)));
      const cube = Cube.fromString(toFacelets(state));
      let afterPairs = faces(cube);
      for (const step of result.steps) {
        const alg = turns(step);
        if (alg) cube.move(alg);
        if (PAIR_STAGES.has(step.stage)) afterPairs = faces(cube);
      }
      assert.ok(firstTwoLayers(afterPairs), `${id}: the pair at corner ${c.cornerAt}.${c.twist}, edge ${c.edgeAt}.${c.flip} was not put in`);
      assert.ok(cube.isSolved(), `${id}: not solved from configuration ${JSON.stringify(c)}`);
      n++;
    }
    assert.equal(n, 384);
  });

  test(`${id}: every one of the 216 top orientations is oriented by its OLL looks, then solved — checked by cubejs`, () => {
    let n = 0;
    for (const state of orientations()) {
      const { afterOrient, end } = replay(id, state);
      assert.ok(topOriented(afterOrient), `${id}: the OLL looks left the top unoriented from ${JSON.stringify(state)}`);
      assert.ok(end.isSolved(), `${id}: not solved from ${JSON.stringify(state)}`);
      n++;
    }
    assert.equal(n, 216);
  });

  test(`${id}: every one of the 288 top placements is solved by its PLL looks alone — checked by cubejs`, () => {
    let n = 0;
    for (const state of placements()) {
      const { result, end } = replay(id, state);
      assert.ok(end.isSolved(), `${id}: not solved from ${JSON.stringify(state)}`);
      assert.ok(result.steps.every((s) => !ORIENT_STAGES.has(s.stage)), `${id}: an oriented top was oriented again`);
      n++;
    }
    assert.equal(n, 288);
  });

  // REGRESSION SAMPLING, and labelled so: a sample can show a failure, never that none exists.
  test(`${id}: regression sample — seeded whole solves end solved by cubejs, cross first and planned whole`, () => {
    for (const state of seededStates(12, 0xcf0b, 25)) {
      const { result, end } = replay(id, state);
      assert.ok(end.isSolved(), `${id}: a seeded cube was not solved`);
      const cross = result.steps.filter((s) => s.stage === 'cross');
      assert.ok(cross.length <= 1, `${id}: the cross is planned whole, so it is at most one step`);
    }
  });

  test(`${id}: every step has words, and is held the way the entry declares — white up only for its cross`, () => {
    const entry = methodById(id);
    assert.deepEqual([...entry.holds.displayed.whiteUpStages], ['cross']);
    for (const state of seededStates(12, 0xcf0c, 25)) {
      for (const step of solveByMethod(state, methodOf(entry)).steps) {
        const words = whyText(step);
        assert.ok(typeof words === 'string' && words.length > 0, `${id}: a ${step.stage} step has no words`);
        assert.equal(sameHold(holdForStage(step.stage), SCAN_HOLD), entry.holds.displayed.whiteUpStages.includes(step.stage),
          `${id}: the ${step.stage} stage is held differently from what the entry declares`);
        // AGENTS.md §4: a whole-cube turn is said by its anchor and its destination, never left/right.
        if (/(^|\s)[xyz]/.test(step.alg) && /turn the whole cube/i.test(words)) {
          assert.match(words, /Keep white underneath/, `${id}: a whole-cube turn said without its anchor`);
          assert.doesNotMatch(words, /\b(left|right|quarter)\b.*whole cube|whole cube.*\b(to the left|to the right|a quarter)\b/i);
        }
      }
    }
  });
}

test('the planned cross is a real cross: replayed by cubejs, the white cross is home after the first step', () => {
  for (const state of seededStates(20, 0xc055, 25)) {
    const { steps } = solveByMethod(state, methodOf(methodById('cfop')));
    const cube = Cube.fromString(toFacelets(state));
    cube.move(turns(steps[0]));
    const f = faces(cube);
    // The four D edges: centre colour on D, and each side's bottom-middle sticker its side's colour.
    assert.equal(steps[0].stage, 'cross');
    for (const at of [1, 3, 5, 7]) assert.equal(f.D[at], f.D[4]);
    for (const x of ['R', 'F', 'L', 'B']) assert.equal(f[x][7], f[x][4]);
  }
});

test('the check has teeth: a cube with the top twisted in place is NOT read as oriented', () => {
  const twisted = Cube.fromString(toFacelets({ ...SOLVED, co: [1, 2, 0, 0, 0, 0, 0, 0] }));
  assert.equal(topOriented(faces(twisted)), false);
  assert.equal(topOriented(faces(Cube.fromString(toFacelets(applyAlg(SOLVED, 'U'))))), true);
});
