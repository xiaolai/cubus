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

import { OFFERED_PATTERNS, PATTERNS, patternById, patternBySelection, selectionOf } from '../lib/patterns.js';
import { OFFERED_TARGETS, TARGETS } from '../lib/stage-targets.js';
import { targetPicture } from '../lib/stage-picture.js';
import { routeSentence } from '../lib/stage-report.js';
import { applyAlg, toFacelets } from '../lib/cube-pieces.js';
import { SOLVED } from '../lib/cube-pieces.js';
import { STATE_PATTERNS } from './fixtures/pattern-ledger.mjs';

// ---- the two cuts, re-derived here from the ledger ----------------------------------------------
//
// `lib/patterns.js` records WHY eighteen of the ledger's seventy-three are offered. Prose is not a
// check, so both cuts are computed below and the offering is held to them in three directions:
// every row offered passes them, no two offered rows share a signature, and every signature the
// cuts admit IS offered. Widening the offering is then editing `CENTRED` or `MOVES_FLOOR` and
// appending the rows the failure names — never arguing with a comment.

/** A face's 3x3 as a mask of the cells matching its centre, canonical over the face's four
 *  rotations — the same quantity the ledger stores as `figures`, computed here from the shipped
 *  `look` instead of read from the row. Two independent computations of one fact, which is what
 *  lets the equality below mean something. */
const ROT9 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
function figuresOf(look) {
  const out = [];
  for (let k = 0; k < 6; k += 1) {
    const base = k * 9;
    let mask = 0;
    for (let i = 0; i < 9; i += 1) if (look[base + i] === look[base + 4]) mask |= 1 << i;
    let best = mask; let cur = mask;
    for (let q = 0; q < 3; q += 1) {
      let next = 0;
      for (let i = 0; i < 9; i += 1) if (cur & (1 << ROT9[i])) next |= 1 << i;
      cur = next;
      if (cur < best) best = cur;
    }
    out.push(best);
  }
  return out;
}

/** CUT ONE: the figure is CENTRED — unchanged by a half-turn of its own face. An off-centre figure
 *  reads at thumbnail size as a face somebody stopped halfway through, not as a design. */
const CENTRED = (mask) => {
  let turned = 0;
  for (let i = 0; i < 9; i += 1) if (mask >> i & 1) turned |= 1 << (8 - i);
  return turned === mask;
};
/** CUT TWO: three moves or more. One face turn is not a picture. */
const MOVES_FLOOR = 3;
/** What makes two pictures the same picture in a grid: the multiset of their face figures, which is
 *  what a whole-cube rotation permutes. */
const signatureOf = (look) => figuresOf(look).slice().sort((a, b) => a - b).join('-');

/** The ledger row an offered state pattern was copied from, by its ALGORITHM — the copied fact, and
 *  the only field every row has. Matching by NAME was what this file did until the catalogue grew:
 *  70 of the 73 rows have no name, so a name match could only ever cover the three the ledger
 *  happens to name and would have passed over the other fifteen in silence. */
const ledgerRowFor = (pattern) => STATE_PATTERNS.find((r) => r.alg === pattern.alg);

test('every state pattern the app offers is the ledger entry it claims to be', () => {
  const state = PATTERNS.filter((p) => p.kind === 'state');
  assert.ok(state.length > 0, 'no state patterns — this check went blind');
  for (const pattern of state) {
    const row = ledgerRowFor(pattern);
    assert.ok(row, `${pattern.id} ships the algorithm "${pattern.alg}", which the ledger does not hold`);
    // The figures are computed from the shipped picture and compared with the ones the GENERATOR
    // recorded. This is the check that makes the cuts below meaningful: without it they would be
    // applied to figures this file worked out for itself, and an error in `figuresOf` would make
    // every one of them agree with itself and say nothing about the cube.
    assert.deepEqual(figuresOf(pattern.look), row.figures,
      `${pattern.id}: the figures of the picture drawn are not the ones the ledger proved`);
    // A NAMED row keeps the ledger's name. The other fifteen are described rather than named, and
    // the case below derives those descriptions from the picture.
    if (row.name) assert.equal(pattern.name, row.name, `${pattern.id} renames a pattern the ledger names`);
  }
});

test('every offered state pattern passes both cuts, and no two are the same picture', () => {
  const state = OFFERED_PATTERNS.filter((p) => p.kind === 'state');
  assert.ok(state.length > 0, 'no offered state patterns — this check went blind');
  const bySignature = new Map();
  for (const pattern of state) {
    const row = ledgerRowFor(pattern);
    for (const mask of figuresOf(pattern.look)) {
      assert.ok(CENTRED(mask),
        `${pattern.id} shows an off-centre figure (${mask}) — it reads as an unfinished face`);
    }
    assert.ok(row.moves >= MOVES_FLOOR,
      `${pattern.id} is ${row.moves} moves from solved — a face turn or two is not a picture`);
    const sig = signatureOf(pattern.look);
    const twin = bySignature.get(sig);
    assert.equal(twin, undefined,
      `${pattern.id} and ${twin} are one face-shape signature — in a grid of thumbnails they read as the same picture twice`);
    bySignature.set(sig, pattern.id);
  }
});

