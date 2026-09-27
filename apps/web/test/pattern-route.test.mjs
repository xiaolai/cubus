// The way to a picture, and the four mistakes the shipped patterns could not have caught.
//
// A Codex refute pass (2026-09-26) checked the three state patterns this app offers and found that
// ALL THREE are unchanged by the method-frame tumble AND are their own inverse. So a route that
// omitted `inverseOf`, composed in the wrong order, tumbled one of its inputs, or renamed its answer
// on the way out would still have landed on every one of them, and a suite built only on the shipped
// set would have called it correct.
//
// `ASYMMETRIC` is the answer to that: the cube after `R U F`, which is none of those things. Every
// case below that could be fooled runs on it, and the mutation list at the bottom is the evidence.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOLVED, applyAlg, compose, inverseOf, toFacelets } from '../lib/cube-pieces.js';
import { parseFacelets } from '../lib/two-phase.js';
import { pictureState, relativeCube, routeToPicture } from '../lib/pattern-route.js';
import { PATTERNS } from '../lib/patterns.js';

/** A destination that is NOT self-inverse and NOT tumble-invariant — the whole point of it. */
const ASYMMETRIC = Object.freeze({
  id: 'asymmetric', kind: 'state', name: 'a test destination',
  alg: 'R U F', look: toFacelets(applyAlg(SOLVED, 'R U F')),
});

const parse = (f) => parseFacelets(f);
/**
 * The solver, scripted — and it RECORDS WHAT IT WAS ASKED, which is the point.
 *
 * The first version ignored its argument entirely, so production could have solved the ORIGINAL
 * cube instead of the relative one and every case here would still have passed (audit, 2026-09-27).
 * The whole feature is the transform; a stub that does not look at it tests everything except that.
 */
let scripted = null;
let asked = [];
const scriptedSolve = async (relative, opts) => { asked.push({ relative, opts }); return scripted; };

/**
 * A replay that REFUSES what it cannot read, like the production adapter.
 *
 * `apps/web/lib/screens/cube.js` wraps cubejs in a try and answers null on a throw, so a malformed
 * algorithm reaches `routeToPicture` as "the oracle could not say". The first stub here threw
 * instead, which meant the malformed cases were testing an exception path production does not have.
 */
const replay = (facelets, alg) => {
  try {
    return toFacelets(applyAlg(parseFacelets(facelets), alg));
  } catch { return null; }
};

test('the shipped state patterns could not catch these mistakes, which is why ASYMMETRIC exists', () => {
  for (const pattern of PATTERNS.filter((p) => p.kind === 'state')) {
    const s = pictureState(pattern);
    assert.equal(toFacelets(inverseOf(s)), pattern.look,
      `${pattern.id} is NOT self-inverse any more — the premise of this file changed, re-read it`);
  }
  assert.notEqual(toFacelets(inverseOf(pictureState(ASYMMETRIC))), ASYMMETRIC.look,
    'ASYMMETRIC became self-inverse, so it can no longer catch a missing inverseOf');
});

test('the relative cube is the one whose solution is the route, on an asymmetric destination', () => {
  const c = parseFacelets(toFacelets(applyAlg(SOLVED, "L2 D B' R U2")));
  const relative = relativeCube(ASYMMETRIC, toFacelets(c), parse);
  // The defining property, checked directly: solving `relative` means applying the inverse of the
  // state it names, and that maneuver must take c to S.
  const m = inverseOf(parseFacelets(relative));
  assert.equal(toFacelets(compose(c, m)), ASYMMETRIC.look,
    'the relative cube does not have the property the route depends on');
});

// THE SOLVER IS ASKED ABOUT THE RELATIVE CUBE, AND NOTHING ELSE.
//
// The transform is the whole feature, and every other case here would pass if production handed the
// pool the ORIGINAL cube: the scripted answer reaches the picture either way, because the test
// supplies it (audit, 2026-09-27). So this asserts the argument, and asserts it against a value
// computed a second way — the relative cube is the one whose INVERSE state is the route, so solving
// it must be the same as inverting it.
test('the pool is asked to solve the relative cube, not the cube in hand', async () => {
  const start = toFacelets(applyAlg(SOLVED, "L2 D B' R U2"));
  asked = [];
  scripted = algFor(start, ASYMMETRIC);
  await routeToPicture({ pattern: ASYMMETRIC, facelets: start, solve: scriptedSolve, parse, replay });
  assert.equal(asked.length, 1, 'the pool was asked once');
  assert.notEqual(asked[0].relative, start, 'the pool was handed the cube in hand, untransformed');
  assert.equal(asked[0].relative, relativeCube(ASYMMETRIC, start, parse));
  // And the defining property of what it was handed, checked without the router: the inverse of the
  // relative cube's state, applied to the cube in hand, is the picture.
  const undo = inverseOf(parseFacelets(asked[0].relative));
  assert.equal(toFacelets(compose(parseFacelets(start), undo)), ASYMMETRIC.look);
});

test('a route is returned only when an independent replay lands exactly on the picture', async () => {
  const start = toFacelets(applyAlg(SOLVED, "L2 D B' R U2"));
  const relative = relativeCube(ASYMMETRIC, start, parse);
  const truth = toFacelets(inverseOf(parseFacelets(relative)));
  // The alg that solves the relative cube, obtained without the engine: the inverse state's own
  // facelets are not an alg, so the test drives the solver with an alg it verified independently.
  scripted = algFor(start, ASYMMETRIC);
  const route = await routeToPicture({
    pattern: ASYMMETRIC, facelets: start, solve: scriptedSolve, parse, replay,
  });
  assert.ok(route, 'a correct algorithm was refused');
  assert.equal(replay(start, route.alg), ASYMMETRIC.look);
  assert.equal(route.minimal, false, 'two-phase cannot prove a minimum and must not imply one');
  assert.equal(truth.length, 54);
});

