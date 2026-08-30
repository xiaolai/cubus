// Reproduces the solver numbers in dev-docs/solver-move-count.md.
//
// The question behind it: can we make the app's solutions shorter, and can minimal move count
// serve as a difficulty rating for a scramble? Both turn out to be bounded by search time, not
// by any missing data — so the numbers below are the argument.
//
// The engine is lib/two-phase.js — our own implementation (2026-08-29). The min2phase-era
// stages that measured a dependency's internals died with the dependency: `rotations`
// (best-of-24 conjugations — bought ~nothing, min2phase looped URF conjugations internally)
// and `tune` (probeMin/fullInit — knobs this engine does not have). Their findings are
// recorded history in the note; re-running them would need the vendored min2phase back.
//
// Lives in apps/web/ because it imports this package's `cubejs` and its lib/; pnpm does not
// hoist them to the repo root. build.mjs copies an explicit DIRS list, so bench/ never reaches
// dist/.
//
// Run (from apps/web):
//   node bench/solver-move-count.mjs            # baseline + shallow
//   node bench/solver-move-count.mjs baseline   # two-phase loose-bound lengths + init cost, ~5 s
//   node bench/solver-move-count.mjs sweep      # cubejs maxDepth 22/21/20, ~3 min
//   node bench/solver-move-count.mjs shallow    # minimal length for shallow states, ~5 min
//   node bench/solver-move-count.mjs targets    # the ladder: move-count targets, the product question
//   node bench/solver-move-count.mjs contract   # what solve-target.js assumes of the engine
//   node bench/solver-move-count.mjs all        # everything
//
// `sweep` and `shallow`'s 14-move rows are minutes of CPU. That cost IS the finding — see the
// note — so they are kept rather than trimmed, but every shallow trial is capped
// (BENCH_BUDGET_MS, default 120000) and reports the cap rather than running unbounded. A
// benchmark nobody can afford to finish is a benchmark nobody runs.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { DEFAULT_PROBE_BUDGET, TIERS, refine } from '../lib/solve-target.js';
import { LOOSEST_BOUND, VIEW_COUNT, createSolver, movesIn } from '../lib/solver-engine.js';
import { shareBudget, sliceViews } from '../lib/solve-client.js';

const require = createRequire(import.meta.url);
const Cube = require('cubejs');

/** A positive-integer environment knob, refused loudly rather than half-read. A NaN sample
 *  count or a fractional budget would print plausible nonsense under a real-looking label. */
