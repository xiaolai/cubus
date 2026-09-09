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
import { parseHighlight } from '../lib/cube-highlight.js';
import {
  WHY_KEYS, lessonCues, lessonSections, moveStepIndex, namedPieces, rungSummary, whyText,
} from '../lib/method-lesson.js';
import { allRungCombinations, methodFor, solveByMethod } from '../lib/method-solver.js';

/** Deterministic scrambles — the same generator the rest of the suite uses. */
function seededStates(count, seed) {
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
  const suffix = ['', "'", '2'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const alg = [];
    let prev = -1;
    while (alg.length < 30) {
      const f = Math.floor(rnd() * 6);
      if (f === prev) continue;
      prev = f;
      alg.push(faces[f] + suffix[Math.floor(rnd() * 3)]);
    }
    out.push(applyAlg(SOLVED, alg.join(' ')));
  }
  return out;
}

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
    assert.ok(whyText({ kind: 'case', caseName: 'x', why: { key: k, corners: [0] } }).length > 0);
  }
  for (const step of STEPS) assert.ok(whyText(step).length > 0, `${step.why.key} captions as nothing`);
});

test('a named algorithm says which case it is; a searched sequence does not', () => {
  // Naming a case a learner can look up is worth doing. Naming one for a sequence the solver
  // searched for would be inventing a case, which is the thing this whole solver refuses.
  const named = STEPS.find((s) => s.kind === 'case' && s.caseName && !s.parts);
  assert.match(whyText(named), new RegExp(`\\(${named.caseName}\\)$`));
  const searched = STEPS.find((s) => s.kind === 'goal');
  assert.ok(!/\(/.test(whyText(searched)), 'an intuitive step must not claim a case');
  const pair = STEPS.find((s) => s.parts);
  assert.ok(!/\)$/.test(whyText(pair)),
    'a pair step is named after a POSITION, not an algorithm, so the raw case name is not shown');
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
    assert.equal(focus, `centers,${highlight}`, 'focus is the highlight set plus context, nothing else');
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
  for (const rungs of allRungCombinations()) {
    const method = methodFor(rungs);
    for (const state of seededStates(5, 31337)) {
      const { steps, moveCount } = solveByMethod(state, method);
      const sections = lessonSections(steps);
      assert.ok(sections.length >= 4, `only ${sections.length} sections — a stage went missing`);
      // Contiguous, gapless, and covering exactly the moves in the solution. A section boundary
      // that drifted would put a chip under the wrong heading, which is the invented structure
      // this replaced.
      assert.equal(sections[0].from, 0);
      assert.equal(sections[sections.length - 1].to, moveCount);
      for (const [i, s] of sections.entries()) {
        if (i > 0) assert.equal(s.from, sections[i - 1].to, 'a gap between sections');
        assert.equal(s.to - s.from, s.moves);
        assert.ok(s.steps > 0 && s.name.length > 0);
      }
      assert.equal(sections.reduce((n, s) => n + s.steps, 0), steps.length);
      // The four dials appear in order, however many times the solve returns to one.
      const order = [...new Set(sections.map((s) => s.id))];
      assert.deepEqual(order, ['cross', 'pairs', 'oll', 'pll']);
    }
  }
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
    const { steps, moveCount } = solveByMethod(state);
    const map = moveStepIndex(steps);
    assert.equal(map.length, moveCount, 'the map must cover every move and no more');
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