// THE OTHER DIRECTION, and the one that fails when a row goes MISSING. The case above would pass
// just as happily on a catalogue of one: it only ever says that what is offered belongs. This says
// that what belongs is offered, so the eighteen cannot quietly become seventeen — and when the cuts
// are widened on purpose, the failure here names every row that has to be appended.
test('every picture the cuts admit is offered — the catalogue is the cut, not a sample of it', () => {
  const admitted = new Map();
  for (const row of STATE_PATTERNS) {
    if (row.moves < MOVES_FLOOR || !row.figures.every(CENTRED)) continue;
    const sig = row.figures.slice().sort((a, b) => a - b).join('-');
    const held = admitted.get(sig);
    // The representative is the SHORTEST row of its signature, and a row the ledger names wins a
    // tie — which is the only reason `lines` is offered rather than the equally short `U2 R2 D2 U2
    // R2 D2` sitting beside it in the ledger.
    const better = !held
      || (Boolean(row.name) && !held.name)
      || (Boolean(row.name) === Boolean(held.name) && row.moves < held.moves);
    if (better) admitted.set(sig, row);
  }
  const offered = new Set(OFFERED_PATTERNS.filter((p) => p.kind === 'state').map((p) => signatureOf(p.look)));
  const missing = [...admitted.entries()].filter(([sig]) => !offered.has(sig))
    .map(([sig, row]) => `${sig} (${row.alg})`);
  assert.deepEqual(missing, [], 'the cuts admit a picture nothing offers — append it, or narrow the cut');
  assert.equal(admitted.size, 18, 'the ledger now admits a different number of pictures than the eighteen shipped');
  // And the representative chosen is the one the rule picks, not merely A row of that signature.
  for (const pattern of OFFERED_PATTERNS.filter((p) => p.kind === 'state')) {
    assert.equal(pattern.alg, admitted.get(signatureOf(pattern.look)).alg,
      `${pattern.id} is not the shortest (ledger-named first) row of its signature`);
  }
});

// A NAME HERE IS A DESCRIPTION OF THE PICTURE, derived rather than invented — `lib/patterns.js`
// records why, and this is what makes it true of every row rather than of the row somebody checked.
// Fifteen of the eighteen have no ledger name, and a hand-written sentence about a cube is exactly
// the kind of claim that goes on being read long after it stopped describing anything.
const PHRASE = { 511: 'plain', 381: 'an H', 341: 'an X', 186: 'a plus', 56: 'a bar', 16: 'a dot' };
const COUNT_WORD = { 2: 'two', 4: 'four', 6: 'every' };
function describe(look) {
  const tally = new Map();
  for (const mask of figuresOf(look)) tally.set(mask, (tally.get(mask) ?? 0) + 1);
  const groups = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups.length === 1) return `${PHRASE[groups[0][0]]} on every face`;
  const parts = groups.map(([mask, n], i) => (i === 0
    ? `${PHRASE[mask]} on ${COUNT_WORD[n]} faces`
    : `${PHRASE[mask]} on ${COUNT_WORD[n]}`));
  return parts.length === 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

test('an unnamed picture is described by what it draws, and every name is its own', () => {
  for (const pattern of OFFERED_PATTERNS.filter((p) => p.kind === 'state')) {
    if (ledgerRowFor(pattern).name) continue;
    assert.equal(pattern.name, describe(pattern.look),
      `${pattern.id}: the name describes a different cube from the one it draws`);
  }
  // A grid of pictures is pressed by eye, and the name is the only channel a screen reader has —
  // two cards reading alike would be two cards it cannot tell apart. Ids too: one id is one
  // destination, and a duplicate would make `patternBySelection` answer about the wrong picture.
  const names = OFFERED_PATTERNS.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, `two pictures share a name: ${names.join(' / ')}`);
  const ids = OFFERED_PATTERNS.map((p) => selectionOf(p));
  assert.equal(new Set(ids).size, ids.length, `two pictures are pressed by one id: ${ids.join(' / ')}`);
});

test('a selection id resolves to the pattern it presses, and nothing else does', () => {
  for (const pattern of OFFERED_PATTERNS) {
    assert.equal(patternBySelection(selectionOf(pattern)), pattern,
      `${pattern.id} is not reachable by the id its own press carries`);
  }
  // A STAGE is not a picture, and this is the half the menu's tick and the grid's marking both
  // depend on: `patternBySelection('cross')` answering a pattern would tick a picture while the
  // cube was walking back to the cross.
  for (const stage of OFFERED_TARGETS) {
    assert.equal(patternBySelection(stage.id), null, `the stage "${stage.id}" resolved to a picture`);
  }
  assert.equal(patternBySelection(''), null);
  assert.equal(patternBySelection(undefined), null);
  assert.equal(patternBySelection('constructor'), null, 'an inherited name resolved to something');
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
  // TWENTY, and the number is the decision rather than a tally — §9.6 asks for exactly that. It was
  // five until 2026-10-04, and what the five were waiting for is what this list now records as
  // having arrived: the grid "that needs sorting, filtering or scrolling has become the primary
  // region, and 'only a new COMPOSITION is a new screen' makes that a screen rather than a longer
  // menu". That screen is `lib/screens/shapes.js`. The cube screen's MENU is still five pictures
  // long — the five last chosen (`lib/shape-recency.js`) — which is why the catalogue could grow at
  // all, and `shape-recency.test.mjs` is what holds that bound.
  //
  // THE ORDER IS PART OF THE DECISION, not incidental: the recency seed is this list's first five,
  // so the first five entries are exactly the menu that shipped before any of this and somebody who
  // has chosen nothing yet sees no change at all.
  assert.deepEqual(OFFERED_PATTERNS.map((p) => p.id), [
    'plus-every-face', 'x-every-face', 'checkerboard', 'lines', 'plus-minus',
    'bar4-dot2', 'bar4-h2', 'bar4-x2', 'plain2-bar2-dot2', 'bar6',
    'dot4-bar2', 'dot4-h2', 'dot4-plain2', 'dot4-x2', 'h2-bar2-dot2',
    'h2-plus2-bar2', 'h4-x2', 'plain4-h2', 'x2-bar2-dot2', 'x4-h2',
  ], 'the offered set changed — decide it, do not drift it');
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