function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${name}=${raw} is not a positive integer`);
  }
  return n;
}

// 20 by default. Overridable because a success RATE needs more samples than a mean does:
// 20/20 is not evidence of "always". Stage-specific knobs (BENCH_BUDGET_MS, BENCH_TARGETS,
// BENCH_MAXPHASE2) parse inside their stages, so a malformed one cannot stop an unrelated
// stage from running.
const N_STATES = intEnv('BENCH_N', 20);
/** Search nodes per attempt — the app's own default unless BENCH_PROBES overrides it. */
const NODE_BUDGET = intEnv('BENCH_PROBES', DEFAULT_PROBE_BUDGET);

/** One monotonic clock for every stage — Date.now() is neither, and mixing the two made the
 *  same label mean different things in different tables. */
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

const mean = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
const lenOf = (alg) => movesIn(String(alg));

/** Nearest-rank percentile over an unsorted sample, or null for an empty one — an empty cohort
 *  is a dash in the output, never an invented zero. */
function percentile(sample, p) {
  if (sample.length === 0) return null;
  const sorted = [...sample].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
const shown = (ms) => (ms === null ? '—' : ms.toFixed(0));

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const SUFFIX = ['', "'", '2'];

// Seeded so the shallow table reproduces exactly.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** A k-move random walk with no same-face repeat. NOTE: its true minimal length is
 *  often BELOW k — cancellations and coincidences collapse it. Measure, never assume. */
function randomWalk(k, seed) {
  const rnd = lcg(seed);
  const out = [];
  let prev = -1;
  while (out.length < k) {
    const f = Math.floor(rnd() * 6);
    if (f === prev) continue;
    prev = f;
    out.push(FACES[f] + SUFFIX[Math.floor(rnd() * 3)]);
  }
  return out.join(' ');
}

/** cubejs throws rather than returning empty when nothing exists within maxDepth — a
 *  TypeError from dereferencing its null solution, pinned by assertShallowDepthThrows below.
 *  ONLY that throw is the documented no-solution signal; anything else is a real defect and
 *  rethrows rather than reading as an ordinary depth miss. '' is preserved — it is the valid
 *  zero-move solution, not a failure. */
function solveOrNull(cube, maxDepth) {
  try {
    const s = cube.solve(maxDepth);
    return s == null ? null : s.trim();
  } catch (err) {
    if (err instanceof TypeError) return null;
    throw err;
  }
}

let engineWarm = false;

/** The real engine behind the real wrapper — exactly what the worker runs. */
async function loadEngine() {
  const engine = await import('../lib/two-phase.js');
  return { engine, solve: createSolver(engine) };
}

/** Every answer is verified, not sampled: a bound that returned a SHORTER but WRONG alg
 *  would otherwise read as the win we are looking for. */
function verify(facelets, alg) {
  const check = Cube.fromString(facelets);
  if (alg.trim()) check.move(alg.trim());
  if (!check.isSolved()) throw new Error(`solution does not solve ${facelets}: ${alg}`);
}

// --- 1. What the app ships -----------------------------------------------------------
// The loose first answer: LOOSEST_BOUND accepts anything up to 22 moves, and is what every
// search shows first. Also the one-time table cost the worker pays.
async function baseline() {
  const t0 = nowMs();
  const { engine, solve } = await loadEngine();
  const tImport = nowMs();
  engine.initialize();
  const tInit = nowMs();
  engineWarm = true;
  const lens = [];
  const times = [];
  for (let i = 0; i < N_STATES; i++) {
    const facelets = Cube.random().asString();
    const s0 = nowMs();
    const alg = solve(facelets, { solLen: LOOSEST_BOUND, probeMax: NODE_BUDGET });
    times.push(nowMs() - s0);
    if (alg === null) throw new Error(`loose bound returned null for ${facelets}`);
    verify(facelets, alg);
    lens.push(lenOf(alg));
  }
  console.log(`\n[baseline] two-phase loose bound (solLen ${LOOSEST_BOUND}), n=${N_STATES}`);
  console.log(
    `  module load ${(tImport - t0).toFixed(0)} ms | table build ${(tInit - tImport).toFixed(0)} ms ` +
      '(computed, never downloaded)',
  );
  console.log(`  lengths: ${lens.join(' ')}`);
  console.log(`  mean ${mean(lens)} moves | mean ${mean(times)} ms | worst ${Math.max(...times).toFixed(0)} ms`);
}

// --- 2. The cost of asking for one move fewer ---------------------------------------
// Each move shaved costs roughly an order of magnitude. This is the wall.
function sweep() {
  // Cube.initSolver() ran once at the top level for every stage; timing it again here would
  // print a meaningless warm zero under a real-looking label.
  console.log(`\n[sweep] cubejs by maxDepth, n=${N_STATES}`);
  const states = [];
  for (let i = 0; i < N_STATES; i++) states.push(Cube.random());
  for (const depth of [22, 21, 20]) {
    const lens = [];
    const times = [];
    for (const c of states) {
      const t0 = nowMs();
      const sol = solveOrNull(c, depth);
      times.push(nowMs() - t0);
      if (sol !== null) lens.push(lenOf(sol));
    }
    console.log(
      `  maxDepth=${depth}: solved ${lens.length}/${states.length} | ` +
        `mean ${lens.length ? mean(lens) : '—'} moves | mean ${mean(times)} ms | worst ${Math.max(...times).toFixed(0)} ms`,
    );
  }
  console.log('  maxDepth=19 omitted: minutes-to-hours per state.');
}

// --- 3. Where a difficulty rating is actually affordable ----------------------------
// Descend until the search fails. This is the minimal TWO-PHASE length — an upper
// bound on the true optimum, never a proof of it (see the note, section 4).
function shallow() {
  // Wall-clock cap per trial. Checked BETWEEN attempts, so a single attempt already in flight
  // can overrun it — the descent's last, failing probe is the expensive one.
  const TRIAL_BUDGET_MS = intEnv('BENCH_BUDGET_MS', 120_000);
  console.log('\n[shallow] minimal two-phase length for shallow states');
  console.log(`  cap ${TRIAL_BUDGET_MS} ms per trial`);
  console.log('  walk |   min | ms     | scramble');
  for (const k of [8, 10, 12, 14]) {
    for (let trial = 0; trial < 4; trial++) {
      const scr = randomWalk(k, k * 1000 + trial * 7 + 1);
      const cube = new Cube().move(scr);
      const t0 = nowMs();
      let lo = null;
      let capped = false;
      for (let d = k; d >= 1; d--) {
        if (nowMs() - t0 > TRIAL_BUDGET_MS) { capped = true; break; }
        const sol = solveOrNull(cube, d);
        if (sol === null) {
          // The FIRST attempt asks at the walk's own length, where a solution must exist — a
          // null there is a broken solver, not a measurement, and must not print as one.
          if (lo === null) throw new Error(`shallow: no solution at depth ${d} for ${scr}`);
          break;
        }
        lo = lenOf(sol);
        if (lo < d) d = lo; // the loop's own d-- takes the next attempt to lo - 1
      }
      const ms = nowMs() - t0;
      // A capped trial is reported, never dropped: `<=` says the true minimum may be lower
      // and we ran out of budget looking. Silently printing `lo` would read as a measurement.
      const label = capped ? `<=${lo}` : String(lo);
      console.log(
        `  ${String(k).padStart(4)} | ${label.padStart(5)} | ${ms.toFixed(0).padStart(6)} | ${scr}` +
          (capped ? '  [capped]' : ''),
      );
    }
  }
  console.log('  NOTE: `min` below `walk` means the walk collapsed — always measure.');
}

// --- 4. Solution length as a target a person can understand -------------------------
// `solLen` is "only accept a solution this short", which is exactly how a learner would
// put it: 22 is fine today, under 20 later, as short as you can find it eventually.
//
// For each target, descend: always the loose bound first (there must be an answer on screen
// before anything is asked of it), then strictly shorter than the current best, each attempt
// bounded by a NODE budget rather than a stopwatch, because nodes are the same number on a
// slow phone and a fast laptop and seconds are not.
function parseTargets() {
  const ladder = (process.env.BENCH_TARGETS ?? '22,21,20,19,18').split(',').map((t) => {
    const n = Number(t.trim());
    if (!Number.isInteger(n) || n < 2 || n >= LOOSEST_BOUND) {
      throw new Error(`BENCH_TARGETS entry ${t} is not an integer in 2..${LOOSEST_BOUND - 1}`);
    }
    return n;
  });
  if (ladder.some((t, i) => i > 0 && t >= ladder[i - 1])) {
    throw new Error(`BENCH_TARGETS ${ladder.join(',')} must be strictly descending`);
  }
  return ladder;
}

/**
 * The shipped pool, modelled — the same split, run one slice at a time.
 *
 * The views and the budget come from the app's own `sliceViews`/`shareBudget` rather than a
 * re-derivation here: the point of this mode is to measure what ships, and a bench that
 * re-implements the thing it measures agrees with itself for free.
 *
 * The ANSWER is exact. The pool picks by (depth, view) and that pick does not depend on which
 * worker finishes first, so the reached-counts and move-counts this mode reports are the real
 * ones — which is what the ladder is for.
 *
 * The TIME is a model, and an UPPER BOUND. In the app the slices run at once, so the wall clock
 * is the slowest of them; here they run in sequence and the slowest is what gets recorded. The
 * model also ignores the shared stop, which can only ever cut a slice short. So the real pool is
 * at least this fast and usually faster — stated rather than presented as a measurement.
 */
function pooledSolver(engine, solve, workers) {
  const slices = sliceViews(workers, VIEW_COUNT);
  let slowestMs = 0;
  const run = (facelets, { solLen, probeMax }) => {
    const shares = shareBudget(probeMax, slices.length);
    let best = null;
    let slowest = 0;
    for (const [i, share] of shares.entries()) {
      const t0 = nowMs();
      const alg = solve(facelets, { solLen, probeMax: share, views: slices[i] });
      slowest = Math.max(slowest, nowMs() - t0);
      if (alg === null) continue;
      const cand = { alg, depth: engine.searchStats.depth, view: engine.searchStats.view };
      if (best === null || cand.depth < best.depth || (cand.depth === best.depth && cand.view < best.view)) {
        best = cand;
      }
    }
    slowestMs = slowest;
    return best === null ? null : best.alg;
  };
  run.lastMs = () => slowestMs;
  return run;
}

async function targets() {
  const TARGET_LADDER = parseTargets();
  const { engine, solve } = await loadEngine();
  const built = nowMs();
  engine.initialize();
  const initNote = engineWarm ? 'warm — an earlier stage already built the tables' : `${(nowMs() - built).toFixed(0)} ms`;
  engineWarm = true;
  // The engine's phase-2 depth cap, exposed for the measurement that chose it (§7: a cap of
  // 10 measured WORSE than 12). Persists for this process; validated by the engine.
  const maxPhase2 = process.env.BENCH_MAXPHASE2 === undefined ? null : intEnv('BENCH_MAXPHASE2', 12);
  if (maxPhase2 !== null) {
    engine.setBounds({ maxPhase2 });
    console.log(`  maxPhase2 ${maxPhase2} (BENCH_MAXPHASE2)`);
  }
  // BENCH_WORKERS>1 runs the ladder through the shipped parallel split instead of one shared
  // budget. The two are NOT the same question: a slice gets probeMax/N, so a tier the sequential
  // search reached by spending everything on one view can go unreached. That is exactly why the
  // ladder had to be re-measured after the pool shipped.
  const workers = intEnv('BENCH_WORKERS', 1);
  if (workers < 1 || workers > VIEW_COUNT) {
    throw new Error(`BENCH_WORKERS ${workers} must be 1..${VIEW_COUNT}`);
  }
  const pool = workers > 1 ? pooledSolver(engine, solve, workers) : null;
  const ask1 = pool ?? solve;

  // BENCH_STATES points at a file of facelet strings, one per line. Without it the draw is
  // fresh every run, which is right for a single table and WRONG for a comparison: two draws
  // differ by a few states at the hard tiers, which is the same size as the effect being
  // measured. Sequential-vs-pooled must see the same cubes or it measures the dice.
  const statesFile = process.env.BENCH_STATES;
  const states = [];
  if (statesFile) {
    for (const line of readFileSync(statesFile, 'utf8').split('\n')) {
      const f = line.trim();
      if (!f) continue;
      if (!/^[URFDLB]{54}$/.test(f)) throw new Error(`BENCH_STATES: not a facelet string: ${f.slice(0, 20)}`);
      Cube.fromString(f); // refuses an illegal colouring here rather than mid-ladder
      states.push(f);
    }
    if (states.length === 0) throw new Error(`BENCH_STATES ${statesFile} held no states`);
  } else {
    for (let i = 0; i < N_STATES; i++) states.push(Cube.random().asString());
  }
  console.log('\n[targets] two-phase ladder');
  console.log(`  table init ${initNote} | n=${states.length} | budget ${NODE_BUDGET.toLocaleString()} nodes/attempt`);
  if (pool) {
    console.log(`  ${workers} workers, ${sliceViews(workers, VIEW_COUNT).map((v) => v.join('+')).join(' | ')}` +
      ` — times are the SLOWEST SLICE (an upper bound on the pool's wall clock; the stop is not modelled)`);
  }
  console.log('  target |  reached | cumulative ms, ALL states: median    p90   worst | mean moves (reached)');

  // Per cube: the running best move count, and the time spent getting there — kept for every
  // state, reached or not, because the failures are the slowest cases and a learner waits for
  // those too.
  const best = states.map(() => ({ moves: Infinity, ms: 0, stalled: false }));

  for (const target of TARGET_LADDER) {
    for (const [i, facelets] of states.entries()) {
      const cube = best[i];
      while (!cube.stalled && cube.moves > target) {
        // Exactly refine()'s asks: the loose bound first when nothing is held yet, then
        // strictly below the current best — never a jump to the target, which would measure a
        // different protocol than the app runs.
        const ask = cube.moves === Infinity ? LOOSEST_BOUND : cube.moves;
        const t0 = nowMs();
        const answer = ask1(facelets, { solLen: ask, probeMax: NODE_BUDGET });
        // In pooled mode the slices ran in sequence here but run at once in the app, so the
        // elapsed wall clock of this loop is not the app's. The slowest slice is.
        cube.ms += pool ? pool.lastMs() : nowMs() - t0;
        if (answer === null) {
          // Out of budget, not out of solutions. The previous answer stands and this cube
          // stops descending — which is exactly what the app would do.
          cube.stalled = true;
          break;
        }
        verify(facelets, answer);
        cube.moves = lenOf(answer);
      }
    }
    const reached = best.filter((c) => c.moves <= target);
    const allTimes = best.map((c) => c.ms);
    console.log(
      `  ${String(`<= ${target}`).padStart(6)} | ${String(reached.length).padStart(3)}/${states.length}` +
      `    | ${shown(percentile(allTimes, 0.5)).padStart(24)} ${shown(percentile(allTimes, 0.9)).padStart(6)} ${shown(Math.max(...allTimes)).padStart(6)} ` +
      `| ${reached.length ? (reached.reduce((a, c) => a + c.moves, 0) / reached.length).toFixed(2) : '—'}`,
    );
  }
  console.log('  Cumulative over every state, reached or not: the failures are the slowest');
  console.log('  cases, and a learner waits for those too.');
}

