// The target, drawn — and the one way that drawing can be wrong.
//
// Plan §6 wants the target on screen with its free pieces ghosted, because the shortest way back to
// the top cross may break the cross on the way and a child who cannot see what they are aiming at
// reads that as a broken app. `lib/stage-picture.js` derives the picture STRUCTURALLY, from which
// projections a target reads; this file checks that derivation against cubes.
//
// THE ASYMMETRY IS THE WHOLE DESIGN, and every case here is built on it:
//
//   over-claiming  the picture shows a colour on a sticker the target leaves free. WRONG — it
//                  points a child at a cube that is not the one they are being sent to.
//   under-claiming the picture greys a sticker the target actually fixes. Merely less useful.
//
// So the pinning in that module is conservative by construction, and the cases below hunt for
// over-claims by generating real states inside each target and requiring the picture to agree with
// every one of them. An under-claim shows up as a count, reported rather than failed — except where
// a specific pin is the point of the target, which is named.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { toFacelets } from '../lib/two-phase.js';
import { TARGETS, targetById } from '../lib/stage-targets.js';
import { UNKNOWN, pinnedCount, targetPicture } from '../lib/stage-picture.js';
import { solveByMethod } from '../lib/method-solver.js';
import { seededScrambles } from './fixtures/seeded-scrambles.mjs';

/**
 * Real states inside `target`, produced without reference to the picture.
 *
 * Two sources, because no single one reaches every target. The app's own method route passes
 * through the five stage targets and `solved`; the six-sided cross is reached by conjugating a
 * corner-only commutator, which leaves every edge exactly where it was.
 */
function statesIn(target) {
  const out = [];
  if (target.id === 'six-cross') {
    const C = "R' D' R U R' D R U'";
    const inv = (alg) => alg.trim().split(/\s+/).reverse()
      .map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`)).join(' ');
    for (const x of seededScrambles(16, 0x6c17, 7)) out.push(applyAlg(SOLVED, `${x} ${C} ${inv(x)}`));
    // …and combinations of two, so the corner permutation is not always a single 3-cycle.
    for (const x of seededScrambles(8, 0x6c18, 5)) {
      out.push(applyAlg(SOLVED, `${x} ${C} ${inv(x)} ${C}`));
    }
    return out;
  }
  return ROUTE.filter((s) => target.verify(s));
}

/**
 * Every state along the app's own method route, built ONCE.
 *
 * Per target it was twenty `solveByMethod` calls, seven times over — 33 seconds for a file whose
 * other three cases cost two milliseconds between them. One pool of route states, filtered per
 * target, is the same evidence: a state that satisfies `top-cross` is a `top-cross` state however
 * it was reached.
 */
const ROUTE = (() => {
  const out = [];
  for (const scramble of seededScrambles(20, 0x6c19, 14)) {
    let s = applyAlg(SOLVED, scramble);
    let lesson;
    try { lesson = solveByMethod(s); } catch { continue; }
    for (const step of lesson.steps) {
      s = applyAlg(s, step.alg);
      out.push(s);
    }
  }
  return out;
})();

test('no picture ever claims a sticker its target leaves free', () => {
  // The failure that matters, hunted directly: for every target, every sticker the picture pins
  // must carry that colour in EVERY state of the target. One disagreement is a picture pointing a
  // child at a cube they are not being sent to.
  for (const target of TARGETS) {
    const picture = targetPicture(target);
    const states = statesIn(target);
    assert.ok(states.length >= (target.id === 'solved' ? 1 : 8),
      `${target.id}: only ${states.length} states to check the picture against`);
    for (const state of states) {
      assert.ok(target.verify(state), `${target.id}: the generator produced a cube outside the target`);
      const facelets = toFacelets(state);
      for (let i = 0; i < 54; i++) {
        if (picture[i] === UNKNOWN) continue;
        assert.equal(picture[i], facelets[i],
          `${target.id}: the picture claims ${picture[i]} at facelet ${i}, and a cube in the target`
          + ` shows ${facelets[i]} there — the drawing would send a child to a cube that is not the target`);
      }
    }
  }
});

test('the pictures pin what each target is actually about', () => {
  // Under-claiming is not wrong, but it is not free either: a `two-layers` picture with the middle
  // layer greyed would be honest and useless. These counts are the shape of each target, and they
  // are named so a change to the pinning rules has to be deliberate.
  const EXPECTED = {
    cross: 14,           // six centres, the four D-face cross stickers, their four side stickers
    'first-layer': 26,   // the whole D face and the bottom row of every side
    'two-layers': 34,    // and the middle row of every side
    'top-cross': 38,     // and the four U-face cross stickers — the flip precondition earning its keep
    'corners-home': 38,  // the same: a corner in its own slot with a free twist shows no fixed sticker
    'six-cross': 30,     // six centres and all 24 edge stickers — a plus on every face
    solved: 54,
  };
  for (const target of TARGETS) {
    assert.equal(pinnedCount(target), EXPECTED[target.id], `${target.id}: pinned sticker count`);
  }
  // The one that would be silently lost: `top-cross` pins four MORE stickers than `two-layers`, and
  // only because the flip goal's precondition holds. A rule that stopped checking the precondition
  // would still pass the over-claim case above on these targets, so the gap is asserted here.
  assert.equal(pinnedCount('top-cross') - pinnedCount('two-layers'), 4,
    'the top cross must show its four U stickers, or the picture is a `two-layers` picture');
});

test('the flip pin is refused where its precondition does not hold', () => {
  // The other direction, and the reason `stage-picture.js` checks rather than assumes. A target
  // that reads `flip` WITHOUT pinning the bottom eight edges cannot conclude anything about a U
  // slot's occupant, so it must not paint one.
  const flip = targetById('top-cross').projections.find((p) => p.kind === 'flip');
  assert.ok(flip, 'top-cross must read the flip projection, or this case is about nothing');
  const crossOnly = targetById('cross');
  const loose = {
    id: 'flip-without-precondition',
    projections: [...crossOnly.projections, flip],
    verify: crossOnly.verify,
  };
  const picture = targetPicture(loose);
  const U_PRIMARY = [5, 7, 3, 1]; // EDGE_FACELETS[0..3][0] — the U-facing sticker of each U slot
  for (const at of U_PRIMARY) {
    assert.equal(picture[at], UNKNOWN,
      'with the bottom eight edges unpinned, a U slot can hold a D edge and the U sticker is not `U`');
  }
  // And with the precondition, the same projection does pin them — so the refusal above is about
  // the precondition and not about the rule being dead.
  const tight = targetPicture('top-cross');
  for (const at of U_PRIMARY) assert.equal(tight[at], 'U');
});

test('a picture is a legal facelet string the renderer can take', () => {
  for (const target of TARGETS) {
    const picture = targetPicture(target);
    assert.equal(picture.length, 54, `${target.id}: a facelet string is 54 characters`);
    assert.match(picture, /^[URFDLB?]{54}$/, `${target.id}: only face letters and the unknown mark`);
    // The centres are the colour frame and no cube can move them, so every picture shows all six.
    for (const [i, at] of [4, 13, 22, 31, 40, 49].entries()) {
      assert.equal(picture[at], 'URFDLB'[i], `${target.id}: centre ${at} must always be drawn`);
    }
  }
  assert.equal(targetPicture('solved'), toFacelets(SOLVED), 'the solved picture is the solved cube');
});
