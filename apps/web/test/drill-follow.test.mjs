// THE DEMONSTRATION FOLLOWS THE CUBE IN THE CHILD'S HANDS, and the fact that makes it possible.
//
// The Drill page shows one algorithm two ways: a demonstration that can be played, and a live
// attempt that judges what the child does. They were entirely separate, so turning your own cube
// moved nothing on screen — and "the cube on screen is the cube you are holding" is the page's
// whole promise (owner, 2026-09-30).
//
// `createStopDriver.observe(facelets)` is the driver's own seam for it. What has to be true for it
// to work is a FRAME agreement: the demonstration's script is declared in the child's hold and the
// cube reports in its own frame, and feeding one to the other is the ADR 0004 trap — a mismatch
// does not throw, it just answers `off` for ever and the feature silently does nothing. So the
// agreement is measured here over every entry rather than asserted once for sune.
import assert from 'node:assert/strict';
import test from 'node:test';

// `library.js` reaches app-settings, which reads storage at import.
const store = new Map();
globalThis.localStorage ??= {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

import { ALG_ENTRIES, entryById } from '../lib/alg-catalogue.js';
import { createDrillAttempt } from '../lib/drill-attempt.js';
import { demoScript } from '../lib/screens/drill/library.js';
import { createStopDriver } from '../lib/script-drive.js';
import { SOLVED, applyAlg, invert, movesOf, toFacelets } from '../lib/cube-pieces.js';
import { isRotation, reportStream, reportsOf } from './fixtures/cube-reports.mjs';

/** A driver with no element: only its verdicts about where a cube is are wanted. */
const watcher = (entry) => createStopDriver(demoScript(entry), {});

test('a child performing the printed procedure walks the demonstration — the whole catalogue', () => {
  // The cube is driven by what it REPORTS (`fixtures/cube-reports.mjs`): a slice arrives as two face turns
  // and a turn of the whole cube as nothing, which is what a real cube sends for the human-speed table.
  let withRegrips = 0;
  for (const entry of ALG_ENTRIES) {
    const demo = watcher(entry);
    const algorithm = reportsOf(entry.scanAlg);
    let cube = SOLVED;

    // Step 1 is a solved cube. The algorithm returns the case to solved, so solved IS the LAST
    // position of the demonstration — which is why the set-up below walks it backwards.
    const start = demo.observe(toFacelets(cube));
    assert.equal(start.kind, 'step', `${entry.id}: a solved cube is not on the demonstration at all`);

    // Step 2, the set-up: the algorithm inverted, so it walks the positions in reverse to the case.
    for (const m of reportStream(invert(entry.scanAlg))) cube = applyAlg(cube, m);
    const atCase = demo.observe(toFacelets(cube));
    assert.equal(atCase.kind, 'step', `${entry.id}: the case the set-up builds is off the demonstration`);
    assert.equal(atCase.position, 0, `${entry.id}: the case is not the demonstration's first position`);

    // Step 3: each turn a cube reports moves the demonstration on to the stop that turn makes. A turn of
    // the whole cube has no stop of its own unless it ends the sequence (ADR 0004 decision 9) and no cube
    // reports one, so the expectation is read off the script's own turn count per position: the LAST
    // stop made before the next turn a cube can report — which passes through a closing `y'` or `x'`.
    const { positions } = demoScript(entry);
    if (algorithm.some((t) => isRotation(t.token))) withRegrips += 1;
    for (const [i, { token, reports }] of algorithm.entries()) {
      if (isRotation(token)) continue;
      for (const m of reports) cube = applyAlg(cube, m);
      const seen = demo.observe(toFacelets(cube));
      const next = algorithm.findIndex((t, j) => j > i && !isRotation(t.token));
      const before = next < 0 ? Infinity : next;
      const expected = positions.findLastIndex((p) => p.moves <= before);
      assert.equal(seen.kind, 'step', `${entry.id}: turn ${i + 1} (${token}) left the demonstration`);
      assert.equal(seen.position, expected, `${entry.id}: turn ${i + 1} (${token}) put the demonstration at ${seen.position}, not ${expected}`);
    }
    assert.equal(demo.observe(toFacelets(cube)).position, positions.length - 1, `${entry.id}: the demonstration did not end where the cube did`);
  }
  // Precondition: the regrip rule above was actually exercised.
  // Eight measured: F2L 13, 18, 20 and Aa, Ab, E, Ja, V.
  assert.ok(withRegrips >= 8, `only ${withRegrips} entries turn the whole cube`);
});

test('a cube that is NOT doing this algorithm moves the demonstration nowhere', () => {
  // The other half, and the one that matters for trust: following must not drag the demonstration
  // around because a child fidgeted. `off` is the driver's answer and it moves nothing.
  const sune = entryById('sune');
  const demo = watcher(sune);
  let cube = SOLVED;
  for (const m of movesOf(invert(sune.scanAlg))) cube = applyAlg(cube, m);
  const atCase = demo.observe(toFacelets(cube));
  assert.equal(atCase.position, 0, 'precondition: the cube is at the case');

  // A turn that is not sune's first. `F` is not in sune at all.
  const strayed = applyAlg(cube, 'F');
  const seen = demo.observe(toFacelets(strayed));
  assert.equal(seen.kind, 'off', 'a turn off the algorithm was read as being on it');
  assert.equal(seen.position, 0, 'a turn off the algorithm moved the demonstration');
});

test('the set-up is mirrored too, backwards, one position per turn', () => {
  // Not an accident worth leaving unstated: the set-up IS the algorithm inverted, so a child
  // building the case walks the demonstration from its end to its start. That is why following can
  // be switched on for the whole page rather than only for the solve.
  const sune = entryById('sune');
  const demo = watcher(sune);
  const setup = movesOf(invert(sune.scanAlg));
  let cube = SOLVED;
  const walked = [demo.observe(toFacelets(cube)).position];
  for (const m of setup) {
    cube = applyAlg(cube, m);
    walked.push(demo.observe(toFacelets(cube)).position);
  }
  assert.deepEqual(walked, [7, 6, 5, 4, 3, 2, 1, 0], `the set-up walked ${walked.join(',')}`);
});

test('the attempt hands out where it thinks the cube is, so the screen has one source for it', () => {
  // `mirror()` reads `attempt.cube` rather than applying the reports itself. Two objects
  // reconstructing one cube from one stream is two answers about where it is.
  const sune = entryById('sune');
  const a = createDrillAttempt({ entry: sune, chainTrusted: () => true, numbersMoves: () => true });
  assert.equal(a.cube, null, 'an unseeded attempt claims to know where the cube is');
  const solved = toFacelets(SOLVED);
  a.facelets(solved, 0);
  assert.equal(a.cube, solved, 'the seed is not what the attempt reports');
  const first = movesOf(invert(sune.scanAlg))[0];
  a.move({ notation: first, serial: 1, cubeTimestamp: 400 });
  assert.equal(a.cube, toFacelets(applyAlg(SOLVED, first)), 'a reported turn did not move the attempt\'s cube');
  // And tracking loss is said, not papered over: a screen must not mirror a guess.
  a.movesLost();
  assert.equal(a.cube, null, 'tracking was lost and the attempt still claimed to know the arrangement');
});