// --- 5. The contract solve-target.js is written against -----------------------------
// `lib/solve-target.js` drives the engine through an injected function and assumes two things
// of it: asked for a solution shorter than N it returns one, never longer; and when it cannot
// find one within the node budget it says so rather than returning something else. Its unit
// tests prove the module handles both, against a fake. This proves the REAL engine behaves
// that way — which no fake can.
async function contract() {
  const { engine, solve } = await loadEngine();

  let violations = 0;
  const asyncSolve = async (facelets, { solLen, probeMax }) => {
    // The moves < solLen half of the contract is enforced INSIDE createSolver — a violation
    // throws out of solve() and fails this stage loudly. What is verified here is the half no
    // wrapper can: that the answers actually solve the cube, per the independent oracle.
    const answer = solve(facelets, { solLen, probeMax });
    if (answer === null) return null;
    try {
      verify(facelets, answer);
    } catch (err) {
      console.log(`  BROKEN: ${err.message}`);
      violations++;
    }
    return answer;
  };

  console.log(`\n[contract] two-phase — n=${N_STATES} per tier, ${NODE_BUDGET.toLocaleString()} nodes/attempt`);

  // The null half of the contract, forced deterministically: the superflip is PROVEN to need
  // 20 moves, so under 16 within a small budget must be null — by mathematics, not sampling.
  // The spend check is what makes this a BUDGET test and not just an impossibility test: an
  // engine that ignored probeMax and exhausted the space would also answer null, but it could
  // not spend exactly the budget.
  const superflip = new Cube().move("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  if (solve(superflip.asString(), { solLen: 16, probeMax: 1000 }) !== null) {
    throw new Error('contract: the superflip has no 15-move solution — a non-null here is a broken engine');
  }
  const spent = engine.searchStats.p1Nodes + engine.searchStats.p2Nodes;
  if (spent !== 1000) {
    throw new Error(`contract: a 1000-node budget spent ${spent} nodes — probeMax is not bounding the work`);
  }
  console.log('  null when out of budget: forced on the superflip, spend == budget observed');

  const tierNames = TIERS.filter((t) => t.target !== null).map((t) => t.name);
  for (const tier of tierNames) {
    const finals = [];
    for (let i = 0; i < N_STATES; i++) {
      const facelets = Cube.random().asString();
      let last = null;
      let previous = Infinity;
      for await (const step of refine(facelets, { solve: asyncSolve, tier, probeBudget: NODE_BUDGET })) {
        // The final step repeats the current answer to carry the stop reason, so equality is
        // allowed only there. Anything longer, or a repeat mid-stream, is a real violation.
        const improved = step.moves < previous || (step.moves === previous && step.stopped !== null);
        if (!improved) {
          console.log(`  BROKEN: ${previous} -> ${step.moves} (stopped=${step.stopped})`);
          violations++;
        }
        previous = step.moves;
        last = step;
      }
      finals.push(last);
    }
    const met = finals.filter((f) => f.met).length;
    const meanMoves = finals.reduce((a, f) => a + f.moves, 0) / finals.length;
    console.log(`  ${tier.padEnd(9)} met ${String(met).padStart(3)}/${N_STATES} | mean ${meanMoves.toFixed(2)} moves`);
  }
  if (violations > 0) {
    throw new Error(`${violations} contract violations — solve-target.js is written against behaviour the engine no longer has`);
  }
  console.log('  contract holds: shorter when asked, null when out of budget, never longer');
}

