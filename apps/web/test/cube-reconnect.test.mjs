// The reconnect readings and the two-side confirmation (lib/cube-reconnect.js) — pure, no DOM.
//
// The readings choose the picture and the words, NEVER the trust: a restarted counter plus one
// turn can reproduce a remembered report exactly, and a forged record in storage would otherwise
// have been a forged trust. So these tests pin four things the design rests on:
//
//   - the readings are exhaustive and disjoint — a fake cube for every row, 'no report'
//     included, and the first matching row wins;
//   - the serial changes nothing — the GAN16's counter is per-connection (measured with the
//     driver's CLI; the runs are recorded in the PRD), so a reading that leaned on it would
//     call every honest reconnect "turned";
//   - a forged or malformed record never yields a picture, let alone a trust claim;
//   - the confirmation compares by centre, up to rotation, and EXACTLY — two adjacent matching
//     sides confirm, an opposite pair does not, and a single wrong sticker costs a scan.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import Cube from '../vendor/cubejs.js';

import { READINGS, classifyReconnect, confirmCheck, facesAdjacent, sideMatches } from '../lib/cube-reconnect.js';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const move = (from, alg) => { const c = Cube.fromString(from); c.move(alg); return c.asString(); };

// The remembered pair: V is the truth the app was last sure of, r0 the cube's own raw report at
// that same moment. They differ — the interesting case, because it means a correction was active
// when the memory was written, and comparing raw-to-raw is what keeps that honest.
const V = move(SOLVED, "R U R' F");
const r0 = move(SOLVED, 'F2 D');
const LAST = { facelets: V, reported: r0, serial: 5, at: 1_756_000_000_000, how: 'cube' };

/** A deliberately impossible cube: one corner twisted in place. Correct colour counts, pinned
 *  centres, decodes cleanly — and a twist sum of 1 mod 3, which no sequence of turns reaches.
 *  Constructed, not sampled: a random two-sticker swap is occasionally a legal cube. */
const TWISTED = (() => {
  const s = SOLVED.split('');
  [s[8], s[9], s[20]] = [s[9], s[20], s[8]];
  return s.join('');
})();

// ---- the readings -----------------------------------------------------------------------------

test('no report: silence, or a report that cannot be checked — the picture is the memory', () => {
  for (const report of [null, undefined, '', 'garbage', TWISTED, SOLVED.slice(1)]) {
    const r = classifyReconnect({ report, last: LAST }, Cube);
    assert.equal(r.reading, 'no-report', `report ${JSON.stringify(report)?.slice(0, 20)} is not usable evidence`);
    assert.equal(r.candidate, V, 'the remembered truth is the picture, dimmed by the screen');
  }
  const bare = classifyReconnect({ report: null, last: null }, Cube);
  assert.equal(bare.reading, 'no-report');
  assert.equal(bare.candidate, null, 'nothing remembered and nothing reported: no picture to show');
});

test('nothing remembered: a first connection, a failed save, or a record not worth keeping', () => {
  // The classifier re-validates the two STATES it uses — the fields that become a picture or a
  // derivation. A malformed `how` or serial is the registry's to drop whole (cube-identity tests);
  // a record from storage reaches here only after that gate.
  const bads = [
    null,
    {},
    { facelets: V }, // no reported — the raw-to-raw comparison would have nothing to compare
    { facelets: 'garbage', reported: r0, how: 'cube' },
    { facelets: TWISTED, reported: r0, how: 'cube' }, // forged: looks like facelets, is not a cube
    { facelets: V, reported: TWISTED, how: 'cube' },
  ];
  for (const last of bads) {
    const r = classifyReconnect({ report: r0, last }, Cube);
    assert.equal(r.reading, 'nothing-remembered', `unusable record must be dropped whole: ${JSON.stringify(last)?.slice(0, 40)}`);
    assert.equal(r.candidate, null);
  }
});

test('same as we left it: the raw report equals the remembered raw — and the picture is the TRUTH', () => {
  const r = classifyReconnect({ report: r0, last: LAST }, Cube);
  assert.equal(r.reading, 'unchanged');
  // Raw-to-raw comparison, truth as the picture. Comparing the fresh report against the
  // remembered TRUTH would call an untouched, repaired cube "lost count" — V ≠ r0 here on purpose.
  assert.equal(r.candidate, V);
});

