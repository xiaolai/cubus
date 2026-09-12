// How many of the ledger's pictures are actually the same pattern?
//
//   node bench/pattern-classes.mjs
//
// The ledger deduplicates by the 24 whole-cube ROTATIONS: two cubes that are one picture held
// differently become one row. That is the right notion for "can a child turn one into the other", and
// it is NOT the only notion of sameness, which is the question this file answers with numbers instead
// of an opinion.
//
// Three nested notions, each coarser than the last:
//
//   ROTATION   the 24. What the ledger uses today. A picture and the same picture held another way.
//   DESIGN     the 48, mirrors included. A reflection is not something you can do to a cube, but it is
//              something you can do to a picture, and two patterns that differ only by a mirror are
//              one design to anybody looking at them.
//   FAMILY     the 48 plus inversion. A pattern's inverse is the cube that undoes it. The pair often
//              reads as one idea done two ways — the same design wound the other direction.
//
// Whichever is right is a judgement about the game, not about the cube, so all three are reported.

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { toFacelets } from '../lib/two-phase.js';
import { canonicalDesign, symmetryOrder, verify } from './cube-look.mjs';
import { STATE_PATTERNS } from '../test/fixtures/pattern-ledger.mjs';

verify();

/** The cube that undoes this one. Its picture is a different picture in general. */
function inverseState(s) {
  const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
  for (let i = 0; i < 8; i++) { cp[s.cp[i]] = i; co[s.cp[i]] = (3 - s.co[i]) % 3; }
  for (let i = 0; i < 12; i++) { ep[s.ep[i]] = i; eo[s.ep[i]] = s.eo[i]; }
  return { cp, co, ep, eo };
}

// EXPAND THE FAMILIES BACK OUT. The ledger now stores one row per family with its variants beside
// it, so reading the rows alone would count each family as one rotation class and report the same number
// three times. The
// census this file exists to produce is over the rotation classes, which are the row plus its
// variants. Found by audit, after the ledger's dedup changed underneath it.
const ALGS = STATE_PATTERNS.flatMap((r) => [r.alg, ...r.variants]);

const rows = ALGS.map((alg) => {
  const r = { alg };
  const state = applyAlg(SOLVED, r.alg);
  const f = toFacelets(state);
  const inv = toFacelets(inverseState(state));
  const design = canonicalDesign(f);
  const family = [design, canonicalDesign(inv)].sort()[0];
  // SELF-INVERSE MEANS THE MANEUVER SQUARED IS THE IDENTITY, not that the two pictures look alike.
  // The first version compared canonical LOOKS, which made `D U'` self-inverse — and applying it
  // twice gives `D2 U2`, not a solved cube. The promise on the line below is "do it again and it
  // clears", so it has to be the promise that is tested. Found by audit.
  // From SOLVED, not from `state` — `state` is already the alg applied once, so applying it twice
  // more ran it three times. Caught by the count coming out zero when `U2` is plainly an involution.
  const twice = applyAlg(SOLVED, `${r.alg} ${r.alg}`);
  const clears = ['cp', 'co', 'ep', 'eo'].every((k) => twice[k].every((v, i) => v === SOLVED[k][i]));
  // COMPUTED, not looked up. Only the family representatives carry an `order` field in the fixture, so
  // looking it up left every expanded variant without one and the per-order table read the family counts —
  // three identical columns, which is what a census can never be. A symmetry order is a property of
  // the picture and costs 24 comparisons, so there is no reason to be fetching it.
  const head = STATE_PATTERNS.find((x) => x.alg === r.alg);
  return {
    alg: r.alg, f, design, family, selfInverse: clears,
    order: symmetryOrder(f),
    moves: r.alg.trim() ? r.alg.trim().split(/\s+/).length : 0,
    wrong: head?.wrong ?? null,
    name: head?.name,
  };
});

const group = (key) => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
};

const byDesign = group('design');
const byFamily = group('family');

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log('=== how much of the ledger is duplicate, and under which notion ==============\n');
console.log(`${pad('notion', 34)} ${num('classes', 8)} ${num('collapsed', 10)}`);
console.log(`${pad('by rotation (what the ledger does)', 34)} ${num(rows.length, 8)} ${num('-', 10)}`);
console.log(`${pad('by design (mirrors merged)', 34)} ${num(byDesign.size, 8)} ${num(rows.length - byDesign.size, 10)}`);
console.log(`${pad('by family (mirrors and inverses)', 34)} ${num(byFamily.size, 8)} ${num(rows.length - byFamily.size, 10)}`);

console.log('\nper symmetry order:\n');
console.log(`${pad('order', 8)} ${num('rows', 6)} ${num('designs', 9)} ${num('families', 10)}`);
const column = { rows: 0, designs: 0, families: 0 };
for (const order of [24, 8, 4]) {
  const of = rows.filter((r) => r.order === order);
  const d = new Set(of.map((r) => r.design)).size;
  const fam = new Set(of.map((r) => r.family)).size;
  column.rows += of.length; column.designs += d; column.families += fam;
  console.log(`${pad(order, 8)} ${num(of.length, 6)} ${num(d, 9)} ${num(fam, 10)}`);
}
// The breakdown must add up to the totals above it. It did not, silently, for as long as the expanded
// variants carried no symmetry order: every column read the same representatives and the table
// printed three identical columns. A census whose parts do not sum to its whole is not a census.
const totals = { rows: rows.length, designs: byDesign.size, families: byFamily.size };
for (const k of ['rows', 'designs', 'families']) {
  if (column[k] !== totals[k]) {
    throw new Error(`the ${k} column sums to ${column[k]} but the total is ${totals[k]}`);
  }
}
console.log(`\nthe three columns sum to ${column.rows}, ${column.designs} and ${column.families}, which are the totals above.`);

console.log('\n=== the biggest families, and what they actually are =========================\n');
const families = [...byFamily.entries()]
  .map(([, members]) => members.sort((a, b) => a.moves - b.moves))
  .sort((a, b) => b.length - a.length || a[0].moves - b[0].moves);
for (const fam of families.slice(0, 12)) {
  const head = fam[0];
  console.log(`${num(fam.length, 3)} rows, order ${num(head.order, 2)}, ${head.moves} moves, `
    + `${head.wrong ?? '?'} stickers wrong${head.name ? `  [${head.name}]` : ''}`);
  console.log(`     ${fam.map((r) => r.alg).slice(0, 6).join('   |   ')}${fam.length > 6 ? '   | …' : ''}`);
}

const singles = families.filter((f) => f.length === 1).length;
console.log(`\n${singles} of the ${byFamily.size} families have exactly one member; the rest are the duplicates.`);

// A pattern whose inverse is the same picture is its own undoing: perform it twice and the cube is
// solved again. Worth knowing for a game, because it means one maneuver both makes and clears it.
const selfInverse = rows.filter((r) => r.selfInverse);
console.log(`\n${selfInverse.length} of ${rows.length} maneuvers CLEAR THE PATTERN WHEN REPEATED — applying`);
console.log('one twice returns a solved cube, which is the nicest property a party trick can have.');
console.log('Checked by doing it, not by comparing pictures: two pictures can match up to rotation');
console.log('while the maneuver squared is nothing like the identity.');
console.log(`shortest few: ${selfInverse.sort((a, b) => a.moves - b.moves).slice(0, 6).map((r) => r.alg).join('  |  ')}`);
