// What a step points at, what it is called, and how the move list is cut into stages.
//
// The renderer half of this — that the focus divide actually lands on the right stickers — is
// browser/method-lesson-render.test.mjs, because it needs WebGL. This file is the half that can
// be asked in plain node: given a step, which selectors does it produce, and do they name pieces
// that exist.
//
// The load-bearing claim of dev-docs/method-solver-return-plan.md §5.2 is that the CUBE carries
// the explanation. A cue that names nothing is that claim silently not happening, which is why
// most of what follows is about coverage rather than about wording.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CORNERS, EDGES, SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { registerLocale, setLocale } from '../lib/i18n.js';
import { parseHighlight } from '../lib/cube-highlight.js';
import {
  CASE_TEXT_KEYS, WHY_KEYS, caseText, lessonCues, lessonSections, moveStepIndex, namedPieces, turnsIn,
  stepAtMove,
  rungSummary, whyText,
} from '../lib/method-lesson.js';
import { wholeCubeSolved } from '../lib/methods/engine.js';
import {
  CASE_NAMES, allRungCombinations, methodFor, rungKey, solveByMethod,
} from '../lib/method-solver.js';
import { seededStates } from './fixtures/seeded-scrambles.mjs';

/** Every step every rung combination can produce, over a fixed sample. */
function everyStep(n = 12, seed = 4242) {
  const steps = [];
  for (const state of seededStates(n, seed)) {
    for (const rungs of allRungCombinations()) {
      const method = methodFor(rungs);
      for (const step of solveByMethod(state, method).steps) steps.push(step);
    }
  }
  return steps;
}

const STEPS = everyStep();

test('every reason the solver can emit has a sentence — none renders as nothing', () => {
  // The wiring check the removed version had, kept: a step with no entry in the table would
  // render as an empty caption, which reads as a step with no reason rather than as a bug.
  const emitted = new Set(STEPS.map((s) => s.why.key));
  const missing = [...emitted].filter((k) => !WHY_KEYS.includes(k));
  assert.deepEqual(missing, [], `reason keys with no sentence: ${missing.join(', ')}`);
  // And the reverse: a sentence for a reason nothing emits is a caption nobody will ever read.
  //
  // With ONE declared exception, and it is declared rather than deleted. `topCorners.permute.step`
  // is the caption for the first of two corner-permutation algorithms. Since the alignment
  // candidate arrived (2026-09-09), a two-algorithm corner case comes out as an ALIGNMENT followed
  // by one algorithm — which is both shorter and a better description — so the key stops occurring:
  // measured over 400 cubes x 4 rung combinations, zero times. It is kept because the look still
  // allows two algorithms and `whyText` now THROWS on a key it cannot caption, so deleting the
  // sentence would turn a rare case into a crash. If a later rung removes the two-ply allowance,
  // delete both together.
  const RARE = ['topCorners.permute.step'];
  const unused = WHY_KEYS.filter((k) => !emitted.has(k) && !RARE.includes(k));
  assert.deepEqual(unused, [], `sentences for reasons no step produces: ${unused.join(', ')}`);
  assert.ok(RARE.length <= 1, 'the unobserved-caption list is growing — say why, or delete them');
  // The exception must still be a real key with a real sentence behind it.
  for (const k of RARE) {
    assert.ok(WHY_KEYS.includes(k), `${k} is listed as rare but has no sentence at all`);
    assert.ok(whyText({ kind: 'case', caseName: 'sune', why: { key: k, corners: [0] } }).length > 0);
  }
  for (const step of STEPS) assert.ok(whyText(step).length > 0, `${step.why.key} captions as nothing`);
});