test('a wrong, truncated or malformed algorithm is refused rather than shown', async () => {
  const start = toFacelets(applyAlg(SOLVED, "L2 D B' R U2"));
  const good = algFor(start, ASYMMETRIC);
  // SYNTACTICALLY INVALID ONES TOO. The first list was all well-formed algorithms that simply went
  // somewhere else, so the refusal path for input the ORACLE cannot read was never exercised — and
  // production turns that into null rather than a throw (audit, 2026-09-27).
  for (const bad of [`${good} R`, good.split(' ').slice(0, -1).join(' '), 'R R R', '',
    'Q2', 'R U <script>', 'M2 U M2', '17', `${good} Z'`]) {
    scripted = bad;
    const route = await routeToPicture({
      pattern: ASYMMETRIC, facelets: start, solve: scriptedSolve, parse, replay,
    });
    assert.equal(route, null, `an algorithm that does not reach the picture was accepted: "${bad}"`);
  }
});

test('an oracle that cannot run has verified nothing, so the route is refused', async () => {
  const start = toFacelets(applyAlg(SOLVED, "L2 D B' R U2"));
  scripted = algFor(start, ASYMMETRIC);
  const route = await routeToPicture({
    pattern: ASYMMETRIC, facelets: start, solve: scriptedSolve, parse, replay: () => null,
  });
  assert.equal(route, null, 'a route was accepted on an oracle that could not answer');
});

test('a cube already showing the picture is a zero-move answer, not a failure', async () => {
  let asked = 0;
  const route = await routeToPicture({
    pattern: ASYMMETRIC, facelets: ASYMMETRIC.look, parse, replay,
    solve: async () => { asked += 1; return 'R'; },
  });
  assert.ok(route, 'being already there was reported as no route at all');
  assert.equal(route.alg, '');
  assert.equal(route.moves, 0);
  assert.equal(asked, 0, 'the pool was asked to solve a cube this thread already knew was done');
});

test('an aborted walk yields no route and never asks the pool', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let asked = 0;
  const route = await routeToPicture({
    pattern: ASYMMETRIC, facelets: toFacelets(applyAlg(SOLVED, 'R')), parse, replay,
    solve: async () => { asked += 1; return ''; }, signal: ctrl.signal,
  });
  assert.equal(route, null);
  assert.equal(asked, 0, 'an already-aborted walk still dispatched a search');
});

// CANCELLATION DURING A SEARCH, which is the case that actually happens: a walk is replaced while
// the pool is still working. The first version only tested an ALREADY-aborted signal, so removing
// the post-search abort check passed everything (audit, 2026-09-27). The signal must also REACH the
// solver, or the abandoned search runs its budget out on a worker nobody is waiting for.
test('a walk aborted while the search runs is refused, and never replayed', async () => {
  const ctrl = new AbortController();
  const start = toFacelets(applyAlg(SOLVED, "L2 D B' R U2"));
  let release;
  let replayed = 0;
  const pending = routeToPicture({
    pattern: ASYMMETRIC, facelets: start, parse, signal: ctrl.signal,
    replay: (...a) => { replayed += 1; return replay(...a); },
    solve: (relative, opts) => { asked.push({ relative, opts }); return new Promise((r) => { release = r; }); },
  });
  asked = [];
  await null; // let the solve be dispatched
  ctrl.abort();
  release(algFor(start, ASYMMETRIC)); // a CORRECT answer, arriving too late
  assert.equal(await pending, null, 'an answer to a superseded walk was accepted');
  assert.equal(replayed, 0, 'a superseded walk still paid for an oracle replay');
});

test('the walk\'s signal reaches the solver, so an abandoned search can be called off', async () => {
  const ctrl = new AbortController();
  const start = toFacelets(applyAlg(SOLVED, "L2 D B' R U2"));
  asked = [];
  scripted = algFor(start, ASYMMETRIC);
  await routeToPicture({
    pattern: ASYMMETRIC, facelets: start, solve: scriptedSolve, parse, replay, signal: ctrl.signal,
  });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].opts?.signal, ctrl.signal, 'the search was dispatched with no way to stop it');
});

test('a search that never answers is a refusal, never a claim about the cube', async () => {
  const start = toFacelets(applyAlg(SOLVED, "L2 D B' R U2"));
  for (const solve of [async () => null, async () => undefined, async () => { throw new Error('every escalation spent'); }]) {
    const route = await routeToPicture({ pattern: ASYMMETRIC, facelets: start, solve, parse, replay });
    assert.equal(route, null);
  }
});

/** The algorithm from `start` to a state pattern, worked out here rather than searched for. */
function algFor(start, pattern) {
  // Applying the pattern's alg to a solved cube gives S; the route from c is c's inverse then S,
  // which as an ALGORITHM is the inverse of the scramble that made c, followed by the pattern's own.
  // The test's starting cubes are built from known scrambles, so that inverse is known too.
  const scramble = SCRAMBLE_OF.get(start);
  if (!scramble) throw new Error('algFor: the test must build its start from a known scramble');
  const undo = scramble.trim().split(/\s+/).reverse()
    .map((m) => (m.endsWith('2') ? m : m.endsWith("'") ? m[0] : `${m}'`)).join(' ');
  return `${undo} ${pattern.alg}`;
}
const SCRAMBLE_OF = new Map([[toFacelets(applyAlg(SOLVED, "L2 D B' R U2")), "L2 D B' R U2"]]);
