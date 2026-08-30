// Warming the solver pool, and the two ways it can quietly half-work.
//
// Every solver worker builds its own pruning tables — 0.5-2.6 s (dev-docs/solver-move-count.md
// §7) — and lazily, so without a warm-up the first solve of a session pays for all of them while
// a user waits. `warmSolver()` spends that cost on screens that know a solve is coming.
//
// Both failures here are silent. A warm budget smaller than the worker count leaves some workers
// cold, because `shareBudget` drops a zero share — and a partly-warm pool looks exactly like a
// warm one until the search that needed the cold worker. A warm cube that is not actually solved
// turns a free table build into a real search on the main path.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { shareBudget } from '../lib/solve-client.js';
import { VIEW_COUNT } from '../lib/solver-engine.js';
import Cube from '../vendor/cubejs.js';

const app = readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');

test('the warm cube is actually solved, so warming costs only the tables', () => {
  const facelets = app.match(/const SOLVED_FACELETS = '([A-Z]{54})'/)?.[1];
  assert.ok(facelets, 'SOLVED_FACELETS is gone or no longer a 54-character literal');
  assert.equal(Cube.fromString(facelets).isSolved(), true,
    'the warm request must be a solved cube — anything else makes the warm-up a real search');
});

test('the warm budget reaches EVERY worker, not just the first few', () => {
  // The trap: shareBudget deals the budget and drops zero shares, so a warm budget below the
  // worker count silently warms a subset. The pool then looks warm and is not, and the cost
  // reappears on whichever search first needs a cold worker.
  // Whatever the budget is WRITTEN as — a bare number or a multiple of VIEW_COUNT — what
  // matters is the number it comes to. An earlier draft of this test only matched the
  // `N * VIEW_COUNT` form and then asserted that form divides evenly, which is true for every
  // N and so proved nothing; the defect it is aimed at is a bare `probeMax: 3`.
  const warm = app.match(/warmSolver\(\) \{[\s\S]*?probeMax:\s*([\w*\s]+?)\s*\}/)?.[1];
  assert.ok(warm, 'the warm-up no longer passes a numeric probeMax');
  const budget = warm.split('*').map((t) => t.trim())
    .reduce((a, t) => a * (t === 'VIEW_COUNT' ? VIEW_COUNT : Number(t)), 1);
  assert.ok(Number.isSafeInteger(budget) && budget > 0, `unreadable warm budget: ${warm}`);
  const shares = shareBudget(budget, VIEW_COUNT);
  assert.equal(shares.length, VIEW_COUNT,
    `a warm budget of ${budget} leaves ${VIEW_COUNT - shares.length} of ${VIEW_COUNT} workers cold`);
  assert.ok(shares.every((n) => n > 0), 'and every share must be real work');
});

test('warming happens at most once a session', () => {
  // Not a micro-optimisation: without the guard every screen entry queues another solve into
  // the pool, and on the scan screen that is one per re-render.
  const body = app.match(/function warmSolver\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(body, /if \(solverWarmed\) return;/, 'warmSolver must be guarded');
  assert.match(body, /solverWarmed = true;/, 'and must set the guard before it can throw');
});

test('warming never becomes something a screen waits on, or is broken by', () => {
  const body = app.match(/function warmSolver\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(body, /\bawait\b/,
    'an awaited warm-up puts the table build back in front of the user, which is the whole bug');
  assert.match(body, /\.catch\(/, 'an unhandled rejection here would surface as a page error');
  assert.match(body, /try \{/, 'a client that cannot be constructed must not break the screen');
});

test('every screen that solves warms first', () => {
  // The three that know a solve is coming: the cube screen (solves on entry and on every press),
  // the timer (every scramble it rolls is solved), and the scan (seconds of camera, then a
  // solve — the largest warm window there is).
  const calls = app.match(/^\s*warmSolver\(\);/gm) ?? [];
  assert.equal(calls.length, 3,
    `expected the three solving screens to warm; found ${calls.length} call sites`);
});

test('there is ONE pool, and rolling a scramble goes through it', () => {
  // `warmRoller`/`scramble-worker.js` were the app paying twice for one capability: a second
  // worker with its own ~34 MB of cubejs Kociemba tables and a 3-6 s build, beside a pool of
  // workers already holding warm two-phase tables. Rolling is a solve, so it goes where solves
  // go. A reintroduced second roller would show up here.
  // Comments stripped, the way solve-tier-wiring does it: WHY the second roller was removed is
  // worth keeping in the source, and a test that cannot tell a comment from code would forbid
  // recording it.
  const code = app
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/([^:'"`])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(code, /warmRoller\s*\(/, 'the separate scramble roller is gone by design');
  assert.doesNotMatch(code, /scramble-worker/, 'and nothing constructs that worker');
  assert.match(app, /solverWorker\(\)\.solve\(f, bounds\)/,
    'rollScramble must ask the solver pool, not a roller of its own');
  // Warmed at the two screens that can roll, and once at boot so the first press is cheap.
  const prerolls = app.match(/^\s*schedulePreroll\(\);/gm) ?? [];
  assert.equal(prerolls.length, 3, `expected boot + the two rolling screens; found ${prerolls.length}`);
});
