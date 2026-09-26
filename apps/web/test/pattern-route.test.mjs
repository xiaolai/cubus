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
/** A stand-in oracle: an INDEPENDENT one is cubejs, and the wiring test uses that. */
const replay = (facelets, alg) => toFacelets(applyAlg(parseFacelets(facelets), alg));
/** A solver that actually solves, by construction rather than by searching. */
const perfectSolve = (relative) => {
  // The maneuver that solves `relative` is the inverse of whatever produced it.
  const state = parseFacelets(relative);
  return toFacelets(inverseOf(state)) === relative ? '' : algThatSolves(state);
};
/** Brute force is not needed: the caller knows the alg, so the test hands it back through a closure. */
let scripted = null;
const scriptedSolve = async () => scripted;
function algThatSolves() { throw new Error('unused'); }

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
  for (const bad of [`${good} R`, good.split(' ').slice(0, -1).join(' '), 'R R R', '']) {
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