test('a named algorithm says which case it is; a searched sequence does not', () => {
  // Naming a case a learner can look up is worth doing. Naming one for a sequence the solver
  // searched for would be inventing a case, which is the thing this whole solver refuses.
  const named = STEPS.find((s) => s.kind === 'case' && s.caseName && !s.parts);
  // The name in the READER's words, not the solver's identifier. `corner-cycle-back` is a
  // program's spelling; the sentence ends with whatever `caseText` renders that as, which is
  // also the only form a catalog can translate.
  assert.match(whyText(named), new RegExp(`\\(${caseText(named.caseName)}\\)$`));
  assert.throws(() => whyText({ ...named, caseName: 'no-such-case' }), /no name for case/,
    'an algorithm with no name in the table must fail loudly, not print its identifier');
  const searched = STEPS.find((s) => s.kind === 'goal');
  assert.ok(!/\(/.test(whyText(searched)), 'an intuitive step must not claim a case');
  const pair = STEPS.find((s) => s.parts);
  assert.ok(!/\)$/.test(whyText(pair)),
    'a pair step is named after a POSITION, not an algorithm, so the raw case name is not shown');
});

test('every algorithm the solver can name has a name in the reader\'s language', () => {
  // The case name used to be pasted into the sentence as the solver spells it, so it stayed
  // English however the app was set — the one untranslated fragment inside a translated caption.
  // Both directions, because both are defects: a name with no entry throws where a learner would
  // have seen it, and an entry for a name no table holds is a word nobody will ever read.
  // The NAMED half of the repertoire. The generated tables are keys rather than names — a case
  // this repository numbered itself, which is not the number a learner would find anywhere else —
  // so they are carried on a step and never shown, and a display entry for one would be a word
  // nobody could read.
  const GENERATED = /^(?:oll|pll|f2l):[0-9a-f]+$/;
  const named = CASE_NAMES.filter((n) => !GENERATED.test(n));
  assert.ok(named.length > 20 && named.length < CASE_NAMES.length, 'the split is not what it was');
  assert.deepEqual([...CASE_TEXT_KEYS].sort(), [...named].sort(),
    'the case-name table and the solver\'s named repertoire have drifted apart');
  for (const name of named) {
    assert.ok(caseText(name).length > 0, `${name} renders as nothing`);
  }
  for (const key of CASE_NAMES.filter((n) => GENERATED.test(n))) {
    assert.throws(() => caseText(key), /no name for case/, `${key} is a key and must not be shown`);
  }
  // And it really is `t()`, not a lookup that happens to return English. A catalog is registered
  // over the rendered names and each one asked for again — a name that never reached `t()` comes
  // back unchanged, and the assertion says which.
  const english = new Map(named.map((n) => [n, caseText(n)]));
  registerLocale('qa-cases', Object.fromEntries([...english.values()].map((v, i) => [v, `«${i}»`])));
  try {
    setLocale('qa-cases');
    for (const [name, was] of english) {
      assert.notEqual(caseText(name), was, `the name for ${name} did not go through t()`);
    }
  } finally {
    setLocale('en');
  }
});

test('every step names at least one piece, and every name is a piece that exists', () => {
  // §5.2 is the whole bet: focus and highlight carry the explanation. A step naming nothing is
  // that bet quietly not being placed.
  for (const step of STEPS) {
    const pieces = namedPieces(step);
    assert.ok(pieces.length > 0, `${step.why.key} names no piece — nothing to point at`);
    const { selectors, invalid } = parseHighlight(pieces.join(','));
    assert.equal(invalid, null, `${step.why.key} produced the invalid selector "${invalid}"`);
    assert.equal(selectors.length, pieces.length);
    for (const token of pieces) {
      const letters = token.slice('piece:'.length);
      assert.ok(CORNERS.includes(letters) || EDGES.includes(letters),
        `${step.why.key} named "${letters}", which is not a cubie`);
    }
  }
});

test('focus keeps the centres, highlight does not', () => {
  // Greying the centres turns a cube into a grey box with four coloured stickers on it: the
  // centres are what say which way up it is. They are context, not the subject, so focus keeps
  // them and the pulse stays off them.
  for (const step of STEPS) {
    const { focus, highlight } = lessonCues(step);
    assert.ok(focus.startsWith('centers,'), `${step.why.key}: focus drops the centres`);
    assert.ok(!highlight.includes('centers'), `${step.why.key}: the pulse should not be on the centres`);
    // Plus what the child looks for before the move, where a step names it (plan item 6.2) — the top
    // edges with none of the top colour — and nothing else.
    const looked = (step.why.look ?? []).map((i) => `piece:${EDGES[i]}`).filter((p) => !highlight.split(',').includes(p));
    assert.equal(focus, ['centers', highlight, ...looked].join(','), 'focus is the highlight set plus context, nothing else');
    assert.equal(parseHighlight(focus).invalid, null);
    assert.equal(parseHighlight(highlight).invalid, null);
  }
});

