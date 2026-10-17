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
import { ALG_SETS, METHOD_SETS, loadEntries } from '../lib/alg-library.js';

// WHICH ALGORITHM IS IN WHICH SET is said ONCE, in `lib/alg-library.js` (`ALG_SETS`), and read here: the set
// ledger is a summary computed from the library's rows (dev-docs/algorithm-drill-v2-plan.md §2.1), so the
// review page, this ledger and the drill cannot file one algorithm two ways. The library picks each set's
// entries by name and refuses a name its source no longer holds.
const ENTRIES = await loadEntries();
const SETS = ALG_SETS.map((s) => ({ ...s, entries: ENTRIES.get(s.id) }));

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
 *
 * The OFFERED methods' mapping is the library's (`METHOD_SETS`), for the reason the sets are; what is added
 * here is only the methods the app does not offer, kept to be compared with.
 */
const METHODS = [
  ...METHOD_SETS,
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
