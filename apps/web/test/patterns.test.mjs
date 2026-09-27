// The offered pictures, held to the ledger that proved them and to the rule that keeps them out of
// the stage row.
//
// `lib/patterns.js` COPIES three state patterns out of `test/fixtures/pattern-ledger.mjs`, because
// the app cannot import a test fixture and the ledger is a generated research artifact rather than
// shipped data. A copy is a second place for a fact to live, so the first case here compares them
// sticker for sticker and move for move. Without it the app could draw a picture the ledger never
// proved, and `pattern-ledger.test.mjs` — which holds the LEDGER to its claims — would stay green
// through it, because it never looks at what the app ships.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OFFERED_PATTERNS, PATTERNS, patternById } from '../lib/patterns.js';
import { OFFERED_TARGETS, TARGETS } from '../lib/stage-targets.js';
import { targetPicture } from '../lib/stage-picture.js';
import { routeSentence } from '../lib/stage-report.js';
import { applyAlg, toFacelets } from '../lib/cube-pieces.js';
import { SOLVED } from '../lib/cube-pieces.js';
import { STATE_PATTERNS } from './fixtures/pattern-ledger.mjs';

test('every state pattern the app offers is the ledger entry it claims to be', () => {
  const state = PATTERNS.filter((p) => p.kind === 'state');
  assert.ok(state.length > 0, 'no state patterns — this check went blind');
  for (const pattern of state) {
    const row = STATE_PATTERNS.find((r) => r.name === pattern.name);
    assert.ok(row, `${pattern.id} claims the name "${pattern.name}", which the ledger does not hold`);
    // The ALGORITHM is the copied fact, so the algorithm is what is compared. The ledger's `look` is
    // deliberately NOT compared: see the next case.
    assert.equal(pattern.alg, row.alg, `${pattern.id}'s algorithm is not the ledger's`);
  }
});

// THE PICTURE IS DERIVED FROM THE MOVES, and this pins the reason rather than the result.
//
// The first version of this file copied the ledger's `look` beside its `alg` and asserted they
// agreed. They do not: the ledger deduplicates over all 48 symmetries plus inversion, so `look` is
// the canonical representative of a rotation class and `alg` reaches a different member of it. **68
// of the 73 rows disagree.** Shipping both would have drawn a target the route does not arrive at —
// the right picture, the cube turned — and The Checkerboard is one of the five that coincide, so
// checking the first entry by hand would have shown nothing wrong.
//
// `lib/patterns.js` computes the picture now, so the two cannot drift. This case guards the property
// that made that necessary, so nobody "restores" the copy: for a pattern the app offers, the picture
// must be what the algorithm produces — and it must NOT be assumed equal to the ledger's look.
// `picture` AND `look` ARE ONE FACT, and nothing said so. Routing verifies against `look` while the
// target drawing reads `picture`, so replacing every `picture` with solved facelets passed all 77
// tests — the child would have been shown a target the route was never aiming at (audit, 2026-09-27).
test('a state pattern\'s picture and its look are the same string, and that is what is drawn', () => {
  const state = PATTERNS.filter((p) => p.kind === 'state');
  assert.ok(state.length > 0, 'no state patterns — this check went blind');
  for (const pattern of state) {
    assert.equal(pattern.picture, pattern.look,
      `${pattern.id}: the picture drawn and the picture verified against are different cubes`);
    assert.equal(targetPicture(pattern), pattern.look,
      `${pattern.id}: targetPicture does not return the picture the route lands on`);
  }
});

test('a state pattern\'s picture is what its algorithm produces, not the ledger\'s canonical look', () => {
  let differed = 0;
  for (const pattern of PATTERNS.filter((p) => p.kind === 'state')) {
    assert.equal(pattern.look, toFacelets(applyAlg(SOLVED, pattern.alg)),
      `${pattern.id}: the picture is not what "${pattern.alg}" produces`);
    const row = STATE_PATTERNS.find((r) => r.name === pattern.name);
    if (row && row.look !== pattern.look) differed += 1;
  }
  // The trap is still live in the data this file reads from, which is why the derivation stays.
  assert.ok(differed > 0,
    'no offered pattern now differs from its ledger look — if the ledger stopped storing canonical '
      + 'representatives, this guard is measuring nothing and the comment above needs rewriting');
});

