// Reproduces every number in dev-docs/method-solver-design.md and the ladder table in
// dev-docs/method-solver-return-plan.md §8.
//
// Three questions, and they need different evidence:
//
//   profile     What does a solve cost — moves, steps, and which algorithms a learner would
//               meet? Sampled over random states, per rung combination.
//   ladder      The §8 table: every rung combination, moves and steps, side by side. This table
//               IS the product decision — §10's rule is that a rung which moves nothing its
//               learner can measure should not ship.
//   exhaustive  Is the last-layer repertoire COMPLETE? Not sampled: with the first two layers
//               solved the last layer has 4! corner perms x 4! edge perms of matching parity
//               x 3^3 twists x 2^3 flips = 62,208 reachable states, which is small enough to
//               enumerate. A case table verified by sampling is a case table that fails on a
//               learner's cube six months later, so this one is proved instead.
//
// Run (from apps/web):
//   node bench/method-solver-profile.mjs                 # the named methods, n=400, ~4 min
//   node bench/method-solver-profile.mjs profile 100     # a quicker look, ~1 min
//   node bench/method-solver-profile.mjs ladder 60       # every combination, moves and steps
//   node bench/method-solver-profile.mjs exhaustive      # all 62,208 last-layer states
//   node bench/method-solver-profile.mjs exhaustive 1 1  # one last-layer rung combination
//   node bench/method-solver-profile.mjs all 60          # all three, at n=60
//
// **The command line is parsed once, strictly.** `all 2` used to read the 2 as an OLL rung
// selector, because `exhaustive` reached into `process.argv` for its own arguments rather than
// being handed them — so the one command that runs everything failed at the last of the three,
// after the first two had already spent their minutes. `ladder 0` reported NaN, `ladder 1.5`
// divided by a fractional denominator, and an unknown command exited 0 having done nothing.

import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { SOLVED, applyAlg, moveCount } from '../lib/cube-pieces.js';
import { LADDER, allRungCombinations, methodFor, rungKey, solveByMethod } from '../lib/method-solver.js';
import { seededStates } from '../test/fixtures/seeded-scrambles.mjs';
import { turnsOf } from '../test/fixtures/method-replay.mjs';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const STAGES = ['cross', 'first-layer', 'middle-layer', 'f2l', 'top-cross', 'top-face', 'top-corners', 'top-edges'];
/** How many states also get solved by cubejs, for the side-by-side. */
const TWO_PHASE_SAMPLE = 100;

/** The two combinations that had names before the split, so the old numbers stay comparable. */
const NAMED = [
  { name: 'beginner', rungs: { cross: 0, pairs: 0, oll: 0, pll: 0 } },
  { name: 'intermediate', rungs: { cross: 1, pairs: 1, oll: 0, pll: 0 } },
];

/**
 * What each rung is judged on, and the floor it has to clear — §10's first kill-criterion.
 *
 * The axis is PER RUNG because they are not interchangeable: a rung that halves the step count and
 * one that changes what a single step is MADE OF are both real, and judging the second on steps is
 * a criterion that is not measuring the rung. `method-solver.test.mjs` imports this table, so the
 * bench and the test cannot disagree about what a rung has to do.
 *
 * Floors sit under the measured values with margin — the point is to catch a rung that moves
 * NOTHING, not to pin a number any improvement would break.
 */
export const RUNG_CRITERIA = Object.freeze([
  Object.freeze({ dial: 'cross', from: 0, to: 1, axis: 'steps', floor: 4 }),
  Object.freeze({ dial: 'pairs', from: 0, to: 1, axis: 'steps', floor: 2 }),
  Object.freeze({ dial: 'pairs', from: 1, to: 2, axis: 'parts', floor: 0.75 }),
  Object.freeze({ dial: 'oll', from: 0, to: 1, axis: 'steps', floor: 1.5 }),
  Object.freeze({ dial: 'pll', from: 0, to: 1, axis: 'steps', floor: 0.9 }),
]);

/** Which stages belong to which dial — a dial is judged on the steps it is responsible for. */
export const STAGES_OF = Object.freeze({
  cross: Object.freeze(['cross']),
  pairs: Object.freeze(['f2l', 'first-layer', 'middle-layer']),
  oll: Object.freeze(['top-cross', 'top-face']),
  pll: Object.freeze(['top-corners', 'top-edges']),
});

