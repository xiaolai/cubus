// What a chip is allowed to say — and the sentence it may never say.
//
// Plan §6 of dev-docs/solve-to-state-plan.md gives five chip states and four sentences.
// `lib/stage-report.js` is the only place either exists, so this file is where they are held to
// what they claim. Three kinds of assertion, in the order they matter:
//
//   1. THE FORBIDDEN SENTENCE. The first draft of §6 offered "no short way back" for the
//      out-of-budget case. Budget exhaustion does not establish that no short repair exists, so
//      that is a claim about the CUBE made from a fact about the SEARCH — the same rule
//      `solve-tier-wiring.test.mjs` already enforces for move counts. Scanned, not reviewed.
//   2. THE CLAIM. Exactly one state may call itself the shortest, and it is reachable only from an
//      answer that says it is minimal. A fallback with the same move count says something else.
//   3. THE FIVE STATES, each from the input that produces it, so a state nobody can reach — or two
//      inputs collapsing onto one state — fails here rather than on a screen.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CHIP, STAGE_COPY, chipFor, chipLabel, routeSentence } from '../lib/stage-report.js';
import { OFFERED_TARGETS, targetById } from '../lib/stage-targets.js';

const source = readFileSync(new URL('../lib/stage-report.js', import.meta.url), 'utf8');
const TOP_CROSS = targetById('top-cross');

/** Every sentence the module can produce, with plausible arguments. */
const everySentence = () => [
  STAGE_COPY.shortest(1), STAGE_COPY.shortest(11),
  STAGE_COPY.route(1), STAGE_COPY.route(11),
  STAGE_COPY.overshoot('top cross', 18),
  STAGE_COPY.atLeast(1), STAGE_COPY.atLeast(6),
  STAGE_COPY.done(), STAGE_COPY.already('top cross'), STAGE_COPY.unknown(), STAGE_COPY.offerSolve(),
  routeSentence({ moves: 0, minimal: true, overshoot: false }, TOP_CROSS),
  routeSentence(null, TOP_CROSS),
  routeSentence({ moves: null }, TOP_CROSS),
  routeSentence({ moves: 4, minimal: true, overshoot: false }, TOP_CROSS),
  routeSentence({ moves: 11, minimal: false, overshoot: false }, TOP_CROSS),
  routeSentence({ moves: 18, minimal: false, overshoot: true }, TOP_CROSS),
  ...OFFERED_TARGETS.flatMap((target) => [
    chipLabel(chipFor({ target, atTarget: true })),
    chipLabel(chipFor({ target, bound: 3 })),
    chipLabel(chipFor({ target, bound: 3, answer: { moves: 5, minimal: true } })),
    chipLabel(chipFor({ target, bound: 3, answer: { moves: 9, minimal: false } })),
    chipLabel(chipFor({ target, bound: 3, answer: { moves: null } })),
  ]),
];

// ---- 1. the forbidden sentence -------------------------------------------------------------------

