// The algorithm ledger: what this repository actually holds, per set and per method.
//
//   node bench/algorithm-ledger.mjs            report
//   node bench/algorithm-ledger.mjs --emit     rewrite test/fixtures/algorithm-ledger.mjs
//
// NOT a copy of anybody's algorithm sheet. The web is full of those and none of them says which
// ones THIS app has, where they came from, or what it would take to teach a method it does not yet
// teach. That is the ledger.
//
// Three questions it answers, and the third is the one nothing else in the repo does:
//
//   1. **What sets exist, how big, how long, and how were they verified?** Two very different kinds
//      live here. The generated tables are proven-minimal artifacts out of `crates/optimal-solver`,
//      certified and re-diffed on every test run by `case-tables.test.mjs`. The hand-written
//      repertoires are the beginner rungs, chosen for teachability rather than length, and their
//      guarantee is different and weaker: each has to EARN ITS PLACE, which `method-solver` enforces
//      by refusing a step that names anything outside `CASE_NAMES`.
//   2. **How many algorithms does each method cost a learner?** The number people actually choose a
//      method on, and `cubus-im-solving-methods.md` leans on it without ever counting it here.
//   3. **What is missing.** To teach Roux you need CMLL and this repository has none of it. Saying so
//      with a number is worth more than a list of the sets we happen to have.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOLVED, applyAlg, movesOf } from '../lib/cube-pieces.js';
import { F2L_CASES, FULL_OLL, FULL_PLL } from '../lib/data/case-tables.js';
import { CROSS_ALGS } from '../lib/methods/cross.js';
import { PAIRS_ALGS } from '../lib/methods/pairs.js';
import { LAST_LAYER_EXTRAS, OLL_ALGS, PLL_ALGS } from '../lib/methods/last-layer.js';

// The hand-written repertoires are exported as flat lists, so the sub-groups are reconstructed by
// name here rather than re-exported. Names, not indices: a reordering inside those files must not
// silently change what this ledger says a learner memorises.
const pick = (list, names) => names.map((n) => {
  const hit = list.find((a) => a.name === n);
  if (!hit) throw new Error(`the ledger names an algorithm "${n}" that no repertoire has any more`);
  return hit;
});

