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

test('every reason the solver can emit has a sentence behind it', () => {
  // A step whose key has no entry renders as an empty line: the learner is shown a move with no
  // reason, on the screen whose entire purpose is the reason. Collected from the solver's source
  // rather than from a list, so adding a stage without wording fails here.
  const solver = readFileSync(new URL('../lib/method-solver.js', import.meta.url), 'utf8');
  const emitted = [...solver.matchAll(/why: \{ key: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(emitted.length >= 8, `only found ${emitted.length} reason keys — the scan is not working`);

  const written = app.match(/const WHY_TEXT = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  const missing = [...new Set(emitted)].filter((key) => !written.includes(`'${key}'`));
  assert.deepEqual(missing, [], 'these steps would be shown with no reason at all');
});

test('the explaining solver is a separate choice, not a shorter tier', () => {
  // Shortest and explicable pull in opposite directions; folding them into one control would
  // make "shorter" and "clearer" look like points on the same scale.
  assert.match(app, /teachLevel: 'off'/, 'the setting must default to off');
  assert.match(app, /data-set-teach/, 'Settings must offer the rungs');
  assert.match(app, /settings\.teachLevel !== 'off'/, 'solve() must branch on it');
  assert.match(app, /solveByMethod/, 'and actually call the method solver');
});

test('the reason line is one line, never a heading per group', () => {
  // The chip grid's own comment records that a heading per group pushed the tail of a 20-move
  // solve past the sheet's foot in portrait. A lesson is ~118 moves in ~21 steps, so grouping it
  // would be far worse. One line that follows the walk is the whole affordance.
  assert.match(app, /id="whyLine"/, 'the reason line must exist');
  assert.equal((app.match(/id="whyLine"/g) ?? []).length, 1, 'exactly one reason element');
  assert.match(app, /sayWhy\(i\)/, 'and it must be updated as the walk moves');
});

test('a two-phase solution gets no captions invented for it', () => {
  // It has no steps. Showing a reason for one of its moves would be exactly the fabricated
  // structure the CFOP headings were removed for.
  const fn = app.match(/function sayWhy\(i\)[\s\S]*?\n      \}/)?.[0] ?? '';
  assert.ok(fn, 'sayWhy not found');
  assert.match(fn, /if \(!steps \|\| !map[\s\S]*?hidden = true/, 'with no lesson, the line must hide');
});

test('a lesson is thrown away with the solution it explains', () => {
  const clears = [...app.matchAll(/c\.solution = ''/g)];
  for (const m of clears) {
    const line = app.slice(m.index, app.indexOf('\n', app.indexOf('\n', m.index) + 1));
    assert.match(line, /methodSteps = null/, 'a stale lesson would caption the next cube');
  }
});
