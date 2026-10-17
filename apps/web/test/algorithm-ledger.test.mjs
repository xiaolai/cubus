// The algorithm ledger, held to the algorithms it describes.
//
// `test/fixtures/algorithm-ledger.mjs` records what this repository holds: how big each set is, how
// long its algorithms run, which method needs it, and what is missing. It deliberately does NOT copy
// the algorithms themselves — they live in `lib/methods/`, `lib/data/human-algs.js`,
// `lib/data/cmll-algs.js` and `lib/data/case-tables.js`, and a second copy would be a second place for
// one to be wrong. That makes drift the whole risk, so the ledger is regenerated here and diffed — and
// its method mapping is held to what each offered method's solver actually NAMES on frozen cubes.
//
// What this does NOT re-check: that the proved tables are the proved tables. `case-tables.test.mjs`
// already re-runs their generator, diffs the shipped module, and pins the length distributions. Doing
// it twice would be two gates that fail together and tell you the same thing.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { SOLVED, applyAlg, fromCube, movesOf } from '../lib/cube-pieces.js';
import { solveByMethod } from '../lib/method-solver.js';
import { CASE_NAMES } from '../lib/methods/index.js';
import { LAST_LAYER_EXTRAS } from '../lib/methods/last-layer.js';
import { methodOf, prepareMethod } from '../lib/methods/method-of.js';
import { PAIRS_EXTRAS } from '../lib/methods/pairs.js';
import { METHODS } from '../lib/methods/registry.js';
import { toMethodFrame } from '../lib/solving-hold.js';
import { ALGORITHM_SETS, METHOD_ALGORITHMS } from './fixtures/algorithm-ledger.mjs';
import { CONTRACT_CUBES } from './fixtures/solver-cubes.mjs';
import { LEDGER, MEASURED_SETS } from '../bench/algorithm-ledger.mjs';
import Cube from 'cubejs';

test('the frozen ledger is what regenerating it produces', () => {
  // Same shape as case-tables.test.mjs's first case, and for the same reason: a fixture that drifted
  // from its generator looks exactly like one that did not.
  // `LEDGER` is the one definition of the emitted shape, exported by the generator and used by its
  // own writer. Rebuilding it here instead was how this test reported "drift" when a field had merely
  // been added — two copies of a shape, which is exactly what the fixture exists to avoid.
  const round = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(round(ALGORITHM_SETS), round(LEDGER.sets),
    'the sets in the fixture are not what the generator now produces');
  assert.deepEqual(round(METHOD_ALGORITHMS), round(LEDGER.methods),
    'the method mapping in the fixture is not what the generator now produces');
});

