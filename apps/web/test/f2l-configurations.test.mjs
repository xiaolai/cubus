// The pairing rung's search, over its ENTIRE input space rather than over a sample.
//
// This file exists because a branch was deleted. Rung 1 used to try, when the direct search
// failed, to lift the pair loose first and then place it — and that branch could not run. The
// audit of 2026-09-09 measured it as never taken and offered the choice the finding always
// offers: delete it with an exhaustive regression check, or find the case that needs it.
//
// **Exhaustive is possible here, and that is the point of the file.** The search reads exactly
// four things about a cube: which slot the pair's corner is in, how it is twisted, which slot its
// edge is in, and how it is flipped. Its goal test, its dedup key and its ranking are all
// functions of those four and nothing else — so the 8 x 3 x 8 x 2 = 384 combinations are not a
// corpus, they are the whole domain. `a_configuration_is_the_whole_input` is what holds that
// claim up: the same four values with the rest of the cube rearranged must produce the same
// algorithm, and if that ever stops being true this file stops being exhaustive and says so.
//
// The edge has eight slots and not twelve because the cross is solved before this stage begins —
// that is the stage's `keep` — so no cross slot can be holding a middle-layer edge.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CORNER, EDGE } from '../lib/cube-pieces.js';
import {
  EVERY_CONFIGURATION, PAIR, PROTECTED_CORNERS, PROTECTED_EDGES, configuration,
} from './fixtures/f2l-positions.mjs';
import { CROSS, F1L, F2L_PAIRS, MIDDLE } from '../lib/methods/engine.js';
import { PAIRS_ALGS, PAIRS_RUNGS } from '../lib/methods/pairs.js';
import { __testing } from '../lib/method-solver.js';
import { replayStage } from './fixtures/method-replay.mjs';

const { repertoire, slotSafe, f2lCaseName } = __testing;

/** What rung 1 did with slot 0's pair: the step it produced, or null when it was already home. */
function slotZeroStep(config, filler = 0) {
  const steps = [];
  PAIRS_RUNGS[1].run(configuration(config.cornerAt, config.twist, config.edgeAt, config.flip, filler), steps);
  return steps.find((s) => s.stage === 'f2l'
    && (s.target === PAIR.corner || s.why?.corner === PAIR.corner || s.why?.edge === PAIR.edge)) ?? null;
}

/** A configuration is BURIED when a piece sits in a slot the algorithm may not disturb. */
const buried = (c) => PROTECTED_CORNERS.includes(c.cornerAt) || PROTECTED_EDGES.includes(c.edgeAt);

test('a configuration is the whole input: the rest of the cube does not change the answer', () => {
  // The premise every other test here rests on. If the search ever started reading a fifth thing
  // about the cube, 384 would stop being the domain and the exhaustiveness below would quietly
  // become a sample — the failure mode that makes an exhaustive check worth less than it looks.
  for (const config of EVERY_CONFIGURATION) {
    const first = slotZeroStep(config, 0);
    for (const filler of [1, 2, 3]) {
      const again = slotZeroStep(config, filler);
      assert.equal(again?.alg ?? null, first?.alg ?? null,
        `corner ${config.cornerAt}.${config.twist} edge ${config.edgeAt}.${config.flip}: `
        + 'the answer changed when pieces the search does not read were rearranged');
    }
  }
});

test('the search splits its whole domain in two, and the line is where a piece is buried', () => {
  // 384 configurations: 150 the pairing rung places as a pair, 234 it hands to the rung below.
  // The split is not a measurement of how good the trigger set is — it is structural. §7a finding
  // F1: a slot-safe algorithm fixes the protected slots AS POSITIONS, so a piece sitting in one
  // can never leave it, and no algorithm built from these triggers can reach such a pair at all.
  const paired = [];
  const fellBack = [];
  for (const config of EVERY_CONFIGURATION) {
    const step = slotZeroStep(config);
    (step === null || step.parts ? paired : fellBack).push(config);
  }
  assert.equal(paired.length + fellBack.length, 384, 'the domain is not the size this file claims');
  assert.deepEqual(
    { paired: paired.length, fellBack: fellBack.length },
    { paired: 150, fellBack: 234 },
  );
  // The line is exactly burial — not "mostly", and not "the trigger set happens to reach these".
  assert.deepEqual(paired.filter(buried), [], 'a buried pair was solved as a pair, which cannot happen');
  assert.deepEqual(fellBack.filter((c) => !buried(c)), [],
    'a pair with neither piece buried fell back — the trigger set no longer reaches every case');
});

