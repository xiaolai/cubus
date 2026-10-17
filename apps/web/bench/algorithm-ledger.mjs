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
//   1. **What sets exist, how big, how long, and how were they verified?** Three very different kinds
//      live here. The generated tables are proven-minimal artifacts out of `crates/optimal-solver`,
//      certified and re-diffed on every test run by `case-tables.test.mjs`. The hand-written
//      repertoires are the beginner tables and the course's, chosen for teachability rather than
//      length, and their guarantee is different and weaker: each has to EARN ITS PLACE, which
//      `method-solver` enforces by refusing a step that names anything outside `CASE_NAMES`. The
//      sourced sets are the speedcubing community's, copied with their sources and re-derived by cubejs.
//   2. **How many algorithms does each method cost a learner?** The number people actually choose a
//      method on. The methods the solve tab offers are the registry's (`lib/methods/registry.js`), one
//      entry each and keyed by its id; `algorithm-ledger.test.mjs` solves frozen cubes with each and
//      holds the mapping to what the solver actually names.
//   3. **What is missing.** Corners first and Mehta need sets this repository does not hold. Saying so
//      with a number is worth more than a list of the sets we happen to have.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOLVED, movesOf } from '../lib/cube-pieces.js';
import { faceTurnsAlg, run } from '../lib/cube-moves.js';
import { CROSS_ALGS } from '../lib/methods/cross.js';
import { PAIRS_ALGS, PAIRS_EXTRAS } from '../lib/methods/pairs.js';
import { COURSE_ALGS, LAST_LAYER_EXTRAS, OLL_ALGS, PLL_ALGS } from '../lib/methods/last-layer.js';
import { METHODS as OFFERED } from '../lib/methods/registry.js';
import { HUMAN_F2L, HUMAN_OLL, HUMAN_PLL } from '../lib/data/human-algs.js';
import { CMLL_ALGS, SOURCES as CMLL_SOURCES } from '../lib/data/cmll-algs.js';
import { F2L_CASES, FULL_OLL, FULL_PLL } from '../lib/data/case-tables.js';

