// The seeded sample has ONE source, and its draw is frozen.
//
// Every deterministic sample in this package — `method-steps.json`, the stage-target cases, the
// pattern ledger's spot checks, three benches — is "the cubes seed S produces". That sentence is
// only true while one function produces them. Six copies of the draw had accumulated by 2026-09-12
// (`fixtures/seeded-scrambles.mjs` records the census), and copies are the bad kind of defect: they
// agree until one is edited, and then two fixtures quietly describe different cubes while every
// test stays green.
//
// So two things are checked here, and the second is the one that matters:
//
//   1. NO SECOND GENERATOR. The draw's arithmetic appears in exactly one file under apps/web.
//   2. THE DRAW IS FROZEN. The literal scrambles for the seeds the committed fixtures were captured
//      against. `method-solver.test.mjs` already compares `method-steps.json` with a fresh capture,
//      but both sides of that comparison come from the generator — regenerate the fixture after
//      changing the draw and it goes green again, with the sample silently moved. A literal cannot.
//
// What (1) cannot catch: a NEW generator written with different constants. That is a real gap and
// naming it is the honest thing to do — the fingerprint is the arithmetic, so only a copy of THIS
// draw is detectable. A wholly separate PRNG would have to be caught in review.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { lcg, randomAlg, seededPairs, seededScrambles, seededStates } from './fixtures/seeded-scrambles.mjs';

const WEB = fileURLToPath(new URL('../', import.meta.url));

/** The one file allowed to contain the draw, and this file, which has to name it to look for it. */
const HOME = 'test/fixtures/seeded-scrambles.mjs';
const SELF = 'test/seeded-scrambles.test.mjs';

/** Directories under apps/web that are ours. `vendor` is built, `dist` is output, `node_modules` is
 *  somebody else's — and cubejs ships a generator of its own, which is not ours to consolidate. */
const NOT_OURS = new Set(['node_modules', 'vendor', 'dist', 'coverage']);
const SOURCE_EXT = /\.(js|mjs|cjs)$/;

function sources(dir = '', out = []) {
  for (const entry of readdirSync(WEB + dir, { withFileTypes: true })) {
    if (NOT_OURS.has(entry.name)) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (statSync(`${WEB}${rel}`).isDirectory()) sources(rel, out);
    else if (SOURCE_EXT.test(entry.name)) out.push(rel);
  }
  return out;
}

test('the draw exists in exactly one file under apps/web', () => {
  // The multiplier's digits, because that is what a copy would carry. Assembled from parts that do
  // not spell it, so the needle is absent from this file even before SELF is excluded — an exclusion
  // by name is a thing another file could imitate, and arithmetic is not.
  const needle = String(1664 * 1000 + 525);
  const carriers = sources()
    .filter((f) => f !== SELF)
    .filter((f) => readFileSync(WEB + f, 'utf8').includes(needle));
  assert.deepEqual(carriers, [HOME],
    'a second copy of the seeded draw has appeared. Import `lcg`, `randomAlg` or `seededScrambles` '
      + `from ${HOME} instead — a copy makes two fixtures describe different cubes the day one is edited.`);
});

test('the draw is frozen: the scrambles the committed fixtures were captured against', () => {
  // `method-steps.json` names its own seed and count, so the golden below is checkable against the
  // file rather than being a number someone typed.
  const baseline = JSON.parse(readFileSync(`${WEB}test/fixtures/method-steps.json`, 'utf8'));
  assert.equal(baseline.seed, 20260908);
  assert.equal(baseline.count, 12);
  assert.deepEqual(seededScrambles(baseline.count, baseline.seed), baseline.cases.map((c) => c.scramble),
    'the draw no longer produces the cubes method-steps.json was captured against');

  assert.equal(seededScrambles(1, 20260908)[0],
    "F2 U2 B2 D R' U R2 B F' L U' R L B2 U' F L' D' L F B' U2 L' F L2 D' B' F2 R B2");
  assert.equal(seededScrambles(1, 0x5747)[0],
    "B2 R2 L R2 U' F' D' B' F2 U' L' B2 R2 D U B D F L U2 D2 U B' R2 B2 U L' R D2 U2");
});

test('the length parameter shortens the walk without disturbing the stream', () => {
  // A shallow sample must be the SAME draw read less far, not a different one: the stage-target
  // fixtures and `method-steps.json` are then talking about the same stream. Held by the first alg
  // being a prefix — which is exactly what breaks if the length is ever applied by trimming after
  // the fact, or by re-seeding per alg.
  const long = seededScrambles(1, 20260908)[0];
  const short = seededScrambles(1, 20260908, 25)[0];
  assert.equal(short, long.split(' ').slice(0, 25).join(' '));
});

test('the primitives and the aggregates are one draw, not three', () => {
  const rnd = lcg(4242);
  const byHand = [randomAlg(rnd, 30), randomAlg(rnd, 30), randomAlg(rnd, 30)];
  assert.deepEqual(byHand, seededScrambles(3, 4242),
    'seededScrambles is no longer randomAlg drawn repeatedly from one lcg');

  const scrambles = seededScrambles(5, 777);
  assert.deepEqual(seededStates(5, 777), scrambles.map((alg) => applyAlg(SOLVED, alg)));
  assert.deepEqual(seededPairs(5, 777),
    scrambles.map((scramble) => ({ scramble, state: applyAlg(SOLVED, scramble) })));
});

test('a scramble never turns the same face twice in a row', () => {
  // The one property of the walk a reader is entitled to assume, and the one a rewrite would be
  // most likely to drop: `U U'` cancels, so a sample containing it is a sample of shallower cubes
  // than its length claims.
  for (const alg of seededScrambles(40, 31337, 25)) {
    const faces = alg.split(' ').map((m) => m[0]);
    assert.equal(faces.length, 25, `${alg} is not 25 turns`);
    for (let i = 1; i < faces.length; i++) {
      assert.notEqual(faces[i], faces[i - 1], `${alg} turns ${faces[i]} twice in a row`);
    }
  }
});