// --- 6. A gotcha kept honest by an assertion ----------------------------------------
// cubejs's solve() dereferences a null solution when maxDepth is too small, so it
// THROWS instead of failing cleanly. Every caller that lowers maxDepth needs a catch.
// Asserted rather than merely written down: a documented gotcha silently stops being
// true, a checked one does not.
function assertShallowDepthThrows() {
  const cube = new Cube().move("R U R' U' F2 L D2 B'");
  let threw = false;
  try {
    cube.solve(1);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      'ASSERTION FAILED: cubejs solve(1) no longer throws on an unreachable depth.\n' +
        '  dev-docs/solver-move-count.md documents this throw and callers catch it.\n' +
        '  If cubejs now returns cleanly, update the note and simplify solveOrNull().',
    );
  }
  console.log('\n[assert] cubejs solve() still throws when maxDepth is unreachable — OK');
}

const STAGES = ['default', 'all', 'baseline', 'sweep', 'shallow', 'targets', 'contract'];
const stage = process.argv[2] ?? 'default';
if (!STAGES.includes(stage) || process.argv.length > 3) {
  // A typo that silently ran nothing used to exit 0 looking like a successful benchmark.
  console.error(`unknown stage: ${process.argv.slice(2).join(' ')}`);
  console.error(`usage: node bench/solver-move-count.mjs [${STAGES.join('|')}]`);
  process.exit(1);
}
// `sweep`, `targets` and `contract` cost minutes at scale, so none joins the default run.
const OPT_IN = new Set(['sweep', 'targets', 'contract']);
const wants = (name) =>
  stage === 'all' || stage === name || (stage === 'default' && !OPT_IN.has(name));

Cube.initSolver();
assertShallowDepthThrows();

if (wants('baseline')) await baseline();
if (wants('sweep')) sweep();
if (wants('shallow')) shallow();
if (wants('targets')) await targets();
if (wants('contract')) await contract();
