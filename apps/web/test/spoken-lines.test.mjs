// The scan's spoken lines, edited by hand (2026-09-20).
//
// The owner asked for the list after finding the voice repetitive, so what this file protects is the
// thing an editable line can quietly break: a line that is WRONG is still said, to a child, on every
// scan. `spokenLines()` is therefore a filter rather than a merge — it drops what it cannot use and
// falls back to the default — and the Settings card refuses the same edits out loud, through the
// same function, so the card and the voice cannot come to disagree about what is usable.

import assert from 'node:assert/strict';
import { test } from 'node:test';

const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
};
const { LINE_LIMIT, SPOKEN, lineFor, spokenLines } = await import('../lib/screens/scan/spoken.js');
const { LINE_LABEL, refuse } = await import('../lib/screens/settings/spoken-lines.js');

test('every line the scan can say is one the list can edit, and nothing else is', () => {
  // A key with no label would be a row headed "undefined"; a label with no key would be a row that
  // edits nothing. Both are invisible until someone opens the card, which is why this is a test.
  assert.deepEqual(Object.keys(LINE_LABEL).sort(), Object.keys(SPOKEN).sort());
});

test('an edit is used, and the default is what an absent one falls back to', () => {
  const edited = spokenLines({ open: 'Hold up any side.' });
  assert.equal(edited.open, 'Hold up any side.');
  assert.equal(edited.done, SPOKEN.done, 'an unedited line stopped being the default');
  // Trimmed, because a trailing space is not an edit and a line is compared against the default to
  // decide whether it is one.
  assert.equal(spokenLines({ open: '  Hold up any side.  ' }).open, 'Hold up any side.');
  assert.deepEqual(spokenLines({}), { ...SPOKEN }, 'no edits did not leave the defaults alone');
  assert.deepEqual(spokenLines(null), { ...SPOKEN });
});

test('an edit that cannot be used is dropped, and the default is said instead', () => {
  const cases = [
    ['a key the app does not have', { nonsense: 'x' }, null],
    ['a value that is not a string', { open: 7 }, 'open'],
    ['an empty line', { open: '   ' }, 'open'],
    ['a line past the limit', { open: 'x'.repeat(LINE_LIMIT + 1) }, 'open'],
    // The one that would speak nonsense rather than nothing: "Got it! more sides." for the rest of
    // the scan. A dropped placeholder is the only edit whose damage is invisible in the card.
    ['a count line that dropped its placeholder', { savedMany: 'Got it! more sides.' }, 'savedMany'],
  ];
  for (const [why, edits, key] of cases) {
    const lines = spokenLines(edits);
    if (key) assert.equal(lines[key], SPOKEN[key], `${why} was believed`);
    assert.deepEqual({ ...lines }, { ...SPOKEN }, `${why} changed a line`);
  }
  // Exactly AT the limit is usable: the rule is a limit, not a margin.
  const atLimit = 'y'.repeat(LINE_LIMIT);
  assert.equal(spokenLines({ open: atLimit }).open, atLimit);
});

test('a placeholder is read, not searched for', () => {
  // `includes('%1')` accepted three lines that speak nonsense to a child (audit, 2026-09-20).
  const cases = [
    ['%10 substitutes the count and leaves the zero — five sides announced as fifty', 'Got it! %10 more.'],
    ['a parameter the line is never given is spoken aloud as "percent nine"', 'Got it! %9 more.'],
    ['two placeholders where one is supplied leaves the other in the sentence', 'Got it! %1 of %2 more.'],
  ];
  for (const [why, line] of cases) {
    assert.equal(spokenLines({ savedMany: line }).savedMany, SPOKEN.savedMany, why);
    assert.ok(refuse('savedMany', line), `the card accepted a line the voice drops: ${why}`);
  }
  // A line with the same placeholder twice is fine — the set matches, and %1 may be repeated.
  assert.equal(spokenLines({ savedMany: '%1 more — just %1 more.' }).savedMany, '%1 more — just %1 more.');
  // And a line with NO placeholder may not gain one: nothing would be substituted into it.
  assert.equal(spokenLines({ done: 'All done, %1!' }).done, SPOKEN.done);
  assert.ok(refuse('done', 'All done, %1!'), 'a placeholder was added to a line given no parameter');
});

test('the card refuses exactly what the voice drops, and says why', () => {
  // Same rules, asked of the same function — the card cannot drift into accepting a line the voice
  // will not say, which would look like an edit that did not stick.
  assert.equal(refuse('open', 'Hold up any side.'), null);
  assert.equal(refuse('savedMany', 'Got it! %1 to go.'), null);
  assert.ok(refuse('open', '   '), 'an empty line was accepted');
  assert.ok(refuse('open', 'x'.repeat(LINE_LIMIT + 1)), 'a line past the limit was accepted');
  assert.ok(refuse('savedMany', 'Got it! more sides.'), 'a count line with no placeholder was accepted');
  // A line the default has no placeholder in may of course contain none.
  assert.equal(refuse('done', 'Finished!'), null);
});

test('a line is resolved by NAME when it is said, so an edit does not wait for a reload', () => {
  const { settings } = globalThis;
  assert.equal(lineFor('open'), SPOKEN.open);
  // `lineFor` reads the live record, which is what makes an edit apply to the next line spoken
  // rather than the next launch.
  assert.equal(typeof lineFor('savedMany'), 'string');
  assert.ok(lineFor('savedMany').includes('%1'), 'the count line lost its placeholder');
  assert.equal(settings, undefined, 'this test leaked a global');
});
