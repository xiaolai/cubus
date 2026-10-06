// WHAT THE LOOP MAY NOT SAY, because the child it is for cannot use it.
//
// ADR 0008 decision 6. Three refusals, each measured in `dev-docs/teaching-a-five-year-old.md`, and a
// fourth inherited from ADR 0001:
//
//   * A FACE LETTER names nothing a pre-reader can hold, and the letter is not even the hard part —
//     its referent needs a viewpoint change, measured at 39% for a five-year-old against 25% chance,
//     with only 3 of 16 above chance (§1.2).
//   * "CLOCKWISE" is the Rigal operation, measured at 25% on a TWO-WAY choice for ages 5-7. Below
//     chance means systematically inverted, not merely unreliable.
//   * A CONDITIONAL hands the child a state-check: "if the app can see the state, it should resolve
//     the antecedent itself and issue a plain imperative" (§4). This screen can see the state.
//   * BLUE AND YELLOW name nothing fixed — they are the one pair that swaps between the two colour
//     schemes (ADR 0001), so a sentence placing either is true on one child's cube and false on
//     another's.
//
// A refusal nothing enforces is a preference. This is the enforcement, and it reads the words the
// screen can actually show rather than its source at large: every `t(...)` literal, which is the one
// door the app's copy goes through.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { reachable, translatedSentences } from './app-source.mjs';

const read = (url) => readFileSync(url, 'utf8');

/** Every string handed to `t(...)`: the app's one door for words a person reads. Through the shared
 *  reader, which closes a template's holes, joins a concatenation and skips comments — the regex this
 *  file used to carry saw none of the three (audit, 2026-10-06). */
const copyIn = (sources) => sources.flatMap((href) => translatedSentences(read(new URL(href))).map((text) => ({ href, text })));

/** Each refused wording, a sentence that carries it, and what the child cannot do with it. */
const REFUSED = [
  [/(?<![A-Za-z])[UDFBLR](?![A-Za-z])/, 'Turn F twice.',
    'a face letter: the referent needs a viewpoint change, 39% at age five against 25% chance'],
  // `\bclock` cannot match inside "counterclockwise" — there is no word boundary after "counter" —
  // so the commonest American spelling walked straight through the rule that exists to refuse it
  // (audit, 2026-10-06). The alternation now begins at the prefix.
  [/\b(anti|counter)-?\s?clock\s?wise\b|\bclock\s?wise\b|\bwiddershins\b/i, 'Turn the front face clockwise.',
    'face-relative direction: 25% on a two-way choice at 5-7, which is below chance'],
  [/\bif\b|\bunless\b|\botherwise\b/i, 'If the white is underneath, turn it twice.',
    'a conditional: the antecedent is a state-check, and this screen can see the state'],
  [/\bblue\b|\byellow\b/i, 'Turn until the yellow is on top.',
    'a colour that swaps between the two schemes (ADR 0001): true on one cube, false on another'],
];

/**
 * Sentences this screen must never be able to show, kept OUTSIDE the table above.
 *
 * THE TABLE AND ITS OWN EXAMPLES DISAPPEAR TOGETHER. Deleting a rule deletes the sentence that
 * proved it, and `REFUSED = []` passed all three cases — in a file written to stop exactly that
 * class (audit, 2026-10-06). These are the contract; the table is the implementation of it, and the
 * last case drives these through the real sweep so a deleted rule leaves a fixture nothing catches.
 */
const MUST_BE_REFUSED = Object.freeze([
  'Turn F twice.',
  'Turn the front face clockwise.',
  'Turn it counterclockwise.',
  'If the white is underneath, turn it twice.',
  'Unless the white is underneath, turn it twice.',
  'Turn until the yellow is on top.',
  'Put the blue face at the back.',
]);

// The screen's own tree only: a sentence moved one module away is the same sentence on screen, and a
// sentence in a shared SERVICE is not this screen's to hold.
const SOURCES = reachable(['../lib/screens/loop.js'], { within: '/lib/screens/' });

test('the loop screen has copy to check at all', () => {
  assert.ok(SOURCES.length >= 1, 'no source was reached, so the sweep below checks nothing');
  assert.ok(copyIn(SOURCES).length >= 5, 'fewer than five lines of copy found — the extractor is broken');
});

test('the copy reader sees a sentence however it is written, and reads no comment as copy', () => {
  // THE EXTRACTOR IS THE WHOLE GUARD. Three shapes walked straight past the regex this file used to
  // carry — a template, a sentence added up from pieces, and one split across a hole — so a refused
  // wording written in any of them passed a case whose name says it cannot (audit, 2026-10-06). And
  // the other direction, which is how a guard goes quietly false: a commented-out line is not copy
  // the screen can show, and counting it would make the refusals fire on words nobody can read.
  const seen = (src) => translatedSentences(src);
  assert.deepEqual(seen("t('Turn it once.')"), ['Turn it once.'], 'a plain literal');
  assert.deepEqual(seen('t(`Turn it once.`)'), ['Turn it once.'], 'a template literal was invisible');
  // The hole itself joins as a space, so the two parts keep their own: what is read is what stays
  // FIXED in the sentence, never the value that fills the gap.
  assert.deepEqual(seen('t(`Turn the ${side} face.`)'), ['Turn the   face.'], 'a hole split the sentence in two');
  assert.deepEqual(seen("t('Turn the ' + side + ' face.')"), ['Turn the   face.'], 'an addition was read as two');
  assert.deepEqual(seen("t('Turn the ' + a + b + ' face.')"), ['Turn the   face.'], 'two names between the pieces split it');
  assert.deepEqual(seen("// t('Turn F twice.')\nconst x = 1;"), [], 'a commented-out line counted as copy');
  assert.deepEqual(seen("const sel = '[data-nav=\"loop\"]';"), [], 'a string the code holds is not copy');
  // And the refusals must fire on what the reader returns, not only on what a regex returned: the
  // two halves are useless apart.
  assert.ok(REFUSED.some(([p]) => p.test(seen('t(`Turn the F face.`)')[0])), 'a refused word inside a template got through');
});

test('no sentence the loop can show names a face letter, a direction, a condition or a swapping colour', () => {
  const copy = copyIn(SOURCES);
  const found = [];
  for (const { href, text } of copy) {
    for (const [pattern, , why] of REFUSED) {
      if (pattern.test(text)) found.push(`${href.split('/apps/web/')[1]}: ${JSON.stringify(text)} — ${why}`);
    }
  }
  assert.deepEqual(found, [], `the loop says something the child it is for cannot use:\n  ${found.join('\n  ')}`);
});

test('each refusal would catch the sentence it was written for', () => {
  // THE SWEEP ABOVE PASSES ON AN EMPTY SET AND ON A PATTERN THAT MATCHES NOTHING. Each refusal
  // carries the sentence that produced it, and must still catch it.
  assert.ok(REFUSED.length >= 4, 'the refusal table has been emptied, so the sweep checks nothing');
  for (const [pattern, sentence, why] of REFUSED) {
    assert.ok(pattern.test(sentence), `the refusal for "${why}" no longer catches ${JSON.stringify(sentence)}`);
  }
});

test('every sentence the contract forbids is caught by the table as it stands', () => {
  // The half that does not vanish with a rule. Each of these is refused by the CONTRACT; if the
  // table stops catching one, the table is wrong — and deleting the rule cannot delete the fixture,
  // because the fixture does not live in the table.
  const missed = MUST_BE_REFUSED.filter((line) => !REFUSED.some(([pattern]) => pattern.test(line)));
  assert.deepEqual(missed, [], `the loop could now show these:\n  ${missed.join('\n  ')}`);
});
