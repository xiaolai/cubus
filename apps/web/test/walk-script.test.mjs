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
import { scanFrameWalk, toMethodFrame } from '../lib/solving-hold.js';
import { allRungCombinations, methodFor, solveByMethod } from '../lib/method-solver.js';
import { fromCube } from '../lib/cube-pieces.js';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');
const SOLVED = new Cube().asString();
const isRegrip = (m) => /^[xyz]/.test(m);

/**
 * A walk the way the session commits one: scan-frame moves, the hold each is MADE in, and the
 * arrangement at every position — the last from cubejs, which shares no code with the interpreter the
 * script's own states come from.
 *
 * A regrip turns the cube and moves no piece, so it repeats the state before it and changes the hold
 * of everything after it. That is the whole of what makes a walk's frame different from a script's.
 */
function walkOf(setup, alg, extra = {}) {
  const moves = alg.split(' ').filter(Boolean);
  const cube = new Cube();
  if (setup) cube.move(setup);
  const steps = [cube.asString()];
  for (const m of moves) {
    if (!isRegrip(m)) cube.move(m);                    // a regrip turns the cube and moves no piece
    steps.push(cube.asString());
  }
  return { setup, moves, steps, from: steps[0], scrambling: false, ...extra };
}

const statesOf = (script) => trackFor(buildScript(script)).states;

test('the script describes the same cube as the walk at every position', () => {
  const walk = walkOf("R U R' U' F2 L D' B", "B' D L' F2 U R U' R'");
  const script = walkScript(walk);
  assert.deepEqual(script.start, { scramble: "R U R' U' F2 L D' B", hold: 'U F' });
  assert.deepEqual(statesOf(script), walk.steps);
});

test('a walk with no verified path to its arrangement loads the arrangement', () => {
  // `takeSetupAlg` refused the inverse of the answer. The walk is still right; there is simply no alg
  // from solved known to reach it, and `scramble: ''` would draw a SOLVED cube under a scrambled walk.
  const walk = { ...walkOf("R U R' U'", "U R U' R'"), setup: null };
  const script = walkScript(walk);
  assert.deepEqual(script.start, { facelets: walk.steps[0], hold: 'U F' });
  assert.deepEqual(statesOf(script), walk.steps);
});

test('the Scramble side starts from solved, and names no opening to say so', () => {
  // `scramble: ''` cannot be written literally — checkScript refuses a scramble naming no moves, and
  // is right to: an empty alg is the absence of one. An absent `start` is how the format says solved,
  // and it produces the `scramble=""` the screen writes today.
  const walk = { ...walkOf('', "R U R' U' F2"), setup: '', scrambling: true };
  const script = walkScript(walk);
  // The hold is the frame the letters are READ in and is always said; the CUBE is what is left
  // unnamed, which is how the format says solved.
  assert.deepEqual(script.start, { hold: 'U F' });
  const view = viewAtPosition(buildScript(script), 0);
  assert.equal(view.scramble, '', 'the Scramble side must load a scramble, not an arrangement');
  assert.equal(view.facelets, null);
  assert.deepEqual(statesOf(script), walk.steps);
});

test('a walk that cannot be a script is refused rather than half-built', () => {
  assert.equal(walkScript({ moves: [], from: SOLVED }), null, 'a walk with no moves became a script');
  assert.equal(walkScript(), null, 'nothing became a script');
  // No path and no arrangement: there is nothing to open on, and guessing would draw the walk over the
  // wrong cube rather than draw nothing.
  assert.equal(walkScript({ moves: ['R'] }), null, 'a walk with no opening became a script');
  // But a SHORT state list is not one of these. It stops a walk being FOLLOWED (`judge()` in
  // lib/walk-follow.js refuses it) and is no reason to refuse to step through it — the states come
  // back out of the script, so it never needed them.
  assert.ok(walkScript({ moves: ['R', 'U'], from: SOLVED }), 'a walk with no state list lost its transport');
});

test('a position is a head: one per move made, and the walk ends at its last', () => {
  // What the port rests on. The transport counts moves made; the driver counts positions; they are the
  // same number or the chips point at the wrong move. A leading cue-only step would break exactly this.
  const walk = walkOf("B' F2 U R U' R'", "R U R' U' F2 B");
  const built = buildScript(walkScript(walk));
  assert.equal(built.positions.length, walk.moves.length + 1);
  built.positions.forEach((p, k) => assert.equal(p.moves, k, `position ${k} is ${p.moves} moves in`));
});

// ---- the regrip, which is where a walk's frame and a script's part company ------------------------

test('a walk that turns the cube over still describes the same cube at every position', () => {
  // The defect this replaces, measured 2026-09-17: handing the walk's scan-frame alg straight to the
  // player re-read every move after the tumble in the tumbled frame — L drawn where the walk says R,
  // B where it says F. The states are the whole check, and cubejs computes the walk's half of them.
  const walk = walkOf(null, "R U R' x2 U F U'");
  const script = walkScript(walk);
  assert.deepEqual(statesOf(script), walk.steps);
});

