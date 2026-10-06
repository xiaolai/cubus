// The catalogue and its computed effects — plan items 2.1 and 2.2.
//
// THE ORACLE IS CUBEJS, not the helper under test. Every effect assertion below recomputes the cycle
// structure from `cubejs`'s OWN `cp`/`co`/`ep`/`eo`, a different implementation with a different
// cubie numbering. Cycle-length multisets and orientation counts are invariant under renumbering,
// which is exactly why they can be compared across two implementations that agree about nothing
// else. Checking `alg-effect.js` against `cube-pieces.js` would be checking it against itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Cube from 'cubejs';

import { FIXTURE, census, fixtureText } from '../bench/alg-catalogue.mjs';
import { ALG_ENTRIES, NOT_ALGORITHMS, RUNG_TABLE, entriesForRungs, entryById } from '../lib/alg-catalogue.js';
import { PURPOSED_STAGES, purposeFor } from '../lib/method-lesson.js';
import { CASE_SHAPES, CYCLE_SHAPES, describeCase, describeEffect, effectOf, signatureOf } from '../lib/alg-effect.js';
import { SOLVED, applyAlg, toFacelets } from '../lib/cube-pieces.js';
import { stateFrom } from '../lib/script-view.js';
import { CATALOGUE_CENSUS } from './fixtures/alg-catalogue.mjs';
import { METHOD_ALGORITHMS } from './fixtures/algorithm-ledger.mjs';

const SOLVED_FACELETS = toFacelets(SOLVED);
const source = (f) => readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8');

/** Cycle lengths of a permutation array, longest first — written here a second time, deliberately,
 *  so the test does not import the function it is checking. */
const cycles = (perm) => {
  const seen = new Array(perm.length).fill(false);
  const out = [];
  for (let i = 0; i < perm.length; i += 1) {
    if (seen[i] || perm[i] === i) continue;
    let j = i; let n = 0;
    while (!seen[j]) { seen[j] = true; n += 1; j = perm[j]; }
    out.push(n);
  }
  return out.sort((a, b) => b - a);
};

/** What cubejs says an algorithm does, in the four invariant quantities. */
const oracleEffect = (alg) => {
  const c = new Cube();
  c.move(alg);
  return {
    corners: cycles(c.cp),
    edges: cycles(c.ep),
    twisted: c.co.filter((v) => v !== 0).length,
    flipped: c.eo.filter((v) => v !== 0).length,
  };
};

test('the catalogue holds every distinct algorithm, and the count is derived', () => {
  assert.equal(ALG_ENTRIES.length, 137);
  // Derived, never written: the number must not appear in the module that produces it.
  assert.ok(!/\b137\b/.test(source('alg-catalogue.js')), 'the count is written into alg-catalogue.js');
  assert.equal(new Set(ALG_ENTRIES.map((e) => e.alg)).size, 137, 'an algorithm is filed twice');
  assert.equal(new Set(ALG_ENTRIES.map((e) => e.id)).size, 137, 'two entries share an id');
});

test('the two non-algorithms are excluded, and named', () => {
  assert.deepEqual([...NOT_ALGORITHMS].sort(), ['align', 'turn']);
  for (const name of NOT_ALGORITHMS) assert.equal(entryById(name), null, `${name} is in the catalogue`);
});

test('every entry round-trips: its case, then its sequence, is solved', () => {
  for (const e of ALG_ENTRIES) {
    assert.notEqual(e.setup, SOLVED_FACELETS, `${e.id}: its case is already solved`);
    const back = toFacelets(applyAlg(stateFrom(e.setup), e.scanAlg));
    assert.equal(back, SOLVED_FACELETS, `${e.id}: its sequence does not answer its own case`);
  }
});