const SETS = [
  {
    id: 'cross-inserts', name: 'Cross inserts', kind: 'hand-written',
    entries: CROSS_ALGS,
    provenance: 'written for teaching, not searched. Two ways to drop a cross edge in from the top.',
    verified: 'every entry must be reachable and used — `method-solver` refuses a step naming anything outside CASE_NAMES',
  },
  {
    id: 'f1l-inserts', name: 'First-layer corner inserts', kind: 'hand-written',
    entries: pick(PAIRS_ALGS, ['right-hand', 'left-hand', 'facing-up']),
    provenance: 'the beginner trigger and its repeat, in the three orientations a corner can be in',
    verified: 'same as above',
  },
  {
    id: 'middle-inserts', name: 'Middle-layer edge inserts', kind: 'hand-written',
    entries: pick(PAIRS_ALGS, ['insert-right', 'insert-left']),
    provenance: 'one pair that both inserts a correct edge and ejects a wrong one, which is how it is taught',
    verified: 'same as above',
  },
  {
    id: 'f2l-triggers', name: 'F2L triggers', kind: 'hand-written',
    entries: pick(PAIRS_ALGS, ['right', 'right-back', 'right-half', 'left', 'left-back', 'left-half']),
    provenance: 'rung 1 of the pairs stage: six triggers a pair is built out of, rather than 41 cases',
    verified: 'same as above',
  },
  {
    id: 'eoll', name: 'Two-look OLL, first look', kind: 'hand-written',
    entries: pick(OLL_ALGS, ['edge-orient']),
    provenance: 'one algorithm, applied up to three times, to orient the last-layer edges',
    verified: 'same as above',
  },
  {
    id: 'ocll', name: 'Two-look OLL, second look', kind: 'hand-written',
    entries: pick(OLL_ALGS, ['sune', 'antisune', 'headlights', 'double-sune', 'pi']),
    provenance: 'the corner-orientation cases in FACE TURNS ONLY, because the renderer and the move list speak nothing else',
    verified: 'same as above',
  },
  {
    id: 'cpll', name: 'Two-look PLL, corners', kind: 'hand-written',
    entries: pick(PLL_ALGS, ['corner-cycle', 'corner-cycle-back', 'diagonal']),
    provenance: 'adjacent swap both ways round, plus the diagonal',
    verified: 'same as above',
  },
  {
    id: 'epll', name: 'Two-look PLL, edges', kind: 'hand-written',
    entries: pick(PLL_ALGS, ['u-perm-a', 'u-perm-b']),
    provenance: 'two U-perms; Z and H fall out of applying two of them',
    verified: 'same as above',
  },
  {
    id: 'align', name: 'Alignment', kind: 'not an algorithm',
    entries: LAST_LAYER_EXTRAS,
    provenance: 'an EMPTY body, so the AUF the repertoire already adds IS the alignment. Deliberately outside PLL_ALGS: "turn the top until it matches" is not something anyone memorises',
    verified: 'its absence once made a one-turn cube get a nineteen-move lesson (audit, 2026-09-09)',
  },
  {
    id: 'f2l-full', name: 'F2L, all cases', kind: 'proved',
    entries: F2L_CASES,
    provenance: 'searched in `crates/optimal-solver`, proven minimal in the half-turn metric, certified',
    verified: '`f2l-cross-check` refutes every case by brute force with no heuristic; `case-tables.test.mjs` re-runs the generator and diffs the shipped module',
  },
  {
    id: 'oll-full', name: 'Full OLL', kind: 'proved',
    entries: FULL_OLL,
    provenance: 'same search; one algorithm per case so the top face is one look',
    verified: 'certified over all 1,152 (alignment, goal) pairs; same generator diff',
  },
  {
    id: 'pll-full', name: 'Full PLL', kind: 'proved',
    entries: FULL_PLL,
    provenance: 'same search; the 288-state goal set checked against the published Cube Explorer distribution',
    verified: 'the distribution matched Cube Explorer entry for entry, mean 11.642361; same generator diff',
  },
];

/**
 * What each method costs a learner, and what this repository has for it.
 *
 * `held` names a set above. `intuitive` means the phase is built by understanding, with nothing to
 * memorise — which is a real answer and not a gap. `missing` means the method genuinely needs a
 * memorised set that this repository does not have, with the size it would be. **Those sizes are
 * community figures and are NOT measured here**, so they are marked, the way
 * `cubus-im-solving-methods.md` marks the one CFOP number nothing in either repo has measured.
 */