test('a step with no reason produces no cue rather than a cue for nothing', () => {
  assert.deepEqual(lessonCues(undefined), { highlight: '', focus: '' });
  assert.deepEqual(lessonCues({ alg: 'R' }), { highlight: '', focus: '' });
  assert.equal(whyText(undefined), '');
  // '' and 'none' both mean "no selectors", so an empty cue is safe to hand the renderer.
  assert.deepEqual(parseHighlight('').selectors, []);
});

test('a last-layer step names the pieces THAT application is about, not the first one\'s', () => {
  // Three applications of the edge-orient alg are three different cases. Naming all three after
  // the position the first one was in would point at pieces the second and third are not about.
  //
  // **This test stopped testing that and nobody noticed.** Splitting the completing caption from
  // the intermediate ones gave the intermediate applications the key `topCross.orient.step`, so a
  // filter written for `topCross.orient` alone matched at most ONE step per solve and the
  // multi-application branch never ran. Caught by the audit, 2026-09-09. Both keys now, and the
  // number of runs actually compared is asserted rather than assumed.
  let compared = 0;
  for (const state of seededStates(40, 777)) {
    const orients = solveByMethod(state).steps
      .filter((s) => s.why.key === 'topCross.orient' || s.why.key === 'topCross.orient.step');
    if (orients.length < 2) continue;
    compared += 1;
    const named = orients.map((s) => namedPieces(s).join(','));
    assert.equal(new Set(named).size, named.length,
      `two applications of the edge-orient alg named the same pieces: ${named.join(' | ')}`);
    // And the intermediate ones are the ones BEFORE the last: exactly one completing step.
    const completing = orients.filter((s) => s.why.key === 'topCross.orient');
    assert.equal(completing.length, 1, 'a look completes exactly once');
    assert.equal(orients[orients.length - 1].why.key, 'topCross.orient',
      'the completing step must be the last one');
  }
  assert.ok(compared >= 5, `only ${compared} multi-application sequences in the sample — too thin`);
});

test('the move list is cut into the stages the solve actually had', () => {
  // "Actually had" is the whole claim, and it is why this does not demand four sections. A stage
  // whose work is already done produces no steps and therefore no heading — the same rule
  // `recordCleanFollow` follows when it declines to credit a stage the lesson did not contain.
  //
  // **It is not a one-look effect, and the first version of this comment said it was.** Measured
  // over 60 cubes: it happens at EVERY rung combination including `0,0,0,0`, on the same cube, and
  // the missing stage is PLL — a last layer that came out already permuted once the top face was
  // oriented. The over-strict version passed because it sampled five cubes and that one is the
  // fifty-seventh, not because two-look is rarer. So the assertion was latently wrong before any
  // of this work, and widening the sample is what found it.
  // The same fine-grained-stage-to-dial map `method-lesson.js` keeps privately. Written out rather
// than exported: a test that borrowed the module's own table could not catch that table being
// wrong, and this is the file that checks the cutting.
const SECTION_OF = {
  cross: 'cross',
  'first-layer': 'pairs',
  'middle-layer': 'pairs',
  f2l: 'pairs',
  'top-cross': 'oll',
  'top-face': 'oll',
  'top-corners': 'pll',
  'top-edges': 'pll',
};
const dialsSeen = new Set();
  for (const rungs of allRungCombinations()) {
    const method = methodFor(rungs);
    for (const state of seededStates(5, 31337)) {
      const { steps, moveCount } = solveByMethod(state, method);
      const sections = lessonSections(steps);
      assert.ok(sections.length > 0, 'a scrambled cube produced no sections at all');
      // Contiguous, gapless, and covering exactly the moves in the solution. A section boundary
      // that drifted would put a chip under the wrong heading, which is the invented structure
      // this replaced.
      assert.equal(sections[0].from, 0);
      assert.equal(sections[sections.length - 1].to, steps.reduce((n, st) => n + st.alg.trim().split(/\s+/).filter(Boolean).length, 0));
      assert.equal(sections.reduce((n, s) => n + s.moves, 0), moveCount, 'the headings count the lesson\'s face turns, no more and no fewer');
      for (const [i, s] of sections.entries()) {
        if (i > 0) assert.equal(s.from, sections[i - 1].to, 'a gap between sections');
        assert.ok(s.to - s.from >= s.moves, 'a section holds fewer positions than it counts face turns');
        assert.ok(s.steps > 0 && s.name.length > 0);
      }
      assert.equal(sections.reduce((n, s) => n + s.steps, 0), steps.length);
      // The dials appear IN ORDER, however many times the solve returns to one — and a dial that
      // is absent must be absent because the solve had no steps for it, never because a section
      // went missing.
      const DIALS = ['cross', 'pairs', 'oll', 'pll'];
      const order = [...new Set(sections.map((s) => s.id))];
      const inOrder = DIALS.filter((d) => order.includes(d));
      assert.deepEqual(order, inOrder, `the stages came out in the wrong order: ${order.join(' ')}`);
      for (const dial of DIALS) {
        const had = steps.some((st) => SECTION_OF[st.stage] === dial);
        assert.equal(order.includes(dial), had,
          `${dial} ${had ? 'has steps but no heading' : 'has a heading but no steps'}`);
      }
      for (const d of order) dialsSeen.add(d);
    }
  }
  // Absent SOMEWHERE is correct; absent everywhere would mean a dial that never renders.
  assert.deepEqual([...dialsSeen].sort(), ['cross', 'oll', 'pairs', 'pll'],
    'a dial produced no section in any of the 24 rung combinations');
});