/**
 * How far one rung moves its axis — the measurement both the bench and the gate use.
 *
 * Counted only on solves where the stage actually RAN at both rungs. A cube whose cross was
 * already done says nothing about the cross rung, and letting those in dilutes every delta toward
 * zero — which is how a rung that does a great deal can look like one that does a little.
 *
 * The other three dials are held at rung 0, so the number is about this dial and not about the
 * company it keeps.
 */
export function rungDelta(states, { dial, from, to, axis }) {
  const BOTTOM = { cross: 0, pairs: 0, oll: 0, pll: 0 };
  const below = methodFor({ ...BOTTOM, [dial]: from });
  const above = methodFor({ ...BOTTOM, [dial]: to });
  const mine = (m, state) => solveByMethod(state, m).steps.filter((s) => STAGES_OF[dial].includes(s.stage));
  const measure = (steps) => ({
    steps: steps.length,
    // Face turns, played in each step's hold: a regrip is not a move (plan item 6.1).
    moves: steps.reduce((n, s) => n + moveCount(turnsOf(s)), 0),
    parts: steps.reduce((n, s) => n + (s.parts?.length ?? 0), 0)
      / Math.max(1, steps.filter((s) => s.parts).length),
  });
  let compared = 0;
  let delta = 0;
  for (const state of states) {
    const a = mine(below, state);
    const b = mine(above, state);
    if (!a.length || !b.length) continue;
    compared += 1;
    delta += measure(a)[axis] - measure(b)[axis];
  }
  return { moved: compared ? delta / compared : 0, compared };
}

// ---- the command line -------------------------------------------------------------------------

const COMMANDS = ['profile', 'ladder', 'exhaustive', 'all'];
const USAGE = `usage: node bench/method-solver-profile.mjs [${COMMANDS.join('|')}] [n | <oll> <pll>]`;

class UsageError extends Error {}

/** A sample size: a finite positive integer, and nothing that merely looks like one. */
function sampleCount(text, fallback) {
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) {
    throw new UsageError(`sample count: "${text}" is not a positive whole number`);
  }
  return n;
}

/** A last-layer rung pair, checked against the rungs that exist. */
function rungSelector(rest) {
  if (rest.length === 0) return null;
  if (rest.length !== 2) {
    throw new UsageError('exhaustive takes either no selector or both: <oll rung> <pll rung>');
  }
  const [oll, pll] = rest.map(Number);
  const known = (dial, rung) => LADDER[dial].some((s) => s.rung === rung);
  if (!known('oll', oll) || !known('pll', pll)) {
    throw new UsageError(`no such last-layer rung combination: oll ${rest[0]}, pll ${rest[1]}`);
  }
  return { oll, pll };
}