// The rule plan §9.6 spent a fortnight holding: patterns are their own feature, and every chip in the
// Restore row means "how far back am I" with a move count beside it. A pattern is not back, it is
// sideways, and a pattern that reached that row would be read as a stage of the method.
test('no pattern is offered as a stage, and the Restore row is exactly the six', () => {
  assert.deepEqual(OFFERED_TARGETS.map((t) => t.id),
    ['cross', 'first-layer', 'two-layers', 'top-cross', 'corners-home', 'solved'],
    'the Restore row changed — a pattern has drifted into the stage row, or a stage has left it');
  for (const pattern of PATTERNS) {
    if (pattern.kind !== 'set') continue;
    assert.equal(pattern.target.offered, false,
      `${pattern.id}'s target is offered as a stage as well as a pattern`);
  }
});

// A set pattern is answered by the exact engine, so its target has to be a real one with both a
// predicate and the independent `verify` a route is replayed against. `targetById` throws on an
// unknown id, so the registry cannot name a target that does not exist — this checks the rest.
test('every set pattern names a target the engine can actually answer', () => {
  const set = PATTERNS.filter((p) => p.kind === 'set');
  assert.ok(set.length > 0, 'no set patterns — this check went blind');
  for (const pattern of set) {
    assert.ok(TARGETS.includes(pattern.target), `${pattern.id}'s target is not in TARGETS`);
    assert.equal(typeof pattern.target.predicate, 'function', `${pattern.id}: no predicate`);
    assert.equal(typeof pattern.target.verify, 'function', `${pattern.id}: no independent verify`);
  }
});

// EVERY PICTURE MUST DRAW, because the menu is pictures and nothing else — 70 of the ledger's 73 have
// no name at all, so a thumbnail that fails to render is an entry a child cannot identify or press.
test('every offered pattern yields a drawable 54-sticker picture', () => {
  // FIVE, and the number is the decision rather than a tally — §9.6 asks for exactly that. The rest
  // of the ledger stays behind `offered: false`, and growing past about a dozen is a different
  // question: a grid that needs sorting, filtering or scrolling has become the primary region, and
  // "only a new COMPOSITION is a new screen" makes that a screen rather than a longer menu.
  assert.deepEqual(OFFERED_PATTERNS.map((p) => p.id),
    ['plus-every-face', 'x-every-face', 'checkerboard', 'lines', 'plus-minus'],
    'the offered set changed — decide it, do not drift it');
  // EVERY OFFERED PATTERN MUST BE ROUTABLE, by one of the two ways there are. A set pattern names a
  // target the exact engine answers; a state pattern carries a picture `pattern-route.js` routes to
  // and `walk-resolver.js` refuses to substitute anything else for. A pattern with neither is a
  // picture a child can press and never arrive at.
  for (const pattern of OFFERED_PATTERNS) {
    assert.ok(pattern.target || pattern.picture,
      `${pattern.id} is offered but has neither a target nor a picture, so nothing can route to it`);
  }
  for (const pattern of OFFERED_PATTERNS) {
    const look = pattern.kind === 'state' ? pattern.look : targetPicture(pattern.target.id);
    assert.equal(look.length, 54, `${pattern.id}: picture is not 54 stickers`);
    assert.match(look, /^[UDLRFB?]{54}$/, `${pattern.id}: picture holds something that is not a sticker`);
    // A set pattern MUST leave pieces grey — that is what makes it a set rather than a state, and a
    // fully-painted "set" pattern would be a single cube wearing the cheap label.
    const free = [...look].filter((c) => c === '?').length;
    if (pattern.kind === 'set') assert.ok(free > 0, `${pattern.id} is a set pattern that claims every sticker`);
    else assert.equal(free, 0, `${pattern.id} is a state pattern that leaves a sticker unclaimed`);
  }
});