test('every algorithm filed twice keeps both provenances', () => {
  const shared = ALG_ENTRIES.filter((e) => e.provenance.length > 1);
  // SIX, not four. Four are the same move string in the taught and the generated pool; the other two
  // are filed twice WITHIN the taught pool — `R U R'` is both the righty insert and the right
  // trigger, and `F' U' F` likewise. The merge is equally responsible for those, and an expectation
  // of four would have hidden them.
  assert.equal(shared.length, 6, 'the number of algorithms filed under more than one set moved');
  for (const e of shared) {
    // Both NAMES survive — a set id alone would not say which case it answers under.
    assert.equal(new Set(e.provenance.map((p) => p.name)).size, e.provenance.length, `${e.id}: a name was lost`);
    assert.equal(new Set(e.provenance.map((p) => p.set)).size, e.provenance.length, `${e.id}: a set was lost`);
  }
  const acrossPools = shared.filter((e) => e.provenance.some((p) => p.set.endsWith('-full')));
  assert.equal(acrossPools.length, 4, 'the two pools overlap in four places');
  for (const e of acrossPools) {
    const sets = e.provenance.map((p) => p.set);
    assert.ok(sets.some((s) => !s.endsWith('-full')), `${e.id}: lost its taught provenance`);
    assert.ok(sets.some((s) => s.endsWith('-full')), `${e.id}: lost its generated provenance`);
  }
  const withinTaught = shared.filter((e) => e.provenance.every((p) => !p.set.endsWith('-full')));
  assert.deepEqual(withinTaught.map((e) => e.id).sort(), ['left-hand', 'right-hand']);
});

test('every effect matches cubejs, which computed it differently', () => {
  for (const e of ALG_ENTRIES) {
    const oracle = oracleEffect(e.alg);
    assert.deepEqual([...e.effect.corners], oracle.corners, `${e.id}: corner cycles`);
    assert.deepEqual([...e.effect.edges], oracle.edges, `${e.id}: edge cycles`);
    assert.equal(e.effect.twisted, oracle.twisted, `${e.id}: twisted corners`);
    assert.equal(e.effect.flipped, oracle.flipped, `${e.id}: flipped edges`);
  }
});

/** The number words the labels use, back to digits — so a claim can be read out of a sentence. */
const WORD_VALUE = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/**
 * What a label SAYS about one kind of piece, decoded back into cycle lengths.
 *
 * Written as the inverse of the phrasing rather than by importing the shape table, so that a
 * phrase which describes the wrong thing fails: reusing the table would only prove the table
 * equals itself. Every shape the module can emit has a line here, and an unrecognised clause
 * returns a marker that cannot equal any measurement.
 */
function cyclesSaidAbout(label, kind) {
  // "and swaps two more" is the tail of ONE clause (the 3+2 shape), not a clause boundary — so it
  // is hidden from the splitter and put back, rather than teaching the splitter every shape.
  const JOINED = '<<AND-MORE>>';
  const clause = label.replaceAll(' and swaps two more', JOINED)
    .split(/,| and (?=swaps|cycles|twists|flips)/)
    .map((c) => c.replaceAll(JOINED, ' and swaps two more'))
    .map((c) => c.trim())
    // A PERMUTATION clause only: "twists four corners" names corners and says nothing about
    // their cycles, and treating it as one made an entry with no corner cycles unreadable.
    .find((c) => /^(swaps|cycles)/.test(c) && new RegExp(`\\b${kind}\\b`).test(c));
  if (!clause) return [];
  const shapes = [
    [new RegExp(`^swaps two pairs of ${kind}$`), () => [2, 2]],
    [new RegExp(`^cycles two separate sets of three ${kind}$`), () => [3, 3]],
    [new RegExp(`^cycles three ${kind} and swaps two more$`), () => [3, 2]],
    [new RegExp(`^swaps (\\w+) ${kind}$`), (m) => [WORD_VALUE[m[1]]]],
    [new RegExp(`^cycles (\\w+) ${kind}$`), (m) => [WORD_VALUE[m[1]]]],
  ];
  for (const [re, take] of shapes) {
    const m = re.exec(clause);
    if (m) return take(m);
  }
  return ['unreadable', clause];
}

test('every algorithm gets a label, and the WORDS account for every piece it disturbs', () => {
  // READ OUT OF THE SENTENCE, not out of the numbers the sentence was built from. The first
  // version of this compared `labelParts` with the effect — and `labelParts` is a copy of the
  // effect, so it agreed with itself for every algorithm and could not have failed (audit,
  // 2026-09-27). It is the repository's own rule: do not select a test's ground truth with the
  // function under test.
  for (const e of ALG_ENTRIES) {
    assert.ok(e.label.length > 0, `${e.id}: no label`);
    const said = e.label;
    const twisted = /twists (\w+) corners/.exec(said);
    const flipped = /flips (\w+) edges/.exec(said);
    assert.equal(twisted ? WORD_VALUE[twisted[1]] : 0, e.effect.twisted, `${e.id}: "${said}" misstates the twists`);
    assert.equal(flipped ? WORD_VALUE[flipped[1]] : 0, e.effect.flipped, `${e.id}: "${said}" misstates the flips`);
    // Each kind's clause is DECODED back into cycle lengths and compared with what was measured.
    // An independent inverse of the shape table rather than a re-use of it: the words are read as
    // a child reads them, and a phrase that says the wrong thing fails here.
    for (const kind of ['corners', 'edges']) {
      assert.deepEqual(cyclesSaidAbout(said, kind), [...e.effect[kind]],
        `${e.id}: "${said}" does not describe its ${kind}`);
    }
  }
});