test('every algorithm in every set is a real algorithm', () => {
  // The generator asserts this while measuring; this asserts it from outside the generator, which is
  // the distinction `case-tables.test.mjs` draws for the proved tables and the hand-written
  // repertoires never had.
  const FACE_TURN = /^[URFDLB][2']?$/;
  for (const set of MEASURED_SETS) {
    assert.ok(set.algs.length > 0, `${set.id} is empty`);
    const names = new Set();
    for (const { name, alg } of set.algs) {
      assert.ok(name && typeof name === 'string', `${set.id}: an entry has no name`);
      assert.ok(!names.has(name), `${set.id}: two entries are called ${name}`);
      names.add(name);
      if (set.kind === 'sourced') {
        // The speedcubing community's algorithms are wide turns, slices and whole-cube turns as often as
        // face turns, so they are read by CUBEJS here — from outside the generator AND from outside this
        // repository's interpreter, which the generator uses to measure them.
        const c = new Cube();
        c.move(alg);
        assert.equal(c.isSolved(), false, `${set.id}/${name} leaves a solved cube solved, so it does nothing`);
        continue;
      }
      // Not a limit of the renderer, which plays wide turns, slices and whole-cube turns: the hand-written
      // tables keep to face turns BY CHOICE, so the first algorithms a learner meets need no notation beyond
      // the six faces (lib/methods/last-layer.js). A wide turn here is a change to that choice, not a typo.
      for (const m of movesOf(alg)) {
        assert.match(m, FACE_TURN, `${set.id}/${name}: "${m}" is not a face turn, and the hand-written tables keep to face turns`);
      }
      if (set.kind === 'not an algorithm') continue;
      const after = applyAlg(SOLVED, alg);
      const unchanged = ['cp', 'co', 'ep', 'eo'].every((k) => after[k].every((v, i) => v === SOLVED[k][i]));
      assert.equal(unchanged, false, `${set.id}/${name} leaves a solved cube solved, so it does nothing`);
    }
  }
});

test('the named steps that are not algorithms are the only empty entries, and no method counts them', () => {
  // The alignment was once absent and a one-turn cube got a nineteen-move lesson; it is kept out of PLL_ALGS
  // on purpose — "turn the top until it matches" is not something anyone memorises. The turn that brings a
  // pairs slot to the front is the same kind of thing. Both are names a step carries, so both are filed, and
  // neither may be folded into any method's cost. Held to the modules' own lists of such names, never to a
  // list typed here.
  const empties = MEASURED_SETS.flatMap((s) => s.algs.filter((a) => movesOf(a.alg).length === 0)
    .map((a) => `${s.id}/${a.name}`));
  const notAlgorithms = MEASURED_SETS.filter((s) => s.kind === 'not an algorithm');
  assert.deepEqual(empties, notAlgorithms.flatMap((s) => s.algs.map((a) => `${s.id}/${a.name}`)),
    'an entry is empty that is not filed as "not an algorithm", or one so filed does something');
  assert.deepEqual(notAlgorithms.flatMap((s) => s.algs.map((a) => a.name)).sort(),
    [...LAST_LAYER_EXTRAS, ...PAIRS_EXTRAS].map((a) => a.name).sort(),
    'the ledger\'s non-algorithms are not the extras the method modules declare');
  for (const m of METHOD_ALGORITHMS) {
    for (const s of notAlgorithms) {
      assert.ok(!m.sets.includes(s.id), `${m.method} counts "${s.id}" as an algorithm it teaches`);
    }
  }
});

test('every method names sets that exist, and every set is named by some method', () => {
  const ids = new Set(ALGORITHM_SETS.map((s) => s.id));
  const used = new Set();
  for (const m of METHOD_ALGORITHMS) {
    for (const id of m.sets) {
      assert.ok(ids.has(id), `${m.method} needs a set "${id}" that the ledger does not have`);
      used.add(id);
    }
    // Every phase must say exactly one thing about itself: it is held, it is intuitive, or it is
    // missing. "None of the above" is how a phase quietly stops being accounted for.
    for (const p of m.phases) {
      const kinds = ['held', 'intuitive', 'missing'].filter((k) => p[k] !== undefined);
      assert.equal(kinds.length, 1,
        `${m.method}/${p.phase} is ${kinds.length === 0 ? 'neither held, intuitive nor missing' : `both ${kinds.join(' and ')}`}`);
    }
  }
  // A set nothing needs is a set we would claim to teach and never show — the same rule
  // `CASE_NAMES` already enforces one level down. The non-algorithms are exempt: they are not taught.
  //
  // So are the PROVED tables, and only because they are the ORACLE: no method teaches them since 2026-10-13
  // (the human-speed tables replaced them) and no screen shows them since the Drill went (ADR 0010), but
  // `human-algs.test.mjs` checks every sourced row against them. "Held and used by nothing" is the
  // defect, so for them the use asserted is that one — read off the test's own import, which is where it
  // would stop.
  const ORACLE_OF = { 'f2l-full': 'F2L_CASES', 'oll-full': 'FULL_OLL', 'pll-full': 'FULL_PLL' };
  const humanAlgsTest = readFileSync(new URL('./human-algs.test.mjs', import.meta.url), 'utf8');
  const oracleImport = humanAlgsTest.match(/import \{([^}]*)\} from '\.\.\/lib\/data\/case-tables\.js'/)?.[1] ?? '';
  for (const id of ids) {
    if (ALGORITHM_SETS.find((s) => s.id === id).kind === 'not an algorithm') continue;
    if (ALGORITHM_SETS.find((s) => s.id === id).kind === 'proved') {
      assert.ok(ORACLE_OF[id], `"${id}" is a proved set with no oracle named for it here`);
      assert.ok(oracleImport.split(',').map((n) => n.trim()).includes(ORACLE_OF[id]),
        `"${id}" is taught by no method, and human-algs.test.mjs no longer checks anything against it`);
      continue;
    }
    assert.ok(used.has(id), `no method needs "${id}" — it is held and never taught`);
  }
});