test('no algorithm this rung can build moves a piece out of a protected slot', () => {
  // The mechanism the split rests on, asserted rather than inferred, and the reason the ejection
  // branch was deleted instead of fixed. That branch ran only when the direct search failed —
  // which is only when a piece is buried — and its own goal was to get BOTH pieces into the top
  // layer, which the line below says is unreachable from there. It was not rarely taken. It could
  // not be taken.
  const triggers = PAIRS_ALGS.filter((a) => /^(right|left)(-back|-half)?$/.test(a.name));
  assert.equal(triggers.length, 6, 'the six triggers are not where this test thinks they are');
  // Every slot, in its own frame and against its own protected set — the property has to hold
  // four times over, because the rung searches all four and a rotation is not obviously harmless.
  let checked = 0;
  for (const [slot, pair] of F2L_PAIRS.entries()) {
    const keepCorners = F1L.filter((c) => c !== pair.corner);
    const keepEdges = [...CROSS, ...MIDDLE.filter((e) => e !== pair.edge)];
    for (const candidate of repertoire(triggers, { rotations: [slot] })) {
      assert.ok(slotSafe(candidate.alg, keepCorners, keepEdges, slot),
        `slot ${slot}: "${candidate.alg}" disturbs a slot it must not`);
      checked += 1;
    }
  }
  assert.equal(checked, 96, 'the repertoire is not the size this test thinks it is');
});

test('the reachable configurations are the 41 cases F2L is taught as', () => {
  // Why the fallback rate is what it is, said in the language a learner would use. Folding the
  // four top-layer alignments together — "turn the top until it matches", which is what you do
  // BEFORE you recognise a case — takes the 150 reachable configurations to 42 names, and one of
  // those is the pair already placed. The remaining 41 are the case list, arrived at rather than
  // asserted, and they are exactly the configurations rung 2 could ever hold algorithms for.
  const names = new Set();
  for (const config of EVERY_CONFIGURATION) {
    if (buried(config)) continue;
    names.add(f2lCaseName(configuration(config.cornerAt, config.twist, config.edgeAt, config.flip), 0));
  }
  assert.equal(names.size, 42, `the fold gives ${names.size} names, not the 41 cases plus the solved one`);
  const solved = f2lCaseName(configuration(CORNER.DFR, 0, EDGE.FR, 0), 0);
  assert.ok(names.has(solved), 'the already-placed configuration is not among the names');
  assert.equal(names.size - 1, 41);
});

test('a fallback pair is still placed, and the cube is still legal afterwards', () => {
  // The fallback is not an error path — it is the rung below, doing the job. 234 of 384 take it,
  // so "it works" is most of what this rung does.
  for (const config of EVERY_CONFIGURATION) {
    const state = configuration(config.cornerAt, config.twist, config.edgeAt, config.flip);
    const steps = [];
    const after = PAIRS_RUNGS[1].run(state, steps);
    assert.ok(PAIRS_RUNGS[1].contract(after),
      `corner ${config.cornerAt}.${config.twist} edge ${config.edgeAt}.${config.flip}: `
      + 'the stage did not reach its own contract');
    // The steps replay to the state the stage returned — the same check the driver makes.
    const replayed = { ...replayStage(state, steps).state };
    assert.deepEqual(replayed, after, 'the steps do not add up to the cube the stage returned');
  }
});