const METHODS = [
  // The app's method is a LADDER, not one cost. `methods/index.js` gives every stage its own rungs,
  // and a learner climbs them one at a time, so the method's price is a RANGE. Flattening that away
  // was the first version of this file's mistake, and the test caught it: the F2L triggers are held
  // and no method claimed them, because they are rung 1 of a ladder the mapping did not have.
  { method: "The app's method", ladder: true, phases: [
    // The four stages of `methods/index.js`, each with its own rungs. A rung may need MORE THAN ONE
    // set — the bottom rung of the pairs stage is a corner insert and an edge insert — which the
    // first version of this file could not express, and it came out 24 at the bottom instead of 18.
    { phase: 'Cross', rungs: [
      { rung: 0, label: 'edge by edge', held: ['cross-inserts'] },
      { rung: 1, label: 'planned whole', intuitive: 'an exact distance table is descended — no algorithm at all' },
    ] },
    { phase: 'Pairs', rungs: [
      { rung: 0, label: 'corner, then edge', held: ['f1l-inserts', 'middle-inserts'] },
      { rung: 1, label: 'trigger pairs', held: ['f2l-triggers', 'f1l-inserts', 'middle-inserts'] },
      // **The top rung still needs the beginner inserts, and the first version of this ledger said it
      // did not.** `pairsFrom` falls back to `placeSeparately` when a pair is BURIED — a piece of it
      // sitting in another slot — and that fallback is the beginner corner and edge inserts. Measured:
      // over 25 seeded scrambles at TOP_RUNG, `solveByMethod` emits steps named `facing-up`,
      // `insert-left`, `insert-right`, `left-hand` and `right-hand`. So the top is 124, not 119, and
      // the tidy claim that it lands exactly on CFOP's set was false.
      { rung: 2, label: 'the F2L cases', held: ['f2l-full', 'f1l-inserts', 'middle-inserts'] },
    ] },
    { phase: 'OLL', rungs: [
      { rung: 0, label: 'two-look', held: ['eoll', 'ocll'] },
      { rung: 1, label: 'full OLL', held: ['oll-full'] },
    ] },
    { phase: 'PLL', rungs: [
      { rung: 0, label: 'two-look', held: ['cpll', 'epll'] },
      { rung: 1, label: 'full PLL', held: ['pll-full'] },
    ] },
  ] },
  { method: 'CFOP', phases: [
    { phase: 'Cross', intuitive: 'planned, not memorised' },
    { phase: 'F2L', held: 'f2l-full' },
    { phase: 'OLL', held: 'oll-full' },
    { phase: 'PLL', held: 'pll-full' },
  ] },
  { method: 'Roux', phases: [
    { phase: 'First block', intuitive: 'block building' },
    { phase: 'Second block', intuitive: 'block building' },
    { phase: 'CMLL', missing: 'CMLL', size: 42, unmeasured: true },
    { phase: 'LSE', missing: 'LSE, largely intuitive with a handful of cases', size: null, unmeasured: true },
  ] },
  { method: 'Petrus', phases: [
    { phase: '2x2x2 and 2x2x3', intuitive: 'block building' },
    { phase: 'Edge orientation', intuitive: 'a recognition rule rather than a sequence' },
    { phase: 'Two layers', intuitive: 'block building' },
    { phase: 'Last layer', held: 'ocll', also: ['cpll', 'epll'],
      note: 'Petrus finishes with the same last layer the app already teaches, so this one costs nothing new' },
  ] },
  { method: 'ZZ', phases: [
    { phase: 'EOLine', intuitive: 'planned, and the hardest part of the method to learn' },
    { phase: 'EO F2L', intuitive: 'block building with no F or B turns' },
    { phase: 'Last layer', held: 'ocll', also: ['cpll', 'epll'],
      note: 'ZZ-a finishes with OCLL and PLL, which are held. ZZ-b with full ZBLL is 493 algorithms and is not' },
  ] },
  { method: 'Corners first', phases: [
    { phase: 'Corners', missing: 'a corner-only set', size: null, unmeasured: true },
    { phase: 'Edges', missing: 'an edge-only set', size: null, unmeasured: true },
  ] },
  { method: 'Mehta', phases: [
    { phase: 'First block', intuitive: 'block building' },
    { phase: 'Belt and edge orientation', missing: 'EOLE', size: null, unmeasured: true },
    { phase: '6CO', missing: '6CO', size: null, unmeasured: true },
    { phase: '6CP', missing: '6CP', size: null, unmeasured: true },
    { phase: 'L5EP', missing: 'L5EP', size: null, unmeasured: true },
  ] },
  { method: 'Thistlethwaite', phases: [
    { phase: 'G1 to G4', intuitive: 'NONE. A computer method searches each coset; there is nothing to memorise and nothing a human could' },
  ] },
  { method: "The app's solver", phases: [
    { phase: 'Both phases', intuitive: 'NONE. `lib/two-phase.js` searches; its eleven tables are 9.82 MiB of pruning data, not algorithms' },
  ] },
];

// ---- measurement --------------------------------------------------------------------------------