test('the offered methods are the registry\'s: one per entry, by id, label and stage', () => {
  // The ledger once modelled the rung LADDER and compared itself with `methods/index.js`; ADR 0011 took the
  // ladder away as a learner's choice, and the solve tab now offers the registry's fixed methods. So the
  // mapping is held to the registry, entry by entry: an entry added, renamed or restaged there fails here.
  const offered = METHOD_ALGORITHMS.filter((m) => m.id !== null);
  assert.deepEqual(offered.map((m) => m.id), METHODS.map((e) => e.id),
    'the ledger\'s offered methods are not the registry\'s entries, in the registry\'s order');
  for (const entry of METHODS) {
    const m = offered.find((x) => x.id === entry.id);
    assert.equal(m.method, entry.label, `${entry.id}: the ledger calls it "${m.method}", the registry "${entry.label}"`);
    if (entry.engine === 'two-phase') {
      assert.deepEqual(m.sets, [], `${entry.id} runs the two-phase search, so it can teach no set`);
      assert.equal(m.held, 0, `${entry.id} runs the two-phase search, so it memorises nothing`);
      continue;
    }
    assert.deepEqual(m.phases.map((p) => p.stage), [...entry.stages],
      `${entry.id}: the ledger's phases are not the registry's stages`);
  }
  // A method the app does not offer must not look like one that it does.
  for (const m of METHOD_ALGORITHMS.filter((x) => x.id === null)) {
    assert.ok(m.phases.every((p) => p.stage === undefined), `${m.method} is not offered, yet names a registry stage`);
  }
});

test('every name a method step can carry is filed in exactly one set, and every taught set\'s names can be carried', () => {
  // The other direction from the solver relation below, and independent of any sample: `CASE_NAMES` is the
  // whole list of names a step may carry, so a name in it that no set files is an algorithm the ledger does
  // not count, whether or not a frozen cube happens to meet it. The proved tables are left out: they are the
  // oracle, not taught, and their names are not on any step.
  const filed = new Map();
  for (const s of MEASURED_SETS.filter((x) => x.kind !== 'proved')) {
    for (const { name } of s.algs) filed.set(name, [...(filed.get(name) ?? []), s.id]);
  }
  for (const name of CASE_NAMES) {
    assert.equal((filed.get(name) ?? []).length, 1,
      `"${name}" can be named on a step and is filed in ${(filed.get(name) ?? []).join(' and ') || 'no set'}`);
  }
  const carried = new Set(CASE_NAMES);
  for (const name of filed.keys()) {
    assert.ok(carried.has(name), `"${name}" is filed in the ledger, but no step may name it (it is not in CASE_NAMES)`);
  }
});