export function parseArgs(argv) {
  const [command = 'profile', ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new UsageError(`unknown command: ${command}`);
  if (command === 'exhaustive') {
    return { command, selector: rungSelector(rest) };
  }
  if (rest.length > 1) throw new UsageError(`${command} takes at most a sample count`);
  const fallback = command === 'ladder' ? 60 : 400;
  return { command, n: sampleCount(rest[0], fallback), selector: null };
}

// ---- profile ----------------------------------------------------------------------------------

/** Every algorithm one step exposes: a composite pair step's PARTS, or the step's own case. */
function algorithmsOf(step) {
  // A pair step's `caseName` is the CONFIGURATION — `UBR0/UL0`, where the pieces are — and the
  // algorithms are the triggers in `parts`. Counting the configuration under the heading
  // "algorithms a learner meets" listed positions and omitted every F2L algorithm there is.
  if (step.parts?.length) return step.parts.map((p) => p.name);
  return [step.caseName ?? 'goal (searched)'];
}

/** Count `keys` into `into`. */
const tally = (into, keys) => {
  for (const key of keys) into.set(key, (into.get(key) ?? 0) + 1);
};

/** The table of counts, largest first. */
function printTally(title, counts, n) {
  if (counts.size === 0) return;
  console.log(`\n  ${title}`);
  for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(18)} ${(count / n).toFixed(2)}`);
  }
}

function profile(n, { name, rungs }) {
  Cube.initSolver();
  const method = methodFor(rungs);
  const moves = [];
  const steps = [];
  const ms = [];
  const twoPhase = [];
  const algorithms = new Map();
  const cases = new Map();
  const stageSteps = new Map();
  const stageMoves = new Map();

  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const cube = Cube.random();
    const facelets = cube.asString();
    const startedAt = process.hrtime.bigint();
    const result = solveByMethod({ cp: [...cube.cp], co: [...cube.co], ep: [...cube.ep], eo: [...cube.eo] }, method);
    ms.push(Number(process.hrtime.bigint() - startedAt) / 1e6);

    // The oracle, every time. A move count is only worth printing if the alg it counts solves.
    const oracle = Cube.fromString(facelets);
    oracle.move(result.alg);
    if (!oracle.isSolved()) throw new Error(`cubejs disagrees this alg solves ${facelets}`);

    moves.push(result.moveCount);
    steps.push(result.steps.length);
    // The two-phase comparison is capped: cubejs costs ~250 ms a state and would otherwise
    // be the whole runtime, for a figure that is already stable well before n=400.
    if (twoPhase.length < TWO_PHASE_SAMPLE) twoPhase.push(moveCount(cube.solve()));
    for (const step of result.steps) {
      tally(algorithms, algorithmsOf(step));
      if (step.caseName) tally(cases, [step.caseName]);
      stageSteps.set(step.stage, (stageSteps.get(step.stage) ?? 0) + 1);
      stageMoves.set(step.stage, (stageMoves.get(step.stage) ?? 0) + moveCount(turnsOf(step)));
    }
  }

  printProfile({ name, rungs, n, elapsed: (Date.now() - t0) / 1000,
    moves, steps, ms, twoPhase, algorithms, cases, stageSteps, stageMoves });
}

/** What one profile run found. Reporting is its own function: the loop above measures. */
function printProfile({ name, rungs, n, elapsed, moves, steps, ms, twoPhase, algorithms, cases, stageSteps, stageMoves }) {
  console.log(`\n[profile:${name} ${rungKey(rungs)}] n=${n}, ${elapsed.toFixed(0)}s`);
  console.log(`  ${mean(steps).toFixed(1)} steps | ${mean(moves).toFixed(1)} moves` +
    `  (range ${Math.min(...moves)}-${Math.max(...moves)})`);
  console.log(`  cubejs two-phase ${mean(twoPhase).toFixed(1)} moves in 1 step (n=${twoPhase.length})` +
    ' — the same cube, unexplained');
  // No claim about HOW it was solved: the sentence here used to read "no tables, no search beyond
  // four moves", which is false for any method with cross rung 1 in it — that rung descends an
  // exact 331,776-entry distance table, and `intermediate` is one of the two named methods this
  // command runs by default. The rungs are printed instead, which is a fact about the run.
  console.log(`  solved in ${mean(ms).toFixed(1)} ms mean, ${Math.max(...ms).toFixed(0)} ms worst` +
    ` — rungs ${rungKey(rungs)}`);
  console.log('\n  stage           steps  moves');
  for (const stage of STAGES) {
    if (!stageSteps.has(stage)) continue;
    console.log(`  ${stage.padEnd(14)} ${((stageSteps.get(stage) ?? 0) / n).toFixed(1).padStart(5)}` +
      `  ${((stageMoves.get(stage) ?? 0) / n).toFixed(1).padStart(5)}`);
  }
  printTally('algorithms a learner meets, per solve:', algorithms, n);
  printTally('cases a learner recognises, per solve:', cases, n);
}

// ---- ladder -----------------------------------------------------------------------------------

/** One rung combination's cost over one set of cubes. */
function measureRungs(rungs, states) {
  const method = methodFor(rungs);
  const moves = [];
  const steps = [];
  let fallbacks = 0;
  let pairSteps = 0;
  let parts = 0;
  const t0 = Date.now();
  for (const state of states) {
    const result = solveByMethod(state, method);
    moves.push(result.moveCount);
    steps.push(result.steps.length);
    // A pair step carries `parts` when the pairing rung reached it, and does not when it fell
    // back to the rung below. §7a finding F1 says that fallback is structural, so the RATE is
    // a number this bench must report rather than a defect to hide.
    for (const step of result.steps) {
      if (step.stage !== 'f2l') continue;
      if (step.parts) { pairSteps++; parts += step.parts.length; } else fallbacks++;
    }
  }
  return {
    key: rungKey(rungs),
    rungs,
    moves: mean(moves),
    steps: mean(steps),
    // What a pair step is MADE OF — the axis pairs rung 2 is judged on, since it changes the
    // shape of a step rather than the number of them.
    parts: pairSteps > 0 ? parts / pairSteps : null,
    fallbackRate: pairSteps + fallbacks > 0 ? fallbacks / (pairSteps + fallbacks) : null,
    ms: Date.now() - t0,
  };
}

/**
 * §10's first kill-criterion, reported as the table it is.
 *
 * **ADJACENT rungs, on the axis that rung is judged on, over the cubes where the stage RAN.**
 * Every row used to be compared against rung 0, so pairs rung 2 was credited with rung 1's savings
 * as well as its own — a rung can look like a lesson entirely on the strength of the one below it.
 * The verdict was also a universal "one step", which is not the criterion: a rung that changes what
 * a step is MADE OF moves no steps at all and is not thereby invention.
 *
 * And it is `rungDelta`, the same function `method-solver.test.mjs` gates on. Measuring one thing
 * here and another there is how a bench comes to print "not a lesson" about a rung the suite is
 * happy with — which it did, because whole-solve step counts include cubes whose last layer was
 * already oriented and dilute every delta toward zero.
 */
function reportCriteria(states) {
  console.log(`\n  what each dial is worth, against the rung below it (${states.length} cubes):`);
  for (const criterion of RUNG_CRITERIA) {
    const { dial, from, to, axis, floor } = criterion;
    const { moved, compared } = rungDelta(states, criterion);
    const label = LADDER[dial].find((s) => s.rung === to)?.label ?? '';
    if (compared === 0) {
      console.log(`  ${dial} ${from}->${to} (${label})`.padEnd(34) + `no cube ran this stage at both rungs`);
      continue;
    }
    const verdict = moved >= floor ? 'a lesson' : `UNDER ITS FLOOR OF ${floor} — not a lesson (§10)`;
    console.log(`  ${dial} ${from}->${to} (${label})`.padEnd(34) +
      `${moved >= 0 ? '-' : '+'}${Math.abs(moved).toFixed(2)} ${axis} over ${compared}  ${verdict}`);
  }
}

/**
 * The §8 table: every rung combination over the SAME cubes.
 *
 * The same states for every row on purpose — comparing two rungs over two different samples
 * would report the sample's variance as the rung's gain, which is exactly the mistake the
 * "a rung that saves 0.3 steps is not a lesson" rule exists to prevent.
 */
function ladder(n, seed = 20260908) {
  const states = seededStates(n, seed);
  const rows = allRungCombinations().map((rungs) => measureRungs(rungs, states));

  console.log(`\n[ladder] every rung combination over the same ${n} cubes (seed ${seed})`);
  console.log('  combination            moves   steps   parts   fallback');
  for (const row of rows) {
    const name = NAMED.find((m) => rungKey(m.rungs) === row.key)?.name;
    console.log(
      `  ${(row.key + (name ? ` (${name})` : '')).padEnd(22)} ${row.moves.toFixed(1).padStart(5)}` +
      `   ${row.steps.toFixed(1).padStart(5)}` +
      `   ${row.parts === null ? '    —' : row.parts.toFixed(2).padStart(5)}` +
      `   ${row.fallbackRate === null ? '    —' : `${(row.fallbackRate * 100).toFixed(0)}%`.padStart(5)}`,
    );
  }
  reportCriteria(states);
  return rows;
}

// ---- exhaustive -------------------------------------------------------------------------------

/** All permutations of a small array. */
const permutations = (a) => (a.length <= 1 ? [a] :
  a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));

/** Permutation parity — an odd last layer on its own is unreachable, so those are not states
 *  the solver will ever be handed and counting them as failures would be a lie. */
function parity(p) {
  let inversions = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) inversions++;
  return inversions % 2;
}

/** Every reachable last-layer state, as an iterator — so the sweep reads as a loop over states. */
function* lastLayerStates() {
  const P4 = permutations([0, 1, 2, 3]);
  const twists = [];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    twists.push([a, b, c, (9 - a - b - c) % 3]);
  }
  const flips = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    flips.push([a, b, c, (a + b + c) % 2]);
  }
  for (const cp of P4) {
    for (const ep of P4) {
      if (parity(cp) !== parity(ep)) continue;
      for (const co of twists) {
        for (const eo of flips) {
          yield {
            cp: [...cp, 4, 5, 6, 7], co: [...co, 0, 0, 0, 0],
            ep: [...ep, 4, 5, 6, 7, 8, 9, 10, 11], eo: [...eo, 0, 0, 0, 0, 0, 0, 0, 0],
          };
        }
      }
    }
  }
}

function exhaustive(selector) {
  // Every last-layer rung combination, not just the default. The one-look rungs are a 57-case and
  // a 21-case table, and "the table is complete" is precisely the claim a sample cannot make: it
  // is the enumeration or it is nothing. Rung 0's completeness was already proved this way; the
  // generated tables get the same treatment rather than a promise from the generator.
  const combinations = [];
  for (const oll of LADDER.oll) {
    for (const pll of LADDER.pll) {
      if (selector && (oll.rung !== selector.oll || pll.rung !== selector.pll)) continue;
      combinations.push({ cross: 0, pairs: 0, oll: oll.rung, pll: pll.rung });
    }
  }
  if (combinations.length === 0) throw new UsageError('no such last-layer rung combination');
  for (const rungs of combinations) exhaustiveAt(rungs);
}

/** The sweep at one rung combination. Separated so the loop above reads as what it is. */
function exhaustiveAt(rungs) {
  const method = methodFor(rungs);
  let total = 0;
  const failures = [];
  let moves = 0;
  const cases = new Map();
  const t0 = Date.now();

  for (const state of lastLayerStates()) {
    total++;
    try {
      const result = solveByMethod(state, method);
      moves += result.moveCount;
      for (const step of result.steps) tally(cases, [step.caseName ?? 'goal (searched)']);
    } catch (err) {
      // The EXCEPTION, not two fields it may not have. A `MethodSolverError` carries `stage` and
      // `target`; anything else — a TypeError from a broken import, say — carries neither, and
      // this printed "FAIL undefined/undefined" and threw the message away. The one thing a sweep
      // over 62,208 states must not do is lose the reason the first of them failed.
      failures.push({ state, err });
      if (failures.length <= 5) {
        const where = err.stage ? `${err.stage}/${err.target}` : err.name || 'error';
        console.log(`  FAIL ${where}: ${err.message}`);
        console.log(`       ${JSON.stringify(state)}`);
      }
    }
  }

  console.log(`\n[exhaustive ${rungKey(rungs)}] every reachable last-layer state, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  states ${total} | failures ${failures.length} | mean ${(moves / (total - failures.length)).toFixed(1)} moves`);
  console.log('  each algorithm, and how many of those states needed it:');
  for (const [name, count] of [...cases].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(name).padEnd(18)} ${count}`);
  }
  if (failures.length > 0) {
    // A partial pass is not a pass: it means some learner's cube reaches a position the tutor
    // cannot finish, and the whole value of this file is ruling that out. The first failure's
    // stack goes with the message, because "which state" is not the same question as "why".
    console.error(failures[0].err.stack ?? failures[0].err.message);
    throw new Error(`${failures.length} last-layer states have no solution in the repertoire`);
  }
}

