// A committed walk, as a script — plan item 6.5.
//
// The load-bearing case is the one both readers of the script need and neither can check for itself:
// the script and the walk must describe THE SAME CUBE at every position. The walk's `steps` come from
// the solver's own state list; the script's come from `script-view`'s interpreter, which shares no
// code with it. So asserting they are equal is a cross-check between two implementations, not a
// restatement of one.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { walkScript } from '../lib/walk-script.js';
import { buildScript, viewAtPosition } from '../lib/script-view.js';
import { trackFor } from '../lib/script-track.js';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');

/** A walk the way the session commits one: the arrangement at every position, from cubejs. */
function walkOf(setup, alg, extra = {}) {
  const moves = alg.split(' ').filter(Boolean);
  const cube = new Cube();
  if (setup) cube.move(setup);
  const steps = [cube.asString()];
  for (const m of moves) { cube.move(m); steps.push(cube.asString()); }
  return { setup, moves, steps, scrambling: false, ...extra };
}

const statesOf = (script) => trackFor(buildScript(script)).states;

test('the script describes the same cube as the walk at every position', () => {
  const walk = walkOf("R U R' U' F2 L D' B", "B' D L' F2 U R U' R'");
  const script = walkScript(walk);
  assert.deepEqual(script.start, { scramble: "R U R' U' F2 L D' B" });
  assert.deepEqual(statesOf(script), walk.steps);
});

test('a walk with no verified path to its arrangement loads the arrangement', () => {
  // `takeSetupAlg` refused the inverse of the answer. The walk is still right; there is simply no alg
  // from solved known to reach it, and `scramble: ''` would draw a SOLVED cube under a scrambled walk.
  const walk = { ...walkOf("R U R' U'", "U R U' R'"), setup: null };
  const script = walkScript(walk);
  assert.deepEqual(script.start, { facelets: walk.steps[0] });
  assert.deepEqual(statesOf(script), walk.steps);
});

test('the Scramble side starts from solved, and names no opening to say so', () => {
  // `scramble: ''` cannot be written literally — checkScript refuses a scramble naming no moves, and
  // is right to: an empty alg is the absence of one. An absent `start` is how the format says solved,
  // and it produces the `scramble=""` the screen writes today.
  const walk = { ...walkOf('', "R U R' U' F2"), setup: '', scrambling: true };
  const script = walkScript(walk);
  assert.deepEqual(script.start, {});
  const view = viewAtPosition(buildScript(script), 0);
  assert.equal(view.scramble, '', 'the Scramble side must load a scramble, not an arrangement');
  assert.equal(view.facelets, null);
  assert.deepEqual(statesOf(script), walk.steps);
});

test('a walk too incomplete to be a route is refused rather than half-built', () => {
  // The same refusal `walk-follow.js` makes by hand: states that do not line up with moves cannot say
  // where a cube is, and a script built from them would be a confident wrong answer.
  assert.equal(walkScript({ moves: [], steps: [] }), null, 'a walk with no moves became a script');
  assert.equal(walkScript({ moves: ['R', 'U'], steps: ['x'] }), null, 'short states became a script');
  assert.equal(walkScript(), null, 'nothing became a script');
});

test('a position is a head: one per move made, and the walk ends at its last', () => {
  // What the port rests on. The transport counts moves made; the driver counts positions; they are the
  // same number or the chips point at the wrong move. A leading cue-only step would break exactly this.
  const walk = walkOf(null, "R U R' U' F2 B");
  const built = buildScript(walkScript(walk));
  assert.equal(built.positions.length, walk.moves.length + 1);
  built.positions.forEach((p, k) => assert.equal(p.moves, k, `position ${k} is ${p.moves} moves in`));
});

// The cue gap this translation is deliberately silent about, asserted so the next change meets it as a
// FACT rather than rediscovering it. Not a defect in the format — a script normally says this with a
// narration step — but it is why `focus` and `highlight` stay host-owned for now.
test('position 0 carries no cue, which is why a lesson keeps its cues in the host', () => {
  const built = buildScript({ schema: 2, steps: [{ move: 'R U', hl: 'layer:U' }] });
  assert.equal(viewAtPosition(built, 0).cues.hl, undefined, 'the format gained a cue at position 0');
  assert.equal(viewAtPosition(built, 1).cues.hl, 'layer:U');
});