/**
 * What a CASE sentence says about one kind of piece, decoded back into cycle lengths.
 *
 * The independent inverse of `CASE_SHAPES`, for the same reason `cyclesSaidAbout` is the independent
 * inverse of `CYCLE_SHAPES`: importing the table would only prove the table equals itself. The two
 * sentences describe the same numbers in opposite voices — "cycles three corners" is what the
 * algorithm DOES, "three corners are in the wrong places" is what the learner is LOOKING AT.
 */
function caseSaidAbout(said, kind) {
  const JOINED = '<<AND-MORE>>';
  const clause = said.replaceAll(' and two more are swapped', JOINED)
    .split(/,| and (?=two |three |four |five |two pairs)/)
    .map((c) => c.replaceAll(JOINED, ' and two more are swapped'))
    .map((c) => c.trim())
    // A PERMUTATION clause only: "two corners are turned the wrong way" names corners and says
    // nothing about their cycles.
    .find((c) => new RegExp(`\\b${kind}\\b`).test(c) && /(swapped|wrong places)/.test(c));
  if (!clause) return [];
  const shapes = [
    [new RegExp(`^two pairs of ${kind} are swapped$`), () => [2, 2]],
    [new RegExp(`^two separate sets of three ${kind} are in the wrong places$`), () => [3, 3]],
    [new RegExp(`^three ${kind} are in the wrong places and two more are swapped$`), () => [3, 2]],
    [new RegExp(`^two ${kind} are swapped$`), () => [2]],
    [new RegExp(`^(\\w+) ${kind} are in the wrong places$`), (m) => [WORD_VALUE[m[1]]]],
  ];
  for (const [re, take] of shapes) {
    const m = re.exec(clause);
    if (m) return take(m);
  }
  return ['unreadable', clause];
}

test('every case sentence describes the state CUBEJS says the case is in', () => {
  // `describeCase` supplies the heading over a diagram and the diagram's own accessible label, and
  // nothing checked its words at all — the picture tests compared pictures, and the label tests
  // covered `describeEffect`'s sentence, which is a different one (found by audit, 2026-09-28).
  //
  // A case is the algorithm UNDONE, and an inverse has the same cycle type and the same orientation
  // counts, so the numbers to compare against are the oracle's — cubejs, applied to the algorithm,
  // computed a different way from the catalogue's own tables.
  let checked = 0;
  for (const e of ALG_ENTRIES.filter((x) => /^(?:oll|pll|f2l):/.test(x.id))) {
    const said = describeCase(e.effect, e.id);
    const oracle = oracleEffect(e.alg);
    const twisted = /(\w+) corners are turned the wrong way/.exec(said);
    const flipped = /(\w+) edges are flipped/.exec(said);
    assert.equal(twisted ? WORD_VALUE[twisted[1]] : 0, oracle.twisted, `${e.id}: "${said}" misstates the twists`);
    assert.equal(flipped ? WORD_VALUE[flipped[1]] : 0, oracle.flipped, `${e.id}: "${said}" misstates the flips`);
    for (const kind of ['corners', 'edges']) {
      assert.deepEqual(caseSaidAbout(said, kind), oracle[kind], `${e.id}: "${said}" does not describe its ${kind}`);
    }
    checked += 1;
  }
  assert.ok(checked >= 100, `only ${checked} generated cases reached the check`);
});

test('the two sentence tables answer for exactly the same shapes', () => {
  // The check `CASE_SHAPES`' own comment promises — "held to them by a test, so a shape can never be
  // added to one table and forgotten in the other" — and did not have.
  assert.deepEqual(Object.keys(CASE_SHAPES).sort(), Object.keys(CYCLE_SHAPES).sort());
});