// ---- entry ------------------------------------------------------------------------------------

// A guard on the model this file measures. A silently broken import would show up as a
// suspiciously good number rather than as an error, which is the failure mode this whole
// file exists to rule out.
{
  const sexy = applyAlg(SOLVED, "R U R' U'");
  if (JSON.stringify(sexy.cp) === JSON.stringify(SOLVED.cp)) {
    throw new Error("cube-pieces: the sexy move changed nothing, so nothing below measures a cube");
  }
}

export { exhaustive, ladder, profile, UsageError };
export { seededStates };

export function main(argv) {
  const { command, n, selector } = parseArgs(argv);
  if (command === 'profile' || command === 'all') for (const named of NAMED) profile(n, named);
  if (command === 'ladder' || command === 'all') ladder(n);
  // `all` runs the WHOLE sweep, with no selector: the sample count it was given is a sample
  // count, and reading it as an OLL rung is how `all 2` used to fail after the first two
  // commands had already run.
  if (command === 'exhaustive' || command === 'all') exhaustive(command === 'all' ? null : selector);
}

/** Run, or imported? `pathToFileURL` and the realpath, for the reasons `regen-case-tables.mjs`
 *  records: a hand-spelt `file://` URL and an unresolved entry path each turn this into a module
 *  that quietly does nothing. */
function isDirectEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    if (import.meta.url === pathToFileURL(realpathSync(entry)).href) return true;
  } catch {
    // Not resolvable — fall through rather than assuming "imported".
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectEntry()) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}\n${USAGE}`);
    process.exit(1);
  }
}