test('nothing this module can say is a claim about the cube', () => {
  // A REFUSAL IS A STATEMENT ABOUT THE SEARCH. No sentence may assert that a repair does not
  // exist, is impossible, or cannot be found — budget exhaustion establishes none of those, and
  // the plan calls "no short way back" the forbidden sentence by name.
  const FORBIDDEN = [
    /no (?:short|shorter|way|route)/i,
    /\bimpossible\b/i,
    /cannot be (?:done|solved|repaired|reached)/i,
    /there is no\b/i,
    /\bunsolvable\b/i,
  ];
  for (const sentence of everySentence()) {
    for (const pattern of FORBIDDEN) {
      assert.ok(!pattern.test(sentence),
        `"${sentence}" asserts something about the cube that a search running out of budget cannot establish`);
    }
  }
  // …and the same over the SOURCE, so a sentence added without a call site is caught too. The
  // literals are read rather than the whole file, or every comment explaining the rule would fail it.
  const literals = [...source.matchAll(/t\('([^']*)'/g)].map((m) => m[1]);
  assert.ok(literals.length >= 8, `only ${literals.length} translatable strings found — the scan is not reading the file`);
  for (const literal of literals) {
    for (const pattern of FORBIDDEN) {
      assert.ok(!pattern.test(literal), `the source string "${literal}" is a claim about the cube`);
    }
  }
});

test("the out-of-budget sentence is about the search, and offers the way out", () => {
  assert.match(STAGE_COPY.unknown(), /couldn’t work one out/,
    'the honest form: nobody worked a repair out, which says nothing about whether one exists');
  assert.match(STAGE_COPY.offerSolve(), /solve the whole cube/,
    'a dash without an offer leaves a child with nothing to press');
});

// ---- 2. the claim ----------------------------------------------------------------------------------

test('exactly one sentence claims a minimum, and only a minimal answer reaches it', () => {
  const claims = everySentence().filter((s) => /shortest/i.test(s));
  assert.ok(claims.length > 0, 'the claim must be sayable, or the exact search buys nothing');
  for (const claim of claims) assert.match(claim, /the shortest way back/, 'one phrasing, so one thing to scan for');

  // The only route shape that can produce it.
  assert.match(routeSentence({ moves: 4, minimal: true, overshoot: false }, TOP_CROSS), /shortest/);
  assert.doesNotMatch(routeSentence({ moves: 4, minimal: false, overshoot: false }, TOP_CROSS), /shortest/,
    'a fallback of the same length says something weaker, and must be worded that way');
  assert.doesNotMatch(routeSentence({ moves: 18, minimal: false, overshoot: true }, TOP_CROSS), /shortest/);
  assert.doesNotMatch(routeSentence({ moves: null }, TOP_CROSS), /shortest/);
});

test('a cube already at the target is told so, not handed a route of length zero', () => {
  // §9a: "an empty route must never render as a walk", and the first thing that has to stop is
  // calling it a route. `routeSentence` returned "the shortest way back — 0 moves" until this case
  // existed — technically true, and a child reads a move count and looks for moves.
  const said = routeSentence({ moves: 0, minimal: true, overshoot: false }, TOP_CROSS);
  assert.equal(said, 'your cube is already at the top cross');
  assert.doesNotMatch(said, /shortest|0 moves/,
    'zero is not a length, and it must not come out as a minimality claim about no moves at all');
  // The check runs BEFORE the claim branch, so it cannot be reached by a route that says it is
  // minimal — which every zero-length route does, being trivially the shortest.
  assert.equal(routeSentence({ moves: 0, minimal: false, overshoot: true }, TOP_CROSS), said,
    'and it does not matter which flags a zero-length route happens to carry');
});

test('an overshooting fallback SAYS so rather than presenting itself as the target', () => {
  const said = routeSentence({ moves: 18, minimal: false, overshoot: true }, TOP_CROSS);
  assert.match(said, /couldn’t find a short way back to the top cross/,
    'the plan pins this wording: it names the target it did not reach');
  assert.match(said, /the whole cube in 18/, 'and says what the answer actually does');
});

// ---- 3. the five states ------------------------------------------------------------------------------

test('each of the five chip states comes from exactly one input', () => {
  const target = TOP_CROSS;
  const cases = [
    ['already there', { target, bound: 0, atTarget: true }, CHIP.DONE, 'done'],
    ['a finished exact search', { target, bound: 3, answer: { moves: 5, minimal: true } }, CHIP.EXACT, '5'],
    ['a fallback route', { target, bound: 3, answer: { moves: 9, minimal: false } }, CHIP.ROUTE, '9'],
    ['a bound and no answer yet', { target, bound: 3 }, CHIP.BOUND, '≥ 3'],
    ['a search that found nothing', { target, bound: 3, answer: { moves: null } }, CHIP.DASH, '—'],
    ['no bound at all', { target }, CHIP.DASH, '—'],
  ];
  const seen = new Set();
  for (const [why, input, state, text] of cases) {
    const chip = chipFor(input);
    assert.equal(chip.state, state, `${why} must produce the ${state} chip`);
    assert.equal(chip.text, text, `${why}: the chip reads "${chip.text}"`);
    seen.add(state);
  }
  assert.equal(seen.size, 5, 'all five states must be reachable, or one of them is dead');
  assert.deepEqual([...seen].sort(), Object.values(CHIP).sort(), 'and they must be the five the module names');
});

test('a bound is labelled a bound every time it is shown', () => {
  // §6: a bound that later becomes a different exact number is acceptable and is NOT the
  // "working…" defect the repository fixed before — PROVIDED it is labelled as a bound throughout.
  // A bare number would be a distance, and refining a distance is a contradiction.
  const chip = chipFor({ target: TOP_CROSS, bound: 6 });
  assert.match(chip.text, /^≥/, 'the chip face must carry the inequality, not just the tooltip');
  assert.match(chipLabel(chip), /at least 6 moves/, 'and the accessible name must say it in words');
  assert.equal(chip.minimal, false, 'a bound is never a claim');
});

test('every chip says which kind of fact it is, in words, for a reader who cannot see it', () => {
  // The five states are "visually distinct" in the plan's phrasing, and a state carried by colour
  // alone is not distinct to everybody. Each label must name its target AND its kind.
  const target = TOP_CROSS;
  const labels = [
    chipLabel(chipFor({ target, atTarget: true })),
    chipLabel(chipFor({ target, bound: 3 })),
    chipLabel(chipFor({ target, bound: 3, answer: { moves: 5, minimal: true } })),
    chipLabel(chipFor({ target, bound: 3, answer: { moves: 9, minimal: false } })),
    chipLabel(chipFor({ target, bound: 3, answer: { moves: null } })),
  ];
  for (const label of labels) assert.match(label, /^top cross: /, 'a label without its target names nothing');
  assert.equal(new Set(labels).size, labels.length, 'two states reading the same is two states nobody can tell apart');
});

test('a chip knows its target by name, and every offered target can produce one', () => {
  for (const target of OFFERED_TARGETS) {
    const chip = chipFor({ target, bound: 2 });
    assert.equal(chip.name, target.name);
    assert.ok(chipLabel(chip).includes(target.name), `${target.id}: the label must name it`);
  }
});