test('turned since: the remembered relationship applied to the fresh report', () => {
  // offset = V · r0⁻¹, so for a report r0·m the candidate must be V·m — the derivation a camera
  // repair makes, with the memory standing in for the scan. Checked over several drifts.
  for (const drift of ['B', "U'", 'R2 F', "L D' B2 U"]) {
    const r = classifyReconnect({ report: move(r0, drift), last: LAST }, Cube);
    assert.equal(r.reading, 'turned');
    assert.equal(r.candidate, move(V, drift), `candidate for drift "${drift}" is the truth moved the same way`);
  }
});

test('the serial decides nothing: it is a per-connection count and says nothing across a break', () => {
  for (const serial of [0, 5, 254, 60000]) {
    const r = classifyReconnect({ report: r0, last: { ...LAST, serial } }, Cube);
    assert.equal(r.reading, 'unchanged', `serial ${serial} must not turn an unchanged state into a turned one`);
  }
});

test('the readings are exhaustive, disjoint, and never a trust claim', () => {
  const cases = [
    classifyReconnect({ report: null, last: LAST }, Cube),
    classifyReconnect({ report: r0, last: null }, Cube),
    classifyReconnect({ report: r0, last: LAST }, Cube),
    classifyReconnect({ report: move(r0, 'B'), last: LAST }, Cube),
  ];
  assert.deepEqual(cases.map((c) => c.reading), READINGS, 'one fake cube per row, each landing on its own reading');
  for (const c of cases) {
    assert.deepEqual(Object.keys(c).sort(), ['candidate', 'reading'], 'a reading carries a picture and a word — no trusted, no offset');
  }
});

// ---- the two-side confirmation ----------------------------------------------------------------

const side = (s, f) => s.slice('URFDLB'.indexOf(f) * 9, 'URFDLB'.indexOf(f) * 9 + 9);
const rot = (s) => s[6] + s[3] + s[0] + s[7] + s[4] + s[1] + s[8] + s[5] + s[2];

test('faces share an edge unless they are opposite', () => {
  assert.ok(facesAdjacent('F', 'U'));
  assert.ok(facesAdjacent('L', 'D'));
  assert.equal(facesAdjacent('F', 'B'), false);
  assert.equal(facesAdjacent('U', 'D'), false);
  assert.equal(facesAdjacent('R', 'L'), false);
  assert.equal(facesAdjacent('U', 'U'), false);
  assert.equal(facesAdjacent('X', 'U'), false, 'an invalid face is adjacent to nothing');
  // Own properties only: `in` walks the prototype chain, and an inherited name counting as a
  // face would let a forged capture entry reach the adjacency that confirms.
  assert.equal(facesAdjacent('constructor', 'U'), false, 'inherited names are not faces');
  assert.equal(facesAdjacent('__proto__', 'F'), false);
});

test('a captured side matches any way up — the app cannot know how a side was held', () => {
  const f = side(V, 'F');
  assert.ok(sideMatches(V, 'F', f));
  assert.ok(sideMatches(V, 'F', rot(f)));
  assert.ok(sideMatches(V, 'F', rot(rot(f))));
  assert.ok(sideMatches(V, 'F', rot(rot(rot(f)))));
});

test('but EXACTLY: one wrong sticker fails, two wrong stickers fail — never the scanner\'s tolerance', () => {
  const f = side(V, 'F');
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'U' ? 'D' : 'U') + s.slice(i + 1);
  assert.equal(sideMatches(V, 'F', flip(f, 0)), false, 'one misread sticker costs a scan, never a false yes');
  assert.equal(sideMatches(V, 'F', flip(flip(f, 0), 1)), false, 'the two-sticker tolerance is one short of a quarter turn\'s three, and is not applied here');
  assert.equal(sideMatches(V, 'F', '?'.repeat(9)), false, 'an unread sticker is not a match');
});

test('two adjacent matching sides confirm; an opposite pair, or one side, only waits', () => {
  const F = { face: 'F', stickers: side(V, 'F') };
  const U = { face: 'U', stickers: rot(side(V, 'U')) }; // any way up
  const B = { face: 'B', stickers: side(V, 'B') };
  assert.equal(confirmCheck(V, [F]).verdict, 'pending', 'one side passes a single-turn drift a third of the time — not a confirmation');
  assert.equal(confirmCheck(V, [F, B]).verdict, 'pending', 'opposite sides fail together: a turn of F leaves B exact and F matching under rotation');
  assert.equal(confirmCheck(V, [F, U]).verdict, 'confirmed');
  assert.equal(confirmCheck(V, [F, B, U]).verdict, 'confirmed', 'the adjacent pair confirms whatever else was shown');
});

