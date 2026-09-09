// Reproduces every number in dev-docs/method-solver-design.md and the ladder table in
// dev-docs/method-solver-return-plan.md §8.
//
// Three questions, and they need different evidence:
//
//   profile     What does a solve cost — moves, steps, and which algorithms a learner would
//               meet? Sampled over random states, per rung combination.
//   ladder      The §8 table: every rung combination, moves and steps, side by side. This table
//               IS the product decision — a rung that saves under a step is not a lesson, and
//               §10 says such a rung should not ship.
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
//   node bench/method-solver-profile.mjs all

import { createRequire } from 'node:module';

import { SOLVED, applyAlg } from '../lib/cube-pieces.js';
import { LADDER, STAGE_IDS, allRungCombinations, methodFor, rungKey, solveByMethod } from '../lib/method-solver.js';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const movesIn = (alg) => (alg.trim() ? alg.trim().split(/\s+/).length : 0);

const STAGES = ['cross', 'first-layer', 'middle-layer', 'f2l', 'top-cross', 'top-face', 'top-corners', 'top-edges'];
/** How many states also get solved by cubejs, for the side-by-side. */
const TWO_PHASE_SAMPLE = 100;

/** The two combinations that had names before the split, so the old numbers stay comparable. */
const NAMED = [
  { name: 'beginner', rungs: { cross: 0, pairs: 0, oll: 0, pll: 0 } },
  { name: 'intermediate', rungs: { cross: 1, pairs: 1, oll: 0, pll: 0 } },
];

/** Deterministic states, so the ladder table is a fact about a run and not about a shuffle.
 *  Same generator as the test suite's — cubejs cannot seed its random states. */
function seededStates(count, seed) {
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
  const suffix = ['', "'", '2'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const alg = [];
    let prev = -1;
    while (alg.length < 30) {
      const f = Math.floor(rnd() * 6);
      if (f === prev) continue;
      prev = f;
      alg.push(faces[f] + suffix[Math.floor(rnd() * 3)]);
    }
    out.push(applyAlg(SOLVED, alg.join(' ')));
  }
  return out;
}