test('each offered method names exactly the sets the ledger maps to it, solving frozen cubes', async () => {
  // THE RELATION, measured rather than asserted from a list. A built method's stages do not say which
  // algorithms they teach — a stage searches a repertoire — so each registry method is run on the frozen
  // contract cubes and every name its steps carry is collected. Two things must hold:
  //   (a) every name emitted is in a set the ledger maps to THAT method, or is a named non-algorithm. The
  //       fallback inserts were caught this way once: the top of the old ladder named `facing-up`,
  //       `insert-left` and the rest when a pair was buried, and the ledger said it did not need them.
  //   (b) every set the ledger maps to a method is emitted at least once. A mapped set that never appears is
  //       a cost the ledger charges for something the method does not teach.
  // FROZEN, not drawn (AGENTS.md §3): the method solver has no budget, but a set's appearing is a property
  // of the sample, and a drawn sample would make (b) a lottery. Measured 2026-10-17: these four cubes
  // exercise every mapped set of every method; the fallback inserts are the thinnest, missing from one of
  // the four under both CFOP entries.
  const states = CONTRACT_CUBES.map((facelets) => fromCube(Cube.fromString(toMethodFrame(facelets))));
  const fileOf = new Map(MEASURED_SETS.filter((s) => s.kind !== 'proved')
    .flatMap((s) => s.algs.map((a) => [a.name, s.id])));
  const notAlgorithms = new Set(MEASURED_SETS.filter((s) => s.kind === 'not an algorithm').map((s) => s.id));
  const engines = METHODS.filter((e) => e.engine === 'method');
  assert.ok(engines.length >= 4, `only ${engines.length} method engines found — the sweep would check almost nothing`);
  for (const entry of engines) {
    await prepareMethod(entry);
    const method = methodOf(entry);
    const mapped = new Set(METHOD_ALGORITHMS.find((m) => m.id === entry.id).sets);
    const emitted = new Set();
    for (const [i, state] of states.entries()) {
      for (const step of solveByMethod(state, method).steps) {
        if (step.kind !== 'case') continue;
        // A pairs step at the trigger and F2L stages names its ALGORITHMS in `parts`; its `caseName` is the
        // case it recognises — where the pair's two pieces sit (`f2lAlignment`) — and must not be read as
        // an algorithm. Every other case step names its one algorithm in `caseName`.
        if (step.parts) {
          assert.ok(!fileOf.has(step.caseName),
            `${entry.id}, CONTRACT_CUBES[${i}]: a pairs step's case "${step.caseName}" is filed as an algorithm`);
        }
        const names = step.parts ? step.parts.map((p) => p.name) : [step.caseName];
        assert.ok(names.length > 0 && names.every((n) => typeof n === 'string' && n.length > 0),
          `${entry.id}, CONTRACT_CUBES[${i}]: a ${step.stage} case step names no algorithm`);
        for (const name of names) {
          const set = fileOf.get(name);
          assert.ok(set, `${entry.id}, CONTRACT_CUBES[${i}]: a ${step.stage} step names "${name}", which no set files`);
          assert.ok(mapped.has(set) || notAlgorithms.has(set),
            `${entry.id}, CONTRACT_CUBES[${i}]: a ${step.stage} step names "${name}" from "${set}", which the ledger does not map to ${entry.id}`);
          emitted.add(set);
        }
      }
    }
    const unexercised = [...mapped].filter((id) => !emitted.has(id));
    assert.deepEqual(unexercised, [],
      `${entry.id}: the ledger maps ${unexercised.join(', ')} to it, and no step on the ${states.length} frozen cubes names any of them`);
  }
});

test('each offered method costs the distinct algorithms of the sets it teaches', () => {
  const byId = Object.fromEntries(METHOD_ALGORITHMS.filter((m) => m.id).map((m) => [m.id, m]));
  assert.equal(byId.quick.held, 0, 'Quick is the two-phase search, and memorises nothing');
  assert.equal(byId.beginner.held, 12, 'Beginner is cross 2 + first layer 3 + middle 2 + the course\'s 2 + 3');
  // The triggers `right` (`R U R'`) and `left` (`F' U' F`) ARE the corner inserts `right-hand` and
  // `left-hand`, which the fallback for a buried pair still names; a learner memorises each once.
  assert.equal(byId['cfop-4lll'].held, 20,
    'CFOP (easy) is triggers 6 + first layer 3 + middle 2 + two-look OLL 1 + 5 + two-look PLL 3 + 2 = 22, less the two triggers that are corner inserts');
  // Not 119. CFOP (full) still needs the beginner inserts whenever a pair is BURIED, because `pairsFrom` falls
  // back to `placeSeparately`; and not 124, because three F2L cases ARE corner inserts — F2L 3 is `F' U' F`,
  // F2L 4 is `R U R'`, F2L 17 is `R U2 R' U' R U R'`.
  assert.equal(byId.cfop.held, 121, 'CFOP (full) is F2L 41 + first layer 3 + middle 2 + OLL 57 + PLL 21 = 124, less the three F2L cases that are corner inserts');
  assert.equal(byId.roux.held, 42, 'Roux is CMLL 42; its blocks and its last six edges are found by search');
  const tables = ['f2l-human', 'oll-human', 'pll-human'].reduce((a, id) => a + ALGORITHM_SETS.find((s) => s.id === id).count, 0);
  assert.notEqual(byId.cfop.held, tables,
    'if CFOP (full) costs exactly its three tables again the fallback has gone, and the comment above needs rewriting');
});

