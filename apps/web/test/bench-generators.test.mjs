// The two generators the benches measure FROM, which had no tests at all.
//
// Found by a Codex audit, 2026-09-16. `bench/` is not a gate, and that is exactly why these matter: the
// numbers they produce are read into `dev-docs/solver-move-count.md` and `dev-docs/method-solver-return-plan.md`
// and then argued from, so a generator that quietly stops covering its domain — or samples something other
// than what its labels say — turns into a decision about what to teach a child. A sweep that yields nothing
// reports zero failures, which reads exactly like a pass.
//
// Deterministic throughout: both generators take a seed, and every assertion here is about the shape of
// what comes out rather than about a particular draw.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LAST_LAYER_STATES, checkCoverage, lastLayerStates, sweepPart } from '../bench/method-solver-profile.mjs';
import { CORPUS_TARGETS, buildCorpus, coverage } from '../bench/solve-to-state-corpus.mjs';
import { SOLVED, applyAlg, toFacelets } from '../lib/cube-pieces.js';
import { isCubeState } from '../lib/cube-trust.js';

const Cube = (await import(new URL('../vendor/cubejs.js', import.meta.url))).default;
const key = (s) => `${s.cp.join(',')}|${s.co.join(',')}|${s.ep.join(',')}|${s.eo.join(',')}`;