function profile(n, { name, rungs }) {
  Cube.initSolver();
  const method = methodFor(rungs);
  const moves = [];
  const steps = [];
  const ms = [];
  const twoPhase = [];
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
    if (twoPhase.length < TWO_PHASE_SAMPLE) twoPhase.push(movesIn(cube.solve()));
    for (const step of result.steps) {
      const key = step.caseName ?? 'goal (searched)';
      cases.set(key, (cases.get(key) ?? 0) + 1);
      stageSteps.set(step.stage, (stageSteps.get(step.stage) ?? 0) + 1);
      stageMoves.set(step.stage, (stageMoves.get(step.stage) ?? 0) + movesIn(step.alg));
    }
  }

  console.log(`\n[profile:${name} ${rungKey(rungs)}] n=${n}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  ${mean(steps).toFixed(1)} steps | ${mean(moves).toFixed(1)} moves` +
    `  (range ${Math.min(...moves)}-${Math.max(...moves)})`);
  console.log(`  cubejs two-phase ${mean(twoPhase).toFixed(1)} moves in 1 step (n=${twoPhase.length})` +
    ' — the same cube, unexplained');
  console.log(`  solved in ${mean(ms).toFixed(1)} ms mean, ${Math.max(...ms).toFixed(0)} ms worst` +
    ' — no tables, no search beyond four moves');
  console.log('\n  stage           steps  moves');
  for (const stage of STAGES) {
    if (!stageSteps.has(stage)) continue;
    console.log(`  ${stage.padEnd(14)} ${((stageSteps.get(stage) ?? 0) / n).toFixed(1).padStart(5)}` +
      `  ${((stageMoves.get(stage) ?? 0) / n).toFixed(1).padStart(5)}`);
  }
  console.log('\n  algorithms a learner meets, per solve:');
  for (const [name_, count] of [...cases].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name_.padEnd(18)} ${(count / n).toFixed(2)}`);
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
  const combinations = allRungCombinations();
  const rows = [];
  for (const rungs of combinations) {
    const method = methodFor(rungs);
    const moves = [];
    const steps = [];
    let fallbacks = 0;
    let pairSteps = 0;
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
        if (step.parts) pairSteps++;
        else fallbacks++;
      }
    }
    const label = NAMED.find((m) => rungKey(m.rungs) === rungKey(rungs))?.name ?? '';
    rows.push({
      key: rungKey(rungs),
      label,
      moves: mean(moves),
      steps: mean(steps),
      fallbackRate: pairSteps + fallbacks > 0 ? fallbacks / (pairSteps + fallbacks) : null,
      ms: Date.now() - t0,
    });
  }

  console.log(`\n[ladder] every rung combination over the same ${n} cubes (seed ${seed})`);
  console.log('  combination            moves   steps   fallback');
  for (const row of rows) {
    const name = row.label ? ` (${row.label})` : '';
    console.log(
      `  ${(row.key + name).padEnd(22)} ${row.moves.toFixed(1).padStart(5)}` +
      `   ${row.steps.toFixed(1).padStart(5)}` +
      `   ${row.fallbackRate === null ? '    —' : `${(row.fallbackRate * 100).toFixed(0)}%`.padStart(5)}`,
    );
  }

  // §10: "if rung 1 and rung 2 of a stage differ by under a step — that stage has one rung and
  // the ladder was invention." Reported per stage, holding the other three at rung 0, so the
  // number is about that dial and not about the company it keeps.
  console.log('\n  what each dial is worth, with the other three at rung 0:');
  const base = rows.find((r) => r.key === '0,0,0,0');
  for (const id of STAGE_IDS) {
    for (const stage of LADDER[id]) {
      if (stage.rung === 0) continue;
      const rungs = { cross: 0, pairs: 0, oll: 0, pll: 0, [id]: stage.rung };
      const row = rows.find((r) => r.key === rungKey(rungs));
      const saved = base.steps - row.steps;
      const verdict = saved >= 1 ? 'a lesson' : 'UNDER A STEP — not a lesson (§10)';
      console.log(`  ${id} ${stage.rung} (${stage.label})`.padEnd(34) +
        `${saved >= 0 ? '-' : '+'}${Math.abs(saved).toFixed(1)} steps  ${verdict}`);
    }
  }
  return rows;
}

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

function exhaustive() {
  const P4 = permutations([0, 1, 2, 3]);
  const twists = [];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    twists.push([a, b, c, (9 - a - b - c) % 3]);
  }
  const flips = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    flips.push([a, b, c, (a + b + c) % 2]);
  }

  // Every last-layer rung combination, not just the default. The one-look rungs are a 57-case and
  // a 21-case table, and "the table is complete" is precisely the claim a sample cannot make: it
  // is the enumeration or it is nothing. Rung 0's completeness was already proved this way; the
  // generated tables get the same treatment rather than a promise from the generator.
  // `exhaustive 1 1` runs one combination — the whole set is four sweeps and is the nightly job.
  const [wantOll, wantPll] = process.argv.slice(3).map(Number);
  const combinations = [];
  for (const oll of LADDER.oll) {
    for (const pll of LADDER.pll) {
      if (Number.isInteger(wantOll) && (oll.rung !== wantOll || pll.rung !== wantPll)) continue;
      combinations.push({ cross: 0, pairs: 0, oll: oll.rung, pll: pll.rung });
    }
  }
  if (combinations.length === 0) throw new Error('no such last-layer rung combination');
  for (const rungs of combinations) exhaustiveAt(rungs, { P4, twists, flips });
}

/** The sweep at one rung combination. Separated so the loop above reads as what it is. */
function exhaustiveAt(rungs, { P4, twists, flips }) {
  const method = methodFor(rungs);
  let total = 0;
  let failed = 0;
  let moves = 0;
  const cases = new Map();
  const t0 = Date.now();

  for (const cp of P4) {
    for (const ep of P4) {
      if (parity(cp) !== parity(ep)) continue;
      for (const co of twists) {
        for (const eo of flips) {
          const state = {
            cp: [...cp, 4, 5, 6, 7], co: [...co, 0, 0, 0, 0],
            ep: [...ep, 4, 5, 6, 7, 8, 9, 10, 11], eo: [...eo, 0, 0, 0, 0, 0, 0, 0, 0],
          };
          total++;
          try {
            const result = solveByMethod(state, method);
            moves += result.moveCount;
            for (const step of result.steps) {
              cases.set(step.caseName, (cases.get(step.caseName) ?? 0) + 1);
            }
          } catch (err) {
            failed++;
            if (failed <= 5) console.log(`  FAIL ${err.stage}/${err.target}: ${JSON.stringify({ cp, co, ep, eo })}`);
          }
        }
      }
    }
  }

  console.log(`\n[exhaustive ${rungKey(rungs)}] every reachable last-layer state, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  states ${total} | failures ${failed} | mean ${(moves / (total - failed)).toFixed(1)} moves`);
  console.log('  each algorithm, and how many of those states needed it:');
  for (const [name, count] of [...cases].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(18)} ${count}`);
  }
  if (failed > 0) {
    // A partial pass is not a pass: it means some learner's cube reaches a position the tutor
    // cannot finish, and the whole value of this file is ruling that out.
    throw new Error(`${failed} last-layer states have no solution in the repertoire`);
  }
}

// A guard on the model this file measures. A silently broken import would show up as a
// suspiciously good number rather than as an error, which is the failure mode this whole
// file exists to rule out.
{
  const sexy = applyAlg(SOLVED, "R U R' U'");
  if (JSON.stringify(sexy.cp) === JSON.stringify(SOLVED.cp)) {
    throw new Error("cube-pieces: the sexy move changed nothing, so nothing below measures a cube");
  }
}

export { ladder, seededStates };

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const stage = process.argv[2] ?? 'profile';
  if (stage === 'profile' || stage === 'all') {
    const n = Number(process.argv[3] ?? 400);
    for (const named of NAMED) profile(n, named);
  }
  if (stage === 'ladder' || stage === 'all') ladder(Number(process.argv[3] ?? 60));
  if (stage === 'exhaustive' || stage === 'all') exhaustive();
}
