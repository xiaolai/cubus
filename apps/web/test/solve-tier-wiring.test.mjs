// The Settings screen offers a solution-length target, and app.js has to keep three things in
// step with lib/solve-target.js: a label per rung, a stored setting the solver actually reads,
// and a cached solution that is thrown away when the target changes. Each of those breaks
// silently — an unlabelled rung renders "undefined", an unread setting means the pills do
// nothing, and a kept cache means the old answer stands under the new target.

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
  // 18 moves do not exist for every position. Printing just the number would present a 19-move
  // answer as if it had met the target.
  assert.match(app, /targetMissed/, 'app.js must handle the missed-target verdict');
  assert.match(app, /was not possible here/, 'and say so on the screen');
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
  // moved to the vendored min2phase. Leaving the old call in would mean two solvers disagreeing.
  assert.doesNotMatch(app, /experimentalSolve3x3x3IgnoringCenters/,
    'app.js still calls cubing.js to solve');
  assert.match(app, /createSolveClient/, 'and must use the worker client instead');
});