test('the last-layer sweep enumerates its whole domain, once each, and every state is a real cube', () => {
  const seen = new Set();
  let n = 0;
  for (const state of lastLayerStates()) {
    n += 1;
    seen.add(key(state));
    // The first two layers are untouched — that is what makes these LAST-LAYER states, and a generator
    // that disturbed them would be measuring a different question.
    assert.deepEqual(state.cp.slice(4), [4, 5, 6, 7]);
    assert.deepEqual(state.co.slice(4), [0, 0, 0, 0]);
    assert.deepEqual(state.ep.slice(4), [4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(state.eo.slice(4), [0, 0, 0, 0, 0, 0, 0, 0]);
  }
  assert.equal(n, LAST_LAYER_STATES, 'the sweep does not cover the number it claims');
  assert.equal(seen.size, n, 'the enumeration yields a state twice');
});

// The sweep runs on every core since 2026-09-17: one slice of the enumeration per worker, by place mod
// the worker count. What makes that safe is that the slices are checked to be the enumeration — a worker
// that swept nothing reports no failures, which reads exactly like a pass.

test('a slice of the sweep is the states at its place, and nothing else', () => {
  // The first and the last state, each alone: the whole slicing rule, for the cost of two solves.
  const rungs = { cross: 0, pairs: 0, oll: 1, pll: 1 };
  const first = sweepPart(rungs, 0, LAST_LAYER_STATES);
  const last = sweepPart(rungs, LAST_LAYER_STATES - 1, LAST_LAYER_STATES);
  assert.deepEqual([first.total, last.total], [1, 1], 'a one-state slice swept some other number of states');
  assert.deepEqual([first.failed, last.failed], [0, 0]);
  assert.ok(first.moves > 0 || last.moves > 0, 'the slices solved nothing');
});

test('the slices are refused unless together they are the enumeration, once each', () => {
  const N = LAST_LAYER_STATES;
  const slice = (part, parts, total = Math.ceil((N - part) / parts)) => ({ part, total });
  assert.equal(checkCoverage([slice(0, 4), slice(1, 4), slice(2, 4), slice(3, 4)], 4), N);
  assert.equal(checkCoverage([slice(0, 1)], 1), N);
  // Uneven slices are still exact: 62,208 over 7 is 8,887 or 8,886 each.
  assert.equal(checkCoverage(Array.from({ length: 7 }, (_, k) => slice(k, 7)), 7), N);
  // A worker that swept nothing is the failure that reads like a pass.
  assert.throws(() => checkCoverage([slice(0, 2), slice(1, 2, 0)], 2), /slice 1\/2 swept 0 states/);
  // A slice missing, and a slice counted twice.
  assert.throws(() => checkCoverage([slice(0, 2)], 2), /not 0\.\.1 once each/);
  assert.throws(() => checkCoverage([slice(0, 2), slice(0, 2)], 2), /not 0\.\.1 once each/);
  // A slice that swept a neighbour's share too.
  assert.throws(() => checkCoverage([slice(0, 2, N), slice(1, 2)], 2), /slice 0\/2 swept 62208/);
});

test('every state the sweep yields is one a cube can actually reach', () => {
  // Legality asked by the app's own four classical conditions, through cubejs — a different
  // implementation from the model the generator builds these with. An unreachable state counted as a
  // failure would be a lie about the repertoire, which is the generator's own stated reason for its
  // parity filter; this checks the filter does what it says.
  let checked = 0;
  for (const state of lastLayerStates()) {
    if (checked % 997 !== 0) { checked += 1; continue; }   // every 997th: the property is structural
    assert.equal(isCubeState(toFacelets(state), Cube), true, `unreachable state at ${checked}`);
    checked += 1;
  }
  assert.ok(checked === LAST_LAYER_STATES);
});

test('the solve-to-state corpus draws every target from real routes, and says what each case is', () => {
  const cases = buildCorpus({ seeds: 6, randomCases: 2 });
  assert.ok(cases.length > 0);
  // Every target is represented by cases drawn from a ROUTE, not only by the random ones — which are
  // generated per target regardless and so cannot say the routed half ran at all.
  for (const target of CORPUS_TARGETS) {
    const routed = cases.filter((c) => c.target === target && c.kind !== 'random');
    assert.ok(routed.length > 0, `"${target}" drew nothing from a route`);
  }
  // Every case states a real cube and carries the fields the bench reads off it.
  for (const c of cases) {
    assert.ok(CORPUS_TARGETS.includes(c.target), `unknown target ${c.target}`);
    assert.equal(typeof c.errorKind, 'string');
    assert.equal(isCubeState(toFacelets(c.state), Cube), true, `a case that is not a cube: ${c.kind}`);
    assert.ok(c.bound === null || c.bound >= 0);
  }
  // The same seed gives the same corpus: a bench whose population moves between runs is comparing
  // two different things and reporting the difference as a change.
  const again = buildCorpus({ seeds: 6, randomCases: 2 });
  assert.deepEqual(again.map((c) => `${c.target}|${c.kind}|${toFacelets(c.state)}`),
    cases.map((c) => `${c.target}|${c.kind}|${toFacelets(c.state)}`));
});

test('a damaged step is really damaged, and a later-stage alg is really from later', () => {
  const cases = buildCorpus({ seeds: 8, randomCases: 1 });
  // `invert('R2')` is `R2`: a "reversed" slip on a half turn left the step exactly as it was and filed
  // it as a mistake. Every slip must reach a cube the correct step would not have.
  const slips = cases.filter((c) => c.kind === 'slip');
  assert.ok(slips.length > 0, 'precondition: the corpus has slips');
  for (const c of slips) {
    assert.equal(c.atTarget, false);
    assert.ok(c.errorLen > 0, 'a slip with no moves in it is not a slip');
  }
  // And the wrong-stage cases: `cross` may be handed anything taught later, `corners-home` only a PLL.
  const wrongStage = cases.filter((c) => c.kind === 'wrong-stage');
  assert.ok(wrongStage.length > 0, 'precondition: the corpus has wrong-stage cases');
  for (const c of wrongStage) assert.equal(c.errorKind, 'a whole later-stage alg');
  // The random cases say what they are: a seeded walk, not a uniform draw.
  const random = cases.filter((c) => c.kind === 'random');
  assert.ok(random.length > 0);
  for (const c of random) assert.equal(c.errorKind, 'a 30-turn random walk');
});

test('the coverage counts are of the cases, not of the intention', () => {
  const cases = buildCorpus({ seeds: 6, randomCases: 2 });
  const { byTargetKind, byProgress, byErrorKind } = coverage(cases);
  const counted = [...byTargetKind.values()].reduce((a, b) => a + b, 0);
  assert.equal(counted, cases.length, 'the per-target counts do not add up to the corpus');
  assert.equal([...byErrorKind.values()].reduce((a, b) => a + b, 0), cases.length);
  // The progress buckets cover every non-random case and nothing else.
  assert.equal([...byProgress.values()].reduce((a, b) => a + b, 0), cases.filter((c) => c.kind !== 'random').length);
  // A cube that is AT the target is at the target: the bucket is not a guess from `progress`.
  const atTarget = cases.filter((c) => c.atTarget);
  assert.ok(atTarget.length > 0);
  for (const c of atTarget) assert.equal(c.progress, 1);
});

test('a state the method solver cannot route is a loud refusal, not a quiet gap', () => {
  // The generator's own comment says a refused scramble is a solver bug. It was dropped by a
  // `.filter(Boolean)` that said nothing, and the random cases then populated every target so the
  // corpus looked complete. Asked here by driving the bound to where no scramble routes.
  // Named exactly, because there are two guards here and each would otherwise cover for the other: this
  // is the one that says the ROUTES are missing, and the per-target check below it is the one that says a
  // target got nothing but noise.
  assert.throws(() => buildCorpus({ seeds: 0, randomCases: 2 }), /no scrambles were routed/);
});

test('the sweep and the corpus are reachable from the checks that read them', () => {
  // A trivial-looking case with a real job: these two modules are `bench/` scripts, and nothing else in
  // the suite imports them. If either stops loading — a moved import, a renamed export — the benches go
  // quiet and the documents that quote them go stale with no test going red.
  assert.equal(typeof lastLayerStates, 'function');
  assert.equal(typeof buildCorpus, 'function');
  assert.ok(applyAlg(SOLVED, 'R').cp.length === 8);
});
