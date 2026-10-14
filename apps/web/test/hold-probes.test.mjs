// "Match my cube" — which turns tell the practised holds apart (dev-docs/lesson-holds-plan.md Phase 4).
//
// The ground truth is NOT the module's own face arithmetic. Where a child's face lands is read off the
// permutation `cube-orientation.js` turns a picture by (`orientationPerm`, what `<cubus-cube orientation>`
// draws): which original centre sits in the child's position. Not `turnFacelets`, which renames the
// letters too, so a solved cube comes back solved and every centre reads as its own position.
// `hold-probes.js` reads it through `cube-moves.js`; the two must agree, and the separation claims are
// checked against the permutation.
import assert from 'node:assert/strict';
import test from 'node:test';

import { orientationPerm } from '../lib/cube-orientation.js';
import { SOLVED as SOLVED_PIECES, applyAlg, toFacelets } from '../lib/cube-pieces.js';
import {
  PRACTISED_HOLDS, holdFromReports, probeRound, reportedFace, separates, separatingProbes,
} from '../lib/hold-probes.js';
import { lcg, randomAlg } from './fixtures/seeded-scrambles.mjs';

const CENTRE = { U: 4, R: 13, F: 22, D: 31, L: 40, B: 49 };
const URFDLB = 'URFDLB';
/** Which face's centre a child holding the cube `[up, front]` has in their own `face` position — off the
 *  permutation: `turned[i] = original[perm[i]]`, and a sticker's face is its index divided by nine. */
const seen = (face, [up, front]) => URFDLB[Math.floor(orientationPerm(up, front)[CENTRE[face]] / 9)];
const spec = ([u, f]) => `${u} ${f}`;

test('the practised holds are five different holds: the scan, and the tumble turned four ways', () => {
  assert.equal(PRACTISED_HOLDS.length, 5);
  assert.equal(new Set(PRACTISED_HOLDS.map(spec)).size, 5, 'two practised holds are the same hold');
  assert.equal(spec(PRACTISED_HOLDS[0]), 'U F', 'the first is not the scan\'s hold');
  // Every tumbled one keeps white (the scan frame's U) underneath — read off the picture.
  for (const h of PRACTISED_HOLDS.slice(1)) assert.equal(seen('D', h), 'U', `${spec(h)} does not keep white underneath`);
});

test('the face a smart cube reports is the centre in the child\'s position, for every face of every hold', () => {
  for (const h of PRACTISED_HOLDS) {
    for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
      assert.equal(reportedFace(face, h), seen(face, h), `${spec(h)}: the child's ${face}`);
    }
  }
});

test('one turn cannot tell the practised holds apart, and the probe set is the fewest that can', () => {
  const probes = separatingProbes();
  // Checked on the PICTURE, every pair: some probe lands on a different centre.
  for (let i = 0; i < PRACTISED_HOLDS.length; i++) {
    for (let j = i + 1; j < PRACTISED_HOLDS.length; j++) {
      const a = PRACTISED_HOLDS[i]; const b = PRACTISED_HOLDS[j];
      assert.ok(probes.some((p) => seen(p, a) !== seen(p, b)), `${spec(a)} and ${spec(b)} answer every probe alike`);
    }
  }
  // Minimal: no single face separates them — after y2 of the tumble the front is the scan's front again.
  for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) assert.equal(separates([face], PRACTISED_HOLDS), false, `${face} alone separates`);
  assert.equal(probes.length, 2);
  // On two axes, never one: two faces on one axis are one question asked twice.
  const axis = { U: 'y', D: 'y', R: 'x', L: 'x', F: 'z', B: 'z' };
  assert.notEqual(axis[probes[0]], axis[probes[1]], `the probes ${probes} lie on one axis`);
  // DROPPING EITHER PROBE leaves two holds a child could be in that the turns cannot tell apart.
  for (const drop of probes) {
    assert.equal(separates(probes.filter((p) => p !== drop), PRACTISED_HOLDS), false, `${drop} could be dropped`);
  }
  // The child's first turn is the face looking at them — the one the screen points at.
  assert.equal(probes[0], 'F');
});

test('the reports single out the hold the child is in, and nothing else', () => {
  const probes = separatingProbes();
  for (const h of PRACTISED_HOLDS) {
    const reports = probes.map((p) => seen(p, h));
    assert.deepEqual(holdFromReports(probes, reports), h, `reports from ${spec(h)} did not single it out`);
  }
  // A report no practised hold produces fits none, and says so rather than picking the nearest.
  assert.equal(holdFromReports(probes, ['U', 'U']), null);
  // One report is not enough to decide, so a half-finished round decides nothing.
  assert.equal(holdFromReports(probes.slice(0, 1), [seen(probes[0], PRACTISED_HOLDS[0])]), null);
});

test('a practice round leaves the cube exactly as it found it', () => {
  const round = probeRound(separatingProbes());
  assert.equal(round.length, 4);
  for (let seed = 1; seed <= 20; seed++) {
    const start = applyAlg(SOLVED_PIECES, randomAlg(lcg(seed), 25));
    assert.equal(toFacelets(applyAlg(start, round.join(' '))), toFacelets(start), `seed ${seed}: the round moved the cube on`);
  }
});

test('a list that repeats a hold is refused rather than "separated"', () => {
  assert.throws(() => separatingProbes([PRACTISED_HOLDS[1], PRACTISED_HOLDS[1]]), /listed twice/);
});

test('practice cannot raise trust: the module reaches nothing that holds it', async () => {
  // Plan §1 rule 4. Asserted on the import graph rather than promised in a comment.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/hold-probes.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./cube-moves.js', './cube-pieces.js', './solving-hold.js']);
});