test('the exhaustiveness check would catch a dropped clause', () => {
  // The mutation the old circular version could not see: a label with its orientation clause
  // removed still had matching `labelParts`, so nothing failed.
  const e = ALG_ENTRIES.find((x) => x.effect.twisted > 0 && x.effect.corners.length > 0);
  const cut = e.label.replace(/, and twists \w+ corners|and twists \w+ corners|twists \w+ corners/, '').trim();
  assert.notEqual(cut, e.label, 'precondition: this entry has a twist clause to remove');
  const twisted = /twists (\w+) corners/.exec(cut);
  assert.notEqual(twisted ? WORD_VALUE[twisted[1]] : 0, e.effect.twisted, 'a dropped clause would still pass');
});

test('entries that both permute and orient are covered, and there are many', () => {
  const both = ALG_ENTRIES.filter((e) => (e.effect.corners.length || e.effect.edges.length) && (e.effect.twisted || e.effect.flipped));
  assert.ok(both.length > 40, `only ${both.length} entries permute and orient at once`);
  for (const e of both) {
    assert.ok(/twists|flips/.test(e.label), `${e.id}: orientation missing from "${e.label}"`);
    assert.ok(/swaps|cycles/.test(e.label), `${e.id}: permutation missing from "${e.label}"`);
  }
});

test('a cycle shape the table does not know throws and names the case', () => {
  const unknown = { corners: [7], edges: [], twisted: 0, flipped: 0, order: 1, moves: 1, pieces: 7 };
  assert.throws(() => describeEffect(unknown, 'made-up'), /no phrase for corners cycle shape \[7\].*made-up/);
});

test('no label is written per algorithm — the words come from shapes alone', () => {
  const text = source('alg-effect.js');
  for (const id of ['sune', 'antisune', 'headlights', 'u-perm-a', 'drop-in']) {
    assert.ok(!text.includes(`'${id}'`), `alg-effect.js special-cases ${id}`);
  }
  assert.ok(Object.keys(CYCLE_SHAPES).length <= 8, 'the shape table grew past what was measured');
});

test('the rung scopes agree with the published ledger totals', () => {
  const app = METHOD_ALGORITHMS.find((m) => m.method === "The app's method");
  const bottom = entriesForRungs({ cross: 0, pairs: 0, oll: 0, pll: 0 });
  const top = entriesForRungs({ cross: 1, pairs: 2, oll: 1, pll: 1 });
  assert.equal(bottom.length, app.held, 'the bottom rung disagrees with the ledger');
  assert.equal(top.length, app.heldTop, 'the top rung disagrees with the ledger');
});

test('a hand-edited rung record falls back rather than throwing', () => {
  for (const bad of [{}, { pairs: 99 }, { oll: -1 }, { cross: 1.5 }, { pll: 'x' }]) {
    assert.ok(entriesForRungs(bad).length > 0, `${JSON.stringify(bad)} emptied the list`);
  }
});

test('the top F2L rungs keep the beginner inserts, as the ledger measured', () => {
  for (const rung of [1, 2]) {
    const ids = entriesForRungs({ cross: 0, pairs: rung, oll: 0, pll: 0 }).map((e) => e.id);
    for (const kept of ['right-hand', 'left-hand', 'facing-up', 'insert-right', 'insert-left']) {
      assert.ok(ids.includes(kept), `pairs rung ${rung} dropped the ${kept} fallback`);
    }
  }
  assert.deepEqual(RUNG_TABLE.cross[1], [], 'the planned-whole cross needs no algorithms');
});

test('the catalogue imports no screen', () => {
  for (const f of ['alg-catalogue.js', 'alg-effect.js']) {
    assert.ok(!/from '\.\/screens\//.test(source(f)), `${f} imports a screen`);
    assert.ok(!/screen-shell|screen-slots/.test(source(f)), `${f} reaches the shell`);
  }
});

// ---- item 2.3: the generated fixture ------------------------------------------------------------

test('the fixture is what the generator would write — emitting twice changes nothing', () => {
  // Compared WITHOUT writing: a test that re-emitted to pass would rewrite a stale fixture into
  // agreement, which is the one failure a generated fixture exists to prevent.
  assert.equal(readFileSync(FIXTURE, 'utf8'), fixtureText(), 'run `node bench/alg-catalogue.mjs --emit`');
});

test('the fixture records the catalogue that is actually built', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(census())), JSON.parse(JSON.stringify(CATALOGUE_CENSUS)));
  assert.equal(CATALOGUE_CENSUS.count, ALG_ENTRIES.length);
  assert.equal(CATALOGUE_CENSUS.signatures, 62, 'the measured signature count moved');
});

