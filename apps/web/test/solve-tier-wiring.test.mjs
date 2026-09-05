// The Settings screen offers exactly one solver choice — a solution-length target — and
// app.js has to keep three things in step with lib/solve-target.js: a label per rung, a stored
// setting the solver actually reads, and a cached solution that is thrown away when the target
// changes. Each of those breaks silently — an unlabelled rung renders "undefined", an unread
// setting means the pills do nothing, and a kept cache means the old answer stands under the
// new target. (The explaining solver and its reason line were removed 2026-08-29 — the owner's
// call: the explanations did not reduce a learner's burden. History: git, and the AGENTS.md
// solver bullet.)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { TIERS } from '../lib/solve-target.js';

const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');

test('every rung has a label and a description on the Settings screen', () => {
  const labels = app.match(/const TIER_LABEL = \{([^}]*)\}/)?.[1] ?? '';
  const blurbs = app.match(/const TIER_BLURB = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  for (const { name } of TIERS) {
    assert.match(labels, new RegExp(`\\b${name}\\s*:`), `no pill label for the "${name}" rung`);
    assert.match(blurbs, new RegExp(`\\b${name}\\s*:`), `no description for the "${name}" rung`);
  }
});

test('the chosen target is stored, and the solver reads it', () => {
  assert.match(app, /solveTier: 'twenty'/, 'the setting must have a default, or the first solve is untargeted');
  assert.match(app, /tier: settings\.solveTier/, 'solve() must read the stored tier, not a hardcoded one');
  assert.match(app, /data-set-tier/, 'the Settings screen must offer the pills');
});

test('changing the target throws away the answer computed under the old one', () => {
  // Without this the pills look like they do nothing: the cached solution short-circuits
  // solve(), so the move count never changes and the setting appears to be ignored.
  const handler = app.match(/data-set-tier\]'\)\)[^\n]*\n?[^\n]*/)?.[0] ?? '';
  assert.match(handler, /solution = ''/, 'the cached solution must be cleared when the tier changes');
  assert.match(handler, /solveResult = null/, 'and so must its verdict');
});

test('a missed target is said out loud rather than shown as a plain count', () => {
  // Printing just the number would present a 19-move answer as if it had met the target.
  assert.match(app, /targetMissed/, 'app.js must handle the missed-target verdict');
  assert.match(app, /couldn't get to \$\{verdict\.target\}/, 'and say so on the screen');
});

test('a shortfall is never dressed up as an impossibility', () => {
  // The sentence this replaces was "N was not possible here". Two-phase cannot prove a minimum,
  // so it cannot prove one absent either (solver-move-count.md section 4) — and at the <= 20
  // tier God's number makes the claim flatly false. Measured on 30 random states: the <= 18
  // tier fell short 19 times while only ~3.5% of positions are genuinely optimal-19-or-20.
  //
  // Comments are stripped first, on purpose: the history of the wording is worth keeping in the
  // source, and a test that could not tell a comment from a string would forbid recording it.
  //
  // THREE phrasings were forbidden until 2026-09-04, and a rule with three spellings is a rule
  // about spellings: "18 cannot be done here" and "no shorter solution exists" say the same
  // false thing and both passed. The list below is not exhaustive either — no list is — but it
  // covers the ways this sentence has actually been written, and each of them is a claim about
  // the CUBE made by a search that only knows about its own budget.
  const withoutComments = app
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/([^:'"`])\/\/[^\n]*/g, '$1');
  // PROVE_COPY is removed by name, and it is the one region that may say it: a NATIVE proof
  // really does establish that no shorter solution exists — that is the whole of the fourth
  // seam, and optimal.test.mjs pins that block as one of exactly three places allowed to make a
  // minimality claim. This sweep is about what the SEARCH may say. Removing it by name rather
  // than choosing a regex it slips under keeps both rules legible.
  const proveCopy = withoutComments.match(/const PROVE_COPY = \{[\s\S]*?\n\};/)?.[0] ?? '';
  assert.ok(proveCopy, 'PROVE_COPY must still exist and be named — see optimal.test.mjs');
  const screens = withoutComments.replace(proveCopy, '');
  assert.doesNotMatch(
    screens,
    /not possible|impossible|cannot be done|can't be done|no shorter[^.]{0,30}exists?|can't exist|cannot exist|does not exist/i,
    'no screen may state that a move count is impossible — the search cannot know that',
  );
});

test('the solution is cleared alongside its verdict everywhere', () => {
  // A stale verdict outliving its solution would caption a new answer with the old outcome.
  const clears = [...app.matchAll(/c\.solution = ''/g)];
  assert.ok(clears.length > 0);
  for (const m of clears) {
    const line = app.slice(m.index, app.indexOf('\n', m.index));
    assert.match(line, /solveResult = null/, `"${line.trim()}" clears the solution but keeps its verdict`);
  }
});

test('the solver no longer routes through cubing.js', () => {
  // cubing's API cannot express a length bound, progressive results or cancellation, so solving
  // moved to the two-phase engine. Leaving the old call in would mean two solvers disagreeing.
  assert.doesNotMatch(app, /experimentalSolve3x3x3IgnoringCenters/,
    'app.js still calls cubing.js to solve');
  assert.match(app, /createSolveClient/, 'and must use the worker client instead');
});