const FACE_TURN = /^[URFDLB][2']?$/;

function measure(set) {
  const lengths = [];
  const seen = new Set();
  for (const { name, alg } of set.entries) {
    for (const m of movesOf(alg)) {
      if (!FACE_TURN.test(m)) throw new Error(`${set.id}/${name}: "${m}" is not a face turn`);
    }
    // Every algorithm must actually do something, except the alignment, which is empty on purpose.
    const moves = movesOf(alg).length;
    if (moves === 0 && set.kind !== 'not an algorithm') {
      throw new Error(`${set.id}/${name} is empty, and only the alignment may be`);
    }
    if (moves > 0) {
      const after = applyAlg(SOLVED, alg);
      const same = ['cp', 'co', 'ep', 'eo'].every((k) => after[k].every((v, i) => v === SOLVED[k][i]));
      if (same) throw new Error(`${set.id}/${name} leaves the cube unchanged, so it is not an algorithm`);
    }
    lengths.push(moves);
    seen.add(alg);
  }
  const total = lengths.reduce((a, b) => a + b, 0);
  return {
    count: set.entries.length,
    distinct: seen.size,
    shortest: Math.min(...lengths),
    longest: Math.max(...lengths),
    mean: set.entries.length ? Number((total / set.entries.length).toFixed(2)) : 0,
    moves: total,
  };
}

const measured = SETS.map((s) => ({ ...s, entries: undefined, algs: s.entries, stats: measure(s) }));
const byId = Object.fromEntries(measured.map((s) => [s.id, s]));

/**
 * What a method costs, and for a ladder, what it costs at each end.
 *
 * `held` is the BOTTOM rung — what a learner who has chosen nothing is shown. `heldTop` is the top,
 * which is where the ladder leads. For a method with no ladder the two are equal.
 */
function cost(m) {
  const missing = [];
  const bottom = new Set();
  const top = new Set();
  const all = new Set();
  // `held` is one set or several. Normalised here rather than at every use, because the one place
  // this was not normalised is where the bottom-rung count went wrong.
  const setsOf = (r) => [...(Array.isArray(r.held) ? r.held : [r.held]), ...(r.also ?? [])].filter(Boolean);
  for (const p of m.phases) {
    const rungs = p.rungs ?? [{ rung: 0, ...p }];
    for (const r of rungs) for (const id of setsOf(r)) all.add(id);
    // The BOTTOM is the first rung that needs algorithms; the TOP is the last rung, full stop, even
    // when it needs none. Taking the last rung WITH algorithms instead made the cross cost 2 at the
    // top of its ladder, where rung 1 descends an exact table and costs nothing — and the total came
    // out 121 instead of 119, which is the number that makes the finding.
    const withAlgs = rungs.filter((r) => setsOf(r).length);
    if (withAlgs.length) for (const id of setsOf(withAlgs[0])) bottom.add(id);
    for (const id of setsOf(rungs[rungs.length - 1])) top.add(id);
    for (const r of rungs) if (r.missing) missing.push(r.missing);
  }
  const sum = (ids) => [...ids].reduce((a, id) => a + byId[id].stats.count, 0);
  const moves = (ids) => [...ids].reduce((a, id) => a + byId[id].stats.moves, 0);
  return {
    sets: [...all], held: sum(bottom), heldMoves: moves(bottom),
    heldTop: sum(top), heldTopMoves: moves(top), missing,
  };
}

const methods = METHODS.map((m) => ({ ...m, ...cost(m) }));

/**
 * The ledger EXACTLY as the fixture holds it, defined once.
 *
 * The emit below and `algorithm-ledger.test.mjs`'s diff both read this. They used to build the shape
 * separately, which meant adding a field to the generator broke the test with a message about drift
 * when nothing had drifted — two copies of a shape is the thing the fixture exists to avoid, one
 * level up.
 */
export const LEDGER = {
  sets: measured.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, provenance: s.provenance, verified: s.verified, ...s.stats,
  })),
  methods: methods.map((m) => ({
    method: m.method, ladder: Boolean(m.ladder), phases: m.phases, sets: m.sets,
    held: m.held, heldMoves: m.heldMoves, heldTop: m.heldTop, heldTopMoves: m.heldTopMoves, missing: m.missing,
  })),
};

// ---- report --------------------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

