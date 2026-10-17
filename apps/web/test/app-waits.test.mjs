// A suite that presses the die waits for the solver as a FACT, never as a guessed number of milliseconds.
//
// `lib/screens/cube/die.js` ignores a press made before `solverReady()` — silently, with the button
// looking enabled. Five suites booted the app, waited `settle(1500)` for the load, and pressed; on a busy
// machine the guess ran out first, the press did nothing, and the suite failed thirty seconds later about
// something else entirely (the 0.5.3 release gate, 2026-09-17). `test/fixtures/app-waits.mjs` is the fix;
// this is what keeps it.
//
// Read as text, because what is being refused is a way of WRITING a suite: a behavioural test cannot
// fail on a race that only a loaded machine loses.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { eventually, waitFor } from './fixtures/app-waits.mjs';

const here = new URL('./', import.meta.url);
const suites = readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs') && name !== 'app-waits.test.mjs')
  .map((name) => ({ name, text: readFileSync(new URL(name, here), 'utf8') }));

/** The suite's code with comments removed, so prose about the die does not count as pressing it. */
const code = (text) => text.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

test('every suite that boots the app and presses the die waits for the solver first', () => {
  const pressing = suites.filter(({ text }) => {
    const src = code(text);
    return /['"`]\.\.\/lib\/app\.js['"`]/.test(src) && /#randCube/.test(src) && /\.click\(\)/.test(src);
  });
  // Not vacuous: the suites this was written for are still here and still press the die.
  assert.ok(pressing.length >= 4, `only ${pressing.length} suites press the die — this guard has lost its subject`);
  const guessing = pressing.filter(({ text }) => !/\bsolverLoaded\(/.test(code(text)));
  assert.deepEqual(guessing.map((s) => s.name), [],
    'these suites press the die without `await solverLoaded()` (test/fixtures/app-waits.mjs) — a press made'
    + ' before the solver has loaded is ignored, and a fixed wait for the load is a race a busy machine loses');
});

test('no suite waits a guessed time for the solver', () => {
  const offenders = [];
  for (const { name, text } of suites) {
    text.split('\n').forEach((line, i) => {
      if (/\bsettle\(\s*\d+\s*\)/.test(line) && /solver/i.test(line)) offenders.push(`${name}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'wait for `solverLoaded()` instead of a number of milliseconds');
});

test('eventually waits for its condition, and names what it gave up on', async () => {
  let n = 0;
  await eventually(() => (n += 1) >= 3, 'the third poll', { step: 1 });
  assert.equal(n, 3);
  await assert.rejects(eventually(() => false, 'a thing that never happens', { ms: 30, step: 5 }),
    /timed out after 30 ms waiting for a thing that never happens/);
});

test('waitFor asks its condition after the wait that overran, never only the clock', async () => {
  // The suites' own copies read the clock first, so a wait stalled past the bound returned false for a
  // condition that had come true meanwhile — measured as the likeliest fast-tier flake under heavy load
  // (2026-10-17). Here the one wait (50 ms) overruns the bound (10 ms), and the condition holds by then.
  let ready = false;
  setTimeout(() => { ready = true; }, 1);
  assert.equal(await waitFor(() => ready, { ms: 10, step: 50 }), true, 'a condition that came true during the last wait was reported false');
  assert.equal(await waitFor(() => false, { ms: 10, step: 5 }), false);
});

test('no suite carries its own polling helper — the shared ones ask the condition last', () => {
  // Three suites each had a copy of one helper, and all three had the same flaw (clock first). A copy is
  // how the fix stops reaching a suite.
  const own = [];
  for (const { name, text } of suites) {
    text.split('\n').forEach((line, i) => {
      if (/^(?:const|let|async function|function)\s+(?:waitFor|eventually)\b/.test(line.trim())) own.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(own, [], 'import waitFor or eventually from test/fixtures/app-waits.mjs');
});