// The option for the rest of the ledger is the SHAPE of the file, and this is what makes that true
// rather than aspirational: an unoffered record must be a complete, drawable one, so adding the other
// 70 is appending rows and flipping a boolean. It passes vacuously today by design — there are no
// unoffered patterns yet — which is why it asserts the mechanism on every record instead.
test('offering more is data: every record is complete whether offered or not', () => {
  for (const pattern of PATTERNS) {
    assert.equal(typeof pattern.offered, 'boolean', `${pattern.id}: offered is not a boolean`);
    assert.ok(pattern.name && pattern.name.trim().length > 0, `${pattern.id}: no name`);
    assert.equal(patternById(pattern.id), pattern, `${pattern.id}: not reachable by its own id`);
    assert.ok(Object.isFrozen(pattern), `${pattern.id}: a caller could rewrite the registry`);
  }
  assert.deepEqual(OFFERED_PATTERNS.map((p) => p.id), PATTERNS.filter((p) => p.offered).map((p) => p.id));
});

// A PICTURE IS A WAY TO, NEVER A WAY BACK — and it never claims a minimum.
//
// Every sentence in STAGE_COPY was written for a stage, where "back" is right: a stage is somewhere
// the cube WAS and the child has lost. A picture is somewhere it has never been, so "a way back to
// The Checkerboard" is false, and a child who reads it looks for a mistake they did not make. The
// first version of this branch also produced "a way to the The Checkerboard", because a picture's
// name brings its own article where a stage's does not.
//
// The claim half matters more than the wording half: two-phase cannot prove a minimum, so no route
// to a picture may ever reach the "shortest" sentence. `routeToPicture` returns an explicit
// `minimal: false` rather than leaving the field absent for the copy to read as falsy.
test('every offered pattern is described as a way TO it, with no minimality claim', () => {
  for (const pattern of OFFERED_PATTERNS) {
    const destination = pattern.target ?? { name: pattern.name, picture: pattern.look };
    // BOTH MINIMALITY VALUES. A SET pattern is a real target answered by the EXACT engine, so its
    // route can legitimately arrive with `minimal: true` — and supplying only false meant a mutation
    // that emitted "shortest" for a shape passed every case (audit, 2026-09-27). The wording is a
    // property of the DESTINATION, not of how good the answer was.
    for (const minimal of [false, true]) {
      const said = routeSentence({ moves: 11, minimal, overshoot: false }, destination);
      assert.doesNotMatch(said, /\bback\b/, `${pattern.id}: a picture is not somewhere the cube has been`);
      assert.doesNotMatch(said, /shortest/, `${pattern.id} (minimal=${minimal}): a shape route may not claim a minimum`);
      assert.match(said, /a way to /, `${pattern.id}: ${said}`);
      assert.doesNotMatch(said, /to the (a|an|The) /, `${pattern.id}: doubled article — ${said}`);
      assert.ok(said.includes(pattern.name), `${pattern.id}: the sentence does not name the picture`);
    }
    // AND OVERSHOOT IS SAID, never hidden behind the shape's own wording: a fallback that solved the
    // whole cube did not arrive where the heading says.
    const over = routeSentence({ moves: 11, minimal: false, overshoot: true }, destination);
    assert.match(over, /whole cube/, `${pattern.id}: an overshoot read as if it had arrived — ${over}`);
  }
  // AND A STAGE IS UNTOUCHED, which is the half that proves the branch is a branch and not a
  // rewrite: deleting the picture arm must not be invisible here.
  assert.match(routeSentence({ moves: 7, minimal: true }, { name: 'cross' }), /the shortest way back/);
  assert.match(routeSentence({ moves: 7, minimal: false }, { name: 'cross' }), /a way back/);
});

test('a cube already showing a picture is told so, not handed a zero-move route', () => {
  for (const pattern of OFFERED_PATTERNS) {
    const destination = pattern.target ?? { name: pattern.name, picture: pattern.look };
    const said = routeSentence({ moves: 0, minimal: false, overshoot: false }, destination);
    assert.doesNotMatch(said, /move/, `${pattern.id}: a child reads a move count and looks for moves`);
    assert.ok(said.includes(pattern.name), `${pattern.id}: ${said}`);
  }
});