// Run only when invoked directly. `test/algorithm-ledger.test.mjs` imports the measurements, and
// without this guard that import printed a full report into somebody else's test output — the same
// import side effect `solve-to-state-oracle.mjs` had and for the same reason.
const RUN_DIRECTLY = Boolean(process.argv[1]?.endsWith('algorithm-ledger.mjs'));
if (RUN_DIRECTLY) {

console.log('=== the sets this repository holds ==========================================\n');
console.log(`${pad('set', 30)} ${pad('kind', 16)} ${num('algs', 5)} ${num('distinct', 9)} ${num('shortest', 9)} ${num('mean', 6)} ${num('longest', 8)}`);
for (const s of measured) {
  console.log(`${pad(s.name, 30)} ${pad(s.kind, 16)} ${num(s.stats.count, 5)} ${num(s.stats.distinct, 9)} ${num(s.stats.shortest, 9)} ${num(s.stats.mean, 6)} ${num(s.stats.longest, 8)}`);
}
const totals = measured.reduce((a, s) => ({ n: a.n + s.stats.count, moves: a.moves + s.stats.moves }), { n: 0, moves: 0 });
console.log(`\n${totals.n} algorithms in all, ${totals.moves} moves of material.`);
const proved = measured.filter((s) => s.kind === 'proved').reduce((a, s) => a + s.stats.count, 0);
const hand = measured.filter((s) => s.kind === 'hand-written').reduce((a, s) => a + s.stats.count, 0);
console.log(`${proved} are proven minimal and certified; ${hand} are hand-written for teaching.`);

console.log('\n=== what each method costs, and what is missing =============================\n');
console.log(`${pad('method', 20)} ${num('bottom', 7)} ${num('top', 5)} ${num('moves', 6)}  missing`);
for (const m of methods) {
  const top = m.heldTop === m.held ? '—' : m.heldTop;
  console.log(`${pad(m.method, 20)} ${num(m.held, 7)} ${num(top, 5)} ${num(m.heldMoves, 6)}  ${m.missing.length ? m.missing.join('; ') : '—'}`);
  for (const ph of m.phases) {
    if (ph.note) console.log(`${pad('', 20)} ${pad('', 14)}  ${ph.phase}: ${ph.note}`);
    for (const r of ph.rungs ?? []) if (r.intuitive) console.log(`${pad('', 20)} ${pad('', 14)}  ${ph.phase} rung ${r.rung}: ${r.intuitive}`);
  }
}
console.log('\n"bottom" is what a learner who has chosen nothing is shown; "top" is where the ladder leads.');

console.log('\nThe two computer methods cost ZERO algorithms and are the only ones that do: they search');
console.log('instead. That is the trade the whole of cubus-im-solving-methods.md is about, seen from the');
console.log('other end — a method is a way of spending memory to avoid search, or search to avoid memory.');

if (process.argv.includes('--emit')) {
  const FIXTURE = fileURLToPath(new URL('../test/fixtures/algorithm-ledger.mjs', import.meta.url));
  const header = `// The algorithm ledger. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/algorithm-ledger.mjs --emit
//   re-verify:  node --test apps/web/test/algorithm-ledger.test.mjs
//
// What this repository holds, per set and per method, and what it does not. The sets themselves are
// NOT copied here — they live in lib/data/case-tables.js and lib/methods/, and copying them would
// make a second place for an algorithm to be wrong. This records the shape: sizes, lengths,
// provenance, which method needs which, and what is missing.
//
// \`unmeasured: true\` marks a size taken from the cubing community rather than measured here, the
// same way cubus-im-solving-methods.md marks the one CFOP figure nothing in either repo has measured.
`;
  const body = `${header}
export const ALGORITHM_SETS = Object.freeze(${JSON.stringify(LEDGER.sets, null, 2)});

export const METHOD_ALGORITHMS = Object.freeze(${JSON.stringify(LEDGER.methods, null, 2)});
`;
  writeFileSync(FIXTURE, body);
  console.log(`\nwrote ${FIXTURE}`);
}

}

export { SETS, METHODS, measured as MEASURED_SETS, methods as MEASURED_METHODS };