test('the digest notices a change no census column would', () => {
  // A field edited in place moves no count: same 137, same dials, same signatures, same orders.
  // Only the digest sees it, which is why the fixture carries one.
  const edited = ALG_ENTRIES.map((e, i) => (i === 0 ? { ...e, label: `${e.label} (hand-written note)` } : e));
  const after = census(edited);
  assert.equal(after.count, CATALOGUE_CENSUS.count, 'the edit was supposed to move no count');
  assert.deepEqual(after.signatureCensus, CATALOGUE_CENSUS.signatureCensus, 'the edit was supposed to move no census column');
  assert.notEqual(after.digest, CATALOGUE_CENSUS.digest, 'the digest did not notice an edited entry');
});

test('every stage the catalogue files an entry under has a purpose sentence', () => {
  // The check `PURPOSED_STAGES`' own comment claimed and did not have. A stage in the catalogue with
  // no entry in the purpose table makes `purposeForStage` throw, which on the Drill page is a blank
  // screen rather than a missing line — so this is the difference between a caught omission and a
  // screen that will not draw.
  const filed = [...new Set(ALG_ENTRIES.map((e) => e.stage))].sort();
  const purposed = [...PURPOSED_STAGES].sort();
  assert.deepEqual(
    filed.filter((s) => !purposed.includes(s)),
    [],
    'a catalogue stage has no purpose sentence',
  );
  for (const entry of ALG_ENTRIES) assert.ok(purposeFor(entry).length > 0, `no purpose for ${entry.id}`);
});

test('a purpose sentence never contradicts what the algorithm measurably does', () => {
  // The defect this replaced: every one-look PLL is FILED under `top-corners` (a deliberate choice —
  // both permutation stages share a hold and a dial), so a stage-derived sentence told a child to
  // "move the top corners" over `pll:01230231`, which permutes three edges and no corners. The stage
  // is not a claim about the pieces; the effect is, and it is computed from the move tables.
  const CORNERS = /\bcorners\b/;
  const EDGES = /\bedges\b/;
  let checked = 0;
  for (const entry of ALG_ENTRIES) {
    if (entry.dial !== 'pll') continue;
    const says = purposeFor(entry);
    const movesCorners = entry.effect.corners.length > 0;
    const movesEdges = entry.effect.edges.length > 0;
    // BOTH DIRECTIONS. The first version asserted only that a named kind is really moved, which a
    // single constant caption satisfies for every entry — "the whole top layer" names neither kind,
    // so neither branch fired and a mutant that captioned all 26 the same way passed 21 of 21 tests
    // (found by the verify pass on this very fix, 2026-09-28). What it is missing is the positive
    // direction: a sentence must NAME the kind it moves whenever it moves only one.
    assert.equal(CORNERS.test(says) && !EDGES.test(says), movesCorners && !movesEdges,
      `${entry.id}: "${says}" and the measured effect disagree about being corners-only`);
    assert.equal(EDGES.test(says) && !CORNERS.test(says), movesEdges && !movesCorners,
      `${entry.id}: "${says}" and the measured effect disagree about being edges-only`);
    // And an entry that moves both must name neither kind, or it describes half of what it does.
    if (movesCorners && movesEdges) {
      assert.ok(!CORNERS.test(says) && !EDGES.test(says),
        `${entry.id}: "${says}" names one kind for an algorithm that permutes both`);
    }
    checked += 1;
  }
  assert.ok(checked >= 26, `only ${checked} permutation entries reached the check`);
  // The entry that was wrong, named, so a regression cannot pass as a smaller sweep.
  const wrong = entryById('pll:01230231');
  assert.deepEqual([wrong.effect.corners, wrong.effect.edges], [[], [3]], 'the fixture entry changed');
  assert.ok(!CORNERS.test(purposeFor(wrong)), 'an edges-only PLL is being captioned as corners again');
});

// The rule that no label may be hand-written lives in `course-prose.test.mjs`, with the rest of the
// boundary it belongs to — a computed sentence is allowed precisely because it is computed, and that
// gate is where this repository says so.