test('a regrip gets a position of its own, so a head and a position stay the same number', () => {
  // The second half of the same defect: a regrip moves no piece, and the format groups it with the
  // turn it leads into — so one step holding the whole alg left the walk a position short of its own
  // chips, and every chip after the tumble pointed at the wrong move.
  const walk = walkOf(null, "R U R' x2 U F U'");
  const built = buildScript(walkScript(walk));
  assert.equal(built.positions.length, walk.moves.length + 1, 'the regrip was folded into the turn after it');
  built.positions.forEach((p, k) => assert.equal(p.moves, k, `position ${k} is ${p.moves} moves in`));
});

test("the element is written the walk's own alg — the script's frame is undone by its reader", () => {
  // What the script CARRIES is each move named for the frame its READER will be in: here the tumble is
  // a token, so that frame is also the child's grip and the tokens are the chip names — they part
  // company at a stage boundary, which the rung sweep below covers. What the element is WRITTEN is
  // those read back into one frame, which is the scan-frame alg this screen has always written. Both
  // halves matter: the first is why the cube is right, the second is why nothing that reads `alg` off
  // the element had to change.
  const walk = walkOf(null, "R U R' x2 U F U'");
  const script = walkScript(walk);
  assert.deepEqual(script.steps.map((s) => s.move), ['R', 'U', "R'", 'x2', 'D', 'B', "D'"],
    "after the tumble the reader is upside down, so the walk's U is written D");
  assert.equal(viewAtPosition(buildScript(script), 0).alg, walk.moves.join(' '),
    "the element was written something other than the walk's own alg");
});

// The cue gap this translation is deliberately silent about, asserted so the next change meets it as a
// FACT rather than rediscovering it. Not a defect in the format — a script normally says this with a
// narration step — but it is why `focus` and `highlight` stay host-owned for now.
test('position 0 carries no cue, which is why a lesson keeps its cues in the host', () => {
  const built = buildScript({ schema: 2, steps: [{ move: 'R U', hl: 'layer:U' }] });
  assert.equal(viewAtPosition(built, 0).cues.hl, undefined, 'the format gained a cue at position 0');
  assert.equal(viewAtPosition(built, 1).cues.hl, 'layer:U');
});

// ---- the case that would have caught it: a REAL lesson, not a hand-written alg --------------------
//
// The hand-written regrip cases above pin the mechanism. They did not catch the defect that shipped,
// because the walk they describe tumbles once, with a token, and a real lesson's hold ALSO jumps at a
// stage boundary where no token turns anything. Only a lesson the method solver actually produced has
// that shape, so only one can say the translation holds.

test('a lesson the method solver produced round-trips, states and alg, over every rung', () => {
  // The hand-written cases above pin the mechanism on a walk that tumbles with a token. A real lesson
  // ALSO moves the child's grip at a stage boundary where no token turns anything — which is the half
  // that broke, and the half no hand-written alg has. Swept over the rungs because the bottom rung of
  // every stage produces no regrip at all: a case run only there would round-trip trivially and prove
  // nothing, which is exactly what the first version of this did.
  let sawRegrip = 0;
  for (const scramble of ["R U R' U' F2 L D' B R2 U", "F R U2 L' B D2 R F' U"]) {
    const cube = new Cube();
    cube.move(scramble);
    const facelets = cube.asString();
    for (const rungs of allRungCombinations()) {
      const { steps } = solveByMethod(fromCube(Cube.fromString(toMethodFrame(facelets))), methodFor(rungs));
      const moves = [...scanFrameWalk(steps).moves];
      const where = `${scramble} at ${JSON.stringify(rungs)}`;
      if (moves.some(isRegrip)) sawRegrip += 1;

      const built = buildScript(walkScript({ moves, from: facelets }));
      // What reaches the ELEMENT is the walk's own alg, character for character: nothing that reads
      // `alg` off it had to change, and the cube drawn is the cube the walk describes.
      assert.equal(viewAtPosition(built, 0).alg, moves.join(' '), `${where}: the element was written a different walk`);
      // And a head is still a position, regrips included.
      assert.equal(built.positions.length, moves.length + 1, `${where}: a regrip lost its position`);

      // The states, against cubejs — which shares no code with the interpreter that produced them.
      const replay = new Cube();
      replay.move(scramble);
      const walked = [replay.asString()];
      for (const m of moves) { if (!isRegrip(m)) replay.move(m); walked.push(replay.asString()); }
      assert.deepEqual(trackFor(built).states, walked, `${where}: the script and the walk part company`);
    }
  }
  assert.ok(sawRegrip > 0, 'no rung produced a regrip — this case is not testing what it says');
});