test('any mismatched side sends the flow into the full scan — including over matching ones', () => {
  const F = { face: 'F', stickers: side(V, 'F') };
  const wrongU = { face: 'U', stickers: side(move(V, 'F'), 'U') };
  // Guard the guard: the turned cube's U side must genuinely differ under every rotation, or
  // the case below tests nothing.
  assert.equal(sideMatches(V, 'U', wrongU.stickers), false);
  const r = confirmCheck(V, [F, wrongU]);
  assert.equal(r.verdict, 'mismatch');
  assert.deepEqual(r.matched, ['F'], 'the sides already read still count — the repair continues from them');
  assert.deepEqual(r.mismatched, ['U']);
});

test('the mechanism the measurement rests on: one untracked turn escapes its own face, not its neighbour', () => {
  const physical = move(V, 'U'); // the likeliest drift: one quarter turn nobody counted
  const seenU = side(physical, 'U');
  const seenF = side(physical, 'F');
  assert.ok(sideMatches(V, 'U', seenU), 'a turn only rotates its own face\'s stickers, so that face matches under rotation');
  assert.equal(sideMatches(V, 'F', seenF), false, 'but an adjacent face gained a row it did not have');
  assert.equal(confirmCheck(V, [{ face: 'U', stickers: seenU }, { face: 'F', stickers: seenF }]).verdict, 'mismatch');
});

test('unusable input is a mismatch, never a yes — the safe direction is always the scan', () => {
  assert.equal(confirmCheck(null, [{ face: 'F', stickers: side(V, 'F') }]).verdict, 'mismatch');
  assert.equal(confirmCheck('short', [{ face: 'F', stickers: side(V, 'F') }]).verdict, 'mismatch');
  assert.equal(confirmCheck(V, [{ face: 'Q', stickers: side(V, 'F') }]).verdict, 'mismatch', 'a side with no face to compare against cannot support a yes');
  assert.equal(confirmCheck(V, []).verdict, 'pending', 'nothing captured yet is not a refusal, it is a wait');
  // A capture LIST that is not a list, and a malformed entry riding beside two valid matches:
  // both land on the scan. A skipped entry once let the valid pair confirm straight past it.
  assert.equal(confirmCheck(V, null).verdict, 'mismatch', 'no list is not an empty list');
  assert.equal(confirmCheck(V, 'garbage').verdict, 'mismatch');
  const F = { face: 'F', stickers: side(V, 'F') };
  const U = { face: 'U', stickers: side(V, 'U') };
  assert.equal(confirmCheck(V, [F, U, null]).verdict, 'mismatch', 'a malformed entry is a mismatch, never a skip');
  assert.equal(confirmCheck(V, [F, U, 42]).verdict, 'mismatch');
  // And a candidate that is sticker-shaped but not a cube: structurally impossible strings fail
  // with or without the library; a legal-looking forgery (one twisted corner) needs the full
  // gate, which runs when cubejs is injected — the trust-granting path always injects it.
  assert.equal(confirmCheck('A'.repeat(54), [F]).verdict, 'mismatch', 'the wrong alphabet cannot confirm');
  assert.equal(confirmCheck('U'.repeat(54), [F]).verdict, 'mismatch', 'fifty-four of one colour is not a cube');
  const tf = { face: 'F', stickers: side(TWISTED, 'F') };
  const tu = { face: 'U', stickers: side(TWISTED, 'U') };
  assert.equal(confirmCheck(TWISTED, [tf, tu], Cube).verdict, 'mismatch', 'a forged candidate never confirms when the full gate can run');
  // An injected validator that is NOT the library refuses rather than silently downgrading to
  // the structural check — a broken dependency must fail closed on a trust-granting path.
  assert.equal(confirmCheck(V, [F, U], {}).verdict, 'mismatch', 'a broken Cube injection refuses');
  assert.equal(confirmCheck(V, [F, U], 42).verdict, 'mismatch');
  assert.equal(confirmCheck(V, [F, U]).verdict, 'confirmed', 'while an ABSENT one defers to the structural gate');
});