test('the headline counts are what the sets add up to', () => {
  const total = ALGORITHM_SETS.reduce((a, s) => a + s.count, 0);
  const countOf = (kind) => ALGORITHM_SETS.filter((s) => s.kind === kind).reduce((a, s) => a + s.count, 0);
  const proved = countOf('proved');
  const hand = countOf('hand-written');
  const sourced = countOf('sourced');
  const notAlgorithms = countOf('not an algorithm');
  assert.equal(proved + hand + sourced + notAlgorithms, total, 'the kinds do not partition the ledger');
  assert.equal(notAlgorithms, 2, 'the alignment and the turn to a slot are the only named steps that are not algorithms');
  assert.equal(proved, 119, 'the proved tables are F2L 41 + OLL 57 + PLL 21');
  assert.equal(sourced, 161,
    'the sourced tables are the human-speed F2L 41 + OLL 57 + PLL 21 (one row per proved case), plus CMLL 42');
  assert.equal(hand, 29,
    'the hand-written tables are cross 2 + first layer 3 + middle 2 + triggers 6 + two-look OLL 1 + 5 + two-look PLL 3 + 2, plus the course\'s 2 + 3');

  // The contrast the ledger exists to make: a beginner method costs a fraction of CFOP, and the search
  // methods cost nothing at all because they search instead of remembering.
  const byName = Object.fromEntries(METHOD_ALGORITHMS.map((m) => [m.method, m]));
  assert.equal(byName.Thistlethwaite.held, 0, 'a search method memorises nothing');
  assert.equal(byName["The app's solver"].held, 0, 'a search method memorises nothing');
  const byId = Object.fromEntries(METHOD_ALGORITHMS.filter((m) => m.id).map((m) => [m.id, m]));
  assert.ok(byId.cfop.held > byId.beginner.held * 6,
    'CFOP (full) should cost many times what Beginner does, or one of them has been mis-mapped');
});

test('a method with nothing held says what it is missing', () => {
  // The useful half of the ledger. "We do not teach Mehta" is worth little; "Mehta needs EOLE, 6CO, 6CP
  // and L5EP and we have none of them" is a work item. A method with no sets and no missing entries would
  // be a hole pretending to be a method.
  for (const m of METHOD_ALGORITHMS) {
    if (m.held > 0) continue;
    const searchMethod = m.phases.some((p) => (p.intuitive ?? '').startsWith('NONE'));
    assert.ok(m.missing.length > 0 || searchMethod,
      `${m.method} holds nothing, is missing nothing and is not a search method — one of those is wrong`);
  }
});

test('importing the ledger prints nothing, even from a file whose name ends the same way', () => {
  // The guard compared a SUFFIX of argv[1], so any importer whose name ended the same way printed the whole
  // report and armed the --emit write. Run in a child, because the guard reads the process's own argv.
  const dir = mkdtempSync(join(tmpdir(), 'ledger-import-'));
  try {
    const importer = join(dir, 'unrelated-algorithm-ledger.mjs');
    writeFileSync(importer, `import ${JSON.stringify(new URL('../bench/algorithm-ledger.mjs', import.meta.url).href)};\n`);
    const ran = spawnSync(process.execPath, [importer], { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout, '', 'an import printed the report');
    // And run directly, it still reports — the guard must not be fixed by never running.
    const direct = spawnSync(process.execPath, [new URL('../bench/algorithm-ledger.mjs', import.meta.url).pathname], { encoding: 'utf8' });
    assert.match(direct.stdout, /distinct algorithms/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