test('a stage with no heading is a stage with no work, and the cube is still solved', () => {
  // The other side of the allowance above, and what keeps it from being a hole. A missing heading
  // has to mean the stage had nothing to do — never that a section went missing from a solve that
  // needed it. The cube below is one that produces it: at the rung combinations where its first two
  // layers leave a last layer already permuted after OLL, PLL contributes no steps. (It was the 57th
  // of this draw until the middle layer and the joined pairs began turning the slot to the front —
  // plan items 6.2 and 6.3 — which leaves every cube a different last layer.)
  const [state] = seededStates(60, 31337).slice(28);
  let sawShort = 0;
  for (const rungs of allRungCombinations()) {
    const { steps, alg } = solveByMethod(state, methodFor(rungs));
    const ids = lessonSections(steps).map((s) => s.id);
    if (ids.length === 4) continue;
    sawShort += 1;
    assert.ok(!ids.includes('pll'), `${rungKey(rungs)}: the missing stage is not the one expected`);
    const pllSteps = steps.filter((s) => ['top-corners', 'top-edges'].includes(s.stage));
    assert.deepEqual(pllSteps, [], 'PLL has no heading but produced steps');
    // And the solve is a solve. A stage silently skipped on a cube that needed it would show up
    // here and nowhere else.
    assert.ok(wholeCubeSolved(applyAlg(state, alg)), `${rungKey(rungs)}: the cube is not solved`);
  }
  assert.ok(sawShort > 0, 'the short-section case no longer happens — this test is now vacuous');
});