// WHICH ALGORITHM IS IN WHICH SET is said here once. The app's algorithm catalogue said it too, and the
// ledger read it from there; the catalogue went with the Drill (ADR 0010), so the sets are picked here
// again — BY NAME, never by index, so a reordering inside a repertoire cannot silently move an algorithm
// into another set.
const pick = (list, names) => names.map((n) => {
  const hit = list.find((a) => a.name === n);
  if (!hit) throw new Error(`the ledger names an algorithm "${n}" that no repertoire holds any more`);
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
    provenance: 'CFOP (easy)\'s first two layers: six triggers a pair is built out of, rather than 41 cases',
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
    provenance: 'the corner-orientation cases in face turns only, by choice: the first algorithms a learner meets need no notation beyond the six faces. The renderer and the interpreter read wide turns and slices too; the sourced sets use them',
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
    // The beginner course's last layer (ADR 0009), which Beginner walks: lessons 13 and 14 put the top edges
    // up and home, 15 and 16 the corners. Two sets, because they are two stages' tables, as the app's
    // two-look tables are. HAND-WRITTEN, not sourced: the course is this project's own, and every sequence is
    // the lesson's — none was copied from a sheet.
    id: 'course-edges', name: 'The course\'s top edges', kind: 'hand-written',
    entries: pick(COURSE_ALGS, ['course-cross', 'course-edge-swap']),
    provenance: 'the beginner course\'s lessons 13 and 14 (cubus-courses): the cross on top, then a swap of two top edges',
    verified: 'same as above; and `bench/method-solver-profile.mjs exhaustive course course` walks all 62,208 last-layer states through the course\'s route (a nightly CI shard)',
  },
  {
    id: 'course-corners', name: 'The course\'s top corners', kind: 'hand-written',
    entries: pick(COURSE_ALGS, ['course-corner-cycle', 'course-corner-twist', 'course-corner-twist-back']),
    provenance: 'the beginner course\'s lessons 15 and 16: three corners moved round, then lesson 9\'s four moves done twice or four times to turn one corner up',
    verified: 'same as above',
  },
  {
    id: 'align', name: 'Alignment', kind: 'not an algorithm',
    entries: LAST_LAYER_EXTRAS,
    provenance: 'an EMPTY body, so the AUF the repertoire already adds IS the alignment. Deliberately outside PLL_ALGS: "turn the top until it matches" is not something anyone memorises',
    verified: 'its absence once made a one-turn cube get a nineteen-move lesson (audit, 2026-09-09)',
  },
  {
    id: 'turn', name: 'Turning a slot to the front', kind: 'not an algorithm',
    entries: PAIRS_EXTRAS,
    provenance: 'an EMPTY body, named so a pairs step\'s parts add up to its algorithm: the turn of the whole cube that brings a slot to the front right. A regrip, not something anyone memorises',
    verified: 'a part a pairs step names, so it is in CASE_NAMES; held here so that every name a step can carry is filed somewhere',
  },
  {
    id: 'f2l-human', name: 'F2L, human-speed', kind: 'sourced',
    entries: HUMAN_F2L,
    provenance: 'SpeedCubeDB\'s top-voted Front Right algorithm per case; what CFOP (full) teaches for its first two layers',
    verified: '`human-algs.test.mjs`: cubejs finds each answers exactly its proved case, and the 41 cover the 41 once each',
  },
  {
    id: 'oll-human', name: 'Full OLL, human-speed', kind: 'sourced',
    entries: HUMAN_OLL,
    provenance: 'J Perm\'s first-listed algorithm per case; what CFOP (full) teaches for the top face',
    verified: 'same cubejs check, 57 to 57',
  },
  {
    id: 'pll-human', name: 'Full PLL, human-speed', kind: 'sourced',
    entries: HUMAN_PLL,
    provenance: 'J Perm\'s first-listed algorithm per case; what CFOP (full) teaches for the last layer',
    verified: 'same cubejs check, 21 to 21',
  },
  {
    id: 'cmll', name: 'CMLL', kind: 'sourced',
    entries: CMLL_ALGS,
    provenance: `${CMLL_SOURCES.speedcubedb.name}'s top-voted algorithm per case, fetched ${CMLL_SOURCES.speedcubedb.fetched} from the page's markup and taught exactly as written; what Roux teaches for the top corners`,
    verified: '`cmll-algs.test.mjs`: cubejs finds every row keeps both blocks and the centres, the 42 rows answer the 42 cases once each, and no row solves the arrangement none is for',
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
 * `held` names one set above or several. `intuitive` means the phase is built by understanding or by
 * search, with nothing to memorise — which is a real answer and not a gap. `missing` means the method
 * genuinely needs a memorised set that this repository does not have, with the size it would be.
 * **Those sizes are community figures and are NOT measured here**, so they are marked, the way
 * `cubus-im-solving-methods.md` marks the one CFOP number nothing in either repo has measured.
 *
 * `id` is the registry id of a method the solve tab OFFERS (`lib/methods/registry.js`), and `null` for
 * one it does not — those are here to be compared with, and to say what teaching them would take. An
 * offered method's name is the registry's label, read from the entry rather than spelled again, and its
 * phases are its registry stages, each naming the `stage` it is. The rung ladder this table used to model
 * is gone as a learner's choice (ADR 0011): a method is fixed, so it has ONE cost, not a range.
 */
const offered = (id, phases) => {
  const entry = OFFERED.find((m) => m.id === id);
  if (!entry) throw new Error(`the ledger names an offered method "${id}" that the registry does not hold`);
  return { id, method: entry.label, phases };
};

const METHODS = [
  offered('quick', [
    { phase: 'Whole cube', intuitive: 'NONE. The two-phase search (`lib/two-phase.js`) answers; there is nothing to memorise' },
  ]),
  offered('beginner', [
    { stage: 'cross', phase: 'Cross', held: ['cross-inserts'] },
    { stage: 'pairs', phase: 'First two layers', held: ['f1l-inserts', 'middle-inserts'] },
    // The course's last layer (ADR 0009), not the app's: Beginner is rung 0 everywhere on the course's route.
    { stage: 'oll', phase: 'Top face', held: ['course-edges'] },
    { stage: 'pll', phase: 'Last layer', held: ['course-corners'] },
  ]),
  // **Both CFOP entries still need the beginner inserts, and the first version of this ledger said the top
  // did not.** `pairsFrom` falls back to `placeSeparately` when a pair is BURIED — a piece of it sitting in
  // another slot — and that fallback is the beginner corner and edge inserts. The test that solves frozen
  // cubes with each entry finds them named, and fails if a mapped set stops appearing or an unmapped one
  // starts. A learner memorises a sequence once, so the cost counts DISTINCT algorithms: the triggers
  // `right` and `left` ARE the corner inserts `right-hand` and `left-hand`, and three F2L cases are inserts too.
  offered('cfop-4lll', [
    { stage: 'cross', phase: 'Cross', intuitive: 'planned whole: an exact distance table is descended — no algorithm at all' },
    { stage: 'pairs', phase: 'First two layers', held: ['f2l-triggers', 'f1l-inserts', 'middle-inserts'] },
    { stage: 'oll', phase: 'Top face', held: ['eoll', 'ocll'] },
    { stage: 'pll', phase: 'Last layer', held: ['cpll', 'epll'] },
  ]),
  offered('cfop', [
    { stage: 'cross', phase: 'Cross', intuitive: 'planned whole: an exact distance table is descended — no algorithm at all' },
    // The human-speed table, not the proved one: what a method costs is what it TEACHES.
    { stage: 'pairs', phase: 'First two layers', held: ['f2l-human', 'f1l-inserts', 'middle-inserts'] },
    { stage: 'oll', phase: 'Top face', held: ['oll-human'] },
    { stage: 'pll', phase: 'Last layer', held: ['pll-human'] },
  ]),
  offered('roux', [
    { stage: 'first-block', phase: 'Left block', intuitive: 'block building, found by search: a shipped exact distance table is descended — no table of algorithms' },
    { stage: 'second-block', phase: 'Right block', intuitive: 'block building, found by search: a shipped exact distance table' },
    { stage: 'cmll', phase: 'Top corners', held: ['cmll'] },
    { stage: 'lse', phase: 'Last six edges', intuitive: 'found by search with the middle slice: exact distance tables, no table of algorithms' },
  ]),
  { id: null, method: 'Petrus', phases: [
    { phase: '2x2x2 and 2x2x3', intuitive: 'block building' },
    { phase: 'Edge orientation', intuitive: 'a recognition rule rather than a sequence' },
    { phase: 'Two layers', intuitive: 'block building' },
    { phase: 'Last layer', held: 'ocll', also: ['cpll', 'epll'],
      note: 'Petrus finishes with the same last layer the app already teaches, so this one costs nothing new' },
  ] },
  { id: null, method: 'ZZ', phases: [
    { phase: 'EOLine', intuitive: 'planned, and the hardest part of the method to learn' },
    { phase: 'EO F2L', intuitive: 'block building with no F or B turns' },
    { phase: 'Last layer', held: 'ocll', also: ['cpll', 'epll'],
      note: 'ZZ-a finishes with OCLL and PLL, which are held. ZZ-b with full ZBLL is 493 algorithms and is not' },
  ] },
  { id: null, method: 'Corners first', phases: [
    { phase: 'Corners', missing: 'a corner-only set', size: null, unmeasured: true },
    { phase: 'Edges', missing: 'an edge-only set', size: null, unmeasured: true },
  ] },
  { id: null, method: 'Mehta', phases: [
    { phase: 'First block', intuitive: 'block building' },
    { phase: 'Belt and edge orientation', missing: 'EOLE', size: null, unmeasured: true },
    { phase: '6CO', missing: '6CO', size: null, unmeasured: true },
    { phase: '6CP', missing: '6CP', size: null, unmeasured: true },
    { phase: 'L5EP', missing: 'L5EP', size: null, unmeasured: true },
  ] },
  { id: null, method: 'Thistlethwaite', phases: [
    { phase: 'G1 to G4', intuitive: 'NONE. A computer method searches each coset; there is nothing to memorise and nothing a human could' },
  ] },
  { id: null, method: "The app's solver", phases: [
    { phase: 'Both phases', intuitive: 'NONE. `lib/two-phase.js` searches; its eleven tables are 9.82 MiB of pruning data, not algorithms' },
  ] },
];

// ---- measurement --------------------------------------------------------------------------------

const FACE_TURN = /^[URFDLB][2']?$/;

/** An algorithm's length in face turns: a slice two, a turn of the whole cube none. */
const turnsOf = (alg) => movesOf(faceTurnsAlg(run(alg, ['U', 'F'], SOLVED).drawn)).length;

function measure(set) {
  const lengths = [];
  const seen = new Set();
  for (const { name, alg } of set.entries) {
    // Face turns only, except in a SOURCED set: the algorithms speedcubers learn are full of wide turns,
    // slices and whole-cube turns, and those are read by the interpreter, which refuses what it cannot read.
    if (set.kind !== 'sourced') {
      for (const m of movesOf(alg)) {
        if (!FACE_TURN.test(m)) throw new Error(`${set.id}/${name}: "${m}" is not a face turn`);
      }
    }
    // Every algorithm must actually do something, except the alignment, which is empty on purpose. Its
    // length is in FACE TURNS — a slice two, a turn of the whole cube none — the count the lessons give.
    const played = run(alg, ['U', 'F'], SOLVED);
    const moves = turnsOf(alg);
    if (moves === 0 && set.kind !== 'not an algorithm') {
      throw new Error(`${set.id}/${name} is empty, and only the alignment may be`);
    }
    if (moves > 0) {
      const after = played.state;
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

/** What a method costs: the sets its phases name, the DISTINCT algorithms in them, and what is missing. */
function cost(m) {
  const missing = [];
  const all = new Set();
  // `held` is one set or several. Normalised here rather than at every use, because the one place
  // this was not normalised is where an earlier count went wrong.
  const setsOf = (p) => [...(Array.isArray(p.held) ? p.held : [p.held]), ...(p.also ?? [])].filter(Boolean);
  for (const p of m.phases) {
    for (const id of setsOf(p)) all.add(id);
    if (p.missing) missing.push(p.missing);
  }
  // DISTINCT ALGORITHMS, not the sum of the set sizes. A learner memorises a sequence once, whichever sets
  // file it: F2L 3 is `F' U' F` and F2L 4 is `R U R'` — the very corner inserts CFOP (full) keeps as its
  // fallback — and the triggers `left` and `right` are those inserts again. Summing counted them twice.
  const distinct = [...new Set([...all].flatMap((id) => byId[id].algs.map((a) => a.alg)))];
  return {
    sets: [...all], held: distinct.length, heldMoves: distinct.reduce((a, alg) => a + turnsOf(alg), 0), missing,
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
    id: m.id, method: m.method, phases: m.phases, sets: m.sets, held: m.held, heldMoves: m.heldMoves, missing: m.missing,
  })),
};

// ---- report --------------------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

// Run only when invoked directly. `test/algorithm-ledger.test.mjs` imports the measurements, and
// without this guard that import printed a full report into somebody else's test output — the same
// import side effect `solve-to-state-oracle.mjs` had and for the same reason.
// The resolved path, not a suffix: another file whose name merely ends the same way is not this one.
const RUN_DIRECTLY = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (RUN_DIRECTLY) {

console.log('=== the sets this repository holds ==========================================\n');
console.log(`${pad('set', 30)} ${pad('kind', 16)} ${num('algs', 5)} ${num('distinct', 9)} ${num('shortest', 9)} ${num('mean', 6)} ${num('longest', 8)}`);
for (const s of measured) {
  console.log(`${pad(s.name, 30)} ${pad(s.kind, 16)} ${num(s.stats.count, 5)} ${num(s.stats.distinct, 9)} ${num(s.stats.shortest, 9)} ${num(s.stats.mean, 6)} ${num(s.stats.longest, 8)}`);
}
// ENTRIES, not algorithms: the alignment is an entry and not an algorithm, and a sequence two sets share is
// one algorithm in two entries. Both numbers are printed so neither is read as the other.
const algorithmSets = measured.filter((s) => s.kind !== 'not an algorithm');
const totals = algorithmSets.reduce((a, s) => ({ n: a.n + s.stats.count, moves: a.moves + s.stats.moves }), { n: 0, moves: 0 });
const distinctAlgs = new Set(algorithmSets.flatMap((s) => s.algs.map((e) => e.alg))).size;
console.log(`\n${totals.n} entries across the sets, ${totals.moves} moves of material; ${distinctAlgs} distinct algorithms.`);
const proved = measured.filter((s) => s.kind === 'proved').reduce((a, s) => a + s.stats.count, 0);
const hand = measured.filter((s) => s.kind === 'hand-written').reduce((a, s) => a + s.stats.count, 0);
const sourced = measured.filter((s) => s.kind === 'sourced').reduce((a, s) => a + s.stats.count, 0);
console.log(`${proved} are proven minimal and certified; ${hand} are hand-written for teaching; ${sourced} are the speedcubing community's, sourced and checked.`);
const notAlgs = measured.filter((s) => s.kind === 'not an algorithm').reduce((a, s) => a + s.stats.count, 0);
console.log(`${notAlgs} more are named steps that are not algorithms, and are counted in no method.`);

console.log('\n=== what each method costs, and what is missing =============================\n');
console.log(`${pad('method', 20)} ${pad('offered as', 11)} ${num('algs', 5)} ${num('moves', 6)}  missing`);
for (const m of methods) {
  console.log(`${pad(m.method, 20)} ${pad(m.id ?? '—', 11)} ${num(m.held, 5)} ${num(m.heldMoves, 6)}  ${m.missing.length ? m.missing.join('; ') : '—'}`);
  for (const ph of m.phases) if (ph.note) console.log(`${pad('', 20)} ${pad('', 11)}  ${ph.phase}: ${ph.note}`);
}
console.log('\n"offered as" is the registry id of a method the solve tab offers (lib/methods/registry.js).');

console.log('\nThe search methods — Quick (which IS the app\'s solver) and Thistlethwaite — cost ZERO algorithms and are');
console.log('the only ones that do: they search instead. That is the trade the whole of cubus-im-solving-methods.md is about, seen from the');
console.log('other end — a method is a way of spending memory to avoid search, or search to avoid memory.');

if (process.argv.includes('--emit')) {
  const FIXTURE = fileURLToPath(new URL('../test/fixtures/algorithm-ledger.mjs', import.meta.url));
  const header = `// The algorithm ledger. GENERATED — do not hand-edit.
//
//   regenerate: node apps/web/bench/algorithm-ledger.mjs --emit
//   re-verify:  node --test apps/web/test/algorithm-ledger.test.mjs
//
// What this repository holds, per set and per method, and what it does not. The sets themselves are
// NOT copied here — they live in lib/methods/ (the hand-written tables), lib/data/human-algs.js and
// lib/data/cmll-algs.js (the sourced ones) and lib/data/case-tables.js (the proved ones), and copying
// them would make a second place for an algorithm to be wrong. This records the shape: sizes,
// lengths, provenance, which method needs which, and what is missing. A method the solve tab offers
// carries its registry id (lib/methods/registry.js); one it does not carries \`id: null\`.
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