test('an unknown stage is refused rather than silently folded into the previous section', () => {
  // Moves attributed to the wrong heading is exactly the failure §5.1 exists to end.
  assert.throws(() => lessonSections([{ stage: 'nowhere', alg: 'R', why: { key: 'x' } }]),
    /no section for stage "nowhere"/);
  // Inherited names too. A stage of `constructor` resolves through the prototype to a FUNCTION and
  // `__proto__` to an object, so a guard written as `if (!DIAL_OF[stage])` waves both through and
  // the failure surfaces three lines later as "SECTION_NAME[dial] is not a function" — which names
  // nothing a reader can act on. `cube-highlight.js` records the same lesson about `in`.
  for (const hostile of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.throws(() => lessonSections([{ stage: hostile, alg: 'R', why: { key: 'x' } }]),
      new RegExp(`no section for stage "${hostile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      `a stage named "${hostile}" was not refused by name`);
  }
  // And the same shape on the caption side.
  for (const hostile of ['constructor', '__proto__']) {
    assert.throws(() => whyText({ kind: 'goal', why: { key: hostile } }),
      /no sentence for reason/, `a reason named "${hostile}" was not refused by name`);
  }
});

test('every move knows which step it belongs to', () => {
  for (const state of seededStates(5, 88)) {
    const { steps } = solveByMethod(state);
    const map = moveStepIndex(steps);
    const positions = steps.reduce((n, s) => n + s.alg.trim().split(/\s+/).filter(Boolean).length, 0);
    assert.equal(map.length, positions, 'the map must cover every position of the walk — a regrip is one — and no more');
    // Monotonic: a move cannot belong to an earlier step than the move before it.
    for (let i = 1; i < map.length; i++) assert.ok(map[i] >= map[i - 1]);
    assert.equal(map[0], 0);
    assert.equal(map[map.length - 1], steps.length - 1);
  }
});

test('the rungs in play are named, in plain words', () => {
  const summary = rungSummary(methodFor({ cross: 1, pairs: 1, oll: 0, pll: 0 }));
  assert.equal(summary,
    'Cross: planned whole · First two layers: trigger pairs · Top face: two-look · Last layer: two-look');
  assert.equal(rungSummary(methodFor({ cross: 0, pairs: 0, oll: 0, pll: 0 })),
    'Cross: edge by edge · First two layers: corner, then edge · Top face: two-look · Last layer: two-look');
  assert.equal(rungSummary(null), '', 'no method is no sentence, not "undefined"');
});

test('an empty solve has no sections and no cues', () => {
  const { steps } = solveByMethod(SOLVED);
  assert.deepEqual(steps, []);
  assert.deepEqual(lessonSections(steps), []);
  assert.deepEqual(moveStepIndex(steps), []);
});

test('the cue is about the move about to happen, not the one just made', () => {
  // Two questions of one index. `cubus-step` fires when `made` moves are DONE — the chip row fills
  // to `made` and marks `made - 1` as current, which is the move just performed. The sentence and
  // the highlight are about the move NEXT, and they used to read `map[made - 1]` as well: the
  // first move of every teaching step therefore animated under the previous step's explanation.
  //
  // Three steps of two, three and one move: moves 0-1 belong to step 0, 2-4 to step 1, 5 to step 2.
  const map = moveStepIndex([
    { alg: "R U" },
    { alg: "F R' U" },
    { alg: "D" },
  ]);
  assert.deepEqual(map, [0, 0, 1, 1, 1, 2]);
  // Nothing turned yet: the step about to happen.
  assert.equal(stepAtMove(map, 0), 0);
  assert.equal(stepAtMove(map, 1), 0);
  // TWO moves made, and the third belongs to step 1 — this is the one that used to say 0.
  assert.equal(stepAtMove(map, 2), 1);
  assert.equal(stepAtMove(map, 4), 1);
  // FIVE made, and the sixth is step 2's.
  assert.equal(stepAtMove(map, 5), 2);
  // The walk is over: the last step stays rather than the cue going blank.
  assert.equal(stepAtMove(map, 6), 2);
  assert.equal(stepAtMove(map, 99), 2);
  // A seek backwards past the start is still the first step.
  assert.equal(stepAtMove(map, -1), 0);
  // And a lesson with no moves has no step to point at.
  assert.equal(stepAtMove([], 0), undefined);
  assert.equal(stepAtMove(undefined, 0), undefined);
});

test('a regrip is a position on the walk, but not a move the lesson costs', () => {
  // Plan item 6.1: the chips and the playhead index positions, a regrip among them; the count a heading
  // and the walk say is face turns in the half-turn metric.
  const steps = [
    { stage: 'middle-layer', alg: 'y', why: { key: 'x' } },
    { stage: 'middle-layer', alg: "U R U' R' U' F' U F", why: { key: 'x' } },
  ];
  const [section] = lessonSections(steps);
  assert.deepEqual({ from: section.from, to: section.to, moves: section.moves, steps: section.steps }, { from: 0, to: 9, moves: 8, steps: 2 });
  assert.deepEqual(moveStepIndex(steps), [0, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(turnsIn("y R U R' U' M2"), 6, 'a regrip none, a slice two');
  assert.equal(turnsIn(''), 0);
});
